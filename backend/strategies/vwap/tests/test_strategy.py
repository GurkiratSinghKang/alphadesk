"""Smoke tests for the VWAP strategy."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import numpy as np
import pandas as pd

from strategies._core.contracts import StrategyInput
from strategies._core.protocol import get_meta, get_strategy
from strategies.vwap.config import UNIVERSE, VWAPParams
from strategies.vwap.strategy import VWAPStrategy


def _build_input(asof: date) -> StrategyInput:
    dates = pd.bdate_range(end=pd.Timestamp(asof), periods=4)
    bars = pd.DataFrame({
        "symbol": ["SPY"] * 4,
        "date": [d.date() for d in dates],
        "open": [98.0, 99.0, 100.0, 100.8],
        "high": [99.0, 100.0, 101.0, 101.2],
        "low": [97.5, 98.5, 99.5, 100.2],
        "close": [98.0, 99.0, 100.0, 101.0],
        "volume": [1_000_000.0] * 4,
    }).set_index(["date", "symbol"])
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars,
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=[], state={},
        seed=0, rng=np.random.default_rng(0),
    )


def _build_intraday_input(asof: date) -> StrategyInput:
    inp = _build_input(asof)
    ts = pd.date_range("2024-04-30 13:30", periods=4, freq="5min", tz="UTC")
    intraday = pd.DataFrame({
        "date": [asof] * 4,
        "symbol": ["SPY"] * 4,
        "ts": ts,
        "open": [100.0, 100.8, 100.9, 100.85],
        "high": [100.2, 101.1, 101.0, 100.95],
        "low": [99.8, 100.7, 100.85, 100.80],
        "close": [100.0, 101.0, 100.95, 100.90],
        "volume": [1000, 1000, 1000, 1000],
    }).set_index(["date", "symbol"])
    return inp.model_copy(update={"intraday_bars": {"5min": intraday}})


class TestRegistration:
    def test_strategy_registered_as_paper_only_autonomous(self):
        cls = get_strategy("vwap")
        assert cls is VWAPStrategy
        meta = get_meta("vwap")
        assert meta.name == "vwap"
        assert meta.category == "intraday"
        assert meta.kind == "autonomous"
        assert meta.paper_only is True
        assert "5min" in meta.required_bars


class TestParams:
    def test_defaults(self):
        p = VWAPParams()
        assert p.rsi_period == 2
        assert p.rsi_entry_max == 15.0
        assert p.allow_shorts is False
        assert p.max_positions == 3


class TestRun:
    def test_missing_intraday_emits_no_signals(self):
        strat = VWAPStrategy()
        result = strat.run(_build_input(date(2024, 4, 30)), VWAPParams())
        assert result.signals == []
        assert result.diagnostics.get("data_ready") is False
        assert result.diagnostics["required_bar_interval"] == "5min"
        assert result.diagnostics["active_symbols"] == list(UNIVERSE)

    def test_pullback_emits_paper_signal(self):
        strat = VWAPStrategy()
        result = strat.run(
            _build_intraday_input(date(2024, 4, 30)),
            VWAPParams(
                trend_sma_daily=3,
                pullback_pct_max=0.004,
                rsi_entry_max=30.0,
            ),
        )
        assert len(result.signals) == 1
        sig = result.signals[0]
        assert sig.symbol == "SPY"
        assert sig.target_weight == VWAPParams().max_allocation / VWAPParams().max_positions
        assert sig.tag.startswith("vwap-entry:SPY:pullback")

    def test_universe_covers_ten_liquid_names(self):
        strat = VWAPStrategy()
        syms = strat.universe(date(2024, 4, 30), state={})
        assert len(syms) == len(UNIVERSE)
        assert "SPY" in syms
