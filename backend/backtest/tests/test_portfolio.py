"""Tests for backend.backtest.portfolio."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from backtest.portfolio import Portfolio
from backtest.types import (
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


def test_multi_leg_option_fill_creates_leg_positions():
    """A multi-leg fill should book each leg as its own OPTION Position
    keyed by contract_id (rather than a single composite Position).
    """

    p = Portfolio(starting_cash=Decimal("100000"))
    legs = (
        OptionLeg(contract_id="C1", side=Side.BUY, qty=1, underlying="SPY"),
        OptionLeg(contract_id="P1", side=Side.SELL, qty=1, underlying="SPY"),
    )
    # Per-leg prices: long call @ 3.00, short put @ 0.50 → net premium PAID
    # per spread = 3.00 - 0.50 = 2.50 (matches the legacy single-price
    # composite test). Cash flow: 10 spreads × (−3.00 call + 0.50 put)
    # × 100 multiplier = 10 × −2.50 × 100 = −2500 (we pay $2500).
    f = Fill(
        symbol="SPY_COMBO",
        ts=datetime(2024, 1, 2),
        side=Side.BUY,
        quantity=10,
        price=Decimal("2.50"),
        legs=legs,
        leg_prices=(Decimal("3.00"), Decimal("0.50")),
    )
    p.apply_fill(f)
    # Each leg becomes its own Position.
    call_pos = p.get_position("C1")
    put_pos = p.get_position("P1")
    assert call_pos is not None and put_pos is not None
    assert call_pos.asset_class is AssetClass.OPTION
    assert put_pos.asset_class is AssetClass.OPTION
    # Bought 10 contracts of the call (10 spreads * 1 contract/spread).
    assert call_pos.quantity == 10
    assert call_pos.avg_price == Decimal("3.00")
    assert call_pos.multiplier == 100
    # Shorted 10 contracts of the put.
    assert put_pos.quantity == -10
    assert put_pos.avg_price == Decimal("0.50")
    # Cash: 100000 - 10 * 100 * 3.00 + 10 * 100 * 0.50 = 100000 - 3000 + 500 = 97500
    assert p.cash == Decimal("97500")


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


def test_short_strangle_lifecycle_open_mtm_close():
    """Open a 2-leg short strangle, mark to market with changing leg
    prices, then close it at a profit."""

    p = Portfolio(starting_cash=Decimal("100000"))
    c_id = "O:SPY240119C00480000"
    p_id = "O:SPY240119P00470000"
    open_legs = (
        OptionLeg(
            contract_id=c_id, side=Side.SELL, qty=1, underlying="SPY",
            multiplier=100,
        ),
        OptionLeg(
            contract_id=p_id, side=Side.SELL, qty=1, underlying="SPY",
            multiplier=100,
        ),
    )
    # Enter: sell 1 strangle for 3.00 + 2.50 = 5.50 credit.
    open_fill = Fill(
        symbol="SPY",
        ts=datetime(2024, 1, 2),
        side=Side.SELL,
        quantity=1,  # 1 spread
        price=Decimal("5.50"),
        legs=open_legs,
        leg_prices=(Decimal("3.00"), Decimal("2.50")),
    )
    p.apply_fill(open_fill)
    # Cash: 100000 + 300 + 250 = 100550 (we received credit)
    assert p.cash == Decimal("100550")
    # Two leg Positions.
    call_pos = p.get_position(c_id)
    put_pos = p.get_position(p_id)
    assert call_pos.quantity == -1 and call_pos.asset_class is AssetClass.OPTION
    assert put_pos.quantity == -1 and put_pos.asset_class is AssetClass.OPTION
    assert call_pos.avg_price == Decimal("3.00")
    assert put_pos.avg_price == Decimal("2.50")

    # Mark-to-market: IV crushes, legs now worth 1.00 and 0.80 each.
    prices = {c_id: Decimal("1.00"), p_id: Decimal("0.80")}
    p.mark_to_market(prices)
    # Unrealized P&L: short 1 call from 3.00 → now 1.00 = +2.00 * 100 = +200
    #                 short 1 put from 2.50 → now 0.80 = +1.70 * 100 = +170
    # Total +370.
    assert p.unrealized_pnl(prices) == Decimal("370")
    # Equity = cash + positions_value. Position values:
    # call: -1 * 1.00 * 100 = -100; put: -1 * 0.80 * 100 = -80 → -180
    # Equity = 100550 + (-180) = 100370 → +370 from start ✓
    eq = p.current_equity(prices)
    assert eq == Decimal("100370")

    # Close: buy back both legs (flipped to BUY as the strategy would
    # emit them on exit).
    close_legs = (
        OptionLeg(
            contract_id=c_id, side=Side.BUY, qty=1, underlying="SPY",
            multiplier=100,
        ),
        OptionLeg(
            contract_id=p_id, side=Side.BUY, qty=1, underlying="SPY",
            multiplier=100,
        ),
    )
    close_fill = Fill(
        symbol="SPY",
        ts=datetime(2024, 1, 9),
        side=Side.BUY,
        quantity=1,
        price=Decimal("1.80"),
        legs=close_legs,
        leg_prices=(Decimal("1.00"), Decimal("0.80")),
    )
    p.apply_fill(close_fill)
    # After close both leg positions flatten.
    assert p.get_position(c_id) is None
    assert p.get_position(p_id) is None
    # Realized P&L = 370 (same as MTM at close).
    assert p.realized_pnl == Decimal("370")
    # Cash: 100550 - 100 - 80 = 100370
    assert p.cash == Decimal("100370")
    # Two round-trip Trade records (one per leg).
    assert len(p.trades) == 2


def test_option_position_mtm_uses_multiplier():
    """An OPTION leg Position marks to market using ``quantity * price *
    multiplier`` — critical for correct equity calculation."""

    p = Portfolio(starting_cash=Decimal("100000"))
    leg = (
        OptionLeg(contract_id="O:X", side=Side.BUY, qty=1,
                  underlying="X", multiplier=100),
    )
    fill = Fill(
        symbol="X",
        ts=datetime(2024, 1, 2),
        side=Side.BUY,
        quantity=5,  # 5 contracts
        price=Decimal("2.00"),
        legs=leg,
        leg_prices=(Decimal("2.00"),),
    )
    p.apply_fill(fill)
    # We paid 5 * 1 * 2.00 * 100 = $1000 of cash.
    assert p.cash == Decimal("99000")
    pos = p.get_position("O:X")
    assert pos is not None and pos.quantity == 5
    # If the market re-prices to 3.00 the position value is
    # 5 * 3.00 * 100 = $1500, not 5 * 3.00 = $15.
    assert pos.market_value(Decimal("3.00")) == Decimal("1500")
    assert pos.unrealized_pnl(Decimal("3.00")) == Decimal("500")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
