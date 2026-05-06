"""Tests for the tail-risk signal plumbing in
``services.earnings_screener``.

Covers TR-1 (sync builder), TR-2 (sector cohort), TR-3 (analyst PT),
TR-4 (news sentiment), and an AMD-style integration test that exercises
the recommender end-to-end with all signals firing.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from api.schemas.earnings import TailRiskSignals


# ─── TR-1: sync builder ───────────────────────────────────────


def test_build_tail_risk_signals_intraday_only():
    """Quote.change_pct → intraday_momentum_pct (fraction)."""
    from services.earnings_screener import _build_tail_risk_signals

    signals = _build_tail_risk_signals(
        quote={"change_pct": 4.3},  # 4.3% — fired
        metrics=None,
        prior_moves=None,
    )
    assert signals.intraday_momentum_pct == pytest.approx(0.043)
    assert signals.historical_move_kurtosis is None
    assert signals.iv_term_steepness is None


def test_build_tail_risk_signals_kurtosis_from_prior_moves():
    """Kurtosis computed when n>=4 prior moves (>3 = fat-tail vs normal)."""
    from services.earnings_screener import _build_tail_risk_signals

    # Mostly small moves with one outlier — kurtosis well above 3.
    moves = [-1.0, -0.5, 0.5, 1.0, 0.2, -0.3, 12.0]
    signals = _build_tail_risk_signals(quote=None, metrics=None, prior_moves=moves)
    assert signals.historical_move_kurtosis is not None
    # Plain (non-excess) kurtosis: normal sample → 3, fat-tail outlier → >3.
    assert signals.historical_move_kurtosis > 3.0


def test_build_tail_risk_signals_kurtosis_too_few_moves():
    """n<4 → kurtosis None (not enough data for stable estimate)."""
    from services.earnings_screener import _build_tail_risk_signals

    signals = _build_tail_risk_signals(
        quote=None, metrics=None, prior_moves=[1.0, -1.0, 0.5],
    )
    assert signals.historical_move_kurtosis is None


def test_build_tail_risk_signals_iv_term_steepness():
    """metrics.term_structure → iv_term_steepness."""
    from services.earnings_screener import _build_tail_risk_signals

    metrics = {"term_structure": {"2026-05-09": 0.65, "2026-06-20": 0.40}}
    signals = _build_tail_risk_signals(quote=None, metrics=metrics, prior_moves=None)
    # 0.65/0.40 - 1 = 0.625
    assert signals.iv_term_steepness == pytest.approx(0.625)


def test_build_tail_risk_signals_extra_kwargs_passed_through():
    """TR-1: cohort/PT/sentiment kwargs flow into the model unchanged."""
    from services.earnings_screener import _build_tail_risk_signals

    signals = _build_tail_risk_signals(
        quote={"change_pct": 1.0},
        metrics=None,
        prior_moves=None,
        sector_cohort_momentum_avg=0.025,
        analyst_pt_changes_24h=3,
        news_sentiment=0.7,
    )
    assert signals.sector_cohort_momentum_avg == pytest.approx(0.025)
    assert signals.analyst_pt_changes_24h == 3
    assert signals.news_sentiment == pytest.approx(0.7)


def test_build_tail_risk_signals_handles_bad_change_pct():
    """Garbage in change_pct → None, not a crash."""
    from services.earnings_screener import _build_tail_risk_signals

    signals = _build_tail_risk_signals(
        quote={"change_pct": "not-a-number"},
        metrics=None,
        prior_moves=None,
    )
    assert signals.intraday_momentum_pct is None


# ─── TR-2: sector cohort momentum ─────────────────────────────


@pytest.mark.asyncio
async def test_sector_cohort_unmapped_returns_none():
    """Symbol not in SECTOR_COHORT → None (recommender treats as no-signal)."""
    from services.earnings_screener import _compute_sector_cohort_momentum

    result = await _compute_sector_cohort_momentum("ZZZZ_NOT_A_TICKER")
    assert result is None


@pytest.mark.asyncio
async def test_sector_cohort_averages_peer_quotes():
    """All peers up → cohort average matches (in fraction units)."""
    from services import earnings_screener as svc

    # AMD peers all up ~3% on the day. _load_quote returns change_pct in
    # 0-100 scale. Expected: 3.0 / 100 = 0.03 fraction.
    async def fake_load_quote(symbol: str):
        return {"last": 200.0, "change": 6.0, "change_pct": 3.0}

    with patch.object(svc, "_load_quote", side_effect=fake_load_quote):
        result = await svc._compute_sector_cohort_momentum("AMD")
    assert result == pytest.approx(0.03)


@pytest.mark.asyncio
async def test_sector_cohort_skips_failed_quotes():
    """Some peers fail — cohort average uses the successes."""
    from services import earnings_screener as svc

    call_count = {"n": 0}

    async def fake_load_quote(symbol: str):
        call_count["n"] += 1
        if call_count["n"] % 2 == 0:
            raise RuntimeError("transient")
        return {"change_pct": 2.0}

    with patch.object(svc, "_load_quote", side_effect=fake_load_quote):
        result = await svc._compute_sector_cohort_momentum("AMD")
    # Half succeeded with change_pct=2.0 → 0.02 fraction.
    assert result == pytest.approx(0.02)


@pytest.mark.asyncio
async def test_sector_cohort_all_quotes_fail_returns_none():
    """Every cohort fetch failed → None."""
    from services import earnings_screener as svc

    async def fake_load_quote(symbol: str):
        return None

    with patch.object(svc, "_load_quote", side_effect=fake_load_quote):
        result = await svc._compute_sector_cohort_momentum("AMD")
    assert result is None


# ─── TR-3: analyst PT changes (FMP) ───────────────────────────


def _fmp_pt_payload(now: datetime, n_buys: int, n_sells: int) -> list[dict]:
    """Build a fake FMP /v4/upgrades-downgrades response."""
    out: list[dict] = []
    for _ in range(n_buys):
        out.append({
            "publishedDate": now.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "newGrade": "Buy",
        })
    for _ in range(n_sells):
        out.append({
            "publishedDate": now.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "newGrade": "Sell",
        })
    return out


@pytest.mark.asyncio
async def test_pt_changes_net_count(monkeypatch):
    """3 buys − 1 sell = +2 net."""
    import httpx

    from services import earnings_screener as svc

    now = datetime.now(timezone.utc)
    payload = _fmp_pt_payload(now, n_buys=3, n_sells=1)

    class _FakeResp:
        status_code = 200
        def json(self):
            return payload

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, *a, **kw):
            return _FakeResp()

    async def fake_cache_get(_k):
        return None
    async def fake_cache_set(*_a, **_kw):
        return None

    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    # Force an API key so the early-return branch doesn't trip.
    from core.config import settings
    monkeypatch.setattr(settings, "FMP_API_KEY", type(settings.FMP_API_KEY)("test-key"))

    with patch("core.redis.cache_get", new=AsyncMock(side_effect=fake_cache_get)), \
         patch("core.redis.cache_set", new=AsyncMock(side_effect=fake_cache_set)):
        result = await svc._fetch_analyst_pt_changes_24h("AMD")
    assert result == 2


@pytest.mark.asyncio
async def test_pt_changes_handles_malformed_data(monkeypatch):
    """Non-list response → 0 (no crash)."""
    import httpx

    from services import earnings_screener as svc

    class _FakeResp:
        status_code = 200
        def json(self):
            return {"error": "rate limit"}

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, *a, **kw):
            return _FakeResp()

    async def fake_cache_get(_k):
        return None
    async def fake_cache_set(*_a, **_kw):
        return None

    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    from core.config import settings
    monkeypatch.setattr(settings, "FMP_API_KEY", type(settings.FMP_API_KEY)("test-key"))

    with patch("core.redis.cache_get", new=AsyncMock(side_effect=fake_cache_get)), \
         patch("core.redis.cache_set", new=AsyncMock(side_effect=fake_cache_set)):
        result = await svc._fetch_analyst_pt_changes_24h("AMD")
    assert result == 0


@pytest.mark.asyncio
async def test_pt_changes_excludes_old_entries(monkeypatch):
    """Entries older than 24h excluded from net count."""
    import httpx

    from services import earnings_screener as svc

    old = datetime.now(timezone.utc) - timedelta(hours=48)
    fresh = datetime.now(timezone.utc)
    payload = [
        {"publishedDate": old.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "newGrade": "Buy"},
        {"publishedDate": old.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "newGrade": "Buy"},
        {"publishedDate": fresh.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "newGrade": "Buy"},
    ]

    class _FakeResp:
        status_code = 200
        def json(self):
            return payload

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def get(self, *a, **kw):
            return _FakeResp()

    async def fake_cache_get(_k):
        return None
    async def fake_cache_set(*_a, **_kw):
        return None

    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    from core.config import settings
    monkeypatch.setattr(settings, "FMP_API_KEY", type(settings.FMP_API_KEY)("test-key"))

    with patch("core.redis.cache_get", new=AsyncMock(side_effect=fake_cache_get)), \
         patch("core.redis.cache_set", new=AsyncMock(side_effect=fake_cache_set)):
        result = await svc._fetch_analyst_pt_changes_24h("AMD")
    # Only the fresh Buy counts.
    assert result == 1


@pytest.mark.asyncio
async def test_pt_changes_no_api_key_returns_zero(monkeypatch):
    """Missing FMP key → 0 (no upstream call)."""
    from services import earnings_screener as svc

    async def fake_cache_get(_k):
        return None

    from core.config import settings
    monkeypatch.setattr(settings, "FMP_API_KEY", type(settings.FMP_API_KEY)(""))

    with patch("core.redis.cache_get", new=AsyncMock(side_effect=fake_cache_get)):
        result = await svc._fetch_analyst_pt_changes_24h("AMD")
    assert result == 0


# ─── TR-4: news sentiment ──────────────────────────────────────


@pytest.mark.asyncio
async def test_news_sentiment_uses_api_field(monkeypatch):
    """Articles with sentiment field → average mapped to ±1/0."""
    from services.news import NewsArticle, NewsResponse
    from services import earnings_screener as svc

    now = datetime.now(timezone.utc)
    pub = now.strftime("%Y-%m-%d %H:%M:%S")
    articles = [
        NewsArticle(title="Beats", description="", url="x", source="s",
                    published_at=pub, sentiment="positive"),
        NewsArticle(title="Beats again", description="", url="y", source="s",
                    published_at=pub, sentiment="positive"),
        NewsArticle(title="Mixed", description="", url="z", source="s",
                    published_at=pub, sentiment="negative"),
    ]
    resp = NewsResponse(articles=articles, query="AMD", count=3)

    async def fake_fetch(_sym, limit=30):
        return resp

    async def fake_cache_get(_k):
        return None
    async def fake_cache_set(*_a, **_kw):
        return None

    monkeypatch.setattr("services.news.fetch_symbol_news", fake_fetch)

    with patch("core.redis.cache_get", new=AsyncMock(side_effect=fake_cache_get)), \
         patch("core.redis.cache_set", new=AsyncMock(side_effect=fake_cache_set)):
        result = await svc._compute_news_sentiment_24h("AMD")
    # (1 + 1 - 1) / 3 = 0.333...
    assert result == pytest.approx(1 / 3)


@pytest.mark.asyncio
async def test_news_sentiment_keyword_fallback(monkeypatch):
    """No API sentiment → keyword polarity fallback."""
    from services.news import NewsArticle, NewsResponse
    from services import earnings_screener as svc

    now = datetime.now(timezone.utc)
    pub = now.strftime("%Y-%m-%d %H:%M:%S")
    articles = [
        NewsArticle(title="Stock surges to record on growth beat",
                    description="", url="x", source="s",
                    published_at=pub, sentiment=None),
        NewsArticle(title="Earnings beat lifts shares",
                    description="", url="y", source="s",
                    published_at=pub, sentiment=None),
    ]
    resp = NewsResponse(articles=articles, query="AMD", count=2)

    async def fake_fetch(_sym, limit=30):
        return resp
    async def fake_cache_get(_k):
        return None
    async def fake_cache_set(*_a, **_kw):
        return None

    monkeypatch.setattr("services.news.fetch_symbol_news", fake_fetch)
    with patch("core.redis.cache_get", new=AsyncMock(side_effect=fake_cache_get)), \
         patch("core.redis.cache_set", new=AsyncMock(side_effect=fake_cache_set)):
        result = await svc._compute_news_sentiment_24h("AMD")
    assert result is not None
    assert result > 0  # bullish keywords dominate


@pytest.mark.asyncio
async def test_news_sentiment_no_recent_returns_none(monkeypatch):
    """All articles >24h old → None (not 0)."""
    from services.news import NewsArticle, NewsResponse
    from services import earnings_screener as svc

    old = datetime.now(timezone.utc) - timedelta(hours=72)
    pub = old.strftime("%Y-%m-%d %H:%M:%S")
    articles = [
        NewsArticle(title="Stale headline", description="", url="x", source="s",
                    published_at=pub, sentiment="positive"),
    ]
    resp = NewsResponse(articles=articles, query="AMD", count=1)

    async def fake_fetch(_sym, limit=30):
        return resp
    async def fake_cache_get(_k):
        return None
    async def fake_cache_set(*_a, **_kw):
        return None

    monkeypatch.setattr("services.news.fetch_symbol_news", fake_fetch)
    with patch("core.redis.cache_get", new=AsyncMock(side_effect=fake_cache_get)), \
         patch("core.redis.cache_set", new=AsyncMock(side_effect=fake_cache_set)):
        result = await svc._compute_news_sentiment_24h("AMD")
    assert result is None


@pytest.mark.asyncio
async def test_news_sentiment_fetch_failure_returns_none(monkeypatch):
    """News fetch raises → None (caller graceful)."""
    from services import earnings_screener as svc

    async def fake_fetch(_sym, limit=30):
        raise RuntimeError("api down")

    async def fake_cache_get(_k):
        return None

    monkeypatch.setattr("services.news.fetch_symbol_news", fake_fetch)
    with patch("core.redis.cache_get", new=AsyncMock(side_effect=fake_cache_get)):
        result = await svc._compute_news_sentiment_24h("AMD")
    assert result is None


# ─── TR-1 async wrapper integration ────────────────────────────


@pytest.mark.asyncio
async def test_build_tail_risk_signals_async_combines_all(monkeypatch):
    """Async wrapper merges sync + the 3 async sources."""
    from services import earnings_screener as svc

    async def fake_cohort(_sym):
        return 0.025
    async def fake_pt(_sym):
        return 2
    async def fake_sent(_sym):
        return 0.7

    monkeypatch.setattr(svc, "_compute_sector_cohort_momentum", fake_cohort)
    monkeypatch.setattr(svc, "_fetch_analyst_pt_changes_24h", fake_pt)
    monkeypatch.setattr(svc, "_compute_news_sentiment_24h", fake_sent)

    signals = await svc._build_tail_risk_signals_async(
        "AMD",
        quote={"change_pct": 4.3},
        metrics={"term_structure": {"2026-05-09": 0.55, "2026-06-20": 0.40}},
        prior_moves=[-2.0, -1.0, 1.0, 2.0, 10.0],
    )
    assert signals.intraday_momentum_pct == pytest.approx(0.043)
    assert signals.sector_cohort_momentum_avg == pytest.approx(0.025)
    assert signals.analyst_pt_changes_24h == 2
    assert signals.news_sentiment == pytest.approx(0.7)
    assert signals.historical_move_kurtosis is not None
    assert signals.iv_term_steepness == pytest.approx(0.55 / 0.40 - 1.0)


@pytest.mark.asyncio
async def test_build_tail_risk_signals_async_swallows_failures(monkeypatch):
    """Each async fetcher can fail independently — wrapper degrades."""
    from services import earnings_screener as svc

    async def fail_cohort(_sym):
        raise RuntimeError("boom")
    async def fail_pt(_sym):
        raise RuntimeError("boom")
    async def fail_sent(_sym):
        raise RuntimeError("boom")

    monkeypatch.setattr(svc, "_compute_sector_cohort_momentum", fail_cohort)
    monkeypatch.setattr(svc, "_fetch_analyst_pt_changes_24h", fail_pt)
    monkeypatch.setattr(svc, "_compute_news_sentiment_24h", fail_sent)

    signals = await svc._build_tail_risk_signals_async(
        "AMD",
        quote={"change_pct": 1.0},
        metrics=None,
        prior_moves=None,
    )
    assert signals.sector_cohort_momentum_avg is None
    assert signals.analyst_pt_changes_24h == 0
    assert signals.news_sentiment is None


# ─── AMD-style integration (recommender demote on full-fire signals) ──


@pytest.mark.asyncio
async def test_amd_integration_signals_demote_short_vol():
    """All-fire signals → tail_risk_score >= 0.6 (recommender demote band).

    AMD-style scenario: +4.3% intraday, cohort +2.5%, 2 PT raises,
    bullish sentiment 0.7, kurtosis 4.5, steep IV term. The score
    function caps at 1.0 but threshold for demoting short-vol is 0.6.
    """
    from services.earnings_recommender import _compute_tail_risk_score

    signals = TailRiskSignals(
        intraday_momentum_pct=0.043,
        sector_cohort_momentum_avg=0.025,
        analyst_pt_changes_24h=2,
        news_sentiment=0.7,
        historical_move_kurtosis=4.5,
        iv_term_steepness=0.35,
    )
    score = _compute_tail_risk_score(signals)
    # 0.25 + 0.20 + 0.15 + 0.15 + 0.15 + 0.10 = 1.0 (capped).
    assert score == pytest.approx(1.0)
    assert score >= 0.6  # crosses demote threshold


@pytest.mark.asyncio
async def test_amd_integration_only_intraday_kurtosis_iv_steepness():
    """Minimal-fire scenario (the "Done when" floor): intraday +
    kurtosis + IV steepness all fire, but cohort/PT/sentiment None.

    Confirms the recommender already produces a non-trivial score from
    just the locally-derived signals so the screener degrades gracefully
    when upstream lookups fail.
    """
    from services.earnings_recommender import _compute_tail_risk_score

    signals = TailRiskSignals(
        intraday_momentum_pct=0.05,           # +0.25
        sector_cohort_momentum_avg=None,
        analyst_pt_changes_24h=0,
        news_sentiment=None,
        historical_move_kurtosis=4.5,         # +0.15
        iv_term_steepness=0.35,               # +0.10
    )
    score = _compute_tail_risk_score(signals)
    # 0.25 + 0.15 + 0.10 = 0.50.
    assert score == pytest.approx(0.50)


# ─── TR-5 (Wave V V3): options volume signals ─────────────────


class _StubContract:
    """Minimal contract stub for chain-volume tests."""

    def __init__(self, option_type: str, volume: int):
        self.option_type = option_type
        self.volume = volume


class _StubChain:
    def __init__(self, contracts):
        self.contracts = contracts


def test_total_chain_volume_splits_calls_puts():
    """Sum-by-side helper splits volumes correctly."""
    from services.earnings_screener import _total_chain_volume

    chain = _StubChain([
        _StubContract("call", 100),
        _StubContract("call", 200),
        _StubContract("put", 50),
        _StubContract("call", 0),       # zero contributes nothing
        _StubContract("put", None),     # broken contributes nothing
    ])
    total, calls, puts = _total_chain_volume(chain)
    assert calls == 300
    assert puts == 50
    assert total == 350


def test_underlying_relative_volume_from_quote_present():
    """Quote with relative_volume populated → float passthrough."""
    from services.earnings_screener import _underlying_relative_volume_from_quote

    assert _underlying_relative_volume_from_quote({"relative_volume": 2.4}) == pytest.approx(2.4)


def test_underlying_relative_volume_from_quote_absent_or_bad():
    """Quote without relative_volume / bad value → None."""
    from services.earnings_screener import _underlying_relative_volume_from_quote

    assert _underlying_relative_volume_from_quote(None) is None
    assert _underlying_relative_volume_from_quote({}) is None
    assert _underlying_relative_volume_from_quote({"relative_volume": None}) is None
    assert _underlying_relative_volume_from_quote({"relative_volume": "junk"}) is None
    # Zero / negative are nonsensical for this ratio → no signal.
    assert _underlying_relative_volume_from_quote({"relative_volume": 0}) is None


@pytest.mark.asyncio
async def test_compute_options_volume_signals_skew_no_history(monkeypatch):
    """Cold cache → skew computed, unusual=False (no baseline yet)."""
    from services import earnings_screener as svc

    chain = _StubChain([
        _StubContract("call", 1000),
        _StubContract("put", 250),
    ])
    # Empty history on first call.
    storage: dict[str, Any] = {}

    async def fake_get(k):
        return storage.get(k)
    async def fake_set(k, v, ttl_seconds=0):
        storage[k] = v

    monkeypatch.setattr("core.redis.cache_get", fake_get)
    monkeypatch.setattr("core.redis.cache_set", fake_set)

    skew, unusual = await svc._compute_options_volume_signals("AMD", chain=chain)
    # 1000 / max(250, 1) = 4.0
    assert skew == pytest.approx(4.0)
    # No baseline yet → no flag.
    assert unusual is False
    # The history was persisted with today's entry.
    key = f"earnings:tr:options_vol_hist:AMD"
    assert key in storage
    persisted = storage[key]
    assert isinstance(persisted, list) and len(persisted) == 1
    assert persisted[0][1] == 1250


@pytest.mark.asyncio
async def test_compute_options_volume_signals_unusual_when_baseline_exceeded(monkeypatch):
    """Today's chain volume > 3× rolling avg → unusual=True."""
    from services import earnings_screener as svc

    today = datetime.now(timezone.utc).date()
    # 5 prior days at ~1000 total volume each — avg = 1000.
    history = [
        ((today - timedelta(days=i + 1)).isoformat(), 1000)
        for i in range(5)
    ]
    storage = {f"earnings:tr:options_vol_hist:AMD": list(history)}

    async def fake_get(k):
        return storage.get(k)
    async def fake_set(k, v, ttl_seconds=0):
        storage[k] = v

    monkeypatch.setattr("core.redis.cache_get", fake_get)
    monkeypatch.setattr("core.redis.cache_set", fake_set)

    # Today's chain: 4000 total ( = 4× avg ) → unusual.
    chain = _StubChain([
        _StubContract("call", 3500),
        _StubContract("put", 500),
    ])
    skew, unusual = await svc._compute_options_volume_signals("AMD", chain=chain)
    # skew = 3500 / 500 = 7.0
    assert skew == pytest.approx(7.0)
    assert unusual is True


