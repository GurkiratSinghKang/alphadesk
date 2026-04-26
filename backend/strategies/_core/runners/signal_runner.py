"""SignalRunner — one-off strategy invocation for CLI.

Used by `python -m strategies.<name> signal` and `explain`. No portfolio,
no fill simulation, no state persistence — just builds a StrategyInput
(or loads one from snapshot for --replay) and calls strategy.run().

Round-11 / AA-1.5 (P1): the CLI used to call ``_build_from_providers``
which hardcoded ``positions=[]`` and ``state={}``. The CLI is the
operator's "what would the strategy do today?" tool — running it
against an empty book gave a fiction (PEAD's time-stops looked
different, pairs_trading's ledger was empty). Constructors now accept
optional ``positions_provider`` and ``state_store`` so callers can
thread the live broker snapshot + persisted state in. The CLI default
keeps the legacy empty-book behaviour for offline use; live invocations
should pass real providers.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Awaitable, Callable

import numpy as np

from strategies._core.contracts import (
    Position,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import Strategy
from strategies._core.providers import ProviderBundle
from strategies._core.snapshots import SnapshotReader

# Same callable shape as DailyPipelineRunner's PositionsProvider —
# kept locally to avoid circular imports.
PositionsProvider = Callable[[date], list[Position] | Awaitable[list[Position]]]


class SignalRunner:
    def __init__(
        self,
        providers: ProviderBundle | None = None,
        positions_provider: PositionsProvider | None = None,
        state_store: object | None = None,
    ):
        """Construct a SignalRunner.

        ``positions_provider`` and ``state_store`` are optional so the
        legacy empty-book behaviour stays the default for offline CLI
        use. Live "what would the strategy do today?" invocations
        should pass both — the CLI itself wires them in if the operator
        has set ``--live-snapshot``.
        """
        self._providers = providers
        self._positions_provider = positions_provider
        self._state_store = state_store

    def run_once(
        self,
        strategy: Strategy,
        params: StrategyParams,
        asof: date,
        replay_from: Path | None = None,
    ) -> StrategyResult:
        """Run strategy on one bar; return raw result.

        If `replay_from` is set, load the StrategyInput from a snapshot
        directory (enables --replay). Otherwise, build input from the
        provider bundle (which must be set).
        """
        if replay_from is not None:
            input = SnapshotReader(replay_from).read(asof)
        else:
            if self._providers is None:
                raise ValueError(
                    "SignalRunner needs either replay_from or a ProviderBundle"
                )
            input = self._build_from_providers(strategy, asof)
        return strategy.run(input, params)

    def _build_from_providers(self, strategy: Strategy, asof: date) -> StrategyInput:
        # Round-11 / AA-1.5: load real positions + state when callers
        # supplied the wiring; fall back to empty book for offline /
        # backtest seed flows that don't care about live truth.
        positions: list[Position] = []
        state: dict = {}
        if self._positions_provider is not None:
            try:
                maybe = self._positions_provider(asof)
                if hasattr(maybe, "__await__"):
                    import asyncio
                    positions = asyncio.get_event_loop().run_until_complete(maybe)  # type: ignore[arg-type]
                else:
                    positions = list(maybe)  # type: ignore[arg-type]
            except Exception:
                positions = []
        if self._state_store is not None and hasattr(self._state_store, "load"):
            try:
                import asyncio
                load_coro = self._state_store.load(strategy.META.name)  # type: ignore[union-attr]
                state = asyncio.get_event_loop().run_until_complete(load_coro)
            except Exception:
                state = {}

        symbols = strategy.universe(asof, state=state)
        bars = self._providers.bars.fetch_window(
            symbols, asof, strategy.META.lookback_days
        )
        earnings = (
            self._providers.earnings.fetch_window(symbols, asof, strategy.META.lookback_days)
            if self._providers.earnings else None
        )
        return StrategyInput(
            asof=asof, mode="backtest", bars=bars, earnings=earnings,
            cash=Decimal("100000"), equity=Decimal("100000"),
            positions=positions, state=state,
            seed=0, rng=np.random.default_rng(0),
        )
