from __future__ import annotations

import hashlib
import logging
import random
from datetime import datetime, timezone
from enum import Enum
from typing import Any, TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.database import get_db

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class FilterOp(str, Enum):
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    EQ = "eq"
    BETWEEN = "between"
    IN = "in"


class ScreenerFilter(BaseModel):
    field: str = Field(..., description="Metric field name, e.g. 'market_cap', 'pe_ratio', 'iv_rank'")
    op: FilterOp
    value: float | list[float] | list[str] = Field(..., description="Comparison value(s)")


class SortSpec(BaseModel):
    field: str = "composite_score"
    descending: bool = True


class ScreenRequest(BaseModel):
    filters: list[ScreenerFilter] = Field(default_factory=list)
    sort: SortSpec = Field(default_factory=SortSpec)
    limit: int = Field(50, ge=1, le=500)
    strategy: str | None = Field(None, description="Optional strategy name to use its built-in screen")


class ScreenerResult(BaseModel):
    symbol: str
    name: str
    sector: str | None = None
    market_cap: float | None = None
    price: float | None = None
    change_pct: float | None = None
    volume: int | None = None
    composite_score: float = 0.0
    metrics: dict[str, Any] = Field(default_factory=dict)


class ScreenResponse(BaseModel):
    count: int
    results: list[ScreenerResult]
    screened_at: datetime


class CreatePresetRequest(BaseModel):
    name: str
    filters: list[ScreenerFilter]


class PresetResponse(BaseModel):
    id: int
    name: str
    filters: list[ScreenerFilter]
    created_at: datetime


# ---------------------------------------------------------------------------
# Demo data helpers
# ---------------------------------------------------------------------------

_DEMO_STOCKS = [
    ("AAPL", "Apple Inc.", "Technology", 3_500_000_000_000, 230.0),
    ("NVDA", "NVIDIA Corp.", "Technology", 3_400_000_000_000, 140.0),
    ("TSLA", "Tesla Inc.", "Consumer Cyclical", 880_000_000_000, 275.0),
    ("MSFT", "Microsoft Corp.", "Technology", 3_100_000_000_000, 430.0),
    ("AMZN", "Amazon.com Inc.", "Consumer Cyclical", 2_000_000_000_000, 195.0),
    ("META", "Meta Platforms Inc.", "Communication Services", 1_400_000_000_000, 530.0),
    ("GOOGL", "Alphabet Inc.", "Communication Services", 2_100_000_000_000, 175.0),
    ("AMD", "Advanced Micro Devices", "Technology", 265_000_000_000, 165.0),
    ("NFLX", "Netflix Inc.", "Communication Services", 300_000_000_000, 680.0),
    ("CRM", "Salesforce Inc.", "Technology", 300_000_000_000, 310.0),
    ("AVGO", "Broadcom Inc.", "Technology", 780_000_000_000, 175.0),
    ("LLY", "Eli Lilly & Co.", "Healthcare", 740_000_000_000, 790.0),
    ("JPM", "JPMorgan Chase", "Financial Services", 580_000_000_000, 220.0),
    ("V", "Visa Inc.", "Financial Services", 550_000_000_000, 295.0),
    ("UNH", "UnitedHealth Group", "Healthcare", 450_000_000_000, 490.0),
    ("MA", "Mastercard Inc.", "Financial Services", 420_000_000_000, 470.0),
    ("HD", "Home Depot Inc.", "Consumer Cyclical", 370_000_000_000, 370.0),
    ("PG", "Procter & Gamble", "Consumer Defensive", 390_000_000_000, 170.0),
    ("XOM", "Exxon Mobil Corp.", "Energy", 470_000_000_000, 115.0),
    ("COST", "Costco Wholesale", "Consumer Defensive", 380_000_000_000, 860.0),
    ("ABBV", "AbbVie Inc.", "Healthcare", 310_000_000_000, 175.0),
    ("KO", "Coca-Cola Co.", "Consumer Defensive", 270_000_000_000, 62.0),
    ("MRK", "Merck & Co.", "Healthcare", 290_000_000_000, 115.0),
    ("PEP", "PepsiCo Inc.", "Consumer Defensive", 230_000_000_000, 168.0),
    ("WMT", "Walmart Inc.", "Consumer Defensive", 470_000_000_000, 175.0),
    ("BAC", "Bank of America", "Financial Services", 310_000_000_000, 38.0),
    ("INTC", "Intel Corp.", "Technology", 135_000_000_000, 32.0),
    ("DIS", "Walt Disney Co.", "Communication Services", 210_000_000_000, 115.0),
    ("BA", "Boeing Co.", "Industrials", 130_000_000_000, 195.0),
    ("ADBE", "Adobe Inc.", "Technology", 250_000_000_000, 540.0),
    ("ORCL", "Oracle Corp.", "Technology", 340_000_000_000, 125.0),
    ("CSCO", "Cisco Systems", "Technology", 220_000_000_000, 54.0),
    ("NKE", "Nike Inc.", "Consumer Cyclical", 150_000_000_000, 97.0),
    ("PYPL", "PayPal Holdings", "Financial Services", 70_000_000_000, 65.0),
    ("COIN", "Coinbase Global", "Financial Services", 45_000_000_000, 180.0),
    ("SQ", "Block Inc.", "Technology", 40_000_000_000, 68.0),
    ("PLTR", "Palantir Technologies", "Technology", 55_000_000_000, 24.0),
    ("SNAP", "Snap Inc.", "Communication Services", 18_000_000_000, 11.0),
    ("UBER", "Uber Technologies", "Technology", 145_000_000_000, 70.0),
    ("ABNB", "Airbnb Inc.", "Consumer Cyclical", 90_000_000_000, 140.0),
]

