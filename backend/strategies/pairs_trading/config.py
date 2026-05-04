"""Parameter defaults, universe, and Optuna search space for Pairs Trading.

See ``spec.md`` for the academic rationale for each knob.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


# --------------------------------------------------------------------------- #
# Sector-grouped universe                                                     #
# --------------------------------------------------------------------------- #
UNIVERSE_BY_SECTOR: dict[str, tuple[str, ...]] = {
    "Tech": (
        "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "ORCL", "CRM", "ADBE",
    ),
    "Financials": (
        "JPM", "BAC", "MS", "GS", "WFC", "C", "USB", "AXP",
    ),
    "Energy": (
        "XOM", "CVX", "COP", "EOG", "SLB", "OXY",
    ),
    "Health": (
        "LLY", "UNH", "JNJ", "PFE", "MRK", "ABT", "TMO", "DHR",
    ),
    "Consumer": (
        "WMT", "HD", "COST", "LOW", "TGT", "MCD", "SBUX",
    ),
    "Industrial": (
        "CAT", "HON", "UPS", "FDX", "DE", "NOC", "RTX",
    ),
}

UNIVERSE: tuple[str, ...] = tuple(
    sym for syms in UNIVERSE_BY_SECTOR.values() for sym in syms
)


def all_within_sector_pairs() -> list[tuple[str, str, str]]:
    """Return all within-sector candidate pairs as (sector, sym_y, sym_x)."""
    out: list[tuple[str, str, str]] = []
    for sector, syms in UNIVERSE_BY_SECTOR.items():
        lst = sorted(syms)
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                out.append((sector, lst[i], lst[j]))
    return out


# --------------------------------------------------------------------------- #
# Params                                                                      #
# --------------------------------------------------------------------------- #
class PairsTradingParams(StrategyParams):
    """Typed Pydantic-v2 params model for pairs_trading."""

    z_window: int = Field(
        default=60,
        gt=0,
        le=252,
        json_schema_extra={"tune": {"type": "categorical", "choices": [30, 45, 60, 90]}},
    )
    z_entry: float = Field(
        default=2.0,
        gt=0.0,
        json_schema_extra={"tune": {"low": 1.5, "high": 3.0, "type": "float"}},
    )
    z_exit: float = Field(
        default=0.5,
        ge=0.0,
        json_schema_extra={"tune": {"low": 0.0, "high": 1.0, "type": "float"}},
    )
    z_stop: float = Field(
        default=3.5,
        gt=0.0,
        json_schema_extra={"tune": {"low": 3.0, "high": 5.0, "type": "float"}},
    )
    pair_weight: float = Field(
        default=0.10,
        gt=0.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.05, "high": 0.15, "type": "float"}},
    )
    max_pairs: int = Field(
        default=5,
        ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [3, 5, 8]}},
    )
    hedge_method: Literal["ols", "kalman"] = Field(
        default="ols",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["ols", "kalman"]}
        },
    )
    rescreen_days: int = Field(
        default=63,
        ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [42, 63, 126]}},
    )
    ou_halflife_max_days: float = Field(
        default=30.0,
        gt=0.0,
        json_schema_extra={"tune": {"low": 20.0, "high": 60.0, "type": "float"}},
    )
    adf_pvalue_max: float = Field(
        default=0.05,
        gt=0.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.01, "high": 0.10, "type": "float"}},
    )
    # P1-K (consolidation §3): KPSS counter-test. KPSS null hypothesis is
    # stationarity (the opposite of ADF). Requiring ADF-reject AND KPSS-fail-to-
    # reject is a stronger filter than ADF alone — it reduces low-power false
    # positives on short windows. Defaults to 0.0 (disabled) so the pre-KPSS
    # production parameter set continues to admit the same pairs; operators can
    # enable by setting kpss_pvalue_min=0.05 (or tune over [0.0, 0.10]) once
    # the pair shortlist is validated under both tests.
    kpss_pvalue_min: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.0, "high": 0.10, "type": "float"}},
    )
    # P1-L: tightened from 0.45 to 0.40 per consolidation §3 — stronger
    # mean-reversion selection. h=0.45 was lenient; h<0.40 is the canonical
    # antipersistent threshold and reduces false-positive cointegration.
    hurst_max: float = Field(default=0.40, ge=0.0, le=1.0)
    formation_days: int = Field(default=252, ge=60)
    watchdog_days: int = Field(default=21, ge=0)
    watchdog_pvalue: float = Field(default=0.10, gt=0.0, le=1.0)
    kalman_delta: float = Field(default=1e-5, gt=0.0)
    kalman_r: float = Field(default=1e-3, gt=0.0)
    prices_in_log_space: bool = Field(default=True)


__all__ = [
    "PairsTradingParams",
    "UNIVERSE_BY_SECTOR",
    "UNIVERSE",
    "all_within_sector_pairs",
]
