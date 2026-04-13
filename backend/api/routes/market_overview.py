from __future__ import annotations

import hashlib
import logging
import random
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class IndexData(BaseModel):
    symbol: str
    name: str
    price: float
    change: float
    change_pct: float
    prev_close: float
    is_demo: bool = False


class IndicesResponse(BaseModel):
    indices: list[IndexData]
    as_of: datetime


class SectorPerformance(BaseModel):
    sector: str
    change_pct: float
    ytd_pct: float
    leader: str  # top stock in sector
    leader_change_pct: float


class SectorsResponse(BaseModel):
    sectors: list[SectorPerformance]
    as_of: datetime
    is_demo: bool = False


class MarketRegime(BaseModel):
    regime: str  # e.g. "Bull - Low Volatility"
    label: str  # short label: "bull", "bear", "sideways"
    confidence: float
    vix_level: float
    description: str
    indicators: dict[str, Any]


class RegimeResponse(BaseModel):
    regime: MarketRegime
    as_of: datetime
    is_demo: bool = False


# ---------------------------------------------------------------------------
# Demo data
# ---------------------------------------------------------------------------

_DEMO_INDICES: list[dict[str, Any]] = [
    {"symbol": "SPY", "name": "S&P 500 ETF", "price": 590.00, "change": 1.77, "change_pct": 0.3, "prev_close": 588.23},
    {"symbol": "QQQ", "name": "NASDAQ 100 ETF", "price": 510.00, "change": 2.55, "change_pct": 0.5, "prev_close": 507.45},
    {"symbol": "IWM", "name": "Russell 2000 ETF", "price": 220.00, "change": -0.44, "change_pct": -0.2, "prev_close": 220.44},
    {"symbol": "DIA", "name": "Dow Jones ETF", "price": 420.00, "change": 0.42, "change_pct": 0.1, "prev_close": 419.58},
    {"symbol": "VIX", "name": "CBOE Volatility Index", "price": 16.50, "change": -0.55, "change_pct": -3.2, "prev_close": 17.05},
]

_DEMO_SECTORS: list[dict[str, Any]] = [
    {"sector": "Technology", "change_pct": 1.2, "ytd_pct": 8.5, "leader": "NVDA", "leader_change_pct": 3.1},
    {"sector": "Healthcare", "change_pct": 0.8, "ytd_pct": 5.2, "leader": "LLY", "leader_change_pct": 2.4},
    {"sector": "Financials", "change_pct": 0.3, "ytd_pct": 6.1, "leader": "JPM", "leader_change_pct": 1.1},
    {"sector": "Consumer Discretionary", "change_pct": 0.1, "ytd_pct": 3.8, "leader": "AMZN", "leader_change_pct": 0.9},
    {"sector": "Communication Services", "change_pct": 0.6, "ytd_pct": 7.3, "leader": "META", "leader_change_pct": 1.8},
    {"sector": "Industrials", "change_pct": -0.1, "ytd_pct": 4.2, "leader": "CAT", "leader_change_pct": 0.5},
    {"sector": "Consumer Staples", "change_pct": 0.2, "ytd_pct": 2.1, "leader": "COST", "leader_change_pct": 0.7},
    {"sector": "Energy", "change_pct": -0.5, "ytd_pct": -1.3, "leader": "XOM", "leader_change_pct": -0.2},
    {"sector": "Utilities", "change_pct": -0.3, "ytd_pct": 1.8, "leader": "NEE", "leader_change_pct": 0.1},
    {"sector": "Real Estate", "change_pct": -0.4, "ytd_pct": -0.5, "leader": "AMT", "leader_change_pct": 0.3},
    {"sector": "Materials", "change_pct": 0.0, "ytd_pct": 2.9, "leader": "LIN", "leader_change_pct": 0.4},
]

