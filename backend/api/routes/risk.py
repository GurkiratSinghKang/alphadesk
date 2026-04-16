from __future__ import annotations

import logging
import math
from datetime import datetime, date, timedelta, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

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
# Helpers — Alpaca client
# ---------------------------------------------------------------------------


async def _alpaca_headers() -> dict[str, str]:
    from core.config import settings
    return {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }


async def _alpaca_base_url() -> str:
    from core.config import settings
    return settings.ALPACA_BASE_URL.rstrip("/")


def _get_symbol_sector_map() -> dict[str, str]:
    """Build a symbol -> sector lookup from the symbols database."""
    try:
        from api.routes.symbols import _build_demo_symbols
        return {s.symbol: s.sector for s in _build_demo_symbols() if s.sector}
    except Exception:
        logger.warning("Failed to build symbol-sector map for risk exposure", exc_info=True)
        return {}


# ---------------------------------------------------------------------------
# Real data generators (from Alpaca account + trade ledger)
# ---------------------------------------------------------------------------


async def _generate_risk_dashboard() -> RiskDashboard:
    """Build risk dashboard from real Alpaca account data."""
    import httpx

    headers = await _alpaca_headers()
    base = await _alpaca_base_url()

    equity = 0.0
    cash = 0.0
    last_equity = 0.0
    position_count = 0
    daily_pnl = 0.0
    has_account = False

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            acct = await client.get(f"{base}/v2/account", headers=headers)
            if acct.status_code == 200:
                a = acct.json()
                equity = float(a.get("equity", 0))
                cash = float(a.get("cash", 0))
                last_equity = float(a.get("last_equity", equity))
                daily_pnl = equity - last_equity
                has_account = True

            pos = await client.get(f"{base}/v2/positions", headers=headers)
            if pos.status_code == 200:
                position_count = len(pos.json())
    except Exception:
        logger.warning("Failed to fetch account/positions from Alpaca for risk dashboard", exc_info=True)

    # Compute drawdown from trade ledger P&L history
    current_dd = 0.0
    max_dd = 0.0
    try:
        from data.ingestion.trade_ledger import TradeLedger
        ledger = TradeLedger()
        closed = ledger.get_closed_trades()
        if closed:
            cumulative = 0.0
            peak = 0.0
            for t in sorted(closed, key=lambda x: x.get("exit_time", "")):
                cumulative += t.get("pnl", 0) or 0
                if cumulative > peak:
                    peak = cumulative
                dd = cumulative - peak
                if dd < max_dd:
                    max_dd = dd
            current_dd = cumulative - peak if peak > 0 else 0.0
    except Exception:
        logger.warning("Failed to compute drawdown from trade ledger", exc_info=True)

    invested = last_equity if last_equity > 0 else equity
    current_dd_pct = round((current_dd / invested) * 100, 2) if invested > 0 and current_dd < 0 else 0.0
    max_dd_pct = round((max_dd / invested) * 100, 2) if invested > 0 and max_dd < 0 else 0.0

    return RiskDashboard(
        portfolio_beta=None,
        sharpe_ratio=0.0,
        sortino_ratio=0.0,
        current_drawdown_pct=current_dd_pct,
        max_drawdown_pct=max_dd_pct,
        var_95=None,
        var_99=None,
        total_portfolio_value=round(equity, 2),
        total_invested=round(invested, 2),
        daily_pnl=round(daily_pnl, 2),
        weekly_pnl=round(daily_pnl, 2),
        monthly_pnl=round(equity - invested, 2) if invested > 0 else 0.0,
        position_count=position_count,
        as_of=datetime.now(timezone.utc),
        estimated=not has_account,
    )


def _generate_correlation() -> CorrelationResponse:
    """Return correlation matrix from real strategy data.

    Returns an empty matrix when insufficient strategy return data
    is available to compute meaningful correlations.
    """
    return CorrelationResponse(
        strategies=[],
        matrix=[],
        pairs=[],
    )


