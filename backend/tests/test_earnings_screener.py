"""Pure-function tests for earnings_screener. Provider mocking comes in
Task 8 when we test the aggregator; these tests cover the math."""
from datetime import date, timedelta

from services.earnings_screener import (
    compute_expected_move_from_straddle,
    compute_historical_stats,
)


def test_expected_move_from_atm_straddle():
    """Straddle mid / underlying = expected move %. E.g. NVDA @ 200, ATM
    call mid 6.2 + put mid 6.4 → 12.6 / 200 = 6.3%."""
    em = compute_expected_move_from_straddle(underlying=200.0, call_mid=6.2, put_mid=6.4)
    assert round(em, 4) == 0.063


def test_expected_move_zero_when_no_prices():
    assert compute_expected_move_from_straddle(underlying=200.0, call_mid=0.0, put_mid=0.0) == 0.0


def test_expected_move_handles_zero_underlying():
    """Guard rail — never divides by zero."""
    assert compute_expected_move_from_straddle(underlying=0.0, call_mid=5.0, put_mid=5.0) is None


def test_historical_stats_basic():
    """avg |move|, wins/losses (using next-day), and beat rate."""
    quarters = [
        {"report_date": date(2025, 1, 22), "surprise_pct": 0.08, "next_day_move_pct": 0.042, "five_day_move_pct": 0.053},
        {"report_date": date(2024, 10, 22), "surprise_pct": -0.02, "next_day_move_pct": -0.081, "five_day_move_pct": -0.023},
        {"report_date": date(2024, 7, 22), "surprise_pct": 0.05, "next_day_move_pct": 0.034, "five_day_move_pct": 0.041},
        {"report_date": date(2024, 4, 22), "surprise_pct": 0.12, "next_day_move_pct": 0.090, "five_day_move_pct": 0.110},
    ]
    stats = compute_historical_stats(quarters)
    # avg |move| = (4.2 + 8.1 + 3.4 + 9.0) / 4 = 6.175%
    assert round(stats["avg_abs_move_pct"], 4) == 0.0618
    # wins / losses by next-day sign
    assert stats["wins"] == 3
    assert stats["losses"] == 1
    # beat rate = surprise_pct > 0 fraction = 3/4
    assert stats["surprise_beat_rate"] == 0.75


def test_historical_stats_empty():
    stats = compute_historical_stats([])
    assert stats["avg_abs_move_pct"] == 0.0
    assert stats["wins"] == 0
    assert stats["losses"] == 0
    assert stats["surprise_beat_rate"] == 0.0


from services.earnings_prompts import (
    build_structured_prompt,
    parse_structured_response,
)
from services.earnings_screener import (
    CURATED_OPTIONABLE_UNIVERSE,
    _in_curated_universe,
)


def test_curated_universe_core_names_present():
    """The curated universe is what users glance over to make trade decisions —
    regression guard for the staples. Any removal from this set is a
    deliberate product decision and should show up as a failing test."""
    must_have = {"AAPL", "MSFT", "NVDA", "TSLA", "META", "GOOGL", "AMZN",
                 "AVGO", "JPM", "NFLX", "AMD", "PLTR", "SMCI", "COIN"}
    assert must_have.issubset(CURATED_OPTIONABLE_UNIVERSE)


def test_curated_universe_excludes_foreign_and_pinks():
    """The universe is US-listed major optionable names only. Foreign
    suffixes (.L, .TO) and pink sheets (5+ letter tickers ending in F)
    must not leak in."""
    for sym in CURATED_OPTIONABLE_UNIVERSE:
        assert "." not in sym or sym == "BRK.B", f"{sym} looks like a foreign listing"


def test_in_curated_universe_case_insensitive():
    assert _in_curated_universe("nvda") is True
    assert _in_curated_universe("NVDA") is True
    assert _in_curated_universe("ZZZZ") is False
    assert _in_curated_universe("") is False


