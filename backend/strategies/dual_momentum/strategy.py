"""Dual Momentum (GEM) — Antonacci's Global Equities Momentum, SOTA shell.

Textbook rules (see ``spec.md``):

1. On the last trading session of each month, compute the 12-month excess
   return of the US-equity sleeve vs. a T-bill proxy. If excess > 0, the
   equity gate passes; otherwise hold bonds.
2. If the gate passes, rank the equity universe by 12-month return and
   hold 100% of the top sleeve. MOO at next open.
3. Between rebalance days, no-op.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Optional

import numpy as np
import pandas as pd

from strategies._core.contracts import (
    OrderType,
    Signal,
    StrategyInput,
    StrategyResult,
    TimeInForce,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import (
    DualMomentumParams,
    lookback_components,
    max_lookback,
)


log = logging.getLogger("alphadesk.strategies.dual_momentum")

_NS = "dual_momentum"
_REQUIRED_LOOKBACK_DAYS = 400


@register_strategy(
    StrategyMeta(
        name="dual_momentum",
        category="macro",
        description=(
            "Antonacci's Global Equities Momentum (GEM): rotate between US "
            "equity (VOO), ex-US equity (VEU) and aggregate bonds (AGG) on a "
            "monthly cadence using a 12-month absolute + relative momentum "
            "signal."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=3,
    )
)
class DualMomentumStrategy(Strategy):
    """Antonacci's GEM — see module docstring."""

    PARAMS_MODEL = DualMomentumParams

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        # Universe runs before run() and lacks params. Return the union of
        # every ticker any configured universe might use + bond/RF proxies.
        syms: set[str] = set()
        for choice in (("VOO", "VEU"), ("VOO", "VEU", "EFA"), ("SPY", "EFA", "EEM")):
            syms.update(choice)
        syms.update({"AGG", "IEF", "TLT", "BIL"})
        return sorted(syms)

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: DualMomentumParams,
    ) -> StrategyResult:
        asof = input.asof
        diagnostics: dict[str, Any] = {"rebalance": False}
        warnings: list[str] = []

        if not _is_rebalance_day(asof, params.rebalance_freq):
            return StrategyResult(
                signals=[], diagnostics=diagnostics, warnings=warnings,
            )
        diagnostics["rebalance"] = True

        target = _compute_target(params, input.bars, asof)
        diagnostics["target"] = target

        signals: list[Signal] = []

        # Close everything that isn't the target.
        for pos in input.positions:
            if pos.quantity == 0 or pos.symbol == target:
                continue
            signals.append(
                Signal(
                    symbol=pos.symbol,
                    target_weight=0.0,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag="dm-exit",
                    asof=asof,
                )
            )

        # Skip the entry if we're already holding the target at ≥0 weight.
        holding_target = any(
            pos.symbol == target and pos.quantity > 0 for pos in input.positions
        )
        if not holding_target:
            signals.append(
                Signal(
                    symbol=target,
                    target_weight=1.0,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag=f"dm-entry-{target}",
                    asof=asof,
                )
            )

        return StrategyResult(
            signals=signals,
            state_update={f"{_NS}.last_target": target},
            diagnostics=diagnostics,
            warnings=warnings,
        )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _is_rebalance_day(asof: date, freq: str) -> bool:
    """True iff ``asof`` is the last trading day in its calendar month.

    Mon-Fri fallback since pure-function run() has no calendar provider.
    """
    probe = asof + timedelta(days=1)
    for _ in range(7):
        if probe.month != asof.month:
            break
        if probe.weekday() < 5:
            return False
        probe += timedelta(days=1)
    is_last = asof.weekday() < 5
    if freq == "bimonthly":
        return is_last and (asof.month % 2 == 1)
    return is_last


