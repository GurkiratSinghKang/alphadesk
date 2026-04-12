from __future__ import annotations

import hashlib
import random
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

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
            for demo in _DEMO_INDICES:
                sym = demo["symbol"]
                if sym == "VIX":
                    # VIX index is not tradable on Alpaca; use demo fallback
                    indices.append(IndexData(**demo, is_demo=True))
                    continue
                try:
                    bar_resp = await client.get(
                        f"https://data.alpaca.markets/v2/stocks/{sym}/bars?timeframe=1Day&limit=2&feed=iex",
                        headers=headers,
                    )
                    trade_resp = await client.get(
                        f"https://data.alpaca.markets/v2/stocks/{sym}/trades/latest",
                        headers=headers,
                    )
                    if bar_resp.status_code == 200 and trade_resp.status_code == 200:
                        bars = bar_resp.json().get("bars", [])
                        price = trade_resp.json().get("trade", {}).get("p", 0)
                        prev_close = bars[-2]["c"] if len(bars) >= 2 else bars[0]["c"] if bars else demo["prev_close"]
                        change = round(price - prev_close, 2)
                        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
                        indices.append(IndexData(
                            symbol=sym, name=demo["name"],
                            price=round(price, 2), change=change,
                            change_pct=change_pct, prev_close=round(prev_close, 2),
                            is_demo=False,
                        ))
                    else:
                        indices.append(IndexData(**demo, is_demo=True))
                except Exception:
                    indices.append(IndexData(**demo, is_demo=True))
    except Exception:
        indices = [IndexData(**d, is_demo=True) for d in _DEMO_INDICES]

    return IndicesResponse(
        indices=indices,
        as_of=datetime.now(timezone.utc),
    )


@router.get("/sectors", response_model=SectorsResponse)
async def get_sectors() -> SectorsResponse:
    """Get sector performance heatmap data."""
    sectors = [SectorPerformance(**d) for d in _DEMO_SECTORS]
    return SectorsResponse(
        sectors=sectors,
        as_of=datetime.now(timezone.utc),
        is_demo=True,
    )


@router.get("/regime", response_model=RegimeResponse)
async def get_regime() -> RegimeResponse:
    """Get the current detected market regime."""
    return RegimeResponse(
        regime=MarketRegime(**_DEMO_REGIME),
        as_of=datetime.now(timezone.utc),
        is_demo=True,
    )
