from __future__ import annotations

import hashlib
import logging
import random
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, TYPE_CHECKING

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.database import get_db

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Alpaca data helpers (screener-local)
# ---------------------------------------------------------------------------

ALPACA_DATA_URL = "https://data.alpaca.markets"


def _alpaca_keys_available() -> bool:
    from core.config import settings
    return bool(
        settings.ALPACA_API_KEY.get_secret_value()
        and settings.ALPACA_SECRET_KEY.get_secret_value()
    )


def _alpaca_data_headers() -> dict:
    from core.config import settings
    return {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }


# Company name lookup — used when Alpaca screener returns only symbols
_COMPANY_NAMES: dict[str, str] = {
    "AAPL": "Apple Inc.", "NVDA": "NVIDIA Corp.", "TSLA": "Tesla Inc.",
    "MSFT": "Microsoft Corp.", "AMZN": "Amazon.com Inc.", "META": "Meta Platforms Inc.",
    "GOOGL": "Alphabet Inc.", "AMD": "Advanced Micro Devices", "NFLX": "Netflix Inc.",
    "CRM": "Salesforce Inc.", "AVGO": "Broadcom Inc.", "LLY": "Eli Lilly & Co.",
    "JPM": "JPMorgan Chase", "V": "Visa Inc.", "UNH": "UnitedHealth Group",
    "MA": "Mastercard Inc.", "HD": "Home Depot Inc.", "PG": "Procter & Gamble",
    "XOM": "Exxon Mobil Corp.", "COST": "Costco Wholesale", "ABBV": "AbbVie Inc.",
    "KO": "Coca-Cola Co.", "MRK": "Merck & Co.", "PEP": "PepsiCo Inc.",
    "WMT": "Walmart Inc.", "BAC": "Bank of America", "INTC": "Intel Corp.",
    "DIS": "Walt Disney Co.", "BA": "Boeing Co.", "ADBE": "Adobe Inc.",
    "ORCL": "Oracle Corp.", "CSCO": "Cisco Systems", "NKE": "Nike Inc.",
    "PYPL": "PayPal Holdings", "COIN": "Coinbase Global", "SQ": "Block Inc.",
    "PLTR": "Palantir Technologies", "SNAP": "Snap Inc.", "UBER": "Uber Technologies",
    "ABNB": "Airbnb Inc.", "SPY": "SPDR S&P 500 ETF", "QQQ": "Invesco QQQ Trust",
    "GOOG": "Alphabet Inc.", "BRK.B": "Berkshire Hathaway", "JNJ": "Johnson & Johnson",
    "UNP": "Union Pacific", "RTX": "RTX Corp.", "CAT": "Caterpillar Inc.",
    "GS": "Goldman Sachs", "SBUX": "Starbucks Corp.", "T": "AT&T Inc.",
    "VZ": "Verizon Communications", "PFE": "Pfizer Inc.", "CVX": "Chevron Corp.",
    "MCD": "McDonald's Corp.", "LOW": "Lowe's Cos.", "TMO": "Thermo Fisher Scientific",
    "INTU": "Intuit Inc.", "QCOM": "Qualcomm Inc.", "TXN": "Texas Instruments",
    "ISRG": "Intuitive Surgical", "NOW": "ServiceNow Inc.", "PANW": "Palo Alto Networks",
    "CRWD": "CrowdStrike Holdings", "MRVL": "Marvell Technology", "MU": "Micron Technology",
    "F": "Ford Motor Co.", "GM": "General Motors", "RIVN": "Rivian Automotive",
    "LCID": "Lucid Group", "NIO": "NIO Inc.", "SOFI": "SoFi Technologies",
    "HOOD": "Robinhood Markets", "RBLX": "Roblox Corp.", "SHOP": "Shopify Inc.",
    "SLB": "Schlumberger Ltd.", "COP": "ConocoPhillips", "EOG": "EOG Resources",
}

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
# Real Alpaca screener
# ---------------------------------------------------------------------------

async def _fetch_most_actives(top: int = 100) -> list[dict]:
    """Fetch most-active stocks from Alpaca screener endpoint.

    Returns a list of dicts with keys: symbol, trade_count, volume, etc.
    """
    headers = _alpaca_data_headers()
    url = f"{ALPACA_DATA_URL}/v1beta1/screener/stocks/most-actives"
    params = {"by": "volume", "top": top}

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers, params=params)
        resp.raise_for_status()
        data = resp.json()
        return data.get("most_actives", [])


async def _fetch_multi_snapshots(symbols: list[str]) -> dict[str, dict]:
    """Fetch Alpaca snapshots for multiple symbols in one call.

    Returns {SYMBOL: snapshot_dict, ...}
    """
    headers = _alpaca_data_headers()
    url = f"{ALPACA_DATA_URL}/v2/stocks/snapshots"
    # Alpaca accepts comma-separated symbols
    params = {"symbols": ",".join(symbols), "feed": "sip"}

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers=headers, params=params)
        resp.raise_for_status()
        return resp.json()


