"""Parameter defaults + Optuna search space for Opening Range Breakout.

Separate module so tuning metadata and default values stay in one place and
can be imported by report-gen / notebooks without pulling in the
intraday-simulator from ``strategy.py``.

See ``spec.md`` next to this file for the academic rationale for every knob.
"""

from __future__ import annotations

from typing import Any

from tuner.search import Categorical, FloatRange, IntRange


# --------------------------------------------------------------------------- #
# Universe profiles                                                           #
# --------------------------------------------------------------------------- #
# The ORB "universe" is a small, curated ETF basket. The canonical Zarattini
# result lives on TQQQ; the design spec's default includes QQQ so we don't
# tune on a single instrument.
#
# NOTE (audit P0-5, 2026-04): TQQQ / SPXL (3x leveraged ETFs) were removed
# from ``all_leveraged`` and the profile narrowed to SPY+QQQ. A long-only
# ORB on leveraged ETFs in a 2023-24 bull window captured compounded 3x
# beta, not opening-range-breakout edge, and was the single largest
# contributor to the spurious 8.34 Sharpe. This change is permanent and
# NOT tuner-reachable.
# NOTE (audit A1#2, 2026-04): ``all_leveraged`` was removed entirely —
# after the P0-5 narrowing it was a duplicate of ``spy_qqq`` (both
# mapped to SPY+QQQ), so Optuna wasted ~1/3 of trials re-sampling the
# same universe under a different name. ``spy_qqq`` is the canonical
# key; ``qqq_tqqq`` is retained as a historical alias for QQQ-only.
UNIVERSE_PROFILES: dict[str, tuple[str, ...]] = {
    "spy_qqq": ("SPY", "QQQ"),
    "qqq_tqqq": ("QQQ",),
}


# --------------------------------------------------------------------------- #
# Defaults                                                                    #
# --------------------------------------------------------------------------- #
DEFAULTS: dict[str, Any] = {
    # Opening range window
    "or_minutes": 5,
    # No new entries after this hour (ET); keeps runway for EOD flat
    "entry_cutoff_hour_et": 14,
    # "or_bound" = hard stop at OR-low/high; "or_midpoint_trail" adds a trail
    "stop_method": "or_bound",
    # Entry volume ≥ multiplier * mean(OR-bar volume); ≤1.0 disables the
    # filter. NOTE (audit P0-7, 2026-04): default bumped 1.0 -> 1.2 so the
    # gate actually fires; the tuner previously landed at 0.8622, which
    # turned the noise guard off on every breakout.
    "volume_confirm_min": 1.2,
    # Universe profile key; see UNIVERSE_PROFILES above
    "universe_profile": "qqq_tqqq",
    # Whether to take shorts on OR-low breaks
    "allow_shorts": False,
    # Fibonacci extensions for take-profit scale-outs (fractions of OR range)
    "tp1_fib": 1.272,
    "tp2_fib": 1.618,
    # Per-trade equity-at-risk fraction
    "risk_per_trade": 0.01,
    # ---- fixed / non-tuner params ----
    # Final EOD MOC exit time (ET) — hard-coded per Zarattini / industry practice
    "session_end_hour_et": 15,
    "session_end_minute_et": 55,
    # Cost model: charged on every entry and every exit
    "commission_bps": 0.5,
    "slippage_bps": 2.0,
    # Notional cap. NOTE (audit P0-6, 2026-04): raised from 0.20 -> 1.00
    # because a per-symbol notional clip tighter than risk-per-trade sizing
    # compresses daily-return σ harder than μ (classic Sharpe-inflation
    # lever). At 1.00 the clip is effectively inert for SPY/QQQ given
    # typical OR widths, so σ and μ are clipped identically.
    "max_notional_pct": 1.00,
    # Fraction of the position taken off at each TP (the remainder rides to EOD)
    "tp_scale_fraction": 1.0 / 3.0,
}


# --------------------------------------------------------------------------- #
# Search space                                                                #
# --------------------------------------------------------------------------- #
def search_space() -> dict[str, Any]:
    """Optuna search space. Matches the ranges in the design spec."""

    return {
        "or_minutes": Categorical([5, 15, 30]),
        "entry_cutoff_hour_et": IntRange(11, 15),
        "stop_method": Categorical(["or_bound", "or_midpoint_trail"]),
        # Lower bound pinned at 1.0 per audit P0-7 — values below 1.0
        # disable the filter entirely (spec §5); previously the tuner
        # could land on 0.8622 which turned off the noise guard.
        "volume_confirm_min": FloatRange(1.0, 1.5),
        "universe_profile": Categorical(
            ["spy_qqq", "qqq_tqqq"]
        ),
        "allow_shorts": Categorical([True, False]),
        "tp1_fib": FloatRange(1.0, 1.5),
        "tp2_fib": FloatRange(1.5, 2.5),
        "risk_per_trade": FloatRange(0.005, 0.02),
    }


__all__ = [
    "DEFAULTS",
    "UNIVERSE_PROFILES",
    "search_space",
]
