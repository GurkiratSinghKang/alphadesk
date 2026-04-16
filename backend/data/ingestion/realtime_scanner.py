"""Real-Time Signal Scanner — monitors live prices for pattern-based strategies.

Subscribes to the Redis quote stream (fed by Alpaca WebSocket) and evaluates
signals on every price tick for strategies that depend on chart patterns:

    - ORB:          Watches for price breaking above/below opening range
    - VWAP:         Monitors for price bouncing off or breaking VWAP
    - VCP Breakout: Detects volume surges at pre-identified pivot levels
    - KAMA Breakout: Catches Keltner Channel breakouts in real-time
    - Pairs Trading: Monitors spread z-score crossings every 30 seconds

Architecture:
    Alpaca WebSocket → Redis pub/sub "quotes" → this scanner → trade execution

The scanner maintains a "setup watchlist" of pending signals computed
from the daily/window scans. On each tick, it checks if the current price
triggers any pending setup. When triggered, it executes via the master agent.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

logger = logging.getLogger("alphadesk.realtime_scanner")

ET = ZoneInfo("America/New_York")

_scanner_task: asyncio.Task | None = None
_should_stop = False

# ─── Pending Setups ──────────────────────────────────────────
# Populated by daily/window scans, consumed by the real-time scanner.
# Key: symbol, Value: list of pending setups with trigger conditions.

_pending_setups: dict[str, list[dict[str, Any]]] = {}
_pairs_setups: list[dict[str, Any]] = []  # pairs are keyed by pair, not symbol

# Last z-score check time for pairs (throttle to every 30s)
_last_pairs_check: float = 0
PAIRS_CHECK_INTERVAL = 30.0  # seconds

# Last VWAP/KAMA bar fetch (throttle to every 60s)
_last_bar_fetch: float = 0
BAR_FETCH_INTERVAL = 60.0


def register_setup(setup: dict[str, Any]) -> None:
    """Register a pending setup from a strategy scan.

    Setup dict must contain:
        strategy: str — strategy name
        symbol: str — ticker (or "A/B" for pairs)
        type: str — "orb_breakout", "vwap_bounce", "vcp_pivot", "kama_breakout", "pairs_zscore"
        trigger_price: float — price level that triggers entry
        direction: str — "long" or "short"
        stop_loss: float
        take_profit: float
        conviction: int
        rationale: str
        expires: str — ISO timestamp when setup expires (e.g., end of day)
    """
    sym = setup.get("symbol", "")
    strategy = setup.get("type", "")

    if strategy == "pairs_zscore":
        _pairs_setups.append(setup)
        logger.info("Registered pairs setup: %s z-target=%.2f", sym, setup.get("trigger_zscore", 0))
    else:
        if sym not in _pending_setups:
            _pending_setups[sym] = []
        _pending_setups[sym].append(setup)
        logger.info(
            "Registered %s setup: %s trigger=$%.2f %s",
            strategy, sym, setup.get("trigger_price", 0), setup.get("direction", ""),
        )


def clear_expired_setups() -> None:
    """Remove setups that have expired (e.g., end of day for intraday strategies)."""
    now = datetime.now(ET).isoformat()
    for sym in list(_pending_setups):
        _pending_setups[sym] = [
            s for s in _pending_setups[sym]
            if s.get("expires", "9999") > now
        ]
        if not _pending_setups[sym]:
            del _pending_setups[sym]

    global _pairs_setups
    _pairs_setups = [s for s in _pairs_setups if s.get("expires", "9999") > now]


def get_active_setups() -> dict[str, Any]:
    """Return current pending setups for API/dashboard display."""
    return {
        "symbol_setups": {sym: len(setups) for sym, setups in _pending_setups.items()},
        "pairs_setups": len(_pairs_setups),
        "total": sum(len(s) for s in _pending_setups.values()) + len(_pairs_setups),
    }


# ─── Signal Evaluation ──────────────────────────────────────

async def _evaluate_tick(symbol: str, price: float, volume: int, bid: float, ask: float) -> None:
    """Called on every price tick. Check if any pending setup triggers."""
    if symbol not in _pending_setups:
        return

    triggered: list[dict[str, Any]] = []
    remaining: list[dict[str, Any]] = []

    for setup in _pending_setups[symbol]:
        setup_type = setup.get("type", "")
        trigger = setup.get("trigger_price", 0)
        direction = setup.get("direction", "long")

        fired = False

        if setup_type == "orb_breakout":
            # ORB: price breaks above OR high (long) or below OR low (short)
            if direction == "long" and price > trigger:
                # Confirm with volume if available
                min_vol = setup.get("min_volume", 0)
                if min_vol == 0 or volume >= min_vol:
                    fired = True
            elif direction == "short" and price < trigger:
                fired = True

        elif setup_type == "vwap_bounce":
            # VWAP: price bounced off VWAP (within threshold and now moving away)
            vwap = setup.get("vwap", 0)
            threshold_pct = setup.get("threshold_pct", 0.3)
            if vwap > 0:
                dist = abs(price - vwap) / vwap * 100
                if direction == "long" and price > vwap and dist < threshold_pct:
                    fired = True

        elif setup_type == "vcp_pivot":
            # VCP: price breaks above pivot on volume
            if direction == "long" and price > trigger:
                min_vol = setup.get("min_volume", 0)
                if min_vol == 0 or volume >= min_vol:
                    fired = True

        elif setup_type == "kama_breakout":
            # KAMA: price breaks above Keltner upper band
            if direction == "long" and price > trigger:
                fired = True

        if fired:
            setup["fill_price"] = price
            setup["fill_time"] = datetime.now(ET).isoformat()
            triggered.append(setup)
            logger.info(
                "TRIGGERED %s: %s @ $%.2f (trigger=$%.2f)",
                setup_type, symbol, price, trigger,
            )
        else:
            remaining.append(setup)

    _pending_setups[symbol] = remaining
    if not _pending_setups[symbol]:
        del _pending_setups[symbol]

    # Execute triggered setups
    for setup in triggered:
        await _execute_triggered_setup(setup)


async def _check_pairs_zscore() -> None:
    """Periodically check pairs z-scores (every 30s, not per-tick)."""
    global _last_pairs_check, _pairs_setups
    now = time.monotonic()
    if now - _last_pairs_check < PAIRS_CHECK_INTERVAL:
        return
    _last_pairs_check = now

    if not _pairs_setups:
        return

    # Fetch latest prices for pair components
    try:
        import httpx
        from core.config import settings

        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }

        triggered = []
        remaining = []

        for setup in _pairs_setups:
            sym_a = setup.get("sym_a", "")
            sym_b = setup.get("sym_b", "")
            hedge_ratio = setup.get("hedge_ratio", 1.0)
            entry_z = setup.get("trigger_zscore", 2.0)
            spread_mean = setup.get("spread_mean", 0)
            spread_std = setup.get("spread_std", 1)

            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    resp_a = await client.get(
                        f"https://data.alpaca.markets/v2/stocks/{sym_a}/trades/latest",
                        headers=headers,
                    )
                    resp_b = await client.get(
                        f"https://data.alpaca.markets/v2/stocks/{sym_b}/trades/latest",
                        headers=headers,
                    )

                    price_a = resp_a.json().get("trade", {}).get("p", 0) if resp_a.status_code == 200 else 0
                    price_b = resp_b.json().get("trade", {}).get("p", 0) if resp_b.status_code == 200 else 0

                if price_a > 0 and price_b > 0:
                    spread = price_a - hedge_ratio * price_b
                    zscore = (spread - spread_mean) / spread_std if spread_std > 0 else 0

                    if abs(zscore) >= entry_z:
                        setup["current_zscore"] = zscore
                        setup["fill_time"] = datetime.now(ET).isoformat()
                        triggered.append(setup)
                        logger.info(
                            "PAIRS TRIGGERED: %s/%s z=%.3f (target=%.1f)",
                            sym_a, sym_b, zscore, entry_z,
                        )
                    else:
                        remaining.append(setup)
                else:
                    remaining.append(setup)
            except Exception as e:
                logger.debug("Pairs price fetch error for %s/%s: %s", sym_a, sym_b, e)
                remaining.append(setup)

        _pairs_setups = remaining

        for setup in triggered:
            await _execute_triggered_setup(setup)

    except Exception as e:
        logger.error("Pairs z-score check error: %s", e)


async def _execute_triggered_setup(setup: dict[str, Any]) -> None:
    """Execute a triggered setup by placing a trade through the pipeline."""
    try:
        from data.ingestion.trade_ledger import TradeLedger
        from data.ingestion.master_agent import MasterAgent

        strategy = setup.get("strategy", "unknown")
        symbol = setup.get("symbol", "")
        price = setup.get("fill_price", setup.get("trigger_price", 0))
        shares = setup.get("shares", 0)
        conviction = setup.get("conviction", 60)
        stop_loss = setup.get("stop_loss", round(price * 0.95, 2))
        take_profit = setup.get("take_profit", round(price * 1.10, 2))
        rationale = setup.get("rationale", f"Real-time {setup.get('type', '')} trigger")

        if shares < 1 or price <= 0:
            logger.warning("Skipping setup with invalid shares=%d or price=%.2f", shares, price)
            return

        logger.info(
            "Executing real-time trade: %s %s %d shares @ $%.2f (%s)",
            strategy, symbol, shares, price, setup.get("type", ""),
        )

        # Publish to alerts channel for frontend notification
        from core.redis import publish
        await publish("alerts", {
            "type": "realtime_signal",
            "strategy": strategy,
            "symbol": symbol,
            "price": price,
            "signal_type": setup.get("type", ""),
            "direction": setup.get("direction", "long"),
            "conviction": conviction,
            "rationale": rationale,
        })

        # Place order through the daily pipeline's order function
        import httpx
        from core.config import settings
        from data.ingestion.daily_pipeline import _place_order

        async with httpx.AsyncClient(timeout=15) as client:
            result = await _place_order(client, symbol, shares, "buy", strategy=strategy)

            # Record in ledger
            ledger = TradeLedger()
            ledger.record_entry(
                symbol=symbol,
                shares=shares,
                price=price,
                signal={
                    "stop_loss": stop_loss,
                    "take_profit": take_profit,
                    "conviction": conviction,
                },
                rationale=f"[REALTIME] {rationale}",
                strategy=strategy,
            )
            logger.info("Real-time trade executed and recorded: %s %s", strategy, symbol)

    except Exception as e:
        logger.exception("Failed to execute real-time setup: %s", e)


# ─── Main Scanner Loop ──────────────────────────────────────

async def _scanner_loop() -> None:
    """Subscribe to Redis quotes and evaluate signals on each tick."""
    global _should_stop

    logger.info(
        "Real-time signal scanner started — monitoring %d symbol setups + %d pairs",
        sum(len(s) for s in _pending_setups.values()),
        len(_pairs_setups),
    )

    from core.redis import subscribe

    try:
        pubsub = await subscribe("quotes")

        while not _should_stop:
            try:
                msg = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=2.0,
                )

                if msg and msg.get("type") == "message":
                    try:
                        data = json.loads(msg["data"]) if isinstance(msg["data"], (str, bytes)) else msg["data"]
                    except (json.JSONDecodeError, TypeError):
                        continue

                    symbol = data.get("symbol", "")
                    price = data.get("last", 0)
                    volume = data.get("volume", 0)
                    bid = data.get("bid", 0)
                    ask = data.get("ask", 0)

                    if symbol and price > 0:
                        await _evaluate_tick(symbol, price, volume, bid, ask)

                # Always check pairs z-scores (throttled internally to every 30s)
                # This runs whether or not a quote message arrived (msg=None on timeout)
                await _check_pairs_zscore()

                # Clean expired setups every 60s
                if int(time.monotonic()) % 60 == 0:
                    clear_expired_setups()
            except asyncio.CancelledError:
                break

    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.exception("Scanner loop error: %s", e)
    finally:
        logger.info("Real-time signal scanner stopped")


async def start_realtime_scanner() -> None:
    """Start the real-time signal scanner as a background task."""
    global _scanner_task, _should_stop
    _should_stop = False
    _scanner_task = asyncio.create_task(_scanner_loop())
    logger.info("Real-time signal scanner background task created")


async def stop_realtime_scanner() -> None:
    """Stop the scanner gracefully."""
    global _should_stop, _scanner_task
    _should_stop = True
    if _scanner_task:
        _scanner_task.cancel()
        try:
            await _scanner_task
        except (asyncio.CancelledError, Exception):
            pass
        _scanner_task = None
    logger.info("Real-time signal scanner stopped")
