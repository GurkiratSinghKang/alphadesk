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
    # Day's total P&L (current equity minus previous-day equity). Backend
    # already computed this locally but never surfaced it, so the frontend
    # (``frontend/src/lib/api.ts:getPortfolioSummary``) fell back through
    # ``?? realized_pnl_today`` — which double-counts on positions held
    # across days. Surface it here so the fallback is never hit.
    day_pnl: float = 0.0
    positions_count: int
    last_updated: datetime
    is_demo: bool = False
    source: str = "alpaca"


class DrawdownInfo(BaseModel):
    max_drawdown: float = 0
    max_drawdown_pct: float = 0
    peak_date: str | None = None
    trough_date: str | None = None


class PerformanceMetrics(BaseModel):
    period: str
    total_return: float
    total_return_pct: float
    sharpe_ratio: float | None = None
    sortino_ratio: float | None = None
    max_drawdown: float | None = None
    calmar_ratio: float | None = None
    drawdown_detail: DrawdownInfo = Field(default_factory=DrawdownInfo)
    rolling_sharpe_30d: list[dict[str, Any]] = Field(default_factory=list)
    daily_returns: list[dict[str, Any]] = Field(default_factory=list)
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
    # Round-15 / persona-7 P0: explicit ``is_demo`` flag so the FE can
    # render a "data unavailable" empty state instead of treating a
    # silent fallback (e.g. cache miss, broker outage) as real flat
    # delta. ``True`` means "we couldn't compute these; don't act on
    # them"; ``False`` is the live path.
    is_demo: bool = Field(
        False,
        description="True when greeks are demo / fallback data, not live",
    )


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


def _compute_enhanced_metrics(
    daily_pnls: list[float],
    dates: list[str],
    base_equity: float = 100_000,
) -> dict[str, Any]:
    """Compute daily returns, rolling Sharpe, drawdown detail, Calmar & Sortino.

    Shared between the demo and live code paths so both return the
    same enhanced fields.

    IMPORTANT: Sharpe / Sortino / Calmar are computed on **returns** (daily
    P&L divided by ``base_equity``), not on raw dollar P&Ls. Treating dollars
    as returns makes the Sharpe scale with the account size rather than with
    risk-adjusted performance and produces a number that can't be compared
    against any external benchmark.  Max drawdown is computed against a
    running peak of the **equity curve** (``base_equity + cumulative_pnl``),
    so the denominator is the true peak rather than the peak P&L, which can
    be near zero early in an equity curve and produce nonsensical
    percentages.
    """
    import math

    n = len(daily_pnls)
    if n == 0:
        return {
            "daily_returns": [],
            "rolling_sharpe_30d": [],
            "drawdown_detail": DrawdownInfo(),
            "calmar_ratio": None,
            "sortino_ratio": None,
        }

    if not base_equity or base_equity <= 0:
        base_equity = 100_000

    # Convert dollar P&Ls to period returns (pnl / equity). We use a constant
    # ``base_equity`` denominator as a stable proxy for the account equity at
    # the start of each period. A proper implementation would divide each
    # period's P&L by that period's starting equity — TODO once we have a
    # daily account-equity series.
    daily_returns_pct_frac: list[float] = [p / base_equity for p in daily_pnls]

    # Daily return percentages (relative to base equity) — response payload
    daily_return_records: list[dict[str, Any]] = []
    for i, pnl in enumerate(daily_pnls):
        ret_pct = round(pnl / base_equity * 100, 4)
        daily_return_records.append({"date": dates[i], "return_pct": ret_pct, "pnl": round(pnl, 2)})

    # Rolling 30-day Sharpe (on returns, not dollars)
    rolling_sharpe: list[dict[str, Any]] = []
    window = 30
    for i in range(window - 1, n):
        chunk = daily_returns_pct_frac[i - window + 1 : i + 1]
        m = sum(chunk) / window
        var = sum((x - m) ** 2 for x in chunk) / max(window - 1, 1)
        s = math.sqrt(var)
        sh = round(m / s * math.sqrt(252), 2) if s > 0 else 0.0
        rolling_sharpe.append({"date": dates[i], "sharpe": sh})

    # Drawdown on the equity curve (peak-to-trough of equity, not P&L).
    # equity_t = base_equity + cumulative_pnl_t. Divide by the running equity
    # peak, not by base_equity, so the percentage tracks the actual peak-to-
    # trough decline.
    running_pnl = 0.0
    peak_equity = base_equity
    max_dd = 0.0            # dollar drawdown at trough
    max_dd_pct = 0.0        # fractional drawdown at trough (negative)
    peak_idx = 0
    trough_idx = 0
    for i, pnl in enumerate(daily_pnls):
        running_pnl += pnl
        equity_i = base_equity + running_pnl
        if equity_i > peak_equity:
            peak_equity = equity_i
            peak_idx = i
        # drawdown relative to running peak equity
        dd_frac = (equity_i - peak_equity) / peak_equity if peak_equity > 0 else 0.0
        dd_abs = equity_i - peak_equity
        if dd_frac < max_dd_pct:
            max_dd_pct = dd_frac
            max_dd = dd_abs
            trough_idx = i

    dd_pct = round(max_dd_pct * 100, 2)
    dd_detail = DrawdownInfo(
        max_drawdown=round(max_dd, 2),
        max_drawdown_pct=dd_pct,
        peak_date=dates[peak_idx] if dates else None,
        trough_date=dates[trough_idx] if dates else None,
    )

    # Sortino ratio — denominator is TOTAL N (LPM₂ formulation), not the
    # number of downside periods. Dividing by len(downside) would systematically
    # understate Sortino when losses are infrequent.
    mean_ret = sum(daily_returns_pct_frac) / n
    downside_sq_sum = sum(min(r, 0.0) ** 2 for r in daily_returns_pct_frac)
    downside_std = math.sqrt(downside_sq_sum / n) if n > 0 else 0.0
    sortino = round(mean_ret / downside_std * math.sqrt(252), 2) if downside_std > 0 else None

    # Calmar ratio = annualised return / |max drawdown pct|. Annualisation
    # multiplies the mean daily return (fraction) by 252 trading days.
    annualised_return = mean_ret * 252
    calmar = (
        round(annualised_return / abs(max_dd_pct), 2)
        if max_dd_pct != 0 else None
    )

    return {
        "daily_returns": daily_return_records,
        "rolling_sharpe_30d": rolling_sharpe,
        "drawdown_detail": dd_detail,
        "calmar_ratio": calmar,
        "sortino_ratio": sortino,
    }


