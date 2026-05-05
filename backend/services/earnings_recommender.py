"""Earnings recommendation engine v2 — Wave 4a / Batch Q.

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
     probability of profit (lognormal), and expected value.

  4. Rank by EV (or Sharpe-like ratio for unlimited-loss setups) and
     return the top 3.

POP estimation uses the lognormal terminal-distribution model:

    P(S_T in [a, b]) = Φ(d_b) - Φ(d_a)

with ``d_x = ln(x / S_0) / (σ √(T/365))`` and σ = current_iv.

Kelly sizing is the classic ``f* = (p(b+1) - 1) / b`` where ``b =
max_profit / max_loss``, capped at 2% of book (full Kelly assumes
infinite trials).
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Iterable, Sequence

from scipy.stats import norm  # type: ignore[import-untyped]

from api.schemas.earnings import EarningsSetup, OptionLeg, SetupId

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


def find_strike_by_delta(
    chain: Any, expiry: date | None, option_type: str, target_delta: float,
) -> Any | None:
    """Pick the contract whose abs(delta) is closest to ``abs(target_delta)``.

    The OptionChain Greeks are pre-computed via Black-Scholes on the
    server (see :class:`services.options.OptionContract`). For puts the
    target_delta is conventionally negative (e.g. ``-0.20``); we compare
    on absolute value.
    """
    contracts = _filter_by_expiry_and_type(chain, expiry, option_type)
    if not contracts:
        return None
    target_abs = abs(target_delta)

    def _key(c: Any) -> float:
        d = getattr(c, "delta", None)
        if d is None:
            return float("inf")
        return abs(abs(float(d)) - target_abs)

    return min(contracts, key=_key)


def find_strike_nearest(
    chain: Any, expiry: date | None, option_type: str, target_strike: float,
) -> Any | None:
    """Pick the contract with strike closest to ``target_strike``."""
    contracts = _filter_by_expiry_and_type(chain, expiry, option_type)
    if not contracts:
        return None
    return min(contracts, key=lambda c: abs(float(c.strike) - target_strike))


# ---------------------------------------------------------------------------
# Probability of profit (lognormal terminal distribution)
# ---------------------------------------------------------------------------


def compute_pop(
    spot: float,
    breakevens: Sequence[float],
    iv: float,
    dte_days: float,
    profitable_zone: str,
) -> float:
    """Probability that the underlying ends in the profitable zone.

    Uses the simple lognormal model with zero drift. ``iv`` is the
    annualised implied volatility (e.g. 0.40 for 40%) and ``dte_days``
    is calendar days to expiry.

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

    Returns
    -------
    float in [0, 1]
    """
    if iv <= 0 or dte_days <= 0 or spot <= 0 or not breakevens:
        return 0.0
    sigma = iv * math.sqrt(dte_days / 365.0)
    if sigma <= 0:
        return 0.0
    sorted_be = sorted(float(b) for b in breakevens if b is not None and b > 0)
    if not sorted_be:
        return 0.0
    # Map breakevens to standardised log-returns under the lognormal model.
    # We use zero drift (no rate / no carry) — appropriate for short-dated
    # event-driven trades where r·tau is < 0.001 vs σ·√τ ≈ 0.10.
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


# ---------------------------------------------------------------------------
# Kelly sizing
# ---------------------------------------------------------------------------


def kelly_fraction(pop: float, b: float, cap: float = 0.02) -> float:
    """Kelly-criterion bet fraction.

    f* = (p(b+1) - 1) / b   where b = max_profit / max_loss

    Capped at 2% of book — full Kelly assumes infinite trials and a
    stable edge, neither of which holds for one-shot earnings plays.
    """
    if b <= 0 or pop <= 0 or pop >= 1:
        return 0.0
    f = (pop * (b + 1.0) - 1.0) / b
    return float(max(0.0, min(f, cap)))


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
    rank = iv_rank if iv_rank is not None else None
    ratio = iv_to_hv_ratio if iv_to_hv_ratio is not None else None
    is_iv_rich = (rank is not None and rank >= 70) or (ratio is not None and ratio >= 1.5)
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


# ─── Iron condor (rich_neutral) ──────────────────────────────


def _build_iron_condor(ctx: _BuildContext) -> EarningsSetup | None:
    short_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -0.20)
    long_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -0.10)
    short_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", 0.20)
    long_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", 0.10)
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "between")
    ev = pop * max_profit - (1.0 - pop) * max_loss
    rr = max_profit / max_loss if max_loss > 0 else None
    rationale = (
        f"{_summary_iv_vs_hv(ctx)}. Defined-risk short premium." + _summary_implied_vs_hist(ctx)
    )
    return EarningsSetup(
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
        sizing_kelly_pct=kelly_fraction(pop, max_profit / max_loss),
        is_defined_risk=True,
    )


# ─── Iron butterfly (rich_neutral, very tight expected move) ─


def _build_iron_butterfly(ctx: _BuildContext) -> EarningsSetup | None:
    atm_call = find_strike_nearest(ctx.chain, ctx.expiry, "call", ctx.spot)
    atm_put = find_strike_nearest(ctx.chain, ctx.expiry, "put", ctx.spot)
    if not (atm_call and atm_put):
        return None
    # Wing strikes: ~1 expected-move-stdev OTM.
    em_dollars = ctx.expected_move_pct * ctx.spot if ctx.expected_move_pct else ctx.spot * 0.05
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "between")
    ev = pop * max_profit - (1.0 - pop) * max_loss
    return EarningsSetup(
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
        sizing_kelly_pct=kelly_fraction(pop, max_profit / max_loss),
        is_defined_risk=True,
    )


# ─── Short strangle (rich_neutral, naked) ────────────────────


def _build_short_strangle(ctx: _BuildContext) -> EarningsSetup | None:
    short_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -0.20)
    short_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", 0.20)
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "between")
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "between")
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
    short_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", 0.30)
    long_call = find_strike_by_delta(ctx.chain, ctx.expiry, "call", 0.15)
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "below_lower")
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
        sizing_kelly_pct=kelly_fraction(pop, max_profit / max_loss),
        is_defined_risk=True,
    )


# ─── Bull put spread (rich_directional, bullish) ─────────────


def _build_bull_put_spread(ctx: _BuildContext) -> EarningsSetup | None:
    short_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -0.30)
    long_put = find_strike_by_delta(ctx.chain, ctx.expiry, "put", -0.15)
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "above_upper")
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
        sizing_kelly_pct=kelly_fraction(pop, max_profit / max_loss),
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "above_upper")
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
        sizing_kelly_pct=kelly_fraction(pop, max_profit / max_loss),
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "below_lower")
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
        sizing_kelly_pct=kelly_fraction(pop, max_profit / max_loss),
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "above_upper")
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
        sizing_kelly_pct=min(0.02, max(0.0, max_loss / 100.0 / ctx.spot)),
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "below_lower")
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
        sizing_kelly_pct=min(0.02, max(0.0, max_loss / 100.0 / ctx.spot)),
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "outside")
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
        sizing_kelly_pct=min(0.02, max(0.0, max_loss / 100.0 / ctx.spot)),
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "outside")
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
        sizing_kelly_pct=min(0.02, max(0.0, max_loss / 100.0 / ctx.spot)),
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, "between")
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
        sizing_kelly_pct=min(0.02, max(0.0, max_loss / 100.0 / ctx.spot)),
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
    pop = compute_pop(ctx.spot, breakevens, ctx.current_iv, ctx.dte_days, direction)
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
        sizing_kelly_pct=min(0.02, max(0.0, max_loss / 100.0 / ctx.spot)),
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
) -> list[EarningsSetup]:
    """Return ranked top-3 setups by expected value.

    Synchronous in spirit (no awaits), but kept ``async`` so the
    screener can call it from the existing :func:`asyncio.gather` flow
    without an extra thread. If the chain is empty or vol inputs are
    missing, returns an empty list.
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
    log.debug(
        "recommender regime=%s for %s (iv_rank=%s ratio=%s verdict=%s conf=%s)",
        regime, symbol, iv_rank, iv_to_hv, claude_verdict, claude_confidence,
    )
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
    )
    candidates: list[EarningsSetup] = []
    for builder in _candidates_for_regime(regime, claude_verdict):
        try:
            setup = builder(ctx)
        except Exception as e:  # noqa: BLE001
            log.debug("recommender builder %s failed for %s: %s", builder.__name__, symbol, e)
            setup = None
        if setup is not None:
            candidates.append(setup)
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
        # all other regimes the bonuses are zero.
        if regime == "rich_neutral":
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
}


def setup_id_to_legacy_top_setup(setup_id: str | None) -> str | None:
    if setup_id is None:
        return None
    return _SETUP_ID_TO_LEGACY.get(setup_id)
