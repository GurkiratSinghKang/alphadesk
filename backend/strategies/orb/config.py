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
UNIVERSE_PROFILES: dict[str, tuple[str, ...]] = {
    "spy_qqq": ("SPY", "QQQ"),
    "qqq_tqqq": ("QQQ", "TQQQ"),
    "all_leveraged": ("SPY", "QQQ", "TQQQ", "SPXL"),
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
    # Entry volume ≥ multiplier * mean(OR-bar volume); ≤1.0 disables the filter
    "volume_confirm_min": 1.0,
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
    # Notional cap to prevent runaway TQQQ-on-TQQQ sizing
    "max_notional_pct": 0.20,
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
        "volume_confirm_min": FloatRange(0.8, 1.5),
        "universe_profile": Categorical(
            ["spy_qqq", "qqq_tqqq", "all_leveraged"]
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
