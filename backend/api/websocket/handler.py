from __future__ import annotations

import asyncio
import logging
import time
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

# Wave 2I Fix 6 (P83-5): initial auth handshake timeout. Tor / VPN RTT can
# push the first message past 5s on a cold circuit; a 20s budget gives the
# client time to complete the JSON exchange without breaking fast paths
# (under normal conditions the auth message arrives in a few hundred ms).
_WS_AUTH_TIMEOUT_SECONDS = 20.0

# Wave 2I Fix 8 (P81-5): how often to re-validate the JWT while the
# WebSocket is open. 5 minutes balances closing stale sessions promptly
# against the Redis load of revalidating every single live client on every
# message. With ACCESS_TOKEN_EXPIRE_MINUTES=480 (8 hours) a session
# survives roughly 96 revalidations before naturally expiring.
_WS_JWT_REVALIDATE_INTERVAL_SECONDS = 300

# Module-level singleton for the Redis listener task (BUG-036)
_listener_task: asyncio.Task | None = None
_listener_lock = asyncio.Lock()


# Round 7 Fix 1 (P127): connection caps. Without a ceiling on simultaneous
# WebSocket clients, a malicious actor (or a runaway frontend in reconnect
# storm) can open 10k sockets and exhaust kernel FDs. The manager rejects
# registrations once EITHER the total or the per-user budget is exceeded.
# Defaults sized for our single-VPS deployment — operators who need more
# can bump ``settings.WS_MAX_TOTAL`` / ``settings.WS_MAX_PER_USER`` via
# env without a code change. Constants referenced at register-time (not
# module import) so live settings changes take effect without restart.
_MAX_WS_CONNECTIONS_TOTAL = 500
_MAX_WS_CONNECTIONS_PER_USER = 5

# RFC 6455 close code 4008 is reserved for application-specific "policy
# violation" semantics. We use it specifically for cap rejections so the
# frontend can distinguish "server is full" (back off + retry later) from
# "auth failed" (4001 — kick to /login).
_WS_POLICY_VIOLATION_CLOSE_CODE = 4008

