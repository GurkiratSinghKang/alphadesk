from __future__ import annotations

import asyncio
import logging
from typing import Any

import orjson
from fastapi import WebSocket, WebSocketDisconnect

from core.redis import subscribe, ALL_CHANNELS

logger = logging.getLogger(__name__)

# Module-level singleton for the Redis listener task (BUG-036)
_listener_task: asyncio.Task | None = None
_listener_lock = asyncio.Lock()


class ConnectionManager:
    """Manages WebSocket connections and channel subscriptions.

    Each connected client can subscribe to one or more channels
    (quotes, portfolio, alerts, agents). Updates published to Redis
    pub/sub are forwarded to all clients subscribed to the relevant channel.
    """

    def __init__(self) -> None:
        self._connections: dict[WebSocket, set[str]] = {}
        self._lock = asyncio.Lock()

    @property
    def active_count(self) -> int:
        return len(self._connections)

    async def register(self, ws: WebSocket) -> None:
        """Register an already-accepted WebSocket connection."""
        async with self._lock:
            self._connections[ws] = set()
            count = len(self._connections)
        logger.info("WebSocket client connected (%d active)", count)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.pop(ws, None)
            count = len(self._connections)
        logger.info("WebSocket client disconnected (%d active)", count)

    async def subscribe_client(self, ws: WebSocket, channel: str) -> None:
        if channel not in ALL_CHANNELS:
            await self._send(ws, {"error": f"Unknown channel: {channel}", "valid": ALL_CHANNELS})
            return
        async with self._lock:
            if ws in self._connections:
                self._connections[ws].add(channel)
        await self._send(ws, {"type": "subscribed", "channel": channel})
        logger.debug("Client subscribed to %s", channel)

    async def unsubscribe_client(self, ws: WebSocket, channel: str) -> None:
        async with self._lock:
            if ws in self._connections:
                self._connections[ws].discard(channel)
        await self._send(ws, {"type": "unsubscribed", "channel": channel})

    async def broadcast(self, channel: str, data: dict[str, Any]) -> None:
        """Send data to all clients subscribed to the given channel."""
        dead: list[WebSocket] = []
        async with self._lock:
            targets = [
                ws for ws, channels in self._connections.items()
                if channel in channels
            ]

        for ws in targets:
            try:
                await asyncio.wait_for(
                    self._send(ws, {"channel": channel, "data": data}),
                    timeout=2.0,
                )
            except Exception:
                logger.debug(
                    "broadcast: dropped client on channel %s (will reap)",
                    channel, exc_info=True,
                )
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.pop(ws, None)
                count = len(self._connections)
            logger.info("Cleaned up %d dead WebSocket clients (%d active)", len(dead), count)

    async def _send(self, ws: WebSocket, data: dict[str, Any]) -> None:
        try:
            await ws.send_text(orjson.dumps(data).decode())
        except RuntimeError:
            # WebSocket already closed — silently ignore
            pass


# Singleton manager
manager = ConnectionManager()


async def _redis_listener() -> None:
    """Background task that bridges Redis pub/sub to WebSocket clients.

    Includes retry with exponential backoff for Redis connection failures.
    """
    retry_delay = 1.0
    max_retry_delay = 30.0
    consecutive_failures = 0
    max_consecutive_failures = 50  # give up after ~25 min of failures

    while True:
        try:
            pubsub = await subscribe(*ALL_CHANNELS)
            retry_delay = 1.0  # reset on successful connection
            consecutive_failures = 0
            logger.info("Redis listener connected and subscribed to %s", ALL_CHANNELS)
            try:
                async for message in pubsub.listen():
                    if message["type"] != "message":
                        continue
                    channel = message["channel"]
                    try:
                        data = orjson.loads(message["data"])
                    except Exception:
                        logger.debug(
                            "Redis pubsub: non-JSON message on %s, passing raw",
                            channel, exc_info=True,
                        )
                        data = {"raw": message["data"]}
                    await manager.broadcast(channel, data)
            except asyncio.CancelledError:
                try:
                    await pubsub.unsubscribe()
                    await pubsub.aclose()
                except Exception:
                    logger.debug(
                        "Redis listener: unsubscribe/close raised during cancel",
                        exc_info=True,
                    )
                return
            except Exception:
                logger.error("Redis listener stream error", exc_info=True)
                try:
                    await pubsub.unsubscribe()
                    await pubsub.aclose()
                except Exception:
                    logger.debug(
                        "Redis listener: unsubscribe/close raised after stream error",
                        exc_info=True,
                    )
        except asyncio.CancelledError:
            return
        except Exception:
            logger.error(
                "Redis listener connection error (retrying in %.1fs)",
                retry_delay, exc_info=True,
            )

        consecutive_failures += 1
        if consecutive_failures >= max_consecutive_failures:
            logger.error("Redis listener giving up after %d consecutive failures", consecutive_failures)
            return

        await asyncio.sleep(retry_delay)
        retry_delay = min(retry_delay * 2, max_retry_delay)


