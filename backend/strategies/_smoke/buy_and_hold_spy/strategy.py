"""Minimal "buy SPY on day 1, hold forever" smoke-test strategy.

Used by the F1 engine's smoke test to verify:

- the registry decorator fires on import,
- :meth:`Strategy.universe` is wired to the bar provider,
- :meth:`Strategy.generate_signals` is invoked on the first bar with a
  populated :class:`Context`,
- Portfolio accounting produces an equity curve whose Sharpe matches the
  SPY return series (since the strategy is 100% SPY long).

This is intentionally the simplest strategy possible. Phase 1 teams should
*not* copy this as a template for real strategies -- see the tutorial block
in :mod:`backend.strategies.base`.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Iterable, Mapping

from backend.strategies.base import Context, cache_of
from backend.strategies.registry import register_strategy
from backend.strategies.signal import OrderType, Signal


@register_strategy(
    name="buy_and_hold_spy",
    category="smoke",
    required_bars=("daily",),
    required_lookback_days=0,
    min_universe_size=1,
    supports_shorts=False,
    supports_options=False,
    description=(
        "100% SPY long on the first bar, held until the end of the backtest. "
        "Used for engine / registry smoke-testing."
    ),
)
class BuyAndHoldSPY:
    """Buy SPY on day 1, hold until end."""

    name = "buy_and_hold_spy"
    required_bars: list[str] = ["daily"]
    required_lookback_days: int = 0

    def __init__(self) -> None:
        self.symbol: str = "SPY"

    # -- lifecycle -------------------------------------------------------- #
    def configure(self, params: Mapping[str, Any]) -> None:
        """Accept an optional ``symbol`` override; default is SPY."""

        if not params:
            return
        sym = params.get("symbol")
        if sym:
            self.symbol = str(sym)

    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        return [self.symbol]

    def generate_signals(
        self, asof: date, ctx: Context
    ) -> Iterable[Signal]:
        cache = cache_of(ctx)
        if cache.get("allocated"):
            return []
        # Allocate once. The engine handles sizing from ``target_weight``.
        cache["allocated"] = True
        cache["allocation_date"] = asof
        return [
            Signal(
                symbol=self.symbol,
                target_weight=1.0,
                order_type=OrderType.MOO,
                tag="smoke-entry",
            )
        ]

    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        # Pure buy-and-hold: never exit.
        return []

    def on_fill(self, fill: Any, ctx: Context) -> None:
        # No state to update; keeping the method so duck-typed Protocol
        # checks pass uniformly.
        pass

    # -- tuner ------------------------------------------------------------ #
    @classmethod
    def search_space(cls) -> dict[str, Any]:
        # Buy-and-hold has nothing to tune, but we expose an (empty) hook so
        # the tuner's introspection finds it.
        return {}


__all__ = ["BuyAndHoldSPY"]