_DEMO_REGIME = {
    "regime": "Bull - Low Volatility",
    "label": "bull",
    "confidence": 0.72,
    "vix_level": 16.5,
    "description": "Broad market uptrend with below-average volatility. Momentum and risk-on strategies favored. VIX term structure in contango.",
    "indicators": {
        "trend_200d": "above",
        "breadth_advance_decline": 1.35,
        "vix_term_structure": "contango",
        "credit_spreads": "tight",
        "put_call_ratio": 0.82,
        "new_highs_vs_lows": 3.2,
        "sector_rotation": "risk-on",
    },
}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/indices", response_model=IndicesResponse)
async def get_indices() -> IndicesResponse:
    """Get current values for major market indices/ETFs with live Alpaca data."""
    import httpx
    from core.config import settings

    indices: list[IndexData] = []
    try:
        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }
        async with httpx.AsyncClient(timeout=10) as client:
            # Fetch snapshots in one batch — include VIXY as VIX proxy
            syms = [d["symbol"] for d in _DEMO_INDICES if d["symbol"] != "VIX"]
            syms.append("VIXY")  # VIX proxy ETF
            snap_resp = await client.get(
                f"https://data.alpaca.markets/v2/stocks/snapshots?symbols={','.join(syms)}",
                headers=headers,
            )
            snapshots = snap_resp.json() if snap_resp.status_code == 200 else {}

            for demo in _DEMO_INDICES:
                sym = demo["symbol"]
                if sym == "VIX":
                    # Use VIXY snapshot as VIX proxy for consistency with regime endpoint
                    vixy_snap = snapshots.get("VIXY")
                    if vixy_snap:
                        vixy_price = vixy_snap.get("latestTrade", {}).get("p", 0)
                        vixy_prev = vixy_snap.get("prevDailyBar", {}).get("c", 0)
                        if vixy_price and vixy_prev:
                            change = round(vixy_price - vixy_prev, 2)
                            change_pct = round((change / vixy_prev) * 100, 2)
                            indices.append(IndexData(
                                symbol="VIX", name="VIX (VIXY proxy)",
                                price=round(vixy_price, 2), change=change,
                                change_pct=change_pct, prev_close=round(vixy_prev, 2),
                                is_demo=False,
                            ))
                            continue
                    # Fallback to demo VIX if VIXY unavailable
                    indices.append(IndexData(**demo, is_demo=True))
                    continue
                snap = snapshots.get(sym)
                if snap:
                    price = snap.get("latestTrade", {}).get("p", 0)
                    prev_close = snap.get("prevDailyBar", {}).get("c", 0)
                    if price and prev_close:
                        change = round(price - prev_close, 2)
                        change_pct = round((change / prev_close) * 100, 2)
                        indices.append(IndexData(
                            symbol=sym, name=demo["name"],
                            price=round(price, 2), change=change,
                            change_pct=change_pct, prev_close=round(prev_close, 2),
                            is_demo=False,
                        ))
                    else:
                        indices.append(IndexData(**demo, is_demo=True))
                else:
                    indices.append(IndexData(**demo, is_demo=True))
    except Exception:
        logger.warning("Failed to fetch index data from Alpaca, falling back to demo", exc_info=True)
        indices = [IndexData(**d, is_demo=True) for d in _DEMO_INDICES]

    return IndicesResponse(
        indices=indices,
        as_of=datetime.now(timezone.utc),
    )


@router.get("/sectors", response_model=SectorsResponse)
async def get_sectors() -> SectorsResponse:
    """Get sector performance heatmap data with live Alpaca data."""
    import httpx
    from core.config import settings

    _SECTOR_ETFS: dict[str, dict[str, str]] = {
        "XLK": {"sector": "Technology", "leader": "NVDA"},
        "XLV": {"sector": "Healthcare", "leader": "LLY"},
        "XLF": {"sector": "Financials", "leader": "JPM"},
        "XLY": {"sector": "Consumer Discretionary", "leader": "AMZN"},
        "XLC": {"sector": "Communication Services", "leader": "META"},
        "XLI": {"sector": "Industrials", "leader": "CAT"},
        "XLP": {"sector": "Consumer Staples", "leader": "COST"},
        "XLE": {"sector": "Energy", "leader": "XOM"},
        "XLU": {"sector": "Utilities", "leader": "NEE"},
        "XLRE": {"sector": "Real Estate", "leader": "AMT"},
        "XLB": {"sector": "Materials", "leader": "LIN"},
    }

    try:
        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }
        sectors: list[SectorPerformance] = []
        async with httpx.AsyncClient(timeout=10) as client:
            # Fetch all sector ETF snapshots in one batch
            etf_syms = list(_SECTOR_ETFS.keys())
            snap_resp = await client.get(
                f"https://data.alpaca.markets/v2/stocks/snapshots?symbols={','.join(etf_syms)}",
                headers=headers,
            )
            snapshots = snap_resp.json() if snap_resp.status_code == 200 else {}

            # Fetch YTD start-of-year bars for all ETFs in one pass
            current_year = datetime.now(timezone.utc).year
            ytd_start = f"{current_year}-01-02T00:00:00Z"
            ytd_prices: dict[str, float] = {}
            for etf_sym in etf_syms:
                try:
                    ytd_resp = await client.get(
                        f"https://data.alpaca.markets/v2/stocks/{etf_sym}/bars?timeframe=1Day&start={ytd_start}&limit=1",
                        headers=headers,
                    )
                    if ytd_resp.status_code == 200:
                        bars = ytd_resp.json().get("bars", [])
                        if bars:
                            ytd_prices[etf_sym] = bars[0]["c"]
                except Exception:
                    pass

            for etf_sym, info in _SECTOR_ETFS.items():
                snap = snapshots.get(etf_sym)
                if snap:
                    price = snap.get("latestTrade", {}).get("p", 0)
                    prev_close = snap.get("prevDailyBar", {}).get("c", 0)
                    if price and prev_close:
                        change_pct = round((price - prev_close) / prev_close * 100, 2)
                        # Compute YTD from Jan 2 close
                        jan_close = ytd_prices.get(etf_sym)
                        ytd_pct = round((price - jan_close) / jan_close * 100, 2) if jan_close and jan_close > 0 else 0.0
                        sectors.append(SectorPerformance(
                            sector=info["sector"],
                            change_pct=change_pct,
                            ytd_pct=ytd_pct,
                            leader=info["leader"],
                            leader_change_pct=change_pct,
                        ))
                        continue
                # Fallback for this ETF
                demo = next((d for d in _DEMO_SECTORS if d["sector"] == info["sector"]), None)
                if demo:
                    sectors.append(SectorPerformance(**demo))

        if sectors:
            return SectorsResponse(sectors=sectors, as_of=datetime.now(timezone.utc), is_demo=False)
    except Exception:
        logger.warning("Failed to fetch sector data from Alpaca, falling back to demo", exc_info=True)

    # Full demo fallback
    return SectorsResponse(
        sectors=[SectorPerformance(**d) for d in _DEMO_SECTORS],
        as_of=datetime.now(timezone.utc),
        is_demo=True,
    )