async def _ensure_listener_started() -> None:
    """Start the Redis listener singleton on first WebSocket connection."""
    global _listener_task
    async with _listener_lock:
        if _listener_task is None or _listener_task.done():
            _listener_task = asyncio.create_task(_redis_listener())
            logger.info("Redis listener task started")


async def _maybe_stop_listener() -> None:
    """Stop the Redis listener when no clients remain."""
    global _listener_task
    async with _listener_lock:
        if manager.active_count == 0 and _listener_task is not None and not _listener_task.done():
            _listener_task.cancel()
            try:
                await _listener_task
            except asyncio.CancelledError:
                pass
            _listener_task = None
            logger.info("Redis listener task stopped (no clients)")


async def websocket_endpoint(ws: WebSocket) -> None:
    """Main WebSocket endpoint handler.

    Protocol:
      Client must authenticate first:
        {"action": "auth", "token": "<jwt>"}

      Then can subscribe/unsubscribe:
        {"action": "subscribe", "channel": "quotes"}
        {"action": "unsubscribe", "channel": "quotes"}
        {"action": "ping"}
    """
    await ws.accept()

    try:
        # Require auth as first message within 5 seconds
        from core.auth import decode_token, is_token_revoked

        try:
            # Try cookie-based auth first (from HttpOnly cookies in handshake)
            cookie_token = ws.cookies.get("access_token")
            if cookie_token:
                payload = decode_token(cookie_token, expected_type="access")
                jti = payload.get("jti")
                if jti and await is_token_revoked(jti):
                    await ws.close(code=1008, reason="Token revoked")
                    return
                await ws.send_text(orjson.dumps({"type": "authenticated"}).decode())
            else:
                # Fall back to message-based auth
                raw = await asyncio.wait_for(ws.receive_text(), timeout=5.0)
                msg = orjson.loads(raw)
                if msg.get("action") != "auth" or not msg.get("token"):
                    await ws.send_text(orjson.dumps({"error": "First message must be auth"}).decode())
                    await ws.close(code=4001, reason="Auth required")
                    return
                payload = decode_token(msg["token"], expected_type="access")
                jti = payload.get("jti")
                if jti and await is_token_revoked(jti):
                    await ws.close(code=1008, reason="Token revoked")
                    return
                await ws.send_text(orjson.dumps({"type": "authenticated"}).decode())
        except asyncio.TimeoutError:
            await ws.close(code=4001, reason="Auth timeout")
            return
        except Exception:
            logger.debug("websocket auth failed", exc_info=True)
            await ws.send_text(orjson.dumps({"error": "Invalid token"}).decode())
            await ws.close(code=4001, reason="Auth failed")
            return

        # Auth passed — register connection
        await manager.register(ws)

        await _ensure_listener_started()

        while True:
            raw = await ws.receive_text()
            try:
                msg = orjson.loads(raw)
            except Exception:
                logger.debug("websocket: received invalid JSON from client", exc_info=True)
                await manager._send(ws, {"error": "Invalid JSON"})
                continue

            action = msg.get("action", "")

            if action == "subscribe":
                channel = msg.get("channel", "")
                await manager.subscribe_client(ws, channel)
            elif action == "unsubscribe":
                channel = msg.get("channel", "")
                await manager.unsubscribe_client(ws, channel)
            elif action == "ping":
                await manager._send(ws, {"type": "pong"})
            else:
                await manager._send(ws, {"error": f"Unknown action: {action}"})

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.error("WebSocket error", exc_info=True)
    finally:
        await manager.disconnect(ws)
        await _maybe_stop_listener()