@pytest.mark.asyncio
async def test_compute_options_volume_signals_idempotent_per_day(monkeypatch):
    """Two calls on the same UTC date → today's entry is replaced, not duplicated."""
    from services import earnings_screener as svc

    storage: dict[str, Any] = {}

    async def fake_get(k):
        return storage.get(k)
    async def fake_set(k, v, ttl_seconds=0):
        storage[k] = v

    monkeypatch.setattr("core.redis.cache_get", fake_get)
    monkeypatch.setattr("core.redis.cache_set", fake_set)

    c1 = _StubChain([_StubContract("call", 100), _StubContract("put", 100)])
    c2 = _StubChain([_StubContract("call", 200), _StubContract("put", 200)])
    await svc._compute_options_volume_signals("AMD", chain=c1)
    await svc._compute_options_volume_signals("AMD", chain=c2)

    persisted = storage["earnings:tr:options_vol_hist:AMD"]
    assert len(persisted) == 1
    # The second call's volume (400) replaced the first (200).
    assert persisted[0][1] == 400


@pytest.mark.asyncio
async def test_compute_options_volume_signals_chain_none(monkeypatch):
    """No chain → no signals, no Redis I/O."""
    from services import earnings_screener as svc

    async def fail(*_a, **_kw):
        raise AssertionError("should not be called when chain is None")

    monkeypatch.setattr("core.redis.cache_get", fail)
    monkeypatch.setattr("core.redis.cache_set", fail)

    skew, unusual = await svc._compute_options_volume_signals("AMD", chain=None)
    assert skew is None
    assert unusual is False


