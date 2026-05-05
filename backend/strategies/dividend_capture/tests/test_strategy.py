"""Unit tests for Dividend Capture — SOTA shell."""

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
from strategies.dividend_capture.config import DividendCaptureParams
from strategies.dividend_capture.strategy import (
    DividendCaptureStrategy,
    _build_scheduled_exits,
    _has_imminent_earnings,
    _last_close,
    _normalize_dividends_frame,
    _screen_candidates,
)


# --------------------------------------------------------------------------- #
# Synthetic helpers                                                           #
# --------------------------------------------------------------------------- #
def _build_panel(*, end: date, n_days: int, spec: dict[str, "Iterable[float] | float"]) -> pd.DataFrame:
    dates = pd.date_range(end=pd.Timestamp(end), periods=n_days, freq="D")
    rows: list[dict] = []
    for sym, recipe in spec.items():
        prices = [float(recipe(i)) for i in range(n_days)] if callable(recipe) else [float(recipe)] * n_days
        for d, p in zip(dates, prices):
            rows.append({
                "date": d, "symbol": sym,
                "open": p, "high": p, "low": p, "close": p,
                "volume": 5_000_000,
            })
    return pd.DataFrame(rows).set_index(["date", "symbol"])


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #
class TestNormalize:
    def test_renames_date_to_ex_date(self):
        df = pd.DataFrame([{"symbol": "JPM", "date": date(2024, 5, 6), "cash_amount": 1.05}])
        out = _normalize_dividends_frame(df)
        assert out is not None
        assert "ex_date" in out.columns
        assert out.iloc[0]["ex_date"] == date(2024, 5, 6)

    def test_returns_none_on_missing_columns(self):
        df = pd.DataFrame([{"foo": "JPM", "bar": 1.0}])
        assert _normalize_dividends_frame(df) is None

    def test_returns_none_on_empty(self):
        assert _normalize_dividends_frame(None) is None
        assert _normalize_dividends_frame(pd.DataFrame()) is None


class TestEarningsSkip:
    def test_no_earnings_returns_false(self):
        assert _has_imminent_earnings(None, "AAPL", date(2024, 5, 1), 10) is False

    def test_imminent_earnings_returns_true(self):
        df = pd.DataFrame([{"symbol": "AAPL", "date": date(2024, 5, 5)}])
        assert _has_imminent_earnings(df, "AAPL", date(2024, 5, 1), 10) is True

    def test_far_earnings_returns_false(self):
        df = pd.DataFrame([{"symbol": "AAPL", "date": date(2024, 6, 30)}])
        assert _has_imminent_earnings(df, "AAPL", date(2024, 5, 1), 10) is False


class TestScreenCandidates:
    def test_yield_above_threshold_admits(self):
        # Ex-date in 4 calendar days (~3 trading days) from asof.
        asof = date(2024, 5, 1)
        ex = asof + timedelta(days=4)
        dividends = pd.DataFrame([{"symbol": "JPM", "ex_date": ex, "cash_amount": 1.05}])
        bars = _build_panel(end=asof, n_days=30, spec={"JPM": 100.0})

        diag: dict = {"n_dividend_events": 0, "n_passed_yield": 0, "n_passed_earnings": 0}
        cands = _screen_candidates(
            dividends, bars, earnings=None, positions=[],
            params=DividendCaptureParams(min_yield_pct=0.005),
            asof=asof, diagnostics=diag,
        )
        assert len(cands) == 1
        assert cands[0]["symbol"] == "JPM"
        assert cands[0]["event_yield"] == pytest.approx(0.0105, rel=1e-3)

    def test_yield_below_threshold_rejects(self):
        asof = date(2024, 5, 1)
        ex = asof + timedelta(days=4)
        dividends = pd.DataFrame([{"symbol": "T", "ex_date": ex, "cash_amount": 0.10}])
        bars = _build_panel(end=asof, n_days=30, spec={"T": 100.0})

        diag: dict = {"n_dividend_events": 0, "n_passed_yield": 0, "n_passed_earnings": 0}
        cands = _screen_candidates(
            dividends, bars, earnings=None, positions=[],
            params=DividendCaptureParams(min_yield_pct=0.005),  # 50 bps min
            asof=asof, diagnostics=diag,
        )
        # 0.10 / 100 = 0.1% — below 0.5% threshold
        assert cands == []

    def test_earnings_overlap_filters(self):
        asof = date(2024, 5, 1)
        ex = asof + timedelta(days=4)
        dividends = pd.DataFrame([{"symbol": "JPM", "ex_date": ex, "cash_amount": 1.05}])
        bars = _build_panel(end=asof, n_days=30, spec={"JPM": 100.0})
        earnings = pd.DataFrame([{"symbol": "JPM", "date": asof + timedelta(days=5)}])

        diag: dict = {"n_dividend_events": 0, "n_passed_yield": 0, "n_passed_earnings": 0}
        cands = _screen_candidates(
            dividends, bars, earnings=earnings, positions=[],
            params=DividendCaptureParams(earnings_skip_days=10),
            asof=asof, diagnostics=diag,
        )
        assert cands == []

    def test_etf_filtered_when_skip_etfs(self):
        asof = date(2024, 5, 1)
        ex = asof + timedelta(days=4)
        dividends = pd.DataFrame([
            {"symbol": "SCHD", "ex_date": ex, "cash_amount": 0.65},  # ETF
            {"symbol": "JPM", "ex_date": ex, "cash_amount": 1.05},
        ])
        bars = _build_panel(end=asof, n_days=30, spec={"SCHD": 75.0, "JPM": 100.0})

        diag: dict = {"n_dividend_events": 0, "n_passed_yield": 0, "n_passed_earnings": 0}
        cands = _screen_candidates(
            dividends, bars, earnings=None, positions=[],
            params=DividendCaptureParams(skip_etfs=True),
            asof=asof, diagnostics=diag,
        )
        assert {c["symbol"] for c in cands} == {"JPM"}

    def test_held_position_excluded_from_re_entry(self):
        asof = date(2024, 5, 1)
        ex = asof + timedelta(days=4)
        dividends = pd.DataFrame([{"symbol": "JPM", "ex_date": ex, "cash_amount": 1.05}])
        bars = _build_panel(end=asof, n_days=30, spec={"JPM": 100.0})
        held = Position(
            symbol="JPM", quantity=100,
            avg_entry_price=Decimal("100"),
            entry_date=asof - timedelta(days=2),
        )
        diag: dict = {"n_dividend_events": 0, "n_passed_yield": 0, "n_passed_earnings": 0}
        cands = _screen_candidates(
            dividends, bars, earnings=None, positions=[held],
            params=DividendCaptureParams(),
            asof=asof, diagnostics=diag,
        )
        assert cands == []


