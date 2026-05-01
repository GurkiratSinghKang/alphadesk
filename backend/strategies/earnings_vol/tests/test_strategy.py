"""Smoke tests for the Earnings Volatility strategy — research shell.

Registered as ``kind="research"`` pending options-chain integration in
``StrategyInput``. Verifies registration, params, and the diagnostics
pipeline (upcoming-event detection, historical-move proxy).
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import StrategyInput
from strategies._core.protocol import get_meta, get_strategy
from strategies.earnings_vol.config import EarningsVolParams, UNIVERSE
from strategies.earnings_vol.strategy import (
    EarningsVolStrategy,
    _historical_move_median,
    _upcoming_earnings,
)


def _build_bars(
    symbols: list[str],
    asof: date,
    n_bars: int = 100,
) -> pd.DataFrame:
    idx = pd.bdate_range(end=pd.Timestamp(asof), periods=n_bars)
    rows: list[pd.DataFrame] = []
    for sym in symbols:
        closes = np.full(n_bars, 100.0)
        rows.append(pd.DataFrame({
            "symbol": sym,
            "date": [d.date() for d in idx],
            "open": closes, "high": closes, "low": closes,
            "close": closes, "volume": 1_000_000,
        }))
    return pd.concat(rows, ignore_index=True).set_index(["date", "symbol"]).sort_index()


def _build_earnings(events: dict[str, list[date]]) -> pd.DataFrame:
    rows = []
    for sym, dates in events.items():
        for d in dates:
            rows.append({"symbol": sym, "date": d})
    return pd.DataFrame(rows)


def _build_input(
    bars: pd.DataFrame,
    asof: date,
    earnings: pd.DataFrame | None = None,
    options_chains: dict[str, pd.DataFrame] | None = None,
) -> StrategyInput:
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars, earnings=earnings,
        options_chains=options_chains or {},
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=[], state={},
        seed=0, rng=np.random.default_rng(0),
    )


class TestRegistration:
    def test_strategy_registered_as_research(self):
        cls = get_strategy("earnings_vol")
        assert cls is EarningsVolStrategy
        meta = get_meta("earnings_vol")
        assert meta.name == "earnings_vol"
        assert meta.category == "options"
        assert meta.kind == "research"


class TestParams:
    def test_defaults(self):
        p = EarningsVolParams()
        assert 1.5 < p.implied_vs_historical_min_ratio < 2.0
        assert 0.5 < p.wing_width_multiple < 1.0
        assert p.dte_target == 21
        assert p.max_concurrent_positions == 1

    def test_tune_space_has_expected_keys(self):
        space = EarningsVolParams.tune_space()
        assert set(space.keys()) >= {
            "implied_vs_historical_min_ratio", "wing_width_multiple",
            "dte_target", "max_loss_pct_per_trade", "exit_timing",
            "earnings_timing_filter", "min_underlying_price",
            "max_concurrent_positions", "historical_moves_lookback_quarters",
        }


class TestRun:
    def test_no_earnings_returns_empty_diagnostics(self):
        bars = _build_bars(["AAPL", "MSFT"], date(2024, 4, 30), n_bars=60)
        strat = EarningsVolStrategy()
        result = strat.run(_build_input(bars, date(2024, 4, 30)), EarningsVolParams())
        assert result.signals == []
        assert result.diagnostics.get("upcoming_events") == 0

    def test_upcoming_earnings_detected(self):
        bars = _build_bars(["AAPL"], date(2024, 4, 30), n_bars=60)
        earnings = _build_earnings({"AAPL": [date(2024, 5, 2)]})
        strat = EarningsVolStrategy()
        result = strat.run(
            _build_input(bars, date(2024, 4, 30), earnings=earnings),
            EarningsVolParams(),
        )
        assert result.diagnostics.get("upcoming_events") == 1
        cands = result.diagnostics.get("candidates") or []
        assert any(c["symbol"] == "AAPL" for c in cands)
        assert cands[0]["latest_price"] == pytest.approx(100.0)
        assert cands[0]["options_chain"]["available"] is False

    def test_options_chain_summary_is_included(self):
        bars = _build_bars(["AAPL"], date(2024, 4, 30), n_bars=60)
        earnings = _build_earnings({"AAPL": [date(2024, 5, 2)]})
        chain = pd.DataFrame([
            {
                "symbol": "AAPL240503C00100000",
                "underlying": "AAPL",
                "expiry": date(2024, 5, 3),
                "strike": 100.0,
                "option_type": "call",
                "bid": 2.0,
                "ask": 2.2,
                "iv": 0.42,
                "is_demo": False,
            },
            {
                "symbol": "AAPL240503P00100000",
                "underlying": "AAPL",
                "expiry": date(2024, 5, 3),
                "strike": 100.0,
                "option_type": "put",
                "bid": 1.9,
                "ask": 2.1,
                "iv": 0.40,
                "is_demo": False,
            },
        ])
        strat = EarningsVolStrategy()
        result = strat.run(
            _build_input(
                bars,
                date(2024, 4, 30),
                earnings=earnings,
                options_chains={"AAPL": chain},
            ),
            EarningsVolParams(),
        )
        cand = result.diagnostics["candidates"][0]
        assert cand["options_chain"]["available"] is True
        assert cand["options_chain"]["target_expiry"] == "2024-05-03"
        assert cand["options_chain"]["atm_iv"] == pytest.approx(0.41)

    def test_non_universe_symbols_filtered_out(self):
        bars = _build_bars(["AAPL", "ZZZZ"], date(2024, 4, 30), n_bars=60)
        earnings = _build_earnings({
            "AAPL": [date(2024, 5, 2)],
            "ZZZZ": [date(2024, 5, 3)],
        })
        strat = EarningsVolStrategy()
        result = strat.run(
            _build_input(bars, date(2024, 4, 30), earnings=earnings),
            EarningsVolParams(),
        )
        cands = result.diagnostics.get("candidates") or []
        syms = {c["symbol"] for c in cands}
        assert "AAPL" in syms
        assert "ZZZZ" not in syms

    def test_after_close_filter_only_keeps_amc_events(self):
        asof = date(2024, 4, 30)
        earnings = pd.DataFrame([
            {"symbol": "AAPL", "date": date(2024, 5, 2), "report_time": "AMC"},
            {"symbol": "MSFT", "date": date(2024, 5, 2), "report_time": "BMO"},
            {"symbol": "NVDA", "date": date(2024, 5, 3), "report_time": "DMT"},
        ])

        assert _upcoming_earnings(
            earnings,
            asof,
            dte_target=21,
            timing_filter="after_close_only",
        ) == [("AAPL", date(2024, 5, 2))]

    def test_min_underlying_price_filters_research_candidates(self):
        asof = date(2024, 4, 30)
        bars = _build_bars(["AAPL", "MSFT"], asof, n_bars=60)
        bars.loc[(slice(None), "AAPL"), "close"] = 10.0
        earnings = _build_earnings({
            "AAPL": [date(2024, 5, 2)],
            "MSFT": [date(2024, 5, 2)],
        })
        strat = EarningsVolStrategy()
        result = strat.run(
            _build_input(bars, asof, earnings=earnings),
            EarningsVolParams(min_underlying_price=20),
        )

        assert result.diagnostics.get("upcoming_events") == 2
        assert result.diagnostics.get("filtered_below_min_price") == 1
        cands = result.diagnostics.get("candidates") or []
        assert [c["symbol"] for c in cands] == ["MSFT"]

    def test_upcoming_earnings_uses_earliest_event_when_provider_unsorted(self):
        asof = date(2024, 4, 30)
        earnings = pd.DataFrame([
            {"symbol": "AAPL", "date": date(2024, 5, 15)},
            {"symbol": "AAPL", "date": date(2024, 5, 2)},
        ])
        assert _upcoming_earnings(earnings, asof, dte_target=21) == [
            ("AAPL", date(2024, 5, 2)),
        ]

    def test_historical_move_median_sorts_by_event_date_before_tail(self):
        earnings = pd.DataFrame([
            {"symbol": "AAPL", "date": date(2024, 1, 30), "move_pct": 0.02},
            {"symbol": "AAPL", "date": date(2024, 7, 30), "move_pct": 0.10},
            {"symbol": "AAPL", "date": date(2024, 4, 30), "move_pct": 0.04},
        ])
        assert _historical_move_median(earnings, "AAPL", lookback_quarters=2) == pytest.approx(0.07)
