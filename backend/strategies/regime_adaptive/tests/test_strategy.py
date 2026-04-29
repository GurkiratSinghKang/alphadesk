"""Unit tests for the Regime-Adaptive strategy — SOTA shell.

Covers:
1. Regime classification boundaries (TrendUp / MeanRevert / HighVol / Crisis).
2. Confirmation hysteresis blocks flip-flops.
3. Monthly rebalance trigger.
4. Allocation correctness (sum to 1.0, crisis_equity_floor, defensive_bond_weight).
5. Config validation.
6. Registration.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Callable, Iterable

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import StrategyInput
from strategies._core.protocol import get_meta, get_strategy
from strategies.regime_adaptive.config import (
    BASE_ALLOCATIONS,
    REGIMES,
    RegimeAdaptiveParams,
    allocation_for,
)
from strategies.regime_adaptive.strategy import (
    RegimeAdaptiveStrategy,
    _is_rebalance_day,
)


# --------------------------------------------------------------------------- #
# Synthetic data                                                              #
# --------------------------------------------------------------------------- #
def synthetic_spy_path(
    n_days: int,
    mu: float = 0.0,
    sigma_daily: float = 0.01,
    seed: int = 42,
    start_price: float = 300.0,
    trend_by_day: list[float] | None = None,
) -> list[float]:
    """Return a synthetic SPY close series."""
    rng = np.random.default_rng(seed)
    prices = [start_price]
    for i in range(1, n_days):
        drift = trend_by_day[i] if trend_by_day is not None else mu
        shock = rng.normal(0.0, sigma_daily)
        prices.append(prices[-1] * (1.0 + drift + shock))
    return prices


def _build_bars(
    price_fn: dict[str, Callable[[int], float]],
    n_days: int,
    start: date = date(2023, 1, 2),
) -> tuple[pd.DataFrame, list[date]]:
    """Multi-index (date, symbol) bars with scripted price paths."""
    idx = pd.bdate_range(start=start, periods=n_days)
    dates = [d.date() for d in idx]
    rows: list[pd.DataFrame] = []
    for sym, fn in price_fn.items():
        closes = [float(fn(i)) for i in range(n_days)]
        opens = [closes[0]] + closes[:-1]
        rows.append(pd.DataFrame({
            "symbol": sym, "date": dates,
            "open": opens,
            "high": [max(o, c) for o, c in zip(opens, closes)],
            "low": [min(o, c) for o, c in zip(opens, closes)],
            "close": closes, "volume": 1_000_000,
        }))
    merged = pd.concat(rows, ignore_index=True)
    return merged.set_index(["date", "symbol"]).sort_index(), dates


def _run_until(
    strat: RegimeAdaptiveStrategy,
    bars: pd.DataFrame,
    dates: list[date],
    params: RegimeAdaptiveParams,
    n_days: int,
) -> dict:
    """Run ``strat.run`` bar by bar for ``n_days``; return final merged state."""
    state: dict = {}
    for i in range(n_days):
        asof = dates[i]
        inp = StrategyInput(
            asof=asof, mode="backtest", bars=bars,
            cash=Decimal("100000"), equity=Decimal("100000"),
            positions=[], state=state,
            seed=0, rng=np.random.default_rng(0),
        )
        result = strat.run(inp, params)
        state = {**state, **result.state_update}
    return state


# --------------------------------------------------------------------------- #
# Regime classifier                                                           #
# --------------------------------------------------------------------------- #
class TestRegimeClassification:
    def test_trendup_when_steady_rise_and_low_vix(self):
        prices = synthetic_spy_path(
            n_days=500, mu=0.002, sigma_daily=0.0088, seed=1,
        )
        bars, dates = _build_bars({"SPY": lambda i: prices[i]}, n_days=500)
        strat = RegimeAdaptiveStrategy()
        state = _run_until(strat, bars, dates, RegimeAdaptiveParams(), n_days=280)
        assert state.get("ra_instant_regime") == "TrendUp"

    def test_highvol_when_vix_spikes_but_spy_intact(self):
        prices = synthetic_spy_path(
            n_days=500, mu=0.003, sigma_daily=0.019, seed=2,
        )
        bars, dates = _build_bars({"SPY": lambda i: prices[i]}, n_days=500)
        strat = RegimeAdaptiveStrategy()
        state = _run_until(strat, bars, dates, RegimeAdaptiveParams(), n_days=280)
        assert state.get("ra_instant_regime") == "HighVol"

    def test_crisis_when_spy_below_slow_and_vix_spike(self):
        trend = [0.001 if i < 280 else -0.003 for i in range(500)]
        sigma_by_day = [0.008 if i < 280 else 0.022 for i in range(500)]
        rng = np.random.default_rng(7)
        prices = [300.0]
        for i in range(1, 500):
            shock = rng.normal(0.0, sigma_by_day[i])
            prices.append(prices[-1] * (1.0 + trend[i] + shock))
        bars, dates = _build_bars({"SPY": lambda i: prices[i]}, n_days=500)
        strat = RegimeAdaptiveStrategy()
        state = _run_until(strat, bars, dates, RegimeAdaptiveParams(), n_days=440)
        assert state.get("ra_instant_regime") == "Crisis"

    def test_crisis_via_grind_bear_trigger(self):
        trend = [0.0009 if i < 280 else -0.0015 for i in range(500)]
        sigma_by_day = [0.008 if i < 280 else 0.012 for i in range(500)]
        rng = np.random.default_rng(9)
        prices = [300.0]
        for i in range(1, 500):
            shock = rng.normal(0.0, sigma_by_day[i])
            prices.append(prices[-1] * (1.0 + trend[i] + shock))
        bars, dates = _build_bars({"SPY": lambda i: prices[i]}, n_days=500)
        strat = RegimeAdaptiveStrategy()
        state = _run_until(strat, bars, dates, RegimeAdaptiveParams(), n_days=440)
        assert state.get("ra_instant_regime") == "Crisis"

    def test_meanrevert_as_default(self):
        prices = synthetic_spy_path(
            n_days=500, mu=0.0015, sigma_daily=0.013, seed=5,
        )
        bars, dates = _build_bars({"SPY": lambda i: prices[i]}, n_days=500)
        strat = RegimeAdaptiveStrategy()
        state = _run_until(strat, bars, dates, RegimeAdaptiveParams(), n_days=280)
        assert state.get("ra_instant_regime") == "MeanRevert"


# --------------------------------------------------------------------------- #
# Confirmation hysteresis                                                     #
# --------------------------------------------------------------------------- #
class TestConfirmation:
    def test_confirmed_regime_trendup_steady(self):
        prices = synthetic_spy_path(
            n_days=500, mu=0.002, sigma_daily=0.0088, seed=11,
        )
        bars, dates = _build_bars({"SPY": lambda i: prices[i]}, n_days=500)
        strat = RegimeAdaptiveStrategy()
        params = RegimeAdaptiveParams(confirmation_days=10)
        state = _run_until(strat, bars, dates, params, n_days=280)
        assert state.get("ra_confirmed_regime") == "TrendUp"

    def test_confirmation_promotes_after_streak(self):
        rng = np.random.default_rng(13)
        prices = [300.0]
        trend = [0.002 if i < 250 else 0.004 for i in range(400)]
        sigma = [0.008 if i < 250 else 0.022 for i in range(400)]
        for i in range(1, 400):
            shock = rng.normal(0.0, sigma[i])
            prices.append(prices[-1] * (1.0 + trend[i] + shock))
        bars, dates = _build_bars({"SPY": lambda i: prices[i]}, n_days=400)
        strat = RegimeAdaptiveStrategy()
        params = RegimeAdaptiveParams(confirmation_days=10)
        state = _run_until(strat, bars, dates, params, n_days=350)
        assert state.get("ra_instant_regime") == "HighVol"
        assert state.get("ra_confirmed_regime") == "HighVol"

    def test_regime_history_uses_iso_string_keys(self):
        asof = date(2024, 1, 31)
        strat = RegimeAdaptiveStrategy()
        inp = StrategyInput(
            asof=asof,
            mode="backtest",
            bars=pd.DataFrame(),
            cash=Decimal("100000"),
            equity=Decimal("100000"),
            positions=[],
            state={"ra_regime_history": {date(2024, 1, 30): {"instant": "TrendUp"}}},
            seed=0,
            rng=np.random.default_rng(0),
        )
        result = strat.run(inp, RegimeAdaptiveParams())
        history = result.state_update["ra_regime_history"]
        assert "2024-01-30" in history
        assert "2024-01-31" in history
        assert all(isinstance(k, str) for k in history)


# --------------------------------------------------------------------------- #
# Rebalance trigger                                                           #
# --------------------------------------------------------------------------- #
class TestRebalanceTrigger:
    def test_month_end_fires(self):
        assert _is_rebalance_day(date(2024, 1, 31), "monthly") is True

    def test_mid_month_does_not_fire(self):
        assert _is_rebalance_day(date(2024, 1, 15), "monthly") is False


# --------------------------------------------------------------------------- #
# Allocations                                                                 #
# --------------------------------------------------------------------------- #
class TestAllocations:
    def test_every_base_allocation_sums_to_one(self):
        for regime, weights in BASE_ALLOCATIONS.items():
            s = sum(weights.values())
            assert abs(s - 1.0) < 1e-9, f"{regime} sums to {s}, not 1.0"

    @pytest.mark.parametrize("regime", list(REGIMES))
    def test_allocation_for_sums_to_one_default(self, regime):
        params = RegimeAdaptiveParams()
        w = allocation_for(regime, params)
        assert abs(sum(w.values()) - 1.0) < 1e-9

    def test_crisis_default_has_zero_equity(self):
        params = RegimeAdaptiveParams()
        w = allocation_for("Crisis", params)
        assert w["SPY"] == 0.0
        assert w["QQQ"] == 0.0
        assert w["EFA"] == 0.0

    def test_crisis_equity_floor_raises_equity(self):
        params = RegimeAdaptiveParams(crisis_equity_floor=0.10)
        w = allocation_for("Crisis", params)
        equity_sum = w["SPY"] + w["QQQ"] + w["EFA"]
        assert equity_sum > 0.0
        assert 0.09 <= equity_sum <= 0.11
        assert abs(sum(w.values()) - 1.0) < 1e-9

    def test_defensive_bond_weight_shifts_bonds(self):
        params = RegimeAdaptiveParams(defensive_bond_weight=0.40)
        w = allocation_for("HighVol", params)
        bond = w["IEF"] + w["TLT"]
        assert 0.37 <= bond <= 0.43
        assert abs(sum(w.values()) - 1.0) < 1e-9


# --------------------------------------------------------------------------- #
# Config                                                                      #
# --------------------------------------------------------------------------- #
class TestConfig:
    def test_tune_space_knobs(self):
        space = RegimeAdaptiveParams.tune_space()
        assert set(space.keys()) == {
            "sma_fast", "sma_slow", "vix_low_threshold", "vix_high_threshold",
            "confirmation_days", "rebalance_freq",
            "crisis_equity_floor", "defensive_bond_weight",
        }

    def test_bad_sma_order_rejected(self):
        with pytest.raises(Exception, match="sma_fast"):
            RegimeAdaptiveParams(sma_fast=200, sma_slow=50)

    def test_bad_vix_order_rejected(self):
        with pytest.raises(Exception, match="vix_low_threshold"):
            RegimeAdaptiveParams(vix_low_threshold=30.0, vix_high_threshold=25.0)


# --------------------------------------------------------------------------- #
# Registration                                                                #
# --------------------------------------------------------------------------- #
class TestRegistration:
    def test_strategy_is_registered(self):
        cls = get_strategy("regime_adaptive")
        assert cls is RegimeAdaptiveStrategy
        meta = get_meta("regime_adaptive")
        assert meta.name == "regime_adaptive"
        assert meta.category == "macro"
        assert "daily" in meta.required_bars
