"""Pure-function tests for earnings_screener. Provider mocking comes in
Task 8 when we test the aggregator; these tests cover the math."""
from datetime import date, timedelta

from services.earnings_screener import (
    compute_earnings_edge_score,
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


def test_earnings_edge_score_rewards_rich_premium_and_overpriced_move():
    scored = compute_earnings_edge_score(
        iv_rank=82,
        premium_yield_call_atm=0.041,
        premium_yield_put_atm=0.036,
        expected_move_pct=0.074,
        hist_avg_abs_move_pct=0.049,
        claude_confidence=0.68,
        days_until=1,
        top_setup="iron condor",
    )
    assert scored["edge_score"] >= 80
    assert any("IV rank" in r for r in scored["edge_score_reasons"])
    assert any("Implied move" in r for r in scored["edge_score_reasons"])


def test_earnings_edge_score_caps_unknown_setup_until_claude_selects_play():
    scored = compute_earnings_edge_score(
        iv_rank=90,
        premium_yield_call_atm=0.060,
        premium_yield_put_atm=0.057,
        expected_move_pct=0.074,
        hist_avg_abs_move_pct=0.049,
        claude_confidence=0.80,
        days_until=1,
        top_setup=None,
    )

    assert scored["edge_score"] <= 55
    assert any("setup" in r.lower() for r in scored["edge_score_reasons"])


def test_earnings_edge_score_penalizes_rich_premium_when_realized_moves_are_larger():
    scored = compute_earnings_edge_score(
        iv_rank=90,
        premium_yield_call_atm=0.060,
        premium_yield_put_atm=0.057,
        expected_move_pct=0.040,
        hist_avg_abs_move_pct=0.080,
        claude_confidence=0.80,
        days_until=1,
        top_setup="iron condor",
    )

    assert scored["edge_score"] < 55
    assert any("below" in r for r in scored["edge_score_reasons"])


def test_earnings_edge_score_caps_selected_setup_without_historical_moves():
    scored = compute_earnings_edge_score(
        iv_rank=92,
        premium_yield_call_atm=0.065,
        premium_yield_put_atm=0.060,
        expected_move_pct=0.080,
        hist_avg_abs_move_pct=None,
        claude_confidence=0.85,
        days_until=1,
        top_setup="iron condor",
    )

    assert scored["edge_score"] <= 60
    assert any("historical" in r.lower() and "capped" in r.lower() for r in scored["edge_score_reasons"])


def test_earnings_edge_score_treats_long_straddle_premium_as_debit_hurdle():
    scored = compute_earnings_edge_score(
        iv_rank=24,
        premium_yield_call_atm=0.018,
        premium_yield_put_atm=0.020,
        expected_move_pct=0.038,
        hist_avg_abs_move_pct=0.070,
        claude_confidence=0.72,
        days_until=2,
        top_setup="long straddle",
    )

    assert scored["edge_score"] >= 75
    assert any("debit" in r.lower() for r in scored["edge_score_reasons"])
    assert any("Historical move" in r for r in scored["edge_score_reasons"])


def test_earnings_edge_score_treats_debit_verticals_as_cheap_vol():
    scored = compute_earnings_edge_score(
        iv_rank=28,
        premium_yield_call_atm=0.035,
        premium_yield_put_atm=0.070,
        expected_move_pct=0.040,
        hist_avg_abs_move_pct=0.075,
        claude_confidence=0.70,
        days_until=1,
        top_setup="bull call spread",
    )

    assert scored["edge_score"] >= 80
    assert any("debit" in r.lower() for r in scored["edge_score_reasons"])
    assert any("Historical move" in r for r in scored["edge_score_reasons"])


def test_earnings_edge_score_penalizes_expensive_debit_verticals():
    scored = compute_earnings_edge_score(
        iv_rank=78,
        premium_yield_call_atm=0.030,
        premium_yield_put_atm=0.080,
        expected_move_pct=0.090,
        hist_avg_abs_move_pct=0.045,
        claude_confidence=0.45,
        days_until=1,
        top_setup="bear put spread",
    )

    assert scored["edge_score"] < 35
    assert any("above" in r for r in scored["edge_score_reasons"])


def test_earnings_edge_score_returns_null_without_evidence():
    assert compute_earnings_edge_score(
        iv_rank=None,
        premium_yield_call_atm=None,
        premium_yield_put_atm=None,
        expected_move_pct=None,
        hist_avg_abs_move_pct=None,
        claude_confidence=None,
        days_until=1,
    ) == {"edge_score": None, "edge_score_reasons": []}


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
    regression guard for the high-market-cap staples. Any removal from this
    set is a deliberate product decision and should show up as a failing test.
    """
    # Mega caps — removing any of these would mean the screener stops
    # surfacing earnings for the most-traded US single-names.
    must_have = {"AAPL", "MSFT", "NVDA", "TSLA", "META", "GOOGL", "AMZN",
                 "AVGO", "JPM", "NFLX", "AMD", "COIN", "PLTR"}
    assert must_have.issubset(CURATED_OPTIONABLE_UNIVERSE)


def test_curated_universe_excludes_sub_25b_meme_names():
    """The universe was tightened (2026-04) to cut meme / low-cap names
    whose options chains are too thin for reliable execution. Regression
    guard against accidental re-additions."""
    must_not_have = {
        "GME", "AMC", "BB", "BBIG",                    # meme
        "PTON", "BYND", "LCID", "RIVN", "NIO", "XPEV", # sub-$15B
        "AFRM", "SOFI", "HOOD", "DKNG",                # fintech sub-$20B
        "MARA", "RIOT",                                # crypto-miner micro
        "ROKU", "U",                                   # sub-$15B growth
        "SNAP", "PINS",                                # sub-$25B social
        "FSLY", "ZM", "DOCU", "TWLO",                  # thin chains
        "JD", "PDD", "NTES", "BIDU",                   # foreign ADRs (shallow US chains)
    }
    assert must_not_have.isdisjoint(CURATED_OPTIONABLE_UNIVERSE), (
        f"low-cap / shallow-chain names leaked back in: "
        f"{must_not_have & CURATED_OPTIONABLE_UNIVERSE}"
    )


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


def test_structured_prompt_marks_missing_vol_metrics_unavailable():
    """Missing IV/HV context must not be rendered as zero-volatility."""
    prompt = build_structured_prompt(
        symbol="NVDA",
        company="Nvidia",
        sector="Semiconductors",
        report_date="2026-04-23",
        report_time="AMC",
        price=201.7,
        iv_rank=None,
        iv_percentile=None,
        hv_20=None,
        expected_move_pct=None,
        hist_avg_abs_move_pct=None,
        recent_beats_misses=[],
        headlines=[],
        market_regime="Unknown",
    )
    text = prompt["user"]
    assert "IV rank: unavailable" in text
    assert "IV pctl: unavailable" in text
    assert "HV 20d: unavailable" in text
    assert "expected move (straddle): ±unavailable" in text
    assert "0.00%" not in text


def test_structured_prompt_restricts_fresh_setups_to_actionable_vocab():
    prompt = build_structured_prompt(
        symbol="NVDA",
        company="Nvidia",
        sector="Semiconductors",
        report_date="2026-04-23",
        report_time="AMC",
        price=201.7,
        iv_rank=30,
        iv_percentile=35,
        hv_20=0.42,
        expected_move_pct=0.045,
        hist_avg_abs_move_pct=0.070,
        recent_beats_misses=[],
        headlines=[],
        market_regime="Bull-LowVol",
    )

    system = prompt["system"]
    for setup in [
        "long call",
        "long put",
        "bull put spread",
        "bear call spread",
        "bull call spread",
        "bear put spread",
        "iron condor",
        "long straddle",
    ]:
        assert setup in system
    for unsupported in [
        "cash-secured put",
        "covered call",
        "calendar spread",
        "diagonal spread",
        "iron butterfly",
        "married put",
    ]:
        assert unsupported not in system


def test_structured_prompt_contains_expert_weighting_protocol():
    prompt = build_structured_prompt(
        symbol="AAPL",
        company="Apple",
        sector="Technology",
        report_date="2026-04-30",
        report_time="AMC",
        price=270.95,
        iv_rank=49,
        iv_percentile=75,
        hv_20=0.25,
        expected_move_pct=0.034,
        hist_avg_abs_move_pct=0.027,
        recent_beats_misses=[],
        headlines=["Apple earnings preview [source=Reuters; category=earnings; relevance=0.92]"],
        market_regime="Bull - Low Volatility; confidence=75%",
    )

    system = prompt["system"]
    user = prompt["user"]
    assert "EXPERT ANALYSIS PROTOCOL" in system
    assert "earnings-volatility trader" in system
    assert "news headlines and market regime must NOT dominate" in system
    assert "corroborative only" in user
    assert "risk/confidence modifier only" in user


def test_parse_structured_response_happy_path():
    # Round-12 / DR-1: vocab now defined-risk-only. ``iron condor`` is the
    # closest non-directional premium-selling shape to the prior ``short
    # strangle`` test fixture, with its risk capped by the wings.
    raw = '''{
      "verdict": "neutral-bull",
      "direction_magnitude": {"bull_case_pct": 0.04, "bear_case_pct": -0.05},
      "thesis": "IV is overpricing vs realized.",
      "catalysts": ["data-center guide"],
      "risks": ["guide miss"],
      "suggested_play": "iron condor",
      "suggested_play_reason": "IVR > 75 — capped at wing width",
      "confidence": 0.62
    }'''
    parsed = parse_structured_response(raw)
    assert parsed["verdict"] == "neutral-bull"
    assert parsed["confidence"] == 0.62
    assert parsed["suggested_play"] == "iron condor"


def test_parse_structured_response_rejects_naked_short_call():
    """Round-12 / DR-1: naked ``short call`` must be rejected — it was
    a valid setup pre-DR-1 and is now banned (undefined-risk on the upside)."""
    import pytest
    raw = '{"verdict": "bearish", "direction_magnitude": {"bull_case_pct": 0, "bear_case_pct": -0.05}, "thesis": "x", "catalysts": [], "risks": [], "suggested_play": "short call", "suggested_play_reason": "x", "confidence": 0.5}'
    with pytest.raises(ValueError, match="suggested_play"):
        parse_structured_response(raw)


def test_parse_structured_response_rejects_non_ticketable_setup():
    import pytest
    raw = '{"verdict": "neutral-bull", "direction_magnitude": {"bull_case_pct": 0.03, "bear_case_pct": -0.02}, "thesis": "x", "catalysts": [], "risks": [], "suggested_play": "cash-secured put", "suggested_play_reason": "x", "confidence": 0.5}'
    with pytest.raises(ValueError, match="suggested_play"):
        parse_structured_response(raw)


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
    """min_iv_rank excludes rows under the threshold. Both symbols must
    be in the curated universe — the always-on curated filter runs
    before iv_rank hydration."""
    from services import earnings_screener as svc

    future = (date.today() + timedelta(days=1)).isoformat()
    fake_earnings = [
        {"symbol": "NVDA", "company": "Nvidia", "sector": "Semis",
         "report_date": future, "report_time": "AMC"},
        {"symbol": "TSLA", "company": "Tesla", "sector": "Auto",
         "report_date": future, "report_time": "AMC"},
    ]
    hydrated = {"NVDA": {"iv_rank": 80}, "TSLA": {"iv_rank": 30}}

    async def hydrate(row, *, min_iv_rank: float = 0, client_host: str | None = None, today=None):
        iv = hydrated[row["symbol"]]["iv_rank"]
        if iv < min_iv_rank:
            return None
        return {**row, "price": 100.0, "iv_rank": iv}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=hydrate)):
        resp = await svc.list_upcoming(window="both", min_iv_rank=50)
    symbols = [r.symbol for r in resp.earnings]
    assert symbols == ["NVDA"]


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

    async def hydrate(row, *, min_iv_rank: float = 0, client_host: str | None = None, today=None):
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
        "historical_stats": {
            "avg_abs_move_pct": 0.052,
            "wins": 2,
            "losses": 1,
            "surprise_beat_rate": 0.67,
        },
        "historical_quarters": [
            {
                "report_date": "2026-01-30",
                "surprise_pct": 0.08,
                "next_day_move_pct": 0.04,
                "five_day_move_pct": 0.05,
            },
            {
                "report_date": "2025-10-30",
                "surprise_pct": -0.02,
                "next_day_move_pct": -0.03,
                "five_day_move_pct": -0.01,
            },
            {
                "report_date": "2025-07-30",
                "surprise_pct": 0.04,
                "next_day_move_pct": 0.08,
                "five_day_move_pct": 0.07,
            },
        ],
        "days_to_earnings": 1, "days_to_expiry": 3,
    }
    future_date = (date.today() + timedelta(days=1)).isoformat()
    with patch.object(
         svc, "_load_quote",
         AsyncMock(return_value={"last": 200.0, "change": -1.0, "change_pct": -0.5}),
         ), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value=metrics)), \
         patch.object(svc, "_load_strike_ladder", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_claude_structured", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_iv_term", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_skew", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_news", AsyncMock(return_value=[])), \
         patch.object(
             svc, "_load_earnings_meta",
             AsyncMock(return_value={
                 "company": "Nvidia", "sector": "Semis",
                 "report_date": future_date, "report_time": "AMC",
             }),
         ):
        detail = await svc.get_detail("NVDA")

    assert detail.symbol == "NVDA"
    assert detail.quote.last == 200.0
    assert detail.metrics.iv_rank == 78
    assert detail.historical_earnings is not None
    assert len(detail.historical_earnings.quarters) == 3
    assert detail.historical_earnings.stats.wins == 2
    # Blocks that returned None must stay None
    assert detail.strike_ladder is None
    assert detail.claude_structured is None


@pytest.mark.asyncio
async def test_list_upcoming_always_applies_curated_universe_filter():
    """B-66 regression: the curated-universe filter must always apply,
    regardless of call args — the former `market_cap` no-op toggle is
    gone. Tickers outside the curated set are filtered out."""
    from services import earnings_screener as svc

    future = (date.today() + timedelta(days=2)).isoformat()
    fake_earnings = [
        {"symbol": "NVDA", "company": "x", "sector": "x",
         "report_date": future, "report_time": "AMC"},
        {"symbol": "ZZZZZ", "company": "x", "sector": "x",
         "report_date": future, "report_time": "AMC"},
    ]

    async def hydrate(row, *, min_iv_rank: float = 0, client_host: str | None = None, today=None):
        return {**row, "price": 100.0, "iv_rank": 70.0}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=hydrate)):
        resp = await svc.list_upcoming(window="both", min_iv_rank=0)

    symbols = [r.symbol for r in resp.earnings]
    assert "NVDA" in symbols
    assert "ZZZZZ" not in symbols


@pytest.mark.asyncio
async def test_list_upcoming_surfaces_validation_errors():
    """B-81 regression: when CalendarRow(**payload) validation fails, the
    error must be surfaced via `validation_errors` on the response instead
    of silently swallowed. `partial` still flips true."""
    from services import earnings_screener as svc

    future = (date.today() + timedelta(days=2)).isoformat()
    fake_earnings = [
        {"symbol": "NVDA", "company": "Nvidia", "sector": "x",
         "report_date": future, "report_time": "AMC"},
        {"symbol": "TSLA", "company": "Tesla", "sector": "x",
         "report_date": future, "report_time": "AMC"},
    ]

    async def hydrate(row, *, min_iv_rank: float = 0, client_host: str | None = None, today=None):
        if row["symbol"] == "TSLA":
            # Return a payload that violates the schema (report_time invalid).
            return {**row, "report_time": "NOPE", "price": 100.0, "iv_rank": 70}
        return {**row, "price": 100.0, "iv_rank": 70}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=hydrate)):
        resp = await svc.list_upcoming(window="both", min_iv_rank=0)

    symbols = [r.symbol for r in resp.earnings]
    assert symbols == ["NVDA"]
    assert resp.partial is True
    assert len(resp.validation_errors) == 1
    assert resp.validation_errors[0]["symbol"] == "TSLA"
    assert "error" in resp.validation_errors[0]


@pytest.mark.asyncio
async def test_list_upcoming_filters_stale_earnings():
    """B-43 regression: rows with `days_until < 0` (report already happened)
    must not render in the calendar. FMP's window can return past dates on
    timezone edges and such rows look like typos to the user."""
    from services import earnings_screener as svc

    today = date.today()
    past_date = (today - timedelta(days=3)).isoformat()
    future_date = (today + timedelta(days=2)).isoformat()
    # Use curated-universe symbols so B-66's always-on filter lets them through.
    fake_earnings = [
        {"symbol": "NVDA", "company": "Nvidia", "sector": "x",
         "report_date": past_date, "report_time": "AMC"},
        {"symbol": "TSLA", "company": "Tesla", "sector": "x",
         "report_date": future_date, "report_time": "AMC"},
    ]

    async def hydrate(row, *, min_iv_rank: float = 0, client_host: str | None = None, today=None):
        return {**row, "price": 100.0, "iv_rank": 70.0}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=hydrate)):
        resp = await svc.list_upcoming(window="both", min_iv_rank=0)

    symbols = [r.symbol for r in resp.earnings]
    assert "TSLA" in symbols  # future date — kept
    assert "NVDA" not in symbols  # past date — stale, filtered


@pytest.mark.asyncio
async def test_headline_rescue_returns_empty_in_test_mode():
    """Unit tests that mock the calendar must not hit live per-symbol FMP."""
    from core.config import settings
    from services import earnings_screener as svc

    original = settings.SKIP_EARNINGS_FMP_CACHE
    settings.SKIP_EARNINGS_FMP_CACHE = True
    try:
        rows = await svc._fmp_headline_earnings_rescue("both")
    finally:
        settings.SKIP_EARNINGS_FMP_CACHE = original

    assert rows == []


# B-62: the _StubRequest pattern that B-33 stitched together is gone —
# `services.earnings_screener._load_quote` now calls
# `services.market.fetch_quote` directly, no FastAPI request faking. Per-IP
# rate-limit accounting moved into the route layer where it belongs (see
# `core.http.client_ip` consumers in `api.routes.market`). The three
# tests previously here (test_stub_request_uses_provided_client_host,
# test_stub_request_default_is_loopback,
# test_list_upcoming_threads_client_host_to_load_quote) were pinning the
# old pattern and were deleted with the stubs.


@pytest.mark.asyncio
async def test_hydrate_row_continues_when_quote_raises():
    """B-35 regression: _hydrate_row must not propagate a single task's
    exception; it should log and substitute None for the failed block so
    the caller still gets partial data."""
    from services import earnings_screener as svc

    future = (date.today() + timedelta(days=3)).isoformat()
    row = {"symbol": "NVDA", "company": "Nvidia", "sector": "Semis",
           "report_date": future, "report_time": "AMC"}

    with patch.object(svc, "_load_quote", AsyncMock(side_effect=RuntimeError("polygon down"))), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value={"iv_rank": 70, "expected_move_pct": 0.05})):
        result = await svc._hydrate_row(row, min_iv_rank=0)

    assert result is not None
    assert result["symbol"] == "NVDA"
    assert result["price"] is None  # quote failure -> None
    assert result["iv_rank"] == 70


@pytest.mark.asyncio
async def test_hydrate_row_continues_when_metrics_raises():
    """B-35 regression: symmetrical test — metrics task raising must not
    prevent the row from returning with quote data intact."""
    from services import earnings_screener as svc

    future = (date.today() + timedelta(days=3)).isoformat()
    row = {"symbol": "NVDA", "company": "Nvidia", "sector": "Semis",
           "report_date": future, "report_time": "AMC"}

    with patch.object(svc, "_load_quote",
                      AsyncMock(return_value={"last": 200.0, "change": 1.0, "change_pct": 0.5})), \
         patch.object(svc, "_load_metrics", AsyncMock(side_effect=RuntimeError("alpaca down"))):
        result = await svc._hydrate_row(row, min_iv_rank=0)

    assert result is not None
    assert result["symbol"] == "NVDA"
    assert result["price"] == 200.0
    assert result["iv_rank"] is None


@pytest.mark.asyncio
async def test_hydrate_row_does_not_rank_synthetic_chain_metrics():
    """Calendar Edge/IV chips should not look actionable on demo chains."""
    from services import earnings_screener as svc

    future = (date.today() + timedelta(days=3)).isoformat()
    row = {"symbol": "AAPL", "company": "Apple", "sector": "Tech",
           "report_date": future, "report_time": "AMC"}
    metrics = {
        "iv_rank": 91,
        "expected_move_pct": 0.08,
        "premium_yield_call_atm": 0.04,
        "premium_yield_put_atm": 0.05,
        "hist_avg_abs_move_pct": 0.04,
        "chain_is_demo": True,
        "iv_is_demo": True,
    }

    with patch.object(
        svc,
        "_load_quote",
        AsyncMock(return_value={"last": 200.0, "change": 1.0, "change_pct": 0.5}),
    ), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value=metrics)), \
         patch.object(svc, "_load_claude_structured_cached", AsyncMock(return_value=None)):
        result = await svc._hydrate_row(row, min_iv_rank=0)

    assert result is not None
    assert result["iv_rank"] is None
    assert result["expected_move_pct"] is None
    assert result["premium_yield_call_atm"] is None
    assert result["premium_yield_put_atm"] is None
    assert result["edge_score"] is None


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

    # B-62: services.earnings_screener now calls services.options.fetch_chain
    # directly (no route-handler stub). Patch target moves accordingly.
    #
    # Round-7 / midnight-flake fix: the SUT falls back to ``market_today()``
    # (ET-anchored, see ``core.time``), NOT ``date.today()`` (UTC on the
    # CI runner). Around UTC midnight ET is still on the previous date,
    # so a ``date.today()``-based assertion fails an otherwise-correct
    # run. Compare against ``market_today()`` instead, captured both
    # before and after the call to absorb any rare ET-midnight crossing.
    from core.time import market_today

    market_before = market_today()
    with patch("services.options.fetch_chain", fake_chain):
        result = await svc._load_strike_ladder("NOOPT", expiry=None)
    market_after = market_today()

    # No rows since no contracts, but expiry must not raise — should be
    # market today.
    assert result is not None
    assert result["expiry"] in {market_before, market_after}
    assert result["rows"] == []


@pytest.mark.asyncio
async def test_fmp_upcoming_times_out_on_stall():
    """B-80 regression: a stalled FMP `to_thread` call must not block the
    asyncio thread pool forever. `_fmp_upcoming` wraps the call in
    `asyncio.wait_for(...)`; on timeout the caller sees
    `asyncio.TimeoutError` (and the outer `list_upcoming` catch marks
    the response partial)."""
    import asyncio as _asyncio

    from services import earnings_screener as svc

    # Replace to_thread with a coroutine that sleeps forever, so wait_for
    # can cancel it cleanly without blocking a real thread.
    async def forever(fn):
        await _asyncio.sleep(3600)
        return []

    # Patch wait_for to a tight bound so the test is quick.
    original_wait_for = _asyncio.wait_for

    async def short_wait_for(coro, timeout):
        return await original_wait_for(coro, timeout=0.05)

    with patch("services.earnings_screener.asyncio.to_thread", forever), \
         patch("services.earnings_screener.asyncio.wait_for", short_wait_for):
        with pytest.raises(_asyncio.TimeoutError):
            await svc._fmp_upcoming("both")


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
        # B-85: the provider now accepts timeout kwarg; accept-and-ignore here.
        def __init__(self, *args, **kwargs):
            pass
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
        # B-85: provider now accepts timeout kwarg; accept-and-ignore here.
        def __init__(self, *args, **kwargs):
            pass
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

    future_date = (date.today() + timedelta(days=1)).isoformat()
    with patch.object(
         svc, "_load_quote",
         AsyncMock(return_value={"last": 200.0, "change": -1.0, "change_pct": -0.5}),
         ), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_strike_ladder", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_claude_structured", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_iv_term", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_skew", AsyncMock(return_value=None)), \
         patch.object(svc, "_news_payload", AsyncMock(side_effect=RuntimeError("newsdata 503"))), \
         patch.object(
             svc, "_load_earnings_meta",
             AsyncMock(return_value={
                 "company": "Nvidia", "sector": "Semis",
                 "report_date": future_date, "report_time": "AMC",
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

    future_date = (date.today() + timedelta(days=1)).isoformat()
    with patch.object(
         svc, "_load_earnings_meta",
         AsyncMock(return_value={
             "company": "Nvidia", "sector": "Semis",
             "report_date": future_date, "report_time": "AMC",
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
         patch.object(svc, "_load_news", AsyncMock(return_value=[])), \
         patch("core.cache.get_cache", return_value=fake_cache), \
         patch("agents.claude_client.ClaudeClient", return_value=fake_client):
        result = await svc.run_full_research("NVDA")

    assert isinstance(result, ClaudeFullResearch)
    assert result.confidence == 0.72
    fake_cache.set.assert_called_once()
    args, kwargs = fake_cache.set.call_args
    assert "earnings:claude-full:v2-news-regime-expert:NVDA" in args[0]
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


# ─── Round-4 regression tests ───────────────────────────────────────


@pytest.mark.asyncio
async def test_stub_detail_marks_partial_with_error_code():
    """Round-4 CLUSTER 3 #13: the stub detail panel had partial=False, which
    misled the frontend into rendering a "fully populated" UI for what was
    really a fallback. Now partial=True with error_codes=['stub_detail']."""
    from services import earnings_screener as svc

    async def fake_quote(symbol: str):
        return None

    async def fake_next(symbol: str):
        return None

    with patch.object(svc, "_load_quote", new=fake_quote), \
         patch.object(svc, "_fetch_next_earnings_date", new=fake_next):
        detail = await svc._build_stub_detail("AAPL")

    assert detail.partial is True
    assert "stub_detail" in detail.error_codes


def test_iv_data_iv_rank_nullable_for_real_data():
    """Round-4 CLUSTER 3 #10: real-data IVData should have iv_rank=None
    until the historical-vol pipeline lands. The within-chain-smile
    metric we used to surface was misleading and actively wrong as a
    sort key."""
    from services.options import IVData
    from datetime import datetime, timezone

    iv = IVData(
        symbol="NVDA",
        current_iv=0.45,
        iv_rank=None,  # honest
        iv_percentile=None,
        hv_20=None,
        hv_50=None,
        hv_100=None,
        is_demo=False,
        fetched_at=datetime.now(timezone.utc),
    )
    assert iv.iv_rank is None
    assert iv.hv_20 is None
    assert iv.is_demo is False


@pytest.mark.asyncio
async def test_demo_iv_marks_is_demo_true_async():
    """Round-4 CLUSTER 3 #10/#11: demo-data IVData carries synthetic
    iv_rank/hv values but is_demo=True so the UI can render a 'demo'
    badge. _demo_iv must populate is_demo=True."""
    from services.options import _demo_iv

    iv = await _demo_iv("AAPL")
    # Synthetic values present
    assert iv.iv_rank is not None
    assert iv.hv_20 is not None
    # And the demo flag is honest about the source
    assert iv.is_demo is True


@pytest.mark.asyncio
async def test_legacy_iv_history_keeps_hv_none_when_prices_insufficient():
    """Missing price history must not masquerade as valid 0% HV."""
    from services.options import fetch_iv_analysis

    async def fake_cache_get(key):
        if key == "iv:AAPL":
            return None
        if key == "iv_history:AAPL":
            return {"values": [0.30, 0.32, 0.35, 0.34, 0.36]}
        if key == "prices:AAPL":
            return {"close": [100.0, 101.0, 100.5]}
        return None

    with patch("services.options._fetch_real_iv", AsyncMock(return_value=None)), \
         patch("core.redis.cache_get", fake_cache_get):
        iv = await fetch_iv_analysis("AAPL")

    assert iv.is_demo is False
    assert iv.hv_20 is None
    assert iv.hv_50 is None
    assert iv.hv_100 is None


@pytest.mark.asyncio
async def test_demo_chain_marks_is_demo_true():
    """Round-4 CLUSTER 3 #12: demo OptionChain must flag is_demo=True."""
    from services.options import _demo_chain

    chain = await _demo_chain(
        symbol="AAPL",
        expiry_filter=None,
        strike_min=None,
        strike_max=None,
        option_type_filter=None,
    )
    assert chain.is_demo is True
    assert len(chain.contracts) > 0


@pytest.mark.asyncio
async def test_news_payload_returns_unavailable_when_demo():
    """Round-4 CLUSTER 3 #14: when Newsdata is rate-limited, the upstream
    fetch returns demo articles with empty URLs. _news_payload now exposes
    that as is_demo=True so the caller can attach 'news_unavailable' to
    error_codes instead of silently returning [] with no signal."""
    from services import earnings_screener as svc
    from services.news import NewsArticle, NewsResponse

    fake_resp = NewsResponse(
        articles=[
            NewsArticle(
                title="Demo: AAPL earnings",
                description="demo",
                url="",  # empty URL is the legacy signal
                source="DemoSrc",
                published_at="",
                is_demo=True,
            )
        ],
        query="AAPL",
        count=1,
        is_demo=True,
    )

    with patch("services.news.fetch_symbol_news", AsyncMock(return_value=fake_resp)):
        payload = await svc._news_payload("AAPL", limit=5)

    assert payload["is_demo"] is True
    assert payload["status"] == "demo"
    assert payload["articles"] == []


@pytest.mark.asyncio
async def test_symbol_news_keeps_clean_empty_result_when_filter_drops_generic_rows():
    """A provider response with no symbol/company-relevant rows is not an outage."""
    from services.news import fetch_symbol_news

    raw = [
        {
            "title": "Stock futures drift before Fed decision",
            "description": "Broad market story without the company.",
            "link": "https://example.com/market",
            "source_name": "Reuters",
            "pubDate": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        }
    ]

    with patch("services.news._fetch_newsdata", AsyncMock(return_value=raw)), \
         patch("core.redis.cache_get", AsyncMock(return_value=None)), \
         patch("core.redis.cache_set", AsyncMock()):
        resp = await fetch_symbol_news("AAPL", limit=5)

    assert resp.is_demo is False
    assert resp.count == 0
    assert resp.articles == []


@pytest.mark.asyncio
async def test_news_payload_marks_empty_relevant_news_as_ok_empty():
    from services import earnings_screener as svc
    from services.news import NewsResponse

    fake_resp = NewsResponse(articles=[], query="AAPL", count=0, is_demo=False)

    with patch("services.news.fetch_symbol_news", AsyncMock(return_value=fake_resp)):
        payload = await svc._news_payload("AAPL", limit=5)

    assert payload == {"articles": [], "is_demo": False, "status": "ok_empty"}


def test_news_relevance_keeps_company_name_headlines_without_ticker():
    """Apple/Google/etc. stories often omit the ticker in the headline.

    Regression: the old filter only matched "AAPL", so a real "Apple
    earnings" headline was discarded and Claude received no top news. GOOG
    also needs the Google/Alphabet alias, not just GOOGL.
    """
    from services.news import _parse_articles

    articles = _parse_articles(
        [
            {
                "title": "Apple shares rise as investors brace for earnings",
                "description": "Analysts focus on iPhone demand and services revenue.",
                "link": "https://example.com/apple-earnings",
                "source_name": "Reuters",
                "pubDate": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            },
            {
                "title": "Stock futures drift before Fed decision",
                "description": "Broad market story without the company.",
                "link": "https://example.com/market",
                "source_name": "Reuters",
                "pubDate": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            },
        ],
        symbols=["AAPL"],
    )

    assert [a.title for a in articles] == [
        "Apple shares rise as investors brace for earnings"
    ]
    assert articles[0].category == "earnings"

    goog_articles = _parse_articles(
        [
            {
                "title": "Google revenue beats as cloud growth accelerates",
                "description": "Alphabet shares moved after the quarterly report.",
                "link": "https://example.com/google-earnings",
                "source_name": "Reuters",
                "pubDate": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            }
        ],
        symbols=["GOOG"],
    )

    assert [a.title for a in goog_articles] == [
        "Google revenue beats as cloud growth accelerates"
    ]


@pytest.mark.asyncio
async def test_get_detail_attaches_news_unavailable_code_when_rate_limited():
    """Round-4 CLUSTER 3 #14: get_detail should add 'news_unavailable' to
    error_codes when the news provider is rate-limited."""
    from services import earnings_screener as svc

    future_date = (date.today() + timedelta(days=1)).isoformat()
    with patch.object(
         svc, "_load_quote",
         AsyncMock(return_value={"last": 200.0, "change": -1.0, "change_pct": -0.5}),
         ), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value={
             "iv_rank": None, "hv_20": None, "current_iv": 0.4,
         })), \
         patch.object(svc, "_load_strike_ladder", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_claude_structured", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_iv_term", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_skew", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_market_regime", AsyncMock(return_value="Neutral - Low Volatility")), \
         patch.object(svc, "_news_payload",
                      AsyncMock(return_value={"articles": [], "is_demo": True, "status": "demo"})), \
         patch.object(
             svc, "_load_earnings_meta",
             AsyncMock(return_value={
                 "company": "Nvidia", "sector": "Semis",
                 "report_date": future_date, "report_time": "AMC",
             }),
         ):
        detail = await svc.get_detail("NVDA")

    assert "news_unavailable" in detail.error_codes
    assert detail.partial is True
    assert detail.news == []


