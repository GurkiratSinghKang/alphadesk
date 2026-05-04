"""Momentum + Quality — SOTA shell.

Cross-sectional long-only factor strategy combining Jegadeesh-Titman 12-1
month momentum with the Piotroski F-score quality signal. Monthly rebalance
into the top-N composite-ranked names from a fixed ~50-name S&P 500-style
universe (Piotroski-style quality composite with AFP-style sector exclusions
— ex-Financials / ex-Utilities). Note: the quality leg is Piotroski F-score
only, not Asness-Frazzini-Pedersen (2019) QMJ's 4-pillar composite.

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
    Fill,
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
            "equal-weighted, ex-Financials / ex-Utilities (Piotroski-style quality "
            "with AFP-style sector exclusions — not the AFP/QMJ 4-pillar composite)."
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

        target, target_diagnostics = _compute_target_with_diagnostics(
            params,
            input.bars,
            input.fundamentals,
            input.earnings,
            universe_list,
            asof,
        )
        diagnostics["target"] = list(target)
        diagnostics["candidate_funnel"] = target_diagnostics

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
            state_update[f"{_NS}.held_symbols"] = sorted(held)
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

        state_update[f"{_NS}.held_symbols"] = sorted(held | target_set)
        return StrategyResult(
            signals=signals,
            state_update=state_update,
            diagnostics=diagnostics,
            warnings=warnings,
        )

    def on_fill(self, fill: Fill, state: dict[str, Any]) -> dict[str, Any]:
        held_symbols = set(state.get(f"{_NS}.held_symbols") or [])
        tag = fill.signal_tag or ""
        if tag.startswith("mq-exit"):
            held_symbols.discard(fill.symbol)
        elif tag.startswith("mq-entry") or fill.quantity > 0:
            held_symbols.add(fill.symbol)
        return {f"{_NS}.held_symbols": sorted(held_symbols)}


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
    target, _diagnostics = _compute_target_with_diagnostics(
        params, bars, fundamentals, earnings, universe_list, asof
    )
    return target


def _compute_target_with_diagnostics(
    params: MomentumQualityParams,
    bars: pd.DataFrame,
    fundamentals: pd.DataFrame | None,
    earnings: pd.DataFrame | None,
    universe_list: list[str],
    asof: date,
) -> tuple[list[str], dict[str, Any]]:
    """Return top-N targets plus a JSON-safe candidate funnel."""
    diagnostics: dict[str, Any] = {
        "universe_size": len(universe_list),
        "required_bars": params.momentum_lookback_m * _TRADING_DAYS_PER_MONTH
        + params.momentum_skip_m * _TRADING_DAYS_PER_MONTH
        + 2,
        "panel_rows": 0,
        "panel_symbols": 0,
        "momentum_available": 0,
        "filtered_below_momentum_floor": 0,
        "fscore_available": 0,
        "filtered_missing_fscore": 0,
        "filtered_low_fscore": 0,
        "earnings_blocked": 0,
        "ranked_candidates": 0,
        "selected": [],
        "drop_reasons": {},
    }
    panel = close_panel_from_bars(bars, asof)
    if panel is None or panel.empty:
        diagnostics["drop_reasons"]["bars_unavailable"] = len(universe_list)
        return [], diagnostics

    diagnostics["panel_rows"] = int(len(panel))
    diagnostics["panel_symbols"] = int(len(panel.columns))

    lookback_days = params.momentum_lookback_m * _TRADING_DAYS_PER_MONTH
    skip_days = params.momentum_skip_m * _TRADING_DAYS_PER_MONTH
    min_bars = lookback_days + skip_days + 2
    if len(panel) < min_bars:
        diagnostics["drop_reasons"]["insufficient_panel_history"] = len(universe_list)
        return [], diagnostics

    mom = compute_momentum(panel, universe_list, lookback_days, skip_days)
    diagnostics["momentum_available"] = len(mom)
    missing_momentum = sorted(set(universe_list) - set(mom))
    if missing_momentum:
        diagnostics["drop_reasons"]["missing_momentum"] = len(missing_momentum)
    if not mom:
        return [], diagnostics

    eligible_syms = [s for s, r in mom.items() if r >= params.momentum_filter_min]
    low_momentum = sorted(s for s, r in mom.items() if r < params.momentum_filter_min)
    diagnostics["filtered_below_momentum_floor"] = len(low_momentum)
    if low_momentum:
        diagnostics["drop_reasons"]["below_momentum_floor"] = len(low_momentum)
    if not eligible_syms:
        return [], diagnostics

    fscores = get_fscores(fundamentals, eligible_syms, asof)
    diagnostics["fscore_available"] = sum(
        1 for s in eligible_syms if fscores.get(s) is not None
    )
    missing_fscore = sorted(s for s in eligible_syms if fscores.get(s) is None)
    diagnostics["filtered_missing_fscore"] = len(missing_fscore)
    if missing_fscore:
        diagnostics["drop_reasons"]["missing_fscore"] = len(missing_fscore)
    low_fscore = sorted(
        s for s in eligible_syms
        if (f := fscores.get(s)) is not None and f < params.min_f_score
    )
    diagnostics["filtered_low_fscore"] = len(low_fscore)
    if low_fscore:
        diagnostics["drop_reasons"]["low_fscore"] = len(low_fscore)
    eligible_syms = [
        s for s in eligible_syms
        if (f := fscores.get(s)) is not None and f >= params.min_f_score
    ]
    if not eligible_syms:
        return [], diagnostics

    if params.earnings_skip_days > 0:
        blocked = earnings_blocked(
            earnings, eligible_syms, asof, params.earnings_skip_days,
        )
        diagnostics["earnings_blocked"] = len(blocked)
        if blocked:
            diagnostics["drop_reasons"]["earnings_window"] = len(blocked)
        eligible_syms = [s for s in eligible_syms if s not in blocked]
        if not eligible_syms:
            return [], diagnostics

    q_weight = params.quality_weight
    m_weight = 1.0 - q_weight

    mom_vals = np.array([mom[s] for s in eligible_syms], dtype=float)
    f_vals = np.array([float(fscores[s]) for s in eligible_syms], dtype=float)
    mom_rank = rank_01(mom_vals)
    quality_rank = rank_01(f_vals)
    score = m_weight * mom_rank + q_weight * quality_rank

    order = np.argsort(-score, kind="stable")
    ranked = [
        {
            "symbol": str(eligible_syms[i]),
            "momentum": float(mom[eligible_syms[i]]),
            "f_score": int(fscores[eligible_syms[i]]),
            "momentum_rank": float(mom_rank[i]),
            "quality_rank": float(quality_rank[i]),
            "composite_score": float(score[i]),
        }
        for i in order
    ]
    target = [row["symbol"] for row in ranked[:params.top_n]]
    diagnostics["ranked_candidates"] = len(ranked)
    diagnostics["selected"] = ranked[:params.top_n]
    return target, diagnostics


__all__ = ["MomentumQualityStrategy"]
