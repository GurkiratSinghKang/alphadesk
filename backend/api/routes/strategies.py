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
    sparkline: list[float] = []


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
    best_trade: dict[str, Any] | None = None
    worst_trade: dict[str, Any] | None = None


class StrategyPosition(BaseModel):
    symbol: str
    shares: int
    entry_price: float
    current_price: float
    market_value: float
    unrealized_pnl: float
    unrealized_pnl_pct: float
    entry_date: str
    days_held: int
    conviction: int | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    rationale: str | None = None


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
    "pairs-trading": {
        "name": "Pairs Trading",
        "description": "Statistical arbitrage identifying cointegrated stock pairs. Goes long the underperformer and short the outperformer when spread deviates beyond 2 standard deviations, targeting mean reversion of the spread.",
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
    "dividend-capture": {
        "name": "Dividend Capture",
        "description": "Systematic dividend harvesting that enters high-yield stocks 2-3 days before ex-dividend date and exits after capture. Screens for dividend yield > 3% with adequate liquidity and momentum support.",
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
    "sector-rotation": {
        "name": "Sector Rotation",
        "description": "Rotates capital into the top 3 performing sectors monthly using relative strength ranking across all 11 GICS sectors. Underweights lagging sectors and overweights leaders based on 1-month and 3-month momentum.",
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
    "gap-fill": {
        "name": "Gap Fill",
        "description": "Intraday strategy that fades overnight gaps greater than 1% in liquid large-cap stocks. Enters at market open in the direction of the gap fill and targets 50-80% of the gap with a tight stop at the gap extreme.",
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


def _annualized_return(return_pct: float, first_trade_date: str | None = None) -> float:
    """Calculate proper CAGR-based annualized return.

    Uses the actual first trade date from the ledger.  If no trades exist
    or the holding period is less than 30 days the raw (non-annualized)
    return is returned to avoid misleading extrapolation.
    """
    if return_pct == 0 or not first_trade_date:
        return 0

    try:
        start = date.fromisoformat(first_trade_date[:10])
    except (ValueError, TypeError):
        return 0

    days_held = max((date.today() - start).days, 1)

    # Don't annualize short track records -- just show the raw return
    if days_held < 30:
        return round(return_pct, 2)

    if days_held >= 365:
        annualized = ((1 + return_pct / 100) ** (365 / days_held) - 1) * 100
    else:
        annualized = return_pct * (365 / days_held)
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


def _get_real_strategy_performance(ledger_instance: Any | None = None) -> dict[str, dict]:
    """Compute actual performance from trade ledger.

    Accepts an optional pre-loaded ledger instance to avoid re-reading
    the file (useful when the caller has already performed a sync).
    """
    try:
        if ledger_instance is None:
            from data.ingestion.trade_ledger import TradeLedger
            ledger_instance = TradeLedger()

        perf: dict[str, dict] = {}
        for trade in ledger_instance._data.get("trades", []):
            strat = trade.get("strategy", "unknown")
            if strat not in perf:
                perf[strat] = {
                    "trades": 0, "pnl": 0.0, "wins": 0, "open": 0,
                    "invested": 0.0, "last_trade_date": "", "first_trade_date": "",
                    "best_trade": None, "worst_trade": None,
                }
            perf[strat]["trades"] += 1
            entry_price = trade.get("entry_price", 0)
            shares = trade.get("shares", 0)
            perf[strat]["invested"] += entry_price * shares
            trade_date = trade.get("entry_time", "")
            if trade_date and trade_date > perf[strat]["last_trade_date"]:
                perf[strat]["last_trade_date"] = trade_date[:10] if len(trade_date) >= 10 else trade_date
            if trade_date and (not perf[strat]["first_trade_date"] or trade_date < perf[strat]["first_trade_date"]):
                perf[strat]["first_trade_date"] = trade_date[:10] if len(trade_date) >= 10 else trade_date
            if trade.get("status") == "open":
                perf[strat]["open"] += 1
            if trade.get("status") == "closed" and entry_price:
                # Prefer stored pnl/pnl_pct; fall back to calculation
                pnl = trade.get("pnl")
                if pnl is None and trade.get("exit_price"):
                    pnl = (trade["exit_price"] - entry_price) * shares
                if pnl is not None:
                    perf[strat]["pnl"] += pnl
                    if pnl > 0:
                        perf[strat]["wins"] += 1
                    # Track best/worst trades
                    pnl_pct = trade.get("pnl_pct")
                    if pnl_pct is None and trade.get("exit_price"):
                        pnl_pct = round(((trade["exit_price"] - entry_price) / entry_price) * 100, 2)
                    trade_summary = {"symbol": trade.get("symbol", ""), "pnl": pnl, "pnl_pct": pnl_pct or 0}
                    if perf[strat]["best_trade"] is None or pnl > perf[strat]["best_trade"]["pnl"]:
                        perf[strat]["best_trade"] = trade_summary
                    if perf[strat]["worst_trade"] is None or pnl < perf[strat]["worst_trade"]["pnl"]:
                        perf[strat]["worst_trade"] = trade_summary

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
    "pairs_trading": "pairs-trading",
    "dividend_capture": "dividend-capture",
    "sector_rotation": "sector-rotation",
    "gap_fill": "gap-fill",
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
    """List all strategies with real ledger data including unrealized P&L.

    Fetches live Alpaca positions and syncs the ledger first so that
    untracked positions, share mismatches, and stale entries are corrected
    before computing performance numbers.
    """
    import httpx
    from core.config import settings
    from data.ingestion.trade_ledger import TradeLedger

    # ------------------------------------------------------------------
    # 1. Fetch live Alpaca positions
    # ------------------------------------------------------------------
    alpaca_positions: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions",
                headers={
                    "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                    "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                },
            )
            if resp.status_code == 200:
                alpaca_positions = resp.json()
    except Exception:
        logger.warning("Failed to fetch Alpaca positions for strategy sync", exc_info=True)

    # ------------------------------------------------------------------
    # 2. Sync ledger with Alpaca (creates missing entries, fixes shares)
    # ------------------------------------------------------------------
    ledger = TradeLedger()
    if alpaca_positions:
        try:
            ledger.sync_with_alpaca(alpaca_positions)
            # Reload ledger data after sync so real_perf reflects updates
            ledger = TradeLedger()
        except Exception:
            logger.warning("Ledger sync with Alpaca failed", exc_info=True)

    # ------------------------------------------------------------------
    # 3. Compute real performance from the (now-synced) ledger
    # ------------------------------------------------------------------
    real_perf = _get_real_strategy_performance(ledger)

    # ------------------------------------------------------------------
    # 4. Build Alpaca position map keyed by strategy for accurate counts
    #    and unrealized P&L (Alpaca provides unrealized_pl per position)
    # ------------------------------------------------------------------
    alpaca_by_strategy: dict[str, list[dict]] = {}
    for pos in alpaca_positions:
        sym = pos.get("symbol", "")
        # Determine strategy from ledger
        strat_id = "manual-discretionary"
        for t in ledger._data.get("trades", []):
            if t["symbol"] == sym and t["status"] == "open":
                strat_name = t.get("strategy", "manual")
                strat_id = _STRATEGY_NAME_TO_ID.get(strat_name, "manual-discretionary")
                break
        alpaca_by_strategy.setdefault(strat_id, []).append(pos)

    # Unrealized P&L per strategy from Alpaca position data
    unrealized_by_strat_id: dict[str, float] = {}
    for strat_id, positions in alpaca_by_strategy.items():
        unrealized_by_strat_id[strat_id] = sum(
            float(p.get("unrealized_pl", 0)) for p in positions
        )

    # ------------------------------------------------------------------
    # 5. Build summaries
    # ------------------------------------------------------------------
    summaries = []
    for sid, data in _STRATEGIES.items():
        d = await _get_strategy_data(sid)
        if d is None:
            continue

        # Start with sentinel values -- only real ledger data populates these
        win_rate = -1.0  # -1 = no closed trades (frontend shows "N/A")
        total_return = 0.0
        invested = 0.0
        pnl_dollars = 0.0

        # Active count from Alpaca positions (ground truth)
        active_count = len(alpaca_by_strategy.get(sid, []))

        for strat_name, strat_id in _STRATEGY_NAME_TO_ID.items():
            if strat_id == sid and strat_name in real_perf:
                rp = real_perf[strat_name]
                if rp["trades"] > 0:
                    pnl_dollars = rp["pnl"] + unrealized_by_strat_id.get(sid, 0)
                    invested = rp.get("invested", 0.0)
                    closed = rp["trades"] - rp["open"]
                    if closed > 0:
                        win_rate = round(rp["wins"] / closed * 100, 1)
                    if invested > 0:
                        total_return = round(pnl_dollars / invested * 100, 1)
                break

        # Build compact sparkline (last 20 equity curve points)
        sparkline_data: list[float] = []
        if invested > 0:
            curve = _generate_equity_curve(sid, max(invested, 1), total_return)
            sparkline_data = [p["value"] for p in curve[-20:]] if curve else []

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
            sparkline=sparkline_data,
        ))
    return summaries


@router.get("/leaderboard")
async def strategy_leaderboard() -> dict[str, Any]:
    """Return strategies ranked by total return with Sharpe ratios.

    Computes realised + unrealised P&L from the trade ledger (synced
    with Alpaca) and ranks strategies from best to worst performer.
    """
    import hashlib
    import httpx
    from core.config import settings
    from data.ingestion.trade_ledger import TradeLedger

    # Fetch live Alpaca positions for unrealised P&L
    alpaca_positions: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions",
                headers={
                    "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                    "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                },
            )
            if resp.status_code == 200:
                alpaca_positions = resp.json()
    except Exception:
        logger.warning("Failed to fetch Alpaca positions for leaderboard", exc_info=True)

    ledger = TradeLedger()
    if alpaca_positions:
        try:
            ledger.sync_with_alpaca(alpaca_positions)
            ledger = TradeLedger()
        except Exception:
            logger.warning("Ledger sync failed in leaderboard", exc_info=True)

    real_perf = _get_real_strategy_performance(ledger)

    # Map Alpaca positions to strategies for unrealised P&L
    unrealized_by_id: dict[str, float] = {}
    for pos in alpaca_positions:
        sym = pos.get("symbol", "")
        strat_id = "manual-discretionary"
        for t in ledger._data.get("trades", []):
            if t["symbol"] == sym and t["status"] == "open":
                strat_id = _STRATEGY_NAME_TO_ID.get(t.get("strategy", "manual"), "manual-discretionary")
                break
        unrealized_by_id[strat_id] = unrealized_by_id.get(strat_id, 0) + float(pos.get("unrealized_pl", 0))

    entries: list[dict[str, Any]] = []
    for sid, sdata in _STRATEGIES.items():
        invested = 0.0
        pnl_dollars = 0.0
        sharpe = 0.0
        daily_returns: list[float] = []

        for strat_name, strat_id in _STRATEGY_NAME_TO_ID.items():
            if strat_id != sid or strat_name not in real_perf:
                continue
            rp = real_perf[strat_name]
            if rp["trades"] > 0:
                pnl_dollars = rp["pnl"] + unrealized_by_id.get(sid, 0)
                invested = rp.get("invested", 0.0)

                # Build daily returns from closed trades for Sharpe
                for t in ledger._data.get("trades", []):
                    if t.get("strategy") != strat_name or t.get("status") != "closed":
                        continue
                    entry_p = t.get("entry_price", 0)
                    exit_p = t.get("exit_price", 0)
                    if entry_p and exit_p:
                        daily_returns.append((exit_p - entry_p) / entry_p)
            break

        return_pct = round(pnl_dollars / invested * 100, 1) if invested > 0 else 0.0

        # Compute Sharpe from per-trade returns
        if len(daily_returns) > 1:
            mean_r = statistics.mean(daily_returns)
            std_r = statistics.stdev(daily_returns)
            sharpe = round(mean_r / std_r * math.sqrt(252), 2) if std_r > 0 else 0.0
        elif len(daily_returns) == 1:
            sharpe = round(daily_returns[0] * math.sqrt(252), 2)

        entries.append({
            "id": sid,
            "name": sdata["name"],
            "return_pct": return_pct,
            "sharpe": sharpe,
        })

    # Rank by return descending
    entries.sort(key=lambda e: e["return_pct"], reverse=True)
    for rank, entry in enumerate(entries, 1):
        entry["rank"] = rank

    worst_performer = entries[-1]["id"] if entries else None
    best_sharpe_entry = max(entries, key=lambda e: e["sharpe"]) if entries else None

    return {
        "leaderboard": entries,
        "worst_performer": worst_performer,
        "best_sharpe": best_sharpe_entry["id"] if best_sharpe_entry else None,
    }


