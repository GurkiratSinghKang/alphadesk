"""
News integration for AlphaDesk via newsdata.io API.

Endpoints:
  GET /api/v1/news/latest?q=AAPL&limit=10
  GET /api/v1/news/market
  GET /api/v1/news/symbol/{symbol}

The data-fetching core (Newsdata.io client, parsers, demo fallback,
rate-limit state, Pydantic models) lives in :mod:`services.news` so
non-HTTP callers (e.g. ``services.earnings_screener``) can reach it
without faking a FastAPI Request (B-62). The public names are
re-exported below so existing imports keep working.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Query

from services.news import (  # noqa: F401 — re-exported for tests/back-compat
    NEWS_CACHE_TTL,
    NEWSDATA_BASE,
    NEWSDATA_RATE_KEY,
    NEWSDATA_RATE_LIMIT_COOLDOWN,
    NewsArticle,
    NewsResponse,
    _cache_key,
    _company_query,
    _fetch_newsdata,
    _generate_demo_articles,
    _is_rate_limited,
    _mark_rate_limited,
    _parse_articles,
    fetch_latest,
    fetch_market,
    fetch_news_for_symbol,
    fetch_symbol_news,
)

logger = logging.getLogger("alphadesk.news")

router = APIRouter()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/latest", response_model=NewsResponse)
async def get_latest_news(
    q: str = Query("stock market", description="Search query"),
    limit: int = Query(10, ge=1, le=50),
) -> NewsResponse:
    """Fetch latest news articles matching a query.

    Thin HTTP wrapper around :func:`services.news.fetch_latest` (B-62).
    """
    return await fetch_latest(q=q, limit=limit)


@router.get("/market", response_model=NewsResponse)
async def get_market_news() -> NewsResponse:
    """Fetch general market news.

    Thin HTTP wrapper around :func:`services.news.fetch_market` (B-62).
    """
    return await fetch_market()


@router.get("/symbol/{symbol}", response_model=NewsResponse)
async def get_symbol_news(
    symbol: str,
    limit: int = Query(10, ge=1, le=50),
) -> NewsResponse:
    """Fetch news for a specific stock symbol.

    Thin HTTP wrapper around :func:`services.news.fetch_symbol_news`
    (B-62).
    """
    return await fetch_symbol_news(symbol, limit=limit)
