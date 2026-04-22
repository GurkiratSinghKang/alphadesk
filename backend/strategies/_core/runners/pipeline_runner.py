"""DailyPipelineRunner — single-day live invocation.

Replaces the legacy strategy_adapter.py. Called by the existing daily
pipeline scheduler (data.ingestion.pipeline_runner) once per trading day
per strategy; returns a StrategyResult that the MasterAgent processes.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

import numpy as np

from strategies._core.contracts import StrategyInput, StrategyParams, StrategyResult
from strategies._core.protocol import Strategy
from strategies._core.providers import ProviderBundle


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
    ):
        self._strategy = strategy
        self._providers = providers
        self._state_store = state_store

    async def run_today(
        self,
        params: StrategyParams,
        asof: date | None = None,
    ) -> StrategyResult:
        if asof is None:
            # For production, use a market calendar. Phase 1 uses today.
            from datetime import date as _date
            asof = _date.today()

        state = await self._state_store.load(self._strategy.META.name)
        symbols = self._strategy.universe(asof, state)
        bars = self._providers.bars.fetch_window(
            symbols, asof, self._strategy.META.lookback_days
        )
        earnings = (
            self._providers.earnings.fetch_window(symbols, asof, self._strategy.META.lookback_days)
            if self._providers.earnings else None
        )

        # Live mode uses a deterministic seed derived from strategy name + date
        # so replay from state_store is stable across process restarts on the same day.
        import hashlib
        seed_bytes = hashlib.sha256(f"{self._strategy.META.name}:{asof.isoformat()}".encode()).digest()[:4]
        seed = int.from_bytes(seed_bytes, "big")

        input = StrategyInput(
            asof=asof, mode="live", bars=bars, earnings=earnings,
            cash=Decimal("0"),  # live-mode cash comes from broker; strategy shouldn't depend on it
            equity=Decimal("0"),
            positions=[],       # populated from broker in a future task
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
