"""TSMOM parameter defaults and tuner search space.

This module is the single source of truth for every knob the strategy
exposes. Defaults come from Moskowitz-Ooi-Pedersen 2012 (12-month signal,
10% target vol, monthly rebalance) adapted to the equity-ETF universe
per Hurst-Ooi-Pedersen 2013. See ``spec.md`` §3 for the math and §5 for
why the ranges are narrow.

Usage
-----

.. code-block:: python

    from strategies.ts_momentum.config import (
        DEFAULT_PARAMS,
        TSMomentumConfig,
        build_search_space,
    )

    cfg = TSMomentumConfig.from_params(DEFAULT_PARAMS)
    search = build_search_space()
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


# --------------------------------------------------------------------------- #
# Ticker universes                                                            #
# --------------------------------------------------------------------------- #
# Minimal universe: 6 ETFs spanning the four main asset classes that make
# Moskowitz TSMOM work (equities, rates, gold, commodities). Sized so the
# 2019-2024 backtest window has sufficient history on every leg.
UNIVERSE_MINIMAL_6: tuple[str, ...] = (
    "SPY", "EFA", "IEF", "TLT", "GLD", "DBC",
)

# Full universe: 11 ETFs — adds EM equity, credit (IG+HY), USD, REITs.
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
# Defaults                                                                    #
# --------------------------------------------------------------------------- #
DEFAULT_PARAMS: dict[str, Any] = {
    # Single lookback (months) when signal_ensemble == "single_12m".
    # ``ensemble_1_3_6_12`` uses a fixed four-horizon blend.
    "lookback_months": 12,
    # "single_12m" = sign(roc(close, 252)); "ensemble_1_3_6_12" = average of
    # sign indicators for 21/63/126/252-day returns.
    "signal_ensemble": "single_12m",
    # Portfolio-level target volatility. 10% is the AQR retail product
    # target; Moskowitz 2012 targets 40% (pure institutional futures).
    "target_vol": 0.10,
    # "monthly" = last trading day of each month; "bimonthly" = last trading
    # day of odd months.
    "rebalance_freq": "monthly",
    # Realized-volatility window (trading days) for the inverse-vol weighting.
    "realized_vol_window": 60,
    # Cap per-asset weight to avoid one low-vol leg dominating the book.
    "max_weight_per_asset": 0.20,
    # If portfolio drawdown from peak exceeds this, halve gross notional
    # next month. Set above 1.0 to disable.
    "drawdown_delever_threshold": 0.10,
    # Whether to emit negative target_weight on negative-trend assets.
    "shorts_enabled": True,
    # Which ETF bundle to trade. "minimal_6" or "full_11".
    "universe_size": "minimal_6",
    # Floor on realized vol to avoid div-by-zero on ultra-calm legs.
    # Not tuned — it's a numerical safety rail, not a signal knob.
    "vol_floor": 0.05,
    # Gross notional multiplier at target_vol. 1.0 = fully invested at
    # target vol; <1 = under-levered. Not tuned in this sweep.
    "target_vol_gross_mul": 1.0,
}


# --------------------------------------------------------------------------- #
# Typed view                                                                  #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class TSMomentumConfig:
    """Typed view over the strategy's parameter dict.

    Construct via :meth:`from_params` so unknown keys raise loudly and
    types are coerced consistently.
    """

    lookback_months: int = 12
    signal_ensemble: str = "single_12m"
    target_vol: float = 0.10
    rebalance_freq: str = "monthly"
    realized_vol_window: int = 60
    max_weight_per_asset: float = 0.20
    drawdown_delever_threshold: float = 0.10
    shorts_enabled: bool = True
    universe_size: str = "minimal_6"
    vol_floor: float = 0.05
    target_vol_gross_mul: float = 1.0

    @classmethod
    def from_params(cls, params: Mapping[str, Any] | None) -> "TSMomentumConfig":
        """Build a ``TSMomentumConfig`` from a (partial) parameter dict.

        Missing keys fall back to :data:`DEFAULT_PARAMS`. Unknown keys
        raise :class:`ValueError`.
        """

        merged = dict(DEFAULT_PARAMS)
        if params:
            for k, v in params.items():
                if k not in merged:
                    raise ValueError(
                        f"TSMomentumConfig: unknown parameter {k!r}. "
                        f"Known: {sorted(merged)}"
                    )
                merged[k] = v

        freq = str(merged["rebalance_freq"])
        if freq not in {"monthly", "bimonthly"}:
            raise ValueError(
                f"rebalance_freq must be 'monthly' or 'bimonthly', got {freq!r}"
            )
        ens = str(merged["signal_ensemble"])
        if ens not in {"single_12m", "ensemble_1_3_6_12"}:
            raise ValueError(
                f"signal_ensemble must be 'single_12m' or "
                f"'ensemble_1_3_6_12', got {ens!r}"
            )
        uni = str(merged["universe_size"])
        if uni not in _UNIVERSE_MAP:
            raise ValueError(
                f"universe_size must be one of {sorted(_UNIVERSE_MAP)}, "
                f"got {uni!r}"
            )
        lb = int(merged["lookback_months"])
        if lb not in (1, 3, 6, 9, 12):
            raise ValueError(
                f"lookback_months must be in (1, 3, 6, 9, 12), got {lb!r}"
            )
        rv = int(merged["realized_vol_window"])
        if rv < 10 or rv > 252:
            raise ValueError(
                f"realized_vol_window must be in [10, 252], got {rv!r}"
            )
        tv = float(merged["target_vol"])
        if tv <= 0 or tv > 1.0:
            raise ValueError(
                f"target_vol must be in (0, 1], got {tv!r}"
            )
        mwpa = float(merged["max_weight_per_asset"])
        if mwpa <= 0 or mwpa > 1.0:
            raise ValueError(
                f"max_weight_per_asset must be in (0, 1], got {mwpa!r}"
            )
        vf = float(merged["vol_floor"])
        if vf < 0 or vf > 1.0:
            raise ValueError(
                f"vol_floor must be in [0, 1], got {vf!r}"
            )
        dd = float(merged["drawdown_delever_threshold"])
        if dd < 0:
            raise ValueError(
                f"drawdown_delever_threshold must be >= 0, got {dd!r}"
            )

        return cls(
            lookback_months=lb,
            signal_ensemble=ens,
            target_vol=tv,
            rebalance_freq=freq,
            realized_vol_window=rv,
            max_weight_per_asset=mwpa,
            drawdown_delever_threshold=dd,
            shorts_enabled=bool(merged["shorts_enabled"]),
            universe_size=uni,
            vol_floor=vf,
            target_vol_gross_mul=float(merged["target_vol_gross_mul"]),
        )

    # -- derived helpers ---------------------------------------------------- #
    def universe_tickers(self) -> tuple[str, ...]:
        """Return the ticker tuple for this config's universe size."""

        return _UNIVERSE_MAP[self.universe_size]

    def signal_lookback_days(self) -> tuple[int, ...]:
        """Lookbacks in trading days for the sign-of-return signal.

        - ``single_12m`` -> ``(252,)`` (actually scaled by lookback_months)
        - ``ensemble_1_3_6_12`` -> ``(21, 63, 126, 252)``

        ``single_12m`` uses the ``lookback_months`` field rather than a
        hard-coded 12 because the tuner explores 6/9/12. We translate to
        trading days as ``months * 21``.
        """

        if self.signal_ensemble == "single_12m":
            return (int(self.lookback_months * 21),)
        if self.signal_ensemble == "ensemble_1_3_6_12":
            return (21, 63, 126, 252)
        raise AssertionError(  # pragma: no cover - validated in from_params
            f"unexpected signal_ensemble {self.signal_ensemble!r}"
        )

    def max_lookback_days(self) -> int:
        """Largest signal lookback, in trading days (sets warmup needs)."""

        return max(self.signal_lookback_days())

    def warmup_days(self) -> int:
        """Calendar-day warmup the engine should fetch before run-start.

        Largest signal lookback plus realized-vol window plus a generous
        buffer for holidays and month-end alignment.
        """

        trading_lb = self.max_lookback_days() + self.realized_vol_window
        return int(trading_lb * 1.55) + 21


# --------------------------------------------------------------------------- #
# Optuna search space                                                         #
# --------------------------------------------------------------------------- #
def build_search_space() -> dict[str, Any]:
    """Return the Optuna search space for the tuner.

    Nine dimensions. All choices are either Categorical or FloatRange to
    keep the TPE sampler well-behaved on a small-to-medium-sized space.
    """

    from tuner.search import Categorical, FloatRange

    return {
        "lookback_months": Categorical([6, 9, 12]),
        "signal_ensemble": Categorical(["single_12m", "ensemble_1_3_6_12"]),
        "target_vol": FloatRange(0.06, 0.15),
        "rebalance_freq": Categorical(["monthly", "bimonthly"]),
        "realized_vol_window": Categorical([30, 60, 90]),
        "max_weight_per_asset": FloatRange(0.15, 0.35),
        "drawdown_delever_threshold": FloatRange(0.08, 0.20),
        "shorts_enabled": Categorical([True, False]),
        "universe_size": Categorical(["minimal_6", "full_11"]),
    }


__all__ = [
    "DEFAULT_PARAMS",
    "UNIVERSE_MINIMAL_6",
    "UNIVERSE_FULL_11",
    "TSMomentumConfig",
    "build_search_space",
]
