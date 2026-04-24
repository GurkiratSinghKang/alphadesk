"""Unit tests for the Dual Momentum (GEM) strategy — SOTA shell.

Covers the audit's four non-negotiables plus helpers and registration:

1. Absolute momentum ON + US > ex-US → VOO.
2. Absolute momentum ON + ex-US > US → VEU.
3. Absolute momentum OFF → AGG bond fallback.
4. Monthly rebalance trigger — last-of-month only.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import Position, StrategyInput
from strategies.dual_momentum.config import (
    DualMomentumParams,
    lookback_components,
    max_lookback,
)
from strategies.dual_momentum.strategy import (
    DualMomentumStrategy,
    _composite_return,
    _is_rebalance_day,
)


# --------------------------------------------------------------------------- #
# Synthetic bar builder                                                       #
# --------------------------------------------------------------------------- #
def _build_bars(
    returns: dict[str, float],
    asof: date,
    n_days: int = 400,
) -> pd.DataFrame:
    """Multi-index (date, symbol) close panel with anchored 252d returns."""
    end = pd.Timestamp(asof).tz_localize(None).normalize()
    idx = pd.bdate_range(end=end, periods=n_days)
    n = len(idx)
    rows: list[pd.DataFrame] = []
    for sym, r in returns.items():
        closes = np.linspace(1.0, 1.0 + r, num=max(n, 253))[-n:] * 100.0
        opens = np.concatenate(([closes[0]], closes[:-1]))
        highs = np.maximum(opens, closes)
        lows = np.minimum(opens, closes)
        rows.append(pd.DataFrame({
            "symbol": sym,
            "date": [d.date() for d in idx],
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": 1_000_000,
        }))
    return pd.concat(rows, ignore_index=True).set_index(["date", "symbol"]).sort_index()


def _build_input(
    bars: pd.DataFrame,
    asof: date,
    cash: Decimal = Decimal("100000"),
    positions: list[Position] | None = None,
) -> StrategyInput:
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars,
        cash=cash, equity=cash,
        positions=positions or [],
        state={}, seed=0, rng=np.random.default_rng(0),
    )


# --------------------------------------------------------------------------- #
# Canonical GEM scenarios                                                     #
# --------------------------------------------------------------------------- #
class TestGEMDecision:
    @staticmethod
    def _rebalance_day() -> date:
        return date(2024, 1, 31)

    def test_A_equity_on_and_us_beats_exus_selects_voo(self):
        bars = _build_bars({
            "VOO": 0.20, "VEU": 0.10, "AGG": 0.02, "BIL": 0.05,
        }, self._rebalance_day())
        strat = DualMomentumStrategy()
        result = strat.run(
            _build_input(bars, self._rebalance_day()), DualMomentumParams(),
        )
        entries = [s for s in result.signals if s.tag.startswith("dm-entry")]
        assert len(entries) == 1
        assert entries[0].symbol == "VOO"
        assert entries[0].target_weight == 1.0

    def test_B_equity_on_and_exus_beats_us_selects_veu(self):
        bars = _build_bars({
            "VOO": 0.08, "VEU": 0.20, "AGG": 0.01, "BIL": 0.05,
        }, self._rebalance_day())
        strat = DualMomentumStrategy()
        result = strat.run(
            _build_input(bars, self._rebalance_day()), DualMomentumParams(),
        )
        entries = [s for s in result.signals if s.tag.startswith("dm-entry")]
        assert len(entries) == 1
        assert entries[0].symbol == "VEU"

    def test_C_equity_off_selects_bond_fallback(self):
        bars = _build_bars({
            "VOO": 0.02, "VEU": 0.04, "AGG": 0.03, "BIL": 0.05,
        }, self._rebalance_day())
        strat = DualMomentumStrategy()
        result = strat.run(
            _build_input(bars, self._rebalance_day()), DualMomentumParams(),
        )
        entries = [s for s in result.signals if s.tag.startswith("dm-entry")]
        assert len(entries) == 1
        assert entries[0].symbol == "AGG"

    def test_C_bond_fallback_honours_config_override(self):
        bars = _build_bars({
            "VOO": 0.02, "VEU": 0.04, "AGG": 0.01, "IEF": 0.01, "BIL": 0.05,
        }, self._rebalance_day())
        strat = DualMomentumStrategy()
        result = strat.run(
            _build_input(bars, self._rebalance_day()),
            DualMomentumParams(bond_fallback="IEF"),
        )
        entries = [s for s in result.signals if s.tag.startswith("dm-entry")]
        assert entries[0].symbol == "IEF"


# --------------------------------------------------------------------------- #
# Rebalance-day trigger                                                       #
# --------------------------------------------------------------------------- #
class TestRebalanceTrigger:
    def test_month_end_fires(self):
        assert _is_rebalance_day(date(2024, 1, 31), "monthly") is True

    def test_mid_month_does_not_fire(self):
        assert _is_rebalance_day(date(2024, 1, 15), "monthly") is False

    def test_mid_month_run_is_noop(self):
        bars = _build_bars({
            "VOO": 0.2, "VEU": 0.1, "AGG": 0.02, "BIL": 0.05,
        }, date(2024, 1, 15))
        strat = DualMomentumStrategy()
        result = strat.run(_build_input(bars, date(2024, 1, 15)), DualMomentumParams())
        assert result.signals == []

    def test_run_closes_stale_position_on_rebalance_day(self):
        bars = _build_bars({
            "VOO": 0.20, "VEU": 0.10, "AGG": 0.02, "BIL": 0.05,
        }, date(2024, 1, 31))
        strat = DualMomentumStrategy()
        pos = Position(
            symbol="AGG", quantity=1000,
            avg_entry_price=Decimal("100"), entry_date=date(2023, 12, 29),
        )
        result = strat.run(
            _build_input(bars, date(2024, 1, 31), positions=[pos]),
            DualMomentumParams(),
        )
        exits = [s for s in result.signals if s.tag == "dm-exit"]
        entries = [s for s in result.signals if s.tag.startswith("dm-entry")]
        assert len(exits) == 1
        assert exits[0].symbol == "AGG"
        assert exits[0].target_weight == 0.0
        assert len(entries) == 1
        assert entries[0].symbol == "VOO"

    def test_bimonthly_skips_even_months(self):
        bars_feb = _build_bars({
            "VOO": 0.20, "VEU": 0.10, "AGG": 0.02, "BIL": 0.05,
        }, date(2024, 2, 29))
        bars_jan = _build_bars({
            "VOO": 0.20, "VEU": 0.10, "AGG": 0.02, "BIL": 0.05,
        }, date(2024, 1, 31))
        strat = DualMomentumStrategy()
        params = DualMomentumParams(rebalance_freq="bimonthly")

        result_feb = strat.run(_build_input(bars_feb, date(2024, 2, 29)), params)
        assert result_feb.signals == []

        result_jan = strat.run(_build_input(bars_jan, date(2024, 1, 31)), params)
        entries = [s for s in result_jan.signals if s.tag.startswith("dm-entry")]
        assert len(entries) == 1
        assert entries[0].symbol == "VOO"


# --------------------------------------------------------------------------- #
# Config                                                                      #
# --------------------------------------------------------------------------- #
class TestConfig:
    def test_tune_space_has_expected_knobs(self):
        space = DualMomentumParams.tune_space()
        assert set(space.keys()) == {
            "lookback_days", "bond_fallback", "excess_return_floor",
            "rebalance_freq", "composite_lookback", "relative_universe",
        }

    def test_unknown_key_rejected(self):
        with pytest.raises(Exception):
            DualMomentumParams(bogus=1)

    def test_composite_lookback_blend(self):
        p = DualMomentumParams(composite_lookback="blend_126_252")
        assert lookback_components(p) == ((126, 0.5), (252, 0.5))
        assert max_lookback(p) == 252


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
class TestHelpers:
    def test_composite_return_single_lookback(self):
        idx = pd.bdate_range("2019-01-01", periods=300)
        prices = pd.Series(np.linspace(100.0, 120.0, num=300), index=idx)
        closes = pd.DataFrame({"VOO": prices})
        r = _composite_return(closes, "VOO", ((252, 1.0),))
        expected = prices.iloc[-1] / prices.iloc[-253] - 1.0
        assert r is not None
        assert r == pytest.approx(float(expected), abs=1e-9)

    def test_composite_return_blend(self):
        idx = pd.bdate_range("2019-01-01", periods=300)
        prices = pd.Series(np.linspace(100.0, 130.0, num=300), index=idx)
        closes = pd.DataFrame({"VOO": prices})
        blend = _composite_return(closes, "VOO", ((126, 0.5), (252, 0.5)))
        r126 = prices.iloc[-1] / prices.iloc[-127] - 1.0
        r252 = prices.iloc[-1] / prices.iloc[-253] - 1.0
        assert blend == pytest.approx(0.5 * r126 + 0.5 * r252, abs=1e-9)

    def test_composite_return_insufficient_history(self):
        idx = pd.bdate_range("2024-01-01", periods=50)
        closes = pd.DataFrame({"VOO": np.arange(50) + 100.0}, index=idx)
        assert _composite_return(closes, "VOO", ((252, 1.0),)) is None

    def test_composite_return_missing_symbol(self):
        closes = pd.DataFrame({"VOO": [1, 2, 3]})
        assert _composite_return(closes, "NOPE", ((126, 1.0),)) is None


# --------------------------------------------------------------------------- #
# Registration                                                                #
# --------------------------------------------------------------------------- #
class TestRegistration:
    def test_strategy_is_registered(self):
        from strategies._core.protocol import get_meta, get_strategy

        cls = get_strategy("dual_momentum")
        assert cls is DualMomentumStrategy
        meta = get_meta("dual_momentum")
        assert meta.name == "dual_momentum"
        assert meta.category == "macro"
        assert "daily" in meta.required_bars
        assert meta.lookback_days >= 365
