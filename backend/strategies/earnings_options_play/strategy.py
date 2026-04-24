"""Earnings Options Play — research screener (no engine logic).

Research-kind stub so the registry knows about this strategy; the engine
excludes research-kind strategies from its run loop. All UI logic lives
in the frontend /trade deep-link path — this module only exists so
``get_strategy("earnings-options-play")`` succeeds.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import Field

from strategies._core.contracts import (
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy


class EarningsOptionsPlayParams(StrategyParams):
    """No-op params for the research-only earnings_options_play stub."""

    placeholder: bool = Field(default=True)


@register_strategy(
    StrategyMeta(
        name="earnings-options-play",
        category="options",
        kind="research",
        description=(
            "Research screener: upcoming earnings + full options lab + Claude "
            "Opus analysis. Manual trade only (deep-links into /trade)."
        ),
        lookback_days=0,
        min_universe_size=1,
    )
)
class EarningsOptionsPlay(Strategy):
    """Stub — engine never invokes these."""

    PARAMS_MODEL = EarningsOptionsPlayParams

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return []

    def run(
        self,
        input: StrategyInput,
        params: EarningsOptionsPlayParams,
    ) -> StrategyResult:
        return StrategyResult(
            signals=[],
            diagnostics={"research_shell": True, "reason": "UI-only screener"},
            warnings=[],
        )


__all__ = ["EarningsOptionsPlay"]
