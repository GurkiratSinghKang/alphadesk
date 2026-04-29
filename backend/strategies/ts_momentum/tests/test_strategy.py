"""Unit tests for the TSMOM multi-asset strategy — SOTA shell.

Covers five audit-mandated properties:

1. Sign-of-return correctness — +20% -> long, -20% -> short (if enabled).
2. Inverse-vol weights sum to the gross target when no cap is binding.
3. Monthly trigger — mid-month bars emit no signals.
4. Shorts generate negative target_weight when shorts_enabled=True,
   and zero out the leg when shorts_enabled=False.
5. Drawdown de-lever halves gross notional past the threshold.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import StrategyInput
from strategies.ts_momentum.config import (
    TSMomentumParams,
    UNIVERSE_MINIMAL_6,
    UNIVERSE_FULL_11,
    signal_lookback_days,
    max_lookback_days,
    universe_tickers,
)
from strategies.ts_momentum.strategy import (
    TSMomentumStrategy,
    _is_rebalance_day,
)


# --------------------------------------------------------------------------- #
# Synthetic bar-panel builder                                                 #
# --------------------------------------------------------------------------- #
def _build_bars(
    returns: dict[str, tuple[float, float]],
    asof: date,
    n_days: int = 400,
    seed: int = 12345,
) -> pd.DataFrame:
    """Return a multi-index (date, symbol) bar frame whose per-symbol 252d
    return matches the first element of the tuple and whose daily vol is
    close to the second."""
    end = pd.Timestamp(asof).tz_localize(None).normalize()
    idx = pd.bdate_range(end=end, periods=n_days)

    rows: list[pd.DataFrame] = []
    for sym_i, (sym, (r_final, daily_sigma)) in enumerate(returns.items()):
        rng = np.random.default_rng(seed + sym_i)
        drift_per_day = np.log(1.0 + r_final) / 252.0
        noise = rng.normal(0.0, daily_sigma, size=n_days)
        log_ret = drift_per_day + noise
        tail = log_ret[-252:]
        adj = (np.log(1.0 + r_final) - tail.sum()) / 252.0
        log_ret[-252:] = tail + adj
        price = 100.0 * np.exp(np.cumsum(log_ret))
        opens = np.concatenate(([price[0]], price[:-1]))
        highs = np.maximum(opens, price)
        lows = np.minimum(opens, price)
        rows.append(pd.DataFrame({
            "symbol": sym,
            "date": [d.date() for d in idx],
            "open": opens,
            "high": highs,
            "low": lows,
            "close": price,
            "volume": 1_000_000,
        }))

    frame = pd.concat(rows, ignore_index=True)
    return frame.set_index(["date", "symbol"]).sort_index()


def _build_input(
    bars: pd.DataFrame,
    asof: date,
    cash: Decimal = Decimal("100000"),
    equity: Decimal | None = None,
    positions: list | None = None,
    state: dict | None = None,
) -> StrategyInput:
    return StrategyInput(
        asof=asof,
        mode="backtest",
        bars=bars,
        cash=cash,
        equity=equity if equity is not None else cash,
        positions=positions or [],
        state=state or {},
        seed=0,
        rng=np.random.default_rng(0),
    )


# --------------------------------------------------------------------------- #
# Test 1 — sign of return correctness                                         #
# --------------------------------------------------------------------------- #
class TestSignOfReturn:
    @staticmethod
    def _rebalance_day() -> date:
        return date(2024, 1, 31)

    def test_positive_12m_return_emits_positive_weight(self):
        bars = _build_bars({
            "SPY": (0.20, 0.01), "EFA": (0.01, 0.012),
            "IEF": (0.01, 0.004), "TLT": (0.01, 0.009),
            "GLD": (0.01, 0.008), "DBC": (0.01, 0.013),
        }, self._rebalance_day())
        strat = TSMomentumStrategy()
        params = TSMomentumParams(shorts_enabled=False)
        result = strat.run(_build_input(bars, self._rebalance_day()), params)
        spy_sigs = [s for s in result.signals if s.symbol == "SPY"]
        assert spy_sigs
        assert spy_sigs[0].target_weight > 0

    def test_negative_12m_return_with_shorts_enabled_emits_negative_weight(self):
        bars = _build_bars({
            "SPY": (-0.20, 0.01), "EFA": (0.01, 0.012),
            "IEF": (0.01, 0.004), "TLT": (0.01, 0.009),
            "GLD": (0.01, 0.008), "DBC": (0.01, 0.013),
        }, self._rebalance_day())
        strat = TSMomentumStrategy()
        params = TSMomentumParams(shorts_enabled=True)
        result = strat.run(_build_input(bars, self._rebalance_day()), params)
        spy_sigs = [s for s in result.signals if s.symbol == "SPY"]
        assert spy_sigs
        assert spy_sigs[0].target_weight < 0

    def test_negative_12m_return_with_shorts_disabled_drops_leg(self):
        bars = _build_bars({
            "SPY": (-0.20, 0.01), "EFA": (0.10, 0.012),
            "IEF": (0.01, 0.004), "TLT": (0.01, 0.009),
            "GLD": (0.05, 0.008), "DBC": (0.03, 0.013),
        }, self._rebalance_day())
        strat = TSMomentumStrategy()
        params = TSMomentumParams(shorts_enabled=False)
        result = strat.run(_build_input(bars, self._rebalance_day()), params)
        syms = [s.symbol for s in result.signals]
        assert "SPY" not in syms
        assert result.diagnostics["weight_model"]["shorts_disabled_filtered"] == 1
        assert (
            result.diagnostics["weight_model"]["skipped"]["flat_or_disabled_signal"]
            >= 1
        )


# --------------------------------------------------------------------------- #
# Test 2 — inverse-vol weights                                                #
# --------------------------------------------------------------------------- #
class TestInverseVolWeights:
    @staticmethod
    def _rebalance_day() -> date:
        return date(2024, 1, 31)

    def test_weights_sum_to_gross_mul(self):
        bars = _build_bars({
            "SPY": (0.10, 0.010), "EFA": (0.10, 0.012),
            "IEF": (0.10, 0.004), "TLT": (0.10, 0.009),
            "GLD": (0.10, 0.008), "DBC": (0.10, 0.013),
        }, self._rebalance_day())
        strat = TSMomentumStrategy()
        params = TSMomentumParams(
            max_weight_per_asset=0.30,
            drawdown_delever_threshold=5.0,
        )
        result = strat.run(_build_input(bars, self._rebalance_day()), params)
        total_gross = sum(abs(s.target_weight or 0) for s in result.signals)
        assert total_gross == pytest.approx(1.0, abs=1e-6)
        model = result.diagnostics["weight_model"]
        assert model["raw_weight_count"] == 6
        assert model["final_weight_count"] == 6
        assert model["final_gross"] == pytest.approx(1.0, abs=1e-6)
        assert set(model["weights"]) == {"SPY", "EFA", "IEF", "TLT", "GLD", "DBC"}

    def test_low_vol_leg_gets_higher_weight(self):
        bars = _build_bars({
            "SPY": (0.10, 0.010), "EFA": (0.10, 0.010),
            "IEF": (0.10, 0.002),
            "TLT": (0.10, 0.010), "GLD": (0.10, 0.010),
            "DBC": (0.10, 0.010),
        }, self._rebalance_day())
        strat = TSMomentumStrategy()
        params = TSMomentumParams(
            max_weight_per_asset=0.50,
            drawdown_delever_threshold=5.0,
            vol_floor=0.01,
        )
        result = strat.run(_build_input(bars, self._rebalance_day()), params)
        w = {s.symbol: abs(s.target_weight or 0) for s in result.signals}
        assert w.get("IEF", 0) > w.get("SPY", 0)


# --------------------------------------------------------------------------- #
# Test 3 — monthly trigger                                                    #
# --------------------------------------------------------------------------- #
class TestMonthlyTrigger:
    def test_rebalance_day_fires(self):
        assert _is_rebalance_day(date(2024, 1, 31), "monthly") is True

    def test_mid_month_does_not_fire(self):
        assert _is_rebalance_day(date(2024, 1, 15), "monthly") is False

    def test_mid_month_hooks_are_noop(self):
        bars = _build_bars({
            "SPY": (0.20, 0.01), "EFA": (0.10, 0.01),
            "IEF": (0.04, 0.004), "TLT": (0.08, 0.009),
            "GLD": (0.12, 0.008), "DBC": (0.05, 0.013),
        }, date(2024, 1, 15))
        strat = TSMomentumStrategy()
        result = strat.run(
            _build_input(bars, date(2024, 1, 15)), TSMomentumParams(),
        )
        assert result.signals == []


# --------------------------------------------------------------------------- #
# Test 4 — shorts                                                             #
# --------------------------------------------------------------------------- #
class TestShorts:
    def test_multiple_negative_legs_produce_negative_weights(self):
        bars = _build_bars({
            "SPY": (-0.15, 0.010), "EFA": (-0.12, 0.012),
            "IEF": (0.04, 0.004), "TLT": (0.08, 0.009),
            "GLD": (0.10, 0.008), "DBC": (-0.05, 0.013),
        }, date(2024, 1, 31))
        strat = TSMomentumStrategy()
        params = TSMomentumParams(
            shorts_enabled=True,
            drawdown_delever_threshold=5.0,
        )
        result = strat.run(_build_input(bars, date(2024, 1, 31)), params)
        neg_syms = {s.symbol for s in result.signals if (s.target_weight or 0) < 0}
        pos_syms = {s.symbol for s in result.signals if (s.target_weight or 0) > 0}
        assert "SPY" in neg_syms
        assert "EFA" in neg_syms
        assert "DBC" in neg_syms
        assert "IEF" in pos_syms
        assert "TLT" in pos_syms


# --------------------------------------------------------------------------- #
# Test 5 — drawdown de-lever                                                  #
# --------------------------------------------------------------------------- #
class TestDrawdownDelever:
    def test_delever_halves_gross_when_drawdown_exceeds_threshold(self):
        params = TSMomentumParams(
            max_weight_per_asset=0.30,
            drawdown_delever_threshold=0.10,
        )
        bars1 = _build_bars({
            "SPY": (0.10, 0.010), "EFA": (0.10, 0.012),
            "IEF": (0.10, 0.004), "TLT": (0.10, 0.009),
            "GLD": (0.10, 0.008), "DBC": (0.10, 0.013),
        }, date(2023, 11, 30))
        strat = TSMomentumStrategy()
        result1 = strat.run(
            _build_input(
                bars1, date(2023, 11, 30),
                cash=Decimal("100000"), equity=Decimal("100000"),
            ),
            params,
        )
        base_gross = sum(abs(s.target_weight or 0) for s in result1.signals)
        assert base_gross == pytest.approx(1.0, abs=1e-6)

        # Second rebalance: equity drops 12% from peak. Carry state.
        state2 = dict(result1.state_update)
        bars2 = _build_bars({
            "SPY": (0.10, 0.010), "EFA": (0.10, 0.012),
            "IEF": (0.10, 0.004), "TLT": (0.10, 0.009),
            "GLD": (0.10, 0.008), "DBC": (0.10, 0.013),
        }, date(2023, 12, 29))
        result2 = strat.run(
            _build_input(
                bars2, date(2023, 12, 29),
                cash=Decimal("88000"), equity=Decimal("88000"),
                state=state2,
            ),
            params,
        )
        delev_gross = sum(abs(s.target_weight or 0) for s in result2.signals)
        assert delev_gross == pytest.approx(0.5, abs=1e-6)


# --------------------------------------------------------------------------- #
# Config                                                                      #
# --------------------------------------------------------------------------- #
class TestConfig:
    def test_tune_space_has_expected_knobs(self):
        space = TSMomentumParams.tune_space()
        assert set(space.keys()) == {
            "lookback_months",
            "signal_ensemble",
            "target_vol",
            "rebalance_freq",
            "realized_vol_window",
            "max_weight_per_asset",
            "drawdown_delever_threshold",
            "shorts_enabled",
            "universe_size",
        }

    def test_universe_size_minimal_6(self):
        p = TSMomentumParams(universe_size="minimal_6")
        assert len(universe_tickers(p)) == 6
        assert "SPY" in universe_tickers(p)

    def test_universe_size_full_11(self):
        p = TSMomentumParams(universe_size="full_11")
        assert len(universe_tickers(p)) == 11
        assert "VNQ" in universe_tickers(p)
        assert "EEM" in universe_tickers(p)

    def test_ensemble_lookbacks(self):
        p = TSMomentumParams(signal_ensemble="ensemble_1_3_6_12")
        assert signal_lookback_days(p) == (21, 63, 126, 252)
        assert max_lookback_days(p) == 252

    def test_single_12m_respects_lookback_months(self):
        p = TSMomentumParams(signal_ensemble="single_12m", lookback_months=9)
        assert signal_lookback_days(p) == (189,)

    def test_extra_key_rejected(self):
        with pytest.raises(Exception):
            TSMomentumParams(bogus=1)


# --------------------------------------------------------------------------- #
# Registration                                                                #
# --------------------------------------------------------------------------- #
class TestRegistration:
    def test_strategy_is_registered(self):
        from strategies._core.protocol import get_meta, get_strategy

        cls = get_strategy("ts_momentum")
        assert cls is TSMomentumStrategy
        meta = get_meta("ts_momentum")
        assert meta.name == "ts_momentum"
        assert meta.category == "macro"
        assert meta.min_universe_size >= 3