def _demo_performance(period: str) -> PerformanceMetrics:
    """Generate a demo equity curve and performance metrics."""
    import random
    import math
    rng = random.Random(42)

    period_days_map = {"7d": 7, "30d": 30, "90d": 90, "1y": 252, "ytd": 60, "all": 500}
    n_points = period_days_map.get(period, 30)

    # Simulate daily PnL with slight positive drift
    equity_curve = []
    cumulative = 0.0
    daily_pnls: list[float] = []
    dates: list[str] = []
    today = date.today()
    for i in range(n_points):
        daily = rng.gauss(35, 200)  # mean $35/day, stdev $200
        daily_pnls.append(daily)
        cumulative += daily
        d = today - timedelta(days=(n_points - 1 - i))
        dates.append(d.isoformat())
        equity_curve.append({
            "date": d.isoformat(),
            "value": round(cumulative, 2),
            "cumulative_pnl": round(cumulative, 2),
        })

    # Scratch trades (pnl == 0) are excluded from both buckets per audit:
    # neither a win nor a loss, so win_rate = wins / (wins + losses).
    wins = [p for p in daily_pnls if p > 0]
    losses = [p for p in daily_pnls if p < 0]
    total_return = round(cumulative, 2)

    # Max drawdown against running PEAK EQUITY (base_equity + cumulative_pnl),
    # not peak P&L.
    base_equity = 100_000
    peak_equity = base_equity
    max_dd = 0.0
    running = 0.0
    for pnl in daily_pnls:
        running += pnl
        equity_i = base_equity + running
        if equity_i > peak_equity:
            peak_equity = equity_i
        dd = equity_i - peak_equity
        if dd < max_dd:
            max_dd = dd

    # Sharpe on daily **returns** (pnl / base_equity), not dollar P&Ls.
    daily_ret_frac = [p / base_equity for p in daily_pnls] if base_equity else []
    mean_ret = sum(daily_ret_frac) / len(daily_ret_frac) if daily_ret_frac else 0
    std_ret = math.sqrt(
        sum((p - mean_ret) ** 2 for p in daily_ret_frac)
        / max(len(daily_ret_frac) - 1, 1)
    ) if len(daily_ret_frac) > 1 else 0
    sharpe = round(mean_ret / std_ret * math.sqrt(252), 2) if std_ret > 0 else None

    enhanced = _compute_enhanced_metrics(daily_pnls, dates, base_equity=base_equity)

    decided_trades = len(wins) + len(losses)
    return PerformanceMetrics(
        period=period,
        total_return=total_return,
        total_return_pct=round(total_return / base_equity * 100, 2),
        sharpe_ratio=sharpe,
        sortino_ratio=enhanced["sortino_ratio"],
        max_drawdown=round(max_dd, 2),
        calmar_ratio=enhanced["calmar_ratio"],
        drawdown_detail=enhanced["drawdown_detail"],
        rolling_sharpe_30d=enhanced["rolling_sharpe_30d"],
        daily_returns=enhanced["daily_returns"],
        win_rate=round(len(wins) / decided_trades * 100, 1) if decided_trades else None,
        profit_factor=round(sum(wins) / abs(sum(losses)), 2) if losses and sum(losses) != 0 else None,
        avg_win=round(sum(wins) / len(wins), 2) if wins else None,
        avg_loss=round(sum(losses) / len(losses), 2) if losses else None,
        best_trade=round(max(daily_pnls), 2) if daily_pnls else None,
        worst_trade=round(min(daily_pnls), 2) if daily_pnls else None,
        total_trades=len(daily_pnls),
        equity_curve=equity_curve,
        is_demo=True,
    )


