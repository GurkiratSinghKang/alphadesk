"""Momentum + Quality — SOTA shell.

Cross-sectional long-only factor strategy combining Jegadeesh-Titman 12-1
month momentum with the Piotroski F-score quality signal. Monthly rebalance
into the top-N composite-ranked names from a fixed ~50-name S&P 500-style
universe (ex-Financials / ex-Utilities per AFP 2014 QMJ).

Rule summary (preserved from legacy hooks):

- On rebalance days only, compute per-symbol 12-1 momentum + F-score quality.
- Rank both factors cross-sectionally, blend with ``quality_weight``, pick
  top_n, emit equal-weight MOO entries.
- Close any held position not in the new target set.
- Non-rebalance bars: no-op.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

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

from .config import MomentumQualityParams, eligible_universe
from .helpers import (
    close_panel_from_bars,
    compute_momentum,
    earnings_blocked,
    get_fscores,
    is_rebalance_day,
    rank_01,
)


log = logging.getLogger("alphadesk.strategies.momentum_quality")


_NS = "momentum_quality"
_REQUIRED_LOOKBACK_DAYS = 420
_TRADING_DAYS_PER_MONTH = 21


@register_strategy(
    StrategyMeta(
        name="momentum_quality",
        category="equity",
        description=(
            "Long-only cross-sectional momentum + quality (Jegadeesh-Titman 1993 "
            "12-1 month momentum + Piotroski 2000 F-score). Top-N composite rank "
            "from a fixed ~50-name S&P-500-style universe, monthly rebalance, "
            "equal-weighted, ex-Financials / ex-Utilities (QMJ convention)."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=10,
    )
)
class MomentumQualityStrategy(Strategy):
    """Monthly-rotated long-only momentum+quality on a compact US large-cap book."""

    PARAMS_MODEL = MomentumQualityParams

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        cached = state.get(f"{_NS}.universe")
        if cached is None:
            cached = eligible_universe()
        held = set(state.get(f"{_NS}.held_symbols", []))
        return sorted(set(cached) | held)

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: MomentumQualityParams,
    ) -> StrategyResult:
        asof = input.asof
        state = input.state
        diagnostics: dict[str, Any] = {"rebalance": False}
        warnings: list[str] = []
        state_update: dict[str, Any] = {}

        # Stable universe cache — cheap to recompute, but the state-cached
        # version keeps universe() consistent between bars.
        universe_list = state.get(f"{_NS}.universe") or eligible_universe()
        state_update[f"{_NS}.universe"] = universe_list

        if not is_rebalance_day(asof, params.rebalance_freq):
            return StrategyResult(
                signals=[], state_update=state_update,
                diagnostics=diagnostics, warnings=warnings,
            )
        diagnostics["rebalance"] = True

        target = _compute_target(params, input.bars, input.fundamentals, input.earnings, universe_list, asof)
        diagnostics["target"] = list(target)

        target_set = set(target)
        signals: list[Signal] = []
        held: set[str] = set()

        # Exits first — close positions not in the new target.
        for pos in input.positions:
            if pos.quantity == 0:
                continue
            held.add(pos.symbol)
            if pos.symbol in target_set:
                continue
            signals.append(
                Signal(
                    symbol=pos.symbol,
                    target_weight=0.0,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag="mq-exit",
                    asof=asof,
                )
            )

        if not target:
            state_update[f"{_NS}.held_symbols"] = held
            return StrategyResult(
                signals=signals, state_update=state_update,
                diagnostics=diagnostics, warnings=warnings,
            )

        weight = 1.0 / float(len(target))
        for sym in target:
            signals.append(
                Signal(
                    symbol=sym,
                    target_weight=weight,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag="mq-entry",
                    asof=asof,
                )
            )

        state_update[f"{_NS}.held_symbols"] = held | target_set
        return StrategyResult(
            signals=signals,
            state_update=state_update,
            diagnostics=diagnostics,
            warnings=warnings,
        )


# --------------------------------------------------------------------------- #
# Core decision logic                                                         #
# --------------------------------------------------------------------------- #
def _compute_target(
    params: MomentumQualityParams,
    bars: pd.DataFrame,
    fundamentals: pd.DataFrame | None,
    earnings: pd.DataFrame | None,
    universe_list: list[str],
    asof: date,
) -> list[str]:
    """Return the ranked top-N symbol list for ``asof`` — pure function."""
    panel = close_panel_from_bars(bars, asof)
    if panel is None or panel.empty:
        return []

    lookback_days = params.momentum_lookback_m * _TRADING_DAYS_PER_MONTH
    skip_days = params.momentum_skip_m * _TRADING_DAYS_PER_MONTH
    min_bars = lookback_days + skip_days + 2
    if len(panel) < min_bars:
        return []

    mom = compute_momentum(panel, universe_list, lookback_days, skip_days)
    if not mom:
        return []

    eligible_syms = [s for s, r in mom.items() if r >= params.momentum_filter_min]
    if not eligible_syms:
        return []

    fscores = get_fscores(fundamentals, eligible_syms, asof)
    eligible_syms = [
        s for s in eligible_syms
        if (f := fscores.get(s)) is not None and f >= params.min_f_score
    ]
    if not eligible_syms:
        return []

    if params.earnings_skip_days > 0:
        blocked = earnings_blocked(
            earnings, eligible_syms, asof, params.earnings_skip_days,
        )
        eligible_syms = [s for s in eligible_syms if s not in blocked]
        if not eligible_syms:
            return []

    q_weight = params.quality_weight
    m_weight = 1.0 - q_weight

    mom_vals = np.array([mom[s] for s in eligible_syms], dtype=float)
    f_vals = np.array([float(fscores[s]) for s in eligible_syms], dtype=float)
    score = m_weight * rank_01(mom_vals) + q_weight * rank_01(f_vals)

    order = np.argsort(-score, kind="stable")
    return [eligible_syms[i] for i in order[:params.top_n]]


__all__ = ["MomentumQualityStrategy"]