@router.get("/{strategy_id}/performance", response_model=StrategyPerformance)
async def get_strategy_performance(
    strategy_id: str = Path(..., description="Strategy identifier"),
) -> StrategyPerformance:
    """Get detailed performance data for a single strategy.

    Syncs the ledger with Alpaca positions first, then uses Alpaca
    unrealized P&L directly for accuracy.
    """
    import httpx
    from core.config import settings
    from data.ingestion.trade_ledger import TradeLedger

    data = await _get_strategy_data(strategy_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_id}' not found")

    # ------------------------------------------------------------------
    # Fetch Alpaca positions and sync ledger
    # ------------------------------------------------------------------
    alpaca_positions: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions",
                headers={
                    "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                    "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                },
            )
            if resp.status_code == 200:
                alpaca_positions = resp.json()
    except Exception:
        logger.warning("Failed to fetch Alpaca positions for strategy performance", exc_info=True)

    ledger = TradeLedger()
    if alpaca_positions:
        try:
            ledger.sync_with_alpaca(alpaca_positions)
            ledger = TradeLedger()
        except Exception:
            logger.warning("Ledger sync failed in strategy performance", exc_info=True)

    # ------------------------------------------------------------------
    # Map Alpaca positions to this strategy
    # ------------------------------------------------------------------
    ledger_name = _ID_TO_NAME.get(strategy_id, strategy_id)
    alpaca_for_strat: list[dict] = []
    for pos in alpaca_positions:
        sym = pos.get("symbol", "")
        matched_strat_id = "manual-discretionary"
        for t in ledger._data.get("trades", []):
            if t["symbol"] == sym and t["status"] == "open":
                matched_strat_id = _STRATEGY_NAME_TO_ID.get(
                    t.get("strategy", "manual"), "manual-discretionary"
                )
                break
        if matched_strat_id == strategy_id:
            alpaca_for_strat.append(pos)

    unrealized = sum(float(p.get("unrealized_pl", 0)) for p in alpaca_for_strat)
    active_count = len(alpaca_for_strat)

    # ------------------------------------------------------------------
    # Compute performance from ledger
    # ------------------------------------------------------------------
    invested = 0.0
    return_pct = 0.0
    win_rate = -1.0
    pnl_dollars = 0.0
    last_trade = ""
    first_trade = ""

    real_perf = _get_real_strategy_performance()

    for strat_name, strat_id in _STRATEGY_NAME_TO_ID.items():
        if strat_id == strategy_id and strat_name in real_perf:
            rp = real_perf[strat_name]
            if rp["trades"] > 0:
                pnl_dollars = rp["pnl"] + unrealized
                invested = rp.get("invested", 0.0)
                last_trade = rp.get("last_trade_date", "")
                first_trade = rp.get("first_trade_date", "")
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
        annualized_return_pct=_annualized_return(return_pct, first_trade),
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

    # -- Best / worst trade --
    real_perf = _get_real_strategy_performance()
    rp = real_perf.get(ledger_name, {})
    best_trade = rp.get("best_trade")
    worst_trade = rp.get("worst_trade")

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
        best_trade=best_trade,
        worst_trade=worst_trade,
    )