def _build_performance_from_pnls(
    period: str,
    daily_pnls: list[float],
    dates: list[str],
    trade_pnls: list[float],
    total_trades: int,
    is_demo: bool = False,
    base_equity: float = 100_000,
) -> PerformanceMetrics:
    """Build PerformanceMetrics from real P&L data (shared by ledger and DB paths)."""
    import math

    if not daily_pnls:
        return PerformanceMetrics(
            period=period, total_return=0, total_return_pct=0,
            equity_curve=[], is_demo=is_demo,
        )

    # Equity curve
    cumulative = 0.0
    equity_curve = []
    for i, pnl in enumerate(daily_pnls):
        cumulative += pnl
        equity_curve.append({
            "date": dates[i],
            "value": round(cumulative, 2),
            "cumulative_pnl": round(cumulative, 2),
        })

    total_return = round(cumulative, 2)

    # Win/loss from individual trade P&Ls — pnl==0 is a scratch, excluded from both.
    wins = [p for p in trade_pnls if p > 0]
    losses = [p for p in trade_pnls if p < 0]

    # Drawdown against running PEAK EQUITY, not peak P&L.
    _base = base_equity if base_equity and base_equity > 0 else 100_000
    running = 0.0
    peak_equity = _base
    max_dd = 0.0
    for pnl in daily_pnls:
        running += pnl
        equity_i = _base + running
        if equity_i > peak_equity:
            peak_equity = equity_i
        dd = equity_i - peak_equity
        if dd < max_dd:
            max_dd = dd

    # Sharpe on daily **returns** (pnl / base_equity), not dollar P&Ls.
    n = len(daily_pnls)
    daily_ret_frac = [p / _base for p in daily_pnls]
    mean_ret = sum(daily_ret_frac) / n if n > 0 else 0
    std_ret = math.sqrt(
        sum((p - mean_ret) ** 2 for p in daily_ret_frac) / max(n - 1, 1)
    ) if n > 1 else 0
    sharpe = round(mean_ret / std_ret * math.sqrt(252), 2) if std_ret > 0 else None

    # Enhanced metrics (drawdown / sortino / calmar / rolling Sharpe)
    enhanced = _compute_enhanced_metrics(daily_pnls, dates, _base)

    decided_trades = len(wins) + len(losses)
    return PerformanceMetrics(
        period=period,
        total_return=total_return,
        total_return_pct=round(total_return / _base * 100, 2),
        sharpe_ratio=sharpe,
        sortino_ratio=enhanced["sortino_ratio"],
        max_drawdown=round(max_dd, 2),
        calmar_ratio=enhanced["calmar_ratio"],
        drawdown_detail=enhanced["drawdown_detail"],
        rolling_sharpe_30d=enhanced["rolling_sharpe_30d"],
        daily_returns=enhanced["daily_returns"],
        win_rate=round(len(wins) / decided_trades * 100, 1) if decided_trades else None,
        profit_factor=round(sum(wins) / abs(sum(losses)), 2) if losses and sum(losses) != 0 else None,
        avg_win=round(sum(wins) / len(wins), 2) if wins else None,
        avg_loss=round(sum(losses) / len(losses), 2) if losses else None,
        best_trade=round(max(trade_pnls), 2) if trade_pnls else None,
        worst_trade=round(min(trade_pnls), 2) if trade_pnls else None,
        total_trades=total_trades,
        equity_curve=equity_curve,
        is_demo=is_demo,
    )


def _demo_greeks(is_demo: bool = False) -> PortfolioGreeks:
    """Return zero greeks when no option positions exist or when an
    upstream failure forces a fallback. ``is_demo=True`` flags the
    latter so the FE can show a "data unavailable" affordance instead
    of treating a flat-delta book as real."""
    return PortfolioGreeks(
        net_delta=0,
        net_gamma=0,
        net_theta=0,
        net_vega=0,
        beta_weighted_delta=0,
        by_position=[],
        is_demo=is_demo,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=PortfolioSummary)
async def get_portfolio_summary() -> PortfolioSummary:
    """Fetch portfolio summary from the broker account."""
    if _alpaca_keys_empty():
        logger.warning("Alpaca API keys not configured, serving demo portfolio summary")
        return _demo_portfolio_summary()

    try:
        from core.config import settings
        import httpx

        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/account",
                headers=headers,
            )
            if resp.status_code != 200:
                # Security audit R6: do NOT echo the upstream response body to
                # the client. Alpaca's error payloads have historically included
                # internal request IDs and account fragments; a compromised
                # session or an unauth probe triggering a 4xx would get a free
                # reconnaissance surface. Log server-side for ops, return a
                # generic upstream-error shape to the caller.
                logger.warning(
                    "Alpaca /v2/account upstream error: status=%s body=%s",
                    resp.status_code, resp.text[:500],
                )
                raise HTTPException(
                    status_code=502,
                    detail="Broker service unavailable, please retry",
                )
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
        total_mv = long_mv + abs(short_mv)
        # Percent unrealized is (current_mv - cost_basis) / cost_basis, not
        # / market_value. Previously divided by total_mv, which understates
        # the percentage on winners (denominator includes the gain) and
        # overstates on losers. Cost basis = market value - unrealized_pnl.
        cost_basis = total_mv - unrealized_pnl
        unrealized_pnl_pct = (unrealized_pnl / cost_basis * 100) if cost_basis > 0 else 0

        # Compute realized_pnl_today DIRECTLY from the trade ledger: sum of
        # pnl on trades whose exit_time falls on today's date.
        #
        # Wave 6α Fix 1 (persona-124 P0): the previous implementation
        # instantiated a ``TradeLedger`` and iterated Python-side over every
        # closed trade returned by ``get_closed_trades(start_date=today_str)``.
        # That path routes through ``list({"status": "closed"})`` which issues
        # ``SELECT * FROM trade_ledger WHERE status='closed'`` — a full scan
        # of every closed row ever written (≥50M at target scale) followed by
        # a Python-side date filter. The dashboard polls this endpoint on a
        # 60s interval, so the scan re-runs continuously.
        #
        # The new path pushes the aggregate into Postgres: a single scalar
        # query computing ``SUM(pnl) WHERE status='closed' AND exit_time ≥
        # start_of_today_et``. The supporting index
        # ``ix_trade_ledger_status_exit_time`` (alembic 0008) turns this into
        # an index range scan — bounded by "rows closed today" rather than
        # "rows ever closed".
        realized_pnl_today = 0.0
        if not settings.SKIP_DB_INIT:
            try:
                from sqlalchemy import text
                from core.database import _get_session_factory

                factory = _get_session_factory()
                async with factory() as session:
                    result = await session.execute(
                        text(
                            """
                            SELECT COALESCE(SUM(pnl), 0) AS total
                              FROM trade_ledger
                             WHERE status = 'closed'
                               AND exit_time >= date_trunc(
                                     'day', NOW() AT TIME ZONE 'America/New_York'
                                   )
                            """
                        )
                    )
                    total = result.scalar()
                realized_pnl_today = round(float(total or 0), 2)
            except Exception:
                logger.warning(
                    "Failed to compute realized_pnl_today from SQL aggregate; "
                    "defaulting to 0",
                    exc_info=True,
                )
                realized_pnl_today = 0.0

        return PortfolioSummary(
            equity=equity,
            cash=float(data.get("cash", 0)),
            buying_power=float(data.get("buying_power", 0)),
            total_market_value=long_mv + short_mv,
            unrealized_pnl=unrealized_pnl,
            unrealized_pnl_pct=unrealized_pnl_pct,
            realized_pnl_today=realized_pnl_today,
            day_pnl=round(day_pnl, 2),
            positions_count=positions_count_from_api or int(data.get("position_count", 0)),
            last_updated=datetime.now(timezone.utc),
        )
    except HTTPException:
        raise
    except Exception as exc:
        # Round-15 / persona-7 P0: do NOT silently serve demo equity on
        # a transient broker outage — the dashboard then reads
        # ``is_demo=True`` and may not surface that to the operator,
        # who acts on a fake $100k book. Demo fallback belongs only
        # behind the ``_alpaca_keys_empty()`` branch above (genuinely
        # not configured). For real failures, raise 502 so the caller
        # sees an explicit "broker unreachable" state.
        logger.error(
            "Portfolio summary fetch failed; returning 502 (refusing to serve demo)",
            exc_info=True,
        )
        raise HTTPException(
            status_code=502,
            detail="Broker unreachable — portfolio summary temporarily unavailable",
        ) from exc


