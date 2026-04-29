"""VWAP session-pullback — SOTA shell (research stub).

Intraday 5-min strategy. Currently registered as ``kind="research"`` pending
5-min intraday integration with the daily-first BacktestRunner. The
signal logic is preserved in git history and can be restored once
``StrategyInput`` carries 5-min bars.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from strategies._core.contracts import (
    StrategyInput,
    StrategyResult,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import UNIVERSE, VWAPParams


log = logging.getLogger("alphadesk.strategies.vwap")

_NS = "vwap"
_REQUIRED_LOOKBACK_DAYS = 150


@register_strategy(
    StrategyMeta(
        name="vwap",
        category="intraday",
        kind="research",  # 5-min intraday path not yet in StrategyInput
        description=(
            "VWAP session-pullback on liquid single-names: enter on a "
            "pullback toward session VWAP when trend + RSI gates align. "
            "Research shell pending 5-min intraday integration in "
            "StrategyInput."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("5min",),
        min_universe_size=1,
    )
)
class VWAPStrategy(Strategy):
    """VWAP pullback (research shell)."""

    PARAMS_MODEL = VWAPParams

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return list(UNIVERSE)

    def run(
        self,
        input: StrategyInput,
        params: VWAPParams,
    ) -> StrategyResult:
        # Research stub: no signals emitted until 5-min bars arrive in
        # StrategyInput. Diagnostics record the gate so the MasterAgent
        # knows why this strategy is quiet.
        return StrategyResult(
            signals=[],
            diagnostics={
                "research_shell": True,
                "reason": "5min intraday integration deferred",
                "required_bar_interval": "5min",
                "active_symbols": list(UNIVERSE),
            },
            warnings=[],
        )


__all__ = ["VWAPStrategy"]
