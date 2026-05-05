"""Route + orchestration tests for /api/v1/earnings/{symbol}/analysis.

Wave 4 / Batch S — single-round-trip endpoint orchestrating quote, IV,
calendar entry, chain, news, and prior-moves. Tests:

  * AMD case asserts iron_condor first (high IV, neutral verdict)
  * partial-failure tolerance (one upstream throws → others populate)
  * setups query param caps (1, 5)
  * caching (second call within 60s doesn't re-call upstreams)
  * invalid (non-curated) symbol → 404
  * non-optionable symbol returns analysis without setups

The fixtures mock all six upstreams in unison so we exercise the
orchestrator's dispatch + assembler path without a real network.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app


# ---------------------------------------------------------------------------
# Fakes — synthetic chain mirroring the recommender test fixtures
# ---------------------------------------------------------------------------


@dataclass
class _FakeContract:
    strike: float
    option_type: str
    bid: float
    ask: float
    delta: float
    expiry: date
    last: float = 0.0
    iv: float = 0.5
    gamma: float = 0.0
    theta: float = 0.0
    vega: float = 0.0
    rho: float = 0.0
    volume: int = 100
    open_interest: int = 1000

    def __post_init__(self):
        # Mirror options.OptionType.value access pattern.
        self.option_type = SimpleNamespace(value=self.option_type) if isinstance(
            self.option_type, str
        ) else self.option_type


@dataclass
class _FakeChain:
    underlying: str
    spot_price: float
    expirations: list
    contracts: list
    fetched_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc),
    )
    is_demo: bool = False


def _make_amd_chain() -> _FakeChain:
    """AMD-like chain: spot=356, IV=1.19, DTE=3, ±20% strikes in $5 steps."""
    spot = 356.0
    iv = 1.19
    expiries = [date.today() + timedelta(days=3)]
    strikes: list[float] = []
    s = round(max(5.0, spot * 0.80) / 5) * 5
    while s <= spot * 1.20:
        strikes.append(round(s, 2))
        s += 5
    primary = expiries[0]
    contracts = []
    for K in strikes:
        for exp in expiries:
            tau = max(1, (exp - date.today()).days) / 365.0
            sigma = iv
            sqrt_tau = math.sqrt(tau)
            try:
                d1 = (math.log(spot / K) + 0.5 * sigma * sigma * tau) / (
                    sigma * sqrt_tau
                )
            except (ValueError, ZeroDivisionError):
                d1 = 0.0
            from scipy.stats import norm  # type: ignore[import-untyped]

            call_delta = float(norm.cdf(d1))
            put_delta = call_delta - 1.0
            d2 = d1 - sigma * sqrt_tau
            call_mid = max(0.10, float(spot * norm.cdf(d1) - K * norm.cdf(d2)))
            put_mid = max(0.10, float(K * norm.cdf(-d2) - spot * norm.cdf(-d1)))
            contracts.append(_FakeContract(
                strike=K, option_type="call",
                bid=call_mid * 0.97, ask=call_mid * 1.03,
                delta=call_delta, expiry=exp, iv=sigma,
            ))
            contracts.append(_FakeContract(
                strike=K, option_type="put",
                bid=put_mid * 0.97, ask=put_mid * 1.03,
                delta=put_delta, expiry=exp, iv=sigma,
            ))
    return _FakeChain(
        underlying="AMD",
        spot_price=spot,
        expirations=[primary],
        contracts=contracts,
    )


def _amd_quote() -> dict:
    """Match services.market.Quote.model_dump shape (lower-camelCase keys)."""
    return SimpleNamespace(
        model_dump=lambda: {
            "symbol": "AMD",
            "last": 356.0,
            "change": 5.10,
            "changePct": 1.45,
            "volume": 28_400_000,
            "high": 358.20,
            "low": 351.30,
            "open": 352.40,
            "close": 350.90,
            "is_demo": False,
        }
    )


def _amd_iv():
    """services.options.IVData duck-type with high IV / known HV20."""
    return SimpleNamespace(
        symbol="AMD",
        current_iv=1.19,
        iv_rank=85.0,
        iv_percentile=82.0,
        hv_20=0.65,
        hv_50=0.62,
        hv_100=0.58,
        iv_skew={"340": 1.22, "356": 1.19, "375": 1.21},
        term_structure={"2026-05-08": 1.19, "2026-05-15": 1.05},
        is_demo=False,
        fetched_at=datetime.now(timezone.utc),
    )


def _amd_meta_hydrated() -> dict:
    """Hydrated calendar row carrying the recommender's top_setups + edge."""
    from api.schemas.earnings import EarningsSetup, OptionLeg

    legs = [
        OptionLeg(side="buy", contract_type="put", strike=305.0, expiry=date.today() + timedelta(days=3), mid=2.0),
        OptionLeg(side="sell", contract_type="put", strike=320.0, expiry=date.today() + timedelta(days=3), mid=4.0),
        OptionLeg(side="sell", contract_type="call", strike=395.0, expiry=date.today() + timedelta(days=3), mid=4.5),
        OptionLeg(side="buy", contract_type="call", strike=415.0, expiry=date.today() + timedelta(days=3), mid=2.5),
    ]
    setup = EarningsSetup(
        setup_id="iron_condor",
        legs=legs,
        net_credit_or_debit=4.0,
        max_profit=400.0,
        max_loss=1100.0,
        breakevens=[316.0, 399.0],
        pop_estimate=0.55,
        expected_value=15.0,
        risk_reward=400.0 / 1100.0,
        rationale="IV 119% vs HV 65% (1.8x). Defined-risk short premium.",
        sizing_kelly_pct=0.01,
        is_defined_risk=True,
    )
    return {
        "symbol": "AMD",
        "company": "Advanced Micro Devices",
        "sector": "Technology",
        "report_date": (date.today() + timedelta(days=3)).isoformat(),
        "report_time": "AMC",
        "days_until": 3,
        "report_state": "upcoming",
        "price": 356.0,
        "change": 5.10,
        "change_pct": 1.45,
        "iv_rank": 85.0,
        "premium_yield_call_atm": 0.04,
        "premium_yield_put_atm": 0.038,
        "expected_move_pct": 0.066,
        "hist_avg_abs_move_pct": 0.045,
        "claude_verdict": "neutral-bear",
        "claude_confidence": 0.55,
        "top_setup": "iron condor",
        "top_setups": [setup],
        "edge_score": 78.5,
        "edge_score_reasons": ["IV rank 85 keeps premium rich"],
        "edge_score_components": {"iv_rank": 29.75, "premium_yield": 14.0, "implied_vs_historical": 23.5, "confidence": 8.25, "days_until": 5.0},
    }


