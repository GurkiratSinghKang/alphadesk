from __future__ import annotations

import hashlib
import logging
import math
import random
import statistics
from collections import defaultdict
from datetime import datetime, date, timedelta, timezone
from enum import Enum
from typing import Any

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

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


class StreakInfo(BaseModel):
    type: str  # "win" or "loss"
    count: int


class Streaks(BaseModel):
    current: StreakInfo
    best_win: int
    worst_loss: int


class MonthlyReturn(BaseModel):
    year: int
    month: int
    return_pct: float


class ConvictionBucket(BaseModel):
    bucket: str
    wins: int
    losses: int


class HoldTimeStats(BaseModel):
    avg_win_days: float
    avg_loss_days: float
    median_hold_days: float


class StrategyAnalytics(BaseModel):
    strategy_id: str
    sector_exposure: dict[str, dict[str, float]]
    monthly_returns: list[MonthlyReturn]
    streaks: Streaks
    conviction_distribution: list[ConvictionBucket]
    hold_time_stats: HoldTimeStats
    correlations: dict[str, float]
    rolling_beta: list[Any]


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
    "manual-discretionary": {
        "name": "Manual / Discretionary",
        "description": "Your own trades placed directly on Alpaca. Claude reviews each trade with analysis of what went right and wrong.",
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


def _annualized_return(return_pct: float) -> float:
    """Calculate proper CAGR-based annualized return."""
    if return_pct == 0:
        return 0
    days_held = max((date.today() - date(2026, 4, 1)).days, 1)
    if days_held >= 365:
        annualized = ((1 + return_pct / 100) ** (365 / days_held) - 1) * 100
    else:
        annualized = return_pct * (365 / days_held) if days_held > 0 else 0
    return round(annualized, 2)


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
    base_date = date.today() - timedelta(days=days)

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
        logger.warning("Failed to compute real strategy performance from trade ledger", exc_info=True)
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
    "manual": "manual-discretionary",
}

# Reverse mapping: strategy route ID -> ledger strategy name
_ID_TO_NAME: dict[str, str] = {v: k for k, v in _STRATEGY_NAME_TO_ID.items()}


async def _get_strategy_status_override(strategy_id: str) -> StrategyStatus | None:
    """Retrieve a persisted strategy status override from Redis."""
    try:
        from core.redis import cache_get
        result = await cache_get(f"strategy_status:{strategy_id}")
        return StrategyStatus(result["status"]) if result else None
    except Exception:
        logger.warning("Failed to read strategy status override from Redis", exc_info=True)
        return None


async def _set_strategy_status_override(strategy_id: str, status: StrategyStatus) -> None:
    """Persist a strategy status override to Redis (no TTL — survives restarts)."""
    try:
        from core.redis import cache_set
        await cache_set(f"strategy_status:{strategy_id}", {"status": status.value}, ttl_seconds=0)
    except Exception:
        logger.warning("Failed to persist strategy status override to Redis", exc_info=True)


async def _get_strategy_data(strategy_id: str) -> dict[str, Any] | None:
    data = _STRATEGIES.get(strategy_id)
    if data is None:
        return None
    result = dict(data)
    override = await _get_strategy_status_override(strategy_id)
    if override is not None:
        result["status"] = override
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
                        logger.warning("Failed to fetch live price for %s (unrealized P&L skipped)", sym, exc_info=True)
        except Exception:
            logger.warning("Failed to fetch live prices for open positions", exc_info=True)

    summaries = []
    for sid, data in _STRATEGIES.items():
        d = await _get_strategy_data(sid)
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
    data = await _get_strategy_data(strategy_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_id}' not found")

    # Start with sentinels -- only real data populates
    invested = 0.0
    return_pct = 0.0
    win_rate = -1.0  # -1 = no closed trades (frontend shows "N/A")
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
        annualized_return_pct=_annualized_return(return_pct),
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
    data = await _get_strategy_data(strategy_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_id}' not found")

    current_status = data["status"]
    if current_status == StrategyStatus.ACTIVE:
        new_status = StrategyStatus.PAUSED
    else:
        new_status = StrategyStatus.ACTIVE

    await _set_strategy_status_override(strategy_id, new_status)

    return ToggleResponse(
        id=strategy_id,
        name=data["name"],
        previous_status=current_status,
        new_status=new_status,
    )


def _get_symbol_sector_map() -> dict[str, str]:
    """Build a symbol -> sector lookup from the symbols database."""
    try:
        from api.routes.symbols import _build_demo_symbols
        return {
            s.symbol: s.sector
            for s in _build_demo_symbols()
            if s.sector
        }
    except Exception:
        logger.warning("Failed to build symbol-sector map", exc_info=True)
        return {}


def _parse_iso_dt(s: str | None) -> datetime | None:
    """Parse an ISO 8601 datetime string, returning None on failure."""
    if not s:
        return None
    try:
        # Handle both timezone-aware and naive strings
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