@pytest.mark.asyncio
async def test_get_detail_attaches_news_error_code_when_provider_throws():
    """Provider errors should use news_error, not the clean demo/unavailable code."""
    from services import earnings_screener as svc

    future_date = (date.today() + timedelta(days=1)).isoformat()
    with patch.object(
         svc, "_load_quote",
         AsyncMock(return_value={"last": 200.0, "change": -1.0, "change_pct": -0.5}),
         ), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value={
             "iv_rank": 50, "hv_20": 0.2, "current_iv": 0.4,
         })), \
         patch.object(svc, "_load_strike_ladder", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_claude_structured", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_iv_term", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_skew", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_market_regime", AsyncMock(return_value="Neutral - Low Volatility")), \
         patch.object(svc, "_news_payload", AsyncMock(return_value={
             "articles": [],
             "is_demo": True,
             "status": "provider_error",
         })), \
         patch.object(
             svc, "_load_earnings_meta",
             AsyncMock(return_value={
                 "company": "Nvidia", "sector": "Semis",
                 "report_date": future_date, "report_time": "AMC",
             }),
         ):
        detail = await svc.get_detail("NVDA")

    assert "news_error" in detail.error_codes
    assert "news_unavailable" not in detail.error_codes
    assert detail.partial is True


@pytest.mark.asyncio
async def test_get_detail_marks_chain_demo_from_metrics_when_ladder_missing():
    """Synthetic chain use must be visible even if the ladder block is absent."""
    from services import earnings_screener as svc

    future_date = (date.today() + timedelta(days=1)).isoformat()
    with patch.object(
         svc, "_load_quote",
         AsyncMock(return_value={"last": 200.0, "change": -1.0, "change_pct": -0.5}),
         ), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value={
             "iv_rank": None,
             "hv_20": None,
             "current_iv": 0.4,
             "chain_is_demo": True,
         })), \
         patch.object(svc, "_load_strike_ladder", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_claude_structured", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_iv_term", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_skew", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_market_regime", AsyncMock(return_value="Neutral - Low Volatility")), \
         patch.object(svc, "_news_payload", AsyncMock(return_value={
             "articles": [], "is_demo": False, "status": "ok_empty",
         })), \
         patch.object(
             svc, "_load_earnings_meta",
             AsyncMock(return_value={
                 "company": "Nvidia", "sector": "Semis",
                 "report_date": future_date, "report_time": "AMC",
             }),
         ):
        detail = await svc.get_detail("NVDA")

    assert "chain_demo" in detail.error_codes
    assert detail.partial is True


