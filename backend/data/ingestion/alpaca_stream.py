"""Alpaca WebSocket streaming for real-time quotes and minute bars.

Connects to Alpaca's SIP WebSocket feed (full NBBO, 100% of market)
and publishes quotes/trades/bars to Redis pub/sub for distribution
to frontend WebSocket clients.

SIP provides real-time consolidated data from all US exchanges.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

import websockets

from core.config import settings
from core.redis import cache_get, publish

logger = logging.getLogger(__name__)

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

# --- Dynamic watchlist state ---
_current_symbols: set[str] = set()
MAX_SYMBOLS = 200


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
        pass


# Default symbols when Redis cache and trade ledger are empty
DEFAULT_WATCHLIST = [
    "AAPL", "NVDA", "TSLA", "SPY", "QQQ",
    "MSFT", "AMZN", "META", "AMD", "GOOGL",
]

# Always include core index ETFs for market context
CORE_INDICES = {"SPY", "QQQ", "DIA", "IWM", "VIXY"}

ALPACA_WS_URL = "wss://stream.data.alpaca.markets/v2/sip"


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
    """Check if we're within extended market hours (4 AM - 8 PM ET)."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    now = datetime.now(et)
    if now.weekday() >= 5:
        return False
    return 4 <= now.hour < 20


async def _update_subscriptions(ws, new_symbols: set[str]) -> None:
    """Subscribe/unsubscribe to match the new symbol set."""
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


async def _watchlist_refresh_loop(ws) -> None:
    """Re-evaluate the watchlist every 5 minutes and update subscriptions."""
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
        except Exception as e:
            logger.warning("Watchlist refresh failed: %s", e)


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
                    pass

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
        except Exception as e:
            if _should_stop:
                break
            logger.error("Alpaca SIP stream error: %s (reconnecting in %ds)", e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 300)  # exponential backoff, max 5 minutes
        finally:
            if refresh_task and not refresh_task.done():
                refresh_task.cancel()
                try:
                    await refresh_task
                except (asyncio.CancelledError, Exception):
                    pass

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
        except Exception as e:
            logger.error(
                "alpaca_stream: _run_stream crashed: %s — reconnecting in %ds",
                e,
                backoff,
            )
        if _should_stop:
            break
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60)
        # Reset backoff on the next successful long-running connection —
        # measured indirectly by _run_stream's own backoff reset on connect.
    logger.info("alpaca_stream supervisor exited")


async def start_alpaca_stream() -> None:
    """Start the Alpaca WebSocket stream as a background task."""
    global _stream_task, _should_stop

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


async def stop_alpaca_stream() -> None:
    """Stop the Alpaca WebSocket stream gracefully."""
    global _should_stop, _stream_task

    _should_stop = True
    if _stream_task:
        _stream_task.cancel()
        try:
            await _stream_task
        except (asyncio.CancelledError, Exception):
            pass
        _stream_task = None
    logger.info("Alpaca SIP stream stopped")
