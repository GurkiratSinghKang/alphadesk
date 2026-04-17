"""Tests for backend.backtest.execution and costs."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from backend.backtest.costs import DefaultCostModel
from backend.backtest.execution import ExecutionSimulator
from backend.backtest.types import (
    AssetClass,
    Bar,
    OptionLeg,
    OrderType,
    Side,
    Signal,
    TimeInForce,
)


def _bar(
    symbol: str,
    o: str,
    h: str,
    l: str,
    c: str,
    ts: datetime | None = None,
) -> Bar:
    return Bar(
        symbol=symbol,
        ts=ts or datetime(2024, 1, 2),
        open=Decimal(o),
        high=Decimal(h),
        low=Decimal(l),
        close=Decimal(c),
        volume=1_000_000,
    )


def _sim() -> ExecutionSimulator:
    return ExecutionSimulator(DefaultCostModel(default_spread_pct=Decimal("0")))


def _queue_buy(sim, bar, quantity=10, order_type=OrderType.MKT, **kwargs):
    sig = Signal(
        symbol=bar.symbol,
        quantity=quantity,
        order_type=order_type,
        time_in_force=kwargs.pop("tif", TimeInForce.GTC),
        **kwargs,
    )
    sim.queue(sig, staged_on=bar.ts, side=Side.BUY, quantity=quantity)
    return sig


# ---------------------------------------------------------------------------
# Commission / cost model
# ---------------------------------------------------------------------------


def test_equity_commission_is_zero():
    m = DefaultCostModel()
    assert m.commission("AAPL", 100, Decimal("150"), AssetClass.EQUITY, Side.BUY) == Decimal("0")


def test_options_min_ticket_applies():
    m = DefaultCostModel()
    legs = (OptionLeg(contract_id="C1", side=Side.BUY, qty=1),)
    # 1 contract * $0.01 = $0.01 -> bumped to the $0.65 minimum.
    c = m.commission("AAPL", 1, Decimal("2.00"), AssetClass.MULTILEG, Side.BUY, legs=legs)
    assert c == Decimal("0.65")


def test_options_reg_fees_on_sell_are_capped():
    m = DefaultCostModel(
        option_reg_fee_sell_per_contract=Decimal("0.03"),
        option_reg_fee_cap_per_contract=Decimal("1.00"),
    )
    legs = (OptionLeg(contract_id="C1", side=Side.SELL, qty=1),)
    c = m.commission("AAPL", 1, Decimal("2.00"), AssetClass.MULTILEG, Side.SELL, legs=legs)
    # base = max(0.01*1, 0.65) = 0.65, plus reg 0.03*1 = 0.68
    assert c == Decimal("0.68")


def test_slippage_uses_adv_and_spread():
    m = DefaultCostModel(
        impact_coef=Decimal("0.1"),
        default_spread_pct=Decimal("0.001"),
    )
    # 100 * 10 = 1000 notional, adv = 10000 -> impact = 0.1 * 0.1 = 0.01
    # half-spread = 0.0005 -> total = 0.0105 * 1000 = 10.5
    slip = m.slippage("X", 100, Decimal("10"), adv_20d=Decimal("10000"))
    assert slip == Decimal("10.5")


def test_borrow_rate_override():
    m = DefaultCostModel(
        borrow_rate_default=Decimal("0.01"),
        borrow_rate_overrides={"HTB": Decimal("0.2")},
    )
    assert m.borrow_rate("AAPL") == Decimal("0.01")
    assert m.borrow_rate("HTB") == Decimal("0.2")


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------


def test_moo_fills_at_next_bar_open_not_current_bar():
    sim = _sim()
    bar_t = _bar("AAPL", "100", "105", "99", "104", ts=datetime(2024, 1, 2))
    bar_t1 = _bar("AAPL", "106", "108", "105", "107", ts=datetime(2024, 1, 3))
    sig = Signal(
        symbol="AAPL", quantity=10, order_type=OrderType.MOO,
        time_in_force=TimeInForce.GTC,
    )
    sim.queue(sig, staged_on=bar_t.ts, side=Side.BUY, quantity=10)

    # Same-day bar must not fill.
    assert sim.fill_bar(bar_t) == []
    fills = sim.fill_bar(bar_t1)
    assert len(fills) == 1
    assert fills[0].price == Decimal("106")  # next bar open


def test_moc_fills_on_current_bar_close():
    sim = _sim()
    bar = _bar("AAPL", "100", "105", "99", "104")
    sig = Signal(
        symbol="AAPL", quantity=10, order_type=OrderType.MOC,
        time_in_force=TimeInForce.DAY,
    )
    sim.queue(sig, staged_on=bar.ts, side=Side.BUY, quantity=10)
    fills = sim.fill_bar(bar)
    assert len(fills) == 1
    assert fills[0].price == Decimal("104")


def test_lmt_fills_only_when_in_range():
    sim = _sim()
    bar_t = _bar("AAPL", "100", "105", "99", "104", ts=datetime(2024, 1, 2))
    # Tomorrow low is 102 — limit at 103 should fill.
    bar_t1 = _bar("AAPL", "104", "106", "102", "105", ts=datetime(2024, 1, 3))
    sig = Signal(
        symbol="AAPL", quantity=10, order_type=OrderType.LMT,
        limit_price=Decimal("103"), time_in_force=TimeInForce.GTC,
    )
    sim.queue(sig, staged_on=bar_t.ts, side=Side.BUY, quantity=10)

    assert sim.fill_bar(bar_t) == []
    fills = sim.fill_bar(bar_t1)
    assert len(fills) == 1
    # min(limit, open) = min(103, 104) = 103
    assert fills[0].price == Decimal("103")


def test_lmt_does_not_fill_when_out_of_range():
    sim = _sim()
    bar_t = _bar("AAPL", "100", "105", "99", "104", ts=datetime(2024, 1, 2))
    # Tomorrow never touches 90.
    bar_t1 = _bar("AAPL", "104", "106", "100", "105", ts=datetime(2024, 1, 3))
    sig = Signal(
        symbol="AAPL", quantity=10, order_type=OrderType.LMT,
        limit_price=Decimal("90"), time_in_force=TimeInForce.DAY,
    )
    sim.queue(sig, staged_on=bar_t.ts, side=Side.BUY, quantity=10)
    assert sim.fill_bar(bar_t) == []
    assert sim.fill_bar(bar_t1) == []
    # DAY order should have expired.
    assert sim.pending() == []


def test_gtc_lmt_persists_across_bars_until_fill():
    sim = _sim()
    bar_t = _bar("AAPL", "100", "105", "99", "104", ts=datetime(2024, 1, 2))
    bar_t1 = _bar("AAPL", "104", "106", "103", "105", ts=datetime(2024, 1, 3))
    bar_t2 = _bar("AAPL", "104", "106", "101", "105", ts=datetime(2024, 1, 4))
    sig = Signal(
        symbol="AAPL", quantity=10, order_type=OrderType.LMT,
        limit_price=Decimal("102"), time_in_force=TimeInForce.GTC,
    )
    sim.queue(sig, staged_on=bar_t.ts, side=Side.BUY, quantity=10)

    assert sim.fill_bar(bar_t) == []
    assert sim.fill_bar(bar_t1) == []  # low 103 > 102
    fills = sim.fill_bar(bar_t2)
    assert len(fills) == 1
    assert fills[0].price == Decimal("102")


def test_stop_loss_triggers_on_low_crossing():
    sim = _sim()
    bar_t = _bar("AAPL", "100", "105", "99", "104", ts=datetime(2024, 1, 2))
    bar_t1 = _bar("AAPL", "103", "104", "95", "96", ts=datetime(2024, 1, 3))
    sig = Signal(
        symbol="AAPL", quantity=10, order_type=OrderType.STOP,
        stop_price=Decimal("98"), time_in_force=TimeInForce.GTC,
    )
    sim.queue(sig, staged_on=bar_t.ts, side=Side.SELL, quantity=10)
    assert sim.fill_bar(bar_t) == []
    fills = sim.fill_bar(bar_t1)
    assert len(fills) == 1
    assert fills[0].price == Decimal("98")


def test_take_profit_on_long():
    sim = _sim()
    bar_t = _bar("AAPL", "100", "105", "99", "104", ts=datetime(2024, 1, 2))
    bar_t1 = _bar("AAPL", "105", "115", "104", "112", ts=datetime(2024, 1, 3))
    sig = Signal(
        symbol="AAPL", quantity=10, order_type=OrderType.TP,
        take_profit=Decimal("110"), time_in_force=TimeInForce.GTC,
    )
    sim.queue(sig, staged_on=bar_t.ts, side=Side.SELL, quantity=10)
    fills = sim.fill_bar(bar_t1)
    assert len(fills) == 1
    assert fills[0].price == Decimal("110")


def test_commission_is_applied_to_fill():
    cost = DefaultCostModel(
        equity_per_share=Decimal("0.005"),
        default_spread_pct=Decimal("0"),
    )
    sim = ExecutionSimulator(cost)
    bar = _bar("AAPL", "100", "105", "99", "100")
    sig = Signal(
        symbol="AAPL", quantity=200, order_type=OrderType.MOC,
        time_in_force=TimeInForce.DAY,
    )
    sim.queue(sig, staged_on=bar.ts, side=Side.BUY, quantity=200)
    f = sim.fill_bar(bar)[0]
    assert f.commission == Decimal("1.00")  # 200 * 0.005


def test_cancel_removes_pending_orders():
    sim = _sim()
    bar_t = _bar("AAPL", "100", "105", "99", "104")
    sig = Signal(
        symbol="AAPL", quantity=10, order_type=OrderType.LMT,
        limit_price=Decimal("90"), time_in_force=TimeInForce.GTC,
    )
    sim.queue(sig, staged_on=bar_t.ts, side=Side.BUY, quantity=10)
    assert len(sim.pending()) == 1
    n = sim.cancel("AAPL")
    assert n == 1
    assert sim.pending() == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
