"""Smoke tests for the ORB strategy — research shell."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import numpy as np
import pandas as pd

from strategies._core.contracts import StrategyInput
from strategies._core.protocol import get_meta, get_strategy
from strategies.orb.config import ORBParams, UNIVERSE_PROFILES
from strategies.orb.strategy import ORBStrategy


def _build_input(asof: date) -> StrategyInput:
    bars = pd.DataFrame({
        "symbol": ["QQQ"], "date": [asof],
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
        cls = get_strategy("orb")
        assert cls is ORBStrategy
        meta = get_meta("orb")
        assert meta.name == "orb"
        assert meta.category == "intraday"
        assert meta.kind == "research"
        assert "1min" in meta.required_bars


class TestParams:
    def test_defaults(self):
        p = ORBParams()
        assert p.or_minutes == 5
        assert p.entry_cutoff_hour_et == 14
        assert p.universe_profile == "qqq_tqqq"
        assert p.allow_shorts is False


class TestRun:
    def test_research_shell_emits_no_signals(self):
        strat = ORBStrategy()
        result = strat.run(_build_input(date(2024, 4, 30)), ORBParams())
        assert result.signals == []
        assert result.diagnostics.get("research_shell") is True

    def test_universe_returns_profile_tickers(self):
        strat = ORBStrategy()
        syms = strat.universe(date(2024, 4, 30), state={})
        assert syms == list(UNIVERSE_PROFILES["qqq_tqqq"])