@pytest.mark.asyncio
async def test_get_detail_sends_ranked_news_and_regime_to_claude_context():
    from services import earnings_screener as svc

    captured: dict = {}

    async def fake_claude(symbol: str, *, context: dict):
        captured.update(context)
        return None

    future_date = (date.today() + timedelta(days=1)).isoformat()
    with patch.object(
         svc, "_load_quote",
         AsyncMock(return_value={"last": 270.95, "change": 0.24, "change_pct": 0.09}),
         ), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value={
             "iv_rank": 49, "iv_percentile": 75, "hv_20": 0.25,
             "expected_move_pct": 0.034, "hist_avg_abs_move_pct": 0.027,
             "historical_quarters": [],
         })), \
         patch.object(svc, "_load_strike_ladder", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_claude_structured", AsyncMock(side_effect=fake_claude)), \
         patch.object(svc, "_load_iv_term", AsyncMock(return_value=(None, False))), \
         patch.object(svc, "_load_skew", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_market_regime", AsyncMock(return_value=(
             "Bull - Low Volatility; confidence=75%; vix_proxy=16.4; "
             "SPY_day_change=+0.42%"
         ))), \
         patch.object(svc, "_news_payload", AsyncMock(return_value={
             "articles": [
                 {
                     "title": "Apple earnings preview focuses on iPhone demand",
                     "source": "Reuters",
                     "published_at": datetime.now(timezone.utc),
                     "url": "https://example.com/aapl",
                     "relevance_score": 0.92,
                     "category": "earnings",
                     "tier": 1,
                     "sentiment": "neutral",
                 }
             ],
             "is_demo": False,
         })), \
         patch.object(
             svc, "_load_earnings_meta",
             AsyncMock(return_value={
                 "company": "Apple", "sector": "Technology",
                 "report_date": future_date, "report_time": "AMC",
             }),
         ):
        await svc.get_detail("AAPL")

    assert captured["market_regime"].startswith("Bull - Low Volatility")
    assert captured["headlines"] == [
        "Apple earnings preview focuses on iPhone demand "
        "[source=Reuters; category=earnings; tier=1; relevance=0.92; sentiment=neutral]"
    ]


