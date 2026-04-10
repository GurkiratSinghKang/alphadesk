"""Alpaca WebSocket streaming for real-time quotes.

Connects to Alpaca's IEX WebSocket feed and publishes quotes/trades
to Redis pub/sub for distribution to frontend WebSocket clients.

Note: IEX data is 15-min delayed on free accounts; real-time with
paper trading subscriptions.
"""
from __future__ import annotations

import asyncio
import json
import logging

import websockets

from core.config import settings
from core.redis import publish

logger = logging.getLogger(__name__)

_stream_task: asyncio.Task | None = None
_should_stop = False
_last_quotes: dict[str, dict] = {}  # track last bid/ask per symbol

WATCHLIST = [
    "AAPL", "NVDA", "TSLA", "SPY", "QQQ",
    "MSFT", "AMZN", "META", "AMD", "GOOGL",
]

ALPACA_WS_URL = "wss://stream.data.alpaca.markets/v2/iex"


async def _run_stream() -> None:
    global _should_stop

    while not _should_stop:
        try:
            async with websockets.connect(ALPACA_WS_URL) as ws:
                # Authenticate
                await ws.send(json.dumps({
                    "action": "auth",
                    "key": settings.ALPACA_API_KEY.get_secret_value(),
                    "secret": settings.ALPACA_SECRET_KEY.get_secret_value(),
                }))
                auth_resp = await ws.recv()
                logger.info("Alpaca stream auth: %s", str(auth_resp)[:100])

                # Check for auth errors
                try:
                    auth_msgs = json.loads(auth_resp)
                    for m in (auth_msgs if isinstance(auth_msgs, list) else [auth_msgs]):
                        if m.get("T") == "error":
                            logger.error("Alpaca auth failed: %s — retrying in 60s", m.get("msg", "unknown"))
                            await asyncio.sleep(60)
                            raise ConnectionError("Alpaca auth failed")
                except ConnectionError:
                    break  # exits async-with block, outer while loop reconnects
                except Exception:
                    pass

                # Subscribe to quotes and trades
                await ws.send(json.dumps({
                    "action": "subscribe",
                    "quotes": WATCHLIST,
                    "trades": WATCHLIST,
                }))
                sub_resp = await ws.recv()
                logger.info("Alpaca stream subscribed: %s", str(sub_resp)[:100])

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
                            # Quote message
                            sym = msg["S"]
                            bid = msg.get("bp", 0)
                            ask = msg.get("ap", 0)
                            mid = (bid + ask) / 2 if bid and ask else bid or ask
                            _last_quotes[sym] = {"bid": bid, "ask": ask}
                            await publish("quotes", {
                                "symbol": sym,
                                "bid": bid,
                                "ask": ask,
                                "last": round(mid, 4),
                                "volume": (msg.get("bs", 0) + msg.get("as", 0)),
                                "timestamp": msg.get("t", ""),
                            })

                        elif msg_type == "t":
                            # Trade message — include last known bid/ask
                            sym = msg["S"]
                            prev = _last_quotes.get(sym, {})
                            await publish("quotes", {
                                "symbol": sym,
                                "bid": prev.get("bid", 0),
                                "ask": prev.get("ask", 0),
                                "last": msg.get("p", 0),
                                "volume": msg.get("s", 0),
                                "timestamp": msg.get("t", ""),
                            })

        except asyncio.CancelledError:
            break
        except Exception as e:
            if _should_stop:
                break
            logger.error("Alpaca stream error: %s (reconnecting in 5s)", e)
            await asyncio.sleep(5)

    logger.info("Alpaca stream loop exited")


async def start_alpaca_stream() -> None:
    """Start the Alpaca WebSocket stream as a background task."""
    global _stream_task, _should_stop

    api_key = settings.ALPACA_API_KEY.get_secret_value()
    if not api_key:
        logger.info("Alpaca stream: no API key configured, skipping")
        return

    _should_stop = False
    _stream_task = asyncio.create_task(_run_stream())
    logger.info("Alpaca stream started for %d symbols", len(WATCHLIST))


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
    logger.info("Alpaca stream stopped")
