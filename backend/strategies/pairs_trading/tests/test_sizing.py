"""Dollar-neutrality sizing test for the pairs_trading strategy — SOTA shell.

Log-space OLS makes ``beta`` a log-elasticity rather than a share-count hedge
ratio. The strategy emits ``Signal(target_weight=±pair_weight)`` for each leg —
so the two legs are dollar-neutral regardless of per-share price, by construction.

This test pins that property for an extreme 10x price-asymmetry pair so any
refactor that multiplies a leg by ``beta_log`` trips immediately.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import StrategyInput
from strategies.pairs_trading.config import PairsTradingParams, UNIVERSE
from strategies.pairs_trading.strategy import ActivePair, PairsTradingStrategy


def _closes_to_bars(closes: pd.DataFrame) -> pd.DataFrame:
    rows: list[pd.DataFrame] = []
    for sym in closes.columns:
        series = closes[sym].dropna()
        frame = pd.DataFrame({
            "symbol": sym,
            "date": [d.date() if hasattr(d, "date") else d for d in series.index],
            "open": series.values,
            "high": series.values,
            "low": series.values,
            "close": series.values,
            "volume": 1_000_000,
        })
        rows.append(frame)
    merged = pd.concat(rows, ignore_index=True)
    return merged.set_index(["date", "symbol"]).sort_index()


def _make_extreme_price_pair(
    n_bars: int = 400, seed: int = 41,
    py_level: float = 400.0, px_level: float = 40.0,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    log_ret = rng.normal(0.0, 0.012, n_bars)
    shared = np.cumsum(log_ret)
    noise_y = rng.normal(0.0, 0.0025, n_bars)
    noise_x = rng.normal(0.0, 0.0025, n_bars)
    y = py_level * np.exp(shared + noise_y)
    x = px_level * np.exp(shared + noise_x)
    idx = pd.date_range("2018-01-02", periods=n_bars, freq="B")
    df = pd.DataFrame({"AAPL": y, "MSFT": x}, index=idx)
    spread = np.log(df["AAPL"]) - np.log(df["MSFT"])
    sigma = float(spread.tail(90).std())
    df.iloc[-1, df.columns.get_loc("AAPL")] = float(
        df["AAPL"].iloc[-1] * np.exp(-3.0 * sigma)
    )
    return df


def _build_input(bars: pd.DataFrame, asof: date, state: dict | None = None) -> StrategyInput:
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars,
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=[], state=state or {},
        seed=0, rng=np.random.default_rng(0),
    )


class TestDollarNeutralitySizing:
    def test_entry_dollar_neutral_for_400_vs_40_pair(self) -> None:
        closes = _make_extreme_price_pair(
            n_bars=400, seed=41, py_level=400.0, px_level=40.0,
        )
        last_y = float(closes["AAPL"].iloc[-1])
        last_x = float(closes["MSFT"].iloc[-1])
        assert last_y > 8 * last_x

        from indicators.stats import engle_granger_adf
        log_y = np.log(closes["AAPL"])
        log_x = np.log(closes["MSFT"])
        _pv, _adf, beta_log, _res = engle_granger_adf(log_y, log_x)
        assert np.isfinite(beta_log)
        assert 0.7 < float(beta_log) < 1.3

        full = pd.DataFrame(index=closes.index, columns=list(UNIVERSE), dtype=float)
        full["AAPL"] = closes["AAPL"].values
        full["MSFT"] = closes["MSFT"].values
        bars = _closes_to_bars(full)
        asof = closes.index[-1].date()

        active = [ActivePair(
            pair_id="AAPL-MSFT", sector="Tech", y="AAPL", x="MSFT",
            beta=float(beta_log),
            screen_pvalue=0.01, screen_halflife=10.0,
            last_screen_date=asof, last_watchdog_date=asof,
        )]
        state = {
            "pairs_trading.active": active,
            "pairs_trading.last_screen": asof,
        }
        params = PairsTradingParams(
            z_entry=1.5, z_stop=10.0, z_window=45, max_pairs=3,
            pair_weight=0.10, rescreen_days=1000,
        )
        strat = PairsTradingStrategy()
        result = strat.run(_build_input(bars, asof, state=state), params)
        entry_sigs = [sig for sig in result.signals if sig.tag.startswith("pairs-entry")]
        assert len(entry_sigs) == 2

        weights = {sig.symbol: float(sig.target_weight) for sig in entry_sigs}
        assert set(weights.keys()) == {"AAPL", "MSFT"}
        assert weights["AAPL"] * weights["MSFT"] < 0

        equity = 100_000.0
        dollar_y = weights["AAPL"] * equity
        dollar_x = weights["MSFT"] * equity
        net_dollar = dollar_y + dollar_x
        larger_leg = max(abs(dollar_y), abs(dollar_x))
        assert abs(net_dollar) <= 0.01 * larger_leg

    def test_entry_two_leg_notionals_equal_in_magnitude(self) -> None:
        closes = _make_extreme_price_pair(
            n_bars=400, seed=41, py_level=400.0, px_level=40.0,
        )
        from indicators.stats import engle_granger_adf
        log_y = np.log(closes["AAPL"])
        log_x = np.log(closes["MSFT"])
        _pv, _adf, beta_log, _res = engle_granger_adf(log_y, log_x)

        full = pd.DataFrame(index=closes.index, columns=list(UNIVERSE), dtype=float)
        full["AAPL"] = closes["AAPL"].values
        full["MSFT"] = closes["MSFT"].values
        bars = _closes_to_bars(full)
        asof = closes.index[-1].date()

        active = [ActivePair(
            pair_id="AAPL-MSFT", sector="Tech", y="AAPL", x="MSFT",
            beta=float(beta_log),
            screen_pvalue=0.01, screen_halflife=10.0,
            last_screen_date=asof, last_watchdog_date=asof,
        )]
        state = {
            "pairs_trading.active": active,
            "pairs_trading.last_screen": asof,
        }
        params = PairsTradingParams(
            z_entry=1.5, z_stop=10.0, z_window=45, max_pairs=3,
            pair_weight=0.10, rescreen_days=1000,
        )
        strat = PairsTradingStrategy()
        result = strat.run(_build_input(bars, asof, state=state), params)
        entry_sigs = [sig for sig in result.signals if sig.tag.startswith("pairs-entry")]
        assert len(entry_sigs) == 2
        w_y = abs(next(s.target_weight for s in entry_sigs if s.symbol == "AAPL"))
        w_x = abs(next(s.target_weight for s in entry_sigs if s.symbol == "MSFT"))
        assert w_y == pytest.approx(w_x, rel=1e-9)