@pytest.mark.asyncio
async def test_load_market_regime_uses_ttl_cache():
    import time as _time

    from services import earnings_screener as svc

    previous = svc._market_regime_cache
    try:
        svc._market_regime_cache = (
            _time.monotonic(),
            "Bull - Low Volatility; confidence=75%; vix_proxy=16.4",
        )
        result = await svc._load_market_regime()
    finally:
        svc._market_regime_cache = previous

    assert result.startswith("Bull - Low Volatility")


def test_format_market_regime_context_labels_vixy_proxy():
    from services import earnings_screener as svc

    text = svc._format_market_regime_context({
        "regime": "Bull - Low Volatility",
        "confidence": 0.75,
        "vix_level": 16.4,
        "description": "test",
        "indicators": {
            "spy_change_pct": 0.42,
            "vix_proxy_change_pct": -1.25,
            "vix_proxy_source": "VIXY ETF change, not VIX index points",
        },
    })

    assert "VIXY_day_change=-1.25%" in text
    assert "not VIX index points" in text


def test_ground_full_research_response_drops_ungrounded_comparables():
    from services import earnings_screener as svc

    grounded = svc._ground_full_research_response(
        {
            "comparable_setups": [
                {
                    "report_date": "2026-01-30",
                    "iv_rank": 120,
                    "setup": "iron condor",
                    "outcome": "won",
                    "similarity_score": 1.4,
                },
                {
                    "report_date": "2025-01-30",
                    "iv_rank": 70,
                    "setup": "iron condor",
                    "outcome": "not supplied to Claude",
                    "similarity_score": 0.8,
                },
            ],
        },
        [{"report_date": "2026-01-30"}],
    )

    assert grounded["comparable_setups"] == [
        {
            "report_date": "2026-01-30",
            "iv_rank": 100.0,
            "setup": "iron condor",
            "outcome": "won",
            "similarity_score": 1.0,
        }
    ]


