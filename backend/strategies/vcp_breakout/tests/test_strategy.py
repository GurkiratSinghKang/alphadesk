"""Unit tests for VCP Breakout — SOTA shell."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import (
    OrderType,
    Position,
    StrategyInput,
    TimeInForce,
)
from strategies.vcp_breakout.config import VCP_UNIVERSE_SEED, VCPBreakoutParams
from strategies.vcp_breakout.strategy import (
    VCPBreakoutStrategy,
    _build_exits,
    _is_rebalance_day,
    _stage2_check,
    _vcp_base_check,
)


# --------------------------------------------------------------------------- #
# Synthetic helpers                                                           #
# --------------------------------------------------------------------------- #
def _build_panel(*, end: date, n_days: int, spec: dict[str, "tuple[Iterable[float], Iterable[float]] | float"]) -> pd.DataFrame:
    """Build (date, symbol)-indexed bars with both ``close`` and ``volume``.

    `spec[sym]` is either:
      - a tuple `(closes_iter, volumes_iter)` callables i → float
      - a single number (constant close, constant volume = 5_000_000)
    """
    dates = pd.date_range(end=pd.Timestamp(end), periods=n_days, freq="D", tz="UTC")
    rows: list[dict] = []
    for sym, recipe in spec.items():
        if isinstance(recipe, (int, float)):
            closes = [float(recipe)] * n_days
            volumes = [5_000_000] * n_days
        else:
            closes_fn, volumes_fn = recipe
            closes = [float(closes_fn(i)) for i in range(n_days)]
            volumes = [float(volumes_fn(i)) for i in range(n_days)]
        for d, p, v in zip(dates, closes, volumes):
            rows.append({
                "date": d, "symbol": sym,
                "open": p, "high": p, "low": p, "close": p,
                "volume": v,
            })
    return pd.DataFrame(rows).set_index(["date", "symbol"])


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #
class TestRebalanceDay:
    def test_friday_weekly(self):
        assert _is_rebalance_day(date(2024, 5, 3), "weekly") is True

    def test_thursday_false(self):
        assert _is_rebalance_day(date(2024, 5, 2), "weekly") is False


class TestStage2:
    def test_passes_for_uptrend(self):
        # Strong steady uptrend over 300 days
        closes = pd.Series([100.0 * (1.001 ** i) for i in range(300)])
        params = VCPBreakoutParams(
            stage2_min_sma200_rising_days=50,
            stage2_min_above_52w_low=0.10,
        )
        assert _stage2_check(closes, params) is True

    def test_rejects_downtrend(self):
        closes = pd.Series([100.0 * (0.999 ** i) for i in range(300)])
        params = VCPBreakoutParams()
        assert _stage2_check(closes, params) is False

    def test_rejects_too_short_history(self):
        closes = pd.Series([100.0] * 100)  # < 252 needed
        params = VCPBreakoutParams()
        assert _stage2_check(closes, params) is False

    def test_rejects_price_below_sma200(self):
        # Up for 200, then sharp drop to below SMA on the last bar
        prices = [100.0 * (1.001 ** i) for i in range(280)]
        prices.extend([prices[-1] * 0.5] * 20)  # crash
        closes = pd.Series(prices)
        params = VCPBreakoutParams()
        assert _stage2_check(closes, params) is False


class TestVCPBase:
    def test_passes_when_recent_tighter(self):
        # Build prices: prior 40 days range 90-110 (range 20); recent 40 days range 95-100 (range 5)
        prior = list(np.linspace(90.0, 110.0, 40)) + list(np.linspace(110.0, 90.0, 0))[:40]
        prior = list(np.linspace(90.0, 110.0, 20)) + list(np.linspace(110.0, 90.0, 20))
        recent = list(np.linspace(95.0, 100.0, 20)) + list(np.linspace(100.0, 95.0, 20))
        closes = pd.Series([100.0] * 5 + prior + recent)  # 5 + 40 + 40 = 85
        params = VCPBreakoutParams(min_base_days=40, final_base_max_range_pct=0.10)
        passed, pivot = _vcp_base_check(closes, params)
        assert passed is True
        assert pivot == pytest.approx(100.0, rel=0.01)  # max of recent

    def test_rejects_when_recent_wider(self):
        # Recent range WIDER than prior — fails the contraction test
        prior = [100.0] * 40
        recent = list(np.linspace(80.0, 120.0, 40))
        closes = pd.Series([100.0] * 5 + prior + recent)
        params = VCPBreakoutParams(min_base_days=40)
        passed, _ = _vcp_base_check(closes, params)
        assert passed is False

    def test_rejects_when_too_short(self):
        closes = pd.Series([100.0] * 50)  # < 2*40+5 needed
        params = VCPBreakoutParams(min_base_days=40)
        passed, _ = _vcp_base_check(closes, params)
        assert passed is False


class TestBuildExits:
    def test_stop_loss_triggers(self):
        # Position entered at 100, last close = 90 → -10% (below 8% stop)
        bars = _build_panel(
            end=date(2024, 5, 1), n_days=10,
            spec={"AAPL": (lambda i: 90.0 if i >= 9 else 100.0, lambda i: 1_000_000)},
        )
        pos = Position(
            symbol="AAPL", quantity=100,
            avg_entry_price=Decimal("100"),
            entry_date=date(2024, 4, 20),
        )
        signals, state = _build_exits(
            [pos], bars,
            state={
                "vcp_breakout.entry_dates": {"AAPL": "2024-04-20"},
                "vcp_breakout.entry_prices": {"AAPL": 100.0},
            },
            asof=date(2024, 5, 1),
            params=VCPBreakoutParams(stop_pct_below_pivot=0.08),
        )
        assert len(signals) == 1
        assert signals[0].order_type == OrderType.MOC
        assert signals[0].target_weight == 0.0
        assert signals[0].tag == "vcp-exit-stop"

    def test_profit_take_triggers(self):
        bars = _build_panel(
            end=date(2024, 5, 1), n_days=10,
            spec={"AAPL": (lambda i: 125.0 if i >= 9 else 100.0, lambda i: 1_000_000)},
        )
        pos = Position(
            symbol="AAPL", quantity=100,
            avg_entry_price=Decimal("100"),
            entry_date=date(2024, 4, 20),
        )
        signals, _state = _build_exits(
            [pos], bars,
            state={
                "vcp_breakout.entry_dates": {"AAPL": "2024-04-20"},
                "vcp_breakout.entry_prices": {"AAPL": 100.0},
            },
            asof=date(2024, 5, 1),
            params=VCPBreakoutParams(profit_take_pct=0.20),
        )
        assert len(signals) == 1
        assert signals[0].tag == "vcp-exit-profittake"

    def test_time_stop_triggers(self):
        # Held > 60 trading sessions (~85 calendar days)
        bars = _build_panel(
            end=date(2024, 5, 1), n_days=10,
            spec={"AAPL": (lambda i: 102.0, lambda i: 1_000_000)},
        )
        pos = Position(
            symbol="AAPL", quantity=100,
            avg_entry_price=Decimal("100"),
            entry_date=date(2024, 1, 1),
        )
        signals, _state = _build_exits(
            [pos], bars,
            state={
                "vcp_breakout.entry_dates": {"AAPL": "2024-01-01"},  # 4 months ago
                "vcp_breakout.entry_prices": {"AAPL": 100.0},
            },
            asof=date(2024, 5, 1),
            params=VCPBreakoutParams(max_holding_days=60),
        )
        assert len(signals) == 1
        assert signals[0].tag == "vcp-exit-timestop"

    def test_no_exit_in_window(self):
        bars = _build_panel(
            end=date(2024, 5, 1), n_days=10,
            spec={"AAPL": (lambda i: 105.0, lambda i: 1_000_000)},  # +5% only
        )
        pos = Position(
            symbol="AAPL", quantity=100,
            avg_entry_price=Decimal("100"),
            entry_date=date(2024, 4, 20),
        )
        signals, _state = _build_exits(
            [pos], bars,
            state={
                "vcp_breakout.entry_dates": {"AAPL": "2024-04-20"},
                "vcp_breakout.entry_prices": {"AAPL": 100.0},
            },
            asof=date(2024, 5, 1),
            params=VCPBreakoutParams(),
        )
        assert signals == []


class TestStrategyMeta:
    def test_paper_only(self):
        from strategies.registry import load_all, get_meta
        load_all()
        meta = get_meta("vcp_breakout")
        assert meta is not None
        assert meta.paper_only is True
        assert meta.kind == "autonomous"


class TestRunIntegration:
    def test_run_no_op_on_thursday(self):
        bars = _build_panel(
            end=date(2024, 5, 2),  # Thursday
            n_days=10,
            spec={sym: 100.0 for sym in VCP_UNIVERSE_SEED[:5]},
        )
        strat = VCPBreakoutStrategy()
        result = strat.run(
            StrategyInput(
                asof=date(2024, 5, 2),
                mode="backtest",
                bars=bars,
                positions=[],
                cash=Decimal("100000"),
                equity=Decimal("100000"),
                state={},
                seed=0,
                rng=np.random.default_rng(0),
            ),
            VCPBreakoutParams(),
        )
        # Not Friday, no rebalance
        assert result.diagnostics["rebalance"] is False
        # No exits (no positions)
        assert result.signals == []