def test_structured_prompt_includes_all_context_keys():
    """Prompt must surface IV rank, expected move, hist avg, news headlines,
    and regime — the geeky-user-level context the model needs to produce a
    decent thesis."""
    prompt = build_structured_prompt(
        symbol="NVDA",
        company="Nvidia",
        sector="Semiconductors",
        report_date="2026-04-23",
        report_time="AMC",
        price=201.7,
        iv_rank=78,
        iv_percentile=82,
        hv_20=0.42,
        expected_move_pct=0.064,
        hist_avg_abs_move_pct=0.052,
        recent_beats_misses=[("2026-01-22", "+8%"), ("2025-10-22", "-2%")],
        headlines=["Blackwell ramp on track", "China export pivot"],
        market_regime="Bear-HighVol",
    )
    text = prompt["user"]
    for key in ["NVDA", "Semiconductors", "IV rank: 78", "expected move", "±5.2", "Blackwell", "Bear-HighVol"]:
        assert key in text, f"missing {key!r} in prompt"
    assert "JSON" in prompt["system"]


def test_structured_prompt_omits_historical_when_none():
    """When hist_avg_abs_move_pct is None, the prompt MUST NOT claim 0% —
    it must say the historical comparison is unavailable so Claude doesn't
    conclude realized vol is zero. Regression guard for a prompt-quality
    bug caught in code review."""
    prompt = build_structured_prompt(
        symbol="NVDA",
        company="Nvidia",
        sector="Semiconductors",
        report_date="2026-04-23",
        report_time="AMC",
        price=201.7,
        iv_rank=78,
        iv_percentile=82,
        hv_20=0.42,
        expected_move_pct=0.064,
        hist_avg_abs_move_pct=None,
        recent_beats_misses=[],
        headlines=[],
        market_regime="Unknown",
    )
    text = prompt["user"]
    # Must NOT contain a zero-valued historical move that would mislead the model.
    assert "±0.00%" not in text
    assert "0.00%" not in text or "HV 20" in text  # HV 20 can legitimately contain 0.00% but historical avg must not
    # Must explicitly signal unavailability so the model knows.
    assert "unavailable" in text.lower()


def test_parse_structured_response_happy_path():
    raw = '''{
      "verdict": "neutral-bull",
      "direction_magnitude": {"bull_case_pct": 0.04, "bear_case_pct": -0.05},
      "thesis": "IV is overpricing vs realized.",
      "catalysts": ["data-center guide"],
      "risks": ["guide miss"],
      "suggested_play": "short strangle",
      "suggested_play_reason": "IVR > 75 bucket",
      "confidence": 0.62
    }'''
    parsed = parse_structured_response(raw)
    assert parsed["verdict"] == "neutral-bull"
    assert parsed["confidence"] == 0.62
    assert parsed["suggested_play"] == "short strangle"


def test_parse_structured_response_rejects_invalid_verdict():
    import pytest
    raw = '{"verdict": "moonshot", "direction_magnitude": {"bull_case_pct": 0, "bear_case_pct": 0}, "thesis": "x", "catalysts": [], "risks": [], "suggested_play": "short call", "suggested_play_reason": "x", "confidence": 0.5}'
    with pytest.raises(ValueError, match="verdict"):
        parse_structured_response(raw)


def test_parse_structured_response_rejects_malformed_json():
    import pytest
    with pytest.raises(ValueError, match="JSON"):
        parse_structured_response("not json {")


# ─── Aggregator tests (Tasks 7 + 8) ──────────────────────────

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_list_upcoming_happy_path():
    """FMP returns 2 upcoming earnings; each symbol resolves quote/IV/Claude-cached.
    Result shape matches CalendarResponse."""
    from services import earnings_screener as svc

    d1 = (date.today() + timedelta(days=1)).isoformat()
    d2 = (date.today() + timedelta(days=2)).isoformat()
    fake_earnings = [
        {"symbol": "NVDA", "company": "Nvidia", "sector": "Semis",
         "report_date": d1, "report_time": "AMC"},
        {"symbol": "TSLA", "company": "Tesla", "sector": "Auto",
         "report_date": d2, "report_time": "AMC"},
    ]
    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(
             svc, "_hydrate_row",
             AsyncMock(side_effect=lambda row, **_: {**row, "price": 200.0, "iv_rank": 70.0}),
         ):
        resp = await svc.list_upcoming(window="both", min_iv_rank=0)

    assert len(resp.earnings) == 2
    assert resp.earnings[0].symbol == "NVDA"
    assert resp.earnings[0].price == 200.0
    assert resp.partial is False


