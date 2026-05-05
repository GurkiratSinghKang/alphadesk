"""Unit tests for Mean Reversion (slow / quality-conditioned) — SOTA shell."""

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
from strategies.mean_reversion.config import (
    MeanReversionParams,
    UNIVERSE_SEED,
)
from strategies.mean_reversion.strategy import (
    MeanReversionStrategy,
    _build_exit_signals,
    _has_imminent_earnings,
    _is_rebalance_day,
    _screen_candidates,
    _zscore_below_ma,
)


# --------------------------------------------------------------------------- #
# Synthetic data helpers                                                      #
# --------------------------------------------------------------------------- #
def _build_panel(*, end: date, n_days: int, spec: dict[str, "Iterable[float] | float"]) -> pd.DataFrame:
    dates = pd.date_range(end=pd.Timestamp(end), periods=n_days, freq="D")
    rows: list[dict] = []
    for sym, recipe in spec.items():
        prices = [float(recipe(i)) for i in range(n_days)] if callable(recipe) else [float(recipe)] * n_days
        for d, p in zip(dates, prices):
            rows.append({
                "date": d, "symbol": sym,
                "open": p, "high": p * 1.01, "low": p * 0.99,
                "close": p, "volume": 5_000_000,
            })
    return pd.DataFrame(rows).set_index(["date", "symbol"])


def _close_panel(*, end: date, n_days: int, spec: dict[str, "Iterable[float] | float"]) -> pd.DataFrame:
    """Build the wide (date × symbol) close panel that strategy helpers use."""
    panel = _build_panel(end=end, n_days=n_days, spec=spec)
    return panel.reset_index().pivot_table(
        index="date", columns="symbol", values="close", aggfunc="last"
    ).sort_index().ffill()


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #
class TestRebalanceDay:
    def test_friday_is_rebalance(self):
        assert _is_rebalance_day(date(2024, 5, 3), "weekly") is True   # Fri

    def test_thursday_is_not_rebalance(self):
        assert _is_rebalance_day(date(2024, 5, 2), "weekly") is False  # Thu

    def test_saturday_is_not_rebalance(self):
        assert _is_rebalance_day(date(2024, 5, 4), "weekly") is False  # Sat


class TestZScore:
    def test_returns_negative_for_oversold(self):
        # Constant price, then a sharp drop on the last bar.
        spec = {"X": lambda i: 100.0 if i < 60 else 80.0}  # last bar = -20% drop
        panel = _close_panel(end=date(2024, 5, 3), n_days=70, spec=spec)
        z = _zscore_below_ma(panel, "X", lookback=60)
        assert z is not None
        assert z < -2.0  # very oversold

    def test_returns_zero_for_flat(self):
        panel = _close_panel(end=date(2024, 5, 3), n_days=70, spec={"X": 100.0})
        z = _zscore_below_ma(panel, "X", lookback=60)
        # Flat series has σ=0; helper returns None to avoid div-by-zero
        assert z is None

    def test_missing_symbol_returns_none(self):
        panel = _close_panel(end=date(2024, 5, 3), n_days=70, spec={"X": 100.0})
        assert _zscore_below_ma(panel, "MISSING", lookback=60) is None


class TestEarningsSkip:
    def test_no_earnings_returns_false(self):
        assert _has_imminent_earnings(None, "AAPL", date(2024, 5, 3), 7) is False

    def test_imminent_earnings_returns_true(self):
        df = pd.DataFrame([{"symbol": "AAPL", "date": date(2024, 5, 6)}])
        assert _has_imminent_earnings(df, "AAPL", date(2024, 5, 3), 7) is True

    def test_far_earnings_returns_false(self):
        df = pd.DataFrame([{"symbol": "AAPL", "date": date(2024, 6, 30)}])
        assert _has_imminent_earnings(df, "AAPL", date(2024, 5, 3), 7) is False


class TestScreenCandidates:
    def test_oversold_name_is_candidate(self):
        # AAPL is 2.5σ below MA; everything else is flat.
        spec = {sym: 100.0 for sym in UNIVERSE_SEED[:5]}
        spec["AAPL"] = lambda i: 100.0 if i < 60 else 100.0 - 2.5 * (i - 59)
        panel = _close_panel(end=date(2024, 5, 3), n_days=70, spec=spec)

        params = MeanReversionParams(z_entry=2.0)
        diag: dict = {"n_screened": 0, "n_passed_quality": 0, "n_passed_earnings": 0}
        cands = _screen_candidates(
            list(UNIVERSE_SEED[:5]),
            panel,
            fundamentals=None, earnings=None,
            params=params, asof=date(2024, 5, 3),
            diagnostics=diag,
        )
        assert len(cands) >= 1
        symbols = {c["symbol"] for c in cands}
        assert "AAPL" in symbols
        # Most-oversold first
        assert cands[0]["z"] < -2.0

    def test_quality_gate_filters_low_fscore(self):
        spec = {"AAPL": lambda i: 100.0 - i * 0.5}  # steady downtrend → strong z
        panel = _close_panel(end=date(2024, 5, 3), n_days=70, spec=spec)
        # Low f_score < 5 (default min)
        funds = pd.DataFrame([{"symbol": "AAPL", "date": date(2024, 4, 1), "f_score": 3}])
        diag: dict = {"n_screened": 0, "n_passed_quality": 0, "n_passed_earnings": 0}
        cands = _screen_candidates(
            ["AAPL"], panel, fundamentals=funds, earnings=None,
            params=MeanReversionParams(z_entry=1.0),
            asof=date(2024, 5, 3),
            diagnostics=diag,
        )
        assert cands == []

    def test_earnings_imminent_filters_candidate(self):
        spec = {"AAPL": lambda i: 100.0 - i * 0.5}
        panel = _close_panel(end=date(2024, 5, 3), n_days=70, spec=spec)
        earnings = pd.DataFrame([{"symbol": "AAPL", "date": date(2024, 5, 6)}])
        diag: dict = {"n_screened": 0, "n_passed_quality": 0, "n_passed_earnings": 0}
        cands = _screen_candidates(
            ["AAPL"], panel, fundamentals=None, earnings=earnings,
            params=MeanReversionParams(z_entry=1.0, earnings_skip_days=7),
            asof=date(2024, 5, 3),
            diagnostics=diag,
        )
        assert cands == []