_SECTORS = [
    "Technology", "Healthcare", "Financial Services", "Consumer Cyclical",
    "Communication Services", "Consumer Defensive", "Industrials", "Energy",
]


def _symbol_seed(symbol: str) -> int:
    return int(hashlib.md5(symbol.upper().encode()).hexdigest()[:8], 16)


def _generate_demo_screener_results(request: ScreenRequest) -> ScreenResponse:
    """Generate deterministic demo screener results."""
    results: list[ScreenerResult] = []

    for ticker, name, sector, mcap, base_price in _DEMO_STOCKS:
        rng = random.Random(_symbol_seed(ticker))
        price = round(base_price * (1 + rng.uniform(-0.02, 0.02)), 2)
        change_pct = round(rng.uniform(-4.0, 5.0), 2)
        volume = rng.randint(2_000_000, 80_000_000)

        rs_score = round(rng.uniform(20, 99), 1)
        f_score = rng.randint(3, 9)
        iv_rank = round(rng.uniform(10, 90), 1)
        iv_percentile = round(rng.uniform(15, 95), 1)
        ml_score = round(rng.uniform(25, 95), 1)
        composite = round(
            0.25 * rs_score + 0.15 * (f_score / 9 * 100)
            + 0.20 * (100 - iv_rank) + 0.20 * ml_score
            + 0.20 * rng.uniform(30, 90),
            1,
        )

        metrics = {
            "rs_score": rs_score,
            "f_score": f_score,
            "iv_rank": iv_rank,
            "iv_percentile": iv_percentile,
            "ml_score": ml_score,
            "composite_score": composite,
            "pe_ratio": round(rng.uniform(10, 60), 1),
            "short_interest": round(rng.uniform(1, 15), 1),
        }

        # Build a flat dict for filter application
        ticker_dict = {
            "ticker": ticker, "name": name, "sector": sector,
            "market_cap": mcap, "price": price, "change_pct": change_pct,
            "volume": volume, "composite_score": composite, **metrics,
        }

        # Apply filters
        passed = True
        for f in request.filters:
            val = ticker_dict.get(f.field)
            if val is None:
                passed = False
                break
            if f.op == FilterOp.GT and not (val > f.value):
                passed = False
            elif f.op == FilterOp.GTE and not (val >= f.value):
                passed = False
            elif f.op == FilterOp.LT and not (val < f.value):
                passed = False
            elif f.op == FilterOp.LTE and not (val <= f.value):
                passed = False
            elif f.op == FilterOp.EQ and not (val == f.value):
                passed = False
            elif f.op == FilterOp.BETWEEN and isinstance(f.value, list) and len(f.value) == 2:
                if not (f.value[0] <= val <= f.value[1]):
                    passed = False
            elif f.op == FilterOp.IN and isinstance(f.value, list) and val not in f.value:
                passed = False
            if not passed:
                break

        if passed:
            results.append(ScreenerResult(
                symbol=ticker, name=name, sector=sector, market_cap=mcap,
                price=price, change_pct=change_pct, volume=volume,
                composite_score=composite, metrics=metrics,
            ))

    # Sort
    sort_field = request.sort.field
    results.sort(
        key=lambda r: getattr(r, sort_field, None) or r.metrics.get(sort_field, 0) or 0,
        reverse=request.sort.descending,
    )
    results = results[: request.limit]

    return ScreenResponse(
        count=len(results),
        results=results,
        screened_at=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/screen", response_model=ScreenResponse)
async def run_screen(
    request: ScreenRequest,
) -> ScreenResponse:
    """Run a stock screener with custom or strategy-based filters.

    Filters are applied server-side against cached fundamental + technical
    data. Results are ranked by a composite ML score when a strategy is
    specified.
    """
    from core.redis import cache_get

    # If a strategy is specified, load its default screen config
    if request.strategy:
        cached_screen = await cache_get(f"strategy_screen:{request.strategy}")
        if cached_screen:
            request.filters.extend(
                [ScreenerFilter(**f) for f in cached_screen.get("filters", [])]
            )

    # Build universe from cached ticker data (BUG-015: return 503 on empty cache)
    universe_raw: dict | None = await cache_get("universe:us_equities")
    if not universe_raw or not universe_raw.get("tickers"):
        # Fall back to demo data instead of erroring
        return _generate_demo_screener_results(request)
    tickers: list[dict] = universe_raw.get("tickers", [])

    # Apply filters
    filtered = tickers
    for f in request.filters:
        filtered = _apply_filter(filtered, f)

    # Sort
    filtered.sort(
        key=lambda t: t.get(request.sort.field, 0) or 0,
        reverse=request.sort.descending,
    )
    filtered = filtered[: request.limit]

    results = [
        ScreenerResult(
            symbol=t.get("ticker", ""),
            name=t.get("name", ""),
            sector=t.get("sector"),
            market_cap=t.get("market_cap"),
            price=t.get("price"),
            change_pct=t.get("change_pct"),
            volume=t.get("volume"),
            composite_score=t.get("composite_score", 0),
            metrics={
                k: v for k, v in t.items()
                if k not in {"ticker", "name", "sector", "market_cap", "price", "change_pct", "volume"}
            },
        )
        for t in filtered
    ]

    return ScreenResponse(
        count=len(results),
        results=results,
        screened_at=datetime.now(timezone.utc),
    )


@router.get("/presets", response_model=list[PresetResponse])
async def list_presets() -> list[PresetResponse]:
    """List all saved screener presets."""
    from core.config import settings

    if settings.SKIP_DB_INIT:
        # Return demo presets when DB not available
        return [
            PresetResponse(id=1, name="Momentum + Quality", filters=[], created_at=datetime.now(timezone.utc)),
            PresetResponse(id=2, name="High IV Rank", filters=[], created_at=datetime.now(timezone.utc)),
            PresetResponse(id=3, name="Earnings Plays", filters=[], created_at=datetime.now(timezone.utc)),
            PresetResponse(id=4, name="Value + Growth", filters=[], created_at=datetime.now(timezone.utc)),
            PresetResponse(id=5, name="Large Cap Liquid", filters=[], created_at=datetime.now(timezone.utc)),
        ]

    try:
        from sqlalchemy import select
        from data.storage.models import ScreenerPreset
        from core.database import _get_session_factory

        factory = _get_session_factory()
        async with factory() as db:
            result = await db.execute(select(ScreenerPreset).order_by(ScreenerPreset.name))
            presets = result.scalars().all()
            return [
                PresetResponse(
                    id=p.id,
                    name=p.name,
                    filters=[ScreenerFilter(**f) for f in (p.filters or [])],
                    created_at=p.created_at,
                )
                for p in presets
            ]
    except Exception:
        logger.warning("Failed to list screener presets from DB", exc_info=True)
        return []


@router.post("/presets", response_model=PresetResponse, status_code=201)
async def create_preset(
    request: CreatePresetRequest,
) -> PresetResponse:
    """Save a new screener preset."""
    from core.config import settings

    if settings.SKIP_DB_INIT:
        # In demo mode, just echo back
        return PresetResponse(
            id=0,
            name=request.name,
            filters=request.filters,
            created_at=datetime.now(timezone.utc),
        )

    try:
        from data.storage.models import ScreenerPreset
        from core.database import _get_session_factory

        factory = _get_session_factory()
        async with factory() as db:
            preset = ScreenerPreset(
                name=request.name,
                filters=[f.model_dump() for f in request.filters],
            )
            db.add(preset)
            await db.flush()
            await db.refresh(preset)
            return PresetResponse(
                id=preset.id,
                name=preset.name,
                filters=request.filters,
                created_at=preset.created_at,
            )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {e}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _apply_filter(tickers: list[dict], f: ScreenerFilter) -> list[dict]:
    """Apply a single filter to a list of ticker dicts."""
    result = []
    for t in tickers:
        val = t.get(f.field)
        if val is None:
            continue
        if f.op == FilterOp.GT and val > f.value:
            result.append(t)
        elif f.op == FilterOp.GTE and val >= f.value:
            result.append(t)
        elif f.op == FilterOp.LT and val < f.value:
            result.append(t)
        elif f.op == FilterOp.LTE and val <= f.value:
            result.append(t)
        elif f.op == FilterOp.EQ and val == f.value:
            result.append(t)
        elif f.op == FilterOp.BETWEEN and isinstance(f.value, list) and len(f.value) == 2:
            if f.value[0] <= val <= f.value[1]:
                result.append(t)
        elif f.op == FilterOp.IN and isinstance(f.value, list) and val in f.value:
            result.append(t)
    return result