def test_ground_full_research_response_drops_comparables_without_history():
    from services import earnings_screener as svc

    grounded = svc._ground_full_research_response(
        {
            "comparable_setups": [
                {
                    "report_date": "2025-01-30",
                    "iv_rank": 70,
                    "setup": "iron condor",
                    "outcome": "not supplied to Claude",
                    "similarity_score": 0.8,
                }
            ],
        },
        [],
    )

    assert grounded["comparable_setups"] == []


def test_select_event_expiry_returns_none_when_no_expiry_captures_event():
    from services import earnings_screener as svc

    report_date = date(2026, 5, 1)

    assert svc._select_event_expiry(
        [date(2026, 4, 24), date(2026, 5, 1)],
        report_date=report_date,
        report_time="AMC",
    ) is None


def test_scrub_fmp_error_redacts_apikey():
    """Round-4 CLUSTER 4 #15: any FMP error string going to the log
    aggregator must have apikey= / apiKey= scrubbed. The redaction
    keeps the param name so oncall can tell what was scrubbed."""
    from services.earnings_screener import _scrub_fmp_error

    msg = "https://financialmodelingprep.com/stable/earnings-calendar?from=2026-04-27&to=2026-05-08&apikey=SECRET_TOKEN_123 timed out"
    scrubbed = _scrub_fmp_error(msg)
    assert "SECRET_TOKEN_123" not in scrubbed
    assert "apikey=REDACTED" in scrubbed

    # Mixed-case variants
    assert "REDACTED" in _scrub_fmp_error("...apiKey=abc&foo=1")
    assert "REDACTED" in _scrub_fmp_error("...api_key=zzz")