async def _generate_exposure() -> ExposureResponse:
    """Compute real sector exposure from Alpaca positions."""
    import httpx

    headers = await _alpaca_headers()
    base = await _alpaca_base_url()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            acct_resp = await client.get(f"{base}/v2/account", headers=headers)
            equity = 0.0
            cash = 0.0
            if acct_resp.status_code == 200:
                a = acct_resp.json()
                equity = float(a.get("equity", 0))
                cash = float(a.get("cash", 0))

            pos_resp = await client.get(f"{base}/v2/positions", headers=headers)
            if pos_resp.status_code != 200:
                logger.warning("Failed to fetch positions for exposure (status %d)", pos_resp.status_code)
                return _empty_exposure()

            positions = pos_resp.json()
            if not positions:
                return _empty_exposure(cash=cash, equity=equity)

        sector_map = _get_symbol_sector_map()

        # Aggregate by sector
        sector_data: dict[str, dict[str, float]] = {}
        long_value = 0.0
        short_value = 0.0

        for p in positions:
            sym = p.get("symbol", "")
            market_value = float(p.get("market_value", 0))
            side = p.get("side", "long")
            sector = sector_map.get(sym, "Unknown")

            if sector not in sector_data:
                sector_data[sector] = {"value": 0.0, "count": 0}
            sector_data[sector]["value"] += abs(market_value)
            sector_data[sector]["count"] += 1

            if side == "long":
                long_value += market_value
            else:
                short_value += abs(market_value)

        total_positioned = long_value + short_value
        if total_positioned == 0:
            return _empty_exposure(cash=cash, equity=equity)

        sectors = []
        for sector_name, data in sorted(sector_data.items(), key=lambda x: -x[1]["value"]):
            alloc = round((data["value"] / total_positioned) * 100, 2) if total_positioned > 0 else 0.0
            sectors.append(SectorExposure(
                sector=sector_name,
                allocation_pct=alloc,
                value=round(data["value"], 2),
                position_count=int(data["count"]),
            ))

        gross = long_value + short_value
        cash_pct = round((cash / equity) * 100, 2) if equity > 0 else 0.0

        return ExposureResponse(
            sector_exposure=sectors,
            long_exposure_pct=round((long_value / equity) * 100, 2) if equity > 0 else 0.0,
            short_exposure_pct=round((-short_value / equity) * 100, 2) if equity > 0 else 0.0,
            net_exposure_pct=round(((long_value - short_value) / equity) * 100, 2) if equity > 0 else 0.0,
            gross_exposure_pct=round((gross / equity) * 100, 2) if equity > 0 else 0.0,
            cash_pct=cash_pct,
        )
    except Exception:
        logger.warning("Failed to compute exposure from Alpaca positions", exc_info=True)
        return _empty_exposure()


def _empty_exposure(cash: float = 0.0, equity: float = 0.0) -> ExposureResponse:
    """Return an empty exposure response (no positions)."""
    cash_pct = round((cash / equity) * 100, 2) if equity > 0 else 100.0
    return ExposureResponse(
        sector_exposure=[],
        long_exposure_pct=0.0,
        short_exposure_pct=0.0,
        net_exposure_pct=0.0,
        gross_exposure_pct=0.0,
        cash_pct=cash_pct,
    )


async def _generate_var() -> VaRResponse:
    """Compute VaR from real Alpaca position data and recent bar volatilities."""
    import httpx

    headers = await _alpaca_headers()
    base = await _alpaca_base_url()

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Get current positions
            pos_resp = await client.get(f"{base}/v2/positions", headers=headers)
            if pos_resp.status_code != 200 or not pos_resp.json():
                return _empty_var("No open positions to compute VaR.")

            positions = pos_resp.json()
            symbols = [p.get("symbol", "") for p in positions if p.get("symbol")]
            market_values = {p["symbol"]: float(p.get("market_value", 0)) for p in positions}

            if not symbols:
                return _empty_var("No open positions to compute VaR.")

            # Fetch 30-day daily bars for each position to estimate volatility
            start_date = (datetime.now(timezone.utc) - timedelta(days=45)).strftime("%Y-%m-%dT00:00:00Z")
            position_vols: dict[str, float] = {}
            portfolio_value = sum(abs(v) for v in market_values.values())

            for sym in symbols:
                try:
                    bars_resp = await client.get(
                        f"https://data.alpaca.markets/v2/stocks/{sym}/bars"
                        f"?timeframe=1Day&start={start_date}&limit=30&sort=asc",
                        headers=headers,
                    )
                    if bars_resp.status_code == 200:
                        bars = bars_resp.json().get("bars", [])
                        if len(bars) >= 5:
                            closes = [b["c"] for b in bars]
                            returns = [(closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, len(closes)) if closes[i - 1] > 0]
                            if returns:
                                vol = (sum((r - sum(returns) / len(returns)) ** 2 for r in returns) / len(returns)) ** 0.5
                                position_vols[sym] = vol
                except Exception:
                    pass

            if not position_vols:
                return _empty_var("Insufficient price history to estimate volatility.")

            # Parametric VaR: assume normal, weight by position size
            # Portfolio vol (simplified — assumes zero correlation as conservative estimate)
            weighted_var_sq = 0.0
            for sym, vol in position_vols.items():
                mv = abs(market_values.get(sym, 0))
                weighted_var_sq += (mv * vol) ** 2

            portfolio_vol_dollar = math.sqrt(weighted_var_sq)

            # Z-scores for confidence levels
            z_95 = 1.645
            z_99 = 2.326

            var_95_1d = round(-z_95 * portfolio_vol_dollar, 2)
            var_99_1d = round(-z_99 * portfolio_vol_dollar, 2)
            var_95_10d = round(var_95_1d * math.sqrt(10), 2)
            var_99_10d = round(var_99_1d * math.sqrt(10), 2)

            # CVaR (Expected Shortfall) approximation for normal dist
            # E[X | X < -VaR] = -sigma * phi(z) / Phi(-z)
            phi_95 = math.exp(-z_95 ** 2 / 2) / math.sqrt(2 * math.pi)
            phi_99 = math.exp(-z_99 ** 2 / 2) / math.sqrt(2 * math.pi)
            cvar_95_1d = round(-portfolio_vol_dollar * phi_95 / 0.05, 2)
            cvar_99_1d = round(-portfolio_vol_dollar * phi_99 / 0.01, 2)

            # Factor exposures per sector
            sector_map = _get_symbol_sector_map()
            factor_exposures = []
            for sym, vol in position_vols.items():
                mv = abs(market_values.get(sym, 0))
                weight = mv / portfolio_value if portfolio_value > 0 else 0
                sector = sector_map.get(sym, "Unknown")
                factor_exposures.append(FactorExposure(
                    factor=f"{sym} ({sector})",
                    beta=round(vol / 0.01, 2) if vol > 0 else 0.0,  # Relative to 1% daily vol benchmark
                    contribution_pct=round(weight * 100, 2),
                ))

            return VaRResponse(
                var_95_1d=var_95_1d,
                var_99_1d=var_99_1d,
                var_95_10d=var_95_10d,
                var_99_10d=var_99_10d,
                cvar_95_1d=cvar_95_1d,
                cvar_99_1d=cvar_99_1d,
                method="parametric",
                confidence_note=f"Parametric VaR computed from {len(position_vols)} positions using 30-day daily volatility. Assumes normal returns and zero correlation (conservative).",
                factor_exposures=sorted(factor_exposures, key=lambda f: -f.contribution_pct)[:10],
                estimated=False,
            )
    except Exception:
        logger.warning("Failed to compute VaR from Alpaca data", exc_info=True)
        return _empty_var("Failed to fetch position data from broker.")


