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


def test_fill_simulator_multileg_skips_when_no_options_provider(caplog):
    """Plan B.1: multi-leg signal with no options_provider is skipped + logged.

    Pre-B.1, multi-leg signals slipped through the symbol lookup and emitted
    nothing silently. Now they're recognized and either dispatched (when an
    options_provider is wired) or skipped with a structured warning so
    operators see the gap.
    """
    import logging
    from strategies._core.contracts import OptionLeg

    cfg = BacktestConfig(start=date(2024, 1, 1), end=date(2024, 12, 31),
                         options_provider=None)
    sim = FillSimulator(cfg)
    # Reset class-level warn flag so this test isn't order-sensitive
    FillSimulator._multileg_warned = False
    leg = OptionLeg(
        occ_symbol="SPY240301C00500000",
        side="buy",
        quantity=1,
    )
    signal = Signal(
        symbol="SPY",
        asof=date(2024, 1, 1),
        order_type=OrderType.MKT,
        quantity=1,
        legs=[leg],
    )
    with caplog.at_level(logging.WARNING, logger="alphadesk.strategies._core.fills"):
        fills = sim.fill([signal], next_bars={}, asof=date(2024, 1, 2))
    assert fills == []  # no fill emitted
    assert any("multi-leg" in r.message.lower() for r in caplog.records)


def test_fill_simulator_multileg_native_short_strangle():
    """Plan B.1 full port: native pricer correctly computes net credit on a short strangle.

    Sell 1× call @ mid 2.50, sell 1× put @ mid 1.80 → both legs receive
    bid (mid - half_spread). At slippage_bps=10, half_spread = 5 bps =
    0.0005 of mid. Per-leg sells get mid × (1 - 0.0005). Net credit is
    sum of per-leg prices.
    """
    from strategies._core.contracts import OptionLeg

    class _StubOptionsProvider:
        """Returns hardcoded mids per OCC symbol."""

        def __init__(self, mids: dict[str, float]):
            self._mids = mids

        def contract_bars(self, contract: str, start, end, tf: str = "1D"):
            mid = self._mids.get(contract)
            if mid is None:
                return pd.DataFrame()
            return pd.DataFrame({
                "close": [mid],
                "open": [mid], "high": [mid], "low": [mid],
                "volume": [10],
            })

    provider = _StubOptionsProvider({
        "SPY240301C00500000": 2.50,
        "SPY240301P00450000": 1.80,
    })
    cfg = BacktestConfig(
        start=date(2024, 1, 1),
        end=date(2024, 12, 31),
        slippage_bps=10.0,
        options_provider=provider,
    )
    sim = FillSimulator(cfg)
    legs = [
        OptionLeg(occ_symbol="SPY240301C00500000", side="sell", quantity=1),
        OptionLeg(occ_symbol="SPY240301P00450000", side="sell", quantity=1),
    ]
    signal = Signal(
        symbol="SPY",
        asof=date(2024, 1, 1),
        order_type=OrderType.MKT,
        quantity=-1,  # negative = short the spread
        legs=legs,
    )
    fills = sim.fill([signal], next_bars={}, asof=date(2024, 1, 2))
    assert len(fills) == 1
    f = fills[0]
    assert f.symbol == "SPY"
    assert f.quantity == -1
    # Net credit = (2.50 × 0.9995) + (1.80 × 0.9995) = ~4.298
    # The exact value depends on Decimal arithmetic; check ranges.
    assert Decimal("4.29") <= f.price <= Decimal("4.30")
    # Commission = |qty=1| × n_legs=2 × commission_per_share=0.005 = 0.01
    assert f.commission == Decimal("0.01")


def test_fill_simulator_multileg_native_returns_none_when_leg_unpriced():
    """If any leg has no bar at asof, the entire spread fill aborts."""
    from strategies._core.contracts import OptionLeg

    class _PartialProvider:
        def contract_bars(self, contract: str, start, end, tf: str = "1D"):
            if contract == "SPY240301C00500000":
                return pd.DataFrame({
                    "close": [2.50], "open": [2.50],
                    "high": [2.50], "low": [2.50], "volume": [10],
                })
            return pd.DataFrame()  # the put leg has no bar

    cfg = BacktestConfig(
        start=date(2024, 1, 1),
        end=date(2024, 12, 31),
        slippage_bps=1.0,
        options_provider=_PartialProvider(),
    )
    sim = FillSimulator(cfg)
    legs = [
        OptionLeg(occ_symbol="SPY240301C00500000", side="sell", quantity=1),
        OptionLeg(occ_symbol="SPY240301P00450000", side="sell", quantity=1),
    ]
    signal = Signal(
        symbol="SPY", asof=date(2024, 1, 1),
        order_type=OrderType.MKT, quantity=-1, legs=legs,
    )
    fills = sim.fill([signal], next_bars={}, asof=date(2024, 1, 2))
    assert fills == []


def test_fill_simulator_multileg_native_limit_price_gate():
    """Buy spread: net debit > limit → no fill emitted."""
    from strategies._core.contracts import OptionLeg

    class _Stub:
        def contract_bars(self, contract: str, start, end, tf: str = "1D"):
            mids = {"AAPL240301C00190000": 5.00, "AAPL240301C00200000": 2.00}
            mid = mids.get(contract)
            if mid is None:
                return pd.DataFrame()
            return pd.DataFrame({
                "close": [mid], "open": [mid],
                "high": [mid], "low": [mid], "volume": [10],
            })

    cfg = BacktestConfig(
        start=date(2024, 1, 1), end=date(2024, 12, 31),
        slippage_bps=1.0,
        options_provider=_Stub(),
    )
    sim = FillSimulator(cfg)
    legs = [
        OptionLeg(occ_symbol="AAPL240301C00190000", side="buy", quantity=1),
        OptionLeg(occ_symbol="AAPL240301C00200000", side="sell", quantity=1),
    ]
    # Net debit ≈ 5.00 − 2.00 = 3.00. Limit at 2.50 → reject.
    signal = Signal(
        symbol="AAPL", asof=date(2024, 1, 1),
        order_type=OrderType.LMT, quantity=1, limit_price=2.50, legs=legs,
    )
    fills = sim.fill([signal], next_bars={}, asof=date(2024, 1, 2))
    assert fills == []


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