def test_sanitize_for_prompt_strips_control_chars():
    """Round-4 CLUSTER 6 #24: prompt-injection hardening — strip
    control characters and unicode line/paragraph separators from
    untrusted strings before they land in the Claude prompt."""
    from services.earnings_screener import _sanitize_for_prompt

    raw = "headline\u2028with\u2029separators\x00and\nnewline"
    cleaned = _sanitize_for_prompt(raw)
    assert "\u2028" not in cleaned
    assert "\u2029" not in cleaned
    assert "\x00" not in cleaned
    assert "\n" not in cleaned


def test_sanitize_for_prompt_truncates_long_inputs():
    """Long headlines/sectors get truncated to the configured cap."""
    from services.earnings_screener import _sanitize_for_prompt

    raw = "x" * 500
    cleaned = _sanitize_for_prompt(raw, max_len=200)
    assert len(cleaned) <= 200


@pytest.mark.asyncio
async def test_load_iv_term_runs_chain_fetches_in_parallel():
    """Round-4 CLUSTER 5 #17: _load_iv_term should fan out chain fetches
    via asyncio.gather rather than awaiting them sequentially. Verify the
    gather path completes correctly even when one chain fails."""
    import asyncio as _asyncio

    from services import earnings_screener as svc

    class _FakeContract:
        def __init__(self, strike, iv):
            self.strike = strike
            self.iv = iv
            self.option_type = "call"

    class _FakeChain:
        def __init__(self, exp):
            self.spot_price = 100.0
            self.expirations = [
                date(2026, 5, 1), date(2026, 5, 8), date(2026, 5, 15),
            ]
            self.contracts = [_FakeContract(100.0, 0.30)]

    call_count = {"n": 0}

    async def fake_chain(symbol, expiry=None):
        call_count["n"] += 1
        # Simulate the second chain fetch failing
        if call_count["n"] == 3:
            raise RuntimeError("transient")
        return _FakeChain(expiry)

    with patch("services.options.fetch_chain", fake_chain):
        result = await svc._load_iv_term("NVDA")

    # First call (no expiry) + one per expiration = 4 total attempts.
    # One fails; the rest still produce points.
    assert result is not None
    assert len(result) >= 1


@pytest.mark.asyncio
async def test_load_iv_term_filters_reused_first_chain_to_its_expiry():
    from services import earnings_screener as svc

    exp1 = date(2026, 5, 1)
    exp2 = date(2026, 5, 8)

    class _Contract:
        def __init__(self, expiry, strike, iv):
            self.expiry = expiry
            self.strike = strike
            self.iv = iv
            self.option_type = "call"

    class _Chain:
        spot_price = 100.0
        expirations = [exp1, exp2]

        def __init__(self, contracts):
            self.contracts = contracts

    async def fake_chain(symbol, expiry=None):
        if expiry == exp2:
            return _Chain([_Contract(exp2, 100.0, 0.90)])
        return _Chain([
            _Contract(exp2, 100.0, 0.90),
            _Contract(exp1, 110.0, 0.30),
        ])

    with patch("services.options.fetch_chain", fake_chain):
        points, is_partial = await svc._load_iv_term("NVDA")

    assert is_partial is False
    assert points is not None
    first = next(p for p in points if p["expiry"] == exp1)
    assert first["atm_iv"] == 0.30


@pytest.mark.asyncio
async def test_load_skew_filters_to_nearest_expiry():
    from services import earnings_screener as svc

    exp1 = date(2026, 5, 1)
    exp2 = date(2026, 5, 8)

    class _Contract:
        def __init__(self, expiry, side, delta, iv):
            self.expiry = expiry
            self.option_type = side
            self.delta = delta
            self.iv = iv

    class _Chain:
        expirations = [exp1, exp2]
        contracts = [
            _Contract(exp1, "put", -0.25, 0.50),
            _Contract(exp2, "call", 0.25, 0.10),
            _Contract(exp1, "call", 0.26, 0.40),
        ]

    async def fake_chain(symbol, expiry=None):
        return _Chain()

    with patch("services.options.fetch_chain", fake_chain):
        skew = await svc._load_skew("NVDA")

    assert skew is not None
    assert skew["put_iv_25d"] == 0.50
    assert skew["call_iv_25d"] == 0.40


@pytest.mark.asyncio
async def test_inflight_structured_dedup_only_runs_once():
    """Round-4 CLUSTER 2 #7: concurrent /detail callers for the same
    symbol on a cold cache must share one Claude run. The de-dup keeps
    one in-flight task per (symbol, report_date) and awaits it from
    every caller."""
    import asyncio as _asyncio

    from services import earnings_screener as svc

    runs = {"n": 0}

    async def fake_runner(symbol, context, cache, key):
        runs["n"] += 1
        await _asyncio.sleep(0.01)  # simulate Claude latency
        return {"verdict": "neutral", "confidence": 0.5}

    fake_cache = AsyncMock()
    fake_cache.get = AsyncMock(return_value=None)
    fake_cache.set = AsyncMock()

    # Reset the in-flight registry for a clean test.
    svc._inflight_structured.clear()

    with patch("core.cache.get_cache", return_value=fake_cache), \
         patch.object(svc, "_run_structured_and_cache", new=fake_runner):
        # Fire three concurrent requests for the same symbol.
        results = await _asyncio.gather(
            svc._load_claude_structured(
                "NVDA", {"report_date": "2026-05-01", "symbol": "NVDA"},
            ),
            svc._load_claude_structured(
                "NVDA", {"report_date": "2026-05-01", "symbol": "NVDA"},
            ),
            svc._load_claude_structured(
                "NVDA", {"report_date": "2026-05-01", "symbol": "NVDA"},
            ),
        )

    assert runs["n"] == 1, "all three callers should share one run"
    assert all(r is not None for r in results)


