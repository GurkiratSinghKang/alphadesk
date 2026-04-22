"""SignalRunner — one-off invocation for CLI, supports --replay for deterministic replay."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd
from pydantic import Field

from strategies._core.contracts import (
    OrderType,
    Signal,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy
from strategies._core.runners.signal_runner import SignalRunner
from strategies._core.snapshots import SnapshotWriter


class SimpleParams(StrategyParams):
    pass


class EmptyStrategy(Strategy):
    PARAMS_MODEL = SimpleParams

    def universe(self, asof, state):
        return ["SPY"]

    def run(self, input, params):
        signals = [
            Signal(symbol="SPY", asof=input.asof,
                   order_type=OrderType.MKT, quantity=10)
        ]
        return StrategyResult(signals=signals)


def test_signal_runner_replay_produces_identical_result(tmp_path: Path):
    """Write a snapshot, then replay — must produce the same StrategyResult."""
    # Register strategy so META is attached
    register_strategy(StrategyMeta(name="replay_test"))(EmptyStrategy)

    bars = pd.DataFrame({
        "open": [100.0], "high": [101.0], "low": [99.0],
        "close": [100.5], "volume": [1_000_000],
    }, index=pd.MultiIndex.from_tuples(
        [(date(2024, 1, 1), "SPY")], names=["date", "symbol"],
    ))

    seed = 42
    original_input = StrategyInput(
        asof=date(2024, 1, 1), mode="backtest", bars=bars,
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=[], state={},
        seed=seed, rng=np.random.default_rng(seed),
    )
    writer = SnapshotWriter(tmp_path)
    writer.write(original_input)

    runner = SignalRunner()
    result = runner.run_once(
        EmptyStrategy(), SimpleParams(),
        asof=date(2024, 1, 1),
        replay_from=tmp_path,
    )

    assert len(result.signals) == 1
    assert result.signals[0].symbol == "SPY"
    assert result.signals[0].quantity == 10
