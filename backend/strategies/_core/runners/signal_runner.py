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
from typing import Any, Awaitable, Callable

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
                    positions = _await_sync(maybe)  # type: ignore[arg-type]
                else:
                    positions = list(maybe)  # type: ignore[arg-type]
            except Exception:
                positions = []
        if self._state_store is not None and hasattr(self._state_store, "load"):
            try:
                load_coro = self._state_store.load(strategy.META.name)  # type: ignore[union-attr]
                state = _await_sync(load_coro)
            except Exception:
                state = {}

        symbols = strategy.universe(asof, state=state)
        bars = _fetch_bars(
            self._providers.bars, symbols, asof,
            strategy.META.lookback_days, "1D",
        )
        intraday_bars = {}
        for timeframe in tuple(getattr(strategy.META, "required_bars", ("daily",))):
            if timeframe == "daily":
                continue
            intraday_bars[timeframe] = _fetch_bars(
                self._providers.bars, symbols, asof,
                strategy.META.lookback_days, timeframe,
            )
        earnings = (
            self._providers.earnings.fetch_window(symbols, asof, strategy.META.lookback_days)
            if self._providers.earnings else None
        )
        fundamentals = (
            self._providers.fundamentals.snapshot(symbols, asof)
            if self._providers.fundamentals else None
        )
        options_chains = {}
        if (
            getattr(strategy.META, "category", None) == "options"
            and self._providers.options is not None
            and symbols
        ):
            maybe_options = self._providers.options.fetch_chains(symbols, asof)
            options_chains = dict(_await_sync(maybe_options))
        return StrategyInput(
            asof=asof, mode="backtest", bars=bars,
            intraday_bars=intraday_bars,
            earnings=earnings, fundamentals=fundamentals,
            options_chains=options_chains,
            cash=Decimal("100000"), equity=Decimal("100000"),
            positions=positions, state=state,
            seed=0, rng=np.random.default_rng(0),
        )


def _fetch_bars(
    bar_provider: object,
    symbols: list[str],
    asof: date,
    lookback_days: int,
    timeframe: str,
):
    """Call old or new BarProvider shims with a timeframe."""
    try:
        return bar_provider.fetch_window(  # type: ignore[attr-defined]
            symbols, asof, lookback_days, timeframe=timeframe,
        )
    except TypeError:
        if timeframe == "1D":
            return bar_provider.fetch_window(  # type: ignore[attr-defined]
                symbols, asof, lookback_days,
            )
        raise


def _await_sync(value: Any) -> Any:
    """Resolve awaitables for the sync CLI runner.

    SignalRunner is deliberately synchronous because it backs the per-strategy
    CLI. Async providers such as options chains are fine from the CLI path, but
    calling this from an already-running event loop would deadlock, so fail
    loudly in that case instead of silently returning an empty input.
    """
    if not hasattr(value, "__await__"):
        return value
    import asyncio

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(value)
    raise RuntimeError(
        "SignalRunner cannot resolve async providers inside an active event loop"
    )
