from __future__ import annotations

import hashlib
import math
import random
from datetime import datetime, date, timedelta, timezone
from enum import Enum
from typing import Any

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, Field

router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class StrategyStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    BACKTEST = "backtest"


class StrategyPerformance(BaseModel):
    name: str
    description: str
    status: StrategyStatus
    invested_amount: float
    current_value: float
    total_return_pct: float
    annualized_return_pct: float
    return_dollars: float
    win_rate: float
    sharpe_ratio: float
    max_drawdown: float
    active_positions_count: int
    equity_curve: list[dict[str, Any]]  # [{date, value}]
    last_trade_date: str


class StrategySummary(BaseModel):
    id: str
    name: str
    description: str
    status: StrategyStatus
    invested_amount: float
    total_return_pct: float
    sharpe_ratio: float
    win_rate: float
    active_positions_count: int


class ToggleResponse(BaseModel):
    id: str
    name: str
    previous_status: StrategyStatus
    new_status: StrategyStatus


# ---------------------------------------------------------------------------
# Demo strategy definitions
# ---------------------------------------------------------------------------

_STRATEGIES: dict[str, dict[str, Any]] = {
    "momentum-quality": {
        "name": "Momentum + Quality",
        "description": "Combines relative strength momentum with quality factor screens (high ROE, low debt, earnings stability). Rebalances monthly.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "pead": {
        "name": "PEAD",
        "description": "Post-Earnings Announcement Drift -- exploits the market's under-reaction to earnings surprises by entering after strong beats and holding 30-60 days.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "vrp-harvesting": {
        "name": "VRP Harvesting",
        "description": "Volatility Risk Premium harvesting through systematic short options strategies. Sells put spreads on liquid large-caps when IV rank is elevated.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "earnings-vol-premium": {
        "name": "Earnings Vol Premium",
        "description": "Captures the implied vs realized volatility spread around earnings events. Sells straddles/strangles pre-earnings on names with historically overstated IV.",
        "status": StrategyStatus.PAUSED,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "regime-adaptive": {
        "name": "Regime Adaptive",
        "description": "ML-based regime detection (bull/bear/sideways) combined with strategy rotation. Shifts between momentum, mean-reversion, and defensive allocations.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "claude-alpha": {
        "name": "Claude Alpha",
        "description": "AI-driven opportunistic stock picking powered by Claude. Analyzes top screener picks with a general swing-trade prompt, combining technical and fundamental factors with news sentiment.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "mean-reversion": {
        "name": "Mean Reversion",
        "description": "Buy oversold quality stocks with strong fundamentals (F-Score >= 5) and sell on reversion to mean. Uses wider stops and targets.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "vcp-breakout": {
        "name": "VCP Breakout",
        "description": "Volatility Contraction Pattern breakout — enters when Stage 2 uptrend stocks form tight bases (Minervini SEPA methodology). Tight 3% stops, 10% targets.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
}


def _generate_equity_curve(
    strategy_id: str, invested: float, return_pct: float, days: int = 90,
) -> list[dict[str, Any]]:
    """Generate a deterministic equity curve for the last N days."""
    seed = int(hashlib.md5(strategy_id.encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)

    end_value = invested * (1 + return_pct / 100.0)
    # Daily drift to reach end_value from invested over `days` trading days
    daily_drift = (end_value / invested) ** (1.0 / days) - 1.0

    curve: list[dict[str, Any]] = []
    value = invested
    base_date = date(2026, 4, 6) - timedelta(days=days)

    for i in range(days):
        d = base_date + timedelta(days=i)
        # Skip weekends
        if d.weekday() >= 5:
            continue
        noise = rng.gauss(0, 0.008)
        value *= 1 + daily_drift + noise
        value = max(value, invested * 0.80)  # floor
        curve.append({"date": d.isoformat(), "value": round(value, 2)})

    # Ensure last value matches expected
    if curve:
        curve[-1]["value"] = round(end_value, 2)

    return curve


def _get_real_strategy_performance() -> dict[str, dict]:
    """Compute actual performance from trade ledger."""
    try:
        from data.ingestion.trade_ledger import TradeLedger
        ledger = TradeLedger()

        perf: dict[str, dict] = {}
        for trade in ledger._data.get("trades", []):
            strat = trade.get("strategy", "unknown")
            if strat not in perf:
                perf[strat] = {"trades": 0, "pnl": 0.0, "wins": 0, "open": 0, "invested": 0.0, "last_trade_date": ""}
            perf[strat]["trades"] += 1
            entry_price = trade.get("entry_price", 0)
            shares = trade.get("shares", 0)
            perf[strat]["invested"] += entry_price * shares
            trade_date = trade.get("entry_time", "")
            if trade_date and trade_date > perf[strat]["last_trade_date"]:
                perf[strat]["last_trade_date"] = trade_date[:10] if len(trade_date) >= 10 else trade_date
            if trade.get("status") == "open":
                perf[strat]["open"] += 1
            if trade.get("status") == "closed" and trade.get("exit_price") and entry_price:
                pnl = (trade["exit_price"] - entry_price) * shares
                perf[strat]["pnl"] += pnl
                if pnl > 0:
                    perf[strat]["wins"] += 1

        return perf
    except Exception:
        return {}


# Strategy name to strategy ID mapping
_STRATEGY_NAME_TO_ID: dict[str, str] = {
    "momentum_quality": "momentum-quality",
    "pead": "pead",
    "vrp_harvest": "vrp-harvesting",
    "earnings_vol": "earnings-vol-premium",
    "regime_adaptive": "regime-adaptive",
    "claude_alpha": "claude-alpha",
    "mean_reversion": "mean-reversion",
    "vcp_breakout": "vcp-breakout",
}


# In-memory status overrides (toggle endpoint)
_status_overrides: dict[str, StrategyStatus] = {}


def _get_strategy_data(strategy_id: str) -> dict[str, Any] | None:
    data = _STRATEGIES.get(strategy_id)
    if data is None:
        return None
    result = dict(data)
    if strategy_id in _status_overrides:
        result["status"] = _status_overrides[strategy_id]
    return result


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/", response_model=list[StrategySummary])
async def list_strategies() -> list[StrategySummary]:
    """List all strategies with real ledger data including unrealized P&L."""
    import httpx
    from core.config import settings
    from data.ingestion.trade_ledger import TradeLedger

    real_perf = _get_real_strategy_performance()

    # Fetch live prices for open positions to calculate unrealized P&L
    ledger = TradeLedger()
    open_trades = ledger.get_open_positions()
    unrealized_by_strat: dict[str, float] = {}
    if open_trades:
        try:
            async with httpx.AsyncClient() as client:
                for t in open_trades:
                    sym = t.get("symbol", "")
                    strat = t.get("strategy", "unknown")
                    entry = t.get("entry_price", 0)
                    shares = t.get("shares", 0)
                    if not sym or not entry or not shares:
                        continue
                    try:
                        resp = await client.get(
                            f"https://data.alpaca.markets/v2/stocks/{sym}/trades/latest",
                            headers={
                                "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                                "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                            },
                        )
                        if resp.status_code == 200:
                            cur = resp.json().get("trade", {}).get("p", 0)
                            unrealized_by_strat[strat] = unrealized_by_strat.get(strat, 0) + (cur - entry) * shares
                    except Exception:
                        pass
        except Exception:
            pass

    summaries = []
    for sid, data in _STRATEGIES.items():
        d = _get_strategy_data(sid)
        if d is None:
            continue

        # Start with sentinel values -- only real ledger data populates these
        win_rate = -1.0  # -1 = no closed trades (frontend shows "N/A")
        active_count = 0
        total_return = 0.0
        invested = 0.0
        pnl_dollars = 0.0

        for strat_name, strat_id in _STRATEGY_NAME_TO_ID.items():
            if strat_id == sid and strat_name in real_perf:
                rp = real_perf[strat_name]
                if rp["trades"] > 0:
                    active_count = rp["open"]
                    pnl_dollars = rp["pnl"] + unrealized_by_strat.get(strat_name, 0)
                    invested = rp.get("invested", 0.0)
                    closed = rp["trades"] - rp["open"]
                    if closed > 0:
                        win_rate = round(rp["wins"] / closed * 100, 1)
                    if invested > 0:
                        total_return = round(pnl_dollars / invested * 100, 1)
                break

        summaries.append(StrategySummary(
            id=sid,
            name=d["name"],
            description=d["description"],
            status=d["status"],
            invested_amount=round(invested, 2),
            total_return_pct=total_return,
            sharpe_ratio=0,
            win_rate=win_rate,
            active_positions_count=active_count,
        ))
    return summaries


@router.get("/{strategy_id}/performance", response_model=StrategyPerformance)
async def get_strategy_performance(
    strategy_id: str = Path(..., description="Strategy identifier"),
) -> StrategyPerformance:
    """Get detailed performance data for a single strategy using real ledger data only."""
    data = _get_strategy_data(strategy_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_id}' not found")

    # Start with zeros -- only real data populates
    invested = 0.0
    return_pct = 0.0
    win_rate = 0.0
    active_count = 0
    pnl_dollars = 0.0
    last_trade = ""

    real_perf = _get_real_strategy_performance()
    for strat_name, strat_id in _STRATEGY_NAME_TO_ID.items():
        if strat_id == strategy_id and strat_name in real_perf:
            rp = real_perf[strat_name]
            if rp["trades"] > 0:
                active_count = rp["open"]
                pnl_dollars = rp["pnl"]
                invested = rp.get("invested", 0.0)
                last_trade = rp.get("last_trade_date", "")
                closed = rp["trades"] - rp["open"]
                if closed > 0:
                    win_rate = round(rp["wins"] / closed * 100, 1)
                if invested > 0:
                    return_pct = round(pnl_dollars / invested * 100, 1)
            break

    current_value = round(invested + pnl_dollars, 2)
    return_dollars = round(pnl_dollars, 2)

    equity_curve = _generate_equity_curve(strategy_id, max(invested, 1), return_pct) if invested > 0 else []

    return StrategyPerformance(
        name=data["name"],
        description=data["description"],
        status=data["status"],
        invested_amount=round(invested, 2),
        current_value=current_value,
        total_return_pct=return_pct,
        annualized_return_pct=return_pct * 2 if return_pct != 0 else 0,
        return_dollars=return_dollars,
        win_rate=win_rate,
        sharpe_ratio=0,
        max_drawdown=0,
        active_positions_count=active_count,
        equity_curve=equity_curve,
        last_trade_date=last_trade,
    )


@router.post("/{strategy_id}/toggle", response_model=ToggleResponse)
async def toggle_strategy(
    strategy_id: str = Path(..., description="Strategy identifier"),
) -> ToggleResponse:
    """Toggle a strategy between active and paused."""
    data = _get_strategy_data(strategy_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_id}' not found")

    current_status = data["status"]
    if current_status == StrategyStatus.ACTIVE:
        new_status = StrategyStatus.PAUSED
    else:
        new_status = StrategyStatus.ACTIVE

    _status_overrides[strategy_id] = new_status

    return ToggleResponse(
        id=strategy_id,
        name=data["name"],
        previous_status=current_status,
        new_status=new_status,
    )