def _amd_news() -> list:
    from api.schemas.earnings import NewsArticle

    return [
        NewsArticle(
            title="AMD CEO previews data-center launch",
            source="Reuters",
            published_at=datetime(2026, 5, 4, 14, 30, tzinfo=timezone.utc),
            url="https://example.com/amd-1",
            relevance_score=0.92,
            category="product",
            tier=1,
        ),
        NewsArticle(
            title="AMD analyst upgrade to Buy",
            source="CNBC",
            published_at=datetime(2026, 5, 3, 9, 15, tzinfo=timezone.utc),
            url="https://example.com/amd-2",
            relevance_score=0.85,
            category="rating",
            tier=2,
        ),
    ]


def _amd_history() -> dict:
    return {
        "quarters": [
            {
                "report_date": (date.today() - timedelta(days=90)).isoformat(),
                "surprise_pct": 0.018,
                "next_day_move_pct": 0.052,
                "five_day_move_pct": 0.038,
            },
            {
                "report_date": (date.today() - timedelta(days=180)).isoformat(),
                "surprise_pct": -0.005,
                "next_day_move_pct": -0.041,
                "five_day_move_pct": -0.029,
            },
        ],
        "stats": {
            "avg_abs_move_pct": 0.045,
            "wins": 1,
            "losses": 1,
            "surprise_beat_rate": 0.5,
        },
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_caches():
    """Wipe the analysis cache + rate limit history between every test so
    the same symbol can be exercised across cases without false hits."""
    from api.routes import earnings as earnings_routes
    from api.routes import _rate_limit
    earnings_routes._reset_analysis_cache_for_tests()
    _rate_limit._reset_for_tests()
    yield
    earnings_routes._reset_analysis_cache_for_tests()
    _rate_limit._reset_for_tests()


@pytest.fixture
def amd_mocks(authed_client):
    """Patch every upstream the analysis route calls."""
    chain = _make_amd_chain()
    quote = _amd_quote()
    iv = _amd_iv()
    meta = _amd_meta_hydrated()
    news = _amd_news()
    history = _amd_history()

    patches = [
        patch("services.market.fetch_quote", AsyncMock(return_value=quote)),
        patch("services.options.fetch_iv_analysis", AsyncMock(return_value=iv)),
        patch("services.options.fetch_chain", AsyncMock(return_value=chain)),
        patch(
            "services.earnings_screener._load_earnings_meta",
            AsyncMock(return_value=meta),
        ),
        patch(
            "services.earnings_screener._hydrate_row",
            AsyncMock(return_value=meta),
        ),
        patch(
            "services.earnings_screener._load_historical_earnings",
            AsyncMock(return_value=history),
        ),
        patch(
            "services.news.fetch_symbol_news",
            AsyncMock(return_value=SimpleNamespace(
                articles=news, query="AMD", count=len(news), is_demo=False,
            )),
        ),
    ]
    started = [p.start() for p in patches]
    yield {
        "client": authed_client,
        "chain": chain, "quote": quote, "iv": iv,
        "meta": meta, "news": news, "history": history,
        "patches": started,
    }
    for p in patches:
        p.stop()


# ---------------------------------------------------------------------------
# AMD case — iron_condor first
# ---------------------------------------------------------------------------


def test_amd_analysis_returns_iron_condor_first(amd_mocks):
    client = amd_mocks["client"]
    r = client.get("/api/v1/earnings/AMD/analysis")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["symbol"] == "AMD"
    assert body["current_iv"] == pytest.approx(1.19, rel=1e-6)
    assert body["hv_20"] == pytest.approx(0.65, rel=1e-6)
    # IV/HV ratio derived in the assembler.
    assert body["iv_to_hv_ratio"] == pytest.approx(1.19 / 0.65, rel=1e-6)
    # Top setup must be the recommender's iron_condor.
    assert body["top_setups"], "expected at least one setup"
    assert body["top_setups"][0]["setup_id"] == "iron_condor"
    # Spot bar fields populated.
    assert body["spot"] == pytest.approx(356.0)
    assert body["day_volume"] == 28_400_000
    # News forwarded.
    assert body["news"] is not None
    assert len(body["news"]) == 2
    assert body["news"][0]["title"].startswith("AMD")
    # Chain expirations carried.
    assert body["chain_expirations"], "expected expirations in response"
    assert body["front_month_chain_summary"] is not None
    # Edge score + components surfaced.
    assert body["edge_score"] == pytest.approx(78.5)
    assert body["edge_score_components"]["iv_rank"] == pytest.approx(29.75)
    # Implied vs historical ratio derived.
    assert body["implied_vs_historical_ratio"] == pytest.approx(0.066 / 0.045, rel=1e-6)
    # No catastrophic upstream errors.
    assert "quote_unavailable" not in body["error_codes"]
    assert "iv_unavailable" not in body["error_codes"]


# ---------------------------------------------------------------------------
# Partial failure tolerance — news upstream throws
# ---------------------------------------------------------------------------


def test_partial_failure_news_throws_other_fields_populated(authed_client):
    chain = _make_amd_chain()
    quote = _amd_quote()
    iv = _amd_iv()
    meta = _amd_meta_hydrated()

    patches = [
        patch("services.market.fetch_quote", AsyncMock(return_value=quote)),
        patch("services.options.fetch_iv_analysis", AsyncMock(return_value=iv)),
        patch("services.options.fetch_chain", AsyncMock(return_value=chain)),
        patch(
            "services.earnings_screener._load_earnings_meta",
            AsyncMock(return_value=meta),
        ),
        patch(
            "services.earnings_screener._hydrate_row",
            AsyncMock(return_value=meta),
        ),
        patch(
            "services.earnings_screener._load_historical_earnings",
            AsyncMock(return_value=_amd_history()),
        ),
        patch(
            "services.news.fetch_symbol_news",
            AsyncMock(side_effect=RuntimeError("newsdata 503")),
        ),
    ]
    for p in patches:
        p.start()
    try:
        r = authed_client.get("/api/v1/earnings/AMD/analysis")
    finally:
        for p in patches:
            p.stop()
    assert r.status_code == 200, r.text
    body = r.json()
    # News flaked but no 500.
    assert body["news"] is None or body["news"] == []
    # Other blocks still populated.
    assert body["spot"] == pytest.approx(356.0)
    assert body["current_iv"] == pytest.approx(1.19)
    assert body["top_setups"], "setups still rendered when news flakes"


# ---------------------------------------------------------------------------
# Query-param caps
# ---------------------------------------------------------------------------


def test_setups_query_param_caps_at_1(amd_mocks):
    client = amd_mocks["client"]
    r = client.get("/api/v1/earnings/AMD/analysis?setups=1")
    assert r.status_code == 200, r.text
    body = r.json()
    # We mocked one setup; setups=1 should still cap to that single value.
    assert body["top_setups"] is not None
    assert len(body["top_setups"]) == 1


def test_setups_query_param_returns_up_to_5(amd_mocks):
    """Even though the mock returns 1 setup, setups=5 is accepted (no 422)."""
    client = amd_mocks["client"]
    r = client.get("/api/v1/earnings/AMD/analysis?setups=5")
    assert r.status_code == 200, r.text


def test_setups_query_param_rejects_zero(authed_client):
    r = authed_client.get("/api/v1/earnings/AMD/analysis?setups=0")
    assert r.status_code == 422  # ge=1


def test_setups_query_param_rejects_six(authed_client):
    r = authed_client.get("/api/v1/earnings/AMD/analysis?setups=6")
    assert r.status_code == 422  # le=5


# ---------------------------------------------------------------------------
# Caching — second call within 60s doesn't re-touch upstreams
# ---------------------------------------------------------------------------


def test_analysis_cached_within_60s(authed_client):
    chain = _make_amd_chain()
    quote = _amd_quote()
    iv = _amd_iv()
    meta = _amd_meta_hydrated()

    quote_mock = AsyncMock(return_value=quote)
    iv_mock = AsyncMock(return_value=iv)
    chain_mock = AsyncMock(return_value=chain)
    meta_mock = AsyncMock(return_value=meta)
    hydrate_mock = AsyncMock(return_value=meta)
    history_mock = AsyncMock(return_value=_amd_history())
    news_mock = AsyncMock(return_value=SimpleNamespace(
        articles=_amd_news(), query="AMD", count=2, is_demo=False,
    ))

    patches = [
        patch("services.market.fetch_quote", quote_mock),
        patch("services.options.fetch_iv_analysis", iv_mock),
        patch("services.options.fetch_chain", chain_mock),
        patch("services.earnings_screener._load_earnings_meta", meta_mock),
        patch("services.earnings_screener._hydrate_row", hydrate_mock),
        patch("services.earnings_screener._load_historical_earnings", history_mock),
        patch("services.news.fetch_symbol_news", news_mock),
    ]
    for p in patches:
        p.start()
    try:
        r1 = authed_client.get("/api/v1/earnings/AMD/analysis")
        r2 = authed_client.get("/api/v1/earnings/AMD/analysis")
    finally:
        for p in patches:
            p.stop()

    assert r1.status_code == 200
    assert r2.status_code == 200
    # Second call must NOT re-invoke upstreams — count stays at 1.
    assert quote_mock.call_count == 1, f"quote called {quote_mock.call_count}x"
    assert iv_mock.call_count == 1
    assert chain_mock.call_count == 1
    assert news_mock.call_count == 1
    # Second response identical to the first (cached body).
    assert r1.json()["fetched_at"] == r2.json()["fetched_at"]


def test_analysis_cache_keyed_per_setups_arg(authed_client):
    """setups=1 vs setups=3 must NOT share a cache slot."""
    chain = _make_amd_chain()
    quote = _amd_quote()
    iv = _amd_iv()
    meta = _amd_meta_hydrated()

    quote_mock = AsyncMock(return_value=quote)
    patches = [
        patch("services.market.fetch_quote", quote_mock),
        patch("services.options.fetch_iv_analysis", AsyncMock(return_value=iv)),
        patch("services.options.fetch_chain", AsyncMock(return_value=chain)),
        patch("services.earnings_screener._load_earnings_meta", AsyncMock(return_value=meta)),
        patch("services.earnings_screener._hydrate_row", AsyncMock(return_value=meta)),
        patch("services.earnings_screener._load_historical_earnings", AsyncMock(return_value=_amd_history())),
        patch(
            "services.news.fetch_symbol_news",
            AsyncMock(return_value=SimpleNamespace(
                articles=_amd_news(), query="AMD", count=2, is_demo=False,
            )),
        ),
    ]
    for p in patches:
        p.start()
    try:
        r1 = authed_client.get("/api/v1/earnings/AMD/analysis?setups=1")
        r2 = authed_client.get("/api/v1/earnings/AMD/analysis?setups=3")
    finally:
        for p in patches:
            p.stop()
    assert r1.status_code == 200
    assert r2.status_code == 200
    # Different cache key → quote refetched.
    assert quote_mock.call_count == 2


# ---------------------------------------------------------------------------
# Curated-universe gate
# ---------------------------------------------------------------------------


def test_non_curated_symbol_404s(authed_client):
    """``ZZZZ`` is not in the curated universe; route must 404 BEFORE
    touching any upstream service."""
    r = authed_client.get("/api/v1/earnings/ZZZZ/analysis")
    assert r.status_code == 404
    assert "curated earnings universe" in r.json()["detail"]


def test_invalid_symbol_pattern_422(authed_client):
    """Lowercase symbols never match the path pattern."""
    r = authed_client.get("/api/v1/earnings/amd/analysis")
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Non-optionable / no-chain symbol — analysis still rendered, top_setups None
# ---------------------------------------------------------------------------


def test_non_optionable_symbol_returns_analysis_without_setups(authed_client):
    """A symbol whose chain is unavailable still returns 200 with the
    other blocks populated. ``top_setups`` is None because the meta
    row has no recommender output."""
    quote = _amd_quote()
    iv = _amd_iv()
    # Empty meta — calendar row absent.
    no_chain = _FakeChain(
        underlying="AMD", spot_price=0.0, expirations=[], contracts=[],
    )
    patches = [
        patch("services.market.fetch_quote", AsyncMock(return_value=quote)),
        patch("services.options.fetch_iv_analysis", AsyncMock(return_value=iv)),
        patch("services.options.fetch_chain", AsyncMock(return_value=no_chain)),
        patch("services.earnings_screener._load_earnings_meta", AsyncMock(return_value=None)),
        patch("services.earnings_screener._hydrate_row", AsyncMock(return_value=None)),
        patch("services.earnings_screener._load_historical_earnings", AsyncMock(return_value=None)),
        patch(
            "services.news.fetch_symbol_news",
            AsyncMock(return_value=SimpleNamespace(
                articles=[], query="AMD", count=0, is_demo=False,
            )),
        ),
    ]
    for p in patches:
        p.start()
    try:
        r = authed_client.get("/api/v1/earnings/AMD/analysis")
    finally:
        for p in patches:
            p.stop()

    assert r.status_code == 200
    body = r.json()
    assert body["chain_expirations"] is None
    assert "no_chain" in body["error_codes"]
    assert "no_calendar_entry" in body["error_codes"]
    assert body["top_setups"] is None
    # Quote + IV still populated.
    assert body["spot"] == pytest.approx(356.0)
    assert body["current_iv"] == pytest.approx(1.19)


# ---------------------------------------------------------------------------
# All upstreams flake — endpoint still returns 200 with error_codes
# ---------------------------------------------------------------------------


def test_all_upstreams_flake_returns_partial_200(authed_client):
    patches = [
        patch("services.market.fetch_quote", AsyncMock(side_effect=RuntimeError("alpaca down"))),
        patch("services.options.fetch_iv_analysis", AsyncMock(side_effect=RuntimeError("opra down"))),
        patch("services.options.fetch_chain", AsyncMock(side_effect=RuntimeError("opra down"))),
        patch("services.earnings_screener._load_earnings_meta", AsyncMock(side_effect=RuntimeError("fmp down"))),
        patch("services.earnings_screener._load_historical_earnings", AsyncMock(side_effect=RuntimeError("fmp down"))),
        patch("services.news.fetch_symbol_news", AsyncMock(side_effect=RuntimeError("newsdata down"))),
    ]
    for p in patches:
        p.start()
    try:
        r = authed_client.get("/api/v1/earnings/AMD/analysis")
    finally:
        for p in patches:
            p.stop()

    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "AMD"
    assert "quote_unavailable" in body["error_codes"]
    assert "iv_unavailable" in body["error_codes"]
    # Spot left None / null.
    assert body["spot"] is None
    assert body["current_iv"] is None
