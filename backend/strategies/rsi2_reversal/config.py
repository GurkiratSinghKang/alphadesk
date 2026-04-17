"""Parameter defaults + Optuna search space for RSI(2) Mean-Reversion.

Kept as a module so tuning metadata and default values stay in one place and
can be imported by notebooks / reports without pulling in the engine-heavy
:mod:`.strategy` module.

See :mod:`backend.strategies.rsi2_reversal.spec` (the ``spec.md`` next to
this file) for the academic rationale for each knob.
"""

from __future__ import annotations

from typing import Any

from backend.tuner.search import Categorical, FloatRange, IntRange


# --------------------------------------------------------------------------- #
# Defaults                                                                    #
# --------------------------------------------------------------------------- #
DEFAULTS: dict[str, Any] = {
    # RSI primary gate (textbook Connors: RSI(2) < 10)
    "rsi_period": 2,
    "rsi_entry_max": 10.0,
    # ConnorsRSI disjunct (OR-gate; both components loosen entry)
    "connors_entry_max": 15.0,
    # Trend filter (classic 200-SMA)
    "trend_sma_period": 200,
    # Stops
    "stop_lookback_bars": 5,
    "time_stop_days": 6,
    # Exits
    "exit_sma_period": 5,
    "rsi_exit_min": 70.0,
    # Sizing
    "max_positions": 5,
    "allocation_per_trade": 0.20,
    # Filters
    "volume_surge_min": 1.2,
    "spy_rsi_regime_floor": 10.0,
    # Universe selection (fixed; not tuned)
    "earnings_skip_days": 3,
    "adv_usd_min": 5.0e7,
    # ConnorsRSI internal configuration (fixed; not tuned)
    "crsi_rsi_period": 3,
    "crsi_streak_period": 2,
    "crsi_pct_rank_period": 100,
}


# --------------------------------------------------------------------------- #
# Universe seed list                                                          #
# --------------------------------------------------------------------------- #
# ETF core + mega-cap seed. We filter this down to the ADV > adv_usd_min
# subset once per backtest. Broad-based S&P 100 plus a handful of ultra-liquid
# names the original Connors system targets.
CORE_ETFS: tuple[str, ...] = ("SPY", "QQQ", "IWM")

LARGE_CAP_SEED: tuple[str, ...] = (
    # Mega-cap tech
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "AVGO",
    "ORCL", "CRM", "ADBE", "AMD", "INTC", "CSCO", "QCOM", "TXN", "IBM",
    "NFLX", "PYPL",
    # Consumer
    "WMT", "COST", "HD", "LOW", "MCD", "SBUX", "NKE", "TGT", "KO", "PEP",
    "DIS", "CMCSA",
    # Financials
    "JPM", "BAC", "WFC", "GS", "MS", "C", "BLK", "SCHW", "AXP", "V", "MA",
    # Healthcare
    "UNH", "JNJ", "PFE", "MRK", "ABBV", "LLY", "TMO", "ABT", "AMGN", "BMY",
    "CVS",
    # Industrials / energy / materials
    "XOM", "CVX", "CAT", "BA", "HON", "UPS", "DE", "GE", "LMT", "RTX",
    "NEE", "UNP",
)


# --------------------------------------------------------------------------- #
# Search space (for Optuna)                                                   #
# --------------------------------------------------------------------------- #
def search_space() -> dict[str, Any]:
    """Optuna search space. Matches the ranges in the design spec."""

    return {
        "rsi_period": Categorical([2, 3]),
        "rsi_entry_max": FloatRange(3.0, 15.0),
        "connors_entry_max": FloatRange(10.0, 25.0),
        "trend_sma_period": Categorical([100, 150, 200]),
        "stop_lookback_bars": IntRange(3, 8),
        "time_stop_days": IntRange(4, 10),
        "exit_sma_period": Categorical([3, 5, 8]),
        "rsi_exit_min": FloatRange(55.0, 80.0),
        "max_positions": Categorical([3, 5, 8]),
        "allocation_per_trade": FloatRange(0.10, 0.25),
        "volume_surge_min": FloatRange(1.0, 1.8),
        "spy_rsi_regime_floor": FloatRange(5.0, 20.0),
    }


__all__ = [
    "DEFAULTS",
    "CORE_ETFS",
    "LARGE_CAP_SEED",
    "search_space",
]
