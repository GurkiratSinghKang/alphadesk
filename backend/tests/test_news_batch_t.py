"""Batch T T-1: news endpoint alias regression tests.

Covers the new ``GET /api/v1/news?symbols=...`` query-param alias that
sits next to the legacy ``/news/symbol/{symbol}`` and ``/news/latest``
routes.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from services.news import NewsArticle, NewsResponse


def _mk_article(title: str, score: float = 0.5, symbol: str = "AMD") -> NewsArticle:
    return NewsArticle(
        title=title,
        description="x",
        url=f"https://example.com/{title.replace(' ', '-')}",
        source="Reuters",
        published_at="2026-05-05 10:00:00",
        symbols=[symbol],
        relevance_score=score,
    )


@pytest.mark.asyncio
async def test_news_alias_single_symbol_calls_fetch_symbol_news_once():
    """`/news?symbols=AMD` should fan-out to `fetch_symbol_news` exactly once."""
    from api.routes.news import get_news_alias

    fake_resp = NewsResponse(
        articles=[_mk_article("AMD reports earnings")],
        query="AMD",
        count=1,
        is_demo=False,
    )
    with patch(
        "api.routes.news.fetch_symbol_news",
        AsyncMock(return_value=fake_resp),
    ) as patched:
        out = await get_news_alias(symbols="AMD", q=None, limit=10)

    assert patched.await_count == 1
    assert patched.await_args.args[0] == "AMD"
    assert out.count == 1
    assert out.articles[0].title == "AMD reports earnings"


@pytest.mark.asyncio
async def test_news_alias_multi_symbol_merges_and_dedupes_by_url():
    """`/news?symbols=AMD,NVDA` merges, dedupes by URL, and sorts by score."""
    from api.routes.news import get_news_alias

    amd_resp = NewsResponse(
        articles=[
            _mk_article("AMD beats earnings", score=0.9, symbol="AMD"),
            _mk_article("Shared aggregator headline", score=0.4, symbol="AMD"),
        ],
        query="AMD",
        count=2,
    )
    nvda_resp = NewsResponse(
        articles=[
            _mk_article("NVDA upgrade", score=0.7, symbol="NVDA"),
            # Same URL as the AMD aggregator headline — should dedupe.
            _mk_article("Shared aggregator headline", score=0.6, symbol="NVDA"),
        ],
        query="NVDA",
        count=2,
    )

    async def _fake_fetch(symbol: str, limit: int = 10):
        if symbol == "AMD":
            return amd_resp
        if symbol == "NVDA":
            return nvda_resp
        raise AssertionError(f"unexpected symbol: {symbol}")

    with patch("api.routes.news.fetch_symbol_news", side_effect=_fake_fetch):
        out = await get_news_alias(symbols="AMD,NVDA", q=None, limit=10)

    titles = [a.title for a in out.articles]
    # Three unique articles after URL-dedup (the higher-scored repost wins).
    assert len(out.articles) == 3, titles
    # Dedupe keeps the higher score (0.6) for the aggregator headline.
    aggregator = next(a for a in out.articles if a.title == "Shared aggregator headline")
    assert aggregator.relevance_score == 0.6
    # Sort order: highest relevance first.
    assert out.articles[0].relevance_score >= out.articles[-1].relevance_score
    # Query field reflects both tickers.
    assert "AMD" in out.query and "NVDA" in out.query


@pytest.mark.asyncio
async def test_news_alias_falls_back_to_q_when_no_symbols():
    """`/news?q=earnings` should call `fetch_latest`."""
    from api.routes.news import get_news_alias

    fake_resp = NewsResponse(
        articles=[_mk_article("Generic earnings story")],
        query="earnings",
        count=1,
    )
    with patch(
        "api.routes.news.fetch_latest",
        AsyncMock(return_value=fake_resp),
    ) as patched:
        out = await get_news_alias(symbols=None, q="earnings", limit=10)

    patched.assert_awaited_once()
    assert out.query == "earnings"


@pytest.mark.asyncio
async def test_news_alias_prefers_symbols_over_q_when_both_given():
    """When both `symbols` and `q` are given, `symbols` wins."""
    from api.routes.news import get_news_alias

    fake_resp = NewsResponse(articles=[_mk_article("AMD news")], query="AMD", count=1)
    with patch(
        "api.routes.news.fetch_symbol_news",
        AsyncMock(return_value=fake_resp),
    ) as patched_sym, patch(
        "api.routes.news.fetch_latest",
        AsyncMock(),
    ) as patched_lat:
        await get_news_alias(symbols="AMD", q="earnings", limit=10)

    patched_sym.assert_awaited_once()
    patched_lat.assert_not_awaited()


@pytest.mark.asyncio
async def test_news_alias_raises_422_when_neither_symbols_nor_q():
    from api.routes.news import get_news_alias

    with pytest.raises(HTTPException) as exc:
        await get_news_alias(symbols=None, q=None, limit=10)

    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_news_alias_strips_empty_symbols():
    """`/news?symbols=,,,` → 422 after trimming."""
    from api.routes.news import get_news_alias

    with pytest.raises(HTTPException) as exc:
        await get_news_alias(symbols=",,,", q=None, limit=10)

    assert exc.value.status_code == 422