@router.get("/performance", response_model=PerformanceMetrics)
async def get_performance(
    period: str = Query("30d", description="Period: 7d, 30d, 90d, 1y, ytd, all"),
) -> PerformanceMetrics:
    """Compute portfolio performance metrics over a given period.

    Priority:
    1. Trade ledger (JSON file) for closed trade P&L history
    2. Database trades
    3. Demo data as absolute last resort
    """
    from core.config import settings

    # --- Try trade ledger first (works even with SKIP_DB_INIT) ---
    try:
        from data.ingestion.trade_ledger import TradeLedger
        from collections import defaultdict

        ledger = TradeLedger()
        period_days_map = {"7d": 7, "30d": 30, "90d": 90, "1y": 365, "ytd": (date.today() - date(date.today().year, 1, 1)).days, "all": 3650}
        n_days = period_days_map.get(period, 30)
        cutoff_date = (date.today() - timedelta(days=n_days)).isoformat()

        closed = ledger.get_closed_trades(start_date=cutoff_date)
        if closed:
            logger.info("Building real performance from %d closed trades in ledger", len(closed))

            # Group P&L by exit date
            daily_pnl_map: dict[str, float] = defaultdict(float)
            all_pnls: list[float] = []
            for t in closed:
                pnl = t.get("pnl") or 0
                exit_time = t.get("exit_time", "")
                day_key = exit_time[:10] if exit_time else date.today().isoformat()
                daily_pnl_map[day_key] += pnl
                all_pnls.append(pnl)

            sorted_dates = sorted(daily_pnl_map.keys())
            daily_pnls = [daily_pnl_map[d] for d in sorted_dates]

            return _build_performance_from_pnls(
                period=period,
                daily_pnls=daily_pnls,
                dates=sorted_dates,
                trade_pnls=all_pnls,
                total_trades=len(closed),
                is_demo=False,
            )
    except Exception:
        logger.warning("Trade ledger performance computation failed", exc_info=True)

    # --- Try database trades ---
    if not settings.SKIP_DB_INIT:
        try:
            import numpy as np
            from sqlalchemy import select
            from data.storage.models import Trade
            from core.database import _get_session_factory

            period_days = {"7d": 7, "30d": 30, "90d": 90, "1y": 365, "ytd": (date.today() - date(date.today().year, 1, 1)).days, "all": 3650}
            days = period_days.get(period, 30)
            cutoff = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0)
            cutoff -= timedelta(days=days)

            factory = _get_session_factory()
            async with factory() as db:
                result = await db.execute(
                    select(Trade)
                    .where(Trade.entry_time >= cutoff, Trade.status == "closed")
                    .order_by(Trade.entry_time)
                )
                trades = result.scalars().all()

            if trades:
                logger.info("Building real performance from %d closed DB trades", len(trades))
                pnls = [t.pnl for t in trades if t.pnl is not None]
                returns_dollars = np.array(pnls) if pnls else np.array([0.0])

                total_return = float(np.sum(returns_dollars))
                wins = returns_dollars[returns_dollars > 0]
                losses = returns_dollars[returns_dollars < 0]

                # Equity curve (cumulative P&L added to starting equity)
                base_equity = 100_000  # TODO: thread actual account equity
                cumulative = np.cumsum(returns_dollars)
                equity_series = base_equity + cumulative
                running_peak = np.maximum.accumulate(equity_series)
                drawdowns = (equity_series - running_peak)
                max_dd = float(np.min(drawdowns)) if len(drawdowns) > 0 else 0

                # Convert per-trade dollar P&Ls to returns vs account equity.
                # Per-trade returns annualised via sqrt(252) over-states Sharpe
                # for multi-day holds — this path is the "trade-count as day-count"
                # approximation. TODO: derive a true daily-equity series for an
                # accurate annualisation factor.
                daily_ret_frac = returns_dollars / base_equity if base_equity else returns_dollars
                mean_ret = float(np.mean(daily_ret_frac)) if len(daily_ret_frac) > 1 else 0
                std_ret = float(np.std(daily_ret_frac, ddof=1)) if len(daily_ret_frac) > 1 else 0
                # Sortino downside: divide SUM(min(r,0)^2) by TOTAL N (LPM₂),
                # not just the count of negative observations.
                downside_sq = np.sum(np.minimum(daily_ret_frac, 0.0) ** 2)
                downside_std = (
                    float(np.sqrt(downside_sq / len(daily_ret_frac)))
                    if len(daily_ret_frac) > 0 else 0
                )

                sharpe = (mean_ret / std_ret * np.sqrt(252)) if std_ret > 0 else None
                sortino = (mean_ret / downside_std * np.sqrt(252)) if downside_std > 0 else None

                gross_wins = float(np.sum(wins)) if len(wins) else 0
                gross_losses = abs(float(np.sum(losses))) if len(losses) else 1
                profit_factor = gross_wins / gross_losses if gross_losses > 0 else None

                # Build equity curve with date and cumulative_pnl.
                # qa2-team-B: previously each trade's cumulative P&L was
                # labelled with a synthetic date derived from its POSITION in
                # the list (``today - (n_points - 1 - i) days``) rather than
                # the trade's actual exit_time. That projected every closed
                # trade onto the last N consecutive calendar days ending
                # today, silently misdating the entire equity curve whenever
                # there were gaps between trades. Use the trade's real
                # exit_time (fall back to entry_time) so the x-axis reflects
                # when P&L actually landed.
                today_d = date.today()
                equity_curve_data = []
                trade_dates: list[str] = []
                for c, t in zip(cumulative, trades):
                    dt_obj = t.exit_time or t.entry_time
                    d_str = dt_obj.date().isoformat() if dt_obj else today_d.isoformat()
                    trade_dates.append(d_str)
                    equity_curve_data.append({
                        "date": d_str,
                        "value": round(float(c), 2),
                        "cumulative_pnl": round(float(c), 2),
                    })

                enhanced = _compute_enhanced_metrics(pnls, trade_dates, base_equity)

                # Scratch trades are excluded from win_rate denominator.
                decided_trades = int(len(wins) + len(losses))
                return PerformanceMetrics(
                    period=period,
                    total_return=round(total_return, 2),
                    total_return_pct=round(total_return / base_equity * 100, 2),
                    sharpe_ratio=round(float(sharpe), 2) if sharpe else None,
                    sortino_ratio=round(float(sortino), 2) if sortino else enhanced["sortino_ratio"],
                    max_drawdown=round(max_dd, 2),
                    calmar_ratio=enhanced["calmar_ratio"],
                    drawdown_detail=enhanced["drawdown_detail"],
                    rolling_sharpe_30d=enhanced["rolling_sharpe_30d"],
                    daily_returns=enhanced["daily_returns"],
                    win_rate=round(len(wins) / decided_trades * 100, 1) if decided_trades else None,
                    profit_factor=round(profit_factor, 2) if profit_factor else None,
                    avg_win=round(float(np.mean(wins)), 2) if len(wins) else None,
                    avg_loss=round(float(np.mean(losses)), 2) if len(losses) else None,
                    best_trade=round(float(np.max(returns_dollars)), 2) if len(returns_dollars) else None,
                    worst_trade=round(float(np.min(returns_dollars)), 2) if len(returns_dollars) else None,
                    total_trades=len(trades),
                    equity_curve=equity_curve_data,
                )
        except Exception:
            logger.warning("Failed to compute performance from DB", exc_info=True)

    # --- Absolute last resort: demo ---
    logger.warning("No real trade data available for performance, returning demo")
    return _demo_performance(period)


