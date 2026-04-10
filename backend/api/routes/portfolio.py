from __future__ import annotations

import calendar as _calendar
from datetime import datetime, date, timezone, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field


router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class PortfolioSummary(BaseModel):
    equity: float
    cash: float
    buying_power: float
    total_market_value: float
    unrealized_pnl: float
    unrealized_pnl_pct: float
    realized_pnl_today: float
    positions_count: int
    last_updated: datetime


class PerformanceMetrics(BaseModel):
    period: str
    total_return: float
    total_return_pct: float
    sharpe_ratio: float | None = None
    sortino_ratio: float | None = None
    max_drawdown: float | None = None
    win_rate: float | None = None
    profit_factor: float | None = None
    avg_win: float | None = None
    avg_loss: float | None = None
    best_trade: float | None = None
    worst_trade: float | None = None
    total_trades: int = 0
    equity_curve: list[dict[str, Any]] = Field(default_factory=list)


class PortfolioGreeks(BaseModel):
    net_delta: float
    net_gamma: float
    net_theta: float
    net_vega: float
    beta_weighted_delta: float = Field(0, description="SPY beta-weighted delta")
    by_position: list[dict[str, Any]] = Field(default_factory=list)


class JournalEntry(BaseModel):
    id: int
    trade_id: int | None = None
    symbol: str | None = None
    entry_date: datetime
    entry_type: str = Field(..., description="trade, note, review, lesson")
    content: str
    tags: list[str] = Field(default_factory=list)
    attachments: list[str] = Field(default_factory=list)


class CalendarDayEntry(BaseModel):
    date: str
    pnl: float
    trades: int
    win_rate: float


class CalendarBestWorst(BaseModel):
    date: str
    pnl: float


class CalendarResponse(BaseModel):
    month: int
    year: int
    days: list[CalendarDayEntry]
    month_total: float
    trading_days: int
    winning_days: int
    losing_days: int
    best_day: CalendarBestWorst | None = None
    worst_day: CalendarBestWorst | None = None


# ---------------------------------------------------------------------------
# Demo data helpers
# ---------------------------------------------------------------------------

def _alpaca_keys_empty() -> bool:
    from core.config import settings
    return (
        not settings.ALPACA_API_KEY.get_secret_value()
        or not settings.ALPACA_SECRET_KEY.get_secret_value()
    )


def _demo_portfolio_summary() -> PortfolioSummary:
    return PortfolioSummary(
        equity=100_000.00,
        cash=45_000.00,
        buying_power=90_000.00,
        total_market_value=55_000.00,
        unrealized_pnl=1_250.00,
        unrealized_pnl_pct=2.33,
        realized_pnl_today=320.00,
        positions_count=0,
        last_updated=datetime.now(timezone.utc),
    )


def _demo_performance(period: str) -> PerformanceMetrics:
    """Generate a demo equity curve and performance metrics."""
    import random
    rng = random.Random(42)

    period_days_map = {"7d": 7, "30d": 30, "90d": 90, "1y": 252, "ytd": 60, "all": 500}
    n_points = period_days_map.get(period, 30)

    # Simulate daily PnL with slight positive drift
    equity_curve = []
    cumulative = 0.0
    daily_pnls = []
    for i in range(n_points):
        daily = rng.gauss(35, 200)  # mean $35/day, stdev $200
        daily_pnls.append(daily)
        cumulative += daily
        equity_curve.append({"index": i, "cumulative_pnl": round(cumulative, 2)})

    wins = [p for p in daily_pnls if p > 0]
    losses = [p for p in daily_pnls if p < 0]
    total_return = round(cumulative, 2)

    # Simple max drawdown
    peak = 0.0
    max_dd = 0.0
    running = 0.0
    for pnl in daily_pnls:
        running += pnl
        if running > peak:
            peak = running
        dd = running - peak
        if dd < max_dd:
            max_dd = dd

    mean_ret = sum(daily_pnls) / len(daily_pnls) if daily_pnls else 0
    import math
    std_ret = math.sqrt(sum((p - mean_ret) ** 2 for p in daily_pnls) / max(len(daily_pnls) - 1, 1))
    sharpe = round(mean_ret / std_ret * math.sqrt(252), 2) if std_ret > 0 else None

    return PerformanceMetrics(
        period=period,
        total_return=total_return,
        total_return_pct=round(total_return / 100_000 * 100, 2),
        sharpe_ratio=sharpe,
        sortino_ratio=round((sharpe or 0) * 1.3, 2) if sharpe else None,
        max_drawdown=round(max_dd, 2),
        win_rate=round(len(wins) / len(daily_pnls) * 100, 1) if daily_pnls else None,
        profit_factor=round(sum(wins) / abs(sum(losses)), 2) if losses and sum(losses) != 0 else None,
        avg_win=round(sum(wins) / len(wins), 2) if wins else None,
        avg_loss=round(sum(losses) / len(losses), 2) if losses else None,
        best_trade=round(max(daily_pnls), 2) if daily_pnls else None,
        worst_trade=round(min(daily_pnls), 2) if daily_pnls else None,
        total_trades=len(daily_pnls),
        equity_curve=equity_curve,
    )


