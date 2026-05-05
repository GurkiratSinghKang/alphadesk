"""Smoke tests for the VRP Harvest strategy — research shell.

Currently registered as ``kind="research"`` pending paper validation of
multi-leg options execution. Verifies:
  - Registration + meta.
  - Params defaults + safety invariants (tail_hedge_ratio >= 5).
  - run() returns diagnostics-only (no signals).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import StrategyInput
from strategies._core.protocol import get_meta, get_strategy
from strategies.vrp_harvest.config import VRPHarvestParams
from strategies.vrp_harvest.strategy import VRPHarvestStrategy


def _build_bars(
    close_series: np.ndarray,
    asof: date,
    symbol: str = "SPY",
) -> pd.DataFrame:
    idx = pd.bdate_range(end=pd.Timestamp(asof), periods=len(close_series))
    frame = pd.DataFrame({
        "symbol": symbol,
        "date": [d.date() for d in idx],
        "open": close_series,
        "high": close_series,
        "low": close_series,
        "close": close_series,
        "volume": 1_000_000,
    })
    return frame.set_index(["date", "symbol"]).sort_index()


def _build_input(
    bars: pd.DataFrame,
    asof: date,
    options_chains: dict[str, pd.DataFrame] | None = None,
) -> StrategyInput:
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars,
        options_chains=options_chains or {},
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=[], state={},
        seed=0, rng=np.random.default_rng(0),
    )


class TestRegistration:
    def test_strategy_registered_as_autonomous_paper_only(self):
        # Plan B.1 full port: kind was flipped from "research" to
        # "autonomous"; paper_only=True remains as the live-capital gate
        # until paper-runway evidence graduates the strategy.
        cls = get_strategy("vrp_harvest")
        assert cls is VRPHarvestStrategy
        meta = get_meta("vrp_harvest")
        assert meta.name == "vrp_harvest"
        assert meta.category == "options"
        assert meta.kind == "autonomous"
        assert meta.paper_only is True


class TestParams:
    def test_defaults(self):
        p = VRPHarvestParams()
        assert p.underlying == "SPY"
        assert p.vrp_entry_threshold == 0.02
        assert p.tail_hedge_ratio == 5
        assert p.tail_hedge_delta == 0.05

    def test_tail_hedge_ratio_safety_floor_rejects_zero(self):
        """tail_hedge_ratio < 5 must be rejected (XIV blow-up invariant)."""
        with pytest.raises(Exception, match="tail_hedge_ratio"):
            VRPHarvestParams(tail_hedge_ratio=0)

    def test_tail_hedge_ratio_accepts_five(self):
        p = VRPHarvestParams(tail_hedge_ratio=5)
        assert p.tail_hedge_ratio == 5

    def test_tune_space_has_expected_keys(self):
        space = VRPHarvestParams.tune_space()
        assert "vrp_entry_threshold" in space
        assert "tail_hedge_ratio" in space
        assert set(space["tail_hedge_ratio"]["choices"]) == {5, 10}


class TestRun:
    def test_research_shell_emits_no_signals(self):
        rng = np.random.default_rng(11)
        closes = 400.0 * np.cumprod(1 + rng.normal(0.0, 0.012, 120))
        bars = _build_bars(closes, date(2024, 4, 30))
        strat = VRPHarvestStrategy()
        result = strat.run(_build_input(bars, date(2024, 4, 30)), VRPHarvestParams())
        assert result.signals == []
        assert "vrp" in result.diagnostics
        assert result.diagnostics["options_chain_available"] is False
        assert result.diagnostics["term_structure_gate"] is None
        assert result.diagnostics["entry_gate_open"] is False
        assert result.diagnostics["entry_gate_blocked_reason"] == "options_chain_unavailable"
        assert any("Research shell" in w for w in result.warnings)

    def test_options_chain_diagnostics_are_used_when_available(self):
        rng = np.random.default_rng(11)
        closes = 400.0 * np.cumprod(1 + rng.normal(0.0, 0.012, 120))
        bars = _build_bars(closes, date(2024, 4, 30))
        chain = pd.DataFrame([
            {
                "symbol": "SPY240531P00360000",
                "underlying": "SPY",
                "expiry": date(2024, 5, 31),
                "strike": 360.0,
                "option_type": "put",
                "iv": 0.18,
                "delta": -0.05,
                "spot_price": 400.0,
                "is_demo": False,
            },
            {
                "symbol": "SPY240531C00400000",
                "underlying": "SPY",
                "expiry": date(2024, 5, 31),
                "strike": 400.0,
                "option_type": "call",
                "iv": 0.20,
                "delta": 0.50,
                "spot_price": 400.0,
                "is_demo": False,
            },
            {
                "symbol": "SPY240628C00400000",
                "underlying": "SPY",
                "expiry": date(2024, 6, 28),
                "strike": 400.0,
                "option_type": "call",
                "iv": 0.22,
                "delta": 0.50,
                "spot_price": 400.0,
                "is_demo": False,
            },
        ])
        strat = VRPHarvestStrategy()
        result = strat.run(
            _build_input(bars, date(2024, 4, 30), {"SPY": chain}),
            VRPHarvestParams(),
        )
        assert result.signals == []
        assert result.diagnostics["options_chain_available"] is True
        assert result.diagnostics["options_chain"]["tail_hedge_available"] is True
        assert result.diagnostics["entry_gate_open"] is False

    def test_warmup_bars_returns_empty(self):
        rng = np.random.default_rng(13)
        closes = 400.0 * np.cumprod(1 + rng.normal(0.0, 0.012, 10))
        bars = _build_bars(closes, date(2024, 4, 30))
        strat = VRPHarvestStrategy()
        result = strat.run(_build_input(bars, date(2024, 4, 30)), VRPHarvestParams())
        assert result.signals == []
        assert result.diagnostics.get("warmup") is True

    def test_kill_switch_flag_when_high_vol(self):
        rng = np.random.default_rng(17)
        # Extreme vol path (~50% annualized) should trip the kill switch.
        closes = 400.0 * np.cumprod(1 + rng.normal(0.0, 0.035, 120))
        bars = _build_bars(closes, date(2024, 4, 30))
        strat = VRPHarvestStrategy()
        result = strat.run(_build_input(bars, date(2024, 4, 30)), VRPHarvestParams())
        assert result.diagnostics.get("kill_switch_tripped") is True
        assert result.diagnostics.get("entry_gate_open") is False

    def test_proxy_gate_is_separate_from_executable_entry_gate(self):
        closes = np.linspace(400.0, 430.0, 120)
        bars = _build_bars(closes, date(2024, 4, 30))
        strat = VRPHarvestStrategy()
        result = strat.run(
            _build_input(bars, date(2024, 4, 30)),
            VRPHarvestParams(vrp_entry_threshold=0.0, min_iv_30=0.0),
        )

        assert result.diagnostics.get("proxy_entry_gate_open") is True
        assert result.diagnostics.get("entry_gate_open") is False
        assert result.diagnostics.get("entry_gate_blocked_reason") == "options_chain_unavailable"