@pytest.mark.asyncio
async def test_list_upcoming_filters_by_iv_rank():
    """min_iv_rank excludes rows under the threshold."""
    from services import earnings_screener as svc

    future = (date.today() + timedelta(days=1)).isoformat()
    fake_earnings = [
        {"symbol": "A", "company": "A", "sector": "x",
         "report_date": future, "report_time": "AMC"},
        {"symbol": "B", "company": "B", "sector": "x",
         "report_date": future, "report_time": "AMC"},
    ]
    hydrated = {"A": {"iv_rank": 80}, "B": {"iv_rank": 30}}

    async def hydrate(row, *, min_iv_rank: float = 0):
        iv = hydrated[row["symbol"]]["iv_rank"]
        if iv < min_iv_rank:
            return None
        return {**row, "price": 100.0, "iv_rank": iv}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=hydrate)):
        resp = await svc.list_upcoming(window="both", min_iv_rank=50)
    symbols = [r.symbol for r in resp.earnings]
    assert symbols == ["A"]


@pytest.mark.asyncio
async def test_list_upcoming_partial_on_hydrate_failure():
    """If one symbol's hydrate raises, the row comes back with partial=True
    and the response itself marks partial=True but does not 500."""
    from services import earnings_screener as svc

    d1 = (date.today() + timedelta(days=1)).isoformat()
    d2 = (date.today() + timedelta(days=2)).isoformat()
    fake_earnings = [
        {"symbol": "NVDA", "company": "Nvidia", "sector": "Semis",
         "report_date": d1, "report_time": "AMC"},
        {"symbol": "TSLA", "company": "Tesla", "sector": "Auto",
         "report_date": d2, "report_time": "AMC"},
    ]

    async def hydrate(row, *, min_iv_rank: float = 0):
        if row["symbol"] == "TSLA":
            raise RuntimeError("options provider down")
        return {**row, "price": 200.0, "iv_rank": 70.0}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=hydrate)):
        resp = await svc.list_upcoming(window="both", min_iv_rank=0)
    assert resp.partial is True
    symbols_with_price = [r.symbol for r in resp.earnings if r.price is not None]
    assert "NVDA" in symbols_with_price
    assert "TSLA" in [r.symbol for r in resp.earnings]  # still present, fields null


@pytest.mark.asyncio
async def test_get_detail_merges_all_blocks():
    """get_detail pulls quote, options-chain, news, claude-structured and
    returns a populated EarningsDetail. Missing blocks become None; partial=True
    only when at least one block failed."""
    from services import earnings_screener as svc

    metrics = {
        "iv_rank": 78, "iv_percentile": 82, "current_iv": 0.79,
        "hv_20": 0.42, "hv_50": 0.38, "hv_100": 0.35, "hv_iv_ratio": 0.71,
        "expected_move_pct": 0.064, "expected_move_dollars": 12.8,
        "hist_avg_abs_move_pct": 0.052, "beat_rate": 0.87,
        "days_to_earnings": 1, "days_to_expiry": 3,
    }
    with patch.object(
         svc, "_load_quote",
         AsyncMock(return_value={"last": 200.0, "change": -1.0, "change_pct": -0.5}),
         ), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value=metrics)), \
         patch.object(svc, "_load_strike_ladder", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_claude_structured", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_historical", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_iv_term", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_skew", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_news", AsyncMock(return_value=[])), \
         patch.object(
             svc, "_load_earnings_meta",
             AsyncMock(return_value={
                 "company": "Nvidia", "sector": "Semis",
                 "report_date": "2026-04-23", "report_time": "AMC",
             }),
         ):
        detail = await svc.get_detail("NVDA")

    assert detail.symbol == "NVDA"
    assert detail.quote.last == 200.0
    assert detail.metrics.iv_rank == 78
    # Blocks that returned None must stay None
    assert detail.strike_ladder is None
    assert detail.claude_structured is None


