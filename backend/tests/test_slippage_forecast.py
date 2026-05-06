"""Tests for ``services.slippage_forecast`` — Wave V V5.

Coverage:
  * patient mode (10% of spread) on a single liquid leg
  * immediate mode (50% of spread) on the same leg → larger slippage
  * illiquid leg (score=0.3) → 2.5× the slippage penalty applied
  * 4-leg condor with mixed liquidity scores sums correctly
  * confidence buckets driven by worst-leg score
  * legacy chain (liquidity_score=None) → forecast still returns,
    confidence drops to "low"
  * graceful degradation: empty legs → None; bad bid/ask → still works
    when at least one leg has valid quotes
"""
from __future__ import annotations

from services.slippage_forecast import (
    OptionLegWithMarks,
    forecast_combo_fill,
)


# ---------------------------------------------------------------------------
# Single-leg tests
# ---------------------------------------------------------------------------


def test_patient_mode_liquid_leg_expected_fill():
    """Liquid leg, patient mode: expected = mid + 0.10 × spread."""
    leg = OptionLegWithMarks(
        side="buy", bid=1.00, ask=1.10, mid=1.05, liquidity_score=0.8,
    )
    forecast = forecast_combo_fill([leg], fill_mode="patient")
    assert forecast is not None
    # spread=0.10, fraction=0.10, penalty=1.0 → slippage_per_leg=0.01
    # buy leg → target_mid=-1.05 (debit), expected_fill=-1.06
    assert abs(forecast.target_mid - (-1.05)) < 1e-6
    assert abs(forecast.expected_fill - (-1.06)) < 1e-6
    # $0.01 × 100 = $1 of slippage
    assert abs(forecast.expected_slippage_dollars - 1.0) < 0.01
    assert forecast.confidence == "high"


def test_immediate_mode_liquid_leg_crosses_half_spread():
    """Immediate mode = cross half the spread → expected fill at the touch."""
    leg = OptionLegWithMarks(
        side="buy", bid=1.00, ask=1.10, mid=1.05, liquidity_score=0.8,
    )
    forecast = forecast_combo_fill([leg], fill_mode="immediate")
    assert forecast is not None
    # spread=0.10, fraction=0.50, penalty=1.0 → slippage=0.05
    # buy leg target_mid=-1.05, expected_fill=-1.10 (paying full ask)
    assert abs(forecast.expected_fill - (-1.10)) < 1e-6
    # $0.05 × 100 = $5 dollars
    assert abs(forecast.expected_slippage_dollars - 5.0) < 0.01


def test_immediate_is_more_expensive_than_patient():
    """Immediate fill mode strictly worse than patient mid-walk."""
    leg = OptionLegWithMarks(
        side="buy", bid=1.00, ask=1.20, mid=1.10, liquidity_score=0.8,
    )
    patient = forecast_combo_fill([leg], fill_mode="patient")
    immediate = forecast_combo_fill([leg], fill_mode="immediate")
    assert patient is not None and immediate is not None
    assert immediate.expected_slippage_dollars > patient.expected_slippage_dollars


def test_illiquid_leg_applies_2_5x_penalty():
    """Score < 0.4 multiplies the per-leg slippage by 2.5×."""
    leg = OptionLegWithMarks(
        side="buy", bid=1.00, ask=1.10, mid=1.05, liquidity_score=0.3,
    )
    forecast = forecast_combo_fill([leg], fill_mode="patient")
    assert forecast is not None
    # spread=0.10, fraction=0.10, penalty=2.5 → slippage=0.025
    # $0.025 × 100 = $2.50
    assert abs(forecast.expected_slippage_dollars - 2.5) < 0.01
    assert forecast.confidence == "low"
    # Reasoning should mention illiquidity
    assert any("illiquid" in r for r in forecast.reasoning)


def test_medium_liquidity_applies_1_5x_penalty():
    """0.4 ≤ score < 0.7 multiplies the slippage by 1.5×."""
    leg = OptionLegWithMarks(
        side="buy", bid=1.00, ask=1.10, mid=1.05, liquidity_score=0.5,
    )
    forecast = forecast_combo_fill([leg], fill_mode="patient")
    assert forecast is not None
    # spread=0.10, fraction=0.10, penalty=1.5 → slippage=0.015
    # $0.015 × 100 = $1.50
    assert abs(forecast.expected_slippage_dollars - 1.5) < 0.01
    assert forecast.confidence == "medium"


def test_legacy_chain_score_none_falls_to_low_confidence():
    """``liquidity_score=None`` (pre-Agent 1) → confidence ``low``, no penalty."""
    leg = OptionLegWithMarks(
        side="buy", bid=1.00, ask=1.10, mid=1.05, liquidity_score=None,
    )
    forecast = forecast_combo_fill([leg], fill_mode="patient")
    assert forecast is not None
    # spread=0.10, fraction=0.10, penalty=1.0 (no data, no penalty) → slippage=0.01
    assert abs(forecast.expected_slippage_dollars - 1.0) < 0.01
    # But confidence falls to low — we can't vouch for the estimate.
    assert forecast.confidence == "low"
    # Reasoning explains why
    assert any("liquidity score unavailable" in r for r in forecast.reasoning)


