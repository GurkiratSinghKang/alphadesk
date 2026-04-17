"""Parameter defaults and Optuna search space for the VWAP session-pullback strategy.

Kept standalone so tuning metadata stays importable without pulling in the
engine-heavy :mod:`.strategy` module.

See :mod:`backend.strategies.vwap.spec` for the academic rationale per knob.
"""

from __future__ import annotations

from typing import Any

from backend.tuner.search import Categorical, FloatRange


# --------------------------------------------------------------------------- #
# Defaults                                                                    #
# --------------------------------------------------------------------------- #
DEFAULTS: dict[str, Any] = {
    # Pullback window (fraction of price, not bps) — how close to VWAP the
    # retrace must get before we consider an entry.
    "pullback_pct_max": 0.0015,  # 15 bps (0.15%)
    # RSI timing on 5-min bars — short-oscillator Connors-style.
    "rsi_period": 2,
    "rsi_entry_max": 15.0,  # long enters when RSI < this; short mirrors
    # Stop: max of bps-below-VWAP and 1×ATR(5min,14). Bps floor.
    "stop_bps_or_atr_max": 50.0,  # 50 bps default floor
    # Take-profit: multiplier on 20-bar rolling std of (close − VWAP)
    "tp_sigma_band": 1.0,
    # Daily trend filter applied to each name's own daily SMA, plus
    # SPY > SPY.SMA(100) as a systemic gate.
    "trend_sma_daily": 100,
    # Shorts flag.
    "allow_shorts": False,
    # Sizing
    "max_positions": 3,
    "max_allocation": 0.15,
}


# --------------------------------------------------------------------------- #
# Universe (fixed — 10 deep-liquidity names)                                   #
# --------------------------------------------------------------------------- #
UNIVERSE: tuple[str, ...] = (
    "SPY",
    "QQQ",
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "META",
    "TSLA",
    "GOOGL",
    "AMD",
)

# Systemic trend filter is gated on SPY.
SPY: str = "SPY"


# --------------------------------------------------------------------------- #
# Search space                                                                #
# --------------------------------------------------------------------------- #
def search_space() -> dict[str, Any]:
    """Optuna search space. Matches §5 of spec.md."""

    return {
        "pullback_pct_max": FloatRange(0.0005, 0.0030),
        "rsi_entry_max": FloatRange(10.0, 25.0),
        "rsi_period": Categorical([2, 3, 5]),
        "stop_bps_or_atr_max": FloatRange(30.0, 80.0),
        "tp_sigma_band": FloatRange(0.5, 2.0),
        "trend_sma_daily": Categorical([50, 100, 200]),
        "allow_shorts": Categorical([True, False]),
        "max_positions": Categorical([2, 3, 5]),
        "max_allocation": FloatRange(0.10, 0.25),
    }


__all__ = [
    "DEFAULTS",
    "UNIVERSE",
    "SPY",
    "search_space",
]