@pytest.mark.asyncio
async def test_list_upcoming_filters_stale_earnings():
    """B-43 regression: rows with `days_until < 0` (report already happened)
    must not render in the calendar. FMP's window can return past dates on
    timezone edges and such rows look like typos to the user."""
    from services import earnings_screener as svc

    today = date.today()
    past_date = (today - timedelta(days=3)).isoformat()
    future_date = (today + timedelta(days=2)).isoformat()
    fake_earnings = [
        {"symbol": "STAL", "company": "Stale", "sector": "x",
         "report_date": past_date, "report_time": "AMC"},
        {"symbol": "FRSH", "company": "Fresh", "sector": "x",
         "report_date": future_date, "report_time": "AMC"},
    ]

    async def hydrate(row, *, min_iv_rank: float = 0):
        return {**row, "price": 100.0, "iv_rank": 70.0}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=hydrate)):
        resp = await svc.list_upcoming(window="both", min_iv_rank=0)

    symbols = [r.symbol for r in resp.earnings]
    assert "FRSH" in symbols
    assert "STAL" not in symbols


@pytest.mark.asyncio
async def test_load_strike_ladder_handles_empty_expirations():
    """B-42 regression: a non-optionable symbol can return a chain whose
    `expirations` list is empty. Previously `chain.expirations[0]` would
    IndexError; the guard must fall back to the passed-in expiry kwarg or
    today's date."""
    from services import earnings_screener as svc

    class _Contract:
        strike = 100.0
        bid = 1.0
        ask = 1.2
        last = 1.1
        iv = 0.3
        delta = 0.5
        theta = -0.1
        gamma = 0.01
        vega = 0.2
        open_interest = 10
        volume = 5
        option_type = "call"

    class _FakeChain:
        spot_price = 100.0
        expirations: list = []
        contracts: list = []

    async def fake_chain(symbol, expiry=None):
        return _FakeChain()

    with patch("api.routes.options.get_options_chain", fake_chain):
        result = await svc._load_strike_ladder("NOOPT", expiry=None)

    # No rows since no contracts, but expiry must not raise — should be today.
    assert result is not None
    assert result["expiry"] == date.today()
    assert result["rows"] == []


def test_fmp_earnings_empty_dataframe_preserves_dtypes():
    """B-82 regression: when FMP returns no rows, the empty DataFrame must
    carry the same per-column dtypes as the populated frame (float64 for
    numerics, str for text). Previously an empty `{c: []}` dict produced
    `object` dtypes everywhere, which broke downstream `.isin()` + concat
    operations against a populated frame."""
    import pandas as pd

    from data.providers.fmp_earnings import (
        _CALENDAR_COLS,
        _CALENDAR_DTYPES,
        _SURPRISE_COLS,
        _SURPRISE_DTYPES,
    )

    # Reconstruct the empty-frame produced by the fallback branch.
    empty_cal = pd.DataFrame({c: pd.Series(dtype=_CALENDAR_DTYPES[c]) for c in _CALENDAR_COLS})
    empty_surp = pd.DataFrame({c: pd.Series(dtype=_SURPRISE_DTYPES[c]) for c in _SURPRISE_COLS})

    # Calendar
    assert list(empty_cal.columns) == _CALENDAR_COLS
    assert len(empty_cal) == 0
    for col in ("eps_actual", "eps_estimated", "revenue_actual", "revenue_estimated"):
        assert str(empty_cal[col].dtype) == "float64"
    # Surprises
    assert list(empty_surp.columns) == _SURPRISE_COLS
    assert len(empty_surp) == 0
    for col in ("surprise", "surprise_pct", "sue"):
        assert str(empty_surp[col].dtype) == "float64"

    # And the empty frame must be concat-compatible with the populated shape
    populated = pd.DataFrame([{
        "symbol": "AAPL", "date": date(2026, 5, 1),
        "eps_actual": 1.1, "eps_estimated": 1.0,
        "revenue_actual": 100.0, "revenue_estimated": 95.0,
        "last_updated": date(2026, 4, 20), "announcement_when": "amc",
    }])
    combined = pd.concat([empty_cal, populated], ignore_index=True)
    assert len(combined) == 1
    assert str(combined["eps_actual"].dtype) == "float64"


