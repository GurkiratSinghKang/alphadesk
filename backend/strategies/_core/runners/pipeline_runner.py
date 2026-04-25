"""DailyPipelineRunner — single-day live invocation.

Replaces the legacy strategy_adapter.py. Called by the existing daily
pipeline scheduler (data.ingestion.pipeline_runner) once per trading day
per strategy; returns a StrategyResult that the MasterAgent processes.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
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


# A ``positions_provider`` is a callable returning the broker-side position
# snapshot at ``asof``. It may be sync (``list[Position]``) or async
# (``Awaitable[list[Position]]``) — the runner accepts both.
PositionsProvider = Callable[[date], list[Position] | Awaitable[list[Position]]]


class StateStore:
    """Abstract state persistence — read/write a strategy's state dict.

    Phase 1: in-memory dict-of-dicts placeholder. Phase 2 wires to Redis
    using the existing cache layer (backend/core/cache.py).
    """

    def __init__(self):
        self._data: dict[str, dict[str, Any]] = {}

    async def load(self, strategy_name: str) -> dict[str, Any]:
        return self._data.get(strategy_name, {})

    async def save(self, strategy_name: str, state: dict[str, Any]) -> None:
        self._data[strategy_name] = dict(state)


class DailyPipelineRunner:
    def __init__(
        self,
        strategy: Strategy,
        providers: ProviderBundle,
        state_store: StateStore,
        positions_provider: PositionsProvider | None = None,
    ):
        """Construct a DailyPipelineRunner.

        Round-6 / I-13: ``positions_provider`` is the broker-side position
        snapshot loader. Pass ``None`` (or omit) to keep the legacy empty-
        positions behaviour for backtest / paper smoke runs; pass a real
        callable in live mode so strategies that condition on the open book
        (kama_breakout exits, pead time-stops, pairs_trading watchdog) see
        the broker truth instead of a silent empty list.

        The callable accepts ``asof`` and returns ``list[Position]`` either
        synchronously or as a coroutine; ``run_today`` awaits if needed.
        """
        self._strategy = strategy
        self._providers = providers
        self._state_store = state_store
        self._positions_provider = positions_provider

    async def run_today(
        self,
        params: StrategyParams,
        asof: date | None = None,
    ) -> StrategyResult:
        if asof is None:
            # For production, use a market calendar. Phase 1 uses today.
            from datetime import date as _date
            asof = _date.today()

        # Round-6 / I-1: research-kind strategies are research stubs — they
        # carry no executable signal path and must never be invoked from the
        # live pipeline. Returning early with an explicit diagnostic preserves
        # the runner's "shape contract" (always returns a StrategyResult) and
        # surfaces the block reason to the MasterAgent / audit log.
        if getattr(self._strategy.META, "kind", "autonomous") == "research":
            return StrategyResult(
                signals=[], state_update={},
                diagnostics={"research_kind_blocked": True},
                warnings=[
                    f"{self._strategy.META.name} has meta.kind='research' — "
                    "research stubs cannot emit live signals; pipeline is a no-op"
                ],
            )

        # meta.paper_only = True blocks live-mode emission; the strategy
        # still runs in backtest/paper modes. The runner returns an empty
        # result with a warning so the MasterAgent sees the block reason.
        if self._strategy.META.paper_only:
            return StrategyResult(
                signals=[], state_update={},
                diagnostics={"paper_only_blocked": True},
                warnings=[
                    f"{self._strategy.META.name} has meta.paper_only=True — "
                    "skipped live-mode emission"
                ],
            )

        state = await self._state_store.load(self._strategy.META.name)
        symbols = self._strategy.universe(asof, state)
        bars = self._providers.bars.fetch_window(
            symbols, asof, self._strategy.META.lookback_days
        )
        earnings = (
            self._providers.earnings.fetch_window(symbols, asof, self._strategy.META.lookback_days)
            if self._providers.earnings else None
        )

        # Round-6 / I-13: positions are not optional in live mode. If the
        # provider isn't wired, fail loudly here rather than silently feed
        # the strategy an empty book — the previous behaviour caused
        # kama_breakout / pead / pairs_trading to skip exits and time-stops
        # because they couldn't see the broker positions, and a half-empty
        # ledger drifted further every day. Construction-time wiring is the
        # only safe default.
        positions: list[Position] = []
        if self._positions_provider is None:
            raise RuntimeError(
                "DailyPipelineRunner cannot run live with empty positions — "
                "wire positions_provider"
            )
        maybe_positions = self._positions_provider(asof)
        if hasattr(maybe_positions, "__await__"):
            positions = await maybe_positions  # type: ignore[assignment]
        else:
            positions = list(maybe_positions)  # type: ignore[arg-type]

        # Live mode uses a deterministic seed derived from strategy name + date
        # so replay from state_store is stable across process restarts on the same day.
        import hashlib
        seed_bytes = hashlib.sha256(f"{self._strategy.META.name}:{asof.isoformat()}".encode()).digest()[:4]
        seed = int.from_bytes(seed_bytes, "big")

        input = StrategyInput(
            asof=asof, mode="live", bars=bars, earnings=earnings,
            cash=Decimal("0"),  # live-mode cash comes from broker; strategy shouldn't depend on it
            equity=Decimal("0"),
            positions=positions,
            state=state,
            seed=seed,
            rng=np.random.default_rng(seed),
        )
        result = self._strategy.run(input, params)

        # Persist state update for the next day's run
        await self._state_store.save(
            self._strategy.META.name,
            {**state, **result.state_update},
        )
        return result