class TestExitSignals:
    def test_ma_cross_triggers_exit(self):
        # Price recovered above MA on the last bar → MA-cross exit
        spec = {"AAPL": lambda i: 100.0 if i < 60 else 100.0 + (i - 59) * 0.3}
        panel = _close_panel(end=date(2024, 5, 3), n_days=70, spec=spec)
        pos = Position(
            symbol="AAPL", quantity=100,
            avg_entry_price=Decimal("90"),
            entry_date=date(2024, 4, 28),
        )
        signals, info = _build_exit_signals(
            [pos], panel, state={}, params=MeanReversionParams(),
            asof=date(2024, 5, 3),
        )
        assert info["n_exits"] == 1
        assert info["reasons"]["AAPL"] == "ma_cross"
        assert signals[0].order_type == OrderType.MOC
        assert signals[0].target_weight == 0.0

    def test_time_stop_triggers_exit_after_holding_window(self):
        # Price below MA still, but we've been holding 60 calendar days (~43 trading)
        spec = {"AAPL": lambda i: 100.0 - i * 0.1}
        panel = _close_panel(end=date(2024, 5, 3), n_days=70, spec=spec)
        pos = Position(
            symbol="AAPL", quantity=100,
            avg_entry_price=Decimal("100"),
            entry_date=date(2024, 4, 28),
        )
        # holding_days=30 trading sessions → ~42 calendar days
        params = MeanReversionParams(holding_days=30)
        old_entry = (date(2024, 5, 3) - timedelta(days=60)).isoformat()
        signals, info = _build_exit_signals(
            [pos], panel, state={"mean_reversion.entry_dates": {"AAPL": old_entry}},
            params=params, asof=date(2024, 5, 3),
        )
        assert info["n_exits"] == 1
        assert info["reasons"]["AAPL"] == "time_stop"

    def test_no_exit_when_below_ma_and_within_holding_window(self):
        spec = {"AAPL": lambda i: 100.0 - i * 0.5}  # below MA throughout
        panel = _close_panel(end=date(2024, 5, 3), n_days=70, spec=spec)
        pos = Position(
            symbol="AAPL", quantity=100,
            avg_entry_price=Decimal("100"),
            entry_date=date(2024, 5, 1),
        )
        recent_entry = (date(2024, 5, 3) - timedelta(days=2)).isoformat()
        signals, info = _build_exit_signals(
            [pos], panel, state={"mean_reversion.entry_dates": {"AAPL": recent_entry}},
            params=MeanReversionParams(),
            asof=date(2024, 5, 3),
        )
        assert info["n_exits"] == 0
        assert signals == []


class TestRunIntegration:
    def test_run_emits_entry_signals_on_friday(self):
        end = date(2024, 5, 3)  # Friday
        n = 70
        spec = {sym: 100.0 for sym in UNIVERSE_SEED[:8]}
        # AAPL crashes 2σ below MA
        spec["AAPL"] = lambda i: 100.0 if i < 60 else 100.0 - 2.5 * (i - 59)
        bars = _build_panel(end=end, n_days=n, spec=spec)

        strat = MeanReversionStrategy()
        result = strat.run(
            StrategyInput(
                asof=end,
                mode="backtest",
                bars=bars,
                positions=[],
                cash=Decimal("100000"),
                equity=Decimal("100000"),
                state={},
                seed=0,
                rng=np.random.default_rng(0),
            ),
            MeanReversionParams(z_entry=2.0, max_positions=3),
        )
        assert result.diagnostics["rebalance"] is True
        # Should enter AAPL (only oversold name)
        entry_signals = [s for s in result.signals if s.tag and s.tag.startswith("mr-entry-")]
        assert len(entry_signals) >= 1
        assert any(s.symbol == "AAPL" for s in entry_signals)
        for s in entry_signals:
            assert s.order_type == OrderType.MOC
            assert s.target_weight == pytest.approx(0.05)

    def test_run_no_op_on_non_friday_with_no_positions(self):
        end = date(2024, 5, 2)  # Thursday
        n = 70
        spec = {sym: 100.0 for sym in UNIVERSE_SEED[:5]}
        spec["AAPL"] = lambda i: 100.0 if i < 60 else 80.0
        bars = _build_panel(end=end, n_days=n, spec=spec)

        strat = MeanReversionStrategy()
        result = strat.run(
            StrategyInput(
                asof=end,
                mode="backtest",
                bars=bars,
                positions=[],
                cash=Decimal("100000"),
                equity=Decimal("100000"),
                state={},
                seed=0,
                rng=np.random.default_rng(0),
            ),
            MeanReversionParams(),
        )
        # No entries, no exits (no positions)
        assert result.signals == []
        assert result.diagnostics["rebalance"] is False
