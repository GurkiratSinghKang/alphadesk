"""Alpaca WebSocket streaming for real-time quotes and minute bars.

Connects to Alpaca's SIP WebSocket feed (full NBBO, 100% of market)
and publishes quotes/trades/bars to Redis pub/sub for distribution
to frontend WebSocket clients.

SIP provides real-time consolidated data from all US exchanges.

Two independent streams are supervised here:

1. **Market data** (quotes + minute bars) via ``stream.data.alpaca.markets``.
   Tracked by ``_stream_task`` and ``_run_stream`` — see below.
2. **Trade updates** (fills / partial_fills / cancels / rejects) via
   ``paper-api.alpaca.markets/stream`` or the live-broker equivalent.
   Tracked by ``_trade_updates_task`` and published to Redis channel
   ``trade_updates`` (``core.redis.CHANNEL_TRADE_UPDATES``). Gated on the
   ``ALPACA_TRADE_UPDATES_ENABLED`` setting so it can be turned off without
   redeploying if the broker side misbehaves (persona-r P27/P43).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import websockets

from core.config import settings
from core.redis import cache_get, publish, redis_xadd_trade_update
from data.calendar import USMarketCalendar

logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")
# Shared calendar instance — memoises the schedule cache so repeated
# ``is_trading_day`` calls across the stream loop are cheap.
_CAL = USMarketCalendar()

_stream_task: asyncio.Task | None = None
_should_stop = False
# NOTE: _last_quotes / _last_published / _current_symbols are PER-WORKER
# module-level state. Only the worker that owns the Alpaca WebSocket
# connection (one per process) reads/writes these dicts, so per-worker state
# is correct for this module: other workers have no websocket and never
# populate these dicts. If the stream ever moved to a multi-consumer model
# these would need Redis backing.
_last_quotes: dict[str, dict] = {}  # track last bid/ask per symbol

# --- No throttle: SIP feed is real-time, publish every tick ---
_last_published: dict[str, float] = {}  # symbol -> last_price (for dedup only)

# Track when each symbol was last updated for the periodic sweep —
# long-session-audit-r4 P0 #3.
_last_quote_seen_at: dict[str, float] = {}

# --- Dynamic watchlist state ---
_current_symbols: set[str] = set()
MAX_SYMBOLS = 200

# Periodic sweep: drop entries for symbols not seen in this many seconds.
# Catches the case where Alpaca silently stops sending updates for a symbol
# without an explicit unsubscribe (long-session-audit-r4 P0 #3).
_STALE_QUOTE_SECONDS = 60 * 60 * 6  # 6 hours
_last_sweep_at: float = 0.0
_SWEEP_INTERVAL = 60 * 30  # run every 30 minutes


async def _maybe_publish(channel: str, symbol: str, price: float, data: dict) -> None:
    """Publish immediately. Only skip exact same price (dedup)."""
    last = _last_published.get(symbol)
    if last is not None and last == price:
        return  # Exact same price — no update needed
    _last_published[symbol] = price
    await publish(channel, data)

    try:
        from api.routes.trades import check_alerts_for_symbol
        await check_alerts_for_symbol(symbol, price)
    except Exception:
        logger.debug("price-alert check failed for %s", symbol, exc_info=True)


# Default symbols when Redis cache and trade ledger are empty
DEFAULT_WATCHLIST = [
    "AAPL", "NVDA", "TSLA", "SPY", "QQQ",
    "MSFT", "AMZN", "META", "AMD", "GOOGL",
]

# Always include core index ETFs for market context
CORE_INDICES = {"SPY", "QQQ", "DIA", "IWM", "VIXY"}

# Feed selection: SIP requires Alpaca Algo Trader Plus (paid) — paper accounts
# without it get HTTP 406 "connection limit exceeded" on subscribe (the SIP
# entitlement check). IEX is the free-tier feed and works on every account.
# Override via ALPACA_STREAM_FEED env var (values: "iex" | "sip"). Defaults
# to IEX so a fresh paper account streams cleanly out of the box.
import os as _os_for_feed
_ALPACA_STREAM_FEED = _os_for_feed.environ.get("ALPACA_STREAM_FEED", "iex").lower()
if _ALPACA_STREAM_FEED not in ("iex", "sip"):
    _ALPACA_STREAM_FEED = "iex"
ALPACA_WS_URL = f"wss://stream.data.alpaca.markets/v2/{_ALPACA_STREAM_FEED}"


async def get_dynamic_watchlist() -> list[str]:
    """Build a watchlist from Redis cache, open positions, and core indices.

    Sources (in order):
      1. Redis cache key "watchlist:symbols" (set by the frontend/API)
      2. Fallback to DEFAULT_WATCHLIST if Redis is empty
      3. Symbols with open positions in the trade ledger
      4. Core index ETFs (SPY, QQQ, DIA, IWM, VIXY)

    Caps at MAX_SYMBOLS (200).
    """
    symbols: set[str] = set()

    # 1) Try Redis cached watchlist
    try:
        cached = await cache_get("watchlist:symbols")
        if cached and isinstance(cached, list):
            symbols.update(
                s.upper().strip() for s in cached
                if isinstance(s, str) and s.strip()
            )
    except Exception:
        logger.debug("Could not read watchlist from Redis cache")

    # 2) Fallback to defaults if nothing from Redis
    if not symbols:
        symbols.update(DEFAULT_WATCHLIST)

    # 3) Add symbols from open positions in the trade ledger
    try:
        from data.ingestion.trade_ledger import TradeLedger
        ledger = TradeLedger()
        held = ledger.get_held_symbols()
        symbols.update(held)
    except Exception:
        logger.debug("Could not read open positions from trade ledger")

    # 4) Always include core indices
    symbols.update(CORE_INDICES)

    # 5) Cap at MAX_SYMBOLS
    result = sorted(symbols)[:MAX_SYMBOLS]
    return result


def _is_market_hours() -> bool:
    """Check if we're within extended market hours on a real trading day.

    Holiday-aware via :class:`USMarketCalendar` — on Christmas Day, MLK
    Day, Good Friday, etc. the stream will skip the (expensive) websocket
    connect/subscribe dance rather than wake up every 4 AM ET to a
    guaranteed-empty tape. Extended session is 04:00–20:00 ET on trading
    days; half-day closes only affect the regular session, so extended
    hours around them still count. See edge-cases-audit-r3.md P0 #4.

    NOTE: Wave 9's ``_supervised_run`` wrapper relies on ``_run_stream``
    checking this before each connect. We preserve that contract — the
    function is still a cheap, side-effect-free bool.
    """
    now = datetime.now(_ET)
    if not _CAL.is_trading_day(now.date()):
        return False
    return 4 <= now.hour < 20


async def _update_subscriptions(ws, new_symbols: set[str]) -> None:
    """Subscribe/unsubscribe to match the new symbol set.

    On unsubscribe we drop the symbol from ``_last_quotes``,
    ``_last_published``, and ``_last_quote_seen_at`` so those dicts don't
    grow unbounded as the watchlist churns over a long session
    (long-session-audit-r4 P0 #3).
    """
    global _current_symbols

    to_add = new_symbols - _current_symbols
    to_remove = _current_symbols - new_symbols

    if to_remove:
        await ws.send(json.dumps({
            "action": "unsubscribe",
            "quotes": list(to_remove),
            "trades": list(to_remove),
            "bars": list(to_remove),
        }))
        unsub_resp = await ws.recv()
        logger.info(
            "Alpaca stream unsubscribed %d symbols: %s",
            len(to_remove), str(unsub_resp)[:100],
        )
        # Evict per-symbol state so we don't leak memory across watchlist
        # churn over multi-day sessions.
        for sym in to_remove:
            _last_quotes.pop(sym, None)
            _last_published.pop(sym, None)
            _last_quote_seen_at.pop(sym, None)

    if to_add:
        await ws.send(json.dumps({
            "action": "subscribe",
            "quotes": list(to_add),
            "trades": list(to_add),
            "bars": list(to_add),
        }))
        sub_resp = await ws.recv()
        logger.info(
            "Alpaca stream subscribed %d new symbols: %s",
            len(to_add), str(sub_resp)[:100],
        )

    _current_symbols = new_symbols.copy()


def _sweep_stale_quotes() -> int:
    """Drop in-memory quote state for symbols we haven't seen recently.

    Defence-in-depth against the case where Alpaca quietly stops emitting
    updates for a symbol without an unsubscribe round-trip (e.g. listing
    halts). Returns the number of entries removed.
    Long-session-audit-r4 P0 #3 / P2 #13.
    """
    global _last_sweep_at
    now = time.monotonic()
    if now - _last_sweep_at < _SWEEP_INTERVAL:
        return 0
    _last_sweep_at = now

    cutoff = now - _STALE_QUOTE_SECONDS
    stale = [
        sym for sym, ts in list(_last_quote_seen_at.items())
        if ts < cutoff and sym not in _current_symbols
    ]
    for sym in stale:
        _last_quotes.pop(sym, None)
        _last_published.pop(sym, None)
        _last_quote_seen_at.pop(sym, None)
    if stale:
        logger.info(
            "alpaca_stream: swept %d stale quote entries (older than %ds)",
            len(stale), _STALE_QUOTE_SECONDS,
        )
    return len(stale)


async def _watchlist_refresh_loop(ws) -> None:
    """Re-evaluate the watchlist every 5 minutes and update subscriptions.

    Also runs the periodic stale-quote sweep so per-worker dicts don't grow
    forever during multi-day sessions (long-session-audit-r4 P0 #3).
    """
    while not _should_stop:
        await asyncio.sleep(300)  # 5 minutes
        if _should_stop:
            break
        try:
            new_symbols = set(await get_dynamic_watchlist())
            if new_symbols != _current_symbols:
                logger.info(
                    "Watchlist changed: %d -> %d symbols (added %d, removed %d)",
                    len(_current_symbols),
                    len(new_symbols),
                    len(new_symbols - _current_symbols),
                    len(_current_symbols - new_symbols),
                )
                await _update_subscriptions(ws, new_symbols)
            # Defence-in-depth eviction sweep — internal interval guard.
            _sweep_stale_quotes()
        except Exception:
            logger.warning("Watchlist refresh failed", exc_info=True)


async def _run_stream() -> None:
    global _should_stop, _current_symbols
    backoff = 5  # initial backoff seconds

    while not _should_stop:
        # Don't spam reconnects outside market hours
        if not _is_market_hours():
            logger.debug("Alpaca stream: outside market hours, sleeping 5m")
            await asyncio.sleep(300)
            continue

        refresh_task = None
        try:
            async with websockets.connect(ALPACA_WS_URL) as ws:
                # Authenticate
                await ws.send(json.dumps({
                    "action": "auth",
                    "key": settings.ALPACA_API_KEY.get_secret_value(),
                    "secret": settings.ALPACA_SECRET_KEY.get_secret_value(),
                }))
                auth_resp = await ws.recv()
                logger.info("Alpaca SIP stream auth: %s", str(auth_resp)[:100])

                # Check for auth errors
                try:
                    auth_msgs = json.loads(auth_resp)
                    for m in (auth_msgs if isinstance(auth_msgs, list) else [auth_msgs]):
                        if m.get("T") == "error":
                            logger.error(
                                "Alpaca auth failed: %s — retrying in 60s",
                                m.get("msg", "unknown"),
                            )
                            await asyncio.sleep(60)
                            raise ConnectionError("Alpaca auth failed")
                except ConnectionError as e:
                    logger.error("Auth/connection error: %s — will retry with backoff", e)
                    raise  # Let the outer except handler apply backoff and retry
                except Exception:
                    logger.warning(
                        "Failed to parse Alpaca auth response — will continue to subscribe",
                        exc_info=True,
                    )

                # Build dynamic watchlist and do initial subscription
                watchlist = await get_dynamic_watchlist()
                _current_symbols = set()  # reset so _update_subscriptions subscribes all
                await _update_subscriptions(ws, set(watchlist))
                logger.info(
                    "Alpaca SIP stream: subscribed to %d symbols (quotes+trades+bars)",
                    len(watchlist),
                )
                backoff = 5  # reset backoff on successful connection

                # Start background watchlist refresh loop
                refresh_task = asyncio.create_task(_watchlist_refresh_loop(ws))

                # Process incoming messages
                async for raw in ws:
                    if _should_stop:
                        break

                    try:
                        msgs = json.loads(raw)
                    except Exception:
                        logger.debug("Alpaca stream: malformed JSON frame dropped", exc_info=True)
                        continue

                    if not isinstance(msgs, list):
                        msgs = [msgs]

                    for msg in msgs:
                        msg_type = msg.get("T")

                        if msg_type == "q":
                            # Quote message — update bid/ask.
                            # SIP provides real-time NBBO so quotes are accurate.
                            sym = msg["S"]
                            bid = msg.get("bp", 0)
                            ask = msg.get("ap", 0)
                            _last_quotes[sym] = {"bid": bid, "ask": ask}
                            _last_quote_seen_at[sym] = time.monotonic()
                            # Only publish bid/ask updates if we have a last trade price
                            # The "last" price is only updated by trade messages below
                            last_trade = _last_quotes.get(sym, {}).get("last_trade", 0)
                            if last_trade > 0:
                                await _maybe_publish("quotes", sym, last_trade, {
                                    "symbol": sym,
                                    "bid": bid,
                                    "ask": ask,
                                    "last": last_trade,
                                    "volume": (msg.get("bs", 0) + msg.get("as", 0)),
                                    "timestamp": msg.get("t", ""),
                                })

                        elif msg_type == "t":
                            # Trade message — this is the real price (actual executed trade)
                            sym = msg["S"]
                            trade_price = msg.get("p", 0)
                            prev = _last_quotes.get(sym, {})
                            prev["last_trade"] = trade_price  # store for quote messages
                            _last_quotes[sym] = prev
                            _last_quote_seen_at[sym] = time.monotonic()
                            await _maybe_publish("quotes", sym, trade_price, {
                                "symbol": sym,
                                "bid": prev.get("bid", 0),
                                "ask": prev.get("ask", 0),
                                "last": trade_price,
                                "volume": msg.get("s", 0),
                                "timestamp": msg.get("t", ""),
                            })

                        elif msg_type == "b":
                            # Minute bar — publish to separate "bars" channel
                            # for real-time chart updates without REST polling
                            sym = msg["S"]
                            bar_data = {
                                "symbol": sym,
                                "open": msg.get("o", 0),
                                "high": msg.get("h", 0),
                                "low": msg.get("l", 0),
                                "close": msg.get("c", 0),
                                "volume": msg.get("v", 0),
                                "vwap": msg.get("vw", 0),
                                "timestamp": msg.get("t", ""),
                                "trade_count": msg.get("n", 0),
                            }
                            await publish("bars", bar_data)

        except asyncio.CancelledError:
            break
        except Exception:
            if _should_stop:
                break
            logger.error(
                "Alpaca SIP stream error (reconnecting in %ds)", backoff, exc_info=True,
            )
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 300)  # exponential backoff, max 5 minutes
        finally:
            if refresh_task and not refresh_task.done():
                refresh_task.cancel()
                try:
                    await refresh_task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.debug(
                        "alpaca_stream: refresh_task raised during cancel",
                        exc_info=True,
                    )

    logger.info("Alpaca SIP stream loop exited")


async def _supervised_run() -> None:
    """Supervisor wrapper for ``_run_stream``.

    ``_run_stream`` contains an internal reconnect loop, but if it ever exits
    unexpectedly (e.g. an exception raised outside its try/except envelope, or
    a bug in the inner loop logic that lets the ``while`` terminate without
    ``_should_stop`` being set), the entire quote feed would stop until the
    process restart. This wrapper guarantees that as long as ``_should_stop``
    is False, the stream task will be respawned with exponential backoff.
    """
    global _should_stop

    backoff = 1
    while not _should_stop:
        try:
            await _run_stream()
            if _should_stop:
                break
            # _run_stream returned cleanly without a stop request — that's
            # unexpected. Treat it as a crash and retry with backoff.
            logger.warning(
                "alpaca_stream: _run_stream exited without _should_stop set — supervising a restart in %ds",
                backoff,
            )
        except asyncio.CancelledError:
            # Intentional cancellation — propagate so stop_alpaca_stream's
            # awaited cancel() sees a clean exit.
            raise
        except Exception:
            logger.error(
                "alpaca_stream: _run_stream crashed — reconnecting in %ds",
                backoff,
                exc_info=True,
            )
        if _should_stop:
            break
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)
        # Reset backoff on the next successful long-running connection —
        # measured indirectly by _run_stream's own backoff reset on connect.
    logger.info("alpaca_stream supervisor exited")


# ─── Alpaca trade_updates stream (fills / cancels / rejects) ─────────
#
# Second independent WebSocket connection to Alpaca's broker API. While the
# SIP market-data feed above only carries quotes / trades / bars, the broker
# stream carries per-account lifecycle events for each submitted order:
#
#   * ``fill``          — full fill; ``order.status`` == ``"filled"``
#   * ``partial_fill``  — partial, more to come; ``order.status`` == ``"partially_filled"``
#   * ``canceled``      — order canceled by user / market close
#   * ``rejected``      — broker rejected the order (e.g. insufficient BP)
#   * ``new``, ``done_for_day``, ``replaced``, ``expired``, ``suspended`` …
#
# We normalise the event name onto the Redis payload and publish to channel
# ``trade_updates``; the frontend subscribes in ``useNotifications`` and raises
# a toast. The stream auth differs from the market-data stream:
#
#   1. Connect to ``wss://paper-api.alpaca.markets/stream`` (or the live URL).
#   2. Send ``{"action": "authenticate", "data": {"key_id": "…", "secret_key": "…"}}``.
#   3. On ``authorization`` success send ``{"action": "listen", "data": {"streams": ["trade_updates"]}}``.
#
# Payload format is also different — the broker stream sends
# ``{"stream": "trade_updates", "data": {"event": "fill", "order": {...}}}``.
# See https://alpaca.markets/docs/api-references/broker-api/trading/streaming-entity-events/

_trade_updates_task: asyncio.Task | None = None

# URL is derived from ALPACA_BASE_URL so paper vs live is configurable. We
# keep a hard default to the paper endpoint because the rest of the codebase
# defaults there too (core/config.py:54) — swapping to live-trading requires
# an explicit env override.
_TRADE_UPDATES_WS_URL_DEFAULT = "wss://paper-api.alpaca.markets/stream"


def _trade_updates_ws_url() -> str:
    base = (settings.ALPACA_BASE_URL or "").rstrip("/")
    if not base:
        return _TRADE_UPDATES_WS_URL_DEFAULT
    # Convert the https REST base into a wss streaming endpoint.
    # https://paper-api.alpaca.markets -> wss://paper-api.alpaca.markets/stream
    if base.startswith("https://"):
        return "wss://" + base[len("https://"):] + "/stream"
    if base.startswith("http://"):
        return "ws://" + base[len("http://"):] + "/stream"
    return _TRADE_UPDATES_WS_URL_DEFAULT


async def _run_trade_updates_stream() -> None:
    """Subscribe to Alpaca's broker trade_updates stream and fan out to Redis.

    Publishes one event per Alpaca message to ``CHANNEL_TRADE_UPDATES``.
    The payload shape is:

        {
            "event": "fill" | "partial_fill" | "canceled" | "rejected" | ...,
            "symbol": "AAPL",
            "side": "buy" | "sell",
            "qty": 100,
            "filled_qty": 100,
            "fill_price": 182.34,
            "order_id": "...",
            "status": "filled" | ...,
            "reject_reason": "...",   # rejected-only
            "timestamp": "2026-04-18T13:30:00Z",
            "raw": { full Alpaca payload }
        }

    Runs an internal reconnect loop with exponential backoff. The outer
    supervisor (``_supervised_trade_updates_run``) guarantees respawn on
    any unexpected exit.
    """
    global _should_stop
    backoff = 5
    url = _trade_updates_ws_url()

    while not _should_stop:
        try:
            async with websockets.connect(url) as ws:
                # 1. Authenticate
                await ws.send(json.dumps({
                    "action": "authenticate",
                    "data": {
                        "key_id": settings.ALPACA_API_KEY.get_secret_value(),
                        "secret_key": settings.ALPACA_SECRET_KEY.get_secret_value(),
                    },
                }))
                auth_resp = await ws.recv()
                logger.info("Alpaca trade_updates auth: %s", str(auth_resp)[:200])
                try:
                    auth_msg = json.loads(auth_resp)
                    status = (auth_msg.get("data") or {}).get("status") or auth_msg.get("status")
                    if status and str(status).lower() not in ("authorized", "success"):
                        logger.error(
                            "Alpaca trade_updates auth failed (status=%s) — retry in 60s",
                            status,
                        )
                        await asyncio.sleep(60)
                        raise ConnectionError("trade_updates auth failed")
                except ConnectionError:
                    raise
                except Exception:
                    logger.warning(
                        "Failed to parse trade_updates auth response — continuing to listen",
                        exc_info=True,
                    )

                # 2. Listen for trade_updates
                await ws.send(json.dumps({
                    "action": "listen",
                    "data": {"streams": ["trade_updates"]},
                }))
                listen_resp = await ws.recv()
                logger.info(
                    "Alpaca trade_updates listen: %s", str(listen_resp)[:200],
                )
                backoff = 5  # reset on successful connect

                # 3. Fan out messages
                async for raw in ws:
                    if _should_stop:
                        break
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        logger.debug(
                            "trade_updates: malformed JSON frame dropped",
                            exc_info=True,
                        )
                        continue

                    stream_name = msg.get("stream")
                    if stream_name != "trade_updates":
                        # Initial listen confirmation or keepalive — ignore.
                        continue

                    data = msg.get("data") or {}
                    event = str(data.get("event", "")).lower()
                    order = data.get("order") or {}

                    payload = {
                        "event": event,
                        "symbol": order.get("symbol"),
                        "side": order.get("side"),
                        "qty": _coerce_float(order.get("qty")),
                        "filled_qty": _coerce_float(order.get("filled_qty")),
                        "fill_price": _coerce_float(
                            data.get("price") or order.get("filled_avg_price"),
                        ),
                        "order_id": order.get("id"),
                        "status": order.get("status"),
                        "reject_reason": order.get("reject_reason")
                            or data.get("reject_reason")
                            or data.get("message"),
                        "timestamp": data.get("timestamp") or order.get("updated_at"),
                        "raw": data,
                    }
                    # Wave C (persona 74 P0 #1): switch trade_updates from
                    # fire-and-forget pub/sub to a durable Redis stream so
                    # clients that drop during a fill can replay on reconnect.
                    # We keep the pub/sub publish() in parallel for backwards
                    # compatibility with existing UI toast consumers until the
                    # frontend is migrated to the stream-based subscription.
                    # Account-scoping: Alpaca's broker WS is single-tenant per
                    # API key, so every fill on this stream belongs to the
                    # same user. We use the account_id from the raw payload
                    # when present, else fall back to a tenant-wide "default"
                    # stream (the overwhelming majority of deployments).
                    user_id = (
                        order.get("account_id")
                        or data.get("account_id")
                        or "default"
                    )
                    stream_id: str | None = None
                    try:
                        stream_id = await redis_xadd_trade_update(user_id, payload)
                    except Exception:
                        # Stream outage should not crash the stream — log and
                        # keep listening. Pub/sub below will still notify
                        # connected clients even if durable storage fails.
                        logger.warning(
                            "trade_updates: xadd failed for %s",
                            payload.get("order_id"),
                            exc_info=True,
                        )
                    else:
                        # Wave 3K Fix 5 (persona-87 P2): emit a
                        # structured success record so the forensic
                        # timeline shows every fill that landed in the
                        # durable stream (not just failures). Lets oncall
                        # grep for ``event=trade_update_xadd`` and
                        # reconstruct the replay cursor without tailing
                        # Redis directly.
                        logger.info(
                            "trade_update_xadd",
                            extra={
                                "event": "trade_update_xadd",
                                "stream_id": stream_id,
                                "order_id": payload.get("order_id"),
                                "alpaca_event": payload.get("event"),
                                "user_id": user_id,
                                "symbol": payload.get("symbol"),
                            },
                        )
                    # Mirror the stream ID onto the pub/sub payload so
                    # connected clients can record the cursor without having
                    # to round-trip an XREAD. Clients that reconnect then
                    # replay starting at this ID.
                    try:
                        live_payload = {**payload, "_user_id": user_id}
                        if stream_id is not None:
                            live_payload["_id"] = stream_id
                        await publish("trade_updates", live_payload)
                    except Exception:
                        # Redis outages should not crash the stream — log and
                        # keep listening so we don't lose the next fill.
                        logger.warning(
                            "trade_updates: publish failed for %s",
                            payload.get("order_id"),
                            exc_info=True,
                        )

        except asyncio.CancelledError:
            break
        except Exception:
            if _should_stop:
                break
            logger.error(
                "Alpaca trade_updates stream error (reconnect in %ds)",
                backoff,
                exc_info=True,
            )
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 300)

    logger.info("Alpaca trade_updates loop exited")


def _coerce_float(v) -> float | None:
    """Parse Alpaca's string-encoded numerics into floats, else None.

    The broker API returns ``qty`` / ``filled_qty`` / ``filled_avg_price`` as
    strings, not numbers. Frontends expect numbers in the toast detail, so
    we coerce here and leave ``None`` passthrough for missing fields.
    """
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


async def _supervised_trade_updates_run() -> None:
    """Supervisor wrapper mirroring ``_supervised_run`` for trade_updates."""
    global _should_stop
    backoff = 1
    while not _should_stop:
        try:
            await _run_trade_updates_stream()
            if _should_stop:
                break
            logger.warning(
                "trade_updates: stream exited without _should_stop — respawn in %ds",
                backoff,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.error(
                "trade_updates: supervised run crashed — respawn in %ds",
                backoff,
                exc_info=True,
            )
        if _should_stop:
            break
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)
    logger.info("trade_updates supervisor exited")


async def start_alpaca_stream() -> None:
    """Start the Alpaca WebSocket stream(s) as background tasks.

    Starts two independent streams:
      1. SIP market-data stream (quotes / bars) — always on when the API key
         is configured.
      2. Broker trade_updates stream (fills / cancels / rejects) — gated on
         ``ALPACA_TRADE_UPDATES_ENABLED`` (defaults to True) so we can disable
         it without a redeploy if the broker side misbehaves.
    """
    global _stream_task, _trade_updates_task, _should_stop

    api_key = settings.ALPACA_API_KEY.get_secret_value()
    if not api_key:
        logger.info("Alpaca stream: no API key configured, skipping")
        return

    _should_stop = False
    # Wrap in supervisor so the task cannot silently die on an uncaught
    # exception — it will always attempt to reconnect until _should_stop.
    _stream_task = asyncio.create_task(_supervised_run())
    watchlist = await get_dynamic_watchlist()
    logger.info("Alpaca SIP stream started for %d symbols", len(watchlist))

    # Trade updates stream — feature-flagged. Default ON.
    trade_updates_enabled = bool(
        getattr(settings, "ALPACA_TRADE_UPDATES_ENABLED", True),
    )
    if trade_updates_enabled:
        _trade_updates_task = asyncio.create_task(_supervised_trade_updates_run())
        logger.info(
            "Alpaca trade_updates stream started at %s",
            _trade_updates_ws_url(),
        )
    else:
        logger.info(
            "Alpaca trade_updates stream disabled via ALPACA_TRADE_UPDATES_ENABLED",
        )


async def stop_alpaca_stream() -> None:
    """Stop the Alpaca WebSocket stream(s) gracefully."""
    global _should_stop, _stream_task, _trade_updates_task

    _should_stop = True
    if _stream_task:
        _stream_task.cancel()
        try:
            await _stream_task
        except (asyncio.CancelledError, Exception):
            pass
        _stream_task = None
    if _trade_updates_task:
        _trade_updates_task.cancel()
        try:
            await _trade_updates_task
        except (asyncio.CancelledError, Exception):
            pass
        _trade_updates_task = None
    logger.info("Alpaca SIP + trade_updates streams stopped")