def _demo_greeks() -> PortfolioGreeks:
    return PortfolioGreeks(
        net_delta=12.5,
        net_gamma=0.8,
        net_theta=-45.20,
        net_vega=32.10,
        beta_weighted_delta=15.3,
        by_position=[],
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=PortfolioSummary)
async def get_portfolio_summary() -> PortfolioSummary:
    """Fetch portfolio summary from the broker account."""
    if _alpaca_keys_empty():
        return _demo_portfolio_summary()

    try:
        from core.config import settings
        import httpx

        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/account",
                headers=headers,
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"Alpaca API error: {resp.text[:200]}")
            try:
                data = resp.json()
            except Exception:
                raise HTTPException(status_code=502, detail="Invalid response from Alpaca API")

            # Fetch position-level data from Alpaca positions endpoint
            positions_unrealized = 0.0
            positions_count_from_api = 0
            try:
                pos_resp = await client.get(
                    f"{settings.ALPACA_BASE_URL}/v2/positions",
                    headers=headers,
                )
                if pos_resp.status_code == 200:
                    positions_data = pos_resp.json()
                    positions_unrealized = sum(float(p.get("unrealized_pl", 0)) for p in positions_data)
                    positions_count_from_api = len(positions_data)
            except Exception:
                pass

        equity = float(data.get("equity", 0))
        last_equity = float(data.get("last_equity", equity))
        long_mv = float(data.get("long_market_value", 0))
        short_mv = float(data.get("short_market_value", 0))

        # Day's total P&L = current equity - previous day's equity
        day_pnl = equity - last_equity

        # Use position-level unrealized P&L from positions endpoint
        unrealized_pnl = positions_unrealized
        total_mv = long_mv + short_mv
        unrealized_pnl_pct = (unrealized_pnl / total_mv * 100) if total_mv > 0 else 0
        realized_pnl_today = day_pnl - unrealized_pnl

        return PortfolioSummary(
            equity=equity,
            cash=float(data.get("cash", 0)),
            buying_power=float(data.get("buying_power", 0)),
            total_market_value=long_mv + short_mv,
            unrealized_pnl=unrealized_pnl,
            unrealized_pnl_pct=unrealized_pnl_pct,
            realized_pnl_today=realized_pnl_today,
            positions_count=positions_count_from_api or int(data.get("position_count", 0)),
            last_updated=datetime.now(timezone.utc),
        )
    except HTTPException:
        raise
    except Exception:
        return _demo_portfolio_summary()