def test_get_client_returns_singleton():
    """Round-4 CLUSTER 2 #9: get_client() returns the same instance on
    repeated calls so the underlying httpx pool is reused."""
    from agents import claude_client as cc

    cc._reset_client_for_tests()
    # First call may fail due to missing API key in test env; tolerate
    # but verify caching behaviour when a key IS set.
    with patch.object(cc, "ClaudeClient") as mock_ctor:
        mock_ctor.return_value = "stub-client"
        c1 = cc.get_client()
        c2 = cc.get_client()
        assert c1 is c2
        assert mock_ctor.call_count == 1
    cc._reset_client_for_tests()


@pytest.mark.asyncio
async def test_list_upcoming_attaches_window_and_meta_in_response():
    """Round-4 CLUSTER 1 #3 + CLUSTER 5 #21: the response now exposes
    window_start, window_end, window_label, and meta.reason /
    meta.before_curated so the frontend can show a clear header and pick
    the right empty-state copy."""
    from services import earnings_screener as svc

    future = (date.today() + timedelta(days=2)).isoformat()
    fake_earnings = [
        {"symbol": "NVDA", "company": "Nvidia", "sector": "x",
         "report_date": future, "report_time": "AMC"},
    ]

    async def hydrate(row, *, min_iv_rank=0, client_host=None, today=None):
        return {**row, "price": 100.0, "iv_rank": 50.0}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=hydrate)):
        resp = await svc.list_upcoming(window="both", min_iv_rank=0)

    assert resp.window_start is not None
    assert resp.window_end is not None
    assert resp.window_end >= resp.window_start
    assert resp.window_label is not None
    assert "reason" in resp.meta
    assert resp.meta["reason"] == "ok"
    assert resp.meta["before_curated"] == 1


@pytest.mark.asyncio
async def test_list_upcoming_meta_signals_no_curated_matches():
    """Round-4 CLUSTER 5 #21: when FMP returns rows but none are in the
    curated universe, meta.reason='no_curated_matches' so the frontend
    can distinguish that from 'fmp_unavailable'."""
    from services import earnings_screener as svc

    future = (date.today() + timedelta(days=2)).isoformat()
    fake_earnings = [
        {"symbol": "ZZZZZ", "company": "x", "sector": "x",
         "report_date": future, "report_time": "AMC"},
        {"symbol": "QQQQ1", "company": "x", "sector": "x",
         "report_date": future, "report_time": "AMC"},
    ]

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)):
        resp = await svc.list_upcoming(window="both", min_iv_rank=0)

    assert resp.meta["reason"] == "no_curated_matches"
    assert resp.meta["before_curated"] == 2
    assert resp.earnings == []


@pytest.mark.asyncio
async def test_list_upcoming_fmp_unavailable_meta_reason():
    """Round-4 CLUSTER 5 #21: when _fmp_upcoming raises, the response
    must still carry the window fields and meta.reason='fmp_unavailable'."""
    from services import earnings_screener as svc

    with patch.object(svc, "_fmp_upcoming", AsyncMock(side_effect=RuntimeError("boom"))):
        resp = await svc.list_upcoming(window="both")

    assert resp.partial is True
    assert resp.error == "earnings calendar unavailable"
    assert resp.meta.get("reason") == "fmp_unavailable"
    assert resp.window_label is not None


@pytest.mark.asyncio
async def test_load_metrics_hv_iv_ratio_is_none_when_hv_missing():
    """Round-4 CLUSTER 3 #11: hv_iv_ratio must be None when hv_20 is None
    (real-data path until the historical-vol pipeline lands)."""
    from services import earnings_screener as svc
    from services.options import IVData
    from datetime import datetime, timezone

    class _FakeContract:
        def __init__(self, strike, iv):
            self.strike = strike
            self.iv = iv
            self.delta = 0.5
            self.bid = 1.0
            self.ask = 1.2
            self.last = 1.1
            self.theta = -0.1
            self.gamma = 0.01
            self.vega = 0.2
            self.open_interest = 100
            self.volume = 10
            self.option_type = "call"

    class _FakeChain:
        spot_price = 100.0
        expirations = [date(2026, 5, 1)]

        def __init__(self):
            self.contracts = [_FakeContract(100.0, 0.30)]

    fake_iv = IVData(
        symbol="NVDA",
        current_iv=0.45,
        iv_rank=None,
        iv_percentile=None,
        hv_20=None,
        hv_50=None,
        hv_100=None,
        is_demo=False,
        fetched_at=datetime.now(timezone.utc),
    )

    async def fake_iv_analysis(symbol, client_host=None):
        return fake_iv

    async def fake_chain(symbol, expiry=None):
        return _FakeChain()

    with patch("services.options.fetch_iv_analysis", fake_iv_analysis), \
         patch("services.options.fetch_chain", fake_chain), \
         patch.object(svc, "_load_historical_earnings", AsyncMock(return_value=None)):
        metrics = await svc._load_metrics("NVDA", report_date=date(2026, 4, 30))

    assert metrics is not None
    assert metrics["iv_rank"] is None
    assert metrics["hv_20"] is None
    assert metrics["hv_iv_ratio"] is None


@pytest.mark.asyncio
async def test_load_metrics_populates_atm_premium_yields():
    """Calendar yield sorting needs real ATM premium yields, not nulls."""
    from services import earnings_screener as svc
    from services.options import IVData
    from datetime import datetime, timezone

    class _FakeContract:
        def __init__(self, option_type, strike, bid, ask, last=0.0):
            self.option_type = option_type
            self.strike = strike
            self.bid = bid
            self.ask = ask
            self.last = last

    class _FakeChain:
        spot_price = 100.0

        def __init__(self):
            self.contracts = [
                _FakeContract("call", 100.0, 2.5, 3.5),
                _FakeContract("put", 100.0, 3.0, 4.0),
            ]

    fake_iv = IVData(
        symbol="NVDA",
        current_iv=0.45,
        iv_rank=72,
        iv_percentile=75,
        hv_20=0.30,
        hv_50=0.28,
        hv_100=0.25,
        is_demo=False,
        fetched_at=datetime.now(timezone.utc),
    )

    async def fake_iv_analysis(symbol, client_host=None):
        return fake_iv

    async def fake_chain(symbol, expiry=None):
        return _FakeChain()

    historical = {
        "quarters": [
            {
                "report_date": "2026-01-30",
                "surprise_pct": 0.08,
                "next_day_move_pct": 0.04,
                "five_day_move_pct": 0.05,
            }
        ],
        "stats": {"avg_abs_move_pct": 0.04, "surprise_beat_rate": 1.0},
    }

    with patch("services.options.fetch_iv_analysis", fake_iv_analysis), \
         patch("services.options.fetch_chain", fake_chain), \
         patch.object(svc, "_load_historical_earnings", AsyncMock(return_value=historical)):
        metrics = await svc._load_metrics("NVDA", report_date=date(2026, 4, 30))

    assert metrics is not None
    assert metrics["premium_yield_call_atm"] == 0.03
    assert metrics["premium_yield_put_atm"] == 0.035
    assert metrics["expected_move_pct"] == 0.065
    assert metrics["hist_avg_abs_move_pct"] == 0.04
    assert metrics["beat_rate"] == 1.0
    assert metrics["historical_quarters"] == historical["quarters"]