@router.get("/{strategy_id}/positions", response_model=list[StrategyPosition])
async def get_strategy_positions(
    strategy_id: str = Path(..., description="Strategy identifier"),
) -> list[StrategyPosition]:
    """Return live positions for a single strategy, enriched with Alpaca data."""
    import httpx
    from core.config import settings
    from data.ingestion.trade_ledger import TradeLedger

    data = await _get_strategy_data(strategy_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Strategy '{strategy_id}' not found")

    # Fetch live Alpaca positions
    alpaca_positions: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions",
                headers={
                    "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                    "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                },
            )
            if resp.status_code == 200:
                alpaca_positions = resp.json()
    except Exception:
        logger.warning("Failed to fetch Alpaca positions for strategy positions", exc_info=True)

    ledger = TradeLedger()
    if alpaca_positions:
        try:
            ledger.sync_with_alpaca(alpaca_positions)
            ledger = TradeLedger()
        except Exception:
            pass

    # Build alpaca price map
    alpaca_by_sym: dict[str, dict] = {}
    for pos in alpaca_positions:
        alpaca_by_sym[pos.get("symbol", "")] = pos

    # Find open trades for this strategy
    ledger_name = _ID_TO_NAME.get(strategy_id, strategy_id)
    open_trades = [
        t for t in ledger._data.get("trades", [])
        if t.get("status") == "open" and t.get("strategy") == ledger_name
    ]

    today = date.today()
    results: list[StrategyPosition] = []
    for t in open_trades:
        sym = t.get("symbol", "")
        entry_price = t.get("entry_price", 0)
        shares = t.get("shares", 0)
        alpaca_pos = alpaca_by_sym.get(sym, {})
        current_price = float(alpaca_pos.get("current_price", entry_price))
        unrealized_pnl = float(alpaca_pos.get("unrealized_pl", 0))
        unrealized_pnl_pct = float(alpaca_pos.get("unrealized_plpc", 0)) * 100

        entry_date_str = t.get("entry_time", "")[:10]
        try:
            entry_d = date.fromisoformat(entry_date_str)
            days_held = (today - entry_d).days
        except (ValueError, TypeError):
            days_held = 0

        results.append(StrategyPosition(
            symbol=sym,
            shares=shares,
            entry_price=round(entry_price, 2),
            current_price=round(current_price, 2),
            market_value=round(current_price * shares, 2),
            unrealized_pnl=round(unrealized_pnl, 2),
            unrealized_pnl_pct=round(unrealized_pnl_pct, 2),
            entry_date=entry_date_str,
            days_held=days_held,
            conviction=t.get("conviction"),
            stop_loss=t.get("stop_loss"),
            take_profit=t.get("take_profit"),
            rationale=t.get("rationale"),
        ))

    return results
