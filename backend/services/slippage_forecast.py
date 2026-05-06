"""Pre-trade slippage forecaster — Wave V V5.

When the recommender says "iron condor for $6.62 net credit at mid", the
real fill is often closer to $6.40 because of bid-ask slippage. Showing
the user an honest expected fill BEFORE they trade is the difference
between a tool that looks good on paper and a tool that prepares the
operator for what actually happens at the exchange.

This module estimates per-leg fill cost from the spread and the per-
contract liquidity score (Wave V Agent 1), then sums signed per-leg
slippages into a combo-level :class:`ComboFillForecast`.

Slippage model
--------------
Per-leg expected slippage (added to mid) = ``spread × fraction × penalty``

  * ``fraction`` depends on the user's chosen fill mode:

    - ``patient``  (mid-walk; default): ``0.10`` — typical for a patient
      walker that posts at mid and re-prices toward the touch every few
      seconds. On most names you fill within 10% of the spread.
    - ``immediate``: ``0.50`` — cross half the spread (worst case for a
      market order).

  * ``penalty`` adjusts for liquidity:

    - score ≥ 0.7 → ``1.0`` (no penalty; tight markets fill at mid)
    - 0.4 ≤ score < 0.7 → ``1.5`` (medium markets need help)
    - score < 0.4 → ``2.5`` (illiquid; expect wide marks to drift)
    - score is None → ``1.0`` (graceful degradation; legacy chains pre-
      Agent 1 ship don't carry the field — we don't punish them)

The signed combo slippage sums per-leg signed contributions:

  * ``side="buy"``  → positive slippage (you pay more)
  * ``side="sell"`` → negative slippage (you receive less; subtracted
    from the credit)

So a credit combo's expected fill = target_mid - |sum(slippage)| and a
debit combo's expected fill = target_mid + |sum(slippage)|.

Confidence buckets
------------------
The p10/p90 range is a heuristic ±50% spread of the expected slippage:

  * ``p10`` = better-case fill: expected_fill - 0.5 × |slippage|
  * ``p90`` = worse-case fill:  expected_fill + 0.5 × |slippage|

Confidence is bucketed from the worst leg's liquidity score:

  * worst score ≥ 0.7 → ``"high"``
  * 0.4 ≤ worst < 0.7 → ``"medium"``
  * worst < 0.4 OR any leg has score=None → ``"low"``

The ``low`` bucket on score=None is a deliberate caution flag — without
the per-contract liquidity signal we cannot distinguish a tight chain
from a thin one, so we tell the user we cannot vouch for the estimate.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

# ``ComboFillForecast`` lives on the wire contract (``api.schemas.earnings``)
# so the response model can carry it directly via ``EarningsSetup.fill_forecast``
# without forcing schemas → services imports. We re-export it here so callers
# inside services can import the input + output types from one module.
from api.schemas.earnings import ComboFillForecast

log = logging.getLogger(__name__)


FillMode = Literal["patient", "immediate"]
ConfidenceBucket = Literal["high", "medium", "low"]


@dataclass
class OptionLegWithMarks:
    """Input shape for the forecaster — one leg with bid/ask + liquidity.

    Bag-of-fields rather than a Pydantic model so the recommender can
    construct it cheaply from the live OptionContract instance without
    re-validating Greeks. Used by :func:`forecast_combo_fill`.

    ``liquidity_score`` is None on chains pre-dating Wave V Agent 1; the
    forecaster degrades gracefully (no penalty applied, but confidence
    bucket falls to ``"low"``).
    """

    side: Literal["buy", "sell"]
    bid: float
    ask: float
    mid: float
    liquidity_score: float | None = None
    qty: int = 1


__all__ = ["ComboFillForecast", "OptionLegWithMarks", "FillMode", "forecast_combo_fill"]


def _bucket_for_score(score: float | None) -> ConfidenceBucket:
    """Map a single leg's liquidity score to a confidence bucket.

    None → ``"low"`` so combos with any unmeasured leg fall to low.
    """
    if score is None:
        return "low"
    if score >= 0.7:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"


def _liquidity_penalty(score: float | None) -> float:
    """Multiplier applied to the spread-fraction slippage.

    See module docstring. None returns 1.0 (no penalty) so legacy chains
    don't get a synthetic warning attached to them — but the confidence
    bucket still falls to ``"low"`` via :func:`_bucket_for_score`.
    """
    from core.config import settings as _settings

    high_thr = _settings.SLIPPAGE_FORECAST_HIGH_LIQUIDITY_THRESHOLD
    med_thr = _settings.SLIPPAGE_FORECAST_MEDIUM_LIQUIDITY_THRESHOLD

    if score is None:
        return 1.0
    if score >= high_thr:
        return 1.0
    if score >= med_thr:
        return 1.5
    return 2.5


def _combine_buckets(buckets: list[ConfidenceBucket]) -> ConfidenceBucket:
    """Combo confidence = worst-leg confidence."""
    if not buckets:
        return "low"
    if "low" in buckets:
        return "low"
    if "medium" in buckets:
        return "medium"
    return "high"


def forecast_combo_fill(
    legs: list[OptionLegWithMarks],
    fill_mode: FillMode = "patient",
) -> ComboFillForecast | None:
    """Predict the fill price range for a combo order.

    Sums signed per-leg slippages into a combo total. Returns None when
    the leg set is empty, when any leg is missing usable bid/ask, or when
    the combo's signed mid doesn't make sense (e.g. all-zero quotes).

    Per the recommender contract: NEVER raise on bad input — the caller
    treats None as "no forecast available" and continues without it.
    """
    if not legs:
        return None

    from core.config import settings as _settings

    if fill_mode == "patient":
        fraction = _settings.SLIPPAGE_FORECAST_PATIENT_FRACTION
    elif fill_mode == "immediate":
        fraction = _settings.SLIPPAGE_FORECAST_IMMEDIATE_FRACTION
    else:  # defensive — Literal narrows but a runtime caller could pass garbage
        log.debug("forecast_combo_fill: unknown fill_mode %r, falling back to patient", fill_mode)
        fraction = _settings.SLIPPAGE_FORECAST_PATIENT_FRACTION

    target_mid = 0.0
    signed_slippage = 0.0
    abs_slippage = 0.0
    leg_buckets: list[ConfidenceBucket] = []
    bad_quote_count = 0
    none_score_count = 0
    illiquid_count = 0
    total_qty = 0

    for leg in legs:
        try:
            bid = float(leg.bid)
            ask = float(leg.ask)
            mid = float(leg.mid)
            qty = int(leg.qty) if leg.qty is not None else 1
        except (TypeError, ValueError):
            bad_quote_count += 1
            continue
        if qty <= 0:
            continue
        total_qty += qty

        # Spread must be non-negative; if bid > ask (crossed market) treat as 0.
        spread = max(0.0, ask - bid)

        # Signed mid contribution. Sell legs add to credit (+mid), buy
        # legs subtract from credit (-mid). Net is target_mid.
        sign = 1.0 if leg.side == "sell" else -1.0
        target_mid += sign * mid * qty

        # Per-leg expected slippage (always positive in dollars-of-cost).
        # Apply liquidity penalty.
        penalty = _liquidity_penalty(leg.liquidity_score)
        if leg.liquidity_score is None:
            none_score_count += 1
        elif leg.liquidity_score < 0.4:
            illiquid_count += 1
        leg_slip = spread * fraction * penalty * qty
        # Slippage ALWAYS reduces what the trader keeps. For a sell leg
        # the fill prints below mid (we receive less); for a buy leg the
        # fill prints above mid (we pay more). Either way the leg's
        # signed contribution to expected_fill - target_mid is -leg_slip:
        #   sell:  fill = mid - leg_slip  → contribution = +(mid-leg_slip)
        #          contribution - signed_mid = -leg_slip
        #   buy:   fill = mid + leg_slip  → contribution = -(mid+leg_slip)
        #          contribution - signed_mid = -leg_slip
        signed_slippage -= leg_slip
        abs_slippage += leg_slip

        leg_buckets.append(_bucket_for_score(leg.liquidity_score))

    if not leg_buckets and bad_quote_count > 0:
        # Every leg had bad quotes — bail.
        return None
    if not leg_buckets:
        return None

    # Expected fill: for a credit combo (target_mid > 0), slippage reduces
    # the credit; for a debit combo (target_mid < 0) the magnitude grows.
    # signed_slippage is already directionally correct.
    expected_fill = target_mid + signed_slippage

    # p10/p90 = ±50% of |abs_slippage| around the expected fill. The
    # half-spread bound is a heuristic — when liquidity is high the
    # actual range will be tighter than this, but we'd rather be honest
    # about uncertainty than tight-and-wrong. Slippage ALWAYS hurts
    # (signed_slippage <= 0), so:
    #   p10 = better-case fill = closer to target_mid (less slippage cost)
    #   p90 = worse-case fill  = farther from target_mid (more cost)
    # For a credit combo (target_mid > 0): p10 > expected_fill > p90 > 0
    # For a debit combo (target_mid < 0): p10 > expected_fill > p90 < 0
    # In both cases p10 is the larger number — which is "better for the
    # user" because credit/debit conventions make + better than -.
    half_band = 0.5 * abs_slippage
    p10_fill = expected_fill + half_band
    p90_fill = expected_fill - half_band

    expected_slippage_dollars = abs_slippage * 100.0

    # Combo confidence = worst-leg confidence.
    confidence = _combine_buckets(leg_buckets)

    # Reasoning — short human-readable phrases the FE can render.
    reasoning: list[str] = []
    reasoning.append(
        f"{fill_mode} fill mode ({int(fraction * 100)}% of spread per leg)"
    )
    if illiquid_count > 0:
        reasoning.append(
            f"{illiquid_count} illiquid leg{'s' if illiquid_count != 1 else ''} "
            f"(score < {_settings.SLIPPAGE_FORECAST_MEDIUM_LIQUIDITY_THRESHOLD:.1f}) "
            f"adds 2.5× penalty"
        )
    if none_score_count > 0 and none_score_count == len(leg_buckets):
        reasoning.append("liquidity score unavailable for all legs — confidence low")
    elif none_score_count > 0:
        reasoning.append(
            f"liquidity score unavailable for {none_score_count} leg"
            f"{'s' if none_score_count != 1 else ''}"
        )

    return ComboFillForecast(
        target_mid=round(target_mid, 4),
        expected_fill=round(expected_fill, 4),
        p10_fill=round(p10_fill, 4),
        p90_fill=round(p90_fill, 4),
        expected_slippage_dollars=round(expected_slippage_dollars, 2),
        confidence=confidence,
        reasoning=reasoning,
    )