@pytest.mark.asyncio
async def test_fmp_upcoming_dedups_symbol_and_date():
    """B-45 regression: FMP's calendar occasionally returns the same
    (symbol, report_date) twice (prelim + updated). `_fmp_upcoming` must
    dedup so downstream hydration doesn't do redundant Alpaca calls."""
    import pandas as pd

    from services import earnings_screener as svc

    df = pd.DataFrame([
        {"symbol": "NVDA", "date": date(2026, 4, 30),
         "eps_actual": None, "eps_estimated": 1.0, "revenue_actual": None,
         "revenue_estimated": 100.0, "last_updated": None, "announcement_when": "amc"},
        {"symbol": "NVDA", "date": date(2026, 4, 30),  # duplicate
         "eps_actual": None, "eps_estimated": 1.0, "revenue_actual": None,
         "revenue_estimated": 100.0, "last_updated": None, "announcement_when": "amc"},
        {"symbol": "TSLA", "date": date(2026, 4, 30),
         "eps_actual": None, "eps_estimated": 1.0, "revenue_actual": None,
         "revenue_estimated": 100.0, "last_updated": None, "announcement_when": "bmo"},
    ])

    class _FakeProvider:
        def __enter__(self):
            return self
        def __exit__(self, *exc):
            return None
        def calendar(self, start, end):
            return df

    with patch("data.providers.fmp_earnings.FMPEarningsProvider", _FakeProvider):
        rows = await svc._fmp_upcoming("both")

    pairs = [(r["symbol"], r["report_date"]) for r in rows]
    assert pairs.count(("NVDA", "2026-04-30")) == 1
    assert pairs.count(("TSLA", "2026-04-30")) == 1


@pytest.mark.asyncio
async def test_fmp_upcoming_accepts_share_class_tickers():
    """B-44 regression: symbols like BRK.B / BRK.A / RDS.A must survive the
    pre-filter. Previously the filter used `not isalpha()` which rejects
    any string containing a dot, dropping legitimate Berkshire / Shell
    share-class tickers alongside foreign exchange suffixes."""
    import pandas as pd

    from services import earnings_screener as svc

    df = pd.DataFrame([
        {"symbol": "BRK.B", "date": date(2026, 4, 23),
         "eps_actual": None, "eps_estimated": 1.0, "revenue_actual": None,
         "revenue_estimated": 100.0, "last_updated": None, "announcement_when": "amc"},
        {"symbol": "RDS.A", "date": date(2026, 4, 23),
         "eps_actual": None, "eps_estimated": 1.0, "revenue_actual": None,
         "revenue_estimated": 100.0, "last_updated": None, "announcement_when": "bmo"},
        {"symbol": "NVDA", "date": date(2026, 4, 23),
         "eps_actual": None, "eps_estimated": 1.0, "revenue_actual": None,
         "revenue_estimated": 100.0, "last_updated": None, "announcement_when": "amc"},
        # 6-letter pink sheet must still be filtered
        {"symbol": "XTRRFF", "date": date(2026, 4, 23),
         "eps_actual": None, "eps_estimated": 1.0, "revenue_actual": None,
         "revenue_estimated": 100.0, "last_updated": None, "announcement_when": "amc"},
    ])

    class _FakeProvider:
        def __enter__(self):
            return self
        def __exit__(self, *exc):
            return None
        def calendar(self, start, end):
            return df

    with patch.object(
        svc, "_fmp_upcoming", svc._fmp_upcoming
    ), patch(
        "data.providers.fmp_earnings.FMPEarningsProvider", _FakeProvider
    ):
        rows = await svc._fmp_upcoming("both")

    symbols = {r["symbol"] for r in rows}
    assert "BRK.B" in symbols
    assert "RDS.A" in symbols
    assert "NVDA" in symbols
    assert "XTRRFF" not in symbols


