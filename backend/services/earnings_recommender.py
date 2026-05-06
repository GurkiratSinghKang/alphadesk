"""Earnings recommendation engine v2 — Wave 4a / Batch Q + SHR hardening.

The legacy ``top_setup`` field on each calendar row was a single string
mapped from Claude's verdict (e.g. ``neutral-bear`` → ``"bear call
spread"``). The mapping was vol-blind: for AMD with IV 119% and HV20
65% (a 1.83x premium) the right structure is a **defined-risk short
premium** (iron condor), not a directional bear call spread.

This module replaces the deterministic verdict→string mapper with a
ranked top-3 list of :class:`EarningsSetup` objects. Each setup carries
the full leg structure, max profit/loss, breakevens, expected value,
and Kelly sizing so the analyst can audit the recommendation.

Decision flow:

  1. Classify the regime from IV rank, IV/HV ratio, and Claude bias.
     :func:`_classify_regime` returns one of:
       * ``rich_neutral``     — high IV, ≤0.15 bias → iron condor / strangle
       * ``rich_directional`` — high IV, ≥0.15 bias → credit spread in dir.
       * ``cheap_directional``— low IV,  ≥0.15 bias → debit spread / long
       * ``cheap_neutral``    — low IV,  ≤0.15 bias → calendar (long vol)
       * ``mixed``            — neither regime — balanced credit spread

  2. For each candidate setup in the regime, build the legs from the
     event-spanning expiry of the chain.

  3. Compute net credit/debit, max profit, max loss, breakevens,
     probability of profit (lognormal OR empirical), and expected value.

  4. Apply tail-risk overlay (SHR-2): when auxiliary momentum / sentiment
     signals indicate elevated tail risk, halve the EV of short-vol
     setups and add long-vol candidates.

  5. Rank by EV (or Sharpe-like ratio for unlimited-loss setups) and
     return the top 3. If all candidate EVs are negative (or tail-risk +
     low-confidence trips the skip threshold), return a synthetic
     ``setup_id="skip"`` setup at index 0 (SHR-4).

POP estimation (SHR-1): when the symbol has ≥6 prior post-earnings
moves, use the empirical distribution — count the fraction of historical
moves that would land between the breakevens. Falls back to the
lognormal terminal-distribution model otherwise.

Kelly sizing (SHR-3) is the classic ``f* = (p(b+1) - 1) / b`` scaled by
``confidence × (1 - tail_risk)`` and capped at 2% of book.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Iterable, Sequence

from scipy.stats import norm  # type: ignore[import-untyped]

from api.schemas.earnings import EarningsSetup, OptionLeg, SetupId, TailRiskSignals

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers — chain access (defensive against the OptionContract shape)
# ---------------------------------------------------------------------------


def _option_mid(contract: Any) -> float:
    """Best usable mid for a single option contract.

    Mirrors :func:`services.earnings_screener._option_mid` so the
    recommender does not import private helpers from the screener.
    """
    if contract is None:
        return 0.0
    try:
        bid = float(getattr(contract, "bid", 0) or 0)
        ask = float(getattr(contract, "ask", 0) or 0)
        last = float(getattr(contract, "last", 0) or 0)
    except (TypeError, ValueError):
        return 0.0
    if bid > 0 and ask > 0:
        return (bid + ask) / 2
    if bid > 0:
        return bid
    if ask > 0:
        return ask
    return last if last > 0 else 0.0


def _contract_type_value(contract: Any) -> str:
    """Normalise OptionContract.option_type to a ``"call" | "put"`` string."""
    raw = getattr(contract, "option_type", None)
    return getattr(raw, "value", raw) or ""


def _contract_expiry(contract: Any, fallback: date | None) -> date:
    expiry = getattr(contract, "expiry", None)
    if isinstance(expiry, date):
        return expiry
    if isinstance(expiry, str):
        try:
            return date.fromisoformat(expiry)
        except ValueError:
            pass
    if fallback is not None:
        return fallback
    return date.today()


def _filter_by_expiry_and_type(
    chain: Any, expiry: date | None, option_type: str,
) -> list[Any]:
    """Pull contracts for a specific expiry + option_type."""
    contracts = list(getattr(chain, "contracts", []) or [])
    out: list[Any] = []
    for c in contracts:
        if _contract_type_value(c) != option_type:
            continue
        if expiry is not None:
            c_expiry = getattr(c, "expiry", None)
            # Treat doubles without expiry as matching (test ergonomics).
            if c_expiry is not None and c_expiry != expiry:
                continue
        out.append(c)
    return out


def _find_contract_for_leg(chain, leg):
    """Wave V V5: locate the chain contract that backs a built OptionLeg."""
    try:
        option_type = getattr(leg, "contract_type", None)
        target_strike = float(getattr(leg, "strike"))
        leg_expiry = getattr(leg, "expiry", None)
    except (AttributeError, TypeError, ValueError):
        return None
    if option_type is None:
        return None
    expiry = leg_expiry if isinstance(leg_expiry, date) else None
    candidates = _filter_by_expiry_and_type(chain, expiry, str(option_type))
    if not candidates:
        candidates = _filter_by_expiry_and_type(chain, None, str(option_type))
    if not candidates:
        return None
    best = min(
        candidates,
        key=lambda c: abs(float(getattr(c, "strike", 0.0)) - target_strike),
    )
    if abs(float(getattr(best, "strike", 0.0)) - target_strike) > 0.01:
        return None
    return best


def _build_fill_forecast_for_setup(setup, chain):
    """Wave V V5: compute ComboFillForecast for an existing setup. Never raises."""
    try:
        from services.slippage_forecast import (
            OptionLegWithMarks,
            forecast_combo_fill,
        )
    except Exception:
        return None
    legs = getattr(setup, "legs", None)
    if not legs:
        return None
    forecaster_legs = []
    for leg in legs:
        contract = _find_contract_for_leg(chain, leg)
        if contract is None:
            return None
        try:
            bid = float(getattr(contract, "bid", 0) or 0)
            ask = float(getattr(contract, "ask", 0) or 0)
            mid = float(getattr(leg, "mid"))
            qty = int(getattr(leg, "qty", 1) or 1)
            side = str(getattr(leg, "side"))
        except (TypeError, ValueError, AttributeError):
            return None
        score_raw = getattr(contract, "liquidity_score", None)
        try:
            score = float(score_raw) if score_raw is not None else None
            if score is not None:
                score = max(0.0, min(1.0, score))
        except (TypeError, ValueError):
            score = None
        forecaster_legs.append(
            OptionLegWithMarks(
                side=side,
                bid=bid,
                ask=ask,
                mid=mid,
                liquidity_score=score,
                qty=qty,
            ),
        )
    try:
        return forecast_combo_fill(forecaster_legs, fill_mode="patient")
    except Exception as e:
        log.debug("slippage forecaster failed: %s", e)
        return None


def _attach_fill_forecast(setup, chain):
    """Wave V V5: attach slippage forecast, never failing."""
    forecast = _build_fill_forecast_for_setup(setup, chain)
    if forecast is None:
        return setup
    return setup.model_copy(update={"fill_forecast": forecast})


def _expirations_sorted(chain: Any) -> list[date]:
    raw = list(getattr(chain, "expirations", []) or [])
    parsed: list[date] = []
    for exp in raw:
        if isinstance(exp, date):
            parsed.append(exp)
        elif isinstance(exp, str):
            try:
                parsed.append(date.fromisoformat(exp))
            except ValueError:
                continue
    return sorted(set(parsed))


def nearest_event_spanning_expiry(
    chain: Any, *, report_date: date | None = None, report_time: str | None = None,
) -> date | None:
    """Pick the option expiry that captures the earnings event.

    AMC reports print after same-day options expire, so the first usable
    expiry is strictly after the report date. BMO/DMT events can be
    captured by a same-day expiry if it exists.
    """
    expirations = _expirations_sorted(chain)
    if not expirations:
        return None
    if report_date is None:
        return expirations[0]
    from datetime import timedelta as _td

    floor = report_date + _td(days=1) if (report_time or "").upper() == "AMC" else report_date
    for exp in expirations:
        if exp >= floor:
            return exp
    return expirations[-1]


def _normalise_oi(open_interest: float | int | None) -> float:
    """Wave V V4 — piecewise-linear OI normalisation: 0 → 0.0, 200 → 0.5, ≥1000 → 1.0."""
    if open_interest is None:
        return 0.0
    try:
        oi = float(open_interest)
    except (TypeError, ValueError):
        return 0.0
    if oi <= 0:
        return 0.0
    if oi >= 1000.0:
        return 1.0
    if oi >= 200.0:
        return 0.5 + 0.5 * (oi - 200.0) / 800.0
    return 0.5 * oi / 200.0


def _normalise_volume(volume: float | int | None) -> float:
    """Wave V V4 — piecewise-linear volume normalisation: 0 → 0.0, 50 → 0.5, ≥200 → 1.0."""
    if volume is None:
        return 0.0
    try:
        v = float(volume)
    except (TypeError, ValueError):
        return 0.0
    if v <= 0:
        return 0.0
    if v >= 200.0:
        return 1.0
    if v >= 50.0:
        return 0.5 + 0.5 * (v - 50.0) / 150.0
    return 0.5 * v / 50.0


def _strike_preference_score(
    contract: Any, target_delta: float, tolerance: float,
) -> float:
    """Wave V V4 — score for picking among delta-acceptable strikes. Higher is better.

    Components: closeness-to-target-delta + normalised OI + normalised volume.
    Default weights: 50% / 30% / 20%, tunable via Settings. Returns score in [0, 1].
    Returns 0.0 for contracts without a delta (defensive fallback).
    """
    from core.config import settings as _settings

    raw_delta = getattr(contract, "delta", None)
    if raw_delta is None:
        return 0.0
    try:
        delta_dev = abs(abs(float(raw_delta)) - abs(target_delta))
    except (TypeError, ValueError):
        return 0.0

    if tolerance <= 0:
        delta_close = 1.0 if delta_dev == 0.0 else 0.0
    else:
        delta_close = max(0.0, 1.0 - (delta_dev / tolerance))

    oi_weight = float(_settings.RECOMMENDER_PREFER_HIGH_OI_WEIGHT)
    vol_weight = float(_settings.RECOMMENDER_PREFER_HIGH_VOLUME_WEIGHT)
    delta_weight = max(0.0, 1.0 - oi_weight - vol_weight)

    oi_norm = _normalise_oi(getattr(contract, "open_interest", None))
    vol_norm = _normalise_volume(getattr(contract, "volume", None))

    return (
        delta_close * delta_weight
        + oi_norm * oi_weight
        + vol_norm * vol_weight
    )


def find_strike_by_delta(
    chain: Any, expiry: date | None, option_type: str, target_delta: float,
) -> Any | None:
    """Pick the best contract for ``target_delta``. Wave V V4: prefer high-OI.

    Among "delta-acceptable" candidates (within ``RECOMMENDER_DELTA_TOLERANCE``,
    default ±0.03 of target), pick the highest :func:`_strike_preference_score`
    (delta-closeness 50% + OI 30% + volume 20%, weights tunable). Score
    ties break by delta-closeness so the legacy delta-only behaviour wins
    when OI/volume don't differentiate. If no candidate falls within
    tolerance, fall back to the legacy delta-only selection.

    Composes with Wave V Agent 2's liquidity gating: gating runs first
    in the picker pipeline; among strikes that pass, V4 picks the one
    with the most established OI. Pre-Wave-V chains without
    ``open_interest`` / ``volume`` fields degenerate to delta-closest.
    """
    from core.config import settings as _settings

    contracts = _filter_by_expiry_and_type(chain, expiry, option_type)
    if not contracts:
        return None

    target_abs = abs(target_delta)
    tolerance = float(_settings.RECOMMENDER_DELTA_TOLERANCE)

    def _delta_dev(c: Any) -> float:
        d = getattr(c, "delta", None)
        if d is None:
            return float("inf")
        return abs(abs(float(d)) - target_abs)

    within: list[Any] = [c for c in contracts if _delta_dev(c) <= tolerance]

    if within:
        return max(
            within,
            key=lambda c: (
                _strike_preference_score(c, target_delta, tolerance),
                -_delta_dev(c),
            ),
        )

    return min(contracts, key=_delta_dev)


def find_strike_nearest(
    chain: Any, expiry: date | None, option_type: str, target_strike: float,
) -> Any | None:
    """Pick the contract with strike closest to ``target_strike``."""
    contracts = _filter_by_expiry_and_type(chain, expiry, option_type)
    if not contracts:
        return None
    return min(contracts, key=lambda c: abs(float(c.strike) - target_strike))


# ---------------------------------------------------------------------------
# Liquidity gating (Wave V — V2)
# ---------------------------------------------------------------------------
#
# The V4 picker above selects on delta + OI/volume preference. It does
# not gate on Wave V Agent 1's per-contract ``liquidity_score`` (a 0..1
# composite of volume, OI, volume/OI ratio, and bid/ask spread). Earnings
# chains routinely have a wing strike with volume=2 / OI=15 — the bid/ask
# is wide, the fill is uncertain, and the recommender just told the
# analyst to buy it. The walk-search below reads ``liquidity_score``
# defensively: if the field is missing (Agent 1 hasn't shipped, demo
# fixture, older cached chain) it behaves identically to the V4 picker.


def _contract_liquidity_score(contract: Any) -> float | None:
    """Read ``liquidity_score`` off a contract, returning None when absent."""
    score = getattr(contract, "liquidity_score", None)
    if score is None:
        return None
    try:
        f = float(score)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, f))


def find_liquid_strike_by_delta(
    chain: Any,
    expiry: date | None,
    side: str,
    target_delta: float,
    min_liquidity_score: float | None = None,
    max_strikes_to_search: int | None = None,
) -> tuple[Any | None, bool]:
    """Find the contract closest to target delta with liquidity score >= threshold.

    Walks +/- ``max_strikes_to_search`` from the V4 best-delta match.
    Returns ``(contract, liquidity_warning)``. When the chain has no
    ``liquidity_score`` field at all, behaves identically to the V4
    delta picker (graceful degradation).

    The "delta-slack" rule lets the walk pick a slightly worse delta in
    exchange for real liquidity, but rejects substituting a deep ITM/OTM
    contract for the analyst's risk choice (a 0.05Δ in place of 0.20Δ).
    """
    from core.config import settings as _settings

    if min_liquidity_score is None:
        min_liquidity_score = _settings.RECOMMENDER_MIN_LEG_LIQUIDITY_SCORE
    if max_strikes_to_search is None:
        max_strikes_to_search = getattr(
            _settings, "RECOMMENDER_LIQUIDITY_WALK_MAX_STRIKES",
            getattr(_settings, "RECOMMENDER_LIQUIDITY_WALK_DISTANCE", 2),
        )

    contracts = _filter_by_expiry_and_type(chain, expiry, side)
    if not contracts:
        return None, False
    target_abs = abs(target_delta)

    def _delta_distance(c: Any) -> float:
        d = getattr(c, "delta", None)
        if d is None:
            return float("inf")
        return abs(abs(float(d)) - target_abs)

    best = find_strike_by_delta(chain, expiry, side, target_delta)
    if best is None:
        return None, False

    chain_has_liquidity = any(
        _contract_liquidity_score(c) is not None for c in contracts
    )
    if not chain_has_liquidity:
        return best, False

    best_score = _contract_liquidity_score(best)
    if best_score is not None and best_score >= min_liquidity_score:
        return best, False

    contracts_by_strike = sorted(contracts, key=lambda c: (float(c.strike), id(c)))
    try:
        best_idx = contracts_by_strike.index(best)
    except ValueError:
        best_idx = 0
    lo = max(0, best_idx - max_strikes_to_search)
    hi = min(len(contracts_by_strike) - 1, best_idx + max_strikes_to_search)
    window = contracts_by_strike[lo : hi + 1]

    best_delta_dist = _delta_distance(best)
    delta_slack = 0.5 * max(target_abs, 0.05)

    qualifying: list[Any] = []
    for c in window:
        score = _contract_liquidity_score(c)
        if score is None:
            continue
        if score < min_liquidity_score:
            continue
        if _delta_distance(c) > best_delta_dist + delta_slack:
            continue
        qualifying.append(c)

    if qualifying:
        return min(qualifying, key=_delta_distance), False

    return best, True


def _legs_worst_liquidity(contracts: Iterable[Any]) -> float | None:
    """Worst (minimum) liquidity_score across an iterable of contracts.

    Returns None when ANY leg lacks a score (graceful degradation —
    treat "no opinion" instead of "illiquid").
    """
    scores: list[float] = []
    for c in contracts:
        s = _contract_liquidity_score(c)
        if s is None:
            return None
        scores.append(s)
    if not scores:
        return None
    return float(min(scores))


def _liquidity_label(score: float) -> str:
    """Coarse human-readable label for a 0..1 liquidity score."""
    if score >= 0.6:
        return "GOOD"
    if score >= 0.3:
        return "OK"
    return "POOR"


# ---------------------------------------------------------------------------
# DTE / confidence / IV-aware delta selection (Batch M-O — strike-tuning ST)
# ---------------------------------------------------------------------------
#
# Hardcoded delta defaults (e.g. 0.20Δ shorts on every iron condor) ignore
# the regime they're trading into. TastyTrade Research / Sosnoff-Battista
# backtests show win-rate × avg-credit on 7-DTE earnings condors peaks at
# 0.16Δ shorts; on long-dated 35+ DTE 0.25Δ holds up; tighter butterfly
# wings (5 strikes) beat wider (10) on Sharpe; low-conviction directional
# spreads do better at 0.20Δ short than 0.30Δ.
#
# The selectors below pick a delta target from three independent inputs:
#   1. DTE bucket — earnings (≤10), standard (≤35), long-dated (>35)
#   2. Claude confidence — low (<0.55) widens, high (≥0.75) restores baseline
#   3. IV rank — rich (>80) tightens slightly, cheap (<30) widens
#
# Adjustments compose multiplicatively. All thresholds and factors live in
# Settings so an analyst can tune without a code deploy.


def _select_short_delta_for_iron_condor(
    dte_days: int | float,
    *,
    claude_confidence: float | None = None,
    iv_rank: float | None = None,
) -> float:
    """DTE / confidence / IV-aware short-leg delta for iron condors.

    Bands (defaults, override via Settings):
      * Earnings (DTE ≤ 10): 0.16 — tighter for higher win rate on 7-DTE
        earnings plays per TastyTrade backtests
      * Standard (10 < DTE ≤ 35): 0.20 — balanced default
      * Long-dated (DTE > 35): 0.25 — wider for more credit when theta
        decay window is long enough to absorb wider losses

    Adjustments:
      * Confidence < ``RECOMMENDER_LOW_CONFIDENCE_THRESHOLD`` (default 0.55):
        multiply by ``RECOMMENDER_LOW_CONFIDENCE_DELTA_WIDEN_FACTOR`` (0.7)
        → 0.20 * 0.7 = 0.14 short. More cushion at the cost of less credit.
      * IV rank > ``RECOMMENDER_IV_RANK_HIGH_THRESHOLD`` (default 80):
        multiply by ``RECOMMENDER_HIGH_IV_DELTA_TIGHTEN_FACTOR`` (1.10) —
        IV crush bonus offsets some upside loss.
      * IV rank < ``RECOMMENDER_IV_RANK_LOW_THRESHOLD`` (default 30):
        multiply by ``RECOMMENDER_LOW_IV_DELTA_WIDEN_FACTOR`` (0.85) —
        thin credit, prefer wider strikes (or skip credit setup entirely).
    """
    from core.config import settings as _settings

    if dte_days <= _settings.RECOMMENDER_DTE_EARNINGS_MAX:
        delta = _settings.RECOMMENDER_IRON_CONDOR_SHORT_DELTA_EARNINGS
    elif dte_days <= _settings.RECOMMENDER_DTE_STANDARD_MAX:
        delta = _settings.RECOMMENDER_IRON_CONDOR_SHORT_DELTA_STANDARD
    else:
        delta = _settings.RECOMMENDER_IRON_CONDOR_SHORT_DELTA_LONG_DATED

    if (
        claude_confidence is not None
        and float(claude_confidence) < _settings.RECOMMENDER_LOW_CONFIDENCE_THRESHOLD
    ):
        delta *= _settings.RECOMMENDER_LOW_CONFIDENCE_DELTA_WIDEN_FACTOR

    if iv_rank is not None:
        rank = float(iv_rank)
        if rank > _settings.RECOMMENDER_IV_RANK_HIGH_THRESHOLD:
            delta *= _settings.RECOMMENDER_HIGH_IV_DELTA_TIGHTEN_FACTOR
        elif rank < _settings.RECOMMENDER_IV_RANK_LOW_THRESHOLD:
            delta *= _settings.RECOMMENDER_LOW_IV_DELTA_WIDEN_FACTOR

    return float(delta)


def _select_long_delta_for_iron_condor(
    dte_days: int | float,
    *,
    claude_confidence: float | None = None,
    iv_rank: float | None = None,
) -> float:
    """Long-wing delta for iron condors. Tracks the short selector at half
    the magnitude so the wing/short ratio is preserved across regimes.

    Bands (defaults, override via Settings):
      * Earnings: 0.08
      * Standard: 0.10
      * Long-dated: 0.12
    """
    from core.config import settings as _settings

    if dte_days <= _settings.RECOMMENDER_DTE_EARNINGS_MAX:
        delta = _settings.RECOMMENDER_IRON_CONDOR_LONG_DELTA_EARNINGS
    elif dte_days <= _settings.RECOMMENDER_DTE_STANDARD_MAX:
        delta = _settings.RECOMMENDER_IRON_CONDOR_LONG_DELTA_STANDARD
    else:
        delta = _settings.RECOMMENDER_IRON_CONDOR_LONG_DELTA_LONG_DATED

    if (
        claude_confidence is not None
        and float(claude_confidence) < _settings.RECOMMENDER_LOW_CONFIDENCE_THRESHOLD
    ):
        delta *= _settings.RECOMMENDER_LOW_CONFIDENCE_DELTA_WIDEN_FACTOR

    if iv_rank is not None:
        rank = float(iv_rank)
        if rank > _settings.RECOMMENDER_IV_RANK_HIGH_THRESHOLD:
            delta *= _settings.RECOMMENDER_HIGH_IV_DELTA_TIGHTEN_FACTOR
        elif rank < _settings.RECOMMENDER_IV_RANK_LOW_THRESHOLD:
            delta *= _settings.RECOMMENDER_LOW_IV_DELTA_WIDEN_FACTOR

    return float(delta)


def _select_vertical_short_delta(
    dte_days: int | float,
    *,
    claude_confidence: float | None = None,
    iv_rank: float | None = None,
) -> float:
    """Short-leg delta for credit verticals (bear-call / bull-put).

    Defaults to 0.30Δ short when confidence is high (the historical
    default in this module). Below the low-confidence threshold the
    short widens to 0.20Δ — the TastyTrade research finds that low-
    conviction directional spreads beat 0.30Δ on Sharpe at 0.20Δ.
    """
    from core.config import settings as _settings

    # Standard credit-spread default; mirrors the legacy hardcoded 0.30Δ.
    delta = 0.30
    if (
        claude_confidence is not None
        and float(claude_confidence) < _settings.RECOMMENDER_LOW_CONFIDENCE_THRESHOLD
    ):
        # Drop straight to 0.20Δ rather than apply the widen factor —
        # the research result is empirical, not a multiplicative tweak.
        delta = 0.20

    if iv_rank is not None:
        rank = float(iv_rank)
        if rank > _settings.RECOMMENDER_IV_RANK_HIGH_THRESHOLD:
            delta *= _settings.RECOMMENDER_HIGH_IV_DELTA_TIGHTEN_FACTOR
        elif rank < _settings.RECOMMENDER_IV_RANK_LOW_THRESHOLD:
            delta *= _settings.RECOMMENDER_LOW_IV_DELTA_WIDEN_FACTOR

    return float(delta)


def _select_vertical_long_delta(
    dte_days: int | float,
    *,
    claude_confidence: float | None = None,
    iv_rank: float | None = None,
) -> float:
    """Long-leg delta for credit verticals — half the short delta so width
    scales with the short selection."""
    return _select_vertical_short_delta(
        dte_days,
        claude_confidence=claude_confidence,
        iv_rank=iv_rank,
    ) / 2.0


def _should_avoid_iron_butterfly(claude_confidence: float | None) -> bool:
    """Iron butterflies pin-bet on a tight ATM range — they require high
    conviction. Below the low-confidence threshold we suppress the
    candidate so the recommender doesn't lead with a structure the
    analyst hasn't earned the right to trade.
    """
    if claude_confidence is None:
        return False
    from core.config import settings as _settings

    return float(claude_confidence) < _settings.RECOMMENDER_LOW_CONFIDENCE_THRESHOLD


def _butterfly_wing_em_factor(
    dte_days: int | float,
    *,
    iv_rank: float | None = None,
) -> float:
    """Multiplier on expected-move dollars for iron butterfly wings.

    Tighter wings (5 strikes vs 10) beat wider on Sharpe per the research.
    For sub-7-DTE earnings butterflies we drop to 0.6× the implied move;
    standard plays use 1.0×. High IV-rank tightens further (the crush
    bonus offsets the narrower band).
    """
    from core.config import settings as _settings

    if dte_days <= _settings.RECOMMENDER_DTE_EARNINGS_MAX:
        factor = 0.6
    else:
        factor = 1.0
    if iv_rank is not None and float(iv_rank) > _settings.RECOMMENDER_IV_RANK_HIGH_THRESHOLD:
        factor *= 0.85
    return factor


# ---------------------------------------------------------------------------
# Probability of profit (lognormal terminal distribution)
# ---------------------------------------------------------------------------


def _lognormal_pop(
    spot: float,
    breakevens: Sequence[float],
    iv: float,
    dte_days: float,
    profitable_zone: str,
) -> float:
    """POP under the simple lognormal terminal-distribution model.

    Zero-drift since r·τ ≈ 0 for event-driven horizons.
    """
    if iv <= 0 or dte_days <= 0 or spot <= 0 or not breakevens:
        return 0.0
    sigma = iv * math.sqrt(dte_days / 365.0)
    if sigma <= 0:
        return 0.0
    sorted_be = sorted(float(b) for b in breakevens if b is not None and b > 0)
    if not sorted_be:
        return 0.0
    z = [math.log(b / spot) / sigma for b in sorted_be]

    if profitable_zone == "between":
        if len(z) < 2:
            return 0.0
        return float(norm.cdf(z[1]) - norm.cdf(z[0]))
    if profitable_zone == "outside":
        if len(z) < 2:
            return 0.0
        return float(norm.cdf(z[0]) + (1.0 - norm.cdf(z[1])))
    if profitable_zone == "below_lower":
        return float(norm.cdf(z[0]))
    if profitable_zone == "above_upper":
        return float(1.0 - norm.cdf(z[-1]))
    return 0.0


def _empirical_pop(
    spot: float,
    breakevens: Sequence[float],
    prior_moves: Sequence[float],
    profitable_zone: str,
) -> float:
    """SHR-1: POP from the symbol's own historical post-earnings moves.

    Project where spot would land for each historical move
    (``projected_spot = spot * (1 + move_pct)``), then count what
    fraction of projections fall in the profitable zone. This captures
    fat tails the lognormal model systematically underweights — the
    AMD case (post-earnings +21% gap) is exactly the scenario the
    lognormal underestimates.
    """
    if spot <= 0 or not prior_moves or not breakevens:
        return 0.0
    sorted_be = sorted(float(b) for b in breakevens if b is not None and b > 0)
    if not sorted_be:
        return 0.0

    projected = [spot * (1.0 + float(m)) for m in prior_moves if m is not None]
    if not projected:
        return 0.0

    def _wins(price: float) -> bool:
        if profitable_zone == "between":
            if len(sorted_be) < 2:
                return False
            return sorted_be[0] <= price <= sorted_be[1]
        if profitable_zone == "outside":
            if len(sorted_be) < 2:
                return False
            return price < sorted_be[0] or price > sorted_be[1]
        if profitable_zone == "below_lower":
            return price <= sorted_be[0]
        if profitable_zone == "above_upper":
            return price >= sorted_be[-1]
        return False

    wins = sum(1 for p in projected if _wins(p))
    return wins / len(projected)


def compute_pop(
    spot: float,
    breakevens: Sequence[float],
    iv: float,
    dte_days: float,
    profitable_zone: str,
    prior_moves: Sequence[float] | None = None,
) -> float:
    """Probability that the underlying ends in the profitable zone.

    SHR-1: when ``prior_moves`` has ≥6 observations, use the empirical
    distribution from the symbol's own history (captures fat tails).
    Falls through to the lognormal model otherwise.

    Parameters
    ----------
    spot : float
        Underlying price now.
    breakevens : Sequence[float]
        Breakeven prices (1 for single-sided, 2 for two-sided).
    iv : float
        Annualised implied volatility.
    dte_days : float
        Calendar days to expiration.
    profitable_zone : {"between", "below_lower", "above_upper", "outside"}
        Which side of the breakevens generates profit.
    prior_moves : Sequence[float] | None
        Historical post-earnings move percentages (e.g.
        ``[-0.02, +0.18, -0.05, +0.21, ...]``). When at least 6 moves
        are present we switch from lognormal to empirical POP.

    Returns
    -------
    float in [0, 1]
    """
    if prior_moves is not None and len(prior_moves) >= 6:
        return _empirical_pop(spot, breakevens, prior_moves, profitable_zone)
    return _lognormal_pop(spot, breakevens, iv, dte_days, profitable_zone)


# ---------------------------------------------------------------------------
# Kelly sizing
# ---------------------------------------------------------------------------


def kelly_fraction(
    pop: float,
    b: float,
    cap: float = 0.02,
    confidence: float = 1.0,
    tail_risk: float = 0.0,
) -> float:
    """Kelly-criterion bet fraction with confidence and tail-risk overlays.

    Base formula: ``f* = (p(b+1) - 1) / b`` where ``b = max_profit /
    max_loss``. SHR-3 multiplies the result by ``confidence × (1 -
    tail_risk)`` so:

      * Low Claude confidence (0.55) shrinks position by ~45%.
      * High tail-risk (0.7) shrinks position by another 70%.

    Capped at 2% of book — full Kelly assumes infinite trials and a
    stable edge, neither of which holds for one-shot earnings plays.

    For AMD's case (confidence=0.55, tail_risk=0.7) the multiplier is
    0.55 × 0.3 = 0.165, so a base 1.5% Kelly becomes ≈0.25% — a near-zero
    position rather than a full 2% bet on a fat-tailed name.
    """
    if b <= 0 or pop <= 0 or pop >= 1:
        return 0.0
    base = (pop * (b + 1.0) - 1.0) / b
    if base <= 0:
        return 0.0
    conf = max(0.0, min(1.0, float(confidence)))
    tr = max(0.0, min(1.0, float(tail_risk)))
    adjusted = base * conf * (1.0 - tr)
    return float(max(0.0, min(adjusted, cap)))


# ---------------------------------------------------------------------------
# Tail-risk overlay (SHR-2)
# ---------------------------------------------------------------------------


# Setups that profit from vol crush / range-bound terminal — tail risk
# in the underlying is the worst case for these. When tail risk is
# elevated we halve their EV (SHR-2).
_SHORT_VOL_SETUPS: frozenset[str] = frozenset(
    {"iron_condor", "iron_butterfly", "short_strangle", "short_straddle"}
)


def _compute_tail_risk_score(signals: TailRiskSignals) -> float:
    """SHR-2: 0..1 score from auxiliary momentum / sentiment signals.

    Above 0.6 we demote short-vol setups (halve EV); above 0.85 (or
    above 0.6 with low confidence) the recommender returns ``"skip"``.

    Each signal contributes a small fixed weight when present and
    extreme. Weights sum to 1.0 when every signal screams. ``None``
    signals contribute 0 (graceful degradation when an upstream is
    unavailable).
    """
    score = 0.0
    # Intraday move INTO the event (today's session). >2.5% in either
    # direction means the market is already pricing in something — short
    # vol on top of that is asymmetric risk.
    if signals.intraday_momentum_pct is not None and abs(
        float(signals.intraday_momentum_pct)
    ) > 0.025:
        score += 0.25
    # Sector cohort (related tickers) all up — momentum bleeds across
    # cohort boundaries; AI-semi names move together.
    if (
        signals.sector_cohort_momentum_avg is not None
        and float(signals.sector_cohort_momentum_avg) > 0.02
    ):
        score += 0.20
    # Net analyst PT raises in last 24h — institutions positioning.
    if signals.analyst_pt_changes_24h > 0:
        score += 0.15
    # Bullish news sentiment adds upside-tail risk for short-call wings.
    if (
        signals.news_sentiment is not None
        and float(signals.news_sentiment) > 0.5
    ):
        score += 0.15
    # Historical kurtosis > 4 = fat tails by sample (lognormal kurtosis
    # is ~3 for σ→0 and grows with σ; 4 is "fatter than basic lognormal").
    if (
        signals.historical_move_kurtosis is not None
        and float(signals.historical_move_kurtosis) > 4.0
    ):
        score += 0.15
    # IV term steep = front-month event premium > 30% above back-month.
    # That is the market sizing the event large relative to a baseline.
    if (
        signals.iv_term_steepness is not None
        and float(signals.iv_term_steepness) > 0.30
    ):
        score += 0.10
    # Wave V V3: underlying volume above 1.5× ADV = institutional flow.
    # Real money behind the move makes it more likely to extend through
    # the print and pierce short-vol wings.
    if (
        signals.underlying_relative_volume is not None
        and float(signals.underlying_relative_volume) > 1.5
    ):
        score += 0.10
    # Wave V V3: options call/put skew. Strong skew in either direction
    # is options players signalling directional conviction the verdict
    # / IV term may not have priced in — both upside (>2.0) and downside
    # (<0.5) cases are tail-risk for the opposite-side short wing.
    if signals.options_call_put_volume_skew is not None:
        skew = float(signals.options_call_put_volume_skew)
        if skew > 2.0 or skew < 0.5:
            score += 0.10
    # Wave V V3: unusual options activity = total chain volume > 3× the
    # rolling 20-day average. Information-flow signal — someone is
    # positioning aggressively; direction sorts itself out via the
    # call/put skew above.
    if signals.unusual_options_activity:
        score += 0.10
    # New max is ≥ 1.0 across all signals; min(1.0, score) clamps so the
    # downstream demote (>=0.6) / skip (>=0.85) thresholds keep working
    # without recalibration.
    return float(min(1.0, max(0.0, score)))


def _tail_risk_reasons(signals: TailRiskSignals) -> list[str]:
    """Human-readable explanations for which signals fired (SHR-6 plumb)."""
    reasons: list[str] = []
    if signals.intraday_momentum_pct is not None and abs(
        float(signals.intraday_momentum_pct)
    ) > 0.025:
        sign = "+" if float(signals.intraday_momentum_pct) > 0 else ""
        reasons.append(
            f"intraday {sign}{float(signals.intraday_momentum_pct):.1%}"
        )
    if (
        signals.sector_cohort_momentum_avg is not None
        and float(signals.sector_cohort_momentum_avg) > 0.02
    ):
        reasons.append(
            f"cohort +{float(signals.sector_cohort_momentum_avg):.1%}"
        )
    if signals.analyst_pt_changes_24h > 0:
        reasons.append(
            f"analyst PT raises ×{int(signals.analyst_pt_changes_24h)}"
        )
    if (
        signals.news_sentiment is not None
        and float(signals.news_sentiment) > 0.5
    ):
        reasons.append(f"news sentiment +{float(signals.news_sentiment):.2f}")
    if (
        signals.historical_move_kurtosis is not None
        and float(signals.historical_move_kurtosis) > 4.0
    ):
        reasons.append(
            f"kurtosis {float(signals.historical_move_kurtosis):.1f}"
        )
    if (
        signals.iv_term_steepness is not None
        and float(signals.iv_term_steepness) > 0.30
    ):
        reasons.append(
            f"IV term +{float(signals.iv_term_steepness):.0%}"
        )
    # Wave V V3: volume-derived signals.
    if (
        signals.underlying_relative_volume is not None
        and float(signals.underlying_relative_volume) > 1.5
    ):
        reasons.append(
            f"relative volume {float(signals.underlying_relative_volume):.1f}× ADV → institutional flow"
        )
    if signals.options_call_put_volume_skew is not None:
        skew = float(signals.options_call_put_volume_skew)
        if skew > 2.0:
            reasons.append(
                f"call volume {skew:.1f}× put volume → bullish skew"
            )
        elif skew < 0.5:
            # Express the inverse so the analyst reads "puts dominate"
            # naturally; e.g. skew=0.3 → "put volume 3.3× call volume".
            inv = 1.0 / skew if skew > 0 else float("inf")
            reasons.append(
                f"put volume {inv:.1f}× call volume → bearish skew"
            )
    if signals.unusual_options_activity:
        reasons.append("unusual options activity → information flow")
    return reasons


# ---------------------------------------------------------------------------
# Regime classification
# ---------------------------------------------------------------------------


def _classify_regime(
    iv_rank: float | None,
    iv_to_hv_ratio: float | None,
    claude_verdict: str | None,
    claude_confidence: float | None,
) -> str:
    """Classify the volatility regime + directional bias.

    Returns one of: ``rich_neutral``, ``rich_directional``,
    ``cheap_directional``, ``cheap_neutral``, ``mixed``.
    """
    # Batch U (A-1): IV "rich" threshold sourced from settings.
    from core.config import settings as _settings
    iv_rich_threshold = _settings.EARNINGS_IV_RICH_THRESHOLD
    rank = iv_rank if iv_rank is not None else None
    ratio = iv_to_hv_ratio if iv_to_hv_ratio is not None else None
    is_iv_rich = (rank is not None and rank >= iv_rich_threshold) or (ratio is not None and ratio >= 1.5)
    is_iv_cheap = rank is not None and rank < 30
    bias_strength = abs(claude_confidence - 0.5) if claude_confidence is not None else 0.0
    is_directional = bias_strength >= 0.15
    verdict = (claude_verdict or "").lower()
    is_bullish = "bull" in verdict
    is_bearish = "bear" in verdict
    # If verdict is missing but confidence is asymmetric, fall back to confidence.
    if not is_bullish and not is_bearish:
        is_directional = False

    if is_iv_rich and not is_directional:
        return "rich_neutral"
    if is_iv_rich and is_directional:
        return "rich_directional"
    if is_iv_cheap and is_directional:
        return "cheap_directional"
    if is_iv_cheap and not is_directional:
        return "cheap_neutral"
    return "mixed"


# ---------------------------------------------------------------------------
# Setup builders
# ---------------------------------------------------------------------------


@dataclass
class _BuildContext:
    """Shared inputs each setup builder needs."""
    symbol: str
    spot: float
    expiry: date
    chain: Any
    current_iv: float
    hv_20: float | None
    iv_rank: float | None
    iv_percentile: float | None
    expected_move_pct: float | None
    hist_avg_abs_move_pct: float | None
    claude_verdict: str | None
    claude_confidence: float | None
    dte_days: float
    # SHR-1: empirical POP gets the symbol's prior post-earnings moves.
    prior_moves: list[float] | None = None
    # SHR-3: confidence + tail-risk feed into Kelly. Defaults are the
    # neutral-overlay values (no shrinkage) so legacy callers get the
    # original behaviour.
    tail_risk_score: float = 0.0


def _make_leg(
    *, side: str, contract_type: str, contract: Any, expiry: date,
) -> OptionLeg:
    return OptionLeg(
        side=side,  # type: ignore[arg-type]
        contract_type=contract_type,  # type: ignore[arg-type]
        strike=float(contract.strike),
        expiry=_contract_expiry(contract, expiry),
        qty=1,
        mid=_option_mid(contract),
    )


def _ctx_pop(
    ctx: _BuildContext, breakevens: Sequence[float], zone: str,
) -> float:
    """SHR-1: thread prior_moves through the POP computation."""
    return compute_pop(
        spot=ctx.spot,
        breakevens=breakevens,
        iv=ctx.current_iv,
        dte_days=ctx.dte_days,
        profitable_zone=zone,
        prior_moves=ctx.prior_moves,
    )


def _ctx_kelly(ctx: _BuildContext, pop: float, b: float) -> float:
    """SHR-3: thread confidence + tail_risk through the Kelly sizing."""
    confidence = (
        float(ctx.claude_confidence) if ctx.claude_confidence is not None else 1.0
    )
    return kelly_fraction(
        pop=pop,
        b=b,
        confidence=confidence,
        tail_risk=ctx.tail_risk_score,
    )


def _ctx_kelly_long_premium(ctx: _BuildContext, max_loss: float) -> float:
    """SHR-3: long-premium sizing scales with confidence × (1 - tail_risk).

    Long premium structures use a debit/spot heuristic instead of Kelly
    (no probability is multiplied through). Apply the same overlays so
    long-vol setups also shrink in low-confidence high-tail-risk regimes.
    """
    if ctx.spot <= 0 or max_loss <= 0:
        return 0.0
    base = max_loss / 100.0 / ctx.spot
    confidence = (
        float(ctx.claude_confidence) if ctx.claude_confidence is not None else 1.0
    )
    confidence = max(0.0, min(1.0, confidence))
    tr = max(0.0, min(1.0, ctx.tail_risk_score))
    adjusted = base * confidence * (1.0 - tr)
    return float(max(0.0, min(0.02, adjusted)))


def _summary_iv_vs_hv(ctx: _BuildContext) -> str:
    """Reusable rationale fragment: ``"IV 119% vs HV 65% (1.8x premium)"``."""
    if ctx.hv_20 and ctx.hv_20 > 0:
        return (
            f"IV {ctx.current_iv:.0%} vs HV {ctx.hv_20:.0%} "
            f"({ctx.current_iv / ctx.hv_20:.1f}x)"
        )
    return f"IV {ctx.current_iv:.0%}"


def _summary_implied_vs_hist(ctx: _BuildContext) -> str:
    if ctx.expected_move_pct is None or ctx.hist_avg_abs_move_pct is None:
        return ""
    return (
        f" Implied move {ctx.expected_move_pct:.1%} vs historical "
        f"{ctx.hist_avg_abs_move_pct:.1%}."
    )


def _pick_strike_by_delta(
    ctx: _BuildContext,
    side: str,
    target_delta: float,
    warnings_accum: list[bool],
) -> Any | None:
    """Wave V V2: liquidity-aware delta picker used by every builder.

    Calls :func:`find_liquid_strike_by_delta`, appending the per-leg
    warning to ``warnings_accum`` so the builder can roll up an
    aggregate ``liquidity_warning`` for the setup.
    """
    contract, warn = find_liquid_strike_by_delta(
        ctx.chain, ctx.expiry, side, target_delta,
    )
    warnings_accum.append(bool(warn))
    return contract


def _annotate_liquidity(
    setup: EarningsSetup | None,
    contracts: Iterable[Any],
    *,
    extra_warning: bool = False,
) -> EarningsSetup | None:
    """Populate worst_leg_liquidity_score / liquidity_warning on a setup."""
    if setup is None:
        return None
    from core.config import settings as _settings

    worst = _legs_worst_liquidity(contracts)
    threshold = _settings.RECOMMENDER_MIN_LEG_LIQUIDITY_SCORE
    threshold_warning = worst is not None and worst < threshold
    return setup.model_copy(
        update={
            "worst_leg_liquidity_score": worst,
            "liquidity_warning": bool(extra_warning or threshold_warning),
        },
    )


def _liquidity_rationale_suffix(
    worst_score: float | None, warning: bool,
) -> str:
    """One-line "Liquidity score: 0.X — LABEL" clause when warning is set."""
    if not warning or worst_score is None:
        return ""
    label = _liquidity_label(float(worst_score))
    return f" Liquidity score: {float(worst_score):.2f} — {label}."


# ─── Iron condor (rich_neutral) ──────────────────────────────


def _build_iron_condor(ctx: _BuildContext) -> EarningsSetup | None:
    short_d = _select_short_delta_for_iron_condor(
        ctx.dte_days,
        claude_confidence=ctx.claude_confidence,
        iv_rank=ctx.iv_rank,
    )
    long_d = _select_long_delta_for_iron_condor(
        ctx.dte_days,
        claude_confidence=ctx.claude_confidence,
        iv_rank=ctx.iv_rank,
    )
    warns: list[bool] = []
    short_put = _pick_strike_by_delta(ctx, "put", -short_d, warns)
    long_put = _pick_strike_by_delta(ctx, "put", -long_d, warns)
    short_call = _pick_strike_by_delta(ctx, "call", short_d, warns)
    long_call = _pick_strike_by_delta(ctx, "call", long_d, warns)
    if not (short_put and long_put and short_call and long_call):
        return None
    if long_put.strike >= short_put.strike or long_call.strike <= short_call.strike:
        # Wing isn't OTM beyond short — chain too sparse to build a real condor.
        return None
    legs = [
        _make_leg(side="buy", contract_type="put", contract=long_put, expiry=ctx.expiry),
        _make_leg(side="sell", contract_type="put", contract=short_put, expiry=ctx.expiry),
        _make_leg(side="sell", contract_type="call", contract=short_call, expiry=ctx.expiry),
        _make_leg(side="buy", contract_type="call", contract=long_call, expiry=ctx.expiry),
    ]
    spm = _option_mid(short_put)
    lpm = _option_mid(long_put)
    scm = _option_mid(short_call)
    lcm = _option_mid(long_call)
    net_credit = (spm - lpm) + (scm - lcm)  # per share
    wing_put = short_put.strike - long_put.strike
    wing_call = long_call.strike - short_call.strike
    max_profit = net_credit * 100.0
    max_loss = (max(wing_put, wing_call) - net_credit) * 100.0
    if max_loss <= 0 or max_profit <= 0:
        return None
    breakevens = [
        short_put.strike - net_credit,
        short_call.strike + net_credit,
    ]
    pop = _ctx_pop(ctx, breakevens, "between")
    ev = pop * max_profit - (1.0 - pop) * max_loss
    rr = max_profit / max_loss if max_loss > 0 else None
    rationale = (
        f"{_summary_iv_vs_hv(ctx)}. Defined-risk short premium." + _summary_implied_vs_hist(ctx)
    )
    setup = EarningsSetup(
        setup_id="iron_condor",
        legs=legs,
        net_credit_or_debit=net_credit,
        max_profit=max_profit,
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=rr,
        rationale=rationale,
        sizing_kelly_pct=_ctx_kelly(ctx, pop, max_profit / max_loss),
        is_defined_risk=True,
    )
    return _annotate_liquidity(
        setup,
        [long_put, short_put, short_call, long_call],
        extra_warning=any(warns),
    )


# ─── Iron butterfly (rich_neutral, very tight expected move) ─


def _build_iron_butterfly(ctx: _BuildContext) -> EarningsSetup | None:
    # Iron butterflies are pin-bets on a tight ATM range. Suppress when
    # Claude confidence is below the low threshold — the structure
    # requires conviction on the pin we don't have.
    if _should_avoid_iron_butterfly(ctx.claude_confidence):
        return None
    atm_call = find_strike_nearest(ctx.chain, ctx.expiry, "call", ctx.spot)
    atm_put = find_strike_nearest(ctx.chain, ctx.expiry, "put", ctx.spot)
    if not (atm_call and atm_put):
        return None
    # Wing strikes: ~1 expected-move-stdev OTM, scaled by the DTE/IV-aware
    # tightening factor. Earnings butterflies (DTE ≤ 10) shrink to 0.6×
    # the implied move per the research.
    em_pct = ctx.expected_move_pct if ctx.expected_move_pct else 0.05
    wing_factor = _butterfly_wing_em_factor(ctx.dte_days, iv_rank=ctx.iv_rank)
    em_dollars = em_pct * ctx.spot * wing_factor
    long_call = find_strike_nearest(
        ctx.chain, ctx.expiry, "call", atm_call.strike + em_dollars,
    )
    long_put = find_strike_nearest(
        ctx.chain, ctx.expiry, "put", atm_put.strike - em_dollars,
    )
    if not (long_call and long_put):
        return None
    if long_call.strike <= atm_call.strike or long_put.strike >= atm_put.strike:
        return None
    legs = [
        _make_leg(side="buy", contract_type="put", contract=long_put, expiry=ctx.expiry),
        _make_leg(side="sell", contract_type="put", contract=atm_put, expiry=ctx.expiry),
        _make_leg(side="sell", contract_type="call", contract=atm_call, expiry=ctx.expiry),
        _make_leg(side="buy", contract_type="call", contract=long_call, expiry=ctx.expiry),
    ]
    net_credit = (
        _option_mid(atm_put) - _option_mid(long_put)
        + _option_mid(atm_call) - _option_mid(long_call)
    )
    wing = max(atm_call.strike - long_put.strike, long_call.strike - atm_call.strike)
    max_profit = net_credit * 100.0
    max_loss = (wing - net_credit) * 100.0
    if max_loss <= 0 or max_profit <= 0:
        return None
    breakevens = [atm_put.strike - net_credit, atm_call.strike + net_credit]
    pop = _ctx_pop(ctx, breakevens, "between")
    ev = pop * max_profit - (1.0 - pop) * max_loss
    setup = EarningsSetup(
        setup_id="iron_butterfly",
        legs=legs,
        net_credit_or_debit=net_credit,
        max_profit=max_profit,
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=max_profit / max_loss,
        rationale=(
            f"{_summary_iv_vs_hv(ctx)}. ATM-anchored short premium for a "
            f"sub-implied move." + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=_ctx_kelly(ctx, pop, max_profit / max_loss),
        is_defined_risk=True,
    )
    return _annotate_liquidity(setup, [long_put, atm_put, atm_call, long_call])


# ─── Short strangle (rich_neutral, naked) ────────────────────


def _build_short_strangle(ctx: _BuildContext) -> EarningsSetup | None:
    short_d = _select_short_delta_for_iron_condor(
        ctx.dte_days,
        claude_confidence=ctx.claude_confidence,
        iv_rank=ctx.iv_rank,
    )
    short_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -short_d)
    short_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", short_d)
    if not (short_put and short_call):
        return None
    legs = [
        _make_leg(side="sell", contract_type="put", contract=short_put, expiry=ctx.expiry),
        _make_leg(side="sell", contract_type="call", contract=short_call, expiry=ctx.expiry),
    ]
    net_credit = _option_mid(short_put) + _option_mid(short_call)
    max_profit = net_credit * 100.0
    if max_profit <= 0:
        return None
    breakevens = [short_put.strike - net_credit, short_call.strike + net_credit]
    pop = _ctx_pop(ctx, breakevens, "between")
    # Margin proxy: 20% of underlying minus OTM amount per side, +
    # premium received. Very rough.
    margin = max(
        0.20 * ctx.spot * 100.0 - max(0, short_call.strike - ctx.spot) * 100.0,
        0.10 * short_call.strike * 100.0,
    ) + max_profit
    # Unlimited loss; cap the EV with a 3-stdev tail estimate.
    sigma = ctx.current_iv * math.sqrt(ctx.dte_days / 365.0)
    tail_loss = ctx.spot * (math.exp(3.0 * sigma) - 1.0) * 100.0
    ev = pop * max_profit - (1.0 - pop) * tail_loss
    return EarningsSetup(
        setup_id="short_strangle",
        legs=legs,
        net_credit_or_debit=net_credit,
        max_profit=max_profit,
        max_loss=None,  # naked
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=None,
        rationale=(
            f"DANGEROUS — naked short premium. {_summary_iv_vs_hv(ctx)}. "
            f"Tail risk uncapped." + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=0.0,  # never auto-size naked positions
        is_defined_risk=False,
        requires_margin_estimate=margin,
    )


# ─── Short straddle (rich_neutral, naked) ────────────────────


def _build_short_straddle(ctx: _BuildContext) -> EarningsSetup | None:
    atm_call = find_strike_nearest(ctx.chain, ctx.expiry, "call", ctx.spot)
    atm_put = find_strike_nearest(ctx.chain, ctx.expiry, "put", ctx.spot)
    if not (atm_call and atm_put):
        return None
    legs = [
        _make_leg(side="sell", contract_type="put", contract=atm_put, expiry=ctx.expiry),
        _make_leg(side="sell", contract_type="call", contract=atm_call, expiry=ctx.expiry),
    ]
    net_credit = _option_mid(atm_put) + _option_mid(atm_call)
    max_profit = net_credit * 100.0
    if max_profit <= 0:
        return None
    breakevens = [atm_put.strike - net_credit, atm_call.strike + net_credit]
    pop = _ctx_pop(ctx, breakevens, "between")
    sigma = ctx.current_iv * math.sqrt(ctx.dte_days / 365.0)
    tail_loss = ctx.spot * (math.exp(3.0 * sigma) - 1.0) * 100.0
    ev = pop * max_profit - (1.0 - pop) * tail_loss
    margin = 0.20 * ctx.spot * 100.0 + max_profit
    return EarningsSetup(
        setup_id="short_straddle",
        legs=legs,
        net_credit_or_debit=net_credit,
        max_profit=max_profit,
        max_loss=None,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=None,
        rationale=(
            f"DANGEROUS — naked ATM short premium. {_summary_iv_vs_hv(ctx)}."
            + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=0.0,
        is_defined_risk=False,
        requires_margin_estimate=margin,
    )


# ─── Bear call spread (rich_directional, bearish) ────────────


def _build_bear_call_spread(ctx: _BuildContext) -> EarningsSetup | None:
    short_d = _select_vertical_short_delta(
        ctx.dte_days,
        claude_confidence=ctx.claude_confidence,
        iv_rank=ctx.iv_rank,
    )
    long_d = _select_vertical_long_delta(
        ctx.dte_days,
        claude_confidence=ctx.claude_confidence,
        iv_rank=ctx.iv_rank,
    )
    short_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", short_d)
    long_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", long_d)
    if not (short_call and long_call):
        return None
    if long_call.strike <= short_call.strike:
        return None
    legs = [
        _make_leg(side="sell", contract_type="call", contract=short_call, expiry=ctx.expiry),
        _make_leg(side="buy", contract_type="call", contract=long_call, expiry=ctx.expiry),
    ]
    net_credit = _option_mid(short_call) - _option_mid(long_call)
    width = long_call.strike - short_call.strike
    max_profit = net_credit * 100.0
    max_loss = (width - net_credit) * 100.0
    if max_profit <= 0 or max_loss <= 0:
        return None
    breakevens = [short_call.strike + net_credit]
    pop = _ctx_pop(ctx, breakevens, "below_lower")
    ev = pop * max_profit - (1.0 - pop) * max_loss
    return EarningsSetup(
        setup_id="bear_call_spread",
        legs=legs,
        net_credit_or_debit=net_credit,
        max_profit=max_profit,
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=max_profit / max_loss,
        rationale=(
            f"Bearish bias + {_summary_iv_vs_hv(ctx)}. Defined-risk credit "
            f"spread above ${short_call.strike:.0f}." + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=_ctx_kelly(ctx, pop, max_profit / max_loss),
        is_defined_risk=True,
    )


# ─── Bull put spread (rich_directional, bullish) ─────────────


def _build_bull_put_spread(ctx: _BuildContext) -> EarningsSetup | None:
    short_d = _select_vertical_short_delta(
        ctx.dte_days,
        claude_confidence=ctx.claude_confidence,
        iv_rank=ctx.iv_rank,
    )
    long_d = _select_vertical_long_delta(
        ctx.dte_days,
        claude_confidence=ctx.claude_confidence,
        iv_rank=ctx.iv_rank,
    )
    short_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -short_d)
    long_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -long_d)
    if not (short_put and long_put):
        return None
    if long_put.strike >= short_put.strike:
        return None
    legs = [
        _make_leg(side="sell", contract_type="put", contract=short_put, expiry=ctx.expiry),
        _make_leg(side="buy", contract_type="put", contract=long_put, expiry=ctx.expiry),
    ]
    net_credit = _option_mid(short_put) - _option_mid(long_put)
    width = short_put.strike - long_put.strike
    max_profit = net_credit * 100.0
    max_loss = (width - net_credit) * 100.0
    if max_profit <= 0 or max_loss <= 0:
        return None
    breakevens = [short_put.strike - net_credit]
    pop = _ctx_pop(ctx, breakevens, "above_upper")
    ev = pop * max_profit - (1.0 - pop) * max_loss
    return EarningsSetup(
        setup_id="bull_put_spread",
        legs=legs,
        net_credit_or_debit=net_credit,
        max_profit=max_profit,
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=max_profit / max_loss,
        rationale=(
            f"Bullish bias + {_summary_iv_vs_hv(ctx)}. Defined-risk credit "
            f"spread below ${short_put.strike:.0f}." + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=_ctx_kelly(ctx, pop, max_profit / max_loss),
        is_defined_risk=True,
    )


# ─── Bull call spread (cheap_directional, bullish) ───────────


def _build_bull_call_spread(ctx: _BuildContext) -> EarningsSetup | None:
    long_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", 0.45)
    short_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", 0.20)
    if not (long_call and short_call):
        return None
    if short_call.strike <= long_call.strike:
        return None
    legs = [
        _make_leg(side="buy", contract_type="call", contract=long_call, expiry=ctx.expiry),
        _make_leg(side="sell", contract_type="call", contract=short_call, expiry=ctx.expiry),
    ]
    net_debit = _option_mid(long_call) - _option_mid(short_call)
    if net_debit <= 0:
        return None
    width = short_call.strike - long_call.strike
    max_profit = (width - net_debit) * 100.0
    max_loss = net_debit * 100.0
    if max_profit <= 0:
        return None
    breakevens = [long_call.strike + net_debit]
    pop = _ctx_pop(ctx, breakevens, "above_upper")
    ev = pop * max_profit - (1.0 - pop) * max_loss
    return EarningsSetup(
        setup_id="bull_call_spread",
        legs=legs,
        net_credit_or_debit=-net_debit,
        max_profit=max_profit,
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=max_profit / max_loss,
        rationale=(
            f"Bullish bias + cheap vol ({_summary_iv_vs_hv(ctx)}). Defined-risk "
            f"debit spread targeting upside through ${short_call.strike:.0f}."
            + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=_ctx_kelly(ctx, pop, max_profit / max_loss),
        is_defined_risk=True,
    )


# ─── Bear put spread (cheap_directional, bearish) ────────────


def _build_bear_put_spread(ctx: _BuildContext) -> EarningsSetup | None:
    long_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -0.45)
    short_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -0.20)
    if not (long_put and short_put):
        return None
    if short_put.strike >= long_put.strike:
        return None
    legs = [
        _make_leg(side="buy", contract_type="put", contract=long_put, expiry=ctx.expiry),
        _make_leg(side="sell", contract_type="put", contract=short_put, expiry=ctx.expiry),
    ]
    net_debit = _option_mid(long_put) - _option_mid(short_put)
    if net_debit <= 0:
        return None
    width = long_put.strike - short_put.strike
    max_profit = (width - net_debit) * 100.0
    max_loss = net_debit * 100.0
    if max_profit <= 0:
        return None
    breakevens = [long_put.strike - net_debit]
    pop = _ctx_pop(ctx, breakevens, "below_lower")
    ev = pop * max_profit - (1.0 - pop) * max_loss
    return EarningsSetup(
        setup_id="bear_put_spread",
        legs=legs,
        net_credit_or_debit=-net_debit,
        max_profit=max_profit,
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=max_profit / max_loss,
        rationale=(
            f"Bearish bias + cheap vol ({_summary_iv_vs_hv(ctx)}). Defined-risk "
            f"debit spread targeting downside through ${short_put.strike:.0f}."
            + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=_ctx_kelly(ctx, pop, max_profit / max_loss),
        is_defined_risk=True,
    )


# ─── Long single (cheap_directional fallback) ───────────────


def _build_long_call(ctx: _BuildContext) -> EarningsSetup | None:
    long_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", 0.45)
    if not long_call:
        return None
    legs = [_make_leg(side="buy", contract_type="call", contract=long_call, expiry=ctx.expiry)]
    debit = _option_mid(long_call)
    if debit <= 0:
        return None
    max_loss = debit * 100.0
    breakevens = [long_call.strike + debit]
    pop = _ctx_pop(ctx, breakevens, "above_upper")
    sigma = ctx.current_iv * math.sqrt(ctx.dte_days / 365.0)
    expected_terminal_up = ctx.spot * math.exp(2.0 * sigma)
    expected_profit = max(0.0, (expected_terminal_up - long_call.strike) * 100.0 - max_loss)
    ev = pop * expected_profit - (1.0 - pop) * max_loss
    return EarningsSetup(
        setup_id="long_call",
        legs=legs,
        net_credit_or_debit=-debit,
        max_profit=None,  # unbounded
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=None,
        rationale=(
            f"Bullish bias + cheap vol ({_summary_iv_vs_hv(ctx)}). Long single "
            f"call for asymmetric upside." + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=_ctx_kelly_long_premium(ctx, max_loss),
        is_defined_risk=True,
    )


def _build_long_put(ctx: _BuildContext) -> EarningsSetup | None:
    long_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -0.45)
    if not long_put:
        return None
    legs = [_make_leg(side="buy", contract_type="put", contract=long_put, expiry=ctx.expiry)]
    debit = _option_mid(long_put)
    if debit <= 0:
        return None
    max_loss = debit * 100.0
    breakevens = [long_put.strike - debit]
    pop = _ctx_pop(ctx, breakevens, "below_lower")
    sigma = ctx.current_iv * math.sqrt(ctx.dte_days / 365.0)
    expected_terminal_dn = ctx.spot * math.exp(-2.0 * sigma)
    expected_profit = max(0.0, (long_put.strike - expected_terminal_dn) * 100.0 - max_loss)
    ev = pop * expected_profit - (1.0 - pop) * max_loss
    return EarningsSetup(
        setup_id="long_put",
        legs=legs,
        net_credit_or_debit=-debit,
        max_profit=None,
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=None,
        rationale=(
            f"Bearish bias + cheap vol ({_summary_iv_vs_hv(ctx)}). Long single "
            f"put for asymmetric downside." + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=_ctx_kelly_long_premium(ctx, max_loss),
        is_defined_risk=True,
    )


# ─── Long straddle / strangle (cheap_neutral) ────────────────


def _build_long_straddle(ctx: _BuildContext) -> EarningsSetup | None:
    atm_call = find_strike_nearest(ctx.chain, ctx.expiry, "call", ctx.spot)
    atm_put = find_strike_nearest(ctx.chain, ctx.expiry, "put", ctx.spot)
    if not (atm_call and atm_put):
        return None
    legs = [
        _make_leg(side="buy", contract_type="call", contract=atm_call, expiry=ctx.expiry),
        _make_leg(side="buy", contract_type="put", contract=atm_put, expiry=ctx.expiry),
    ]
    debit = _option_mid(atm_call) + _option_mid(atm_put)
    if debit <= 0:
        return None
    max_loss = debit * 100.0
    breakevens = [atm_put.strike - debit, atm_call.strike + debit]
    pop = _ctx_pop(ctx, breakevens, "outside")
    sigma = ctx.current_iv * math.sqrt(ctx.dte_days / 365.0)
    avg_winning_move = ctx.spot * math.exp(2.0 * sigma) - atm_call.strike
    expected_profit = max(0.0, avg_winning_move * 100.0 - max_loss)
    ev = pop * expected_profit - (1.0 - pop) * max_loss
    return EarningsSetup(
        setup_id="long_straddle",
        legs=legs,
        net_credit_or_debit=-debit,
        max_profit=None,
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=None,
        rationale=(
            f"{_summary_iv_vs_hv(ctx)}. Long straddle pays for a sub-implied "
            f"explosion either direction." + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=_ctx_kelly_long_premium(ctx, max_loss),
        is_defined_risk=True,
    )


def _build_long_strangle(ctx: _BuildContext) -> EarningsSetup | None:
    long_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", 0.30)
    long_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -0.30)
    if not (long_call and long_put):
        return None
    if long_call.strike <= long_put.strike:
        return None
    legs = [
        _make_leg(side="buy", contract_type="call", contract=long_call, expiry=ctx.expiry),
        _make_leg(side="buy", contract_type="put", contract=long_put, expiry=ctx.expiry),
    ]
    debit = _option_mid(long_call) + _option_mid(long_put)
    if debit <= 0:
        return None
    max_loss = debit * 100.0
    breakevens = [long_put.strike - debit, long_call.strike + debit]
    pop = _ctx_pop(ctx, breakevens, "outside")
    sigma = ctx.current_iv * math.sqrt(ctx.dte_days / 365.0)
    avg_winning_move = ctx.spot * math.exp(2.0 * sigma) - long_call.strike
    expected_profit = max(0.0, avg_winning_move * 100.0 - max_loss)
    ev = pop * expected_profit - (1.0 - pop) * max_loss
    return EarningsSetup(
        setup_id="long_strangle",
        legs=legs,
        net_credit_or_debit=-debit,
        max_profit=None,
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=None,
        rationale=(
            f"{_summary_iv_vs_hv(ctx)}. OTM strangle for a cheaper big-move "
            f"play." + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=_ctx_kelly_long_premium(ctx, max_loss),
        is_defined_risk=True,
    )


# ─── Calendar / diagonal (cheap_neutral, IV-term-structure plays) ─


def _build_calendar_spread(ctx: _BuildContext) -> EarningsSetup | None:
    """Sell the event-spanning ATM, buy the next expiry out at same strike."""
    expirations = _expirations_sorted(ctx.chain)
    next_expiries = [e for e in expirations if e > ctx.expiry]
    if not next_expiries:
        return None
    back_expiry = next_expiries[0]
    front_call = find_strike_nearest(ctx.chain, ctx.expiry, "call", ctx.spot)
    if not front_call:
        return None
    back_call = find_strike_nearest(ctx.chain, back_expiry, "call", front_call.strike)
    if not back_call:
        return None
    if back_call.strike != front_call.strike:
        # Calendar requires same strike; if back-month has no match, skip.
        return None
    front_mid = _option_mid(front_call)
    back_mid = _option_mid(back_call)
    debit = back_mid - front_mid  # positive = pay debit
    if debit <= 0:
        return None
    max_loss = debit * 100.0
    legs = [
        _make_leg(side="sell", contract_type="call", contract=front_call, expiry=ctx.expiry),
        _make_leg(side="buy", contract_type="call", contract=back_call, expiry=back_expiry),
    ]
    # POP for a calendar is high if spot stays near short strike at front expiry.
    # Use a one-stdev-band heuristic.
    sigma = ctx.current_iv * math.sqrt(ctx.dte_days / 365.0)
    band = ctx.spot * sigma
    breakevens = [front_call.strike - band, front_call.strike + band]
    pop = _ctx_pop(ctx, breakevens, "between")
    # Heuristic max profit: ~30% of debit at peak. Real value depends on
    # post-front-expiry vol crush.
    estimated_max_profit = debit * 100.0 * 0.30
    ev = pop * estimated_max_profit - (1.0 - pop) * max_loss
    return EarningsSetup(
        setup_id="calendar_spread",
        legs=legs,
        net_credit_or_debit=-debit,
        max_profit=estimated_max_profit,  # heuristic
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=estimated_max_profit / max_loss if max_loss > 0 else None,
        rationale=(
            f"{_summary_iv_vs_hv(ctx)}. Calendar long vega — front-month event "
            f"IV crushes faster than back-month."
        ),
        sizing_kelly_pct=_ctx_kelly_long_premium(ctx, max_loss),
        is_defined_risk=True,
    )


def _build_diagonal_spread(ctx: _BuildContext) -> EarningsSetup | None:
    """Long-vol diagonal: sell front-month OTM, buy back-month closer to ATM."""
    expirations = _expirations_sorted(ctx.chain)
    next_expiries = [e for e in expirations if e > ctx.expiry]
    if not next_expiries:
        return None
    back_expiry = next_expiries[0]
    is_bullish = "bull" in (ctx.claude_verdict or "")
    if is_bullish:
        front = find_strike_by_delta(ctx.chain, ctx.expiry, "call", 0.20)
        back = find_strike_by_delta(ctx.chain, back_expiry, "call", 0.45)
        if not (front and back):
            return None
        legs = [
            _make_leg(side="sell", contract_type="call", contract=front, expiry=ctx.expiry),
            _make_leg(side="buy", contract_type="call", contract=back, expiry=back_expiry),
        ]
    else:
        front = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -0.20)
        back = find_strike_by_delta(ctx.chain, back_expiry, "put", -0.45)
        if not (front and back):
            return None
        legs = [
            _make_leg(side="sell", contract_type="put", contract=front, expiry=ctx.expiry),
            _make_leg(side="buy", contract_type="put", contract=back, expiry=back_expiry),
        ]
    debit = _option_mid(back) - _option_mid(front)
    if debit <= 0:
        return None
    max_loss = debit * 100.0
    sigma = ctx.current_iv * math.sqrt(ctx.dte_days / 365.0)
    band = ctx.spot * sigma
    direction = "above_upper" if is_bullish else "below_lower"
    breakevens = [front.strike + band] if is_bullish else [front.strike - band]
    pop = _ctx_pop(ctx, breakevens, direction)
    estimated_max_profit = debit * 100.0 * 0.40
    ev = pop * estimated_max_profit - (1.0 - pop) * max_loss
    return EarningsSetup(
        setup_id="diagonal_spread",
        legs=legs,
        net_credit_or_debit=-debit,
        max_profit=estimated_max_profit,
        max_loss=max_loss,
        breakevens=breakevens,
        pop_estimate=max(0.0, min(1.0, pop)),
        expected_value=ev,
        risk_reward=estimated_max_profit / max_loss if max_loss > 0 else None,
        rationale=(
            f"{_summary_iv_vs_hv(ctx)}. Diagonal — directional lean with a "
            f"long-vega tail." + _summary_implied_vs_hist(ctx)
        ),
        sizing_kelly_pct=_ctx_kelly_long_premium(ctx, max_loss),
        is_defined_risk=True,
    )


# ---------------------------------------------------------------------------
# Regime → candidate builder map
# ---------------------------------------------------------------------------


_REGIME_CANDIDATES: dict[str, list[Any]] = {
    "rich_neutral": [
        _build_iron_condor,
        _build_iron_butterfly,
        _build_short_strangle,
        _build_short_straddle,
    ],
    "rich_directional": [
        # bull/bear branches selected by claude_verdict in _candidates_for_regime
        _build_iron_condor,
    ],
    "cheap_directional": [
        # bull/bear branches selected by claude_verdict
    ],
    "cheap_neutral": [
        _build_calendar_spread,
        _build_long_straddle,
        _build_long_strangle,
        _build_diagonal_spread,
    ],
    "mixed": [
        _build_iron_condor,
        _build_bear_call_spread,
        _build_bull_put_spread,
    ],
}


def _candidates_for_regime(regime: str, verdict: str | None) -> list[Any]:
    """Return the list of builder callables to evaluate for the regime."""
    v = (verdict or "").lower()
    if regime == "rich_directional":
        if "bear" in v:
            return [_build_bear_call_spread, _build_iron_condor, _build_short_strangle]
        if "bull" in v:
            return [_build_bull_put_spread, _build_iron_condor, _build_short_strangle]
        return [_build_iron_condor, _build_bear_call_spread, _build_bull_put_spread]
    if regime == "cheap_directional":
        if "bear" in v:
            return [_build_bear_put_spread, _build_long_put, _build_diagonal_spread]
        if "bull" in v:
            return [_build_bull_call_spread, _build_long_call, _build_diagonal_spread]
        return [_build_long_straddle, _build_calendar_spread]
    if regime == "mixed":
        # Default: balanced credit spread + condor.
        if "bear" in v:
            return [_build_iron_condor, _build_bear_call_spread, _build_long_put]
        if "bull" in v:
            return [_build_iron_condor, _build_bull_put_spread, _build_long_call]
        return _REGIME_CANDIDATES["mixed"]
    return _REGIME_CANDIDATES.get(regime, [])


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def _build_skip_setup(
    *,
    tail_risk_score: float,
    confidence: float | None,
    reasons: list[str] | None = None,
) -> EarningsSetup:
    """SHR-4: synthetic ``setup_id="skip"`` setup signalling no trade.

    Returned at ``top_setups[0]`` when EV is poor across the candidate
    set or when tail-risk + low confidence trip the skip thresholds.
    Carries 0 sizing, empty legs, and a rationale that explains why
    the recommender bailed.
    """
    conf_str = f"{confidence:.2f}" if confidence is not None else "n/a"
    rationale = (
        f"Tail-risk score {tail_risk_score:.2f} + confidence {conf_str} → "
        f"no setup has favorable risk-adjusted EV. Skip this earnings event."
    )
    if reasons:
        rationale += " Signals: " + ", ".join(reasons) + "."
    return EarningsSetup(
        setup_id="skip",
        legs=[],
        net_credit_or_debit=0.0,
        max_profit=0.0,
        max_loss=0.0,
        breakevens=[],
        pop_estimate=0.0,
        expected_value=0.0,
        risk_reward=None,
        rationale=rationale,
        sizing_kelly_pct=0.0,
        is_defined_risk=True,
        requires_margin_estimate=None,
    )


async def recommend_setups(
    *,
    symbol: str,
    spot: float,
    iv_rank: float | None,
    iv_percentile: float | None,
    current_iv: float,
    hv_20: float | None,
    expected_move_pct: float | None,
    hist_avg_abs_move_pct: float | None,
    claude_verdict: str | None,
    claude_confidence: float | None,
    chain: Any,
    report_date: date | None = None,
    report_time: str | None = None,
    prior_moves: Sequence[float] | None = None,
    tail_risk_signals: TailRiskSignals | None = None,
) -> list[EarningsSetup]:
    """Return ranked top-3 setups by expected value, with SHR hardening.

    Synchronous in spirit (no awaits), but kept ``async`` so the
    screener can call it from the existing :func:`asyncio.gather` flow
    without an extra thread. If the chain is empty or vol inputs are
    missing, returns an empty list.

    SHR additions:

      * ``prior_moves`` (SHR-1) — historical post-earnings move pcts
        threaded through ``compute_pop`` so symbols with ≥6 prints
        use empirical (fat-tail-aware) POP instead of lognormal.
      * ``tail_risk_signals`` (SHR-2) — auxiliary momentum / sentiment
        signals scored 0..1; when ≥0.6 short-vol setups have their EV
        halved, ≥0.85 forces a ``"skip"`` outcome.
      * Confidence-aware Kelly (SHR-3) — every builder threads
        ``claude_confidence × (1 - tail_risk)`` through Kelly sizing
        via :func:`_ctx_kelly`.
      * Skip signal (SHR-4) — when all candidates have EV ≤ 0, or
        tail-risk ≥ 0.85, or low confidence (≤0.40) AND tail-risk
        ≥0.6, ``top_setups[0]`` becomes a skip marker.
    """
    if chain is None or spot <= 0 or current_iv <= 0:
        return []
    expiry = nearest_event_spanning_expiry(
        chain, report_date=report_date, report_time=report_time,
    )
    if expiry is None:
        return []
    today = date.today() if report_date is None else report_date
    dte_days = max(1.0, float((expiry - today).days))
    iv_to_hv = (current_iv / hv_20) if (hv_20 and hv_20 > 0) else None
    regime = _classify_regime(iv_rank, iv_to_hv, claude_verdict, claude_confidence)
    # SHR-2: compute the tail-risk score once up front so every builder
    # observes the same context (sizing) and the post-build EV demotion
    # can use it.
    tr_signals = tail_risk_signals or TailRiskSignals()
    tail_risk_score = _compute_tail_risk_score(tr_signals)
    tail_risk_reasons = _tail_risk_reasons(tr_signals)
    log.debug(
        "recommender regime=%s for %s (iv_rank=%s ratio=%s verdict=%s conf=%s tail_risk=%.2f)",
        regime, symbol, iv_rank, iv_to_hv, claude_verdict, claude_confidence,
        tail_risk_score,
    )
    # Normalise prior_moves to a list[float] for the empirical POP path.
    pm_list: list[float] | None = None
    if prior_moves:
        pm_list = [float(m) for m in prior_moves if m is not None]
        if not pm_list:
            pm_list = None
    ctx = _BuildContext(
        symbol=symbol,
        spot=spot,
        expiry=expiry,
        chain=chain,
        current_iv=current_iv,
        hv_20=hv_20,
        iv_rank=iv_rank,
        iv_percentile=iv_percentile,
        expected_move_pct=expected_move_pct,
        hist_avg_abs_move_pct=hist_avg_abs_move_pct,
        claude_verdict=claude_verdict,
        claude_confidence=claude_confidence,
        dte_days=dte_days,
        prior_moves=pm_list,
        tail_risk_score=tail_risk_score,
    )
    # SHR-2: when tail risk is elevated, also evaluate long-vol setups
    # so they can compete with the regime defaults. We don't rewrite the
    # regime — just augment the candidate list with long_strangle/
    # long_straddle/diagonal so a short-vol regime can still surface a
    # long-vol structure when the auxiliary signals scream.
    builder_list: list[Any] = list(_candidates_for_regime(regime, claude_verdict))
    if tail_risk_score >= 0.6 and regime in ("rich_neutral", "rich_directional"):
        for extra in (_build_long_strangle, _build_long_straddle, _build_diagonal_spread):
            if extra not in builder_list:
                builder_list.append(extra)

    candidates: list[EarningsSetup] = []
    for builder in builder_list:
        try:
            setup = builder(ctx)
        except Exception as e:  # noqa: BLE001
            log.debug("recommender builder %s failed for %s: %s", builder.__name__, symbol, e)
            setup = None
        if setup is not None:
            candidates.append(setup)

    # SHR-2: tail-risk overlay — halve EV for short-vol setups when the
    # score crosses the demote threshold. This rebalances the ranking
    # without dropping the setup outright (the analyst still sees the
    # demoted choice for transparency, with its EV derated).
    if tail_risk_score >= 0.6 and candidates:
        derated: list[EarningsSetup] = []
        for s in candidates:
            if s.setup_id in _SHORT_VOL_SETUPS:
                # EV/2 captures the asymmetric risk; floor at original EV
                # so we don't accidentally turn a positive EV into more
                # positive (only halve magnitudes).
                new_ev = s.expected_value / 2.0
                derated.append(s.model_copy(update={"expected_value": new_ev}))
            else:
                derated.append(s)
        candidates = derated

    # Rank: prefer defined-risk setups with positive EV. Within
    # defined-risk, rank by EV-per-dollar-at-risk (Sharpe-like) so
    # condors (higher POP, wider profitable range) beat butterflies
    # (sometimes higher max_profit but much narrower band) at equal
    # EV. Within the rich_neutral regime specifically we add a small
    # structural bonus to condor because it is the canonical answer
    # for rich-vol neutral plays — butterflies need a *very* tight
    # expected move that doesn't typically hold at IV 100%+.
    def _sort_key(s: EarningsSetup) -> tuple:
        defined_bonus = 1 if s.is_defined_risk else 0
        # EV per dollar at risk; falls back to raw EV for unbounded loss.
        if s.max_loss and s.max_loss > 0:
            ev_per_risk = s.expected_value / s.max_loss
        else:
            ev_per_risk = -1.0  # naked setups sink
        # Structural preference: condor > butterfly in rich_neutral; in
        # all other regimes the bonuses are zero. SHR-2: when tail risk
        # is elevated, suppress the structural bonus so derated short-vol
        # setups don't piggyback on it past long-vol candidates.
        if regime == "rich_neutral" and tail_risk_score < 0.6:
            structural = {
                "iron_condor": 2,
                "iron_butterfly": 1,
                "short_strangle": 0,
                "short_straddle": 0,
            }.get(s.setup_id, 0)
        else:
            structural = 0
        rr = s.risk_reward if s.risk_reward is not None else 0.0
        return (defined_bonus, structural, ev_per_risk, rr)

    candidates.sort(key=_sort_key, reverse=True)

    # Wave V V5: attach pre-trade fill forecasts. Done after sorting so we
    # only pay the chain-lookup cost on the candidates the caller will
    # actually receive. Each forecast is independent - a failure on one
    # setup must not fail the others or the whole list.
    candidates = [_attach_fill_forecast(s, chain) for s in candidates]

    # SHR-4: emit a "skip" outcome when EV is poor across the board OR
    # tail risk is extreme OR (low confidence AND elevated tail risk).
    # The skip is inserted at index 0 with the best-of-bad alternatives
    # following so the FE renders a "no trade" callout but keeps the
    # alternatives visible for transparency.
    confidence = claude_confidence
    all_ev_negative = bool(candidates) and all(
        s.expected_value <= 0 for s in candidates
    )
    extreme_tail = tail_risk_score >= 0.85
    low_conf_with_tail = (
        confidence is not None
        and confidence <= 0.40
        and tail_risk_score >= 0.6
    )
    if all_ev_negative or extreme_tail or low_conf_with_tail:
        skip_setup = _build_skip_setup(
            tail_risk_score=tail_risk_score,
            confidence=confidence,
            reasons=tail_risk_reasons,
        )
        # Top-3 = skip + best-of-bad alternatives so the analyst sees
        # WHAT we'd have picked if forced.
        return [skip_setup] + candidates[:2]

    return candidates[:3]


# ---------------------------------------------------------------------------
# Back-compat: structured setup_id -> legacy ``top_setup`` string
# ---------------------------------------------------------------------------


_SETUP_ID_TO_LEGACY: dict[str, str] = {
    "iron_condor": "iron condor",
    "iron_butterfly": "iron butterfly",
    "short_strangle": "short strangle",
    "short_straddle": "short strangle",  # nearest legacy vocab match
    "bear_call_spread": "bear call spread",
    "bull_put_spread": "bull put spread",
    "bull_call_spread": "bull call spread",
    "bear_put_spread": "bear put spread",
    "long_call": "long call",
    "long_put": "long put",
    "long_straddle": "long straddle",
    "long_strangle": "long straddle",  # legacy literal lacks long_strangle
    "calendar_spread": "calendar spread",
    "diagonal_spread": "diagonal spread",
    # SHR-4 / SHR-6: skip flows through to the legacy ``top_setup``
    # so the existing FE renders a no-trade callout when this is set.
    "skip": "skip",
}


def setup_id_to_legacy_top_setup(setup_id: str | None) -> str | None:
    if setup_id is None:
        return None
    return _SETUP_ID_TO_LEGACY.get(setup_id)