@router.get("/regime", response_model=RegimeResponse)
async def get_regime() -> RegimeResponse:
    """Get the current detected market regime from live Alpaca data."""
    import httpx
    from core.config import settings

    try:
        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }
        async with httpx.AsyncClient(timeout=10) as client:
            # Use snapshot API for accurate prev_close
            snap_resp = await client.get(
                "https://data.alpaca.markets/v2/stocks/snapshots?symbols=SPY,VIXY",
                headers=headers,
            )
            if snap_resp.status_code != 200:
                raise ValueError("Failed to fetch snapshot data from Alpaca")

            snapshots = snap_resp.json()
            spy_snap = snapshots.get("SPY", {})
            spy_price = spy_snap.get("latestTrade", {}).get("p", 0)
            spy_prev_close = spy_snap.get("prevDailyBar", {}).get("c", 0)
            if not spy_price or not spy_prev_close:
                raise ValueError("Incomplete SPY snapshot data")

            # Use VIXY from the same snapshot batch
            vix_level = 18.0  # default mid-range
            vixy_snap = snapshots.get("VIXY", {})
            vixy_price = vixy_snap.get("latestTrade", {}).get("p", 0)
            if vixy_price > 0:
                vix_level = vixy_price

            # Determine regime
            spy_up = spy_price > spy_prev_close
            vol_high = vix_level >= 20

            if spy_up and not vol_high:
                regime_str = "Bull - Low Volatility"
                label = "bull"
                description = "Broad market uptrend with below-average volatility. Momentum and risk-on strategies favored."
                confidence = 0.75
            elif spy_up and vol_high:
                regime_str = "Bull - High Volatility"
                label = "bull"
                description = "Market trending up but with elevated volatility. Caution on position sizing."
                confidence = 0.60
            elif not spy_up and not vol_high:
                regime_str = "Sideways - Normal Volatility"
                label = "sideways"
                description = "Market flat to slightly down with normal volatility. Mean-reversion strategies may be favored."
                confidence = 0.55
            else:
                regime_str = "Bear - High Volatility"
                label = "bear"
                description = "Market declining with elevated volatility. Defensive positioning and hedging recommended."
                confidence = 0.65

            spy_change_pct = round((spy_price - spy_prev_close) / spy_prev_close * 100, 2) if spy_prev_close else 0

            return RegimeResponse(
                regime=MarketRegime(
                    regime=regime_str,
                    label=label,
                    confidence=confidence,
                    vix_level=round(vix_level, 1),
                    description=description,
                    indicators={
                        "spy_price": round(spy_price, 2),
                        "spy_prev_close": round(spy_prev_close, 2),
                        "spy_change_pct": spy_change_pct,
                        "vix_proxy": round(vix_level, 1),
                    },
                ),
                as_of=datetime.now(timezone.utc),
                is_demo=False,
            )
    except Exception:
        logger.warning("Failed to compute regime from Alpaca, falling back to demo", exc_info=True)

    return RegimeResponse(
        regime=MarketRegime(**_DEMO_REGIME),
        as_of=datetime.now(timezone.utc),
        is_demo=True,
    )
