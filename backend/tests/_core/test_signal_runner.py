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


class _ProviderAwareStrategy(Strategy):
    PARAMS_MODEL = SimpleParams
    META = StrategyMeta(
        name="signal_provider_contract",
        category="options",
        lookback_days=10,
        required_bars=("5min",),
    ).model_copy(update={"params_model": SimpleParams})

    def universe(self, asof, state):
        return ["SPY"]

    def run(self, input, params):
        return StrategyResult(
            signals=[],
            diagnostics={
                "daily_rows": len(input.bars),
                "has_5min": "5min" in input.intraday_bars,
                "five_min_rows": len(input.intraday_bars.get("5min", [])),
                "earnings_rows": 0 if input.earnings is None else len(input.earnings),
                "fundamentals_rows": 0 if input.fundamentals is None else len(input.fundamentals),
                "options_symbols": sorted(input.options_chains),
            },
        )


class _BarsProvider:
    def __init__(self):
        self.calls: list[str] = []

    def fetch_window(self, symbols, asof, lookback_days, timeframe="1D"):
        self.calls.append(timeframe)
        return pd.DataFrame({
            "open": [100.0],
            "high": [101.0],
            "low": [99.0],
            "close": [100.5],
            "volume": [1_000_000],
            "tf": [timeframe],
        }, index=pd.MultiIndex.from_tuples(
            [(asof, symbols[0])], names=["date", "symbol"],
        ))


class _EarningsProvider:
    def fetch_window(self, symbols, asof, lookback_days):
        return pd.DataFrame([{"symbol": symbols[0], "date": asof}])


class _FundamentalsProvider:
    def snapshot(self, symbols, asof):
        return pd.DataFrame([{"symbol": symbols[0], "market_cap": 1_000_000}])


class _OptionsProvider:
    async def fetch_chains(self, symbols, asof):
        return {
            symbols[0]: pd.DataFrame([
                {"symbol": "SPY240503C00500000", "strike": 500.0}
            ])
        }


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


def test_signal_runner_provider_input_matches_strategy_contract():
    """CLI/signal runs should receive the same optional inputs as pipeline runs."""
    from strategies._core.providers import ProviderBundle

    bars = _BarsProvider()
    runner = SignalRunner(
        providers=ProviderBundle(
            bars=bars,
            earnings=_EarningsProvider(),
            fundamentals=_FundamentalsProvider(),
            options=_OptionsProvider(),
        )
    )

    result = runner.run_once(
        _ProviderAwareStrategy(),
        SimpleParams(),
        asof=date(2024, 5, 1),
    )

    assert bars.calls == ["1D", "5min"]
    assert result.diagnostics == {
        "daily_rows": 1,
        "has_5min": True,
        "five_min_rows": 1,
        "earnings_rows": 1,
        "fundamentals_rows": 1,
        "options_symbols": ["SPY"],
    }