@pytest.mark.asyncio
async def test_build_tail_risk_signals_async_threads_volume_signals(monkeypatch):
    """The async wrapper passes the chain into the volume fetcher and surfaces
    every Wave V V3 field on the resulting model."""
    from services import earnings_screener as svc

    async def fake_cohort(_sym):
        return None
    async def fake_pt(_sym):
        return 0
    async def fake_sent(_sym):
        return None

    captured: dict[str, Any] = {}

    async def fake_volume(symbol, *, chain):
        captured["symbol"] = symbol
        captured["chain"] = chain
        return 3.5, True

    monkeypatch.setattr(svc, "_compute_sector_cohort_momentum", fake_cohort)
    monkeypatch.setattr(svc, "_fetch_analyst_pt_changes_24h", fake_pt)
    monkeypatch.setattr(svc, "_compute_news_sentiment_24h", fake_sent)
    monkeypatch.setattr(svc, "_compute_options_volume_signals", fake_volume)

    chain = _StubChain([])
    signals = await svc._build_tail_risk_signals_async(
        "AMD",
        quote={"change_pct": 1.0, "relative_volume": 2.5},
        metrics=None,
        prior_moves=None,
        chain=chain,
    )
    assert captured["symbol"] == "AMD"
    assert captured["chain"] is chain
    assert signals.underlying_relative_volume == pytest.approx(2.5)
    assert signals.options_call_put_volume_skew == pytest.approx(3.5)
    assert signals.unusual_options_activity is True


