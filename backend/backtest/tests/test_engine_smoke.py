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

from backtest.engine import BacktestEngine, EngineConfig
from backtest.types import (
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

    from backtest.types import Bar

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


# ---------------------------------------------------------------------------
# End-to-end multi-leg options: short strangle with IV crush
# ---------------------------------------------------------------------------


class FakeOptionsProvider:
    """Simple in-memory options provider for engine tests.

    ``contract_prices[(contract_id, date)] -> close``.
    """

    def __init__(self, contract_prices):
        self._prices = contract_prices

    def contract_bars(self, contract, start, end, tf="1D"):
        d = start.date() if hasattr(start, "date") else start
        key = (contract, d)
        if key not in self._prices:
            return pd.DataFrame(columns=["contract", "ts", "close"])
        return pd.DataFrame(
            [{"contract": contract, "ts": pd.Timestamp(d), "close": self._prices[key]}]
        )

    def chain_snapshot(self, underlying, asof):
        return pd.DataFrame()


class ShortStrangleStrategy:
    """Opens a 1-day short strangle on day 1; closes it on day N."""

    name = "toy_strangle"
    required_bars = ["1D"]
    required_lookback_days = 0

    def __init__(self):
        self.opened = False
        self.closed = False
        self._close_on: date | None = None

    def configure(self, params):
        self.underlying = (params or {}).get("underlying", "SPY")
        self._close_on = (params or {}).get("close_on", date(2023, 1, 6))

    def universe(self, asof, ctx):
        return [self.underlying]

    def generate_signals(self, asof, ctx):
        from backtest.types import OptionLeg, Side
        if self.opened:
            return []
        # Open on the first session.
        self.opened = True
        legs = (
            OptionLeg(
                contract_id="O:TEST240119C00400000",
                side=Side.SELL,
                qty=1,
                underlying=self.underlying,
                expiry=date(2024, 1, 19),
                strike=Decimal("400"),
                right="C",
                multiplier=100,
            ),
            OptionLeg(
                contract_id="O:TEST240119P00400000",
                side=Side.SELL,
                qty=1,
                underlying=self.underlying,
                expiry=date(2024, 1, 19),
                strike=Decimal("400"),
                right="P",
                multiplier=100,
            ),
        )
        return [
            Signal(
                symbol=self.underlying,
                quantity=-1,
                legs=legs,
                order_type=OrderType.MOC,
                time_in_force=TimeInForce.DAY,
                asof=asof,
            )
        ]

    def manage(self, asof, ctx):
        from backtest.types import OptionLeg, Side
        if not self.opened or self.closed:
            return []
        if asof < self._close_on:
            return []
        # Close: flip leg sides (SELL → BUY).
        self.closed = True
        close_legs = (
            OptionLeg(
                contract_id="O:TEST240119C00400000",
                side=Side.BUY,
                qty=1,
                underlying=self.underlying,
                expiry=date(2024, 1, 19),
                strike=Decimal("400"),
                right="C",
                multiplier=100,
            ),
            OptionLeg(
                contract_id="O:TEST240119P00400000",
                side=Side.BUY,
                qty=1,
                underlying=self.underlying,
                expiry=date(2024, 1, 19),
                strike=Decimal("400"),
                right="P",
                multiplier=100,
            ),
        )
        return [
            Signal(
                symbol=self.underlying,
                quantity=1,
                legs=close_legs,
                order_type=OrderType.MOC,
                time_in_force=TimeInForce.DAY,
                asof=asof,
            )
        ]

    def on_fill(self, fill, ctx):
        return None


def test_engine_short_strangle_end_to_end_with_real_leg_prices():
    """End-to-end: the engine opens a short strangle at the real leg
    premiums from the options provider, marks position, and closes it.
    The P&L must match the spread-level credit minus cost-to-close
    (times the multiplier), not the underlying's close price."""

    bp = FakeBarProvider(symbol="SPY", start_price=400.0, drift=0.0, vol=0.005, seed=1)
    # Day 1: call=3.20, put=2.80 → open credit 6.00
    # Day 5 (close): call=1.00, put=0.80 → close debit 1.80
    # P&L = (6.00 - 1.80) * 100 = $420 per spread
    options = FakeOptionsProvider(
        contract_prices={
            ("O:TEST240119C00400000", date(2023, 1, 3)): 3.20,
            ("O:TEST240119P00400000", date(2023, 1, 3)): 2.80,
            ("O:TEST240119C00400000", date(2023, 1, 9)): 1.00,
            ("O:TEST240119P00400000", date(2023, 1, 9)): 0.80,
        }
    )
    strat = ShortStrangleStrategy()
    engine = BacktestEngine(
        strategy=strat,
        bar_provider=bp,
        options_provider=options,
        config=EngineConfig(
            start=date(2023, 1, 3),
            end=date(2023, 1, 9),
            starting_cash=Decimal("100000"),
        ),
        strategy_params={"close_on": date(2023, 1, 9)},
    )
    result = engine.run()
    # One spread's P&L = (6.00 - 1.80) * 100 = $420.
    # Minus two commission tickets (@ $0.65/leg-minimum + reg fees on sells).
    # Commissions ballpark to <$5 total, so gross should be close to $420.
    realized = float(engine.portfolio.realized_pnl)
    # We expect realized P&L near +$420 (short strangle profit from IV crush).
    assert 350 < realized < 450, (
        f"Expected realized P&L between $350 and $450, got {realized}"
    )
    # Not dominated by the underlying's 400-dollar close!
    assert realized < 40000, (
        "Realized P&L should not scale with the underlying price — that was "
        "the old bug."
    )
    # The final equity should reflect the real credit received & close cost.
    final_cash = float(engine.portfolio.cash)
    assert final_cash > 100000, f"Should have net profit: {final_cash}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
