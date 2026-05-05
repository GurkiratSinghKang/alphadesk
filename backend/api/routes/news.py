"""
News integration for AlphaDesk via newsdata.io API.

Endpoints:
  GET /api/v1/news?symbols=AMD&limit=10        (alias — Batch T T-1)
  GET /api/v1/news?symbols=AMD,NVDA&limit=10   (multi-symbol alias)
  GET /api/v1/news?q=earnings&limit=10         (free-text alias)
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

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query

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

@router.get(
    "",
    response_model=NewsResponse,
    summary="News query alias (Batch T T-1)",
    description=(
        "Ergonomic alias that accepts either a comma-separated `symbols` list "
        "or a free-text `q` query, eliminating the need to remember the "
        "`/news/symbol/{symbol}` path. When `symbols` is provided the route "
        "fans out to `fetch_symbol_news` for each ticker, merges the results, "
        "sorts by `relevance_score` desc (with `published_at` as a tiebreaker), "
        "and returns the top `limit`. `symbols` wins over `q` if both are "
        "supplied. At least one of `symbols` or `q` is required (422 otherwise)."
    ),
)
async def get_news_alias(
    symbols: str | None = Query(
        None,
        description="Comma-separated tickers, e.g. 'AMD' or 'AMD,NVDA'",
        examples=["AMD", "AMD,NVDA"],
    ),
    q: str | None = Query(
        None,
        description="Free-text search query (used when `symbols` is omitted)",
        examples=["earnings", "rate cut"],
    ),
    limit: int = Query(10, ge=1, le=50, description="Max articles to return"),
) -> NewsResponse:
    """Query-param alias around `/news/symbol/{symbol}` and `/news/latest`.

    Behaviour:
      * `symbols=AMD` → equivalent to `/news/symbol/AMD?limit=10`.
      * `symbols=AMD,NVDA` → fan-out and merge by relevance.
      * `q=earnings` → equivalent to `/news/latest?q=earnings`.
      * Both → `symbols` wins (q is ignored to keep behaviour deterministic).
      * Neither → 422.
    """
    if symbols:
        # Split, normalise, drop empties, dedupe while preserving order.
        seen: set[str] = set()
        tickers: list[str] = []
        for raw in symbols.split(","):
            sym = raw.strip().upper()
            if sym and sym not in seen:
                seen.add(sym)
                tickers.append(sym)
        if not tickers:
            raise HTTPException(
                status_code=422,
                detail="`symbols` query param is empty after parsing",
            )

        if len(tickers) == 1:
            # Fast path — exactly equivalent to /symbol/{ticker}.
            return await fetch_symbol_news(tickers[0], limit=limit)

        # Multi-symbol fan-out. Per-symbol pulls happen concurrently; each
        # service call already hits Redis cache + the shared rate-limit gate
        # so this stays bounded even for ~10 tickers.
        responses = await asyncio.gather(
            *(fetch_symbol_news(t, limit=limit) for t in tickers),
            return_exceptions=True,
        )
        merged: list[NewsArticle] = []
        any_demo = False
        for resp in responses:
            if isinstance(resp, BaseException):
                logger.warning("news alias: per-symbol fetch failed", exc_info=resp)
                continue
            if resp.is_demo:
                any_demo = True
            merged.extend(resp.articles)

        # Dedupe by URL (or title prefix when URL absent), keeping the highest
        # relevance_score per canonical key. Mirrors `_parse_articles` dedupe
        # logic so the cross-symbol merge doesn't reintroduce repostings.
        deduped: dict[str, NewsArticle] = {}
        for art in merged:
            key = art.url.strip().lower() or art.title.strip().lower()[:80]
            existing = deduped.get(key)
            if existing is None or art.relevance_score > existing.relevance_score:
                deduped[key] = art

        # Sort by relevance desc, then published_at desc as a stable tiebreaker.
        articles = sorted(
            deduped.values(),
            key=lambda a: (a.relevance_score, a.published_at),
            reverse=True,
        )[:limit]
        return NewsResponse(
            articles=articles,
            query=",".join(tickers),
            count=len(articles),
            is_demo=any_demo,
        )

    if q:
        return await fetch_latest(q=q, limit=limit)

    raise HTTPException(
        status_code=422,
        detail="One of `symbols` or `q` is required",
    )


@router.get(
    "/latest",
    response_model=NewsResponse,
    summary="Latest news matching a query",
    description="Fetch the latest Newsdata.io articles matching `q`.",
)
async def get_latest_news(
    q: str = Query("stock market", description="Search query"),
    limit: int = Query(10, ge=1, le=50),
) -> NewsResponse:
    """Fetch latest news articles matching a query.

    Thin HTTP wrapper around :func:`services.news.fetch_latest` (B-62).
    """
    return await fetch_latest(q=q, limit=limit)


@router.get(
    "/market",
    response_model=NewsResponse,
    summary="General market headlines",
    description="Fetch general market-wide Newsdata.io headlines.",
)
async def get_market_news() -> NewsResponse:
    """Fetch general market news.

    Thin HTTP wrapper around :func:`services.news.fetch_market` (B-62).
    """
    return await fetch_market()


@router.get(
    "/symbol/{symbol}",
    response_model=NewsResponse,
    summary="News for a specific symbol",
    description=(
        "Fetch news for a specific stock symbol. The query-param alias "
        "`/news?symbols={symbol}` is equivalent for single tickers."
    ),
)
async def get_symbol_news(
    symbol: str,
    limit: int = Query(10, ge=1, le=50),
) -> NewsResponse:
    """Fetch news for a specific stock symbol.

    Thin HTTP wrapper around :func:`services.news.fetch_symbol_news`
    (B-62).
    """
    return await fetch_symbol_news(symbol, limit=limit)
