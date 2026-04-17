"""Dual Momentum (GEM) parameter defaults and tuner search space.

This module is the single source of truth for every knob the strategy
exposes. Defaults come from Antonacci's *Dual Momentum Investing* (2014);
search ranges stay close to the literature and refuse to overfit by
bound. Keeping this tight is especially important for a low-turnover
strategy that only makes ~12 decisions per year — wide search ranges on
a thin statistical record is the textbook recipe for false discoveries.

Usage
-----

.. code-block:: python

    from backend.strategies.dual_momentum.config import (
        DEFAULT_PARAMS,
        DualMomentumConfig,
        build_search_space,
    )

    cfg = DualMomentumConfig.from_params(DEFAULT_PARAMS)
    search = build_search_space()
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

# Deferred-import in ``build_search_space`` so the config module stays
# importable without optuna in the environment.


# --------------------------------------------------------------------------- #
# Ticker universe                                                              #
# --------------------------------------------------------------------------- #
DEFAULT_US_EQUITY = "VOO"                # Vanguard S&P 500 (float adj.)
DEFAULT_EXUS_EQUITY = "VEU"              # Vanguard FTSE All-World ex-US
DEFAULT_BOND_FALLBACK = "AGG"            # iShares Core US Aggregate Bond
DEFAULT_RISK_FREE = "BIL"                # SPDR 1-3m T-bill

# Bond-fallback choices the tuner can pick among. SHV / IEI / IEF all have
# enough history for the 2019-2024 walk-forward study; TLT is longer-dated
# and higher-beta. BIL is effectively cash (the tuner is allowed to pick
# "cash" if the data says so, but the default is AGG per Antonacci).
BOND_CHOICES: tuple[str, ...] = ("AGG", "IEF", "TLT", "BIL")

# Relative-universe choices. The first pair is Antonacci's original
# VOO/VEU pair; the others let the tuner explore region slicings.
RELATIVE_UNIVERSE_CHOICES: tuple[tuple[str, ...], ...] = (
    ("VOO", "VEU"),
    ("VOO", "VEU", "EFA"),
    ("SPY", "EFA", "EEM"),
)


# --------------------------------------------------------------------------- #
# Defaults                                                                     #
# --------------------------------------------------------------------------- #
DEFAULT_PARAMS: dict[str, Any] = {
    # Lookback (in trading days) used for the 12-month momentum rank.
    # Antonacci's canonical value is 252 (12 months).
    "lookback_days": 252,
    # Which bond ETF to rotate into when equities fail the absolute-mom
    # test. Default is AGG (US Aggregate). Tuner can pick BIL for a
    # pure-cash fallback.
    "bond_fallback": DEFAULT_BOND_FALLBACK,
    # Minimum excess return (r_eq - r_rf) to stay in the equity sleeve.
    # 0.0 is the textbook rule; lifting it makes the gate stricter.
    "excess_return_floor": 0.0,
    # Calendar rhythm for rebalancing. "monthly" is the Antonacci default;
    # "bimonthly" halves turnover at the cost of signal freshness.
    "rebalance_freq": "monthly",
    # Single or composite lookback for the momentum score.
    #   "single_126"   -> r_L with L = 126
    #   "single_189"   -> r_L with L = 189
    #   "single_252"   -> r_L with L = 252 (DEFAULT)
    #   "blend_126_252" -> 0.5 * r_126 + 0.5 * r_252 (Faber-style blend)
    "composite_lookback": "single_252",
    # Universe of equity tickers to rank in the relative-momentum step.
    # The first element is treated as the "US" sleeve for the absolute-
    # momentum gate.
    "relative_universe": ("VOO", "VEU"),
    # Risk-free proxy for the absolute-momentum comparator. Kept fixed
    # (not tuned) — switching RF proxy is an identity-of-the-strategy
    # change, not a tunable hyperparameter.
    "risk_free_symbol": DEFAULT_RISK_FREE,
}


# --------------------------------------------------------------------------- #
# Typed view                                                                   #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class DualMomentumConfig:
    """Typed view over the strategy's parameter dict.

    Construct via :meth:`from_params` so unknown keys raise loudly (bugs
    in the caller wiring up the tuner) and types are coerced consistently.
    """

    lookback_days: int = 252
    bond_fallback: str = DEFAULT_BOND_FALLBACK
    excess_return_floor: float = 0.0
    rebalance_freq: str = "monthly"
    composite_lookback: str = "single_252"
    relative_universe: tuple[str, ...] = ("VOO", "VEU")
    risk_free_symbol: str = DEFAULT_RISK_FREE

    @classmethod
    def from_params(cls, params: Mapping[str, Any] | None) -> "DualMomentumConfig":
        """Build a ``DualMomentumConfig`` from a (partial) parameter dict.

        Missing keys fall back to :data:`DEFAULT_PARAMS`. Unknown keys
        raise :class:`ValueError`.
        """

        merged = dict(DEFAULT_PARAMS)
        if params:
            for k, v in params.items():
                if k not in merged:
                    raise ValueError(
                        f"DualMomentumConfig: unknown parameter {k!r}. "
                        f"Known: {sorted(merged)}"
                    )
                merged[k] = v

        # Coerce container types to tuple to keep the dataclass hashable.
        rel = merged["relative_universe"]
        if isinstance(rel, (list, tuple)):
            rel = tuple(rel)
        else:
            raise TypeError(
                f"relative_universe must be a list/tuple, got {type(rel).__name__}"
            )

        # Validate choices (fail loud -- see backend/strategies/base.py docs).
        freq = str(merged["rebalance_freq"])
        if freq not in {"monthly", "bimonthly"}:
            raise ValueError(
                f"rebalance_freq must be 'monthly' or 'bimonthly', got {freq!r}"
            )
        comp = str(merged["composite_lookback"])
        if comp not in {"single_126", "single_189", "single_252", "blend_126_252"}:
            raise ValueError(
                f"composite_lookback must be one of "
                "('single_126','single_189','single_252','blend_126_252'), "
                f"got {comp!r}"
            )
        if len(rel) < 2:
            raise ValueError(
                "relative_universe must contain at least two tickers "
                "(first is US sleeve, rest are ranked for relative momentum)."
            )

        return cls(
            lookback_days=int(merged["lookback_days"]),
            bond_fallback=str(merged["bond_fallback"]),
            excess_return_floor=float(merged["excess_return_floor"]),
            rebalance_freq=freq,
            composite_lookback=comp,
            relative_universe=rel,
            risk_free_symbol=str(merged["risk_free_symbol"]),
        )

    # -- derived helpers ---------------------------------------------------- #
    def lookback_components(self) -> tuple[tuple[int, float], ...]:
        """Return ``((lookback_days, weight), ...)`` for the composite score.

        - ``single_126``     -> ``((126, 1.0),)``
        - ``single_189``     -> ``((189, 1.0),)``
        - ``single_252``     -> ``((252, 1.0),)`` (DEFAULT)
        - ``blend_126_252``  -> ``((126, 0.5), (252, 0.5))``

        ``lookback_days`` (the standalone field) is reported as the *max*
        of the components so the engine knows how much warmup to request.
        """

        if self.composite_lookback == "single_126":
            return ((126, 1.0),)
        if self.composite_lookback == "single_189":
            return ((189, 1.0),)
        if self.composite_lookback == "single_252":
            return ((252, 1.0),)
        if self.composite_lookback == "blend_126_252":
            return ((126, 0.5), (252, 0.5))
        raise AssertionError(  # pragma: no cover - validated in from_params
            f"unexpected composite_lookback {self.composite_lookback!r}"
        )

    def max_lookback(self) -> int:
        """Return the maximum lookback used by any component."""

        return max(L for L, _ in self.lookback_components())

    def warmup_days(self) -> int:
        """Calendar-day warmup the engine should fetch before run-start."""

        # 252 trading days ~= 370 calendar days. Add a small buffer for
        # holidays + the first-of-month alignment.
        return int(self.max_lookback() * 1.55) + 14


# --------------------------------------------------------------------------- #
# Optuna search space                                                          #
# --------------------------------------------------------------------------- #
def build_search_space() -> dict[str, Any]:
    """Return the Optuna search space for the tuner.

    We keep the space small — GEM has fundamentally few knobs, and a
    wide space on a 12-trade/yr strategy is a trap. Eight dimensions
    at most. All choices are Categorical or discrete to keep the TPE
    sampler well-behaved.
    """

    # Deferred import: keeps the config module importable when optuna is
    # not available (e.g. in the engine or frontend processes).
    from backend.tuner.search import Categorical, FloatRange

    return {
        "lookback_days": Categorical([126, 189, 252]),
        "bond_fallback": Categorical(list(BOND_CHOICES)),
        "excess_return_floor": FloatRange(-0.01, 0.02, step=0.005),
        "rebalance_freq": Categorical(["monthly", "bimonthly"]),
        "composite_lookback": Categorical(
            ["single_126", "single_189", "single_252", "blend_126_252"]
        ),
        # Categorical of tuples -- optuna wants each choice hashable.
        "relative_universe": Categorical(list(RELATIVE_UNIVERSE_CHOICES)),
    }


__all__ = [
    "DEFAULT_PARAMS",
    "DEFAULT_US_EQUITY",
    "DEFAULT_EXUS_EQUITY",
    "DEFAULT_BOND_FALLBACK",
    "DEFAULT_RISK_FREE",
    "BOND_CHOICES",
    "RELATIVE_UNIVERSE_CHOICES",
    "DualMomentumConfig",
    "build_search_space",
]
