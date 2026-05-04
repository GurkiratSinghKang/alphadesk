"""Unit tests for Sector Rotation — SOTA shell.

Covers the core decision logic with synthetic close panels:

1. Composite-rank picks top_n sectors when all have valid data.
2. Risk-off rule flips to bond fallback when SPY trailing return is negative.
3. Risk-off disabled → no flip.
4. Insufficient sectors → bond fallback (defensive).
5. Bars unavailable → empty targets (skip rebalance).
6. Rebalance day detection — only fires on month-end.
7. Strategy.run() emits the right Signals on a rebalance day.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
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
from strategies.sector_rotation.config import (
    SECTOR_ETFS,
    SectorRotationParams,
    composite_lookbacks,
    max_lookback,
)
from strategies.sector_rotation.strategy import (
    SectorRotationStrategy,
    _compute_targets_with_diagnostics,
    _is_rebalance_day,
)


# --------------------------------------------------------------------------- #
# Synthetic data helpers                                                      #
# --------------------------------------------------------------------------- #
def _build_panel(
    *,
    end: date,
    n_days: int,
    spec: dict[str, "Iterable[float] | float"],
) -> pd.DataFrame:
    """Build a (date, symbol)-indexed bars frame with a `close` column.

    Each ``spec[sym]`` is either:
      - a callable ``i -> price`` returning a price by day-index, OR
      - a constant float (price is constant across the window).
    """
    dates = pd.date_range(end=pd.Timestamp(end), periods=n_days, freq="D")
    rows: list[dict] = []
    for sym, recipe in spec.items():
        if callable(recipe):
            prices = [float(recipe(i)) for i in range(n_days)]
        else:
            prices = [float(recipe)] * n_days
        for d, p in zip(dates, prices):
            rows.append({
                "date": d, "symbol": sym,
                "open": p, "high": p, "low": p, "close": p, "volume": 1_000_000,
            })
    df = pd.DataFrame(rows).set_index(["date", "symbol"])
    return df


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #
class TestRebalanceDay:
    def test_last_trading_day_of_month_is_rebalance(self):
        # Apr 30 2024 = Tue, last business day of April
        assert _is_rebalance_day(date(2024, 4, 30), "monthly") is True

    def test_mid_month_is_not_rebalance(self):
        assert _is_rebalance_day(date(2024, 4, 15), "monthly") is False

    def test_weekend_is_not_rebalance(self):
        # Apr 27 2024 = Saturday — even though month-end-ish, not a session
        assert _is_rebalance_day(date(2024, 4, 27), "monthly") is False


class TestCompositeLookbacks:
    def test_default_returns_two_components(self):
        params = SectorRotationParams()
        components = composite_lookbacks(params)
        assert len(components) == 2
        # short=126 with 0.5, long=252 with 0.5
        assert components[0] == (126, 0.5)
        assert components[1] == (252, 0.5)

    def test_custom_weight(self):
        params = SectorRotationParams(short_weight=0.7)
        components = composite_lookbacks(params)
        assert components[0][1] == pytest.approx(0.7)
        assert components[1][1] == pytest.approx(0.3)


class TestComputeTargets:
    def test_top3_selected_when_all_sectors_valid(self):
        # Build 400 days of data; XLK = strongest uptrend, then XLV, XLF; rest flat.
        end = date(2024, 4, 30)
        n = 400
        spec: dict[str, "Iterable[float] | float"] = {}
        # Uptrenders (in descending strength)
        spec["XLK"] = lambda i: 100.0 * (1.05 ** (i / 252.0))   # ~5%/yr
        spec["XLV"] = lambda i: 100.0 * (1.04 ** (i / 252.0))   # ~4%/yr
        spec["XLF"] = lambda i: 100.0 * (1.03 ** (i / 252.0))   # ~3%/yr
        # Flat sectors (composite return = 0)
        for sym in ("XLY", "XLP", "XLE", "XLI", "XLB", "XLRE", "XLU", "XLC"):
            spec[sym] = 100.0
        # SPY rising → risk-off NOT triggered
        spec["SPY"] = lambda i: 100.0 * (1.10 ** (i / 252.0))
        bars = _build_panel(end=end, n_days=n, spec=spec)

        params = SectorRotationParams(top_n=3)
        targets, diag = _compute_targets_with_diagnostics(params, bars, end)

        assert diag["risk_off_triggered"] is False
        assert targets == ["XLK", "XLV", "XLF"]
        assert diag["reason"] == "rotation_active"
        # Score check: XLK > XLV > XLF
        scores = diag["sector_scores"]
        assert scores["XLK"] > scores["XLV"] > scores["XLF"]

    def test_risk_off_triggers_bond_fallback(self):
        end = date(2024, 4, 30)
        n = 400
        spec: dict[str, "Iterable[float] | float"] = {}
        # All sectors flat
        for sym in SECTOR_ETFS:
            spec[sym] = 100.0
        # SPY DOWN -10% over the lookback → risk-off
        spec["SPY"] = lambda i: 100.0 * (0.85 ** (i / n))
        bars = _build_panel(end=end, n_days=n, spec=spec)

        params = SectorRotationParams(top_n=3)
        targets, diag = _compute_targets_with_diagnostics(params, bars, end)

        assert diag["risk_off_triggered"] is True
        assert targets == [params.bond_fallback]
        assert diag["reason"] == "risk_off_triggered"
        assert diag["risk_off_return"] is not None and diag["risk_off_return"] < 0

    def test_risk_off_disabled_skips_check(self):
        end = date(2024, 4, 30)
        n = 400
        spec: dict[str, "Iterable[float] | float"] = {}
        spec["XLK"] = lambda i: 100.0 * (1.05 ** (i / 252.0))
        for sym in SECTOR_ETFS:
            if sym not in spec:
                spec[sym] = 100.0
        # SPY catastrophic, but risk_off disabled
        spec["SPY"] = lambda i: 100.0 * (0.5 ** (i / n))
        bars = _build_panel(end=end, n_days=n, spec=spec)

        params = SectorRotationParams(top_n=2, risk_off_enabled=False)
        targets, diag = _compute_targets_with_diagnostics(params, bars, end)

        assert diag["risk_off_triggered"] is False
        assert targets == ["XLK", "XLV"] or targets[0] == "XLK"
        # XLK should be #1 regardless of XLV ordering (both flat-ish)

    def test_insufficient_sectors_falls_back_to_bonds(self):
        end = date(2024, 4, 30)
        n = 400
        # Only 2 sectors have data, but top_n=5 → fall back to bonds
        spec: dict[str, "Iterable[float] | float"] = {
            "XLK": lambda i: 100.0 * (1.05 ** (i / 252.0)),
            "XLV": lambda i: 100.0 * (1.03 ** (i / 252.0)),
            "SPY": lambda i: 100.0 * (1.10 ** (i / 252.0)),
        }
        bars = _build_panel(end=end, n_days=n, spec=spec)

        params = SectorRotationParams(top_n=5)
        targets, diag = _compute_targets_with_diagnostics(params, bars, end)

        assert targets == [params.bond_fallback]
        assert diag["reason"] == "insufficient_sector_data"

    def test_bars_unavailable_returns_empty(self):
        end = date(2024, 4, 30)
        params = SectorRotationParams()
        empty_bars = pd.DataFrame()
        targets, diag = _compute_targets_with_diagnostics(params, empty_bars, end)
        assert targets == []
        assert diag["reason"] == "bars_unavailable"


class TestRunIntegration:
    def test_run_emits_signals_on_rebalance_day(self):
        end = date(2024, 4, 30)  # last trading day of April
        n = 400
        spec: dict[str, "Iterable[float] | float"] = {}
        spec["XLK"] = lambda i: 100.0 * (1.05 ** (i / 252.0))
        spec["XLV"] = lambda i: 100.0 * (1.04 ** (i / 252.0))
        spec["XLF"] = lambda i: 100.0 * (1.03 ** (i / 252.0))
        for sym in ("XLY", "XLP", "XLE", "XLI", "XLB", "XLRE", "XLU", "XLC"):
            spec[sym] = 100.0
        spec["SPY"] = lambda i: 100.0 * (1.10 ** (i / 252.0))
        bars = _build_panel(end=end, n_days=n, spec=spec)

        strat = SectorRotationStrategy()
        params = SectorRotationParams(top_n=3)
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
            params,
        )

        # Should emit 3 entry signals (one per top sector)
        entry_tags = [s.tag for s in result.signals if s.tag and s.tag.startswith("sr-entry-")]
        assert len(entry_tags) == 3
        # Each is target_weight=1/3, MOO, DAY
        for s in result.signals:
            if s.tag and s.tag.startswith("sr-entry-"):
                assert s.target_weight == pytest.approx(1 / 3)
                assert s.order_type == OrderType.MOO
                assert s.time_in_force == TimeInForce.DAY
        # Targets in diagnostics
        assert result.diagnostics["targets"] == ["XLK", "XLV", "XLF"]
        assert result.diagnostics["rebalance"] is True

    def test_run_no_op_on_non_rebalance_day(self):
        end = date(2024, 4, 15)  # mid-month
        n = 400
        spec: dict[str, "Iterable[float] | float"] = {sym: 100.0 for sym in SECTOR_ETFS}
        spec["SPY"] = 100.0
        bars = _build_panel(end=end, n_days=n, spec=spec)

        strat = SectorRotationStrategy()
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
            SectorRotationParams(),
        )
        assert result.signals == []
        assert result.diagnostics["rebalance"] is False