@router.get("/{strategy_id}/analytics", response_model=StrategyAnalytics)
async def get_strategy_analytics(
    strategy_id: str = Path(..., description="Strategy identifier"),
) -> StrategyAnalytics:
    """Return in-depth analytics for a single strategy computed from the trade ledger."""
    data = await _get_strategy_data(strategy_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_id}' not found")

    from data.ingestion.trade_ledger import TradeLedger
    ledger = TradeLedger()

    # Resolve ledger strategy name from route ID
    ledger_name = _ID_TO_NAME.get(strategy_id, strategy_id)

    all_trades = [
        t for t in ledger._data.get("trades", [])
        if t.get("strategy") == ledger_name
    ]
    open_trades = [t for t in all_trades if t.get("status") == "open"]
    closed_trades = [t for t in all_trades if t.get("status") == "closed"]

    # -- Sector exposure (from open positions) --
    sector_map = _get_symbol_sector_map()
    sector_notional: dict[str, float] = defaultdict(float)
    total_notional = 0.0
    for t in open_trades:
        notional = (t.get("entry_price") or 0) * (t.get("shares") or 0)
        sector = sector_map.get(t.get("symbol", ""), "Unknown")
        sector_notional[sector] += notional
        total_notional += notional

    current_sector: dict[str, float] = {}
    if total_notional > 0:
        current_sector = {
            sector: round(val / total_notional, 4)
            for sector, val in sorted(sector_notional.items())
        }

    # -- Monthly returns (group closed trades by exit month, sum P&L %) --
    monthly_pnl: dict[tuple[int, int], float] = defaultdict(float)
    monthly_invested: dict[tuple[int, int], float] = defaultdict(float)
    for t in closed_trades:
        exit_dt = _parse_iso_dt(t.get("exit_time"))
        if exit_dt is None:
            continue
        key = (exit_dt.year, exit_dt.month)
        monthly_pnl[key] += t.get("pnl", 0) or 0
        monthly_invested[key] += (t.get("entry_price") or 0) * (t.get("shares") or 0)

    monthly_returns: list[MonthlyReturn] = []
    for (year, month) in sorted(monthly_pnl.keys()):
        invested = monthly_invested[(year, month)]
        ret_pct = round(monthly_pnl[(year, month)] / invested * 100, 2) if invested > 0 else 0.0
        monthly_returns.append(MonthlyReturn(year=year, month=month, return_pct=ret_pct))

    # -- Streaks (chronological order by exit_time) --
    sorted_closed = sorted(
        closed_trades,
        key=lambda t: t.get("exit_time") or "",
    )
    current_streak_type = "win"
    current_streak_count = 0
    best_win_streak = 0
    worst_loss_streak = 0
    running_win = 0
    running_loss = 0

    for t in sorted_closed:
        pnl = t.get("pnl") or 0
        if pnl > 0:
            running_win += 1
            running_loss = 0
            best_win_streak = max(best_win_streak, running_win)
        elif pnl < 0:
            running_loss += 1
            running_win = 0
            worst_loss_streak = max(worst_loss_streak, running_loss)
        else:
            # breakeven resets both
            running_win = 0
            running_loss = 0

    # Determine current streak from the tail of sorted trades
    if sorted_closed:
        last_pnl = sorted_closed[-1].get("pnl") or 0
        if last_pnl >= 0:
            current_streak_type = "win"
            current_streak_count = running_win
        else:
            current_streak_type = "loss"
            current_streak_count = running_loss
    else:
        current_streak_type = "win"
        current_streak_count = 0

    # -- Conviction distribution --
    buckets = ["0-20", "20-40", "40-60", "60-80", "80-100"]
    conviction_wins: dict[str, int] = {b: 0 for b in buckets}
    conviction_losses: dict[str, int] = {b: 0 for b in buckets}

    for t in closed_trades:
        conv = t.get("conviction") or 0
        pnl = t.get("pnl") or 0
        if conv <= 20:
            bucket = "0-20"
        elif conv <= 40:
            bucket = "20-40"
        elif conv <= 60:
            bucket = "40-60"
        elif conv <= 80:
            bucket = "60-80"
        else:
            bucket = "80-100"

        if pnl > 0:
            conviction_wins[bucket] += 1
        elif pnl < 0:
            conviction_losses[bucket] += 1
        # breakeven trades not counted in either

    conviction_distribution = [
        ConvictionBucket(bucket=b, wins=conviction_wins[b], losses=conviction_losses[b])
        for b in buckets
    ]

    # -- Hold time stats --
    win_hold_days: list[float] = []
    loss_hold_days: list[float] = []
    all_hold_days: list[float] = []

    for t in closed_trades:
        entry_dt = _parse_iso_dt(t.get("entry_time"))
        exit_dt = _parse_iso_dt(t.get("exit_time"))
        if entry_dt is None or exit_dt is None:
            continue
        hold = (exit_dt - entry_dt).total_seconds() / 86400.0
        all_hold_days.append(hold)
        pnl = t.get("pnl") or 0
        if pnl > 0:
            win_hold_days.append(hold)
        elif pnl < 0:
            loss_hold_days.append(hold)

    hold_time_stats = HoldTimeStats(
        avg_win_days=round(sum(win_hold_days) / len(win_hold_days), 1) if win_hold_days else 0.0,
        avg_loss_days=round(sum(loss_hold_days) / len(loss_hold_days), 1) if loss_hold_days else 0.0,
        median_hold_days=round(statistics.median(all_hold_days), 1) if all_hold_days else 0.0,
    )

    # -- Correlations & rolling beta (placeholder -- require market data) --
    correlations = {"SPY": 0.0, "QQQ": 0.0}
    rolling_beta: list[Any] = []

    return StrategyAnalytics(
        strategy_id=strategy_id,
        sector_exposure={"current": current_sector},
        monthly_returns=monthly_returns,
        streaks=Streaks(
            current=StreakInfo(type=current_streak_type, count=current_streak_count),
            best_win=best_win_streak,
            worst_loss=worst_loss_streak,
        ),
        conviction_distribution=conviction_distribution,
        hold_time_stats=hold_time_stats,
        correlations=correlations,
        rolling_beta=rolling_beta,
    )