async def _fetch_momentum_bars(symbols: list[str]) -> dict[str, float]:
    """Fetch 3-month daily bars for each symbol and compute price momentum (RS score).

    Returns {SYMBOL: rs_score (0-100), ...}
    Uses Alpaca multi-bars endpoint for efficiency.
    """
    headers = _alpaca_data_headers()
    url = f"{ALPACA_DATA_URL}/v2/stocks/bars"
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=90)

    # Fetch bars for all symbols at once (Alpaca supports multi-symbol bars)
    params = {
        "symbols": ",".join(symbols),
        "timeframe": "1Day",
        "start": start_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end": end_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "limit": 10000,
        "adjustment": "raw",
        "feed": "sip",
        "sort": "asc",
    }

    rs_scores: dict[str, float] = {}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
            bars_by_symbol = data.get("bars", {})

            # Compute 3-month return for each symbol -> rank to RS score
            returns: dict[str, float] = {}
            for sym, bar_list in bars_by_symbol.items():
                if bar_list and len(bar_list) >= 2:
                    first_close = bar_list[0].get("c", 0)
                    last_close = bar_list[-1].get("c", 0)
                    if first_close > 0:
                        returns[sym] = (last_close - first_close) / first_close * 100

            # Rank returns to get percentile-based RS score (0-100)
            if returns:
                sorted_syms = sorted(returns.keys(), key=lambda s: returns[s])
                total = len(sorted_syms)
                for rank, sym in enumerate(sorted_syms):
                    rs_scores[sym] = round((rank / max(total - 1, 1)) * 100, 1)
    except Exception:
        logger.warning("Failed to fetch momentum bars for RS scores", exc_info=True)

    return rs_scores


def _compute_composite_score(
    change_pct: float,
    volume: int,
    rs_score: float,
    avg_volume: int = 10_000_000,
) -> float:
    """Compute a composite score from real market data.

    Components (each normalized to ~0-100):
    - RS momentum score (weight 0.35)
    - Absolute change% magnitude (weight 0.25) — bigger movers score higher
    - Volume relative to average (weight 0.25) — above-average volume = higher score
    - Positive price direction bonus (weight 0.15)
    """
    # RS already 0-100
    rs_component = rs_score

    # Change magnitude: |change_pct| capped at 10% -> scale to 0-100
    change_magnitude = min(abs(change_pct), 10.0) / 10.0 * 100

    # Volume ratio: vol / avg_vol, capped at 3x -> scale to 0-100
    vol_ratio = min(volume / max(avg_volume, 1), 3.0) / 3.0 * 100

    # Direction bonus: positive change -> 100, flat -> 50, negative -> 0
    direction = 50 + min(max(change_pct, -5), 5) * 10

    composite = (
        0.35 * rs_component
        + 0.25 * change_magnitude
        + 0.25 * vol_ratio
        + 0.15 * direction
    )
    return round(composite, 1)