# ---------------------------------------------------------------------------
# Multi-leg combo tests (4-leg iron condor)
# ---------------------------------------------------------------------------


def test_iron_condor_mixed_liquidity_sums_correctly():
    """4-leg condor: signed mids + spreads sum into the combo target.

    Setup: buy long-put 280 + sell short-put 290 + sell short-call 310 +
    buy long-call 320. Net credit position.

    Per-leg quotes (chosen so the math is hand-checkable):
      long_put : bid 1.00 ask 1.20 mid 1.10  score 0.8
      short_put: bid 2.40 ask 2.60 mid 2.50  score 0.6  (medium)
      short_cl : bid 2.10 ask 2.30 mid 2.20  score 0.8
      long_call: bid 0.90 ask 1.10 mid 1.00  score 0.3  (illiquid!)
    """
    legs = [
        OptionLegWithMarks(side="buy", bid=1.00, ask=1.20, mid=1.10, liquidity_score=0.8),
        OptionLegWithMarks(side="sell", bid=2.40, ask=2.60, mid=2.50, liquidity_score=0.6),
        OptionLegWithMarks(side="sell", bid=2.10, ask=2.30, mid=2.20, liquidity_score=0.8),
        OptionLegWithMarks(side="buy", bid=0.90, ask=1.10, mid=1.00, liquidity_score=0.3),
    ]
    forecast = forecast_combo_fill(legs, fill_mode="patient")
    assert forecast is not None
    # target_mid = -1.10 + 2.50 + 2.20 - 1.00 = +2.60 (credit)
    assert abs(forecast.target_mid - 2.60) < 1e-6

    # Per-leg slippage (patient, fraction=0.10):
    #   long_put : spread=0.20, penalty=1.0 → 0.020
    #   short_put: spread=0.20, penalty=1.5 → 0.030
    #   short_cl : spread=0.20, penalty=1.0 → 0.020
    #   long_call: spread=0.20, penalty=2.5 → 0.050
    # Sum (abs slippage per share) = 0.120 → $12 dollars per contract.
    assert abs(forecast.expected_slippage_dollars - 12.0) < 0.01

    # Expected fill < target_mid (credit reduced by slippage cost)
    assert forecast.expected_fill < forecast.target_mid

    # Worst leg score is 0.3 → confidence "low".
    assert forecast.confidence == "low"

    # p10/p90 bracket the expected fill, and p10 (better case for credit)
    # is the larger number.
    assert forecast.p10_fill > forecast.p90_fill
    assert forecast.p90_fill <= forecast.expected_fill <= forecast.p10_fill


def test_combo_all_liquid_high_confidence():
    """4 liquid legs → confidence high, slippage is just the unsanctioned 10%."""
    legs = [
        OptionLegWithMarks(side="buy", bid=1.00, ask=1.10, mid=1.05, liquidity_score=0.85),
        OptionLegWithMarks(side="sell", bid=2.45, ask=2.55, mid=2.50, liquidity_score=0.85),
        OptionLegWithMarks(side="sell", bid=2.15, ask=2.25, mid=2.20, liquidity_score=0.85),
        OptionLegWithMarks(side="buy", bid=0.95, ask=1.05, mid=1.00, liquidity_score=0.85),
    ]
    forecast = forecast_combo_fill(legs, fill_mode="patient")
    assert forecast is not None
    assert forecast.confidence == "high"
    # 4 legs × 0.10 spread × 0.10 fraction × 1.0 penalty = 0.04 per share
    # × 100 = $4 of slippage
    assert abs(forecast.expected_slippage_dollars - 4.0) < 0.01


def test_combo_mid_liquidity_medium_confidence():
    """All legs in the medium band (0.4 ≤ score < 0.7) → confidence medium."""
    legs = [
        OptionLegWithMarks(side="sell", bid=2.00, ask=2.20, mid=2.10, liquidity_score=0.5),
        OptionLegWithMarks(side="buy", bid=1.00, ask=1.20, mid=1.10, liquidity_score=0.5),
    ]
    forecast = forecast_combo_fill(legs, fill_mode="patient")
    assert forecast is not None
    assert forecast.confidence == "medium"


# ---------------------------------------------------------------------------
# Graceful-degradation tests
# ---------------------------------------------------------------------------


def test_empty_legs_returns_none():
    """Forecaster never raises on empty input — returns None instead."""
    assert forecast_combo_fill([], fill_mode="patient") is None


def test_zero_spread_gives_zero_slippage():
    """Crossed/locked market: bid=ask → no spread, no slippage."""
    leg = OptionLegWithMarks(
        side="buy", bid=1.00, ask=1.00, mid=1.00, liquidity_score=0.8,
    )
    forecast = forecast_combo_fill([leg], fill_mode="patient")
    assert forecast is not None
    assert forecast.expected_slippage_dollars == 0.0
    assert forecast.expected_fill == forecast.target_mid


def test_crossed_market_treated_as_zero_spread():
    """bid > ask shouldn't yield negative slippage — clamp at zero."""
    leg = OptionLegWithMarks(
        side="buy", bid=1.10, ask=1.00, mid=1.05, liquidity_score=0.8,
    )
    forecast = forecast_combo_fill([leg], fill_mode="patient")
    assert forecast is not None
    assert forecast.expected_slippage_dollars == 0.0