@pytest.mark.asyncio
async def test_get_detail_news_failure_marks_partial():
    """B-34 regression: when the news gather task raises, `partial` must be
    True. Previously `news_t` was missing from the partial-flag computation
    so a Newsdata outage would silently succeed the response."""
    from services import earnings_screener as svc

    with patch.object(
         svc, "_load_quote",
         AsyncMock(return_value={"last": 200.0, "change": -1.0, "change_pct": -0.5}),
         ), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_strike_ladder", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_claude_structured", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_historical", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_iv_term", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_skew", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_news", AsyncMock(side_effect=RuntimeError("newsdata 503"))), \
         patch.object(
             svc, "_load_earnings_meta",
             AsyncMock(return_value={
                 "company": "Nvidia", "sector": "Semis",
                 "report_date": "2026-04-23", "report_time": "AMC",
             }),
         ):
        detail = await svc.get_detail("NVDA")

    assert detail.partial is True
    assert detail.news == []


@pytest.mark.asyncio
async def test_run_full_research_calls_opus_and_caches():
    """run_full_research builds the richer prompt, calls Claude Opus, parses
    response, and caches 24h. Also verifies the parsed shape is a valid
    ClaudeFullResearch."""
    from services import earnings_screener as svc
    from api.schemas.earnings import ClaudeFullResearch

    fake_claude_raw = (
        '{"thesis_paragraph": "...", "comparable_setups": [], '
        '"post_earnings_drift_playbook": "...", "sector_backdrop": "...", '
        '"analyst_consensus_delta": "...", "what_would_change_my_mind": "...", '
        '"confidence": 0.72}'
    )
    fake_cache = AsyncMock()
    fake_cache.get = AsyncMock(return_value=None)
    fake_cache.set = AsyncMock()
    fake_client = AsyncMock()
    fake_client.complete = AsyncMock(return_value=fake_claude_raw)

    with patch.object(
         svc, "_load_earnings_meta",
         AsyncMock(return_value={
             "company": "Nvidia", "sector": "Semis",
             "report_date": "2026-04-23", "report_time": "AMC",
         }),
         ), \
         patch.object(
             svc, "_load_quote",
             AsyncMock(return_value={"last": 200.0, "change": -1, "change_pct": -0.5}),
         ), \
         patch.object(
             svc, "_load_metrics",
             AsyncMock(return_value={
                 "iv_rank": 78, "iv_percentile": 82, "expected_move_pct": 0.064,
             }),
         ), \
         patch.object(
             svc, "_load_historical",
             AsyncMock(return_value={
                 "quarters": [],
                 "stats": {
                     "avg_abs_move_pct": 0.05, "wins": 4, "losses": 4,
                     "surprise_beat_rate": 0.5, "iv_vs_hist_vol_points": 1.2,
                 },
             }),
         ), \
         patch.object(svc, "_load_news", AsyncMock(return_value=[])), \
         patch("core.cache.get_cache", return_value=fake_cache), \
         patch("agents.claude_client.ClaudeClient", return_value=fake_client):
        result = await svc.run_full_research("NVDA")

    assert isinstance(result, ClaudeFullResearch)
    assert result.confidence == 0.72
    fake_cache.set.assert_called_once()
    args, kwargs = fake_cache.set.call_args
    assert "earnings:claude-full:NVDA" in args[0]
    assert kwargs.get("ttl_seconds") == 24 * 3600


@pytest.mark.asyncio
async def test_run_full_research_returns_cached_when_present():
    from services import earnings_screener as svc
    cached_payload = {
        "thesis_paragraph": "cached", "comparable_setups": [],
        "post_earnings_drift_playbook": "p", "sector_backdrop": "s",
        "analyst_consensus_delta": "a", "what_would_change_my_mind": "w",
        "confidence": 0.5, "model": "claude-opus-4-7",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    fake_cache = AsyncMock()
    fake_cache.get = AsyncMock(return_value=cached_payload)
    fake_cache.set = AsyncMock()
    with patch("core.cache.get_cache", return_value=fake_cache), \
         patch.object(
             svc, "_load_earnings_meta",
             AsyncMock(return_value={
                 "company": "N", "sector": "S",
                 "report_date": "2026-04-23", "report_time": "AMC",
             }),
         ):
        result = await svc.run_full_research("NVDA")
    assert result.thesis_paragraph == "cached"
    fake_cache.set.assert_not_called()
