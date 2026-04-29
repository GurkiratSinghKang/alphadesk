"""BacktestRunner — orchestrates bar-by-bar strategy execution + reproducibility."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import numpy as np
import pandas as pd
import pytest
from pydantic import Field

from strategies._core.contracts import (
    BacktestConfig,
    OrderType,
    Signal,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import (
    Strategy,
    StrategyMeta,
    register_strategy,
)
from strategies._core.runners.backtest_runner import BacktestRunner


class SimpleParams(StrategyParams):
    buy_threshold: float = Field(default=100.0)


class FakeBarProvider:
    """Deterministic bar provider — synthesizes a price series."""
    def __init__(self, symbols: list[str], start: date, days: int, price_start: float = 100.0):
        self._symbols = symbols
        dates = [start + timedelta(days=i) for i in range(days)]
        self._df = pd.DataFrame([
            {"date": d, "symbol": sym, "open": price_start + i,
             "high": price_start + i + 1, "low": price_start + i - 1,
             "close": price_start + i + 0.5, "volume": 1_000_000}
            for i, d in enumerate(dates) for sym in symbols
        ]).set_index(["date", "symbol"])

    def fetch_window(self, symbols, asof, lookback_days):
        cutoff = asof - timedelta(days=lookback_days)
        return self._df.query("date >= @cutoff and date <= @asof")


class BuyTheDipStrategy(Strategy):
    """Test double: buys 1 share of SPY whenever close < buy_threshold."""
    PARAMS_MODEL = SimpleParams

    def universe(self, asof, state):
        return ["SPY"]

    def run(self, input, params):
        try:
            today = input.bars.xs(input.asof, level="date")
        except KeyError:
            return StrategyResult()
        signals = []
        for sym, row in today.iterrows():
            if row["close"] < params.buy_threshold and not any(p.symbol == sym for p in input.positions):
                signals.append(Signal(
                    symbol=sym, asof=input.asof,
                    order_type=OrderType.MOO, quantity=1,
                ))
        return StrategyResult(signals=signals)


def _make_bars(start: date, days: int):
    return FakeBarProvider(["SPY"], start, days, price_start=100.0)


def test_backtest_runner_produces_deterministic_results():
    """Two identical runs must produce bitwise-identical equity curves."""
    strat = BuyTheDipStrategy()
    # Must register so META is attached
    register_strategy(StrategyMeta(name="bttest", category="equity", lookback_days=5))(BuyTheDipStrategy)
    strat2 = BuyTheDipStrategy()

    cfg = BacktestConfig(
        start=date(2024, 1, 1), end=date(2024, 1, 10),
        starting_cash=Decimal("100000"), seed=42,
    )
    bars = _make_bars(cfg.start, 10)
    r1 = BacktestRunner(strat, cfg, bar_provider=bars).run(SimpleParams(buy_threshold=200.0))
    r2 = BacktestRunner(strat2, cfg, bar_provider=bars).run(SimpleParams(buy_threshold=200.0))

    # Round-6 / I-11: ReproMeta is now fully deterministic — run_at lives
    # on audit_metadata so two replays produce a bitwise-equal repro
    # block. Equity curves and signals also match exactly.
    pd.testing.assert_frame_equal(r1.equity_curve, r2.equity_curve)
    assert r1.signals_emitted == r2.signals_emitted
    assert r1.repro == r2.repro
    assert r1.repro.param_hash == r2.repro.param_hash


def test_backtest_result_repro_metadata_populated():
    register_strategy(StrategyMeta(name="bttest2", category="equity", lookback_days=5))(BuyTheDipStrategy)
    cfg = BacktestConfig(
        start=date(2024, 1, 1), end=date(2024, 1, 10),
        starting_cash=Decimal("100000"), seed=42,
    )
    result = BacktestRunner(
        BuyTheDipStrategy(), cfg, bar_provider=_make_bars(cfg.start, 10)
    ).run(SimpleParams())
    m = result.repro
    assert len(m.param_hash) == 16
    assert m.strategy_name == "bttest2"
    assert m.seed == 42
    # Round-11 / AA-1.6: import RUNNER_VERSION so a future bump
    # doesn't break this test — the assertion is "the runner stamps
    # the constant" not "the constant equals 1.0.0".
    from strategies._core import RUNNER_VERSION
    assert m.runner_version == RUNNER_VERSION


def test_metrics_sharpe_excludes_seed_bar_zero_return():
    """The row-0 pct_change fill must not make smooth returns look volatile."""
    idx = pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04"]).date
    equity_df = pd.DataFrame(
        {"equity": [100.0, 102.0, 104.04], "drawdown": [0.0, 0.0, 0.0]},
        index=idx,
    )
    daily_returns = pd.Series([0.0, 0.02, 0.02], index=idx)

    metrics = BacktestRunner._compute_metrics(equity_df, daily_returns)

    assert metrics["sharpe"] == pytest.approx(0.0)
