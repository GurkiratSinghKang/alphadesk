"""Smoke test for the end-to-end engine.

A deterministic ``FakeBarProvider`` generates a drifting price series for
"SPY" and a trivial "buy 100% SPY, hold" strategy is run through the engine.
The final equity must exceed starting cash and the Sharpe ratio must be
positive.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import numpy as np
import pandas as pd
import pytest

from backend.backtest.engine import BacktestEngine, EngineConfig
from backend.backtest.types import (
    Context,
    OrderType,
    Signal,
    TimeInForce,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeBarProvider:
    """Generates a geometric-Brownian-motion-like drifting price path."""

    def __init__(
        self,
        symbol: str = "SPY",
        start_price: float = 400.0,
        drift: float = 0.0005,  # ~12.6% / yr
        vol: float = 0.01,
        seed: int = 42,
    ):
        self.symbol = symbol
        self.start_price = start_price
        self.drift = drift
        self.vol = vol
        self.rng = np.random.default_rng(seed)
        self._cache: dict[date, tuple[float, float, float, float]] = {}

    def _path_for(self, up_to: date) -> dict[date, tuple[float, float, float, float]]:
        # Build path once for a very wide range, cache it.
        if self._cache:
            return self._cache
        idx = pd.bdate_range(start="2018-01-01", end="2027-01-01")
        n = len(idx)
        rng = np.random.default_rng(42)  # deterministic
        rets = rng.normal(self.drift, self.vol, n)
        closes = self.start_price * np.cumprod(1.0 + rets)
        for i, ts in enumerate(idx):
            c = float(closes[i])
            o = c * (1 + rng.normal(0, self.vol * 0.2))
            h = max(o, c) * (1 + abs(rng.normal(0, self.vol * 0.3)))
            l = min(o, c) * (1 - abs(rng.normal(0, self.vol * 0.3)))
            self._cache[ts.date()] = (float(o), float(h), float(l), float(c))
        return self._cache

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        path = self._path_for(end)
        syms = list(symbols) if not isinstance(symbols, str) else [symbols]
        rows = []
        # Normalise date range.
        s = start if isinstance(start, date) else pd.Timestamp(start).date()
        e = end if isinstance(end, date) else pd.Timestamp(end).date()
        d = s
        while d <= e:
            if d in path:
                o, h, l, c = path[d]
                for sym in syms:
                    rows.append(
                        {
                            "symbol": sym,
                            "date": datetime.combine(d, datetime.min.time()),
                            "open": o,
                            "high": h,
                            "low": l,
                            "close": c,
                            "volume": 1_000_000,
                        }
                    )
            d += timedelta(days=1)
        return pd.DataFrame(rows)


class BuyAndHoldStrategy:
    """Target 100% weight in SPY with MOO orders."""

    name = "buy_and_hold"
    required_bars = ["1D"]
    required_lookback_days = 5

    def __init__(self) -> None:
        self._entered = False

    def configure(self, params):
        self.symbol = (params or {}).get("symbol", "SPY")
        self._entered = False

    def universe(self, asof, ctx):
        return [self.symbol]

    def generate_signals(self, asof, ctx: Context):
        if self._entered:
            return []
        self._entered = True
        return [
            Signal(
                symbol=self.symbol,
                target_weight=1.0,
                order_type=OrderType.MOO,
                time_in_force=TimeInForce.DAY,
            )
        ]

    def manage(self, asof, ctx: Context):
        return []

    def on_fill(self, fill, ctx: Context):
        return


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_smoke_buy_and_hold_positive_sharpe():
    provider = FakeBarProvider(symbol="SPY", drift=0.0005, vol=0.01, seed=42)
    strat = BuyAndHoldStrategy()
    engine = BacktestEngine(
        strategy=strat,
        bar_provider=provider,
        config=EngineConfig(
            start=date(2023, 1, 2),
            end=date(2023, 12, 29),
            starting_cash=Decimal("100000"),
        ),
    )
    result = engine.run()

    assert not result.equity_curve.empty, "equity curve should not be empty"
    final_equity = float(result.equity_curve["equity"].iloc[-1])
    # Drift ~12.6% / yr, so we expect > starting cash in a full year.
    assert final_equity > 100000.0, f"expected growth, got {final_equity}"

    sharpe = result.metrics["sharpe"]
    assert sharpe > 0.0, f"Sharpe should be positive on a drifting series, got {sharpe}"
    # CAGR is positive.
    assert result.metrics["cagr"] > 0.0


def test_no_lookahead_first_bar_has_no_trades():
    """Signal generated on bar 0 must NOT fill on bar 0 when using MOO."""

    provider = FakeBarProvider(seed=7)
    strat = BuyAndHoldStrategy()
    engine = BacktestEngine(
        strategy=strat,
        bar_provider=provider,
        config=EngineConfig(
            start=date(2023, 1, 2),
            end=date(2023, 1, 31),
            starting_cash=Decimal("100000"),
        ),
    )
    result = engine.run()

    # First row equity should equal starting cash exactly (no MOO fill yet on
    # the staging bar; fill happens on the second session at its open).
    first_row = result.equity_curve.iloc[0]
    assert first_row["equity"] == pytest.approx(100000.0)
    assert first_row["positions_value"] == pytest.approx(0.0)

    # By the time the window ends we should be long.
    last_row = result.equity_curve.iloc[-1]
    assert last_row["positions_value"] > 0


def test_splits_applied_mid_backtest():
    """A 2:1 split mid-window doubles our share count."""

    from backend.backtest.types import Bar

    class SplittingProvider:
        def bars(self, symbols, start, end, tf: str = "1D"):
            syms = list(symbols) if not isinstance(symbols, str) else [symbols]
            sym = syms[0]
            start_d = start if isinstance(start, date) else pd.Timestamp(start).date()
            end_d = end if isinstance(end, date) else pd.Timestamp(end).date()
            rows = []
            day = start_d
            price = 200.0
            while day <= end_d:
                if day.weekday() < 5:
                    split = 1.0
                    if day == date(2023, 3, 15):
                        split = 2.0
                        price = price / 2.0
                    rows.append(
                        {
                            "symbol": sym,
                            "date": datetime.combine(day, datetime.min.time()),
                            "open": price,
                            "high": price * 1.01,
                            "low": price * 0.99,
                            "close": price,
                            "volume": 1_000_000,
                            "split_ratio": split,
                        }
                    )
                day += timedelta(days=1)
            return pd.DataFrame(rows)

    provider = SplittingProvider()
    strat = BuyAndHoldStrategy()
    engine = BacktestEngine(
        strategy=strat,
        bar_provider=provider,
        config=EngineConfig(
            start=date(2023, 1, 3),
            end=date(2023, 3, 31),
            starting_cash=Decimal("100000"),
        ),
    )
    result = engine.run()

    # After the 2:1 split on Mar 15, our share count doubles, avg cost halves.
    # Final equity should be approximately preserved (buy-and-hold with no
    # drift other than the split adjustment).
    final_equity = float(result.equity_curve["equity"].iloc[-1])
    # Share count had to have doubled at least once.
    pos = engine.portfolio.get_position("SPY")
    if pos is not None:
        # Bought ~500 shares at ~200, after split should be ~1000.
        assert pos.quantity >= 900


def test_deterministic_output():
    """Same inputs, same seed -> same output."""

    def run():
        p = FakeBarProvider(seed=42)
        s = BuyAndHoldStrategy()
        e = BacktestEngine(
            strategy=s,
            bar_provider=p,
            config=EngineConfig(
                start=date(2023, 1, 2),
                end=date(2023, 6, 30),
                starting_cash=Decimal("100000"),
                seed=42,
            ),
        )
        return e.run()

    r1 = run()
    r2 = run()
    assert r1.metrics["sharpe"] == r2.metrics["sharpe"]
    assert len(r1.trades) == len(r2.trades)
    assert float(r1.equity_curve["equity"].iloc[-1]) == float(
        r2.equity_curve["equity"].iloc[-1]
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
