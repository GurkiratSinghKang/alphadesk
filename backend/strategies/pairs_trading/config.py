"""Parameter defaults, universe, and Optuna search space for Pairs Trading.

Kept separate from ``strategy.py`` so notebooks / reports can import
configuration without pulling in the engine-heavy strategy module.

See ``spec.md`` for the academic rationale for each knob.
"""

from __future__ import annotations

from typing import Any

from tuner.search import Categorical, FloatRange, IntRange


# --------------------------------------------------------------------------- #
# Defaults                                                                    #
# --------------------------------------------------------------------------- #
DEFAULTS: dict[str, Any] = {
    # z-score rolling window (bars)
    "z_window": 60,
    # Entry / exit / stop thresholds on |z|
    "z_entry": 2.0,
    "z_exit": 0.5,
    "z_stop": 3.5,
    # Sizing
    "pair_weight": 0.10,
    "max_pairs": 5,
    # Hedge ratio: "ols" (static) or "kalman" (dynamic)
    "hedge_method": "ols",
    # Rescreen cadence (trading days). ~63 = quarterly
    "rescreen_days": 63,
    # Admission gates during rescreen
    "ou_halflife_max_days": 30.0,
    "adf_pvalue_max": 0.05,
    "hurst_max": 0.45,
    # Formation window (fixed) — one trading year of closes for E-G
    "formation_days": 252,
    # Structural-break watchdog (fixed)
    "watchdog_days": 21,
    "watchdog_pvalue": 0.10,
    # Kalman noise parameters (fixed; Chan 2013 defaults)
    "kalman_delta": 1e-5,
    "kalman_r": 1e-3,
}


# --------------------------------------------------------------------------- #
# Sector-grouped universe                                                     #
# --------------------------------------------------------------------------- #
# 49 mega-cap S&P 500 names across 6 sectors. Within-sector pair screen
# evaluates each candidate once per rescreen_days (~quarterly).
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

# Flat list for universe()
UNIVERSE: tuple[str, ...] = tuple(
    sym for syms in UNIVERSE_BY_SECTOR.values() for sym in syms
)


def all_within_sector_pairs() -> list[tuple[str, str, str]]:
    """Return all within-sector candidate pairs as (sector, sym_y, sym_x).

    The "y" symbol is always the alphabetically-first of the two — this is
    a convention only; Engle-Granger's hedge ratio is symmetric up to
    sign of the residual stationarity p-value, but in practice we regress
    the alphabetically-first name on the second.
    """

    out: list[tuple[str, str, str]] = []
    for sector, syms in UNIVERSE_BY_SECTOR.items():
        lst = sorted(syms)
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                out.append((sector, lst[i], lst[j]))
    return out


# --------------------------------------------------------------------------- #
# Search space (Optuna)                                                       #
# --------------------------------------------------------------------------- #
def search_space() -> dict[str, Any]:
    """Optuna search space. Matches the ranges documented in spec.md."""

    return {
        "z_window": Categorical([30, 45, 60, 90]),
        "z_entry": FloatRange(1.5, 3.0),
        "z_exit": FloatRange(0.0, 1.0),
        "z_stop": FloatRange(3.0, 5.0),
        "pair_weight": FloatRange(0.05, 0.15),
        "max_pairs": Categorical([3, 5, 8]),
        "hedge_method": Categorical(["ols", "kalman"]),
        "rescreen_days": Categorical([42, 63, 126]),
        "ou_halflife_max_days": FloatRange(20.0, 60.0),
        "adf_pvalue_max": FloatRange(0.01, 0.10),
    }


__all__ = [
    "DEFAULTS",
    "UNIVERSE_BY_SECTOR",
    "UNIVERSE",
    "all_within_sector_pairs",
    "search_space",
]