# Slice-10 / BWD-1 (2026 design brief, Tastytrade signature):
# beta-to-SPY lookup for the curated universe. Numbers are 5-year
# weekly betas, rounded to one decimal — they don't move enough
# week-to-week to warrant a real-time computation pass for the
# initial ship. Unknown symbols default to 1.0 (SPY-like assumption);
# operators can override per-symbol via env once a backfill ships.
_BETA_TO_SPY: dict[str, float] = {
    # Mega-cap tech (high beta)
    "TSLA": 2.0, "NVDA": 1.7, "META": 1.4, "AMD": 1.6, "CRM": 1.3,
    "AMZN": 1.2, "GOOGL": 1.1, "GOOG": 1.1, "MSFT": 0.9, "AAPL": 1.2,
    "NFLX": 1.3, "ADBE": 1.1, "ORCL": 0.9, "AVGO": 1.4, "QCOM": 1.3,
    "PLTR": 2.6, "COIN": 3.0, "CRWD": 1.5, "SNOW": 1.6, "MU": 1.5,
    "INTC": 0.9, "MRVL": 1.5, "NET": 1.7, "DDOG": 1.5, "MDB": 1.6,
    "CSCO": 0.8, "IBM": 0.7, "INTU": 1.2, "NOW": 1.2, "PANW": 1.2,
    "WDAY": 1.2, "FTNT": 1.0, "ZS": 1.7, "TEAM": 1.5, "CDNS": 1.1,
    "SNPS": 1.2,
    # Index ETFs
    "SPY": 1.0, "QQQ": 1.1, "IWM": 1.2, "DIA": 0.95, "VTI": 1.0,
    # Defensive / low-beta
    "JNJ": 0.6, "PG": 0.5, "KO": 0.6, "PEP": 0.6, "WMT": 0.6,
    "MCD": 0.7, "VZ": 0.4, "T": 0.5, "DUK": 0.5, "SO": 0.4,
    "XOM": 0.8, "CVX": 0.9, "BRK.B": 0.85, "BRKB": 0.85,
    "CL": 0.5, "MO": 0.5, "PM": 0.5, "MDLZ": 0.6, "WM": 0.7,
    "NEE": 0.6, "AMT": 0.7, "PLD": 1.1, "COST": 0.8, "TJX": 0.8,
    # Financials (mid-beta)
    "JPM": 1.1, "BAC": 1.3, "WFC": 1.2, "GS": 1.3, "MS": 1.4,
    "V": 0.95, "MA": 1.0, "AXP": 1.2,
    "BLK": 1.3, "BX": 1.5, "C": 1.4, "CB": 0.7, "CME": 0.6,
    "ICE": 0.9, "MMC": 0.7, "SCHW": 1.2, "SPGI": 1.0,
    # Healthcare
    "LLY": 0.7, "UNH": 0.7, "ABBV": 0.7, "PFE": 0.6, "MRK": 0.6,
    "TMO": 0.9, "ABT": 0.9, "BMY": 0.6, "GILD": 0.6, "AMGN": 0.7,
    "BSX": 0.8, "CI": 0.7, "CVS": 0.6, "DHR": 0.9, "ELV": 0.7,
    "ISRG": 1.1, "MDT": 0.7, "REGN": 0.7, "SYK": 0.9, "VRTX": 0.7,
    "ZTS": 0.9,
    # Industrial / cyclical
    "BA": 1.5, "CAT": 1.1, "DE": 1.1, "GE": 1.0, "HON": 1.0,
    "F": 1.4, "GM": 1.5, "RTX": 0.9, "LMT": 0.6,
    "ETN": 1.0, "GEV": 1.2, "UNP": 0.9, "APH": 1.0,
    # Consumer cyclical
    "DIS": 1.1, "NKE": 1.0, "HD": 1.0, "LOW": 1.1, "SBUX": 0.95,
    "ABNB": 1.4, "BKNG": 1.2, "UBER": 1.5, "SPOT": 1.5,
    # High-beta growth
    "SHOP": 1.9, "SQ": 1.9, "ROKU": 2.1, "CVNA": 3.5, "RBLX": 1.8,
    "DASH": 1.6, "SOFI": 2.5, "HOOD": 2.1, "RIVN": 2.5, "LCID": 2.5,
    "PYPL": 1.6,
    # Semis (cyclical, high-beta)
    "TSM": 1.3, "ASML": 1.2, "LRCX": 1.5, "KLAC": 1.4, "AMAT": 1.4,
    "ADI": 1.1, "TXN": 1.0, "ANET": 1.4,
    # Energy / materials
    "COP": 1.0, "LIN": 0.8, "SHW": 0.8,
    # Services / payments
    "ACN": 1.0, "ADP": 0.9, "FI": 1.0,
    # ADRs
    "BABA": 1.3,
}