@router.get("/performance", response_model=PerformanceMetrics)
async def get_performance(
    period: str = Query("30d", description="Period: 7d, 30d, 90d, 1y, ytd, all"),
) -> PerformanceMetrics:
    """Compute portfolio performance metrics over a given period."""
    from core.config import settings
    if settings.SKIP_DB_INIT:
        return _demo_performance(period)

    try:
        import numpy as np
        from sqlalchemy import select
        from data.storage.models import Trade
        from core.database import _get_session_factory

        # Determine date cutoff
        period_days = {"7d": 7, "30d": 30, "90d": 90, "1y": 365, "ytd": (date.today() - date(date.today().year, 1, 1)).days, "all": 3650}
        days = period_days.get(period, 30)
        cutoff = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0)
        from datetime import timedelta
        cutoff -= timedelta(days=days)

        factory = _get_session_factory()
        async with factory() as db:
            result = await db.execute(
                select(Trade)
                .where(Trade.entry_time >= cutoff, Trade.status == "closed")
                .order_by(Trade.entry_time)
            )
            trades = result.scalars().all()

        if not trades:
            # No trade history — return demo performance
            return _demo_performance(period)

        pnls = [t.pnl for t in trades if t.pnl is not None]
        returns = np.array(pnls) if pnls else np.array([0.0])

        total_return = float(np.sum(returns))
        wins = returns[returns > 0]
        losses = returns[returns < 0]

        cumulative = np.cumsum(returns)
        running_max = np.maximum.accumulate(cumulative)
        drawdowns = cumulative - running_max
        max_dd = float(np.min(drawdowns)) if len(drawdowns) > 0 else 0

        mean_ret = float(np.mean(returns)) if len(returns) > 1 else 0
        std_ret = float(np.std(returns)) if len(returns) > 1 else 1
        downside = returns[returns < 0]
        downside_std = float(np.std(downside)) if len(downside) > 1 else 1

        sharpe = (mean_ret / std_ret * np.sqrt(252)) if std_ret > 0 else None
        sortino = (mean_ret / downside_std * np.sqrt(252)) if downside_std > 0 else None

        gross_wins = float(np.sum(wins)) if len(wins) else 0
        gross_losses = abs(float(np.sum(losses))) if len(losses) else 1
        profit_factor = gross_wins / gross_losses if gross_losses > 0 else None

        return PerformanceMetrics(
            period=period,
            total_return=round(total_return, 2),
            total_return_pct=round(total_return / 10000 * 100, 2),
            sharpe_ratio=round(float(sharpe), 2) if sharpe else None,
            sortino_ratio=round(float(sortino), 2) if sortino else None,
            max_drawdown=round(max_dd, 2),
            win_rate=round(len(wins) / len(returns) * 100, 1) if len(returns) else None,
            profit_factor=round(profit_factor, 2) if profit_factor else None,
            avg_win=round(float(np.mean(wins)), 2) if len(wins) else None,
            avg_loss=round(float(np.mean(losses)), 2) if len(losses) else None,
            best_trade=round(float(np.max(returns)), 2) if len(returns) else None,
            worst_trade=round(float(np.min(returns)), 2) if len(returns) else None,
            total_trades=len(trades),
            equity_curve=[
                {"index": i, "cumulative_pnl": round(float(c), 2)}
                for i, c in enumerate(cumulative)
            ],
        )
    except Exception:
        return _demo_performance(period)


@router.get("/greeks", response_model=PortfolioGreeks)
async def get_portfolio_greeks() -> PortfolioGreeks:
    """Aggregate portfolio-level greeks across all option positions."""
    try:
        from core.redis import cache_get

        positions = await cache_get("positions:all") or {"positions": []}

        if not positions.get("positions"):
            return _demo_greeks()

        net_delta = 0.0
        net_gamma = 0.0
        net_theta = 0.0
        net_vega = 0.0
        by_position = []

        for pos in positions.get("positions", []):
            greeks = pos.get("greeks", {})
            qty = pos.get("quantity", 0)
            multiplier = 100 if pos.get("asset_class") == "option" else 1

            d = greeks.get("delta", 0) * qty * multiplier
            g = greeks.get("gamma", 0) * qty * multiplier
            t = greeks.get("theta", 0) * qty * multiplier
            v = greeks.get("vega", 0) * qty * multiplier

            net_delta += d
            net_gamma += g
            net_theta += t
            net_vega += v

            by_position.append({
                "symbol": pos.get("symbol"),
                "quantity": qty,
                "delta": round(d, 2),
                "gamma": round(g, 4),
                "theta": round(t, 2),
                "vega": round(v, 2),
            })

        return PortfolioGreeks(
            net_delta=round(net_delta, 2),
            net_gamma=round(net_gamma, 4),
            net_theta=round(net_theta, 2),
            net_vega=round(net_vega, 2),
            by_position=by_position,
        )
    except Exception:
        return _demo_greeks()


