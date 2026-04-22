"""SignalRunner — one-off strategy invocation for CLI.

Used by `python -m strategies.<name> signal` and `explain`. No portfolio,
no fill simulation, no state persistence — just builds a StrategyInput
(or loads one from snapshot for --replay) and calls strategy.run().
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import numpy as np

from strategies._core.contracts import StrategyInput, StrategyParams, StrategyResult
from strategies._core.protocol import Strategy
from strategies._core.providers import ProviderBundle
from strategies._core.snapshots import SnapshotReader


class SignalRunner:
    def __init__(self, providers: ProviderBundle | None = None):
        self._providers = providers

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
        symbols = strategy.universe(asof, state={})
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
            positions=[], state={},
            seed=0, rng=np.random.default_rng(0),
        )
