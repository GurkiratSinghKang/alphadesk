from __future__ import annotations

import asyncio
import logging
from typing import Any

import orjson
from fastapi import WebSocket, WebSocketDisconnect

from core.redis import (
    ALL_CHANNELS,
    CHANNEL_PORTFOLIO,
    CHANNEL_TRADE_UPDATES,
    redis_xread_portfolio,
    redis_xread_trade_updates,
    subscribe,
)

logger = logging.getLogger(__name__)

# Wave C (persona 74 P0 #1): channels that have a durable Redis Streams
# backing. For these, a client can send ``last_id`` in the subscribe frame
# and the backend will replay every event after that ID before resuming
# the live pub/sub tail.
_STREAM_BACKED_CHANNELS: frozenset[str] = frozenset({
    CHANNEL_TRADE_UPDATES,
    CHANNEL_PORTFOLIO,
})

# How long a stream-replay XREAD will block waiting for new data when the
# client passes ``last_id="$"`` (live-only). Short — this path only runs
# during the initial subscribe, and the live pub/sub listener takes over
# afterwards for real-time fanout.
_STREAM_REPLAY_BLOCK_MS = 50
# Batch cap per XREAD call. With a 10k MAXLEN and a single-digit-minute
# disconnect window, 500 is a comfortable upper bound.
_STREAM_REPLAY_COUNT = 500

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
        # Wave C: per-client per-channel cursor into the Redis Stream for
        # ``trade_updates`` / ``portfolio``. Updated as new entries are
        # delivered so a subsequent re-subscribe (e.g. reconnect) can pick
        # up where we left off. Keyed on (ws, channel) — cleared on
        # disconnect via ``self.disconnect``.
        self._stream_cursors: dict[tuple[WebSocket, str], str] = {}
        # Per-WS user_id captured at auth time. ``trade_updates`` streams
        # are scoped per-user — we need the resolved username to build the
        # stream key.
        self._user_ids: dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    @property
    def active_count(self) -> int:
        return len(self._connections)

    async def register(self, ws: WebSocket, user_id: str = "default") -> None:
        """Register an already-accepted WebSocket connection.

        ``user_id`` is pinned per-connection so the trade_updates stream
        subscription can address ``trade_updates:{user_id}`` without having
        to re-read the auth token on every subscribe frame.
        """
        async with self._lock:
            self._connections[ws] = set()
            self._user_ids[ws] = user_id
            count = len(self._connections)
        logger.info("WebSocket client connected (%d active)", count)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.pop(ws, None)
            self._user_ids.pop(ws, None)
            # Purge every per-(ws, channel) cursor — keyed on the websocket
            # object so simply popping the ws from _connections isn't enough.
            stale_cursor_keys = [k for k in self._stream_cursors if k[0] is ws]
            for k in stale_cursor_keys:
                self._stream_cursors.pop(k, None)
            count = len(self._connections)
        logger.info("WebSocket client disconnected (%d active)", count)

    def _get_user_id(self, ws: WebSocket) -> str:
        return self._user_ids.get(ws, "default")

    def get_cursor(self, ws: WebSocket, channel: str) -> str | None:
        """Return the last delivered stream ID for (ws, channel), or None."""
        return self._stream_cursors.get((ws, channel))

    def set_cursor(self, ws: WebSocket, channel: str, last_id: str) -> None:
        self._stream_cursors[(ws, channel)] = last_id

    async def subscribe_client(
        self,
        ws: WebSocket,
        channel: str,
        last_id: str | None = None,
    ) -> None:
        """Subscribe ``ws`` to ``channel``, optionally replaying from ``last_id``.

        ``last_id`` semantics (Wave C):
          * ``None`` or ``"$"`` — live-only, no replay. This matches the
            pre-Wave-C behaviour and is the default for first-time subscribers.
          * ``"0-0"`` — replay the entire stream (intended only for explicit
            "give me everything you have" clients, e.g. test harnesses).
          * A real Redis Stream ID — replay every entry strictly after that ID
            before resuming live delivery. This is the reconnect-resume path.
        """
        if channel not in ALL_CHANNELS:
            await self._send(ws, {"error": f"Unknown channel: {channel}", "valid": ALL_CHANNELS})
            return
        async with self._lock:
            if ws in self._connections:
                self._connections[ws].add(channel)
        await self._send(ws, {"type": "subscribed", "channel": channel})

        # Stream replay for durable channels. Safe to run lock-free — we
        # only read from Redis and send back to the owning websocket. If the
        # client already consumed everything, xread returns an empty list.
        if channel in _STREAM_BACKED_CHANNELS:
            cursor = last_id if last_id is not None else "$"
            try:
                if channel == CHANNEL_TRADE_UPDATES:
                    entries = await redis_xread_trade_updates(
                        user_id=self._get_user_id(ws),
                        last_id=cursor,
                        block_ms=_STREAM_REPLAY_BLOCK_MS if cursor == "$" else 0,
                        count=_STREAM_REPLAY_COUNT,
                    )
                else:
                    entries = await redis_xread_portfolio(
                        last_id=cursor,
                        block_ms=_STREAM_REPLAY_BLOCK_MS if cursor == "$" else 0,
                        count=_STREAM_REPLAY_COUNT,
                    )
                # Deliver the backlog in order and advance the cursor so the
                # next reconnect starts from the right place. A ``"$"``-only
                # subscriber that gets no replay still records a synthetic
                # cursor via the live pub/sub branch below.
                for entry_id, payload in entries:
                    await self._send(ws, {
                        "channel": channel,
                        "data": payload,
                        "_id": entry_id,
                    })
                    self.set_cursor(ws, channel, entry_id)
                if entries:
                    logger.debug(
                        "Replayed %d %s events from %s",
                        len(entries), channel, cursor,
                    )
            except Exception:
                # Replay failures should not break the subscription — the
                # client can still receive the live pub/sub tail. Log and
                # carry on so the user sees *something*.
                logger.warning(
                    "subscribe_client: stream replay failed for %s",
                    channel,
                    exc_info=True,
                )
        logger.debug("Client subscribed to %s", channel)

    async def unsubscribe_client(self, ws: WebSocket, channel: str) -> None:
        async with self._lock:
            if ws in self._connections:
                self._connections[ws].discard(channel)
        await self._send(ws, {"type": "unsubscribed", "channel": channel})

    async def broadcast(self, channel: str, data: dict[str, Any]) -> None:
        """Send data to all clients subscribed to the given channel.

        Wave C: if ``data`` carries an ``_id`` field (stream ID injected by
        the xadd-and-publish path in alpaca_stream), we propagate it to
        clients AND update their cursor so a subsequent reconnect picks up
        from exactly this entry. Per-user filtering applies to
        ``trade_updates``: the ``_user_id`` hint on the payload must match
        the client's authenticated user.
        """
        # Extract the routing hints up-front so we only peel them off the
        # payload once, not per-client.
        stream_id = data.get("_id") if isinstance(data, dict) else None
        payload_user = (
            data.get("_user_id") if isinstance(data, dict) and channel == CHANNEL_TRADE_UPDATES else None
        )

        dead: list[WebSocket] = []
        async with self._lock:
            targets = [
                (ws, self._user_ids.get(ws, "default"))
                for ws, channels in self._connections.items()
                if channel in channels
            ]

        for ws, user_id in targets:
            # Per-user filter on trade_updates so one tenant never sees
            # another tenant's fills. Skip if the payload is scoped and this
            # client is the wrong user.
            if payload_user is not None and payload_user != user_id:
                continue
            try:
                await asyncio.wait_for(
                    self._send(ws, {"channel": channel, "data": data}),
                    timeout=2.0,
                )
                if stream_id and channel in _STREAM_BACKED_CHANNELS:
                    # Track the last delivered ID per-client so reconnect
                    # replay starts from exactly here. Set without holding
                    # the connections lock (different lock) — cursor dict is
                    # accessed only from this coroutine-sequential path.
                    self.set_cursor(ws, channel, stream_id)
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

        resolved_user_id = "default"
        try:
            # Try cookie-based auth first (from HttpOnly cookies in handshake)
            cookie_token = ws.cookies.get("access_token")
            if cookie_token:
                payload = decode_token(cookie_token, expected_type="access")
                jti = payload.get("jti")
                if jti and await is_token_revoked(jti):
                    await ws.close(code=1008, reason="Token revoked")
                    return
                # Capture username/sub for per-user stream scoping (Wave C).
                resolved_user_id = str(payload.get("sub") or payload.get("username") or "default")
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
                resolved_user_id = str(payload.get("sub") or payload.get("username") or "default")
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
        await manager.register(ws, user_id=resolved_user_id)

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
                # Wave C: accept a ``last_id`` field on subscribe so clients
                # can request replay from a prior cursor after a reconnect.
                # Validate lightly — only accept strings to avoid Redis
                # commandset confusion if a client sends a dict/list.
                raw_last_id = msg.get("last_id")
                last_id: str | None = None
                if isinstance(raw_last_id, str) and len(raw_last_id) <= 64:
                    last_id = raw_last_id
                await manager.subscribe_client(ws, channel, last_id=last_id)
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
