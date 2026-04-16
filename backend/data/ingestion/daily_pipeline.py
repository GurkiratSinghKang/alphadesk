"""
AlphaDesk Daily Trading Pipeline — Multi-Strategy Edition

Runs every trading day:
1. Create Master Agent (portfolio gatekeeper)
2. Run each strategy: screen -> analyze -> generate trades (ask Master)
3. Execute approved trades via Alpaca
4. Check exits for existing positions
5. Log everything
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from core.config import settings
from data.ingestion.master_agent import MasterAgent
from data.ingestion.strategy_runner import (
    ALL_STRATEGIES,
    BaseStrategyRunner,
)
from data.ingestion.trade_ledger import TradeLedger

logger = logging.getLogger("alphadesk.pipeline")

ET = ZoneInfo("America/New_York")

# ----- Safety constants -----
MAX_POSITION_PCT = 0.06          # 6 % of equity per position (avoids rounding rejections)
MAX_POSITION_DOLLAR = 6_000.0    # hard cap per position
MAX_OPEN_POSITIONS = 15
MAX_DAILY_TRADES = 30
CIRCUIT_BREAKER_PCT = -0.02      # stop if daily P&L < -2 %
MIN_CONVICTION = 50
ANALYZE_TOP_N = 40               # total analysis budget across all strategies
SCREEN_TOP_N = 100               # screen more, strategies will filter

CLAUDE_CLI = os.environ.get("CLAUDE_CLI_PATH", "claude")
LOG_DIR = Path(__file__).resolve().parent.parent / "pipeline_logs"


async def _get_vix_level(client: httpx.AsyncClient) -> float:
    """Fetch VIX level from the market-overview regime endpoint or Polygon."""
    # Try our own regime endpoint first (uses Polygon VIX data)
    try:
        from api.routes.market_overview import _get_regime_data
        regime = await _get_regime_data()
        if regime and "vix_level" in regime:
            return float(regime["vix_level"])
    except Exception:
        pass

    # Fallback: fetch ^VIX from Polygon if available
    try:
        from core.config import settings
        polygon_key = settings.POLYGON_API_KEY.get_secret_value()
        if polygon_key:
            resp = await client.get(
                f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/VIX",
                params={"apiKey": polygon_key},
            )
            if resp.status_code == 200:
                data = resp.json()
                last = data.get("ticker", {}).get("lastTrade", {}).get("p")
                if last and last < 100:  # sanity check
                    return round(float(last), 1)
    except Exception:
        pass

    return 16.5  # default — assume normal conditions rather than crisis

# ----- Pipeline state -----
_pipeline_lock = asyncio.Lock()
_pipeline_status: dict[str, Any] = {
    "last_run": None,
    "last_result": None,
}


def get_pipeline_status() -> dict[str, Any]:
    return dict(_pipeline_status)


# =====================================================================
# Helpers
# =====================================================================

def _alpaca_headers() -> dict[str, str]:
    return {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        "Content-Type": "application/json",
    }


def _base_url() -> str:
    url = settings.ALPACA_BASE_URL
    if "paper" not in url:
        raise RuntimeError(
            f"SAFETY: ALPACA_BASE_URL ({url}) does not contain 'paper'. "
            "Refusing to trade on a live account."
        )
    return url.rstrip("/")


def _is_within_trading_window() -> bool:
    """Return True when current ET time is between 9:35 and 15:55."""
    now = datetime.now(ET)
    market_open = now.replace(hour=9, minute=35, second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=55, second=0, microsecond=0)
    return market_open <= now <= market_close


def _now_et() -> datetime:
    return datetime.now(ET)


# =====================================================================
# Alpaca helpers
# =====================================================================

async def _get_account(client: httpx.AsyncClient) -> dict[str, Any]:
    resp = await client.get(f"{_base_url()}/v2/account", headers=_alpaca_headers())
    resp.raise_for_status()
    return resp.json()


async def _get_positions(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    resp = await client.get(f"{_base_url()}/v2/positions", headers=_alpaca_headers())
    resp.raise_for_status()
    return resp.json()


async def _place_order(
    client: httpx.AsyncClient,
    symbol: str,
    qty: int,
    side: str,
    strategy: str = "unknown",
) -> dict[str, Any]:
    """Place a market order on Alpaca paper.

    Includes a client_order_id encoding the strategy name for traceability.
    """
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    client_order_id = f"{strategy}_{symbol}_{ts}"

    body = {
        "symbol": symbol,
        "qty": str(qty),
        "side": side,
        "type": "market",
        "time_in_force": "day",
        "client_order_id": client_order_id,
    }
    resp = await client.post(
        f"{_base_url()}/v2/orders",
        headers=_alpaca_headers(),
        json=body,
    )
    resp.raise_for_status()
    order = resp.json()
    logger.info(
        "Order placed: %s %s %d shares  strategy=%s  order_id=%s  client_id=%s",
        side.upper(), symbol, qty, strategy, order.get("id"), client_order_id,
    )
    return order


async def _place_stop_order(client: httpx.AsyncClient, symbol: str, qty: int, stop_price: float) -> dict[str, Any]:
    """Place a stop-loss sell order on Alpaca."""
    body = {
        "symbol": symbol,
        "qty": str(qty),
        "side": "sell",
        "type": "stop",
        "stop_price": str(round(stop_price, 2)),
        "time_in_force": "gtc",  # Good-til-cancelled
    }
    resp = await client.post(
        f"{_base_url()}/v2/orders",
        headers=_alpaca_headers(),
        json=body,
    )
    resp.raise_for_status()
    order = resp.json()
    logger.info("Stop-loss order placed: SELL %s %d shares @ $%.2f  order_id=%s",
                symbol, qty, stop_price, order.get("id"))
    return order


async def _place_limit_order(client: httpx.AsyncClient, symbol: str, qty: int, limit_price: float) -> dict[str, Any]:
    """Place a take-profit limit sell order on Alpaca."""
    body = {
        "symbol": symbol,
        "qty": str(qty),
        "side": "sell",
        "type": "limit",
        "limit_price": str(round(limit_price, 2)),
        "time_in_force": "gtc",
    }
    resp = await client.post(
        f"{_base_url()}/v2/orders",
        headers=_alpaca_headers(),
        json=body,
    )
    resp.raise_for_status()
    order = resp.json()
    logger.info("Take-profit order placed: SELL %s %d shares @ $%.2f  order_id=%s",
                symbol, qty, limit_price, order.get("id"))
    return order


async def _ensure_stop_orders(client: httpx.AsyncClient, ledger: TradeLedger) -> list[dict[str, Any]]:
    """Ensure all open positions have active stop-loss orders on Alpaca."""
    placed: list[dict[str, Any]] = []
    open_positions = ledger.get_open_positions()

    # Get existing orders to avoid duplicates
    resp = await client.get(f"{_base_url()}/v2/orders?status=open", headers=_alpaca_headers())
    existing_orders = resp.json() if resp.status_code == 200 else []
    symbols_with_stops = {o["symbol"] for o in existing_orders if o.get("type") == "stop" and o.get("side") == "sell"}

    for trade in open_positions:
        sym = trade["symbol"]
        if sym in symbols_with_stops:
            continue  # already has a stop

        stop_price = trade.get("signal", {}).get("stop_loss") or trade.get("stop_loss")
        if not stop_price:
            # Default stop: 5% below entry
            stop_price = trade.get("entry_price", 0) * 0.95

        if stop_price and stop_price > 0:
            try:
                order = await _place_stop_order(client, sym, trade["shares"], stop_price)
                placed.append({"symbol": sym, "stop_price": stop_price, "order_id": order.get("id")})
            except Exception as e:
                logger.error("Failed to place stop for %s: %s", sym, e)

    return placed


async def _poll_fill_price(
    client: httpx.AsyncClient,
    order_id: str,
    max_attempts: int = 10,
    delay: float = 1.0,
) -> float | None:
    """Poll Alpaca for an order's filled_avg_price.

    Returns the fill price once the order reaches 'filled' status, or
    None if it doesn't fill within *max_attempts* polls.
    """
    for _ in range(max_attempts):
        try:
            resp = await client.get(
                f"{_base_url()}/v2/orders/{order_id}",
                headers=_alpaca_headers(),
            )
            if resp.status_code == 200:
                data = resp.json()
                status = data.get("status", "")
                if status == "filled":
                    avg = data.get("filled_avg_price")
                    if avg is not None:
                        return float(avg)
                elif status in ("canceled", "expired", "rejected"):
                    return None
        except Exception:
            pass
        await asyncio.sleep(delay)
    return None


async def _execute_approved_orders(
    client: httpx.AsyncClient,
    master: MasterAgent,
    ledger: TradeLedger,
) -> list[dict[str, Any]]:
    """Place buy orders for all approved pending orders from the master agent."""
    orders_placed: list[dict[str, Any]] = []

    # Enforce daily trade limit
    today_count = ledger.count_today_trades()
    if today_count >= MAX_DAILY_TRADES:
        logger.warning(
            "Daily trade limit reached (%d/%d), skipping remaining orders",
            today_count, MAX_DAILY_TRADES,
        )
        return orders_placed

    for order in list(master.pending_orders):
        if order["side"] != "buy":
            continue
        sym = order["symbol"]
        shares = order.get("shares", 0)
        if shares < 1:
            continue
        try:
            result = await _place_order(client, sym, shares, "buy", strategy=order.get("strategy", "unknown"))
            order_id = result.get("id")

            # Record the entry with the pre-trade estimate first
            ledger.record_entry(
                symbol=sym,
                shares=shares,
                price=order.get("entry_price", 0),
                signal={
                    "stop_loss": order.get("stop_loss"),
                    "take_profit": order.get("take_profit"),
                    "conviction": order.get("conviction", 0),
                },
                rationale=order.get("rationale", ""),
                strategy=order.get("strategy", "unknown"),
            )

            # Poll for actual fill price and recalculate stop/take-profit
            if order_id:
                fill_price = await _poll_fill_price(client, order_id)
                if fill_price is not None:
                    ledger.update_entry_price(sym, fill_price)
                    logger.info(
                        "Updated %s ledger entry_price to fill price $%.2f",
                        sym, fill_price,
                    )
                    # Recalculate stop/take-profit relative to actual fill
                    old_entry = order.get("entry_price", 0)
                    old_stop = order.get("stop_loss", 0)
                    old_tp = order.get("take_profit", 0)
                    if old_entry and old_entry > 0:
                        stop_pct = (old_entry - old_stop) / old_entry if old_stop else 0.05
                        tp_pct = (old_tp - old_entry) / old_entry if old_tp else 0.10
                    else:
                        stop_pct = 0.05
                        tp_pct = 0.10
                    order["stop_loss"] = round(fill_price * (1 - stop_pct), 2)
                    order["take_profit"] = round(fill_price * (1 + tp_pct), 2)
                    logger.info(
                        "Recalculated %s levels from fill $%.2f: "
                        "stop=$%.2f, target=$%.2f",
                        sym, fill_price,
                        order["stop_loss"], order["take_profit"],
                    )
                else:
                    logger.warning(
                        "Could not get fill price for %s order %s; "
                        "ledger retains pre-trade estimate",
                        sym, order_id,
                    )

            # Compute effective stop_loss: use order value, fall back to 5% below entry
            effective_stop = order.get("stop_loss")
            if not effective_stop or effective_stop <= 0:
                effective_entry = order.get("entry_price", 0)
                effective_stop = round(effective_entry * 0.95, 2) if effective_entry > 0 else None

            # Place stop-loss order on Alpaca immediately
            if effective_stop and effective_stop > 0:
                try:
                    stop_oid = await _place_stop_order(client, sym, shares, effective_stop)
                    logger.info("Stop-loss order placed for %s: %s", sym, stop_oid.get("id") if isinstance(stop_oid, dict) else stop_oid)
                except Exception as e:
                    logger.error("Stop-loss order failed for %s: %s", sym, e)

            # Place take-profit limit order on Alpaca immediately
            if order.get("take_profit"):
                try:
                    tp_oid = await _place_limit_order(client, sym, shares, order["take_profit"])
                    logger.info("Take-profit order placed for %s: %s", sym, tp_oid.get("id") if isinstance(tp_oid, dict) else tp_oid)
                except Exception as e:
                    logger.error("Take-profit order failed for %s: %s", sym, e)

            orders_placed.append({
                "symbol": sym,
                "side": "buy",
                "shares": shares,
                "strategy": order.get("strategy"),
                "conviction": order.get("conviction"),
                "order_id": order_id,
                "status": result.get("status"),
            })
        except Exception as e:
            logger.error("Order failed for %s: %s", sym, e)

            # --- Ghost position rollback ---
            # The MasterAgent already added this symbol to existing_positions
            # and decremented cash during request_trade(). Roll back both so
            # the symbol is not permanently blocked and cash is accurate.
            notional = order.get("notional", 0)
            if sym in master.existing_positions:
                del master.existing_positions[sym]
                logger.warning(
                    "Rollback: removed %s from master.existing_positions", sym,
                )
            if notional:
                master.cash += notional
                logger.warning(
                    "Rollback: restored $%.0f to master.cash (now $%.0f)",
                    notional, master.cash,
                )
            # Remove from pending_orders so it isn't retried
            master.pending_orders = [
                o for o in master.pending_orders if o.get("symbol") != sym
            ]

            orders_placed.append({
                "symbol": sym,
                "side": "buy",
                "shares": shares,
                "strategy": order.get("strategy"),
                "error": str(e),
            })
    return orders_placed


async def _check_exits(
    client: httpx.AsyncClient,
    ledger: TradeLedger,
) -> list[dict[str, Any]]:
    """Check open positions against stop loss / take profit."""
    closed_orders: list[dict[str, Any]] = []
    open_trades = ledger.get_open_positions()

    if not open_trades:
        return closed_orders

    try:
        positions = await _get_positions(client)
    except Exception as e:
        logger.error("Failed to fetch positions: %s", e)
        return closed_orders

    pos_map = {p["symbol"]: p for p in positions}

    for trade in open_trades:
        sym = trade["symbol"]
        pos = pos_map.get(sym)
        if not pos:
            continue

        current_price = float(pos.get("current_price", 0))
        stop = trade.get("stop_loss")
        target = trade.get("take_profit")
        entry_price = trade.get("entry_price", 0)

        reason = None
        if stop and current_price <= stop:
            reason = "stop_loss"
        elif target and current_price >= target:
            reason = "take_profit"

        # Time-based exit: Close positions held > 20 trading days (~28 calendar days)
        if not reason:
            entry_date = datetime.fromisoformat(trade.get("entry_time", "2026-01-01T00:00:00+00:00"))
            days_held = (datetime.now(timezone.utc) - entry_date).days
            if days_held > 28:
                reason = f"time_exit: held {days_held} days (max 20 trading days)"

        # Trailing stop: If position is up > 5%, move stop to breakeven + buffer
        if not reason and entry_price > 0 and current_price > entry_price * 1.05:
            new_stop = entry_price * 1.01  # Move stop to 1% above entry (breakeven + buffer)
            old_stop = trade.get("signal", {}).get("stop_loss") or trade.get("stop_loss", 0) or 0
            if new_stop > old_stop:
                # Update the stop in the trade record for next check
                trade["stop_loss"] = round(new_stop, 2)
                if trade.get("signal") and isinstance(trade["signal"], dict):
                    trade["signal"]["stop_loss"] = round(new_stop, 2)
                # Persist the updated stop level
                ledger._persist()
                logger.info("Trailing stop updated for %s: $%.2f → $%.2f (persisted)", sym, old_stop, new_stop)
                # Cancel old stop order and place new one at higher level
                try:
                    # Cancel existing stop orders for this symbol
                    resp = await client.get(
                        f"{_base_url()}/v2/orders?status=open&symbols={sym}",
                        headers=_alpaca_headers(),
                    )
                    if resp.status_code == 200:
                        for existing_order in resp.json():
                            if existing_order.get("type") == "stop" and existing_order.get("side") == "sell":
                                await client.delete(
                                    f"{_base_url()}/v2/orders/{existing_order['id']}",
                                    headers=_alpaca_headers(),
                                )
                    await _place_stop_order(client, sym, trade["shares"], round(new_stop, 2))
                    logger.info(
                        "Trailing stop updated for %s: raised from $%.2f to $%.2f",
                        sym, old_stop, new_stop,
                    )
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 403:
                        logger.debug("Trailing stop for %s skipped (403 — check Alpaca account/permissions)", sym)
                    else:
                        logger.warning("Failed to update trailing stop for %s: %s", sym, e)
                except Exception as e:
                    logger.warning("Failed to update trailing stop for %s: %s", sym, e)

        if reason:
            try:
                order = await _place_order(client, sym, trade["shares"], "sell")
                order_id = order.get("id")
                if order_id:
                    fill_price = await _poll_fill_price(client, order_id)
                    if fill_price is not None:
                        ledger.record_exit(sym, trade["shares"], fill_price, reason)
                    else:
                        logger.warning("Sell order for %s may not have filled (order %s) — recording exit at snapshot price", sym, order_id)
                        ledger.record_exit(sym, trade["shares"], current_price, reason)
                else:
                    ledger.record_exit(sym, trade["shares"], current_price, reason)

                # --- Bracket order cleanup ---
                # When one leg fills (stop-loss or take-profit), cancel
                # the opposing open bracket leg to avoid orphaned orders.
                try:
                    resp = await client.get(
                        f"{_base_url()}/v2/orders?status=open&symbols={sym}",
                        headers=_alpaca_headers(),
                    )
                    if resp.status_code == 200:
                        for open_order in resp.json():
                            otype = open_order.get("type", "")
                            oside = open_order.get("side", "")
                            oid = open_order.get("id")
                            if oside == "sell" and otype in ("stop", "limit") and oid:
                                await client.delete(
                                    f"{_base_url()}/v2/orders/{oid}",
                                    headers=_alpaca_headers(),
                                )
                                logger.info(
                                    "Cancelled orphaned %s order for %s (id=%s) after %s exit",
                                    otype, sym, oid, reason,
                                )
                except Exception as cancel_err:
                    logger.warning(
                        "Failed to cancel bracket orders for %s: %s",
                        sym, cancel_err,
                    )

                closed_orders.append({
                    "symbol": sym,
                    "side": "sell",
                    "shares": trade["shares"],
                    "price": current_price,
                    "reason": reason,
                    "strategy": trade.get("strategy", "unknown"),
                    "order_id": order.get("id"),
                })
            except Exception as e:
                logger.error("Exit order failed for %s: %s", sym, e)
                closed_orders.append({
                    "symbol": sym,
                    "side": "sell",
                    "error": str(e),
                })

    return closed_orders


# =====================================================================
# Log
# =====================================================================

def _save_log(log: dict[str, Any]) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    date_str = log.get("date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    path = LOG_DIR / f"{date_str}.json"
    path.write_text(json.dumps(log, indent=2, default=str), encoding="utf-8")
    logger.info("Pipeline log saved to %s", path)
    return path


# =====================================================================
# Main pipeline entry point
# =====================================================================

async def run_daily_pipeline(
    screen_limit: int = SCREEN_TOP_N,
    analyze_limit: int = ANALYZE_TOP_N,
) -> dict[str, Any]:
    """Execute the full multi-strategy daily trading pipeline."""
    global _pipeline_status

    if _pipeline_lock.locked():
        return {"error": "Pipeline already running"}

    async with _pipeline_lock:
        return await _run_pipeline_inner(screen_limit=screen_limit, analyze_limit=analyze_limit)


async def _run_pipeline_inner(
    screen_limit: int = SCREEN_TOP_N,
    analyze_limit: int = ANALYZE_TOP_N,
) -> dict[str, Any]:
    """Inner pipeline logic, called under _pipeline_lock."""
    global _pipeline_status

    _pipeline_status["last_run"] = datetime.now(timezone.utc).isoformat()

    errors: list[str] = []
    log: dict[str, Any] = {
        "date": _now_et().strftime("%Y-%m-%d"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "strategies": {},
        "master_agent": {},
        "orders_placed": [],
        "orders_closed": [],
        "portfolio_snapshot": {},
        "errors": errors,
    }

    try:
        # Safety: paper-only check
        _base_url()

        # Safety: trading window check
        if not _is_within_trading_window():
            now = _now_et()
            logger.warning("Outside trading window (%s ET)", now.strftime("%H:%M"))
            errors.append(f"Outside trading window ({now.strftime('%H:%M')} ET)")

        ledger = TradeLedger()

        async with httpx.AsyncClient(timeout=30) as client:
            # ---- Account state ----
            try:
                account = await _get_account(client)
                equity = float(account.get("equity", 100_000))
                cash = float(account.get("cash", 0))
                day_pnl = float(account.get("equity", 0)) - float(
                    account.get("last_equity", account.get("equity", 0))
                )
            except Exception as e:
                logger.error("Cannot reach Alpaca account: %s", e)
                equity = 100_000
                cash = 100_000
                day_pnl = 0
                errors.append(f"Alpaca account unreachable: {e}")

            # ---- Circuit breaker ----
            if equity > 0 and (day_pnl / equity) < CIRCUIT_BREAKER_PCT:
                msg = (
                    f"CIRCUIT BREAKER: daily P&L {day_pnl:.2f} "
                    f"({day_pnl/equity*100:.1f}%) exceeds -{abs(CIRCUIT_BREAKER_PCT)*100}% limit"
                )
                logger.critical(msg)
                errors.append(msg)
                log["portfolio_snapshot"] = {"equity": equity, "cash": cash, "day_pnl": day_pnl}

                # Send alert via available channels
                try:
                    discord_url = settings.DISCORD_WEBHOOK_URL.get_secret_value() if hasattr(settings.DISCORD_WEBHOOK_URL, 'get_secret_value') else settings.DISCORD_WEBHOOK_URL
                    if discord_url:
                        async with httpx.AsyncClient(timeout=5) as discord_client:
                            await discord_client.post(discord_url, json={"content": f"🚨 CIRCUIT BREAKER: Pipeline halted — daily P&L exceeded -2% threshold"})
                except Exception:
                    pass

                _save_log(log)
                _pipeline_status["last_result"] = "circuit_breaker"
                return log

            # ---- Fetch VIX level for regime detection (P3) ----
            vix_level = await _get_vix_level(client)

            # ---- Ensure all existing positions have stop-loss orders ----
            try:
                stops_placed = await _ensure_stop_orders(client, ledger)
                if stops_placed:
                    logger.info("Placed %d missing stop-loss orders", len(stops_placed))
                    log["stops_ensured"] = stops_placed
            except Exception as e:
                logger.error("Failed to ensure stop orders: %s", e)
                errors.append(f"Stop order check failed: {e}")

            # ---- Create Master Agent ----
            existing_positions = ledger.get_position_strategy_map()
            master = MasterAgent(
                equity=equity,
                cash=cash,
                existing_positions=existing_positions,
                vix_level=vix_level,
            )
            logger.info(
                "Master Agent: regime=%s, VIX=%.1f, max_deployment=%.0f%%",
                master.regime, master.vix_level, master.max_deployment * 100,
            )

            # ---- Factor crowding detection ----
            crowding = master.detect_factor_crowding()
            log["factor_crowding"] = crowding
            if crowding["crowded"]:
                for w in crowding["warnings"]:
                    logger.warning("CROWDING: [%s] %s", w["factor"], w["message"])

            # ---- Populate momentum data for the momentum filter ----
            try:
                from data.ingestion.strategy_runner import _get_screener_results
                screened = _get_screener_results(limit=100)
                momentum_data: dict[str, float] = {}
                for stock in screened:
                    momentum_data[stock["symbol"]] = stock.get("change_pct", 0)

                # Fetch actual 6-month returns for top candidates
                for stock in screened[:20]:
                    sym = stock["symbol"]
                    try:
                        resp = await client.get(
                            f"https://data.alpaca.markets/v2/stocks/{sym}/bars",
                            headers=_alpaca_headers(),
                            params={
                                "timeframe": "1Day",
                                "limit": 1,
                                "start": (datetime.now(timezone.utc) - timedelta(days=180)).strftime("%Y-%m-%d"),
                                "feed": "iex",
                            },
                        )
                        if resp.status_code == 200:
                            bars = resp.json().get("bars", [])
                            if bars:
                                price_6m_ago = bars[0]["c"]
                                current_price = stock.get("price", 0)
                                if current_price and current_price > 0 and price_6m_ago and price_6m_ago > 0:
                                    momentum_data[sym] = ((current_price / price_6m_ago) - 1) * 100
                    except Exception:
                        pass

                MasterAgent.set_momentum_data(momentum_data)
                logger.info("Momentum data populated for %d symbols", len(momentum_data))

                # Fetch 12-month absolute momentum (Antonacci Dual Momentum)
                abs_momentum: dict[str, float] = {}
                for stock in screened[:30]:
                    sym = stock["symbol"]
                    try:
                        resp = await client.get(
                            f"https://data.alpaca.markets/v2/stocks/{sym}/bars",
                            headers=_alpaca_headers(),
                            params={
                                "timeframe": "1Day",
                                "limit": 1,
                                "start": (_now_et() - timedelta(days=365)).strftime("%Y-%m-%d"),
                                "feed": "iex",
                            },
                        )
                        if resp.status_code == 200:
                            bars = resp.json().get("bars", [])
                            if bars:
                                price_1y_ago = bars[0]["c"]
                                current = stock.get("price", 0)
                                if current and price_1y_ago:
                                    abs_momentum[sym] = ((current / price_1y_ago) - 1) * 100
                    except Exception:
                        pass

                MasterAgent.set_absolute_momentum(abs_momentum)
                logger.info("Absolute momentum (12-month) data populated for %d symbols", len(abs_momentum))
            except Exception as e:
                logger.error("Failed to populate momentum data: %s", e)
                errors.append(f"Momentum data failed: {e}")

            # ---- Update strategy PnL BEFORE running strategies (P1) ----
            # Must run before new trades are approved, so drawdown peaks
            # reflect only actual positions, not un-traded approvals.
            pre_strategy_values: dict[str, float] = {}
            for sym, pos in master.existing_positions.items():
                strat = pos.get("strategy", "unknown")
                pre_strategy_values[strat] = pre_strategy_values.get(strat, 0) + pos.get("notional", 0)
            for strat, value in pre_strategy_values.items():
                pnl_result = master.update_strategy_pnl(strat, value)
                if pnl_result["action"] == "halt":
                    logger.warning(
                        "Strategy '%s' HALTED (pre-trade): drawdown %.1f%%",
                        strat, pnl_result["drawdown"] * 100,
                    )

            # ---- Run each strategy (screening in parallel) ----
            strategy_instances = [cls() for cls in ALL_STRATEGIES]
            num_strategies = len(strategy_instances)
            per_strategy_limit = max(2, analyze_limit // num_strategies)

            async def _run_single_strategy(strategy: BaseStrategyRunner) -> tuple[str, dict[str, Any]]:
                """Screen, analyze, and generate trades for one strategy."""
                strat_name = strategy.name
                logger.info("Running strategy: %s", strat_name)

                # Screen
                candidates = await strategy.screen()
                logger.info(
                    "  %s screened %d candidates", strat_name, len(candidates),
                )

                # Analyze (limit per strategy to conserve CLI calls)
                to_analyze = candidates[:per_strategy_limit]
                analyses = await strategy.analyze(to_analyze)
                logger.info(
                    "  %s analyzed %d candidates", strat_name, len(analyses),
                )

                # Generate trades (asks master for permission)
                trades = await strategy.generate_trades(analyses, master)
                approved = [t for t in trades if t.get("approved")]
                logger.info(
                    "  %s: %d trades requested, %d approved",
                    strat_name, len(trades), len(approved),
                )

                return strat_name, {
                    "screened": len(candidates),
                    "analyzed": len(analyses),
                    "analyses": analyses,
                    "trades_requested": len(trades),
                    "trades_approved": len(approved),
                    "trades": trades,
                }

            results = await asyncio.gather(
                *[_run_single_strategy(s) for s in strategy_instances],
                return_exceptions=True,
            )

            for i, result in enumerate(results):
                strat_name = strategy_instances[i].name
                if isinstance(result, Exception):
                    logger.exception("Strategy %s failed: %s", strat_name, result)
                    errors.append(f"Strategy {strat_name} failed: {result}")
                    log["strategies"][strat_name] = {"error": str(result)}
                else:
                    name, data = result
                    log["strategies"][name] = data

            # ---- Update strategy PnL (P1) ----
            strategy_values: dict[str, float] = {}
            for sym, pos in master.existing_positions.items():
                strat = pos.get("strategy", "unknown")
                strategy_values[strat] = strategy_values.get(strat, 0) + pos.get("notional", 0)
            for strat, value in strategy_values.items():
                pnl_result = master.update_strategy_pnl(strat, value)
                if pnl_result["action"] == "halt":
                    logger.warning(
                        "Strategy '%s' HALTED: drawdown %.1f%%",
                        strat, pnl_result["drawdown"] * 100,
                    )

            # ---- Master Agent summary ----
            summary = master.get_summary()
            log["master_agent"] = {
                "approved": len(master.pending_orders),
                "rejected": len(master.rejections),
                "rejections": master.rejections,
                "summary": summary,
                "regime": master.regime,
                "vix_level": master.vix_level,
                "max_deployment_pct": master.max_deployment * 100,
                "sector_exposure": master._get_sector_exposure(),
                "portfolio_var": master._portfolio_var(),
                "halted_strategies": list(master.halted_strategies),
            }

            # ---- Execute approved orders ----
            orders_placed = await _execute_approved_orders(client, master, ledger)
            log["orders_placed"] = orders_placed

            # ---- Check exits ----
            closed = await _check_exits(client, ledger)
            log["orders_closed"] = closed

            # ---- Portfolio snapshot ----
            try:
                account = await _get_account(client)
                positions = await _get_positions(client)
                log["portfolio_snapshot"] = {
                    "equity": float(account.get("equity", 0)),
                    "cash": float(account.get("cash", 0)),
                    "positions": len(positions),
                    "day_pnl": day_pnl,
                }
            except Exception as e:
                errors.append(f"Snapshot failed: {e}")
                log["portfolio_snapshot"] = {"equity": equity, "cash": cash}

    except Exception as e:
        logger.exception("Pipeline failed: %s", e)
        errors.append(f"Pipeline exception: {e}")
    finally:
        _save_log(log)
        _pipeline_status["last_result"] = "success" if not errors else "completed_with_errors"

    return log


async def run_position_check() -> dict[str, Any]:
    """Mid-day or end-of-day position check for stop/target exits."""
    logger.info("Running position check")
    ledger = TradeLedger()
    result: dict[str, Any] = {"closed": [], "errors": []}

    try:
        _base_url()
        async with httpx.AsyncClient(timeout=30) as client:
            closed = await _check_exits(client, ledger)
            result["closed"] = closed
    except Exception as e:
        logger.error("Position check failed: %s", e)
        result["errors"].append(str(e))

    return result