def _demo_calendar(year: int, month: int) -> CalendarResponse:
    """Generate deterministic demo P&L calendar data for a given month."""
    import random
    seed = year * 100 + month
    rng = random.Random(seed)

    num_days = _calendar.monthrange(year, month)[1]
    today = date.today()
    days: list[CalendarDayEntry] = []

    for day in range(1, num_days + 1):
        d = date(year, month, day)
        # Skip weekends
        if d.weekday() >= 5:
            continue
        # Don't generate data for future dates
        if d > today:
            continue

        # ~60% winning days
        is_win = rng.random() < 0.60
        if is_win:
            pnl = round(rng.gauss(300, 150), 2)
            pnl = max(pnl, 5.0)  # ensure positive
        else:
            pnl = round(rng.gauss(-200, 100), 2)
            pnl = min(pnl, -5.0)  # ensure negative

        trades = rng.randint(1, 8)
        wins = rng.randint(0, trades)
        win_rate = round(wins / trades * 100, 1) if trades > 0 else 0.0

        days.append(CalendarDayEntry(
            date=d.isoformat(),
            pnl=pnl,
            trades=trades,
            win_rate=win_rate,
        ))

    month_total = round(sum(d.pnl for d in days), 2)
    winning = [d for d in days if d.pnl > 0]
    losing = [d for d in days if d.pnl < 0]

    best = max(days, key=lambda d: d.pnl) if days else None
    worst = min(days, key=lambda d: d.pnl) if days else None

    return CalendarResponse(
        month=month,
        year=year,
        days=days,
        month_total=month_total,
        trading_days=len(days),
        winning_days=len(winning),
        losing_days=len(losing),
        best_day=CalendarBestWorst(date=best.date, pnl=best.pnl) if best else None,
        worst_day=CalendarBestWorst(date=worst.date, pnl=worst.pnl) if worst else None,
    )


@router.get("/calendar", response_model=CalendarResponse)
async def get_pnl_calendar(
    year: int = Query(None, description="Year (default: current)"),
    month: int = Query(None, description="Month 1-12 (default: current)"),
) -> CalendarResponse:
    """Get daily P&L calendar data for a given month."""
    today = date.today()
    y = year if year is not None else today.year
    m = month if month is not None else today.month

    if m < 1 or m > 12:
        raise HTTPException(status_code=400, detail="Month must be 1-12")
    if y < 2000 or y > 2100:
        raise HTTPException(status_code=400, detail="Year out of range")

    return _demo_calendar(y, m)


@router.get("/journal", response_model=list[JournalEntry])
async def get_journal(
    limit: int = Query(50, ge=1, le=500),
    symbol: str | None = Query(None),
) -> list[JournalEntry]:
    """Retrieve trading journal entries."""
    from core.config import settings
    if settings.SKIP_DB_INIT:
        return []

    try:
        from sqlalchemy import select
        from data.storage.models import Trade
        from core.database import _get_session_factory

        factory = _get_session_factory()
        async with factory() as db:
            query = select(Trade).order_by(Trade.entry_time.desc()).limit(limit)
            if symbol:
                query = query.where(Trade.symbol == symbol.upper())

            result = await db.execute(query)
            trades = result.scalars().all()

        return [
            JournalEntry(
                id=t.id,
                trade_id=t.id,
                symbol=t.symbol,
                entry_date=t.entry_time,
                entry_type="trade",
                content=t.notes or f"Trade on {t.symbol} via {t.strategy or 'manual'}",
                tags=[t.strategy] if t.strategy else [],
            )
            for t in trades
        ]
    except Exception:
        return []
