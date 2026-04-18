"""Regime-Adaptive asset allocation — parameter defaults and tuner space.

The allocation tables and thresholds are the research surface; the
universe is fixed (changing it is an identity-of-the-strategy change
rather than a tunable hyperparameter). Keeping the search space small
and bounded is deliberate — an overfitted regime-switcher is worse than
a static allocation.

Usage
-----

.. code-block:: python

    from strategies.regime_adaptive.config import (
        DEFAULT_PARAMS,
        RegimeAdaptiveConfig,
        build_search_space,
    )

    cfg = RegimeAdaptiveConfig.from_params(DEFAULT_PARAMS)
    space = build_search_space()
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


# --------------------------------------------------------------------------- #
# Universe
# --------------------------------------------------------------------------- #
# Eight-ETF universe. VIXY is in the data universe as a VIX proxy — never
# allocated to (weight = 0 in every row). All other tickers are tradable
# targets.
UNIVERSE: tuple[str, ...] = (
    "SPY",   # US large-cap core
    "QQQ",   # US tech / growth tilt
    "EFA",   # developed ex-US
    "IEF",   # Treasury 7-10y
    "TLT",   # Treasury 20+y
    "GLD",   # gold
    "BIL",   # 1-3m T-bills (cash proxy)
    "VXX",   # volatility ETN placeholder (weight 0 currently)
)

# Data-only tickers — fetched for signal computation but never sized.
SIGNAL_ONLY: tuple[str, ...] = ("VIXY",)

# Tickers we classify regime from. SPY is the equity reference.
REGIME_REFERENCE = "SPY"
VIX_PROXY = "VIXY"  # VIXY close × 10 ≈ VIX spot (documented in spec.md §5)


# --------------------------------------------------------------------------- #
# Allocation table (regime → weights). Weights are floats; each row sums to
# 1.00 before optional reshaping via crisis_equity_floor / defensive_bond_weight.
# Columns follow UNIVERSE ordering.
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
# Defaults
# --------------------------------------------------------------------------- #
DEFAULT_PARAMS: dict[str, Any] = {
    # SMA pair used for trend classification. Fast is short-window slope
    # proxy, slow is trend filter.
    "sma_fast": 50,
    "sma_slow": 200,
    # VIX thresholds (applied to the VIX level; with the VIXY×10 fallback
    # these are on the same scale as CBOE VIX).
    "vix_low_threshold": 20.0,
    "vix_high_threshold": 25.0,
    # Confirmation buffer: how many consecutive trading days the
    # instantaneous regime label must persist before the strategy treats
    # it as the "confirmed" regime. 10 ≈ 2 weeks.
    "confirmation_days": 10,
    # Rebalance rhythm. "monthly" = last trading day of each month;
    # "bimonthly" = last trading day of every odd month.
    "rebalance_freq": "monthly",
    # Retain this fraction of equity even during Crisis (0 = textbook
    # all-defensive). If > 0 we scale SPY/QQQ/EFA proportionally to
    # re-inject this much equity at the expense of BIL.
    "crisis_equity_floor": 0.0,
    # Total IEF+TLT weight in HighVol and Crisis (0.3-0.5). Defaults to
    # whatever the base table implies (0.45 for HighVol; 0.50 for Crisis)
    # — if None, the base table is used as-is. If set, bonds are scaled
    # to this fraction and the remainder is preserved pro-rata.
    "defensive_bond_weight": None,
    # How many consecutive trading days SPY below SMA_200 forces a
    # "grind-bear" Crisis label regardless of VIX level.
    "crisis_slow_trigger_days": 20,
}


# --------------------------------------------------------------------------- #
# Typed view
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class RegimeAdaptiveConfig:
    """Typed view over the strategy's parameter dict.

    Construct via :meth:`from_params` so unknown keys raise loudly (bugs
    in the caller wiring up the tuner) and types are coerced consistently.
    """

    sma_fast: int = 50
    sma_slow: int = 200
    vix_low_threshold: float = 20.0
    vix_high_threshold: float = 25.0
    confirmation_days: int = 10
    rebalance_freq: str = "monthly"
    crisis_equity_floor: float = 0.0
    defensive_bond_weight: float | None = None
    crisis_slow_trigger_days: int = 20

    @classmethod
    def from_params(
        cls, params: Mapping[str, Any] | None
    ) -> "RegimeAdaptiveConfig":
        """Build a :class:`RegimeAdaptiveConfig` from a (partial) params dict.

        Missing keys fall back to :data:`DEFAULT_PARAMS`. Unknown keys raise.
        """

        merged = dict(DEFAULT_PARAMS)
        if params:
            for k, v in params.items():
                if k not in merged:
                    raise ValueError(
                        f"RegimeAdaptiveConfig: unknown parameter {k!r}. "
                        f"Known: {sorted(merged)}"
                    )
                merged[k] = v

        freq = str(merged["rebalance_freq"])
        if freq not in {"monthly", "bimonthly"}:
            raise ValueError(
                f"rebalance_freq must be 'monthly' or 'bimonthly', "
                f"got {freq!r}"
            )

        sma_fast = int(merged["sma_fast"])
        sma_slow = int(merged["sma_slow"])
        if sma_fast >= sma_slow:
            raise ValueError(
                f"sma_fast ({sma_fast}) must be strictly less than "
                f"sma_slow ({sma_slow})."
            )
        if sma_fast <= 0 or sma_slow <= 0:
            raise ValueError("SMA periods must be positive.")

        vlow = float(merged["vix_low_threshold"])
        vhigh = float(merged["vix_high_threshold"])
        if vlow >= vhigh:
            raise ValueError(
                f"vix_low_threshold ({vlow}) must be < "
                f"vix_high_threshold ({vhigh})."
            )

        conf = int(merged["confirmation_days"])
        if conf < 1:
            raise ValueError("confirmation_days must be >= 1.")

        floor = float(merged["crisis_equity_floor"])
        if floor < 0.0 or floor > 0.5:
            raise ValueError(
                f"crisis_equity_floor must be in [0.0, 0.5], got {floor}."
            )

        dbw_raw = merged["defensive_bond_weight"]
        dbw: float | None
        if dbw_raw is None:
            dbw = None
        else:
            dbw = float(dbw_raw)
            if dbw < 0.0 or dbw > 0.8:
                raise ValueError(
                    f"defensive_bond_weight must be in [0.0, 0.8], got {dbw}."
                )

        slow_days = int(merged["crisis_slow_trigger_days"])
        if slow_days < 1:
            raise ValueError("crisis_slow_trigger_days must be >= 1.")

        return cls(
            sma_fast=sma_fast,
            sma_slow=sma_slow,
            vix_low_threshold=vlow,
            vix_high_threshold=vhigh,
            confirmation_days=conf,
            rebalance_freq=freq,
            crisis_equity_floor=floor,
            defensive_bond_weight=dbw,
            crisis_slow_trigger_days=slow_days,
        )

    # -- derived helpers ---------------------------------------------------- #
    def warmup_days(self) -> int:
        """Calendar-day warmup the engine should fetch before run-start.

        Need at least ``sma_slow`` trading days plus the longer of
        ``confirmation_days`` and ``crisis_slow_trigger_days`` bars of
        history to run the instantaneous classifier + hysteresis buffer
        on the first real bar. 252 trading days ≈ 365 calendar days;
        we add a generous safety margin.
        """

        trading = self.sma_slow + max(
            self.confirmation_days, self.crisis_slow_trigger_days
        )
        return int(trading * 1.55) + 21


# --------------------------------------------------------------------------- #
# Allocation shaping
# --------------------------------------------------------------------------- #
def allocation_for(
    regime: str, cfg: RegimeAdaptiveConfig
) -> dict[str, float]:
    """Return the target-weight dict for ``regime`` after shaping.

    Applies ``crisis_equity_floor`` and ``defensive_bond_weight`` on top of
    :data:`BASE_ALLOCATIONS`. Output weights always sum to 1.0 within a
    tiny rounding error. If caller passes an unknown regime, raises.
    """

    if regime not in BASE_ALLOCATIONS:
        raise ValueError(
            f"Unknown regime {regime!r}. Expected one of {REGIMES}."
        )
    w = dict(BASE_ALLOCATIONS[regime])

    # --- crisis_equity_floor: split floor across SPY/QQQ/EFA from BIL --- #
    if regime == "Crisis" and cfg.crisis_equity_floor > 0:
        floor = cfg.crisis_equity_floor
        # Take from BIL (we can't take from zero-weight SPY/QQQ/EFA in base
        # Crisis allocation).
        bil_avail = min(floor, w["BIL"])
        w["BIL"] -= bil_avail
        # Split equity pro-rata as 0.50/0.30/0.20 (SPY/QQQ/EFA).
        w["SPY"] += 0.50 * bil_avail
        w["QQQ"] += 0.30 * bil_avail
        w["EFA"] += 0.20 * bil_avail

    # --- defensive_bond_weight: scale IEF+TLT to target ----------------- #
    if (
        cfg.defensive_bond_weight is not None
        and regime in ("HighVol", "Crisis")
    ):
        target_bonds = float(cfg.defensive_bond_weight)
        current_bonds = w["IEF"] + w["TLT"]
        if current_bonds > 0:
            delta = target_bonds - current_bonds
            # Redistribute the delta between bonds and BIL (cash).
            # Moving delta from/to BIL preserves normalisation.
            new_bil = w["BIL"] - delta
            if new_bil < 0:
                # Clip: cannot fund additional bonds beyond what BIL+bonds
                # provide; take proportionally from BIL first, then scale.
                available = w["BIL"] + current_bonds
                target_bonds = min(target_bonds, available - 0.0)
                new_bil = 0.0
                delta = target_bonds - current_bonds
            w["BIL"] = max(0.0, new_bil)
            # Scale IEF/TLT pro-rata to hit target_bonds.
            if current_bonds > 0:
                scale = target_bonds / current_bonds
                w["IEF"] *= scale
                w["TLT"] *= scale

    # --- Renormalise to 1.00 (defence against float drift) -------------- #
    total = sum(w.values())
    if total > 0:
        w = {k: v / total for k, v in w.items()}
    return w


# --------------------------------------------------------------------------- #
# Optuna search space
# --------------------------------------------------------------------------- #
def build_search_space() -> dict[str, Any]:
    """Return the Optuna search space for the tuner.

    Keeping the space small and bounded. Eight knobs total; the regime
    labels and the allocation *shapes* are intentionally fixed — we tune
    the thresholds and the confirmation rhythm, not the philosophy.
    """

    # Deferred import so config.py stays importable without optuna.
    from tuner.search import Categorical, FloatRange, IntRange

    return {
        "sma_fast": Categorical([50, 100]),
        "sma_slow": Categorical([150, 200]),
        "vix_low_threshold": FloatRange(15.0, 22.0),
        "vix_high_threshold": FloatRange(25.0, 35.0),
        "confirmation_days": IntRange(5, 20),
        "rebalance_freq": Categorical(["monthly", "bimonthly"]),
        "crisis_equity_floor": FloatRange(0.0, 0.15),
        "defensive_bond_weight": FloatRange(0.3, 0.5),
    }


__all__ = [
    "DEFAULT_PARAMS",
    "UNIVERSE",
    "SIGNAL_ONLY",
    "REGIME_REFERENCE",
    "VIX_PROXY",
    "BASE_ALLOCATIONS",
    "REGIMES",
    "RegimeAdaptiveConfig",
    "allocation_for",
    "build_search_space",
]
