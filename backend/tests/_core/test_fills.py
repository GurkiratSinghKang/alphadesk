# backend/tests/_core/test_fills.py
"""FillSimulator (slippage + commission) + Portfolio (position ledger)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pandas as pd

from strategies._core.contracts import (
    BacktestConfig,
    OrderType,
    Position,
    Signal,
    TimeInForce,
)
from strategies._core.fills import FillSimulator, Portfolio


def _bar(price: float = 100.0) -> pd.Series:
    return pd.Series({"open": price, "high": price * 1.01, "low": price * 0.99,
                      "close": price * 1.005, "volume": 1_000_000})


def test_fill_simulator_next_open():
    cfg = BacktestConfig(start=date(2024, 1, 1), end=date(2024, 12, 31),
                         slippage_bps=1.0, fill_model="next_open")
    sim = FillSimulator(cfg)
    signal = Signal(symbol="NVDA", asof=date(2024, 1, 1),
                    order_type=OrderType.MOO, quantity=100)
    fills = sim.fill([signal], next_bars={"NVDA": _bar(100.0)}, asof=date(2024, 1, 2))
    assert len(fills) == 1
    f = fills[0]
    # Buy slippage: 1 bps added to open
    assert f.symbol == "NVDA"
    assert f.quantity == 100
    assert f.price == Decimal("100.01")              # 100 + 1bps
    assert f.commission == Decimal("0.50")           # 100 shares × $0.005


def test_fill_simulator_sell_slippage():
    cfg = BacktestConfig(start=date(2024, 1, 1), end=date(2024, 12, 31),
                         slippage_bps=1.0, fill_model="next_open")
    sim = FillSimulator(cfg)
    signal = Signal(symbol="NVDA", asof=date(2024, 1, 1),
                    order_type=OrderType.MOO, quantity=-100)  # sell
    fills = sim.fill([signal], next_bars={"NVDA": _bar(100.0)}, asof=date(2024, 1, 2))
    assert fills[0].price == Decimal("99.99")        # 100 − 1bps


def test_portfolio_apply_fill_updates_position_and_cash():
    p = Portfolio(Decimal("100000"))
    p.apply_fill(type("F", (), {
        "symbol": "NVDA", "asof": date(2024, 1, 1), "quantity": 100,
        "price": Decimal("200"), "commission": Decimal("0.50"),
    })())
    assert p.cash == Decimal("79999.50")             # 100k − 100*200 − 0.50
    snap = p.positions_snapshot()
    assert len(snap) == 1
    assert snap[0].symbol == "NVDA"
    assert snap[0].quantity == 100


def test_portfolio_closing_position_realizes_pnl():
    p = Portfolio(Decimal("100000"))

    class F:
        def __init__(self, qty, price):
            self.symbol = "NVDA"
            self.asof = date(2024, 1, 1)
            self.quantity = qty
            self.price = Decimal(str(price))
            self.commission = Decimal("0")
            self.signal_tag = ""

    p.apply_fill(F(100, 200))                        # buy 100 @ 200
    p.apply_fill(F(-100, 210))                       # sell 100 @ 210 → +1000 PnL
    assert p.cash == Decimal("101000")
    assert len(p.positions_snapshot()) == 0
    closed = p.closed_trades()
    assert len(closed) == 1
    assert closed[0].pnl == Decimal("1000")
