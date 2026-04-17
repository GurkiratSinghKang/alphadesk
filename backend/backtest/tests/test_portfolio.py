"""Tests for backend.backtest.portfolio."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from backend.backtest.portfolio import Portfolio
from backend.backtest.types import (
    AssetClass,
    Fill,
    OptionLeg,
    Side,
)


def _fill(
    symbol: str,
    side: Side,
    qty: int,
    price: str,
    commission: str = "0",
    slippage: str = "0",
    ts: datetime | None = None,
    legs: tuple[OptionLeg, ...] = (),
) -> Fill:
    return Fill(
        symbol=symbol,
        ts=ts or datetime(2024, 1, 2),
        side=side,
        quantity=qty,
        price=Decimal(price),
        commission=Decimal(commission),
        slippage=Decimal(slippage),
        legs=legs,
    )


def test_initial_state():
    p = Portfolio(starting_cash=Decimal("100000"))
    assert p.cash == Decimal("100000")
    assert p.current_equity() == Decimal("100000")
    assert p.positions == []
    assert p.realized_pnl == Decimal("0")


def test_single_buy_creates_position_and_debits_cash():
    p = Portfolio(starting_cash=Decimal("100000"))
    p.apply_fill(_fill("AAPL", Side.BUY, 100, "150"))
    pos = p.get_position("AAPL")
    assert pos is not None
    assert pos.quantity == 100
    assert pos.avg_price == Decimal("150")
    assert p.cash == Decimal("85000")  # 100000 - 100 * 150
    assert p.current_equity({"AAPL": Decimal("150")}) == Decimal("100000")


def test_weighted_avg_price_over_multiple_buys():
    p = Portfolio(starting_cash=Decimal("100000"))
    p.apply_fill(_fill("AAPL", Side.BUY, 100, "150"))
    p.apply_fill(_fill("AAPL", Side.BUY, 100, "160"))
    pos = p.get_position("AAPL")
    assert pos.quantity == 200
    assert pos.avg_price == Decimal("155")


def test_realized_pnl_on_partial_close():
    p = Portfolio(starting_cash=Decimal("100000"))
    p.apply_fill(_fill("AAPL", Side.BUY, 100, "150"))
    p.apply_fill(_fill("AAPL", Side.SELL, 50, "160"))
    pos = p.get_position("AAPL")
    assert pos.quantity == 50
    # 50 shares realized at (160 - 150) = 500
    assert p.realized_pnl == Decimal("500")
    assert len(p.trades) == 1
    assert p.trades[0].pnl == Decimal("500")
    # Cash: 100000 - 15000 + 50*160 = 100000 - 15000 + 8000 = 93000
    assert p.cash == Decimal("93000")


def test_short_position_realized_pnl():
    p = Portfolio(starting_cash=Decimal("100000"))
    p.apply_fill(_fill("AAPL", Side.SELL, 50, "200"))
    pos = p.get_position("AAPL")
    assert pos.quantity == -50
    assert pos.avg_price == Decimal("200")
    # Cover at 180: profit = 50 * (200 - 180) = 1000
    p.apply_fill(_fill("AAPL", Side.BUY, 50, "180"))
    assert p.realized_pnl == Decimal("1000")
    assert p.get_position("AAPL") is None  # flat, removed


def test_flip_long_to_short():
    p = Portfolio(starting_cash=Decimal("100000"))
    p.apply_fill(_fill("AAPL", Side.BUY, 100, "150"))
    p.apply_fill(_fill("AAPL", Side.SELL, 150, "160"))
    # Closed 100 long at 160 vs 150 -> +1000
    # Residual: -50 at 160
    pos = p.get_position("AAPL")
    assert pos is not None
    assert pos.quantity == -50
    assert pos.avg_price == Decimal("160")
    assert p.realized_pnl == Decimal("1000")


def test_unrealized_and_equity_with_mark():
    p = Portfolio(starting_cash=Decimal("100000"))
    p.apply_fill(_fill("AAPL", Side.BUY, 100, "150"))
    prices = {"AAPL": Decimal("175")}
    p.mark_to_market(prices)
    assert p.unrealized_pnl(prices) == Decimal("2500")
    assert p.current_equity(prices) == Decimal("102500")


def test_commission_and_slippage_reduce_cash():
    p = Portfolio(starting_cash=Decimal("100000"))
    p.apply_fill(
        _fill("AAPL", Side.BUY, 100, "150", commission="1", slippage="5")
    )
    assert p.cash == Decimal("84994")  # 100000 - 15000 - 1 - 5


def test_splits_adjust_quantity_and_avg_price():
    p = Portfolio(starting_cash=Decimal("100000"))
    p.apply_fill(_fill("AAPL", Side.BUY, 100, "200"))
    p.apply_splits({"AAPL": Decimal("2")})  # 2:1 forward split
    pos = p.get_position("AAPL")
    assert pos.quantity == 200
    assert pos.avg_price == Decimal("100")


def test_dividends_credit_long_debit_short():
    p = Portfolio(starting_cash=Decimal("100000"))
    p.apply_fill(_fill("AAPL", Side.BUY, 100, "150"))
    p.apply_fill(_fill("MSFT", Side.SELL, 50, "300"))
    # $1 dividend on both names.
    p.apply_dividends({"AAPL": Decimal("1"), "MSFT": Decimal("1")})
    # Long receives +100, short pays -50, net +50.
    # Starting cash: 100000 - 15000 + 15000 = 100000 (short sale credits cash)
    # Plus dividends: 100050.
    assert p.cash == Decimal("100050")


def test_borrow_cost_charges_shorts_only():
    p = Portfolio(starting_cash=Decimal("100000"))
    p.borrow_rate = Decimal("0.10")  # 10% annualised for an easier number
    p.apply_fill(_fill("AAPL", Side.SELL, 100, "100"))  # short, notional 10k
    cash_before = p.cash
    charge = p.accrue_borrow_cost(datetime(2024, 1, 2))
    # 10k * 0.10 / 365 = 2.7397...
    expected = Decimal("10000") * Decimal("0.10") / Decimal("365")
    assert charge == expected
    assert p.cash == cash_before - expected


def test_multi_leg_option_fill_creates_multileg_position():
    p = Portfolio(starting_cash=Decimal("100000"))
    legs = (
        OptionLeg(contract_id="C1", side=Side.BUY, qty=1, underlying="SPY"),
        OptionLeg(contract_id="P1", side=Side.SELL, qty=1, underlying="SPY"),
    )
    f = Fill(
        symbol="SPY_COMBO",
        ts=datetime(2024, 1, 2),
        side=Side.BUY,
        quantity=10,
        price=Decimal("2.50"),
        legs=legs,
    )
    p.apply_fill(f)
    pos = p.get_position("SPY_COMBO")
    assert pos is not None
    assert pos.asset_class is AssetClass.MULTILEG
    assert pos.quantity == 10
    assert pos.avg_price == Decimal("2.50")
    # Cash: 100000 - 10 * 2.50 = 99975
    assert p.cash == Decimal("99975")


def test_snapshot_keys():
    p = Portfolio(starting_cash=Decimal("100000"))
    p.apply_fill(_fill("AAPL", Side.BUY, 10, "100"))
    snap = p.snapshot({"AAPL": Decimal("110")})
    assert set(snap.keys()) >= {
        "cash",
        "positions_value",
        "equity",
        "realized_pnl",
        "unrealized_pnl",
    }
    assert snap["equity"] == Decimal("100100")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
