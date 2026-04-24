"""Smoke tests for the VWAP strategy — research shell.

Registered as ``kind="research"`` pending 5-min intraday integration in
``StrategyInput``. Verifies registration and the diagnostics pipeline.
"""

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
    bars = pd.DataFrame({
        "symbol": ["SPY"], "date": [asof],
        "open": [100.0], "high": [100.0], "low": [100.0],
        "close": [100.0], "volume": [1_000_000.0],
    }).set_index(["date", "symbol"])
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars,
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=[], state={},
        seed=0, rng=np.random.default_rng(0),
    )


class TestRegistration:
    def test_strategy_registered_as_research(self):
        cls = get_strategy("vwap")
        assert cls is VWAPStrategy
        meta = get_meta("vwap")
        assert meta.name == "vwap"
        assert meta.category == "intraday"
        assert meta.kind == "research"
        assert "5min" in meta.required_bars


class TestParams:
    def test_defaults(self):
        p = VWAPParams()
        assert p.rsi_period == 2
        assert p.rsi_entry_max == 15.0
        assert p.allow_shorts is False
        assert p.max_positions == 3


class TestRun:
    def test_research_shell_emits_no_signals(self):
        strat = VWAPStrategy()
        result = strat.run(_build_input(date(2024, 4, 30)), VWAPParams())
        assert result.signals == []
        assert result.diagnostics.get("research_shell") is True

    def test_universe_covers_ten_liquid_names(self):
        strat = VWAPStrategy()
        syms = strat.universe(date(2024, 4, 30), state={})
        assert len(syms) == len(UNIVERSE)
        assert "SPY" in syms