@pytest.mark.asyncio
async def test_build_tail_risk_signals_async_volume_failure_silent(monkeypatch):
    """Volume fetcher exception → wrapper degrades gracefully (no crash)."""
    from services import earnings_screener as svc

    async def fake_cohort(_sym):
        return None
    async def fake_pt(_sym):
        return 0
    async def fake_sent(_sym):
        return None

    async def fail_vol(*_a, **_kw):
        raise RuntimeError("boom")

    monkeypatch.setattr(svc, "_compute_sector_cohort_momentum", fake_cohort)
    monkeypatch.setattr(svc, "_fetch_analyst_pt_changes_24h", fake_pt)
    monkeypatch.setattr(svc, "_compute_news_sentiment_24h", fake_sent)
    monkeypatch.setattr(svc, "_compute_options_volume_signals", fail_vol)

    signals = await svc._build_tail_risk_signals_async(
        "AMD",
        quote={"change_pct": 1.0},
        metrics=None,
        prior_moves=None,
        chain=_StubChain([]),
    )
    assert signals.options_call_put_volume_skew is None
    assert signals.unusual_options_activity is False
    # underlying_relative_volume stays None when quote lacks the field.
    assert signals.underlying_relative_volume is None


# ─── AMD-style end-to-end with volume signals ──────────────────


@pytest.mark.asyncio
async def test_amd_post_print_volume_skip_threshold():
    """AMD-style integration: volume signals push the score across 0.85
    so the recommender's skip-threshold fires.

    Scenario: relative_volume 2.5×, call/put skew 3.5×, UOA on top of
    intraday + cohort + PT raises → 0.90 score, well past 0.85.
    """
    from services.earnings_recommender import _compute_tail_risk_score

    signals = TailRiskSignals(
        intraday_momentum_pct=0.043,         # +0.25
        sector_cohort_momentum_avg=0.025,    # +0.20
        analyst_pt_changes_24h=2,            # +0.15
        underlying_relative_volume=2.5,      # +0.10
        options_call_put_volume_skew=3.5,    # +0.10
        unusual_options_activity=True,       # +0.10
    )
    score = _compute_tail_risk_score(signals)
    assert score == pytest.approx(0.90)
    assert score >= 0.85  # skip-threshold
