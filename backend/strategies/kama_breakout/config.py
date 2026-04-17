"""Default parameters and tuner search space for the KAMA Breakout strategy.

This module exists so that params can be introspected without importing the
strategy class (the class imports a lot more). Kept tiny on purpose.

See ``spec.md`` for the academic rationale behind each default. Numeric
choices follow Kaufman's textbook values ("Trading Systems and Methods",
5th ed., ch. 17) and the original Turtle system (Faith, 2007).
"""

from __future__ import annotations

from typing import Any

from backend.tuner.search import Categorical, FloatRange


# --------------------------------------------------------------------------- #
# Default universe                                                            #
# --------------------------------------------------------------------------- #
# Broad, diversified ETF basket. Always-liquid, no point-in-time
# constituent-membership problem. Strategy accepts a ``universe_symbols``
# override from params.
DEFAULT_UNIVERSE: tuple[str, ...] = (
    "SPY",
    "QQQ",
    "IWM",
    "XLE",
    "XLF",
    "XLK",
    "XLV",
    "XLI",
    "XLP",
    "XLU",
    "XLY",
    "XLB",
    "XLRE",
    "XLC",
)


# --------------------------------------------------------------------------- #
# Numeric defaults                                                            #
# --------------------------------------------------------------------------- #
# Every runtime knob the strategy consumes. Any param not listed here must be
# added to both DEFAULTS and ``search_space()``; the strategy ``configure``
# method coerces types and validates.
DEFAULTS: dict[str, Any] = {
    # KAMA
    "kama_er_period": 10,
    "kama_fast": 2,
    "kama_slow": 30,
    # Donchian channel (entry breakout)
    "donchian_period": 20,
    # ATR (chandelier stop + sizing)
    "atr_period": 22,
    "chandelier_atr_mult": 3.0,
    # Secular trend filter
    "trend_sma_period": 200,
    # ER gate (the FIX: use ER to gate entries, not just log it)
    "er_min_trend": 0.30,
    # Volatility-parity sizing
    "risk_per_trade": 0.01,  # 1% of equity at risk if stop hits
    "max_positions": 8,
    "max_allocation": 0.15,  # 15% of equity per name
    # Volume surge (off by default for ETFs; on for single-names)
    "volume_surge_enabled": False,
    "volume_surge_min": 1.2,
    "volume_sma_period": 20,
    # Pyramiding
    "pyramid_enabled": True,
    "pyramid_trigger_atr": 1.0,  # add at +1 ATR move
    "pyramid_size_fraction": 0.5,  # half the original size
    # Earnings window (degrades gracefully if provider absent)
    "earnings_skip_days": 2,
    # Universe (string-tuple or list)
    "universe_symbols": DEFAULT_UNIVERSE,
}


# --------------------------------------------------------------------------- #
# Tuner search space                                                          #
# --------------------------------------------------------------------------- #
def search_space() -> dict[str, Any]:
    """Return the Optuna search space.

    Ranges are wide enough to let the tuner find regime-optimal values without
    overfitting. Integer-valued periods are modelled as ``Categorical`` over a
    small shortlist (avoids nonsensical fractional periods and keeps TPE's
    conditional-marginal model simple).
    """

    return {
        # KAMA
        "kama_er_period": Categorical([8, 10, 14]),
        "kama_fast": Categorical([2, 3]),
        "kama_slow": Categorical([20, 30]),
        # Donchian
        "donchian_period": Categorical([15, 20, 30, 55]),
        # ATR
        "atr_period": Categorical([14, 22]),
        "chandelier_atr_mult": FloatRange(2.0, 4.0),
        # Trend filter
        "trend_sma_period": Categorical([100, 150, 200]),
        # ER gate (the fix)
        "er_min_trend": FloatRange(0.2, 0.5),
        # Sizing
        "risk_per_trade": FloatRange(0.005, 0.02),
        "max_positions": Categorical([5, 8, 12]),
        "max_allocation": FloatRange(0.08, 0.20),
        # Volume surge
        "volume_surge_min": FloatRange(1.0, 1.5),
        # Pyramiding on/off
        "pyramid_enabled": Categorical([True, False]),
    }


__all__ = [
    "DEFAULT_UNIVERSE",
    "DEFAULTS",
    "search_space",
]
