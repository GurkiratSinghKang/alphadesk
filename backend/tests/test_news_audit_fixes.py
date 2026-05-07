"""Phase-1 audit fixes for ``services/news.py``.

Covers:

* B2.25 — Newsdata sentiment / relevance plan-tier upsell strings stripped.
* B2.26 — ``source: null`` falls back to source_id (capitalized) → URL host.
* B2.27 — ``compute_relevance`` helper for symbol/company keyword match.
* B2.1  — sentiment / magnitude / confidence heuristic on the headline.
* B2.3  — earnings category gating: only tags EARNINGS when the title
          mentions the symbol or company.
* B2.4  — near-duplicate dedupe via Jaccard similarity + 24h window.
* V1.1  — demo articles must not leak to production. When NEWSDATA_API_KEY
          is configured but the provider errors / rate-limits, callers must
          see an empty result, not fake "Wall Street consensus" headlines
          with empty hrefs.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from services.news import (
    NewsArticle,
    _classify_magnitude,
    _classify_sentiment,
    _clean_upstream_relevance,
    _clean_upstream_sentiment,
    _dedupe_similar_articles,
    _is_upsell_string,
    _parse_articles,
    _resolve_source,
    _tighten_earnings_category,
    compute_relevance,
    fetch_symbol_news,
)


# ── B2.25 — upsell string detection / sanitization ────────────────────────────

class TestUpsellStripping:
    def test_is_upsell_string_detects_literal_newsdata_response(self):
        s = "ONLY AVAILABLE IN PROFESSIONAL AND CORPORATE PLANS"
        assert _is_upsell_string(s) is True

    def test_is_upsell_string_detects_lowercase_variant(self):
        # Newsdata tier-gated text appears verbatim, but defend against
        # variations of casing / phrasing.
        assert _is_upsell_string("only available in professional plans") is True
        assert _is_upsell_string("upgrade to corporate plan to access") is True

    def test_is_upsell_string_passes_real_sentiment(self):
        assert _is_upsell_string("positive") is False
        assert _is_upsell_string("negative") is False
        assert _is_upsell_string("neutral") is False
        assert _is_upsell_string(None) is False
        assert _is_upsell_string(0.5) is False

    def test_clean_upstream_sentiment_strips_upsell_text(self):
        upsell = "ONLY AVAILABLE IN PROFESSIONAL AND CORPORATE PLANS"
        assert _clean_upstream_sentiment(upsell) is None

    def test_clean_upstream_sentiment_passes_real_value(self):
        assert _clean_upstream_sentiment("positive") == "positive"

    def test_clean_upstream_relevance_drops_upsell_text(self):
        upsell = "ONLY AVAILABLE IN PROFESSIONAL AND CORPORATE PLANS"
        assert _clean_upstream_relevance(upsell) is None

    def test_clean_upstream_relevance_keeps_numeric(self):
        assert _clean_upstream_relevance(0.7) == pytest.approx(0.7)
        assert _clean_upstream_relevance("0.42") == pytest.approx(0.42)

    def test_news_article_validator_neutralizes_upsell(self):
        """Constructing NewsArticle with the literal upsell string
        in ``sentiment=`` must not raise and must coerce to ``neutral``."""
        upsell = "ONLY AVAILABLE IN PROFESSIONAL AND CORPORATE PLANS"
        article = NewsArticle(
            title="Test headline",
            description=None,
            url="https://example.com/x",
            source="Reuters",
            published_at="2026-05-05 10:00:00",
            sentiment=upsell,
        )
        assert article.sentiment == "neutral"

    def test_parse_articles_does_not_leak_upsell_text(self):
        """End-to-end: a Newsdata-shaped item with upsell sentiment must
        produce an article whose sentiment is one of the canonical
        bullish/bearish/neutral tokens (never the upsell string)."""
        upsell = "ONLY AVAILABLE IN PROFESSIONAL AND CORPORATE PLANS"
        raw = [{
            "title": "AMD beats Q1 estimates",
            "description": "Advanced Micro Devices reported strong results.",
            "link": "https://reuters.com/amd-q1",
            "source_name": "Reuters",
            "source_id": "reuters",
            "source_priority": 50,
            "pubDate": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "sentiment": upsell,
            "relevance": upsell,
        }]
        out = _parse_articles(raw, symbols=["AMD"])
        assert len(out) == 1
        assert out[0].sentiment in ("bullish", "bearish", "neutral")
        assert "ONLY AVAILABLE" not in (out[0].sentiment or "")


# ── B2.26 — source resolution ─────────────────────────────────────────────────

class TestSourceResolution:
    def test_source_name_wins(self):
        item = {"source_name": "Reuters", "source_id": "reuters", "link": "https://reuters.com/x"}
        assert _resolve_source(item) == "Reuters"

    def test_source_id_capitalizes_when_name_missing(self):
        item = {"source_name": None, "source_id": "benzinga", "link": "https://benzinga.com/x"}
        assert _resolve_source(item) == "Benzinga"

    def test_multi_word_source_id_capitalizes_each_token(self):
        item = {"source_name": None, "source_id": "yahoo finance", "link": ""}
        assert _resolve_source(item) == "Yahoo Finance"

    def test_url_host_fallback(self):
        item = {"source_name": None, "source_id": None, "link": "https://www.benzinga.com/markets/x"}
        assert _resolve_source(item) == "Benzinga"

    def test_returns_unknown_when_all_missing(self):
        item = {"source_name": None, "source_id": None, "link": None}
        assert _resolve_source(item) == "unknown"


# ── B2.27 — compute_relevance helper ──────────────────────────────────────────

class TestComputeRelevance:
    def test_symbol_in_title_returns_1(self):
        score = compute_relevance(
            title="AMD posts blockbuster Q1",
            description="Sector reacted positively.",
            symbol="AMD",
            company="Advanced Micro Devices",
        )
        assert score == 1.0

    def test_company_in_title_returns_1(self):
        score = compute_relevance(
            title="Apple unveils new iPhone",
            description=None,
            symbol="AAPL",
            company="Apple",
        )
        assert score == 1.0

    def test_symbol_in_description_only_returns_0_5(self):
        score = compute_relevance(
            title="Tech stocks rally broadly",
            description="AMD led the gains, with a 5% move.",
            symbol="AMD",
            company="Advanced Micro Devices",
        )
        assert score == 0.5

    def test_no_match_returns_0(self):
        score = compute_relevance(
            title="Asia-Pacific markets news wrap",
            description="Trump pauses Project Freedom.",
            symbol="AMD",
            company="Advanced Micro Devices",
        )
        assert score == 0.0

    def test_no_symbol_and_no_company_returns_0(self):
        score = compute_relevance(
            title="Anything",
            description="anything",
            symbol=None,
            company=None,
        )
        assert score == 0.0


# ── B2.1 — sentiment / magnitude / confidence heuristic ───────────────────────

class TestSentimentClassifier:
    @pytest.mark.parametrize("title", [
        "AMD tops estimates and rallies on AI demand",
        "Apple beats expectations, raises guidance",
        "Stock surges to all-time high after blowout earnings",
        "Analysts upgrade outlook, citing strong growth",
    ])
    def test_bullish_titles(self, title: str):
        label, _ = _classify_sentiment(title)
        assert label == "bullish"

    @pytest.mark.parametrize("title", [
        "AMD misses Q1 estimates, shares tumble",
        "Apple plunges on guidance cut warning",
        "Investigation looms over earnings shortfall",
        "Stock declines on weak demand and downgrade",
    ])
    def test_bearish_titles(self, title: str):
        label, _ = _classify_sentiment(title)
        assert label == "bearish"

    def test_neutral_for_no_signal(self):
        label, conf = _classify_sentiment("AMD reports Q1 results today")
        assert label == "neutral"
        assert conf == 0.5

    def test_confidence_grows_with_stacked_signals(self):
        single = _classify_sentiment("AMD beats estimates")[1]
        multi = _classify_sentiment(
            "AMD beats estimates, surges to record after blockbuster quarter and raises guidance"
        )[1]
        assert multi > single
        assert multi <= 0.85

    def test_mixed_signals_drop_confidence(self):
        label, conf = _classify_sentiment("AMD beats but warns on Q2 outlook")
        # 1 bull / 1 bear → neutral with low confidence (<0.5)
        assert label == "neutral"
        assert conf < 0.5

    def test_magnitude_large(self):
        assert _classify_magnitude("Stock surges on blockbuster earnings") == "large"
        assert _classify_magnitude("Stock plunges on warning") == "large"

    def test_magnitude_medium(self):
        assert _classify_magnitude("Stock drops on raised concerns") == "medium"

    def test_magnitude_small(self):
        assert _classify_magnitude("AMD reports Q1 results today") == "small"


# ── B2.3 — earnings category tightening ───────────────────────────────────────

class TestEarningsCategoryTightening:
    def test_geopolitical_news_with_earnings_keyword_loses_tag(self):
        # Real-world example from the audit: AMD page tagged a
        # geopolitical wrap as EARNINGS just because the recommender
        # category-matched on "earnings" keywords elsewhere.
        result = _tighten_earnings_category(
            category="earnings",
            title="investingLive Asia-Pacific news wrap: Trump pauses Project Freedom",
            description="Sector earnings season rolls on.",
            symbol="AMD",
            company="Advanced Micro Devices",
        )
        assert result is None

    def test_real_amd_earnings_keeps_tag(self):
        result = _tighten_earnings_category(
            category="earnings",
            title="AMD beats Q1 estimates on AI chip demand",
            description="Strong revenue growth.",
            symbol="AMD",
            company="Advanced Micro Devices",
        )
        assert result == "earnings"

    def test_company_in_description_keeps_tag(self):
        result = _tighten_earnings_category(
            category="earnings",
            title="Tech sector reports mixed Q1 results",
            description="Apple led the gainers, citing strong iPhone demand.",
            symbol="AAPL",
            company="Apple",
        )
        assert result == "earnings"

    def test_passes_through_non_earnings_category(self):
        result = _tighten_earnings_category(
            category="M&A",
            title="Acme acquires Foo for $1B",
            description=None,
            symbol="ACM",
            company="Acme",
        )
        assert result == "M&A"


# ── B2.4 — near-duplicate dedupe ──────────────────────────────────────────────

class TestDedupSimilarArticles:
    @staticmethod
    def _mk(title: str, score: float, hours_ago: float = 0.0) -> NewsArticle:
        ts = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
        return NewsArticle(
            title=title,
            description=None,
            url=f"https://example.com/{title.replace(' ', '-')}",
            source="Reuters",
            published_at=ts.strftime("%Y-%m-%d %H:%M:%S"),
            relevance_score=score,
        )

    def test_collapses_two_amd_earnings_stories(self):
        # Two AMD earnings headlines with high token overlap should
        # collapse; the unrelated Tesla headline should remain.
        articles = [
            self._mk("AMD beats Q1 earnings estimates", 0.9, hours_ago=10),
            self._mk("AMD beats Q1 estimates on AI demand", 0.8, hours_ago=11),
            self._mk("Tesla unrelated headline", 0.6, hours_ago=11),
        ]
        out = _dedupe_similar_articles(articles)
        assert len(out) == 2
        amd = next(a for a in out if "AMD" in a.title)
        # Highest score wins — the canonical is the 0.9 article.
        assert amd.relevance_score == pytest.approx(0.9)
        # duplicate_count = 1 sibling collapsed.
        assert amd.duplicate_count == 1

    def test_does_not_collapse_distant_publishes(self):
        articles = [
            self._mk("AMD beats estimates", 0.9, hours_ago=2),
            # Same headline a week later → different event, do not collapse.
            self._mk("AMD beats estimates", 0.8, hours_ago=24 * 7),
        ]
        out = _dedupe_similar_articles(articles)
        assert len(out) == 2

    def test_keeps_unique_articles_intact(self):
        articles = [
            self._mk("AMD tops Q1", 0.9, hours_ago=10),
            self._mk("Apple unveils new iPhone", 0.8, hours_ago=11),
        ]
        out = _dedupe_similar_articles(articles)
        assert len(out) == 2
        for a in out:
            assert a.duplicate_count == 0


# ── V1.1 — demo articles must not leak to production ─────────────────────────

class TestDemoFallbackOnlyWhenKeyMissing:
    """When NEWSDATA_API_KEY is configured, an empty/errored fetch must
    surface as an empty result — not as fake demo headlines with empty
    hrefs. Demo articles are a development affordance for environments
    without an API key, not a fallback for transient provider failures.

    Live evidence from /symbols/TSLA: users were seeing five plausible-
    looking headlines (e.g. "TSLA dividend increase signals management
    confidence" — Tesla doesn't pay a dividend) with ``href=""`` and
    relevance score 0.00, indistinguishable from real news.
    """

    @staticmethod
    def _key_secret(value: str):
        class _Key:
            def __init__(self, v: str) -> None:
                self._v = v

            def get_secret_value(self) -> str:
                return self._v

        return _Key(value)

    @pytest.mark.asyncio
    async def test_returns_empty_when_provider_empty_and_key_configured(self):
        """The production failure mode: provider returned [] (rate-limit /
        timeout / HTTP error / etc.) but the key is configured. Result
        must be an empty article list, never demo headlines."""
        from core.config import settings

        original_key = settings.NEWSDATA_API_KEY
        try:
            settings.NEWSDATA_API_KEY = self._key_secret("configured-real-key")  # type: ignore[assignment]

            with patch("services.news._fetch_newsdata", AsyncMock(return_value=[])), \
                 patch("core.redis.cache_get", AsyncMock(return_value=None)), \
                 patch("core.redis.cache_set", AsyncMock()):
                resp = await fetch_symbol_news("TSLA", limit=5)
        finally:
            settings.NEWSDATA_API_KEY = original_key

        assert resp.is_demo is False, (
            "Configured API key + empty provider response must NOT serve "
            "demo articles — that's how fake headlines reached production"
        )
        assert resp.articles == []
        assert resp.count == 0

    @pytest.mark.asyncio
    async def test_serves_demo_when_key_truly_missing(self):
        """Local-dev contract preserved: when NEWSDATA_API_KEY is empty
        (no key configured), demo articles still render so the page is
        not blank in development."""
        from core.config import settings

        original_key = settings.NEWSDATA_API_KEY
        try:
            settings.NEWSDATA_API_KEY = self._key_secret("")  # type: ignore[assignment]

            with patch("services.news._fetch_newsdata", AsyncMock(return_value=[])), \
                 patch("core.redis.cache_get", AsyncMock(return_value=None)), \
                 patch("core.redis.cache_set", AsyncMock()):
                resp = await fetch_symbol_news("AAPL", limit=5)
        finally:
            settings.NEWSDATA_API_KEY = original_key

        assert resp.is_demo is True
        assert len(resp.articles) > 0