def _close_panel(
    bars: pd.DataFrame,
    asof: date,
) -> Optional[pd.DataFrame]:
    """Pivot ``input.bars`` into a wide (date × ticker) close panel."""
    if bars is None or getattr(bars, "empty", True):
        return None

    idx_names = tuple(bars.index.names or ())
    if "symbol" in idx_names and "date" in idx_names:
        frame = bars.reset_index().rename(columns={"date": "ts"})
    else:
        frame = bars.copy()
        if "ts" not in frame.columns and "ts_date" in frame.columns:
            frame = frame.rename(columns={"ts_date": "ts"})

    if "symbol" not in frame.columns or "close" not in frame.columns or "ts" not in frame.columns:
        return None

    frame["ts"] = pd.to_datetime(frame["ts"], utc=True, errors="coerce").dt.tz_convert("UTC").dt.normalize()
    frame = frame.dropna(subset=["ts", "close"])
    if frame.empty:
        return None

    # Round-6 / I-20: truncate to ``asof`` BEFORE forward-filling. Filling
    # first would have leaked future closes back into earlier bars on
    # any symbol with a stale tail (e.g. ETF that paused early), biasing
    # the GEM relative-strength signal at the right edge of every backtest.
    wide = (
        frame.pivot_table(index="ts", columns="symbol", values="close", aggfunc="last")
        .sort_index()
    )
    cutoff = pd.Timestamp(asof, tz="UTC")
    wide = wide[wide.index <= cutoff]
    if wide is None or wide.empty:
        return None
    wide = wide.ffill()
    wide = _drop_halted_symbols(wide)
    if wide is None or wide.empty:
        return None
    return wide


def _compute_target(
    params: DualMomentumParams,
    bars: pd.DataFrame,
    asof: date,
) -> str:
    """Run the GEM decision logic and return the ticker to hold."""
    closes = _close_panel(bars, asof)
    if closes is None or closes.empty:
        return params.bond_fallback

    us_sym = params.relative_universe[0]
    rf_sym = params.risk_free_symbol
    components = lookback_components(params)

    eq_scores: dict[str, float] = {}
    for sym in params.relative_universe:
        r = _composite_return(closes, sym, components)
        if r is None:
            return params.bond_fallback
        eq_scores[sym] = r

    rf_r = _composite_return(closes, rf_sym, components)
    if rf_r is None:
        return params.bond_fallback

    if eq_scores[us_sym] - rf_r <= params.excess_return_floor:
        return params.bond_fallback

    return max(eq_scores.items(), key=lambda kv: kv[1])[0]


def _composite_return(
    closes: pd.DataFrame,
    symbol: str,
    components: tuple[tuple[int, float], ...],
) -> Optional[float]:
    """Weighted total-return composite over multiple lookbacks."""
    if symbol not in closes.columns:
        return None
    series = closes[symbol].dropna()
    n = len(series)
    total = 0.0
    total_w = 0.0
    for L, w in components:
        if n < L + 1:
            return None
        now = float(series.iloc[-1])
        then = float(series.iloc[-(L + 1)])
        if then <= 0:
            return None
        r = now / then - 1.0
        total += w * r
        total_w += w
    if total_w <= 0:
        return None
    return total / total_w


_DM_HALT_BARS = 5


def _drop_halted_symbols(wide: Optional[pd.DataFrame]) -> Optional[pd.DataFrame]:
    """Drop symbols with ≥5 consecutive flat closes (halted/delisted)."""
    if wide is None or wide.empty:
        return wide
    if len(wide.index) < _DM_HALT_BARS + 1:
        return wide
    tail = wide.tail(_DM_HALT_BARS + 1)
    flat: list[str] = []
    for col in wide.columns:
        vals = tail[col].dropna().values
        if len(vals) < _DM_HALT_BARS + 1:
            continue
        if np.all(vals == vals[0]):
            flat.append(str(col))
    if flat:
        log.warning(
            "dual_momentum: dropping %d halted symbols (>=%d flat closes): %s",
            len(flat), _DM_HALT_BARS, ",".join(sorted(flat)),
        )
        wide = wide.drop(columns=flat)
    return wide


__all__ = ["DualMomentumStrategy"]