# Round-7 / O-2: per-frame size cap on inbound WebSocket text. Without
# this an attacker can send a single 100MB JSON frame and force the
# server to materialise the whole string before ``orjson.loads`` even
# fails. uvicorn's ``--ws-max-size`` is process-wide and defaults to
# 16 MiB; that is *far* too generous for our protocol (every legitimate
# inbound frame is a small action dict — subscribe, unsubscribe, ping,
# auth — well under 1 KB). 64 KB is the smallest cap that still lets us
# accept a worst-case auth frame with a chunky JWT.
_WS_MAX_FRAME_BYTES = 64 * 1024


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

    async def register(self, ws: WebSocket, user_id: str) -> bool:
        """Register an already-accepted WebSocket connection.

        ``user_id`` is pinned per-connection so the trade_updates stream
        subscription can address ``trade_updates:{user_id}`` without having
        to re-read the auth token on every subscribe frame.

        Round-7 / O-4: ``user_id`` is now required (no ``"default"``
        fallback). The auth bootstrap rejects connections whose JWT
        lacks a subject before this method is reached, so callers
        always have a real user_id; making it explicit prevents a
        future caller from accidentally landing on the cross-tenant
        sentinel.

        Round 7 Fix 1 (P127): enforces two caps ahead of the dict insert.
        Returns ``True`` on success; ``False`` on rejection (caller is
        responsible for closing the socket with 4008). We close+return
        rather than raise so the websocket_endpoint flow stays linear.

        Cap values come from ``settings.WS_MAX_TOTAL`` /
        ``settings.WS_MAX_PER_USER`` so operators can bump them per
        deploy without a rebuild. The module-level defaults are used
        only if settings import fails (defensive — should never trigger
        in production).
        """
        # Read caps fresh so env-var overrides take effect without a
        # restart; fall back to module defaults if settings can't load.
        try:
            from core.config import settings
            max_total = int(getattr(settings, "WS_MAX_TOTAL", _MAX_WS_CONNECTIONS_TOTAL))
            max_per_user = int(getattr(settings, "WS_MAX_PER_USER", _MAX_WS_CONNECTIONS_PER_USER))
        except Exception:
            max_total = _MAX_WS_CONNECTIONS_TOTAL
            max_per_user = _MAX_WS_CONNECTIONS_PER_USER

        rejection_reason = ""
        count = 0
        async with self._lock:
            total_active = len(self._connections)
            if total_active >= max_total:
                logger.warning(
                    "WS register rejected: server cap reached (%d/%d)",
                    total_active, max_total,
                )
                # Drop the lock before attempting the close so we don't
                # hold the manager's mutex across a network I/O.
                rejection_reason = "total"
            else:
                # Count this user's current sockets WITHIN the lock so a
                # concurrent register() for the same user can't race past
                # the cap. O(N) in total connections but N is bounded by
                # max_total (≤500) so well under a millisecond.
                per_user_active = sum(1 for uid in self._user_ids.values() if uid == user_id)
                if per_user_active >= max_per_user:
                    logger.warning(
                        "WS register rejected: per-user cap reached for %s (%d/%d)",
                        user_id, per_user_active, max_per_user,
                    )
                    rejection_reason = "per_user"
                else:
                    self._connections[ws] = set()
                    self._user_ids[ws] = user_id
                    count = len(self._connections)
        if rejection_reason:
            try:
                await ws.close(
                    code=_WS_POLICY_VIOLATION_CLOSE_CODE,
                    reason="policy violation: server cap reached",
                )
            except Exception:
                # Socket may already be dead; rejection is the important
                # signal, the close is best-effort.
                logger.debug("WS register: close-after-reject raised", exc_info=True)
            return False
        logger.info("WebSocket client connected (%d active)", count)
        return True

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
        # Round-7 / O-4: ``"default"`` is no longer a valid sentinel — the
        # auth path rejects unknown subjects, so any registered socket has
        # a real user_id. Returning empty string for the unregistered case
        # keeps callers from accidentally cross-tenant matching against a
        # well-known string.
        return self._user_ids.get(ws, "")

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
            # Round-29 / persona-E F2: cursor age guard. Pre-fix a tab that
            # slept 6 h then woke would send a 6-h-old cursor; the backend
            # would attempt replay against a stream that has likely been
            # trimmed (10 K MAXLEN), get an empty list back with no error,
            # and the tab would silently be missing thousands of fills /
            # alerts. If the cursor is older than ~30 min, refuse to replay
            # and force the client to start fresh from "$" (live tail). The
            # FE will show a "reconnected" banner; better than silent loss.
            _MAX_CURSOR_AGE_MS = 30 * 60 * 1000
            if cursor != "$" and isinstance(cursor, str) and "-" in cursor:
                try:
                    cursor_ms = int(cursor.split("-", 1)[0])
                    age_ms = int(time.time() * 1000) - cursor_ms
                    if age_ms > _MAX_CURSOR_AGE_MS:
                        logger.info(
                            "subscribe_client: cursor age %.1fmin exceeds %dmin "
                            "for %s; forcing fresh subscribe",
                            age_ms / 60_000, _MAX_CURSOR_AGE_MS // 60_000, channel,
                        )
                        await self._send(ws, {
                            "type": "cursor_expired",
                            "channel": channel,
                            "reason": "stale_cursor",
                        })
                        cursor = "$"
                except (ValueError, IndexError):
                    # Malformed cursor — treat as fresh.
                    cursor = "$"
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

        Wave 3L Fix 3 (persona-86/90): serialize once and fan out via
        ``asyncio.gather`` instead of the prior per-client
        ``orjson.dumps`` + sequential ``asyncio.wait_for`` loop. At 100
        subscribers the old path's worst case was serial-sum of per-
        client 2 s timeouts (~200 s); with gather all sends race in
        parallel under the same 2 s budget.
        """
        # Extract the routing hints up-front so we only peel them off the
        # payload once, not per-client.
        stream_id = data.get("_id") if isinstance(data, dict) else None
        payload_user = (
            data.get("_user_id") if isinstance(data, dict) and channel == CHANNEL_TRADE_UPDATES else None
        )

        async with self._lock:
            # Round-7 / O-4: skip any registered ws that somehow has no
            # captured user_id. The auth path now refuses to register
            # anyone without a JWT subject, but a defensive filter here
            # guarantees a ws with no resolved user_id can NEVER receive
            # another user's per-user payload (the previous fallback to
            # ``"default"`` would have matched a spoofed
            # ``_user_id="default"`` envelope).
            targets = [
                (ws, self._user_ids[ws])
                for ws, channels in self._connections.items()
                if channel in channels and ws in self._user_ids
            ]

        # Apply the per-user filter for trade_updates so one tenant never
        # sees another tenant's fills.
        if payload_user is not None:
            targets = [t for t in targets if t[1] == payload_user]

        if not targets:
            return

        # Serialize the envelope ONCE instead of N times. orjson.dumps on
        # a typical bar/trade payload is ~10 µs but still adds up with a
        # few hundred clients and high-rate ticks.
        payload_bytes = orjson.dumps({"channel": channel, "data": data})

        # Fan out in parallel. return_exceptions=True so a single bad
        # socket can't take down the whole broadcast. Per-send timeout
        # stays at 2 s, applied to every task concurrently.
        send_tasks = [
            asyncio.wait_for(self._send_bytes(ws, payload_bytes), timeout=2.0)
            for ws, _ in targets
        ]
        results = await asyncio.gather(*send_tasks, return_exceptions=True)

        dead: list[WebSocket] = []
        for (ws, _), result in zip(targets, results):
            if isinstance(result, BaseException):
                logger.debug(
                    "broadcast: dropped client on channel %s (will reap)",
                    channel, exc_info=result,
                )
                dead.append(ws)
                continue
            if stream_id and channel in _STREAM_BACKED_CHANNELS:
                # Track the last delivered ID per-client so reconnect
                # replay starts from exactly here.
                self.set_cursor(ws, channel, stream_id)

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

    async def _send_bytes(self, ws: WebSocket, payload: bytes) -> None:
        """Send a pre-serialized payload — used by the fan-out broadcast path.

        Wave 3L Fix 3: by passing an already-orjson-encoded envelope we
        avoid re-serializing per target. The frontend client uses
        ``JSON.parse(event.data)`` on a text frame, so we decode the bytes
        once and call ``send_text``. (Going to ``send_bytes`` would hand
        the client a Blob / ArrayBuffer and break the JSON.parse contract.)
        """
        try:
            await ws.send_text(payload.decode())
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
                        # Round-11 / BB-17 (P1): used to be DEBUG only.
                        # Operators never saw the rate of malformed
                        # frames; a publisher emitting bad JSON could
                        # poison every connected client invisibly.
                        # Promoted to WARNING with a structured
                        # ``event="ws_pubsub_malformed"`` field, plus a
                        # Redis counter that an alerting probe can
                        # threshold.
                        logger.warning(
                            "Redis pubsub: non-JSON message on %s, passing raw",
                            channel,
                            exc_info=True,
                            extra={
                                "event": "ws_pubsub_malformed",
                                "channel": channel,
                            },
                        )
                        try:
                            from core.redis import cache_set, cache_get
                            metric_key = f"metrics:ws_pubsub_malformed:{channel}"
                            prev = await cache_get(metric_key)
                            prev_n = (
                                int(prev)
                                if isinstance(prev, (int, str)) and str(prev).isdigit()
                                else 0
                            )
                            await cache_set(metric_key, prev_n + 1, ttl_seconds=86_400)
                        except Exception:
                            pass
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


async def _revalidate_jwt_loop(
    ws: WebSocket,
    token: str,
    username: str,
) -> None:
    """Periodically re-validate the stored JWT for ``ws``.

    Wave 2I Fix 8 (P81-5). Without this, a WebSocket opened at 09:00 with an
    access token that expires at 17:00 would keep receiving data through the
    next day because the token is only checked on the initial handshake.
    Here we re-decode every ``_WS_JWT_REVALIDATE_INTERVAL_SECONDS`` and:

      * Close with 4001 if the token is now expired.
      * Close with 4001 if the token was revoked (operator logged-out / the
        refresh-rotate step revoked the jti).
      * Close with 4001 if password_version or session_epoch moved past the
        snapshotted values (covers change-password / logout-all).

    Running as its own task so the message loop stays unblocked. Cancelled
    when the WebSocket disconnects via ``finally: task.cancel()`` below.
    """
    from core.auth import (
        decode_token,
        get_password_version,
        get_session_epoch,
        is_token_revoked,
    )

    try:
        while True:
            await asyncio.sleep(_WS_JWT_REVALIDATE_INTERVAL_SECONDS)

            # Re-decode. decode_token raises HTTPException on expiry /
            # signature failure; we catch that and close rather than
            # propagate (HTTPException is an ASGI concept, doesn't belong
            # in the WS lifecycle).
            try:
                payload = decode_token(token, expected_type="access")
            except Exception:
                logger.info("WS revalidation: token expired/invalid, closing")
                try:
                    await ws.close(code=4001, reason="Token expired")
                except Exception:
                    pass
                return

            jti = payload.get("jti")
            if jti and await is_token_revoked(jti):
                logger.info("WS revalidation: token revoked, closing")
                try:
                    await ws.close(code=4001, reason="Token revoked")
                except Exception:
                    pass
                return

            # Password-version / session-epoch checks mirror ``require_auth``.
            try:
                token_pv = int(payload.get("pv", 1))
                token_epoch = int(payload.get("epoch", 1))
                current_pv = await get_password_version(username)
                current_epoch = await get_session_epoch(username)
            except Exception:
                # Redis down — fail closed as elsewhere.
                logger.warning("WS revalidation: auth counter read failed, closing", exc_info=True)
                try:
                    await ws.close(code=4001, reason="Auth unavailable")
                except Exception:
                    pass
                return

            if token_pv < current_pv or token_epoch < current_epoch:
                logger.info(
                    "WS revalidation: stale pv/epoch (pv=%d<%d, epoch=%d<%d), closing",
                    token_pv, current_pv, token_epoch, current_epoch,
                )
                try:
                    await ws.close(code=4001, reason="Session invalidated")
                except Exception:
                    pass
                return
    except asyncio.CancelledError:
        return


def _allowed_ws_origins() -> set[str]:
    """Return the set of Origin values the WebSocket handshake accepts.

    Round-6 L-4: WebSockets do NOT participate in the CORS preflight
    dance — once ``ws.accept()`` runs, the connection is established
    and the browser will deliver any ambient cookies (HttpOnly
    access_token) along with messages, EVEN IF the originating page is
    on an attacker-controlled origin (CSWSH). Without an explicit
    Origin allowlist, a malicious page on https://attacker.example can
    open ``new WebSocket("wss://tradingalpha.net/ws")`` from the user's
    browser, ride their auth cookies into the auth handshake, and
    stream portfolio / trade data back to the attacker.

    Allowlist mirrors ``main.py``'s CORS allowlist. In production, an
    EMPTY set is a fail-closed configuration for browser handshakes:
    without an explicit ``PRODUCTION_ORIGIN`` there is no safe origin to
    trust for ambient-cookie WebSockets.
    """
    from core.config import settings

    origins: set[str] = set()
    if not settings.is_production:
        origins.update({
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        })
    if settings.PRODUCTION_ORIGIN:
        origins.add(settings.PRODUCTION_ORIGIN)
    return origins


async def websocket_endpoint(ws: WebSocket) -> None:
    """Main WebSocket endpoint handler.

    Protocol:
      Client must authenticate first:
        {"action": "auth", "token": "<jwt>"}

      Then can subscribe/unsubscribe:
        {"action": "subscribe", "channel": "quotes"}
        {"action": "unsubscribe", "channel": "quotes"}
        {"action": "ping"}

    Round-6 L-4: Origin is checked BEFORE ``ws.accept()`` so a
    cross-site handshake from an attacker page is rejected with RFC
    6455 close 1008 (policy violation) — the browser-delivered HttpOnly
    cookies never reach the auth handshake from a non-allowlisted
    origin.
    """
    # Round-6 L-4: Origin allowlist enforcement. Browser WebSocket
    # connects always carry an ``Origin`` header (RFC 6455 §10.2);
    # non-browser clients (CLI, ws-cli probes) typically don't, and we
    # let them through because they don't have ambient cookies that the
    # CSWSH attack hinges on.
    allowed_origins = _allowed_ws_origins()
    origin = ws.headers.get("origin")
    origin_denied = False
    if origin is not None:
        if allowed_origins:
            origin_denied = origin not in allowed_origins
        else:
            from core.config import settings

            origin_denied = settings.is_production

    if origin_denied:
        try:
            await ws.close(code=1008, reason="Origin not allowed")
        except Exception:
            logger.debug("ws origin reject: close raised", exc_info=True)
        logger.warning(
            "websocket: rejected cross-origin handshake origin=%s allowlist=%s",
            origin,
            sorted(allowed_origins),
        )
        return

    await ws.accept()

    # Token retained across the lifetime of the connection so the background
    # revalidator can re-decode it every _WS_JWT_REVALIDATE_INTERVAL_SECONDS
    # (Wave 2I Fix 8).
    retained_token: str | None = None
    revalidate_task: asyncio.Task | None = None

    try:
        # Require auth as first message within _WS_AUTH_TIMEOUT_SECONDS
        from core.auth import (
            decode_token,
            get_password_version,
            get_session_epoch,
            is_token_revoked,
        )

        async def _check_pv_epoch(payload: dict, user: str) -> bool:
            """Mirror require_auth's pv/epoch gates at WS handshake.

            Without this, a token minted before /auth/change-password or
            /auth/logout-all is accepted on the initial WS connect and keeps
            streaming portfolio/trade data until the 5-minute revalidator
            tick catches it. Every authenticated HTTP route rejects the same
            token immediately; the WS must match or logout-all is toothless
            against an active socket.
            """
            token_pv = int(payload.get("pv", 1))
            token_epoch = int(payload.get("epoch", 1))
            current_pv = await get_password_version(user)
            current_epoch = await get_session_epoch(user)
            return token_pv >= current_pv and token_epoch >= current_epoch

        # Round-7 / O-4: ``resolved_user_id`` MUST come from the verified
        # JWT — never from a string fallback. The previous code initialised
        # it to ``"default"`` and re-fell-back to ``"default"`` whenever
        # ``payload.get("sub") or payload.get("username")`` was empty,
        # which would happen for any token issued without a ``sub`` claim
        # (older test tokens, mis-issued provider tokens). All such users
        # then shared a single ``"default"`` channel partition and saw each
        # other's trade fills. Treat a missing subject as an auth failure.
        def _user_from_payload(payload: dict[str, Any]) -> str | None:
            sub = payload.get("sub") or payload.get("username")
            if not sub:
                return None
            sub = str(sub).strip()
            return sub or None

        resolved_user_id: str | None = None
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
                resolved_user_id = _user_from_payload(payload)
                if resolved_user_id is None:
                    await ws.close(code=4001, reason="Token missing subject")
                    return
                if not await _check_pv_epoch(payload, resolved_user_id):
                    await ws.close(code=4001, reason="Session invalidated")
                    return
                retained_token = cookie_token
                await ws.send_text(orjson.dumps({"type": "authenticated"}).decode())
            else:
                # Fall back to message-based auth. Timeout extended in Wave 2I
                # Fix 6 (P83-5) for Tor / VPN RTT — see _WS_AUTH_TIMEOUT_SECONDS.
                raw = await asyncio.wait_for(ws.receive_text(), timeout=_WS_AUTH_TIMEOUT_SECONDS)
                # Round-7 / O-2: cap the auth-frame size before parsing so a
                # 100MB JWT-shaped string can't OOM the server pre-decode.
                if len(raw) > _WS_MAX_FRAME_BYTES:
                    await ws.close(code=1009, reason="Auth frame too large")
                    return
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
                resolved_user_id = _user_from_payload(payload)
                if resolved_user_id is None:
                    await ws.close(code=4001, reason="Token missing subject")
                    return
                if not await _check_pv_epoch(payload, resolved_user_id):
                    await ws.close(code=4001, reason="Session invalidated")
                    return
                retained_token = msg["token"]
                await ws.send_text(orjson.dumps({"type": "authenticated"}).decode())
        except asyncio.TimeoutError:
            await ws.close(code=4001, reason="Auth timeout")
            return
        except Exception:
            logger.debug("websocket auth failed", exc_info=True)
            await ws.send_text(orjson.dumps({"error": "Invalid token"}).decode())
            await ws.close(code=4001, reason="Auth failed")
            return

        # Auth passed — register connection. Round 7 Fix 1 (P127): if the
        # manager rejected us for cap reasons it already sent close 4008;
        # bail out before starting the listener / revalidator so we don't
        # spin up background tasks for a connection we just closed.
        registered = await manager.register(ws, user_id=resolved_user_id)
        if not registered:
            return

        await _ensure_listener_started()

        # Kick off the periodic revalidator. Runs concurrently with the
        # receive loop; cancelled in the finally block below.
        if retained_token is not None:
            revalidate_task = asyncio.create_task(
                _revalidate_jwt_loop(ws, retained_token, resolved_user_id)
            )

        while True:
            raw = await ws.receive_text()
            # Round-7 / O-2: enforce per-frame size cap before parsing.
            if len(raw) > _WS_MAX_FRAME_BYTES:
                logger.info(
                    "websocket: closed user=%s for oversized frame (%d > %d)",
                    resolved_user_id, len(raw), _WS_MAX_FRAME_BYTES,
                )
                await ws.close(code=1009, reason="Frame too large")
                return
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
        if revalidate_task is not None and not revalidate_task.done():
            revalidate_task.cancel()
            try:
                await revalidate_task
            except asyncio.CancelledError:
                pass
            except Exception:
                # Round-11 / BB-20 (P2): the revalidator is the only
                # piece of code that can detect a logged-out / revoked
                # JWT mid-stream. If it dies with an unexpected
                # exception (Redis blip, decode error race) the WS
                # would historically just leak the failure at DEBUG —
                # which prod filters out — and the operator never
                # knows surveillance lapsed for that connection.
                # Promote to WARNING + emit a structured event so
                # the alerting probe can detect bursts.
                logger.warning(
                    "revalidate task raised on cleanup",
                    exc_info=True,
                    extra={"event": "ws_revalidator_failed"},
                )
        await manager.disconnect(ws)
        await _maybe_stop_listener()
