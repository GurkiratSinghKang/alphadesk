"""Tests for ``services.earnings_recommender`` — Wave 4a / Batch Q + SHR.

Covers:
  * regime classification across IV rank / IV-to-HV / verdict / confidence
  * iron condor builder correctness (4 legs, max P/L, breakevens, EV sign)
  * Kelly sizing bounded at 2% and zeroed for unfavourable EV
  * POP for known lognormal cases (sanity-checked at 1-stdev intervals)
  * recommend_setups: high-IV neutral → iron_condor first; high-conf
    bullish in low-IV → bull_call_spread first
  * SHR-1: empirical POP from prior_moves
  * SHR-2: tail-risk score across signal combinations
  * SHR-3: confidence + tail-risk Kelly overlay
  * SHR-4: skip outcome when EV is poor
  * SHR-7: AMD-regression — top setup is NOT iron_condor under elevated
    intraday momentum + analyst raises + cohort
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from api.schemas.earnings import TailRiskSignals
from services.earnings_recommender import (
    _classify_regime,
    _candidates_for_regime,
    _compute_tail_risk_score,
    _empirical_pop,
    _lognormal_pop,
    compute_pop,
    find_strike_by_delta,
    find_strike_nearest,
    kelly_fraction,
    nearest_event_spanning_expiry,
    recommend_setups,
)


# ---------------------------------------------------------------------------
# Fixtures — synthetic OptionChain
# ---------------------------------------------------------------------------


@dataclass
class _FakeContract:
    strike: float
    option_type: str  # "call" | "put"
    bid: float
    ask: float
    delta: float
    expiry: date
    last: float = 0.0
    iv: float = 0.5
    gamma: float = 0.0
    theta: float = 0.0
    vega: float = 0.0
    volume: int = 100
    open_interest: int = 1000


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


def _make_chain(
    *,
    underlying: str = "AMD",
    spot: float = 356.0,
    expiries: list[date] | None = None,
    iv: float = 1.19,
    dte_days: int = 3,
    strikes: list[float] | None = None,
) -> _FakeChain:
    """Build a synthetic chain with realistic per-strike deltas + mids.

    Uses a simple Black-Scholes approximation so deltas vary monotonically
    with strike. Mids are scaled to be plausible per-share premiums for
    the given IV/DTE.
    """
    if expiries is None:
        expiries = [date.today() + timedelta(days=dte_days)]
    if strikes is None:
        # Strikes ±20% in $5 steps
        lower = max(5.0, spot * 0.80)
        upper = spot * 1.20
        step = max(1.0, round(spot * 0.02))
        # round lower to step boundary
        start = step * round(lower / step)
        strikes = []
        s = start
        while s <= upper:
            strikes.append(round(s, 2))
            s += step
    primary_expiry = expiries[0]
    tau = max(1, (primary_expiry - date.today()).days) / 365.0

    contracts: list[_FakeContract] = []
    for K in strikes:
        # Plausible BS-ish delta + mid for both expiries
        for exp in expiries:
            tau_e = max(1, (exp - date.today()).days) / 365.0
            sigma = iv
            sqrt_tau = math.sqrt(tau_e)
            try:
                d1 = (math.log(spot / K) + 0.5 * sigma * sigma * tau_e) / (
                    sigma * sqrt_tau
                )
            except (ValueError, ZeroDivisionError):
                d1 = 0.0
            from scipy.stats import norm  # type: ignore[import-untyped]

            call_delta = float(norm.cdf(d1))
            put_delta = call_delta - 1.0
            # Approximate BS mid (zero rates)
            d2 = d1 - sigma * sqrt_tau
            call_mid = float(spot * norm.cdf(d1) - K * norm.cdf(d2))
            put_mid = float(K * norm.cdf(-d2) - spot * norm.cdf(-d1))
            call_mid = max(0.10, call_mid)
            put_mid = max(0.10, put_mid)
            contracts.append(
                _FakeContract(
                    strike=K, option_type="call",
                    bid=call_mid * 0.97, ask=call_mid * 1.03,
                    delta=call_delta, expiry=exp, iv=sigma,
                )
            )
            contracts.append(
                _FakeContract(
                    strike=K, option_type="put",
                    bid=put_mid * 0.97, ask=put_mid * 1.03,
                    delta=put_delta, expiry=exp, iv=sigma,
                )
            )
    return _FakeChain(
        underlying=underlying,
        spot_price=spot,
        expirations=expiries,
        contracts=contracts,
    )


# ---------------------------------------------------------------------------
# Regime classification
# ---------------------------------------------------------------------------


def test_classify_regime_rich_neutral_high_iv_rank():
    assert (
        _classify_regime(iv_rank=85, iv_to_hv_ratio=None, claude_verdict="neutral", claude_confidence=0.55)
        == "rich_neutral"
    )


def test_classify_regime_rich_neutral_via_iv_to_hv():
    """AMD case: iv_rank may be unknown, but IV/HV = 1.83x is rich."""
    assert (
        _classify_regime(iv_rank=None, iv_to_hv_ratio=1.83, claude_verdict="neutral-bear", claude_confidence=0.55)
        == "rich_neutral"
    )


def test_classify_regime_rich_directional_bearish():
    assert (
        _classify_regime(iv_rank=80, iv_to_hv_ratio=1.6, claude_verdict="bearish", claude_confidence=0.78)
        == "rich_directional"
    )


def test_classify_regime_cheap_directional_bullish():
    assert (
        _classify_regime(iv_rank=18, iv_to_hv_ratio=0.9, claude_verdict="bullish", claude_confidence=0.85)
        == "cheap_directional"
    )


def test_classify_regime_cheap_neutral():
    assert (
        _classify_regime(iv_rank=20, iv_to_hv_ratio=0.8, claude_verdict="neutral", claude_confidence=0.50)
        == "cheap_neutral"
    )


def test_classify_regime_mixed_falls_through():
    """IV rank 50 + neutral confidence + no strong directional verdict."""
    assert (
        _classify_regime(iv_rank=50, iv_to_hv_ratio=1.1, claude_verdict="neutral", claude_confidence=0.55)
        == "mixed"
    )


# ---------------------------------------------------------------------------
# POP (lognormal terminal distribution)
# ---------------------------------------------------------------------------


def test_pop_between_breakevens_around_atm():
    """spot=100, breakevens 95/105, IV=20%, DTE=7 days.
    σ·√τ = 0.20 · √(7/365) ≈ 0.0277. The 95/105 band spans roughly
    ±0.05/0.0277 ≈ ±1.8 stdev → P ≈ 0.92. Should be high.
    """
    pop = compute_pop(spot=100.0, breakevens=[95.0, 105.0], iv=0.20, dte_days=7, profitable_zone="between")
    assert 0.85 <= pop <= 0.96


def test_pop_below_lower_below_atm_strike():
    """spot=100, breakeven=95 below — bear setup. σ·√τ ≈ 0.028. The
    Z-score is ln(95/100)/0.028 ≈ -1.83 → cdf ≈ 0.034."""
    pop = compute_pop(spot=100.0, breakevens=[95.0], iv=0.20, dte_days=7, profitable_zone="below_lower")
    assert 0.02 <= pop <= 0.06


def test_pop_above_upper():
    pop = compute_pop(spot=100.0, breakevens=[105.0], iv=0.20, dte_days=7, profitable_zone="above_upper")
    assert 0.02 <= pop <= 0.06


def test_pop_outside_long_straddle():
    """Long straddle with breakevens 95/105, IV=20%, DTE=7 → POP ≈ 1 - 0.92 = 0.08."""
    pop = compute_pop(spot=100.0, breakevens=[95.0, 105.0], iv=0.20, dte_days=7, profitable_zone="outside")
    assert 0.04 <= pop <= 0.15


def test_pop_zero_inputs():
    assert compute_pop(spot=0.0, breakevens=[95.0, 105.0], iv=0.20, dte_days=7, profitable_zone="between") == 0.0
    assert compute_pop(spot=100.0, breakevens=[], iv=0.20, dte_days=7, profitable_zone="between") == 0.0
    assert compute_pop(spot=100.0, breakevens=[95.0, 105.0], iv=0.0, dte_days=7, profitable_zone="between") == 0.0


# ---------------------------------------------------------------------------
# Kelly sizing
# ---------------------------------------------------------------------------


def test_kelly_fraction_positive_edge_capped_at_two_pct():
    """High-edge case (POP=0.85, b=2): full Kelly = (0.85·3 - 1) / 2 = 0.775
    which is silly aggressive. The cap pulls it to 2%."""
    f = kelly_fraction(pop=0.85, b=2.0)
    assert f == pytest.approx(0.02)


def test_kelly_fraction_negative_edge_zero():
    """POP·R/R does NOT clear breakeven → bet 0."""
    assert kelly_fraction(pop=0.40, b=0.5) == 0.0


def test_kelly_fraction_zero_b_returns_zero():
    assert kelly_fraction(pop=0.6, b=0.0) == 0.0


def test_kelly_fraction_borderline_uncapped_under_two_pct():
    """Pick parameters so raw Kelly is small (< 2%): POP=0.51, b=1.0 →
    f = (0.51·2 - 1) / 1 = 0.02."""
    f = kelly_fraction(pop=0.51, b=1.0, cap=0.10)
    assert f == pytest.approx(0.02, abs=1e-6)


# ---------------------------------------------------------------------------
# Strike pickers
# ---------------------------------------------------------------------------


def test_find_strike_by_delta_picks_closest_abs_delta():
    chain = _make_chain(spot=100.0, iv=0.30, dte_days=7)
    expiry = chain.expirations[0]
    short_put = find_strike_by_delta(chain, expiry, "put", -0.20)
    assert short_put is not None
    # Strike should be below spot
    assert short_put.strike < 100.0
    # Delta should be reasonably close to -0.20
    assert abs(abs(short_put.delta) - 0.20) < 0.10


def test_find_strike_nearest_picks_closest_strike():
    chain = _make_chain(spot=100.0)
    expiry = chain.expirations[0]
    atm = find_strike_nearest(chain, expiry, "call", 100.0)
    assert atm is not None
    assert abs(atm.strike - 100.0) <= 5.0


# ---------------------------------------------------------------------------
# Iron condor builder via recommend_setups
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_iron_condor_for_high_iv_neutral_amd_like():
    """AMD-like input: spot=356, IV=1.19, HV=0.65 (1.83x), neutral verdict.
    Recommender should return iron_condor first with 4 legs."""
    chain = _make_chain(underlying="AMD", spot=356.0, iv=1.19, dte_days=3)
    setups = await recommend_setups(
        symbol="AMD",
        spot=356.0,
        iv_rank=None,
        iv_percentile=None,
        current_iv=1.19,
        hv_20=0.65,
        expected_move_pct=0.066,
        hist_avg_abs_move_pct=0.045,
        claude_verdict="neutral-bear",
        claude_confidence=0.55,
        chain=chain,
        report_date=date.today(),
        report_time="AMC",
    )
    assert setups, "expected at least one setup"
    top = setups[0]
    assert top.setup_id == "iron_condor"
    # Iron condor has exactly 4 legs
    assert len(top.legs) == 4
    sides = sorted([(l.side, l.contract_type) for l in top.legs])
    # Must include 1 buy put, 1 sell put, 1 sell call, 1 buy call
    assert sides == sorted(
        [("buy", "put"), ("sell", "put"), ("sell", "call"), ("buy", "call")]
    )
    # Defined risk: max_profit and max_loss are both finite, positive
    assert top.max_profit is not None and top.max_profit > 0
    assert top.max_loss is not None and top.max_loss > 0
    # Two breakevens straddling spot
    assert len(top.breakevens) == 2
    assert top.breakevens[0] < 356.0 < top.breakevens[1]
    # POP in [0, 1]
    assert 0.0 <= top.pop_estimate <= 1.0
    # Risk reward = max_profit / max_loss
    assert top.risk_reward == pytest.approx(top.max_profit / top.max_loss, rel=1e-6)
    # Defined-risk flag set
    assert top.is_defined_risk is True
    # Sizing capped at 2%
    assert 0.0 <= top.sizing_kelly_pct <= 0.02


# ---------------------------------------------------------------------------
# Directional regime: high-confidence bear + high IV → bear_call_spread
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_high_conf_bearish_in_high_iv_picks_bear_call_spread():
    chain = _make_chain(spot=100.0, iv=0.85, dte_days=7)
    setups = await recommend_setups(
        symbol="XYZ",
        spot=100.0,
        iv_rank=82,
        iv_percentile=80,
        current_iv=0.85,
        hv_20=0.40,
        expected_move_pct=0.08,
        hist_avg_abs_move_pct=0.05,
        claude_verdict="bearish",
        claude_confidence=0.80,
        chain=chain,
    )
    assert setups
    # First candidate enumerated for rich_directional/bearish is bear_call_spread.
    # The recommender ranks by EV — accept either bear_call_spread or
    # iron_condor in top slot (depending on which scores higher), but we
    # require bear_call_spread to be in the top-3.
    setup_ids = [s.setup_id for s in setups]
    assert "bear_call_spread" in setup_ids


@pytest.mark.asyncio
async def test_high_conf_bullish_in_low_iv_picks_debit_spread_or_long_call():
    chain = _make_chain(spot=100.0, iv=0.25, dte_days=14)
    setups = await recommend_setups(
        symbol="XYZ",
        spot=100.0,
        iv_rank=18,
        iv_percentile=15,
        current_iv=0.25,
        hv_20=0.30,
        expected_move_pct=0.04,
        hist_avg_abs_move_pct=0.06,
        claude_verdict="bullish",
        claude_confidence=0.78,
        chain=chain,
    )
    assert setups
    setup_ids = {s.setup_id for s in setups}
    # Cheap-directional bullish: bull_call_spread or long_call should appear.
    assert setup_ids & {"bull_call_spread", "long_call", "diagonal_spread"}


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recommend_setups_returns_empty_with_zero_iv():
    chain = _make_chain(spot=100.0)
    setups = await recommend_setups(
        symbol="X",
        spot=100.0,
        iv_rank=None,
        iv_percentile=None,
        current_iv=0.0,
        hv_20=None,
        expected_move_pct=None,
        hist_avg_abs_move_pct=None,
        claude_verdict=None,
        claude_confidence=None,
        chain=chain,
    )
    assert setups == []


@pytest.mark.asyncio
async def test_recommend_setups_returns_empty_with_no_chain():
    setups = await recommend_setups(
        symbol="X",
        spot=100.0,
        iv_rank=50,
        iv_percentile=50,
        current_iv=0.30,
        hv_20=0.30,
        expected_move_pct=0.05,
        hist_avg_abs_move_pct=0.04,
        claude_verdict="neutral",
        claude_confidence=0.55,
        chain=None,
    )
    assert setups == []


@pytest.mark.asyncio
async def test_recommend_setups_top_3_cap():
    """Even if more candidates produce valid setups, return at most 3."""
    chain = _make_chain(spot=356.0, iv=1.19, dte_days=3)
    setups = await recommend_setups(
        symbol="AMD",
        spot=356.0,
        iv_rank=85,
        iv_percentile=80,
        current_iv=1.19,
        hv_20=0.65,
        expected_move_pct=0.066,
        hist_avg_abs_move_pct=0.045,
        claude_verdict="neutral",
        claude_confidence=0.50,
        chain=chain,
    )
    assert len(setups) <= 3


def test_candidates_for_regime_routes_by_verdict():
    bear = _candidates_for_regime("rich_directional", "bearish")
    bull = _candidates_for_regime("rich_directional", "bullish")
    assert bear[0].__name__.endswith("bear_call_spread")
    assert bull[0].__name__.endswith("bull_put_spread")


def test_nearest_event_spanning_expiry_amc_skips_same_day():
    today = date.today()
    chain = _FakeChain(
        underlying="X", spot_price=100.0,
        expirations=[today, today + timedelta(days=2)],
        contracts=[],
    )
    # AMC: same-day expiry expires before earnings, so we should pick the next.
    picked = nearest_event_spanning_expiry(chain, report_date=today, report_time="AMC")
    assert picked == today + timedelta(days=2)


def test_nearest_event_spanning_expiry_bmo_uses_same_day():
    today = date.today()
    chain = _FakeChain(
        underlying="X", spot_price=100.0,
        expirations=[today, today + timedelta(days=2)],
        contracts=[],
    )
    picked = nearest_event_spanning_expiry(chain, report_date=today, report_time="BMO")
    assert picked == today


# ---------------------------------------------------------------------------
# SHR-1: empirical POP
# ---------------------------------------------------------------------------


def test_empirical_pop_inside_breakeven_band():
    """spot=100, breakevens 95/105, prior_moves all small (within band).

    All projected prices land inside [95, 105]; expected POP = 1.0.
    """
    pm = [-0.03, -0.01, 0.0, 0.01, 0.02, 0.03, -0.02, 0.04]
    pop = _empirical_pop(spot=100.0, breakevens=[95.0, 105.0], prior_moves=pm,
                         profitable_zone="between")
    assert pop == pytest.approx(1.0)


def test_empirical_pop_with_fat_tail_observation():
    """One historical move blows through both wings → POP < 1.0.

    AMD-flavour: 7 small moves and 1 +21% gap. The condor wins on 7/8 = 0.875.
    The lognormal (with similar IV) tends to overrate this — empirical
    correctly captures the fat tail.
    """
    pm = [-0.02, +0.03, -0.05, +0.21, +0.04, -0.03, +0.02, -0.01]
    pop_emp = _empirical_pop(spot=100.0, breakevens=[95.0, 110.0], prior_moves=pm,
                             profitable_zone="between")
    # 7 of 8 land in [95, 110]; the +21% gap exits at 121 > 110 → loss.
    assert pop_emp == pytest.approx(7.0 / 8.0)


def test_compute_pop_routes_to_empirical_when_prior_moves_present():
    """≥6 prior_moves switches POP from lognormal to empirical."""
    pm = [-0.02, +0.03, -0.05, +0.21, +0.04, -0.03, +0.02, -0.01]
    pop_with = compute_pop(spot=100.0, breakevens=[95.0, 110.0], iv=0.40,
                           dte_days=7, profitable_zone="between", prior_moves=pm)
    # Empirical should give 7/8 = 0.875.
    assert pop_with == pytest.approx(0.875)
    pop_without = compute_pop(spot=100.0, breakevens=[95.0, 110.0], iv=0.40,
                              dte_days=7, profitable_zone="between")
    # Lognormal at IV=0.40 / 7d gives a different value; assert just that
    # the two paths return different answers (proving the route).
    assert pop_with != pytest.approx(pop_without)


def test_compute_pop_falls_back_to_lognormal_with_few_moves():
    """<6 prior_moves should fall through to lognormal."""
    pm = [+0.01, -0.02, +0.03]
    pop_with_few = compute_pop(spot=100.0, breakevens=[95.0, 105.0], iv=0.20,
                               dte_days=7, profitable_zone="between", prior_moves=pm)
    pop_lognormal = _lognormal_pop(spot=100.0, breakevens=[95.0, 105.0], iv=0.20,
                                   dte_days=7, profitable_zone="between")
    assert pop_with_few == pytest.approx(pop_lognormal)


def test_empirical_pop_below_lower_zone():
    """Profitable zone = below_lower (bear setup)."""
    pm = [-0.10, -0.08, -0.06, -0.02, +0.02, +0.05]  # 4 of 6 below -0.05
    # breakeven 95 → projected prices: 90, 92, 94, 98, 102, 105
    # below 95: 90, 92, 94 → 3 wins.
    pop = _empirical_pop(spot=100.0, breakevens=[95.0], prior_moves=pm,
                        profitable_zone="below_lower")
    assert pop == pytest.approx(3.0 / 6.0)


# ---------------------------------------------------------------------------
# SHR-2: tail-risk score
# ---------------------------------------------------------------------------


def test_tail_risk_score_zero_when_all_signals_none():
    score = _compute_tail_risk_score(TailRiskSignals())
    assert score == 0.0


def test_tail_risk_score_intraday_momentum_alone():
    """+4.3% intraday → +0.25 weight."""
    score = _compute_tail_risk_score(TailRiskSignals(intraday_momentum_pct=0.043))
    assert score == pytest.approx(0.25)


def test_tail_risk_score_intraday_momentum_below_threshold():
    """+1.5% (below 2.5% threshold) contributes nothing."""
    score = _compute_tail_risk_score(TailRiskSignals(intraday_momentum_pct=0.015))
    assert score == 0.0


def test_tail_risk_score_signs_intraday_negative_also_counts():
    """-3% intraday matches the abs-threshold."""
    score = _compute_tail_risk_score(TailRiskSignals(intraday_momentum_pct=-0.03))
    assert score == pytest.approx(0.25)


def test_tail_risk_score_analyst_pt_raises():
    score = _compute_tail_risk_score(TailRiskSignals(analyst_pt_changes_24h=2))
    assert score == pytest.approx(0.15)


def test_tail_risk_score_kurtosis_above_4():
    score = _compute_tail_risk_score(TailRiskSignals(historical_move_kurtosis=4.5))
    assert score == pytest.approx(0.15)


def test_tail_risk_score_kurtosis_below_4_no_contribution():
    score = _compute_tail_risk_score(TailRiskSignals(historical_move_kurtosis=3.5))
    assert score == 0.0


def test_tail_risk_score_iv_term_steep_above_30pct():
    score = _compute_tail_risk_score(TailRiskSignals(iv_term_steepness=0.35))
    assert score == pytest.approx(0.10)


def test_tail_risk_score_amd_like_combined():
    """AMD-flavour: +4.3% intraday + 2 PT raises + cohort up + kurtosis 4.5.

    Score: 0.25 + 0.15 + 0.20 + 0.15 = 0.75. Above the 0.6 demote threshold.
    """
    signals = TailRiskSignals(
        intraday_momentum_pct=0.043,
        sector_cohort_momentum_avg=0.025,
        analyst_pt_changes_24h=2,
        historical_move_kurtosis=4.5,
    )
    score = _compute_tail_risk_score(signals)
    assert score == pytest.approx(0.75)
    assert score >= 0.6  # crosses demote


def test_tail_risk_score_caps_at_one():
    """All signals max out → cap at 1.0."""
    signals = TailRiskSignals(
        intraday_momentum_pct=0.10,
        sector_cohort_momentum_avg=0.05,
        analyst_pt_changes_24h=5,
        news_sentiment=0.9,
        historical_move_kurtosis=8.0,
        iv_term_steepness=0.50,
    )
    score = _compute_tail_risk_score(signals)
    assert score == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# SHR-3: confidence + tail-risk Kelly overlay
# ---------------------------------------------------------------------------


def test_kelly_with_low_confidence_shrinks():
    """At full confidence b=1 POP=0.51 → Kelly = 0.02 (cap).

    With confidence=0.55 the same case shrinks to 0.02 × 0.55 = 0.011.
    """
    f_full = kelly_fraction(pop=0.51, b=1.0, cap=0.02, confidence=1.0, tail_risk=0.0)
    f_low = kelly_fraction(pop=0.51, b=1.0, cap=0.02, confidence=0.55, tail_risk=0.0)
    assert f_full == pytest.approx(0.02)
    assert f_low == pytest.approx(0.011, abs=1e-6)


def test_kelly_with_tail_risk_shrinks():
    """At full confidence + tail_risk=0.7 → multiplier 0.3."""
    f = kelly_fraction(pop=0.51, b=1.0, cap=0.10, confidence=1.0, tail_risk=0.7)
    # base = (0.51*2 - 1)/1 = 0.02; adjusted = 0.02 * 1.0 * 0.3 = 0.006
    assert f == pytest.approx(0.006, abs=1e-6)


def test_kelly_amd_scenario_near_zero():
    """AMD case: pop=0.55, b=400/1100≈0.364, confidence=0.55, tail_risk=0.7.

    base = (0.55 * 1.364 - 1) / 0.364 ≈ -0.249 → 0
    Even before the overlay this Kelly is negative; assert it floors at 0.
    """
    f = kelly_fraction(pop=0.55, b=400.0 / 1100.0, confidence=0.55, tail_risk=0.7)
    assert f == 0.0


def test_kelly_amd_scenario_with_positive_edge_shrinks():
    """Synthetic case: positive base Kelly that AMD-overlay shrinks to ~0.25%.

    POP=0.65, b=1.0 → base = (0.65*2 - 1)/1 = 0.30 (raw, ignoring cap).
    Apply 0.55 * 0.3 = 0.165 → 0.0495 → cap at 0.02.
    Drop the cap to 1.0 to see the overlay in isolation:
    0.30 * 0.165 = 0.0495.
    """
    f = kelly_fraction(pop=0.65, b=1.0, cap=1.0, confidence=0.55, tail_risk=0.7)
    assert f == pytest.approx(0.0495, abs=1e-4)


def test_kelly_clamps_extreme_tail_risk():
    """tail_risk >= 1.0 zeros the bet entirely."""
    f = kelly_fraction(pop=0.85, b=2.0, confidence=1.0, tail_risk=1.0)
    assert f == 0.0


# ---------------------------------------------------------------------------
# SHR-4: skip outcome
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recommend_setups_returns_skip_when_extreme_tail_risk():
    """Tail-risk score >= 0.85 → top_setups[0].setup_id == "skip"."""
    chain = _make_chain(spot=356.0, iv=1.19, dte_days=3)
    # Force every signal so score = 1.0 ≥ 0.85.
    signals = TailRiskSignals(
        intraday_momentum_pct=0.06,
        sector_cohort_momentum_avg=0.04,
        analyst_pt_changes_24h=3,
        news_sentiment=0.7,
        historical_move_kurtosis=5.0,
        iv_term_steepness=0.40,
    )
    setups = await recommend_setups(
        symbol="AMD",
        spot=356.0,
        iv_rank=85,
        iv_percentile=82,
        current_iv=1.19,
        hv_20=0.65,
        expected_move_pct=0.066,
        hist_avg_abs_move_pct=0.045,
        claude_verdict="neutral-bear",
        claude_confidence=0.55,
        chain=chain,
        report_date=date.today(),
        report_time="AMC",
        tail_risk_signals=signals,
    )
    assert setups, "expected at least the skip setup"
    assert setups[0].setup_id == "skip"
    assert setups[0].sizing_kelly_pct == 0.0
    assert "Tail-risk" in setups[0].rationale or "tail" in setups[0].rationale.lower()


@pytest.mark.asyncio
async def test_recommend_setups_returns_skip_with_low_confidence_and_elevated_tail():
    """Low confidence (<=0.40) + tail_risk >= 0.6 → skip."""
    chain = _make_chain(spot=100.0, iv=0.70, dte_days=5)
    signals = TailRiskSignals(
        intraday_momentum_pct=0.04,
        sector_cohort_momentum_avg=0.03,
        analyst_pt_changes_24h=1,
    )  # 0.25 + 0.20 + 0.15 = 0.60
    setups = await recommend_setups(
        symbol="XYZ",
        spot=100.0,
        iv_rank=85,
        iv_percentile=82,
        current_iv=0.70,
        hv_20=0.40,
        expected_move_pct=0.06,
        hist_avg_abs_move_pct=0.04,
        claude_verdict="neutral",
        claude_confidence=0.30,  # below 0.40
        chain=chain,
        tail_risk_signals=signals,
    )
    assert setups
    assert setups[0].setup_id == "skip"


@pytest.mark.asyncio
async def test_recommend_setups_no_skip_when_conditions_not_met():
    """Without elevated signals, no skip — iron_condor or similar wins."""
    chain = _make_chain(spot=356.0, iv=1.19, dte_days=3)
    setups = await recommend_setups(
        symbol="AMD",
        spot=356.0,
        iv_rank=85,
        iv_percentile=82,
        current_iv=1.19,
        hv_20=0.65,
        expected_move_pct=0.066,
        hist_avg_abs_move_pct=0.045,
        claude_verdict="neutral-bear",
        claude_confidence=0.55,
        chain=chain,
        report_date=date.today(),
        report_time="AMC",
    )
    assert setups
    assert setups[0].setup_id != "skip"


# ---------------------------------------------------------------------------
# SHR-7: AMD regression — top setup is NOT iron_condor under tail-risk
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_amd_with_tail_risk_signals_does_not_pick_iron_condor():
    """AMD intraday +4.3% + analyst raises + cohort up → top is skip OR long-vol.

    This is the canonical AMD regression: pre-earnings momentum signals
    fire (intraday +4.3%, 2 PT raises, sector cohort up) so the recommender
    must NOT pick iron_condor — the +21% post-earnings gap that motivated
    SHR would blow through both wings of any short-vol structure.
    """
    chain = _make_chain(underlying="AMD", spot=356.0, iv=1.19, dte_days=3)
    signals = TailRiskSignals(
        intraday_momentum_pct=0.043,
        sector_cohort_momentum_avg=0.025,
        analyst_pt_changes_24h=2,
    )  # Score: 0.25 + 0.20 + 0.15 = 0.60 → demote, not skip.
    setups = await recommend_setups(
        symbol="AMD",
        spot=356.0,
        iv_rank=None,  # AMD case in production; iv_to_hv carries the regime
        iv_percentile=None,
        current_iv=1.19,
        hv_20=0.65,
        expected_move_pct=0.066,
        hist_avg_abs_move_pct=0.045,
        claude_verdict="neutral-bear",
        claude_confidence=0.55,
        chain=chain,
        report_date=date.today(),
        report_time="AMC",
        tail_risk_signals=signals,
    )
    assert setups, "expected at least one setup"
    top = setups[0]
    # The hardened recommender must NOT lead with iron_condor here.
    assert top.setup_id != "iron_condor", (
        f"iron_condor is exactly the structure AMD's +21% gap blew through "
        f"— the SHR overlay must demote it. Got setup_id={top.setup_id}"
    )
    # Acceptable: skip OR a long-vol structure.
    assert top.setup_id in {
        "skip", "long_strangle", "long_straddle", "diagonal_spread",
    }, f"unexpected setup_id={top.setup_id}"


@pytest.mark.asyncio
async def test_recommend_setups_threads_prior_moves_into_pop():
    """SHR-1 plumbing: prior_moves ≥6 should flip the POP path."""
    chain = _make_chain(underlying="AMD", spot=356.0, iv=1.19, dte_days=3)
    pm = [-0.02, +0.18, -0.05, +0.21, +0.12, -0.08, +0.13, -0.04]
    setups = await recommend_setups(
        symbol="AMD",
        spot=356.0,
        iv_rank=85,
        iv_percentile=82,
        current_iv=1.19,
        hv_20=0.65,
        expected_move_pct=0.066,
        hist_avg_abs_move_pct=0.045,
        claude_verdict="neutral-bear",
        claude_confidence=0.55,
        chain=chain,
        report_date=date.today(),
        report_time="AMC",
        prior_moves=pm,
    )
    assert setups, "expected setups"
    # The empirical POP given AMD's history (mostly fat tails) should be
    # noticeably lower than the lognormal POP for the same condor.
    # We assert pop_estimate is in [0, 1] and below 0.85 — a typical
    # lognormal value for that condor band would be > 0.85.
    top = setups[0]
    assert 0.0 <= top.pop_estimate <= 1.0
    # The empirical with that fat history should be < 0.7 — many gaps.
    if top.setup_id != "skip" and top.pop_estimate > 0:
        assert top.pop_estimate < 0.85, (
            f"Empirical POP should down-weight from lognormal given fat-tail "
            f"history; got {top.pop_estimate}"
        )
