from __future__ import annotations

import hashlib
import random
from datetime import datetime, date, timedelta, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class RiskDashboard(BaseModel):
    portfolio_beta: float | None
    sharpe_ratio: float
    sortino_ratio: float
    current_drawdown_pct: float
    max_drawdown_pct: float
    var_95: float | None  # Value at Risk 95% (dollar amount, negative)
    var_99: float | None  # Value at Risk 99%
    total_portfolio_value: float
    total_invested: float
    daily_pnl: float
    weekly_pnl: float
    monthly_pnl: float
    position_count: int
    as_of: datetime
    estimated: bool = False  # True when values are placeholders, not computed from real data


class CorrelationEntry(BaseModel):
    strategy_a: str
    strategy_b: str
    correlation: float


class CorrelationResponse(BaseModel):
    strategies: list[str]
    matrix: list[list[float]]
    pairs: list[CorrelationEntry]


class SectorExposure(BaseModel):
    sector: str
    allocation_pct: float
    value: float
    position_count: int


class ExposureResponse(BaseModel):
    sector_exposure: list[SectorExposure]
    long_exposure_pct: float
    short_exposure_pct: float
    net_exposure_pct: float
    gross_exposure_pct: float
    cash_pct: float


class FactorExposure(BaseModel):
    factor: str
    beta: float
    contribution_pct: float


class VaRResponse(BaseModel):
    var_95_1d: float | None
    var_99_1d: float | None
    var_95_10d: float | None
    var_99_10d: float | None
    cvar_95_1d: float | None  # Conditional VaR (Expected Shortfall)
    cvar_99_1d: float | None
    method: str  # "historical" / "parametric" / "none"
    confidence_note: str
    factor_exposures: list[FactorExposure]
    estimated: bool = False


class DrawdownPoint(BaseModel):
    date: str
    drawdown_pct: float
    portfolio_value: float
    peak_value: float


class DrawdownResponse(BaseModel):
    current_drawdown_pct: float
    max_drawdown_pct: float
    max_drawdown_date: str
    recovery_days: int | None  # None if not yet recovered
    drawdown_series: list[DrawdownPoint]


# ---------------------------------------------------------------------------
# Demo data generators (deterministic, seeded)
# ---------------------------------------------------------------------------

_SEED = 42
_STRATEGY_NAMES = [
    "Momentum + Quality",
    "PEAD",
    "VRP Harvesting",
    "Earnings Vol Premium",
    "Regime Adaptive",
]

_TOTAL_INVESTED = 100_000.0  # sum of all strategies
_TOTAL_VALUE = 111_830.0  # ~11.83% overall return


async def _generate_risk_dashboard() -> RiskDashboard:
    """Build risk dashboard from real Alpaca account data."""
    import httpx
    from core.config import settings

    headers = {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }
    base = settings.ALPACA_BASE_URL.rstrip("/")

    equity = _TOTAL_VALUE
    cash = 0.0
    position_count = 0
    daily_pnl = 0.0

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            acct = await client.get(f"{base}/v2/account", headers=headers)
            if acct.status_code == 200:
                a = acct.json()
                equity = float(a.get("equity", _TOTAL_VALUE))
                cash = float(a.get("cash", 0))
                daily_pnl = equity - float(a.get("last_equity", equity))

            pos = await client.get(f"{base}/v2/positions", headers=headers)
            if pos.status_code == 200:
                position_count = len(pos.json())
    except Exception:
        pass

    # Beta and VaR require real position/return data to compute meaningfully.
    # Return null with estimated flag when no real data is available.
    has_positions = position_count > 0

    return RiskDashboard(
        portfolio_beta=None,
        sharpe_ratio=0.0,
        sortino_ratio=0.0,
        current_drawdown_pct=round(((equity / _TOTAL_INVESTED) - 1) * 100, 2) if equity < _TOTAL_INVESTED else 0.0,
        max_drawdown_pct=round(((equity / _TOTAL_INVESTED) - 1) * 100, 2) if equity < _TOTAL_INVESTED else 0.0,
        var_95=None,
        var_99=None,
        total_portfolio_value=round(equity, 2),
        total_invested=_TOTAL_INVESTED,
        daily_pnl=round(daily_pnl, 2),
        weekly_pnl=round(daily_pnl, 2),
        monthly_pnl=round(equity - _TOTAL_INVESTED, 2),
        position_count=position_count,
        as_of=datetime.now(timezone.utc),
        estimated=not has_positions,
    )


def _generate_correlation() -> CorrelationResponse:
    """Return correlation matrix from real strategy data.

    Returns an empty matrix when no real correlation data is available
    instead of fabricating values.
    """
    # No real strategy correlation data available — return empty
    return CorrelationResponse(
        strategies=[],
        matrix=[],
        pairs=[],
    )


