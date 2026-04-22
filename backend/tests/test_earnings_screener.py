"""Pure-function tests for earnings_screener. Provider mocking comes in
Task 8 when we test the aggregator; these tests cover the math."""
from datetime import date

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