async def _generate_real_screener_results(request: ScreenRequest) -> ScreenResponse | None:
    """Fetch real screener results from Alpaca.

    Returns None if real data is unavailable (caller should fallback).
    """
    if not _alpaca_keys_available():
        logger.warning("Alpaca keys not configured — cannot run real screener")
        return None

    from core.redis import cache_get, cache_set

    # Check cache first (60s TTL for screener results)
    cache_key = "screener:real_results"
    cached = await cache_get(cache_key)
    if cached:
        logger.info("Returning cached real screener results (%d items)", len(cached))
        results = [ScreenerResult(**r) for r in cached]
        # Apply filters on cached results
        results = _apply_filters_to_results(results, request.filters)
        # Sort
        sort_field = request.sort.field
        results.sort(
            key=lambda r: getattr(r, sort_field, None) or r.metrics.get(sort_field, 0) or 0,
            reverse=request.sort.descending,
        )
        results = results[: request.limit]
        return ScreenResponse(
            count=len(results), results=results, screened_at=datetime.now(timezone.utc),
        )

    try:
        # Step 1: Get most-active symbols from Alpaca screener
        logger.info("Fetching most-active stocks from Alpaca screener...")
        actives = await _fetch_most_actives(top=100)
        if not actives:
            logger.warning("Alpaca screener returned no actives")
            return None

        symbols = [a.get("symbol", "") for a in actives if a.get("symbol")]
        if not symbols:
            return None

        logger.info("Got %d most-active symbols from Alpaca", len(symbols))

        # Step 2: Fetch multi-snapshots for real prices
        logger.info("Fetching multi-snapshots for %d symbols...", len(symbols))
        snapshots = await _fetch_multi_snapshots(symbols)

        # Step 3: Fetch 3-month momentum for RS scores
        logger.info("Computing RS momentum scores for %d symbols...", len(symbols))
        rs_scores = await _fetch_momentum_bars(symbols)

        # Step 4: Build results with real data
        results: list[ScreenerResult] = []
        # Build a lookup from actives for trade_count/volume
        actives_lookup = {a["symbol"]: a for a in actives if "symbol" in a}

        for sym in symbols:
            snap = snapshots.get(sym)
            if not snap:
                continue

            daily = snap.get("dailyBar", {})
            prev = snap.get("prevDailyBar", {})
            latest_trade = snap.get("latestTrade", {})

            price = latest_trade.get("p", 0) or daily.get("c", 0)
            if price <= 0:
                continue

            prev_close = prev.get("c", 0)
            day_volume = int(daily.get("v", 0))
            change_pct = round(((price - prev_close) / prev_close) * 100, 2) if prev_close > 0 else 0.0

            # Trade count from screener endpoint
            active_info = actives_lookup.get(sym, {})
            trade_count = active_info.get("trade_count", 0)

            # RS score from momentum calc
            rs = rs_scores.get(sym, 50.0)

            # Composite score
            composite = _compute_composite_score(
                change_pct=change_pct,
                volume=day_volume,
                rs_score=rs,
            )

            name = _COMPANY_NAMES.get(sym, sym)

            metrics = {
                "rs_score": rs,
                "trade_count": trade_count,
                "day_high": daily.get("h", 0),
                "day_low": daily.get("l", 0),
                "day_open": daily.get("o", 0),
                "day_vwap": daily.get("vw", 0),
                "prev_close": prev_close,
                "composite_score": composite,
            }

            results.append(ScreenerResult(
                symbol=sym,
                name=name,
                sector=None,  # Alpaca screener doesn't return sector
                market_cap=None,
                price=price,
                change_pct=change_pct,
                volume=day_volume,
                composite_score=composite,
                metrics=metrics,
            ))

        if not results:
            logger.warning("No valid results after processing Alpaca data")
            return None

        # Cache the full unfiltered results (60s)
        await cache_set(
            cache_key,
            [r.model_dump(mode="json") for r in results],
            ttl_seconds=60,
        )

        logger.info("Real screener produced %d results", len(results))

        # Apply request filters
        results = _apply_filters_to_results(results, request.filters)

        # Sort
        sort_field = request.sort.field
        results.sort(
            key=lambda r: getattr(r, sort_field, None) or r.metrics.get(sort_field, 0) or 0,
            reverse=request.sort.descending,
        )
        results = results[: request.limit]

        return ScreenResponse(
            count=len(results), results=results, screened_at=datetime.now(timezone.utc),
        )

    except httpx.HTTPStatusError as e:
        logger.error("Alpaca screener HTTP error %s: %s", e.response.status_code, e.response.text)
        return None
    except Exception:
        logger.error("Real screener failed", exc_info=True)
        return None


def _apply_filters_to_results(
    results: list[ScreenerResult], filters: list[ScreenerFilter]
) -> list[ScreenerResult]:
    """Apply ScreenerFilter list to ScreenerResult objects."""
    filtered = []
    for r in results:
        # Build flat dict for filter matching
        d = {
            "symbol": r.symbol, "name": r.name, "sector": r.sector,
            "market_cap": r.market_cap, "price": r.price, "change_pct": r.change_pct,
            "volume": r.volume, "composite_score": r.composite_score,
            **r.metrics,
        }
        passed = True
        for f in filters:
            val = d.get(f.field)
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
            filtered.append(r)
    return filtered


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

    Data source priority:
    1. Alpaca real-time screener (most-actives + snapshots + momentum)
    2. Cached universe from Redis
    3. Demo data (last resort fallback)
    """
    from core.redis import cache_get

    # If a strategy is specified, load its default screen config
    if request.strategy:
        cached_screen = await cache_get(f"strategy_screen:{request.strategy}")
        if cached_screen:
            request.filters.extend(
                [ScreenerFilter(**f) for f in cached_screen.get("filters", [])]
            )

    # --- 1. Try real Alpaca screener FIRST ---
    real_result = await _generate_real_screener_results(request)
    if real_result and real_result.count > 0:
        return real_result

    # --- 2. Fall back to cached universe in Redis ---
    universe_raw: dict | None = await cache_get("universe:us_equities")
    if universe_raw and universe_raw.get("tickers"):
        logger.warning("Real screener unavailable — using cached universe data")
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

    # --- 3. Last resort: demo data ---
    logger.warning("DEMO FALLBACK: Serving fake screener data — both Alpaca and cache unavailable")
    return _generate_demo_screener_results(request)


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
            await db.commit()
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
