"""Sector Rotation parameter defaults and tuner search space — SOTA shell.

Single source of truth for every knob the strategy exposes. Defaults follow
Stangl-Jacobsen-Visaltanachoti (2009) and Moskowitz-Grinblatt (1999): a
liquid 11-GICS-sector ETF universe ranked by intermediate-term composite
relative-strength, top-N held with a simple bond-fallback risk-off rule.
See ``spec.md`` for academic rationale.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


# --------------------------------------------------------------------------- #
# Sector universe — 11 GICS sector SPDR ETFs (https://www.sectorspdr.com)     #
# --------------------------------------------------------------------------- #
# These are the canonical, deeply-liquid GICS sector ETFs. Membership is
# stable — sectors don't churn, so no point-in-time loader is required.
SECTOR_ETFS: tuple[str, ...] = (
    "XLK",   # Technology
    "XLV",   # Health Care
    "XLF",   # Financials
    "XLY",   # Consumer Discretionary
    "XLP",   # Consumer Staples
    "XLE",   # Energy
    "XLI",   # Industrials
    "XLB",   # Materials
    "XLRE",  # Real Estate (added 2015 when GICS split it from Financials)
    "XLU",   # Utilities
    "XLC",   # Communication Services (added 2018)
)

DEFAULT_BOND_FALLBACK: str = "AGG"
DEFAULT_RISK_OFF_PROBE: str = "SPY"  # used to detect bear regime → bond fallback

BOND_CHOICES: tuple[str, ...] = ("AGG", "IEF", "TLT", "BIL")


# --------------------------------------------------------------------------- #
# Params                                                                      #
# --------------------------------------------------------------------------- #
class SectorRotationParams(StrategyParams):
    """Typed Pydantic-v2 params model for the sector-rotation strategy."""

    # Number of top-ranked sectors to hold each month. Spec defaults to 3.
    top_n: int = Field(
        default=3,
        ge=1,
        le=11,
        json_schema_extra={"tune": {"type": "categorical", "choices": [2, 3, 4, 5]}},
    )

    # Two-lookback composite (intermediate-term + medium-term momentum).
    # Stangl-Jacobsen-Visaltanachoti finds 6m + 12m blend dominates either alone
    # for sector ETF rankings; equal-weight is the simplest defensible blend.
    short_lookback_days: int = Field(
        default=126,
        gt=0,
        le=252,
        json_schema_extra={
            "tune": {"type": "categorical", "choices": [63, 126, 189]}
        },
    )
    long_lookback_days: int = Field(
        default=252,
        gt=0,
        le=504,
        json_schema_extra={
            "tune": {"type": "categorical", "choices": [189, 252, 378]}
        },
    )
    # Weight of the *short* lookback in the composite score (long takes the
    # complement). 0.5 is the canonical equal-weight blend.
    short_weight: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.3, "high": 0.7, "type": "float"}},
    )

    # Risk-off rule: if SPY's `risk_off_lookback_days` return is negative,
    # hold the bond fallback instead of the top sectors. Faber (2013)
    # 10-month moving-average style filter; using composite return < 0
    # rather than price-vs-MA is simpler and equivalent at monthly cadence.
    risk_off_enabled: bool = Field(
        default=True,
        json_schema_extra={"tune": {"type": "categorical", "choices": [True, False]}},
    )
    risk_off_lookback_days: int = Field(
        default=126,
        gt=0,
        le=252,
        json_schema_extra={
            "tune": {"type": "categorical", "choices": [63, 126, 189, 252]}
        },
    )
    bond_fallback: Literal["AGG", "IEF", "TLT", "BIL"] = Field(
        default=DEFAULT_BOND_FALLBACK,
        json_schema_extra={
            "tune": {"type": "categorical", "choices": list(BOND_CHOICES)}
        },
    )
    risk_off_probe: str = Field(
        default=DEFAULT_RISK_OFF_PROBE,
        description="Underlying used for the risk-off return filter.",
    )

    rebalance_freq: Literal["monthly", "bimonthly"] = Field(
        default="monthly",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["monthly", "bimonthly"]}
        },
    )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def composite_lookbacks(params: SectorRotationParams) -> tuple[tuple[int, float], ...]:
    """Return ``((lookback_days, weight), ...)`` for the composite score.

    Always exactly two components: short with ``short_weight``, long with
    ``1 - short_weight``.
    """
    return (
        (int(params.short_lookback_days), float(params.short_weight)),
        (int(params.long_lookback_days), float(1.0 - params.short_weight)),
    )


def max_lookback(params: SectorRotationParams) -> int:
    return max(
        int(params.short_lookback_days),
        int(params.long_lookback_days),
        int(params.risk_off_lookback_days),
    )


__all__ = [
    "SectorRotationParams",
    "SECTOR_ETFS",
    "DEFAULT_BOND_FALLBACK",
    "DEFAULT_RISK_OFF_PROBE",
    "BOND_CHOICES",
    "composite_lookbacks",
    "max_lookback",
]
