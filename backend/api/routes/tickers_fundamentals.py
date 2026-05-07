"""Ticker fundamentals endpoint.

Surfaces Polygon ticker reference data (already pulled inside
``analysis.py:_real_analysis``) on a dedicated route so the
``/symbols/[ticker]`` page can render a real KeyStats panel without
running the full agent pipeline.

Cached in Redis for 24h — fundamentals (market cap, sector, share count,
list date, …) move on roughly weekly cadence at most, and the daily bars
fetch we do alongside the reference call already has a separate, much
shorter TTL covering the 52w hi/lo derivation.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.config import settings
from core.redis import cache_get, cache_set

logger = logging.getLogger(__name__)

router = APIRouter()

# 24h — fundamentals don't move fast and Polygon's free tier counts every
# call against a global per-minute budget. Anything shorter and the
# /symbols page would hammer the upstream on every navigation.
FUNDAMENTALS_CACHE_TTL = 24 * 60 * 60
FUNDAMENTALS_NEGATIVE_CACHE_TTL = 5 * 60


class TickerFundamentals(BaseModel):
    symbol: str
    name: str | None = None
    sector: str | None = None
    industry: str | None = None
    market_cap: float | None = None
    shares_outstanding: float | None = None
    pe_ratio: float | None = None
    eps_ttm: float | None = None
    dividend_yield: float | None = None
    beta: float | None = None
    fifty_two_week_high: float | None = None
    fifty_two_week_low: float | None = None
    avg_volume_30d: float | None = None
    description: str | None = None
    fetched_at: datetime
    is_demo: bool = False


async def _fetch_polygon_reference(symbol: str) -> dict[str, Any]:
    """Pull Polygon ``/v3/reference/tickers/{symbol}`` — same shape used
    by ``analysis._fetch_polygon_ticker``. Returns ``{}`` on any failure
    so the caller can render an all-null payload rather than 5xx-ing.
    """
    api_key = settings.POLYGON_API_KEY.get_secret_value()
    if not api_key:
        return {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{settings.POLYGON_BASE_URL}/v3/reference/tickers/{symbol}",
                params={"apiKey": api_key},
            )
            if resp.status_code != 200:
                logger.warning(
                    "Polygon reference returned %d for %s",
                    resp.status_code,
                    symbol,
                )
                return {}
            return resp.json().get("results", {}) or {}
    except Exception:
        logger.warning("Polygon reference fetch failed for %s", symbol, exc_info=True)
        return {}


async def _fetch_polygon_daily_bars(symbol: str, days: int = 260) -> list[dict[str, Any]]:
    """Pull ~1y of daily bars from Polygon for 52w hi/lo + 30d avg volume.

    Polygon's free aggregates window is 2 years on dailies; ``days=260``
    gives the ~252 trading sessions in a year with a small buffer for
    holidays / weekends. Returns ``[]`` on any failure.
    """
    api_key = settings.POLYGON_API_KEY.get_secret_value()
    if not api_key:
        return []
    end = datetime.now(timezone.utc).date()
    start = end.replace(year=end.year - 1) if end.month != 2 or end.day != 29 else end.replace(year=end.year - 1, day=28)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{settings.POLYGON_BASE_URL}/v2/aggs/ticker/{symbol}/range/1/day/"
                f"{start.isoformat()}/{end.isoformat()}",
                params={"apiKey": api_key, "adjusted": "true", "sort": "asc", "limit": 5000},
            )
            if resp.status_code != 200:
                logger.warning(
                    "Polygon aggs returned %d for %s",
                    resp.status_code,
                    symbol,
                )
                return []
            return resp.json().get("results", []) or []
    except Exception:
        logger.warning("Polygon aggs fetch failed for %s", symbol, exc_info=True)
        return []


def _safe_float(value: Any) -> float | None:
    """Coerce to float; return ``None`` for missing / unparseable inputs.
    Polygon sometimes ships zero where it means "we don't track this"
    (e.g. ``market_cap: 0`` for a private tracking stub) so we treat
    exact-zero non-volume floats as null too.
    """
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return f


def _derive_from_bars(bars: list[dict[str, Any]]) -> tuple[float | None, float | None, float | None]:
    """Return ``(52w_high, 52w_low, avg_volume_30d)`` from a daily bar
    series. Each tuple slot is ``None`` if the underlying inputs are
    missing or empty.
    """
    if not bars:
        return None, None, None
    highs = [b.get("h") for b in bars if isinstance(b.get("h"), (int, float))]
    lows = [b.get("l") for b in bars if isinstance(b.get("l"), (int, float))]
    fifty_two_w_high = max(highs) if highs else None
    fifty_two_w_low = min(lows) if lows else None
    last30 = bars[-30:]
    vols = [b.get("v") for b in last30 if isinstance(b.get("v"), (int, float))]
    avg_vol = (sum(vols) / len(vols)) if vols else None
    return (
        _safe_float(fifty_two_w_high),
        _safe_float(fifty_two_w_low),
        _safe_float(avg_vol),
    )


def _build_payload(
    symbol: str,
    poly: dict[str, Any],
    bars: list[dict[str, Any]],
    *,
    is_demo: bool = False,
) -> TickerFundamentals:
    """Map Polygon reference + bars into the wire shape. All fields
    nullable so the FE can render an em-dash where data is missing
    rather than crashing on a 422.
    """
    fifty_two_w_high, fifty_two_w_low, avg_vol_30d = _derive_from_bars(bars)
    shares_outstanding = (
        _safe_float(poly.get("share_class_shares_outstanding"))
        or _safe_float(poly.get("weighted_shares_outstanding"))
    )
    return TickerFundamentals(
        symbol=symbol,
        name=poly.get("name") or None,
        sector=poly.get("sic_description") or None,
        industry=poly.get("type") or None,
        market_cap=_safe_float(poly.get("market_cap")),
        shares_outstanding=shares_outstanding,
        # Polygon's /reference doesn't expose P/E, EPS, beta, or div
        # yield — placeholder None preserves the wire shape so the FE
        # can light those up the day a richer provider lands without a
        # type churn.
        pe_ratio=None,
        eps_ttm=None,
        dividend_yield=None,
        beta=None,
        fifty_two_week_high=fifty_two_w_high,
        fifty_two_week_low=fifty_two_w_low,
        avg_volume_30d=avg_vol_30d,
        description=poly.get("description") or None,
        fetched_at=datetime.now(timezone.utc),
        is_demo=is_demo,
    )


@router.get(
    "/{symbol}/fundamentals",
    response_model=TickerFundamentals,
    summary="Fundamental snapshot for a single ticker (Polygon-backed)",
)
async def get_fundamentals(symbol: str) -> TickerFundamentals:
    sym = symbol.strip().upper()
    if not sym or not sym.replace(".", "").replace("-", "").isalnum() or len(sym) > 12:
        raise HTTPException(status_code=422, detail="invalid symbol")

    cache_key = f"fundamentals:{sym}:v1"
    cached = await cache_get(cache_key)
    if cached:
        try:
            return TickerFundamentals.model_validate(cached)
        except Exception:
            # Schema drift — fall through to a fresh fetch + re-cache.
            logger.info("fundamentals cache decode mismatch for %s; refetching", sym)

    poly_task = _fetch_polygon_reference(sym)
    bars_task = _fetch_polygon_daily_bars(sym)
    poly, bars = await asyncio.gather(poly_task, bars_task)

    if not poly and not bars:
        # No upstream data at all — still 200 with all-nulls so the FE
        # renders the em-dash skeleton instead of raising. is_demo=true
        # so consumers can flag it.
        payload = _build_payload(sym, {}, [], is_demo=True)
    else:
        payload = _build_payload(sym, poly, bars)

    await cache_set(
        cache_key,
        payload.model_dump(mode="json"),
        FUNDAMENTALS_NEGATIVE_CACHE_TTL if payload.is_demo else FUNDAMENTALS_CACHE_TTL,
    )
    return payload
