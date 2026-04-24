"""Regime-Adaptive asset allocation — parameter defaults and tuner space.

The allocation tables and thresholds are the research surface; the
universe is fixed. Keeping the search space small and bounded is
deliberate — an overfitted regime-switcher is worse than a static allocation.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from strategies._core.contracts import StrategyParams


# --------------------------------------------------------------------------- #
# Universe
# --------------------------------------------------------------------------- #
UNIVERSE: tuple[str, ...] = (
    "SPY", "QQQ", "EFA", "IEF", "TLT", "GLD", "BIL", "VXX",
)
SIGNAL_ONLY: tuple[str, ...] = ("VIXY",)
REGIME_REFERENCE = "SPY"
VIX_PROXY = "VIXY"


# --------------------------------------------------------------------------- #
# Allocation table
# --------------------------------------------------------------------------- #
BASE_ALLOCATIONS: dict[str, dict[str, float]] = {
    "TrendUp": {
        "SPY": 0.40, "QQQ": 0.20, "EFA": 0.10,
        "IEF": 0.15, "TLT": 0.00,
        "GLD": 0.05, "BIL": 0.10, "VXX": 0.00,
    },
    "MeanRevert": {
        "SPY": 0.25, "QQQ": 0.10, "EFA": 0.05,
        "IEF": 0.25, "TLT": 0.15,
        "GLD": 0.05, "BIL": 0.15, "VXX": 0.00,
    },
    "HighVol": {
        "SPY": 0.15, "QQQ": 0.05, "EFA": 0.05,
        "IEF": 0.15, "TLT": 0.30,
        "GLD": 0.10, "BIL": 0.20, "VXX": 0.00,
    },
    "Crisis": {
        "SPY": 0.00, "QQQ": 0.00, "EFA": 0.00,
        "IEF": 0.20, "TLT": 0.30,
        "GLD": 0.15, "BIL": 0.35, "VXX": 0.00,
    },
}

REGIMES: tuple[str, ...] = ("TrendUp", "MeanRevert", "HighVol", "Crisis")


# --------------------------------------------------------------------------- #
# Params
# --------------------------------------------------------------------------- #
class RegimeAdaptiveParams(StrategyParams):
    """Typed Pydantic-v2 params model for regime_adaptive."""

    sma_fast: int = Field(
        default=50, gt=0,
        json_schema_extra={"tune": {"type": "categorical", "choices": [50, 100]}},
    )
    sma_slow: int = Field(
        default=200, gt=0,
        json_schema_extra={"tune": {"type": "categorical", "choices": [150, 200]}},
    )
    vix_low_threshold: float = Field(
        default=20.0, gt=0.0,
        json_schema_extra={"tune": {"low": 15.0, "high": 22.0, "type": "float"}},
    )
    vix_high_threshold: float = Field(
        default=25.0, gt=0.0,
        json_schema_extra={"tune": {"low": 25.0, "high": 35.0, "type": "float"}},
    )
    confirmation_days: int = Field(
        default=10, ge=1,
        json_schema_extra={"tune": {"low": 5, "high": 20, "type": "int"}},
    )
    rebalance_freq: Literal["monthly", "bimonthly"] = Field(
        default="monthly",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["monthly", "bimonthly"]}
        },
    )
    crisis_equity_floor: float = Field(
        default=0.0, ge=0.0, le=0.5,
        json_schema_extra={"tune": {"low": 0.0, "high": 0.15, "type": "float"}},
    )
    defensive_bond_weight: float | None = Field(
        default=None, ge=0.0, le=0.8,
        json_schema_extra={"tune": {"low": 0.3, "high": 0.5, "type": "float"}},
    )
    crisis_slow_trigger_days: int = Field(default=20, ge=1)

    @model_validator(mode="after")
    def _validate_pairs(self) -> "RegimeAdaptiveParams":
        if self.sma_fast >= self.sma_slow:
            raise ValueError(
                f"sma_fast ({self.sma_fast}) must be < sma_slow ({self.sma_slow})"
            )
        if self.vix_low_threshold >= self.vix_high_threshold:
            raise ValueError(
                f"vix_low_threshold ({self.vix_low_threshold}) must be < "
                f"vix_high_threshold ({self.vix_high_threshold})"
            )
        return self


# --------------------------------------------------------------------------- #
# Allocation shaping
# --------------------------------------------------------------------------- #
def allocation_for(
    regime: str, params: RegimeAdaptiveParams
) -> dict[str, float]:
    """Return the target-weight dict for ``regime`` after shaping."""
    if regime not in BASE_ALLOCATIONS:
        raise ValueError(f"Unknown regime {regime!r}. Expected one of {REGIMES}.")
    w = dict(BASE_ALLOCATIONS[regime])

    if regime == "Crisis" and params.crisis_equity_floor > 0:
        floor = params.crisis_equity_floor
        bil_avail = min(floor, w["BIL"])
        w["BIL"] -= bil_avail
        w["SPY"] += 0.50 * bil_avail
        w["QQQ"] += 0.30 * bil_avail
        w["EFA"] += 0.20 * bil_avail

    if params.defensive_bond_weight is not None and regime in ("HighVol", "Crisis"):
        target_bonds = params.defensive_bond_weight
        current_bonds = w["IEF"] + w["TLT"]
        if current_bonds > 0:
            delta = target_bonds - current_bonds
            new_bil = w["BIL"] - delta
            if new_bil < 0:
                available = w["BIL"] + current_bonds
                target_bonds = min(target_bonds, available)
                new_bil = 0.0
            w["BIL"] = max(0.0, new_bil)
            if current_bonds > 0:
                scale = target_bonds / current_bonds
                w["IEF"] *= scale
                w["TLT"] *= scale

    total = sum(w.values())
    if total > 0:
        w = {k: v / total for k, v in w.items()}
    return w


__all__ = [
    "RegimeAdaptiveParams",
    "UNIVERSE", "SIGNAL_ONLY",
    "REGIME_REFERENCE", "VIX_PROXY",
    "BASE_ALLOCATIONS", "REGIMES",
    "allocation_for",
]