# Bound the log-on-miss volume — once per symbol per process, a
# heavy desk doesn't spam the journal with the same warning.
_BETA_MISS_LOGGED: set[str] = set()


def _beta_to_spy(symbol: str) -> float:
    """Look up the symbol's beta-to-SPY for portfolio-level
    directional exposure aggregation. Defaults to 1.0 when unknown
    (treat as SPY-like). The map is hand-curated for the ~136
    optionable curated universe; refresh quarterly via a portfolio
    analytics backfill (future work)."""
    key = symbol.upper().split("/")[0]
    beta = _BETA_TO_SPY.get(key)
    if beta is None:
        if key not in _BETA_MISS_LOGGED:
            _BETA_MISS_LOGGED.add(key)
            logger.info(
                "BWD beta lookup miss for %s — defaulting to 1.0 (SPY-like). "
                "Add to _BETA_TO_SPY when this symbol is in regular rotation.",
                key,
            )
        return 1.0
    return beta


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
        # Slice-10 / BWD-1: beta-weighted delta is the Tastytrade-signature
        # portfolio metric. Sums each position's delta times its
        # symbol-to-SPY beta, normalising directional exposure across
        # symbols that move at different magnitudes vs the index. A
        # portfolio of +200 AAPL delta + +200 TSLA delta has 400 total
        # delta but a beta-weighted delta of (200×1.2) + (200×2.0) =
        # 640 SPY-equivalent — which is the more honest "if SPY drops
        # 1%, my book drops X%" measurement.
        beta_weighted_delta = 0.0
        by_position = []

        for pos in positions.get("positions", []):
            greeks = pos.get("greeks", {})
            qty = pos.get("quantity", 0)
            asset_class = pos.get("asset_class", "us_equity")
            is_option = asset_class == "option"
            multiplier = 100 if is_option else 1
            symbol = pos.get("symbol", "")

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

            # Underlying for option positions is encoded in the OCC; for
            # stocks the symbol IS the underlying. Strip option-symbol
            # suffix (YYMMDD + C/P + strike) heuristically — first
            # alphabetic prefix is the underlying ticker.
            underlying = symbol
            if is_option and len(symbol) > 9:
                underlying = "".join(
                    ch for ch in symbol[: len(symbol) - 15] if ch.isalpha()
                ) or symbol
            beta = _beta_to_spy(underlying)

            net_delta += d
            net_gamma += g
            net_theta += t
            net_vega += v
            beta_weighted_delta += d * beta

            by_position.append({
                "symbol": symbol,
                "quantity": qty,
                "delta": round(d, 2),
                "gamma": round(g, 4),
                "theta": round(t, 2),
                "vega": round(v, 2),
                # Slice-10 / BWD-1: per-position beta + BWD contribution
                # so the FE can show a "by-position attribution" panel
                # ranking which positions drive the book's beta.
                "beta": round(beta, 2),
                "beta_weighted_delta": round(d * beta, 2),
            })

        return PortfolioGreeks(
            net_delta=round(net_delta, 2),
            net_gamma=round(net_gamma, 4),
            net_theta=round(net_theta, 2),
            net_vega=round(net_vega, 2),
            beta_weighted_delta=round(beta_weighted_delta, 2),
            by_position=by_position,
        )
    except Exception:
        # Round-15 / persona-7 P0: surface the failure to the FE via
        # ``is_demo=True`` instead of returning zeros that look like
        # "you have no options" — flat-delta on a real options book
        # is actionably wrong.
        logger.error(
            "Failed to compute portfolio greeks; returning is_demo=true fallback",
            exc_info=True,
        )
        return _demo_greeks(is_demo=True)


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
                                logger.debug(
                                    "calendar: latest-trade fetch failed for %s",
                                    sym, exc_info=True,
                                )
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


