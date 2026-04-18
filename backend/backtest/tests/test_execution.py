"""Tests for backend.backtest.execution and costs."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from backtest.costs import DefaultCostModel
from backtest.execution import ExecutionSimulator
from backtest.types import (
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


# ---------------------------------------------------------------------------
# Multi-leg option fills
# ---------------------------------------------------------------------------


class FakeOptionsProvider:
    """Minimal in-memory OptionsProvider for testing multi-leg fills.

    ``contract_prices`` maps (contract_id, date) -> close. ``chain`` is an
    optional DataFrame with bid/ask for spread slippage modelling.
    """

    def __init__(
        self,
        contract_prices: dict,
        *,
        chain_df=None,
    ) -> None:
        self._prices = contract_prices
        self._chain_df = chain_df

    def contract_bars(self, contract, start, end, tf="1D"):
        import pandas as pd
        d = start.date() if hasattr(start, "date") else start
        key = (contract, d)
        if key not in self._prices:
            return pd.DataFrame(columns=["contract", "ts", "close"])
        return pd.DataFrame(
            [{"contract": contract, "ts": pd.Timestamp(d), "close": self._prices[key]}]
        )

    def chain_snapshot(self, underlying, asof):
        import pandas as pd
        if self._chain_df is None:
            return pd.DataFrame()
        return self._chain_df


def test_multileg_short_strangle_fills_with_real_leg_prices():
    """A short strangle (sell call + sell put) fills at the real per-leg
    premiums from the options provider, producing a credit on Fill.price
    that matches call_mid + put_mid and per-leg prices in leg_prices.
    """

    from datetime import date

    asof = date(2024, 1, 2)
    cc_id = "O:SPY240119C00475000"
    pc_id = "O:SPY240119P00475000"
    provider = FakeOptionsProvider(
        contract_prices={
            (cc_id, asof): 3.20,  # call mid
            (pc_id, asof): 2.80,  # put mid
        }
    )
    sim = ExecutionSimulator(
        DefaultCostModel(default_spread_pct=Decimal("0")),
        options_provider=provider,
        default_options_spread_pct=Decimal("0"),  # no slippage for cleanliness
    )
    bar = _bar("SPY", "475", "476", "474", "475.10", ts=datetime(2024, 1, 2))
    legs = (
        OptionLeg(
            contract_id=cc_id,
            side=Side.SELL,
            qty=1,
            underlying="SPY",
            expiry=date(2024, 1, 19),
            strike=Decimal("475"),
            right="C",
        ),
        OptionLeg(
            contract_id=pc_id,
            side=Side.SELL,
            qty=1,
            underlying="SPY",
            expiry=date(2024, 1, 19),
            strike=Decimal("475"),
            right="P",
        ),
    )
    sig = Signal(
        symbol="SPY",
        quantity=-1,  # short 1 strangle
        legs=legs,
        order_type=OrderType.MOC,
        time_in_force=TimeInForce.DAY,
    )
    sim.queue(sig, staged_on=bar.ts, side=Side.SELL, quantity=1)
    fills = sim.fill_bar(bar)
    assert len(fills) == 1
    f = fills[0]
    # Fill.price is the absolute net per-spread premium.
    assert f.price == Decimal("6.00")  # 3.20 + 2.80
    assert f.legs == legs
    assert f.leg_prices == (Decimal("3.20"), Decimal("2.80"))
    assert f.side is Side.SELL
    # Not priced off the underlying's 475.10 close.
    assert f.price != bar.close


def test_multileg_fill_routes_around_underlying_bar_close():
    """The bug this change fixes: without options_provider the simulator
    would price a multi-leg Signal at bar.close. With the provider wired,
    Fill.price equals the sum of real per-leg premiums, not bar.close.
    """

    from datetime import date

    asof = date(2024, 1, 2)
    cc_id = "O:AAPL240119C00180000"
    pc_id = "O:AAPL240119P00180000"
    provider = FakeOptionsProvider(
        contract_prices={
            (cc_id, asof): 1.50,
            (pc_id, asof): 1.20,
        }
    )
    sim = ExecutionSimulator(
        DefaultCostModel(default_spread_pct=Decimal("0")),
        options_provider=provider,
        default_options_spread_pct=Decimal("0"),
    )
    # Underlying closes at 182 — if the old bug were still present, Fill.price
    # would come out to 182.
    bar = _bar("AAPL", "180", "183", "179", "182", ts=datetime(2024, 1, 2))
    legs = (
        OptionLeg(
            contract_id=cc_id,
            side=Side.BUY,
            qty=1,
            underlying="AAPL",
            expiry=date(2024, 1, 19),
            strike=Decimal("180"),
            right="C",
        ),
        OptionLeg(
            contract_id=pc_id,
            side=Side.BUY,
            qty=1,
            underlying="AAPL",
            expiry=date(2024, 1, 19),
            strike=Decimal("180"),
            right="P",
        ),
    )
    sig = Signal(
        symbol="AAPL",
        quantity=1,  # long 1 straddle
        legs=legs,
        order_type=OrderType.MOC,
        time_in_force=TimeInForce.DAY,
    )
    sim.queue(sig, staged_on=bar.ts, side=Side.BUY, quantity=1)
    fills = sim.fill_bar(bar)
    assert len(fills) == 1
    f = fills[0]
    # 1.50 + 1.20 = 2.70, NOT 182
    assert f.price == Decimal("2.70")
    assert f.price < bar.close / 10  # sanity: the real mid is <10% of bar close


def test_multileg_fill_uses_bs_fallback_when_provider_empty():
    """When the options provider has no contract bar, the simulator uses
    the caller-supplied BS fallback."""

    from datetime import date

    provider = FakeOptionsProvider(contract_prices={})  # empty

    def bs_fallback(leg, underlying_px, asof):
        # Deterministic fallback that the test can assert against.
        return Decimal("1.75")

    sim = ExecutionSimulator(
        DefaultCostModel(default_spread_pct=Decimal("0")),
        options_provider=provider,
        default_options_spread_pct=Decimal("0"),
        options_bs_fallback=bs_fallback,
    )
    bar = _bar("SPY", "475", "476", "474", "475", ts=datetime(2024, 1, 2))
    leg = OptionLeg(
        contract_id="O:SPY240119C00475000",
        side=Side.BUY,
        qty=1,
        underlying="SPY",
        expiry=date(2024, 1, 19),
        strike=Decimal("475"),
        right="C",
    )
    sig = Signal(
        symbol="SPY",
        quantity=1,
        legs=(leg,),
        order_type=OrderType.MOC,
        time_in_force=TimeInForce.DAY,
    )
    sim.queue(sig, staged_on=bar.ts, side=Side.BUY, quantity=1)
    fills = sim.fill_bar(bar)
    assert len(fills) == 1
    assert fills[0].price == Decimal("1.75")


def test_multileg_fill_without_provider_falls_back_with_warning(caplog):
    """Without an options_provider the simulator logs a warning and
    preserves the legacy (wrong) behaviour of pricing at bar.close."""

    sim = ExecutionSimulator(
        DefaultCostModel(default_spread_pct=Decimal("0")),
        # NO options_provider wired.
    )
    bar = _bar("SPY", "475", "476", "474", "475", ts=datetime(2024, 1, 2))
    legs = (
        OptionLeg(
            contract_id="C1", side=Side.SELL, qty=1, underlying="SPY"
        ),
        OptionLeg(
            contract_id="P1", side=Side.SELL, qty=1, underlying="SPY"
        ),
    )
    sig = Signal(
        symbol="SPY",
        quantity=-1,
        legs=legs,
        order_type=OrderType.MOC,
        time_in_force=TimeInForce.DAY,
    )
    sim.queue(sig, staged_on=bar.ts, side=Side.SELL, quantity=1)
    import logging
    with caplog.at_level(logging.WARNING, logger="alphadesk.backtest.execution"):
        fills = sim.fill_bar(bar)
    assert len(fills) == 1
    assert fills[0].price == Decimal("475")  # legacy: bar.close
    assert any("options_provider" in rec.message for rec in caplog.records)


def test_multileg_fill_slippage_widens_buy_narrows_sell():
    """Buyer pays mid + half-spread; seller gets mid - half-spread.

    Slippage tracks the *leg's* own side — a BUY leg always widens up, a
    SELL leg always widens down, regardless of the parent signal's
    direction. Parent side is a routing hint; leg side is the execution.
    """

    from datetime import date

    asof = date(2024, 1, 2)
    cid = "O:SPY240119C00475000"
    provider = FakeOptionsProvider(contract_prices={(cid, asof): 5.00})
    # 10% spread → half-spread = 5%. Buy @ 5.00 * 1.05 = 5.25
    # Sell @ 5.00 * 0.95 = 4.75.
    sim = ExecutionSimulator(
        DefaultCostModel(default_spread_pct=Decimal("0")),
        options_provider=provider,
        default_options_spread_pct=Decimal("0.10"),
    )
    bar = _bar("SPY", "475", "476", "474", "475", ts=datetime(2024, 1, 2))
    buy_leg = OptionLeg(
        contract_id=cid, side=Side.BUY, qty=1, underlying="SPY",
        expiry=date(2024, 1, 19), strike=Decimal("475"), right="C",
    )
    sig = Signal(
        symbol="SPY", quantity=1, legs=(buy_leg,),
        order_type=OrderType.MOC, time_in_force=TimeInForce.DAY,
    )
    sim.queue(sig, staged_on=bar.ts, side=Side.BUY, quantity=1)
    f = sim.fill_bar(bar)[0]
    # BUY leg: mid + half-spread = 5.00 + 0.25 = 5.25
    assert f.leg_prices[0] == Decimal("5.25")

    # SELL leg case.
    sim2 = ExecutionSimulator(
        DefaultCostModel(default_spread_pct=Decimal("0")),
        options_provider=provider,
        default_options_spread_pct=Decimal("0.10"),
    )
    sell_leg = OptionLeg(
        contract_id=cid, side=Side.SELL, qty=1, underlying="SPY",
        expiry=date(2024, 1, 19), strike=Decimal("475"), right="C",
    )
    sig_s = Signal(
        symbol="SPY", quantity=-1, legs=(sell_leg,),
        order_type=OrderType.MOC, time_in_force=TimeInForce.DAY,
    )
    sim2.queue(sig_s, staged_on=bar.ts, side=Side.SELL, quantity=1)
    fs = sim2.fill_bar(bar)[0]
    # SELL leg: mid - half-spread = 5.00 - 0.25 = 4.75
    assert fs.leg_prices[0] == Decimal("4.75")


def test_multileg_fill_respects_limit_price():
    """A net LMT price caps what we'll pay / accept; out-of-band signals
    do not fill."""

    from datetime import date

    asof = date(2024, 1, 2)
    c1 = "O:SPY240119C00475000"
    p1 = "O:SPY240119P00475000"
    # Net credit = 3 + 2 = 5.
    provider = FakeOptionsProvider(
        contract_prices={(c1, asof): 3.00, (p1, asof): 2.00}
    )
    sim = ExecutionSimulator(
        DefaultCostModel(default_spread_pct=Decimal("0")),
        options_provider=provider,
        default_options_spread_pct=Decimal("0"),
    )
    bar = _bar("SPY", "475", "476", "474", "475", ts=datetime(2024, 1, 2))
    legs = (
        OptionLeg(
            contract_id=c1, side=Side.SELL, qty=1, underlying="SPY",
            expiry=date(2024, 1, 19), strike=Decimal("475"), right="C",
        ),
        OptionLeg(
            contract_id=p1, side=Side.SELL, qty=1, underlying="SPY",
            expiry=date(2024, 1, 19), strike=Decimal("475"), right="P",
        ),
    )
    # Ask for a credit of at least 6 (we'll only get 5 → reject).
    sig = Signal(
        symbol="SPY", quantity=-1, legs=legs,
        order_type=OrderType.MOC, time_in_force=TimeInForce.DAY,
        limit_price=Decimal("6"),
    )
    sim.queue(sig, staged_on=bar.ts, side=Side.SELL, quantity=1)
    assert sim.fill_bar(bar) == []
    # With limit at 5 we fill.
    sig2 = Signal(
        symbol="SPY", quantity=-1, legs=legs,
        order_type=OrderType.MOC, time_in_force=TimeInForce.DAY,
        limit_price=Decimal("5"),
    )
    sim.queue(sig2, staged_on=bar.ts, side=Side.SELL, quantity=1)
    fills = sim.fill_bar(bar)
    assert len(fills) == 1
    assert fills[0].price == Decimal("5")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
