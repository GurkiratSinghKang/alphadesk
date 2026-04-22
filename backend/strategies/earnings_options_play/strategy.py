"""Earnings Options Play — research screener (no engine logic).

Research-kind strategies are stubs that exist purely so the registry knows
about them. `generate_signals` and friends return empty; the engine excludes
research-kind strategies from its run loop.
"""
from __future__ import annotations

from datetime import date
from typing import Iterable

from strategies.base import Context, Signal, Strategy, StrategyMeta
from strategies.registry import register_strategy


@register_strategy(
    StrategyMeta(
        name="earnings-options-play",
        category="options",
        description=(
            "Research screener: upcoming earnings + full options lab + Claude "
            "Opus analysis. Manual trade only (deep-links into /trade)."
        ),
        kind="research",
    )
)
class EarningsOptionsPlay(Strategy):
    """Stub — engine never invokes these."""

    name = "earnings-options-play"
    required_bars: list[str] = []
    required_lookback_days: int = 0

    def configure(self, params: dict) -> None:  # noqa: D401
        pass

    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        return ()

    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        return ()

    def on_fill(self, fill: object, ctx: Context) -> None:
        pass

    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        return ()