# ---------------------------------------------------------------------------
# Morning Brief
# ---------------------------------------------------------------------------

class MorningBriefMover(BaseModel):
    symbol: str
    change_pct: float
    impact: float


class MorningBriefPortfolio(BaseModel):
    equity: float
    overnight_change: float
    overnight_change_pct: float


class MorningBriefMarket(BaseModel):
    regime: str
    vix: float
    vix_change: float
    spy_change_pct: float


class MorningBriefResponse(BaseModel):
    date: str
    portfolio: MorningBriefPortfolio
    top_movers: list[MorningBriefMover]
    market: MorningBriefMarket
    catalysts: list[str]
    ai_summary: str
    is_demo: bool = False


def _generate_brief_summary(
    portfolio: dict[str, float],
    movers: list[dict[str, Any]],
    market: dict[str, Any],
) -> str:
    """Template-based AI summary — fast, no external API call."""
    parts: list[str] = []

    # Portfolio direction
    change = portfolio.get("overnight_change", 0)
    if change > 0:
        parts.append(f"Portfolio up ${change:.2f} overnight.")
    elif change < 0:
        parts.append(f"Portfolio down ${abs(change):.2f} overnight.")
    else:
        parts.append("Portfolio flat overnight.")

    # VIX commentary
    vix = market.get("vix", 0)
    if vix > 30:
        parts.append(f"VIX elevated at {vix:.1f} — consider defensive positioning and tightening stops.")
    elif vix > 25:
        parts.append(f"VIX elevated at {vix:.1f} — stay cautious with position sizing.")
    elif vix > 20:
        parts.append(f"VIX at {vix:.1f} indicates moderate uncertainty.")
    elif vix > 0:
        parts.append(f"VIX at {vix:.1f} — low volatility environment favors trend strategies.")

    # SPY move
    spy_pct = market.get("spy_change_pct", 0)
    if abs(spy_pct) > 1:
        direction = "rallied" if spy_pct > 0 else "declined"
        parts.append(f"S&P 500 {direction} {abs(spy_pct):.1f}% — watch for follow-through.")

    # Top mover callout
    if movers:
        top = movers[0]
        direction = "up" if top.get("change_pct", 0) > 0 else "down"
        parts.append(
            f"{top['symbol']} {direction} {abs(top.get('change_pct', 0)):.1f}%"
            f" (${abs(top.get('impact', 0)):.2f} portfolio impact)."
        )

    # Regime guidance
    regime = market.get("regime", "")
    if "bear" in regime.lower():
        parts.append("Bear regime active — prioritize capital preservation.")
    elif "bull" in regime.lower() and "high" in regime.lower():
        parts.append("Bull regime with high volatility — size positions conservatively.")

    return " ".join(parts)


def _upcoming_catalysts() -> list[str]:
    """Return a short list of upcoming economic catalysts based on day of week."""
    catalysts_pool = [
        ("FOMC Minutes", 2),       # Wednesday
        ("Non-Farm Payrolls", 4),  # Friday
        ("CPI Report", 1),         # Tuesday
        ("Retail Sales", 3),       # Thursday
        ("Initial Claims", 3),     # Thursday
        ("Core PCE", 4),           # Friday
        ("PMI Manufacturing", 0),  # Monday
        ("Consumer Confidence", 1),# Tuesday
        ("GDP (QoQ)", 3),          # Thursday
    ]
    today = date.today()
    result: list[str] = []
    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    for event, target_dow in catalysts_pool:
        diff = target_dow - today.weekday()
        if diff <= 0:
            diff += 7
        if diff <= 5:  # within next 5 trading days
            d = today + timedelta(days=diff)
            result.append(f"{event} ({day_names[d.weekday()]})")
        if len(result) >= 4:
            break
    return result


def _demo_morning_brief() -> MorningBriefResponse:
    """Generate a deterministic demo morning brief."""
    import random
    rng = random.Random(date.today().toordinal())

    equity = 100_000 + rng.uniform(-2000, 5000)
    overnight = rng.uniform(-150, 200)
    overnight_pct = overnight / equity * 100

    demo_symbols = ["AAPL", "MSFT", "NVDA", "GOOGL", "BA", "MRK", "JPM", "AMZN"]
    movers = []
    for sym in rng.sample(demo_symbols, min(4, len(demo_symbols))):
        chg = rng.uniform(-3.5, 4.0)
        impact = rng.uniform(-50, 60)
        movers.append({"symbol": sym, "change_pct": round(chg, 2), "impact": round(impact, 2)})
    movers.sort(key=lambda m: abs(m["impact"]), reverse=True)

    vix = round(rng.uniform(14, 32), 1)
    vix_change = round(rng.uniform(-2, 2), 1)
    spy_pct = round(rng.uniform(-1.5, 2.0), 2)
    regime_options = [
        "Bull - Low Volatility", "Bull - High Volatility",
        "Bear - High Volatility", "Sideways - Low Volatility",
    ]
    regime = rng.choice(regime_options)

    portfolio_data = {
        "equity": round(equity, 2),
        "overnight_change": round(overnight, 2),
        "overnight_change_pct": round(overnight_pct, 2),
    }
    market_data = {
        "regime": regime,
        "vix": vix,
        "vix_change": vix_change,
        "spy_change_pct": spy_pct,
    }

    return MorningBriefResponse(
        date=date.today().isoformat(),
        portfolio=MorningBriefPortfolio(**portfolio_data),
        top_movers=[MorningBriefMover(**m) for m in movers[:3]],
        market=MorningBriefMarket(**market_data),
        catalysts=_upcoming_catalysts(),
        ai_summary=_generate_brief_summary(portfolio_data, movers[:3], market_data),
        is_demo=True,
    )