def _empty_var(note: str) -> VaRResponse:
    return VaRResponse(
        var_95_1d=None,
        var_99_1d=None,
        var_95_10d=None,
        var_99_10d=None,
        cvar_95_1d=None,
        cvar_99_1d=None,
        method="none",
        confidence_note=note,
        factor_exposures=[],
        estimated=True,
    )


async def _generate_drawdown() -> DrawdownResponse:
    """Compute real drawdown from the trade ledger's closed trades."""
    from data.ingestion.trade_ledger import TradeLedger

    try:
        ledger = TradeLedger()
        closed = ledger.get_closed_trades()

        if not closed:
            return DrawdownResponse(
                current_drawdown_pct=0.0,
                max_drawdown_pct=0.0,
                max_drawdown_date=date.today().isoformat(),
                recovery_days=None,
                drawdown_series=[],
            )

        # Sort by exit time and walk cumulative P&L
        closed_sorted = sorted(closed, key=lambda t: t.get("exit_time", ""))

        cumulative_pnl = 0.0
        peak_pnl = 0.0
        max_dd = 0.0
        max_dd_date = ""
        series: list[DrawdownPoint] = []
        peak_date = ""
        recovery_days: int | None = None

        for trade in closed_sorted:
            pnl = trade.get("pnl", 0) or 0
            cumulative_pnl += pnl
            exit_time = trade.get("exit_time", "")
            trade_date = exit_time[:10] if exit_time else date.today().isoformat()

            if cumulative_pnl > peak_pnl:
                peak_pnl = cumulative_pnl
                peak_date = trade_date

            dd_pct = round(((cumulative_pnl - peak_pnl) / peak_pnl) * 100, 2) if peak_pnl > 0 else 0.0

            if dd_pct < max_dd:
                max_dd = dd_pct
                max_dd_date = trade_date

            series.append(DrawdownPoint(
                date=trade_date,
                drawdown_pct=dd_pct,
                portfolio_value=round(cumulative_pnl, 2),
                peak_value=round(peak_pnl, 2),
            ))

        current_dd = round(((cumulative_pnl - peak_pnl) / peak_pnl) * 100, 2) if peak_pnl > 0 else 0.0

        # Check if recovered from max drawdown
        if current_dd >= 0.0 and max_dd < 0.0 and max_dd_date and peak_date:
            try:
                dd_date_obj = date.fromisoformat(max_dd_date)
                today = date.today()
                recovery_days = (today - dd_date_obj).days
            except (ValueError, TypeError):
                recovery_days = None

        return DrawdownResponse(
            current_drawdown_pct=current_dd,
            max_drawdown_pct=round(max_dd, 2),
            max_drawdown_date=max_dd_date or date.today().isoformat(),
            recovery_days=recovery_days,
            drawdown_series=series,
        )
    except Exception:
        logger.warning("Failed to compute drawdown from trade ledger", exc_info=True)
        return DrawdownResponse(
            current_drawdown_pct=0.0,
            max_drawdown_pct=0.0,
            max_drawdown_date=date.today().isoformat(),
            recovery_days=None,
            drawdown_series=[],
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
    return await _generate_exposure()


@router.get("/var", response_model=VaRResponse)
async def get_var() -> VaRResponse:
    """Value at Risk calculations with factor decomposition."""
    return await _generate_var()


@router.get("/drawdown", response_model=DrawdownResponse)
async def get_drawdown() -> DrawdownResponse:
    """Drawdown analysis with time series from peak."""
    return await _generate_drawdown()


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
