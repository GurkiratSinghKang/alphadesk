"""Smoke tests for the ORB strategy."""

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


def _build_intraday_input(asof: date) -> StrategyInput:
    inp = _build_input(asof)
    ts = pd.date_range("2024-04-30 13:30", periods=6, freq="min", tz="UTC")
    intraday = pd.DataFrame({
        "date": [asof] * 6,
        "symbol": ["QQQ"] * 6,
        "ts": ts,
        "open": [100, 100.1, 100.2, 100.3, 100.4, 101.0],
        "high": [100.4, 100.5, 100.6, 100.7, 100.8, 101.6],
        "low": [99.8, 99.9, 100.0, 100.1, 100.2, 100.9],
        "close": [100.1, 100.2, 100.3, 100.4, 100.5, 101.5],
        "volume": [1000, 1000, 1000, 1000, 1000, 2000],
    }).set_index(["date", "symbol"])
    return inp.model_copy(update={"intraday_bars": {"1min": intraday}})


class TestRegistration:
    def test_strategy_registered_as_paper_only_autonomous(self):
        cls = get_strategy("orb")
        assert cls is ORBStrategy
        meta = get_meta("orb")
        assert meta.name == "orb"
        assert meta.category == "intraday"
        assert meta.kind == "autonomous"
        assert meta.paper_only is True
        assert "1min" in meta.required_bars


class TestParams:
    def test_defaults(self):
        p = ORBParams()
        assert p.or_minutes == 5
        assert p.entry_cutoff_hour_et == 14
        assert p.universe_profile == "qqq_tqqq"
        assert p.allow_shorts is False


class TestRun:
    def test_missing_intraday_emits_no_signals(self):
        strat = ORBStrategy()
        result = strat.run(
            _build_input(date(2024, 4, 30)),
            ORBParams(universe_profile="spy_qqq"),
        )
        assert result.signals == []
        assert result.diagnostics.get("data_ready") is False
        assert result.diagnostics["active_profile"] == "spy_qqq"
        assert result.diagnostics["active_symbols"] == ["SPY", "QQQ"]
        assert result.state_update["orb.profile"] == "spy_qqq"

    def test_breakout_emits_paper_signal(self):
        strat = ORBStrategy()
        result = strat.run(
            _build_intraday_input(date(2024, 4, 30)),
            ORBParams(universe_profile="qqq_tqqq"),
        )
        assert len(result.signals) == 1
        sig = result.signals[0]
        assert sig.symbol == "QQQ"
        assert sig.target_weight == ORBParams().risk_per_trade
        assert sig.tag.startswith("orb-entry:QQQ:breakout")

    def test_universe_returns_all_configurable_profile_tickers(self):
        strat = ORBStrategy()
        syms = strat.universe(date(2024, 4, 30), state={})
        assert syms == sorted({sym for values in UNIVERSE_PROFILES.values() for sym in values})