@router.get("/morning-brief", response_model=MorningBriefResponse)
async def get_morning_brief() -> MorningBriefResponse:
    """Generate a personalized morning brief for the trader.

    Uses real Alpaca account data + real SPY/VIXY snapshots.
    Falls back to demo only if Alpaca is unreachable.
    """
    if _alpaca_keys_empty():
        logger.warning("Alpaca API keys not configured, serving demo morning brief")
        return _demo_morning_brief()

    try:
        from core.config import settings
        import httpx

        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }

        async with httpx.AsyncClient(timeout=10) as client:
            # --- Fetch account + positions + market snapshots in parallel ---
            import asyncio

            account_coro = client.get(
                f"{settings.ALPACA_BASE_URL}/v2/account", headers=headers
            )
            positions_coro = client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions", headers=headers
            )
            spy_snap_coro = client.get(
                "https://data.alpaca.markets/v2/stocks/snapshots?symbols=SPY,VIXY",
                headers=headers,
            )

            acct_resp, pos_resp, snap_resp = await asyncio.gather(
                account_coro, positions_coro, spy_snap_coro,
                return_exceptions=True,
            )

            # --- Parse account ---
            if isinstance(acct_resp, Exception) or acct_resp.status_code != 200:
                logger.warning("Alpaca account API unreachable (status=%s), serving demo brief",
                               acct_resp.status_code if not isinstance(acct_resp, Exception) else str(acct_resp))
                return _demo_morning_brief()
            acct = acct_resp.json()
            equity = float(acct.get("equity", 0))
            last_equity = float(acct.get("last_equity", equity))
            overnight_change = round(equity - last_equity, 2)
            overnight_pct = round(
                (overnight_change / last_equity * 100) if last_equity > 0 else 0, 2
            )

            # --- Parse positions for top movers ---
            movers: list[dict[str, Any]] = []
            if not isinstance(pos_resp, Exception) and pos_resp.status_code == 200:
                positions_data = pos_resp.json()
                for p in positions_data:
                    sym = p.get("symbol", "")
                    change_pct = float(p.get("change_today", 0)) * 100
                    unrealized = float(p.get("unrealized_intraday_pl", 0))
                    movers.append({
                        "symbol": sym,
                        "change_pct": round(change_pct, 2),
                        "impact": round(unrealized, 2),
                    })
                movers.sort(key=lambda m: abs(m["impact"]), reverse=True)

            # --- Parse SPY/VIX snapshots ---
            spy_change_pct = 0.0
            vix_price = 0.0
            vix_change = 0.0
            if not isinstance(snap_resp, Exception) and snap_resp.status_code == 200:
                snaps = snap_resp.json()
                spy_snap = snaps.get("SPY", {})
                if spy_snap:
                    spy_price = spy_snap.get("latestTrade", {}).get("p", 0)
                    spy_prev = spy_snap.get("prevDailyBar", {}).get("c", 0)
                    if spy_prev > 0:
                        spy_change_pct = round((spy_price - spy_prev) / spy_prev * 100, 2)

                vixy_snap = snaps.get("VIXY", {})
                if vixy_snap:
                    vix_price = round(vixy_snap.get("latestTrade", {}).get("p", 0), 1)
                    vixy_prev = vixy_snap.get("prevDailyBar", {}).get("c", 0)
                    if vixy_prev > 0:
                        vix_change = round(vix_price - vixy_prev, 1)

            # --- Determine regime ---
            regime_label = "Unknown"
            try:
                from core.redis import cache_get
                cached_regime = await cache_get("market:regime")
                if cached_regime and isinstance(cached_regime, dict):
                    regime_label = cached_regime.get("regime", "Unknown")
            except Exception:
                # Infer from VIX level if cache unavailable
                if vix_price > 25:
                    regime_label = "High Volatility"
                elif vix_price > 0:
                    if spy_change_pct > 0:
                        regime_label = "Bull - Low Volatility"
                    else:
                        regime_label = "Sideways"

            portfolio_data = {
                "equity": equity,
                "overnight_change": overnight_change,
                "overnight_change_pct": overnight_pct,
            }
            market_data = {
                "regime": regime_label,
                "vix": vix_price,
                "vix_change": vix_change,
                "spy_change_pct": spy_change_pct,
            }

            return MorningBriefResponse(
                date=date.today().isoformat(),
                portfolio=MorningBriefPortfolio(**portfolio_data),
                top_movers=[MorningBriefMover(**m) for m in movers[:3]],
                market=MorningBriefMarket(**market_data),
                catalysts=_upcoming_catalysts(),
                ai_summary=_generate_brief_summary(portfolio_data, movers[:3], market_data),
                is_demo=False,
            )

    except Exception:
        logger.warning("Failed to generate morning brief, falling back to demo", exc_info=True)
        return _demo_morning_brief()