class TestScheduledExits:
    def test_exit_emits_when_scheduled_date_reached(self):
        asof = date(2024, 5, 7)
        scheduled = (asof - timedelta(days=1)).isoformat()  # past schedule
        pos = Position(
            symbol="JPM", quantity=100,
            avg_entry_price=Decimal("100"),
            entry_date=date(2024, 5, 1),
        )
        signals, state = _build_scheduled_exits(
            [pos], state={"dividend_capture.exit_dates": {"JPM": scheduled}},
            asof=asof, params=DividendCaptureParams(),
        )
        assert len(signals) == 1
        assert signals[0].order_type == OrderType.MOC
        assert signals[0].target_weight == 0.0
        # State should have JPM removed
        assert "JPM" not in state["dividend_capture.exit_dates"]

    def test_no_exit_when_scheduled_date_in_future(self):
        asof = date(2024, 5, 7)
        scheduled = (asof + timedelta(days=2)).isoformat()
        pos = Position(
            symbol="JPM", quantity=100,
            avg_entry_price=Decimal("100"),
            entry_date=asof - timedelta(days=2),
        )
        signals, state = _build_scheduled_exits(
            [pos], state={"dividend_capture.exit_dates": {"JPM": scheduled}},
            asof=asof, params=DividendCaptureParams(),
        )
        assert signals == []
        assert "JPM" in state["dividend_capture.exit_dates"]


class TestRunIntegration:
    def test_run_emits_entry_signals(self):
        asof = date(2024, 5, 1)
        ex = asof + timedelta(days=4)
        dividends = pd.DataFrame([{"symbol": "JPM", "ex_date": ex, "cash_amount": 1.05}])
        bars = _build_panel(end=asof, n_days=30, spec={"JPM": 100.0})

        strat = DividendCaptureStrategy()
        result = strat.run(
            StrategyInput(
                asof=asof,
                mode="backtest",
                bars=bars,
                dividends=dividends,
                positions=[],
                cash=Decimal("100000"),
                equity=Decimal("100000"),
                state={},
                seed=0,
                rng=np.random.default_rng(0),
            ),
            DividendCaptureParams(),
        )
        entries = [s for s in result.signals if s.tag and s.tag.startswith("dc-entry-")]
        assert len(entries) == 1
        assert entries[0].symbol == "JPM"
        assert entries[0].order_type == OrderType.MOC
        # State should record a scheduled exit date
        assert "dividend_capture.exit_dates" in result.state_update
        assert "JPM" in result.state_update["dividend_capture.exit_dates"]

    def test_run_no_op_when_no_dividends(self):
        asof = date(2024, 5, 1)
        bars = _build_panel(end=asof, n_days=30, spec={"JPM": 100.0})

        strat = DividendCaptureStrategy()
        result = strat.run(
            StrategyInput(
                asof=asof,
                mode="backtest",
                bars=bars,
                dividends=None,
                positions=[],
                cash=Decimal("100000"),
                equity=Decimal("100000"),
                state={},
                seed=0,
                rng=np.random.default_rng(0),
            ),
            DividendCaptureParams(),
        )
        assert result.signals == []
        assert result.diagnostics["n_dividend_events"] == 0