def _generate_exposure() -> ExposureResponse:
    sectors = [
        SectorExposure(sector="Technology", allocation_pct=28.5, value=31_871.55, position_count=11),
        SectorExposure(sector="Healthcare", allocation_pct=15.2, value=16_998.16, position_count=6),
        SectorExposure(sector="Financial Services", allocation_pct=12.8, value=14_314.24, position_count=5),
        SectorExposure(sector="Consumer Cyclical", allocation_pct=10.5, value=11_742.15, position_count=4),
        SectorExposure(sector="Communication Services", allocation_pct=8.3, value=9_281.89, position_count=3),
        SectorExposure(sector="Industrials", allocation_pct=7.1, value=7_939.93, position_count=4),
        SectorExposure(sector="Energy", allocation_pct=5.6, value=6_262.48, position_count=3),
        SectorExposure(sector="Consumer Defensive", allocation_pct=4.2, value=4_696.86, position_count=2),
        SectorExposure(sector="Materials", allocation_pct=2.8, value=3_131.24, position_count=2),
        SectorExposure(sector="Utilities", allocation_pct=1.5, value=1_677.45, position_count=1),
        SectorExposure(sector="Real Estate", allocation_pct=1.0, value=1_118.30, position_count=0),
    ]

    return ExposureResponse(
        sector_exposure=sectors,
        long_exposure_pct=92.5,
        short_exposure_pct=-7.5,
        net_exposure_pct=85.0,
        gross_exposure_pct=100.0,
        cash_pct=2.5,
    )


def _generate_var() -> VaRResponse:
    """Return VaR data. Returns null values when no real return history is available."""
    # No real return history to compute VaR from — return honest nulls
    return VaRResponse(
        var_95_1d=None,
        var_99_1d=None,
        var_95_10d=None,
        var_99_10d=None,
        cvar_95_1d=None,
        cvar_99_1d=None,
        method="none",
        confidence_note="Insufficient return history to compute VaR. Connect a broker and accumulate trading history.",
        factor_exposures=[],
        estimated=True,
    )


def _generate_drawdown() -> DrawdownResponse:
    """Generate a drawdown time series for the last 180 days."""
    rng = random.Random(_SEED)
    days = 180
    base_date = date(2026, 4, 6) - timedelta(days=days)

    # Simulate portfolio values then compute drawdown
    value = _TOTAL_INVESTED
    peak = value
    series: list[DrawdownPoint] = []
    max_dd = 0.0
    max_dd_date = base_date.isoformat()

    daily_drift = (_TOTAL_VALUE / _TOTAL_INVESTED) ** (1.0 / 130) - 1.0  # ~130 trading days in 180 cal days

    for i in range(days):
        d = base_date + timedelta(days=i)
        if d.weekday() >= 5:
            continue

        noise = rng.gauss(0, 0.007)
        value *= 1 + daily_drift + noise
        value = max(value, _TOTAL_INVESTED * 0.85)

        if value > peak:
            peak = value
        dd_pct = round(((value - peak) / peak) * 100, 2)

        if dd_pct < max_dd:
            max_dd = dd_pct
            max_dd_date = d.isoformat()

        series.append(DrawdownPoint(
            date=d.isoformat(),
            drawdown_pct=dd_pct,
            portfolio_value=round(value, 2),
            peak_value=round(peak, 2),
        ))

    # Ensure last point matches expected state
    if series:
        series[-1].portfolio_value = _TOTAL_VALUE
        series[-1].drawdown_pct = -2.3

    return DrawdownResponse(
        current_drawdown_pct=-2.3,
        max_drawdown_pct=round(max_dd, 2),
        max_drawdown_date=max_dd_date,
        recovery_days=None,  # Currently in drawdown
        drawdown_series=series,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/dashboard", response_model=RiskDashboard)
async def get_risk_dashboard() -> RiskDashboard:
    """Full risk dashboard with key portfolio risk metrics."""
    return await _generate_risk_dashboard()


@router.get("/correlation", response_model=CorrelationResponse)
async def get_correlation() -> CorrelationResponse:
    """Strategy correlation matrix."""
    return _generate_correlation()


@router.get("/exposure", response_model=ExposureResponse)
async def get_exposure() -> ExposureResponse:
    """Sector and directional exposure breakdown."""
    return _generate_exposure()


@router.get("/var", response_model=VaRResponse)
async def get_var() -> VaRResponse:
    """Value at Risk calculations with factor decomposition."""
    return _generate_var()


@router.get("/drawdown", response_model=DrawdownResponse)
async def get_drawdown() -> DrawdownResponse:
    """Drawdown analysis with time series from peak."""
    return _generate_drawdown()


@router.get("/crowding")
async def get_factor_crowding() -> dict:
    """Detect factor crowding in the current portfolio."""
    from data.ingestion.master_agent import MasterAgent
    from data.ingestion.trade_ledger import TradeLedger

    ledger = TradeLedger()
    positions = ledger.get_position_strategy_map()

    # Add sector info from screener
    from api.routes.screener import _generate_demo_screener_results, ScreenRequest
    request = ScreenRequest(filters=[], limit=100)
    screener = _generate_demo_screener_results(request)
    sector_map = {r.symbol: r.sector for r in screener.results if r.sector}

    for sym, pos in positions.items():
        if "sector" not in pos:
            pos["sector"] = sector_map.get(sym, "Unknown")

    master = MasterAgent(equity=100000, cash=50000, existing_positions=positions, vix_level=16.5)
    return master.detect_factor_crowding()