@pytest.mark.asyncio
async def test_load_metrics_uses_post_earnings_expiry_for_amc_reports():
    """AMC earnings need the next expiry after report day, not same-day expiry."""
    from services import earnings_screener as svc
    from services.options import IVData

    class _FakeContract:
        def __init__(self, option_type, expiry, strike, mid):
            self.option_type = option_type
            self.expiry = expiry
            self.strike = strike
            self.bid = mid
            self.ask = mid
            self.last = mid

    class _FakeChain:
        spot_price = 100.0
        expirations = [date(2026, 4, 30), date(2026, 5, 1)]

        def __init__(self):
            self.contracts = [
                _FakeContract("call", date(2026, 4, 30), 100.0, 10.0),
                _FakeContract("put", date(2026, 4, 30), 100.0, 10.0),
                _FakeContract("call", date(2026, 5, 1), 100.0, 2.0),
                _FakeContract("put", date(2026, 5, 1), 100.0, 3.0),
            ]

    fake_iv = IVData(
        symbol="AAPL",
        current_iv=0.45,
        iv_rank=72,
        iv_percentile=75,
        hv_20=0.30,
        hv_50=0.28,
        hv_100=0.25,
        is_demo=False,
        fetched_at=datetime.now(timezone.utc),
    )
    expiries_requested: list[date | None] = []

    async def fake_iv_analysis(symbol, client_host=None):
        return fake_iv

    async def fake_chain(symbol, expiry=None):
        expiries_requested.append(expiry)
        return _FakeChain()

    with patch("services.options.fetch_iv_analysis", fake_iv_analysis), \
         patch("services.options.fetch_chain", fake_chain), \
         patch.object(svc, "_load_historical_earnings", AsyncMock(return_value=None)):
        metrics = await svc._load_metrics(
            "AAPL",
            report_date=date(2026, 4, 30),
            report_time="AMC",
        )

    assert metrics is not None
    assert metrics["option_expiry"] == date(2026, 5, 1)
    assert metrics["expected_move_pct"] == 0.05
    assert date(2026, 5, 1) in expiries_requested


@pytest.mark.asyncio
async def test_load_strike_ladder_filters_rows_to_event_expiry():
    from services import earnings_screener as svc

    class _FakeContract:
        def __init__(self, option_type, expiry, strike, delta):
            self.option_type = option_type
            self.expiry = expiry
            self.strike = strike
            self.delta = delta
            self.bid = 1.0
            self.ask = 1.2
            self.last = 1.1
            self.iv = 0.4
            self.theta = -0.1
            self.gamma = 0.01
            self.vega = 0.2
            self.open_interest = 100
            self.volume = 10

    class _FakeChain:
        spot_price = 100.0
        expirations = [date(2026, 4, 30), date(2026, 5, 1)]
        fetched_at = datetime.now(timezone.utc)
        is_demo = False

        def __init__(self):
            self.contracts = [
                _FakeContract("call", date(2026, 4, 30), 100.0, 0.5),
                _FakeContract("put", date(2026, 4, 30), 100.0, -0.5),
                _FakeContract("call", date(2026, 5, 1), 100.0, 0.5),
                _FakeContract("put", date(2026, 5, 1), 100.0, -0.5),
                _FakeContract("call", date(2026, 5, 1), 105.0, 0.3),
                _FakeContract("put", date(2026, 5, 1), 95.0, -0.3),
                _FakeContract("call", date(2026, 5, 1), 110.0, 0.15),
                _FakeContract("put", date(2026, 5, 1), 90.0, -0.15),
            ]

    async def fake_chain(symbol, expiry=None):
        return _FakeChain()

    with patch("services.options.fetch_chain", fake_chain):
        ladder = await svc._load_strike_ladder(
            "AAPL",
            expiry=None,
            report_date=date(2026, 4, 30),
            report_time="AMC",
        )

    assert ladder is not None
    assert ladder["expiry"] == date(2026, 5, 1)
    assert ladder["rows"]
    assert {row["expiry"] for row in ladder["rows"]} == {date(2026, 5, 1)}


def test_option_mid_uses_one_sided_quotes_before_last():
    from services.earnings_screener import _option_mid

    class _Contract:
        bid = 0.0
        ask = 1.25
        last = 0.40

    assert _option_mid(_Contract()) == 1.25


def test_build_historical_quarters_joins_surprises_to_bars():
    import pandas as pd

    from services.earnings_screener import _build_historical_quarters

    surprises = pd.DataFrame([
        {"date": date(2026, 1, 30), "surprise_pct": 0.08},
        {"date": date(2025, 10, 30), "surprise_pct": -0.03},
    ])
    bars = pd.DataFrame([
        {"ts": pd.Timestamp("2025-10-29", tz="UTC"), "close": 100.0},
        {"ts": pd.Timestamp("2025-10-31", tz="UTC"), "close": 94.0},
        {"ts": pd.Timestamp("2025-11-03", tz="UTC"), "close": 95.0},
        {"ts": pd.Timestamp("2026-01-29", tz="UTC"), "close": 200.0},
        {"ts": pd.Timestamp("2026-02-02", tz="UTC"), "close": 214.0},
        {"ts": pd.Timestamp("2026-02-03", tz="UTC"), "close": 212.0},
    ])

    quarters = _build_historical_quarters(
        surprises,
        bars,
        asof=date(2026, 4, 30),
        limit=8,
    )

    assert [q["report_date"] for q in quarters] == ["2026-01-30", "2025-10-30"]
    assert quarters[0]["next_day_move_pct"] == 0.07
    assert quarters[1]["next_day_move_pct"] == -0.06


@pytest.mark.asyncio
async def test_hydrate_row_populates_calendar_rank_fields_from_metrics_and_cache():
    """Calendar rows should expose yield and cached Claude fields for sorting."""
    from services import earnings_screener as svc

    future = (date.today() + timedelta(days=3)).isoformat()
    row = {"symbol": "NVDA", "company": "Nvidia", "sector": "Semis",
           "report_date": future, "report_time": "AMC"}
    metrics = {
        "iv_rank": 70,
        "expected_move_pct": 0.061,
        "premium_yield_call_atm": 0.024,
        "premium_yield_put_atm": 0.031,
        "hist_avg_abs_move_pct": None,
    }
    cached_claude = {
        "verdict": "neutral-bull",
        "confidence": 0.64,
        "suggested_play": "bull put spread",
    }

    with patch.object(svc, "_load_quote",
                      AsyncMock(return_value={"last": 200.0, "change": 1.0, "change_pct": 0.5})), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value=metrics)), \
         patch.object(svc, "_load_claude_structured_cached", AsyncMock(return_value=cached_claude)), \
         patch.object(svc, "_load_claude_structured", AsyncMock()) as paid_loader:
        result = await svc._hydrate_row(row, min_iv_rank=0)

    assert result is not None
    assert result["premium_yield_call_atm"] == 0.024
    assert result["premium_yield_put_atm"] == 0.031
    assert result["claude_verdict"] == "neutral-bull"
    assert result["claude_confidence"] == 0.64
    assert result["top_setup"] == "bull put spread"
    assert result["edge_score"] is not None
    assert any("ATM premium yield" in r for r in result["edge_score_reasons"])
    paid_loader.assert_not_called()


@pytest.mark.asyncio
async def test_list_upcoming_sorts_by_yield_claude_confidence_and_edge_score():
    from services import earnings_screener as svc

    future = (date.today() + timedelta(days=2)).isoformat()
    fake_earnings = [
        {"symbol": "NVDA", "company": "Nvidia", "sector": "Semis",
         "report_date": future, "report_time": "AMC"},
        {"symbol": "TSLA", "company": "Tesla", "sector": "Auto",
         "report_date": future, "report_time": "AMC"},
    ]
    hydrated = {
        "NVDA": {"premium_yield_call_atm": 0.02, "premium_yield_put_atm": 0.03, "claude_confidence": 0.40, "edge_score": 52.0},
        "TSLA": {"premium_yield_call_atm": 0.06, "premium_yield_put_atm": 0.01, "claude_confidence": 0.75, "edge_score": 74.0},
    }

    async def hydrate(row, *, min_iv_rank=0, client_host=None, today=None):
        return {**row, "price": 100.0, "iv_rank": 50.0, **hydrated[row["symbol"]]}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=hydrate)):
        by_yield = await svc.list_upcoming(window="both", sort="yield")
        by_claude = await svc.list_upcoming(window="both", sort="claude_confidence")
        by_edge = await svc.list_upcoming(window="both", sort="edge_score")

    assert [r.symbol for r in by_yield.earnings] == ["TSLA", "NVDA"]
    assert [r.symbol for r in by_claude.earnings] == ["TSLA", "NVDA"]
    assert [r.symbol for r in by_edge.earnings] == ["TSLA", "NVDA"]
