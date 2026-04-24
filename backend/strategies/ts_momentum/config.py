"""TSMOM parameter defaults and tuner search space — SOTA shell.

Single source of truth for every knob the strategy exposes. Defaults come
from Moskowitz-Ooi-Pedersen 2012 (12-month signal, 10% target vol, monthly
rebalance) adapted to the equity-ETF universe per Hurst-Ooi-Pedersen 2013.
See ``spec.md`` §3 for the math and §5 for why the ranges are narrow.

The ``TSMomentumParams`` model is a Pydantic-v2 :class:`StrategyParams`
subclass; tunable fields declare their Optuna distribution via
``json_schema_extra`` so :meth:`StrategyParams.tune_space` auto-derives the
search space.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


# --------------------------------------------------------------------------- #
# Ticker universes                                                            #
# --------------------------------------------------------------------------- #
UNIVERSE_MINIMAL_6: tuple[str, ...] = (
    "SPY", "EFA", "IEF", "TLT", "GLD", "DBC",
)

UNIVERSE_FULL_11: tuple[str, ...] = (
    "SPY", "EFA", "EEM",
    "IEF", "TLT", "LQD", "HYG",
    "GLD", "DBC", "UUP", "VNQ",
)

_UNIVERSE_MAP: dict[str, tuple[str, ...]] = {
    "minimal_6": UNIVERSE_MINIMAL_6,
    "full_11": UNIVERSE_FULL_11,
}


# --------------------------------------------------------------------------- #
# Params                                                                      #
# --------------------------------------------------------------------------- #
class TSMomentumParams(StrategyParams):
    """Typed Pydantic-v2 params model for the TSMOM strategy.

    Defaults mirror the legacy ``DEFAULT_PARAMS`` dict byte-for-byte.
    """

    lookback_months: int = Field(
        default=12,
        ge=1,
        le=12,
        json_schema_extra={"tune": {"type": "categorical", "choices": [6, 9, 12]}},
    )
    signal_ensemble: Literal["single_12m", "ensemble_1_3_6_12"] = Field(
        default="single_12m",
        json_schema_extra={
            "tune": {
                "type": "categorical",
                "choices": ["single_12m", "ensemble_1_3_6_12"],
            }
        },
    )
    target_vol: float = Field(
        default=0.10,
        gt=0.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.06, "high": 0.15, "type": "float"}},
    )
    rebalance_freq: Literal["monthly", "bimonthly"] = Field(
        default="monthly",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["monthly", "bimonthly"]}
        },
    )
    realized_vol_window: int = Field(
        default=60,
        ge=10,
        le=252,
        json_schema_extra={"tune": {"type": "categorical", "choices": [30, 60, 90]}},
    )
    max_weight_per_asset: float = Field(
        default=0.20,
        gt=0.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.15, "high": 0.35, "type": "float"}},
    )
    drawdown_delever_threshold: float = Field(
        default=0.10,
        ge=0.0,
        json_schema_extra={"tune": {"low": 0.08, "high": 0.20, "type": "float"}},
    )
    shorts_enabled: bool = Field(
        default=True,
        json_schema_extra={"tune": {"type": "categorical", "choices": [True, False]}},
    )
    universe_size: Literal["minimal_6", "full_11"] = Field(
        default="minimal_6",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["minimal_6", "full_11"]}
        },
    )
    vol_floor: float = Field(default=0.05, ge=0.0, le=1.0)
    target_vol_gross_mul: float = Field(default=1.0, gt=0.0)


# --------------------------------------------------------------------------- #
# Pure helpers (used by strategy.py)                                          #
# --------------------------------------------------------------------------- #
def universe_tickers(params: TSMomentumParams) -> tuple[str, ...]:
    """Return the ticker tuple for the params' universe size."""
    return _UNIVERSE_MAP[params.universe_size]


def signal_lookback_days(params: TSMomentumParams) -> tuple[int, ...]:
    """Lookbacks in trading days for the sign-of-return signal.

    - ``single_12m`` -> ``(lookback_months * 21,)``
    - ``ensemble_1_3_6_12`` -> ``(21, 63, 126, 252)``
    """
    if params.signal_ensemble == "single_12m":
        return (int(params.lookback_months * 21),)
    return (21, 63, 126, 252)


def max_lookback_days(params: TSMomentumParams) -> int:
    """Largest signal lookback, in trading days."""
    return max(signal_lookback_days(params))


__all__ = [
    "TSMomentumParams",
    "UNIVERSE_MINIMAL_6",
    "UNIVERSE_FULL_11",
    "universe_tickers",
    "signal_lookback_days",
    "max_lookback_days",
]
