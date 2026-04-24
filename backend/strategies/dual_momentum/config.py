"""Dual Momentum (GEM) parameter defaults and tuner search space — SOTA shell.

Single source of truth for every knob the strategy exposes. Defaults come
from Antonacci's *Dual Momentum Investing* (2014); search ranges stay close
to the literature. See ``spec.md`` for academic rationale.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


# --------------------------------------------------------------------------- #
# Ticker universe                                                              #
# --------------------------------------------------------------------------- #
DEFAULT_US_EQUITY = "VOO"
DEFAULT_EXUS_EQUITY = "VEU"
DEFAULT_BOND_FALLBACK = "AGG"
DEFAULT_RISK_FREE = "BIL"

BOND_CHOICES: tuple[str, ...] = ("AGG", "IEF", "TLT", "BIL")

# Diagnostic-only variant kept for legacy tooling; ``("SPY", "EFA", "EEM")``
# is a non-GEM (Faber IVY / Antonacci GBM) 3-asset form. The production
# tuner search space must use ``PRODUCTION_RELATIVE_UNIVERSE_CHOICES``.
RELATIVE_UNIVERSE_CHOICES: tuple[tuple[str, ...], ...] = (
    ("VOO", "VEU"),
    ("VOO", "VEU", "EFA"),
    ("SPY", "EFA", "EEM"),
)
PRODUCTION_RELATIVE_UNIVERSE_CHOICES: tuple[tuple[str, ...], ...] = (
    ("VOO", "VEU"),
    ("VOO", "VEU", "EFA"),
)

COMPOSITE_LOOKBACK_CHOICES: tuple[str, ...] = (
    "single_126", "single_189", "single_252", "blend_126_252",
)
PRODUCTION_COMPOSITE_LOOKBACK_CHOICES: tuple[str, ...] = (
    "single_126", "single_189", "single_252",
)


# --------------------------------------------------------------------------- #
# Params                                                                      #
# --------------------------------------------------------------------------- #
class DualMomentumParams(StrategyParams):
    """Typed Pydantic-v2 params model for the GEM strategy."""

    lookback_days: int = Field(
        default=252,
        gt=0,
        le=504,
        json_schema_extra={"tune": {"type": "categorical", "choices": [126, 189, 252]}},
    )
    bond_fallback: Literal["AGG", "IEF", "TLT", "BIL"] = Field(
        default="AGG",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": list(BOND_CHOICES)}
        },
    )
    excess_return_floor: float = Field(
        default=0.0,
        ge=0.0,
        le=0.10,
        json_schema_extra={"tune": {"low": 0.0, "high": 0.02, "type": "float"}},
    )
    rebalance_freq: Literal["monthly", "bimonthly"] = Field(
        default="monthly",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["monthly", "bimonthly"]}
        },
    )
    composite_lookback: Literal[
        "single_126", "single_189", "single_252", "blend_126_252"
    ] = Field(
        default="single_252",
        json_schema_extra={
            "tune": {
                "type": "categorical",
                "choices": list(PRODUCTION_COMPOSITE_LOOKBACK_CHOICES),
            }
        },
    )
    relative_universe: tuple[str, ...] = Field(
        default=("VOO", "VEU"),
        json_schema_extra={
            "tune": {
                "type": "categorical",
                "choices": [list(c) for c in PRODUCTION_RELATIVE_UNIVERSE_CHOICES],
            }
        },
    )
    risk_free_symbol: str = Field(default=DEFAULT_RISK_FREE)


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def lookback_components(params: DualMomentumParams) -> tuple[tuple[int, float], ...]:
    """Return ``((lookback_days, weight), ...)`` for the composite score."""
    mapping = {
        "single_126": ((126, 1.0),),
        "single_189": ((189, 1.0),),
        "single_252": ((252, 1.0),),
        "blend_126_252": ((126, 0.5), (252, 0.5)),
    }
    return mapping[params.composite_lookback]


def max_lookback(params: DualMomentumParams) -> int:
    return max(L for L, _ in lookback_components(params))


__all__ = [
    "DualMomentumParams",
    "DEFAULT_US_EQUITY", "DEFAULT_EXUS_EQUITY",
    "DEFAULT_BOND_FALLBACK", "DEFAULT_RISK_FREE",
    "BOND_CHOICES",
    "RELATIVE_UNIVERSE_CHOICES", "PRODUCTION_RELATIVE_UNIVERSE_CHOICES",
    "COMPOSITE_LOOKBACK_CHOICES", "PRODUCTION_COMPOSITE_LOOKBACK_CHOICES",
    "lookback_components", "max_lookback",
]
