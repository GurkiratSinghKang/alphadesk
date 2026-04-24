"""Parameter defaults + Optuna search space for RSI(2) Mean-Reversion.

See ``spec.md`` for the academic rationale for each knob.
"""

from __future__ import annotations

from pydantic import Field

from strategies._core.contracts import StrategyParams


# --------------------------------------------------------------------------- #
# Universe seed list                                                          #
# --------------------------------------------------------------------------- #
CORE_ETFS: tuple[str, ...] = ("SPY", "QQQ", "IWM")

LARGE_CAP_SEED: tuple[str, ...] = (
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "AVGO",
    "ORCL", "CRM", "ADBE", "AMD", "INTC", "CSCO", "QCOM", "TXN", "IBM",
    "NFLX", "PYPL",
    "WMT", "COST", "HD", "LOW", "MCD", "SBUX", "NKE", "TGT", "KO", "PEP",
    "DIS", "CMCSA",
    "JPM", "BAC", "WFC", "GS", "MS", "C", "BLK", "SCHW", "AXP", "V", "MA",
    "UNH", "JNJ", "PFE", "MRK", "ABBV", "LLY", "TMO", "ABT", "AMGN", "BMY",
    "CVS",
    "XOM", "CVX", "CAT", "BA", "HON", "UPS", "DE", "GE", "LMT", "RTX",
    "NEE", "UNP",
)


# --------------------------------------------------------------------------- #
# Params                                                                      #
# --------------------------------------------------------------------------- #
class RSI2Params(StrategyParams):
    """Typed Pydantic-v2 params model for rsi2_reversal."""

    rsi_period: int = Field(
        default=2, ge=1, le=10,
        json_schema_extra={"tune": {"type": "categorical", "choices": [2, 3]}},
    )
    rsi_entry_max: float = Field(
        default=10.0, gt=0.0, le=100.0,
        json_schema_extra={"tune": {"low": 3.0, "high": 15.0, "type": "float"}},
    )
    connors_entry_max: float = Field(
        default=15.0, gt=0.0, le=100.0,
        json_schema_extra={"tune": {"low": 10.0, "high": 25.0, "type": "float"}},
    )
    trend_sma_period: int = Field(
        default=200, gt=0,
        json_schema_extra={"tune": {"type": "categorical", "choices": [100, 150, 200]}},
    )
    stop_lookback_bars: int = Field(
        default=5, ge=1, le=30,
        json_schema_extra={"tune": {"low": 3, "high": 8, "type": "int"}},
    )
    time_stop_days: int = Field(
        default=6, ge=1, le=30,
        json_schema_extra={"tune": {"low": 4, "high": 10, "type": "int"}},
    )
    exit_sma_period: int = Field(
        default=5, gt=0,
        json_schema_extra={"tune": {"type": "categorical", "choices": [3, 5, 8]}},
    )
    rsi_exit_min: float = Field(
        default=70.0, gt=0.0, le=100.0,
        json_schema_extra={"tune": {"low": 55.0, "high": 80.0, "type": "float"}},
    )
    max_positions: int = Field(
        default=5, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [3, 5, 8]}},
    )
    allocation_per_trade: float = Field(
        default=0.20, gt=0.0, le=1.0,
        json_schema_extra={"tune": {"low": 0.10, "high": 0.25, "type": "float"}},
    )
    volume_surge_min: float = Field(
        default=1.2, gt=0.0,
        json_schema_extra={"tune": {"low": 1.0, "high": 1.8, "type": "float"}},
    )
    spy_rsi_regime_floor: float = Field(
        default=10.0, ge=0.0, le=100.0,
        json_schema_extra={"tune": {"low": 5.0, "high": 20.0, "type": "float"}},
    )
    earnings_skip_days: int = Field(default=3, ge=0, le=30)
    adv_usd_min: float = Field(default=5.0e7, ge=0.0)
    crsi_rsi_period: int = Field(default=3, gt=0)
    crsi_streak_period: int = Field(default=2, gt=0)
    crsi_pct_rank_period: int = Field(default=100, gt=0)


__all__ = ["RSI2Params", "CORE_ETFS", "LARGE_CAP_SEED"]
