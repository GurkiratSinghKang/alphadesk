from __future__ import annotations

import calendar as _calendar
import logging
from datetime import datetime, date, timezone, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

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
    is_demo: bool = False
    source: str = "alpaca"


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
    is_demo: bool = False


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
    is_demo: bool = False
    has_data: bool = True


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
        cash=100_000.00,
        buying_power=200_000.00,
        total_market_value=0,
        unrealized_pnl=0,
        unrealized_pnl_pct=0,
        realized_pnl_today=0,
        positions_count=0,
        last_updated=datetime.now(timezone.utc),
        is_demo=True,
        source="demo",
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
    today = date.today()
    for i in range(n_points):
        daily = rng.gauss(35, 200)  # mean $35/day, stdev $200
        daily_pnls.append(daily)
        cumulative += daily
        d = today - timedelta(days=(n_points - 1 - i))
        equity_curve.append({
            "date": d.isoformat(),
            "value": round(cumulative, 2),
            "cumulative_pnl": round(cumulative, 2),
        })

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
        is_demo=True,
    )


def _demo_greeks() -> PortfolioGreeks:
    """Return zero greeks when no option positions exist."""
    return PortfolioGreeks(
        net_delta=0,
        net_gamma=0,
        net_theta=0,
        net_vega=0,
        beta_weighted_delta=0,
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
                logger.warning("Failed to fetch positions from Alpaca for unrealized P&L", exc_info=True)

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
        logger.warning("Failed to fetch portfolio summary from Alpaca, falling back to demo", exc_info=True)
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

        # Build equity curve with date and cumulative_pnl
        today = date.today()
        n_points = len(cumulative)
        equity_curve_data = []
        for i, c in enumerate(cumulative):
            d = today - timedelta(days=(n_points - 1 - i))
            equity_curve_data.append({
                "date": d.isoformat(),
                "value": round(float(c), 2),
                "cumulative_pnl": round(float(c), 2),
            })

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
            equity_curve=equity_curve_data,
        )
    except Exception:
        logger.warning("Failed to compute performance from DB, falling back to demo", exc_info=True)
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
            asset_class = pos.get("asset_class", "us_equity")
            is_option = asset_class == "option"
            multiplier = 100 if is_option else 1

            # Stocks have delta=1 per share, no gamma/theta/vega
            if not is_option and not greeks.get("delta"):
                d = qty  # 1 delta per share
                g = 0.0
                t = 0.0
                v = 0.0
            else:
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
        logger.warning("Failed to compute portfolio greeks, falling back to demo", exc_info=True)
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
        is_demo=True,
    )


@router.get("/calendar", response_model=CalendarResponse)
async def get_pnl_calendar(
    year: int = Query(None, description="Year (default: current)"),
    month: int = Query(None, description="Month 1-12 (default: current)"),
    demo: bool = Query(False, description="Return demo data for testing"),
) -> CalendarResponse:
    """Get daily P&L calendar data for a given month."""
    today = date.today()
    y = year if year is not None else today.year
    m = month if month is not None else today.month

    if m < 1 or m > 12:
        raise HTTPException(status_code=400, detail="Month must be 1-12")
    if y < 2000 or y > 2100:
        raise HTTPException(status_code=400, detail="Year out of range")

    if demo:
        return _demo_calendar(y, m)

    # Attempt to build calendar from trade ledger (closed trades)
    try:
        from data.ingestion.trade_ledger import TradeLedger
        from collections import defaultdict

        ledger = TradeLedger()

        # Date range for the requested month
        month_start = f"{y:04d}-{m:02d}-01"
        last_day = _calendar.monthrange(y, m)[1]
        month_end = f"{y:04d}-{m:02d}-{last_day:02d}T23:59:59"

        closed = ledger.get_closed_trades(start_date=month_start, end_date=month_end)

        # Also gather open trades for today's unrealized P&L
        today = date.today()
        today_str = today.isoformat()

        # Group closed trades by exit date
        daily_pnl: dict[str, float] = defaultdict(float)
        daily_trades: dict[str, int] = defaultdict(int)
        daily_wins: dict[str, int] = defaultdict(int)

        for t in closed:
            exit_time = t.get("exit_time", "")
            if not exit_time:
                continue
            day_str = exit_time[:10]
            pnl = t.get("pnl") or 0
            daily_pnl[day_str] += pnl
            daily_trades[day_str] += 1
            if pnl > 0:
                daily_wins[day_str] += 1

        # If we have no closed trades but do have open positions, show today's
        # unrealized P&L from the portfolio summary
        if not daily_pnl and y == today.year and m == today.month:
            try:
                open_positions = ledger.get_open_positions()
                if open_positions:
                    import httpx
                    from core.config import settings

                    headers = {
                        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                    }
                    total_unrealized = 0.0
                    async with httpx.AsyncClient(timeout=10) as client:
                        for pos in open_positions:
                            sym = pos.get("symbol", "")
                            entry = pos.get("entry_price", 0)
                            shares = pos.get("shares", 0)
                            if not sym or not entry or not shares:
                                continue
                            try:
                                resp = await client.get(
                                    f"https://data.alpaca.markets/v2/stocks/{sym}/trades/latest",
                                    headers=headers,
                                )
                                if resp.status_code == 200:
                                    cur = resp.json().get("trade", {}).get("p", 0)
                                    total_unrealized += (cur - entry) * shares
                            except Exception:
                                pass
                    if total_unrealized != 0:
                        daily_pnl[today_str] = round(total_unrealized, 2)
                        daily_trades[today_str] = len(open_positions)
                        daily_wins[today_str] = 1 if total_unrealized > 0 else 0
            except Exception:
                logger.warning("Failed to compute today unrealized P&L for calendar", exc_info=True)

        if not daily_pnl:
            return CalendarResponse(
                month=m, year=y, days=[], month_total=0,
                trading_days=0, winning_days=0, losing_days=0,
                best_day=None, worst_day=None, is_demo=False, has_data=False,
            )

        days: list[CalendarDayEntry] = []
        for day_str in sorted(daily_pnl.keys()):
            pnl = round(daily_pnl[day_str], 2)
            trades = daily_trades[day_str]
            wins = daily_wins[day_str]
            win_rate = round(wins / trades * 100, 1) if trades > 0 else 0.0
            days.append(CalendarDayEntry(date=day_str, pnl=pnl, trades=trades, win_rate=win_rate))

        month_total = round(sum(d.pnl for d in days), 2)
        winning = [d for d in days if d.pnl > 0]
        losing = [d for d in days if d.pnl < 0]
        best = max(days, key=lambda d: d.pnl) if days else None
        worst = min(days, key=lambda d: d.pnl) if days else None

        return CalendarResponse(
            month=m, year=y, days=days,
            month_total=month_total,
            trading_days=len(days),
            winning_days=len(winning),
            losing_days=len(losing),
            best_day=CalendarBestWorst(date=best.date, pnl=best.pnl) if best else None,
            worst_day=CalendarBestWorst(date=worst.date, pnl=worst.pnl) if worst else None,
            is_demo=False,
            has_data=True,
        )
    except Exception:
        logger.warning("Failed to build P&L calendar from trade ledger", exc_info=True)

    return CalendarResponse(
        month=m, year=y, days=[], month_total=0,
        trading_days=0, winning_days=0, losing_days=0,
        best_day=None, worst_day=None, is_demo=False, has_data=False,
    )


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
        logger.warning("Failed to fetch journal entries from DB", exc_info=True)
        return []
