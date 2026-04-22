# backend/strategies/_core/fills.py
"""Fill simulation + portfolio ledger for BacktestRunner.

Kept simple: fills at next-bar open (or close, or midpoint) with a
slippage_bps adjustment and a flat per-share commission. Matches the
behavior of the legacy engine.py within the tolerance specified in the
spec's parity-test acceptance criteria.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable

import pandas as pd

from strategies._core.contracts import (
    BacktestConfig,
    Fill,
    Position,
    Signal,
    Trade,
)


class FillSimulator:
    """Converts Signals into Fills using a configurable fill model + slippage.

    The caller (BacktestRunner) is responsible for supplying the "next bar"
    data for each signal's symbol; the simulator picks the reference price
    from that bar per config.fill_model.
    """

    def __init__(self, config: BacktestConfig):
        self._config = config

    def fill(
        self,
        signals: Iterable[Signal],
        next_bars: dict[str, pd.Series],
        asof: date,
    ) -> list[Fill]:
        """Convert signals to fills. `next_bars` maps symbol → next bar's OHLCV row."""
        fills: list[Fill] = []
        for s in signals:
            if s.quantity is None:
                # target_weight path: caller should have translated; skip here
                continue
            bar = next_bars.get(s.symbol)
            if bar is None:
                continue  # no fill — symbol not in next-bar universe

            ref_price = self._reference_price(bar)
            slip = ref_price * Decimal(str(self._config.slippage_bps / 10_000))
            # Buy side slips up, sell side slips down (adverse selection)
            fill_price = ref_price + slip if s.quantity > 0 else ref_price - slip
            commission = Decimal(abs(s.quantity)) * self._config.commission_per_share

            fills.append(Fill(
                symbol=s.symbol, asof=asof, quantity=s.quantity,
                price=fill_price.quantize(Decimal("0.01")),
                commission=commission.quantize(Decimal("0.01")),
                signal_tag=s.tag,
            ))
        return fills

    def _reference_price(self, bar: pd.Series) -> Decimal:
        if self._config.fill_model == "next_open":
            return Decimal(str(bar["open"]))
        if self._config.fill_model == "next_close":
            return Decimal(str(bar["close"]))
        # midpoint
        return (Decimal(str(bar["high"])) + Decimal(str(bar["low"]))) / Decimal("2")


class Portfolio:
    """Simple position ledger. Tracks cash, open positions, and closed trades.

    When a fill closes (or partially closes) an existing position, the
    realized PnL is booked into the corresponding Trade record. Opening
    fills add to the position's cumulative quantity with volume-weighted
    average entry price.
    """

    def __init__(self, starting_cash: Decimal):
        self._cash = starting_cash
        self._positions: dict[str, Position] = {}      # keyed by symbol
        self._trades: list[Trade] = []                 # closed round-trips
        self._open_trades: dict[str, Trade] = {}       # opening trade per symbol

    @property
    def cash(self) -> Decimal:
        return self._cash

    @property
    def equity(self) -> Decimal:
        # Simplification: BacktestRunner computes mark-to-market before each bar.
        # At portfolio level, equity = cash + sum(position.qty * avg_entry_price);
        # for MTM use mark_to_market(prices) instead.
        positions_value = sum(
            (p.quantity * p.avg_entry_price for p in self._positions.values()),
            start=Decimal("0"),
        )
        return self._cash + positions_value

    def positions_snapshot(self) -> list[Position]:
        return list(self._positions.values())

    def closed_trades(self) -> list[Trade]:
        return list(self._trades)

    def apply_fill(self, fill: object) -> None:
        self._cash -= Decimal(fill.quantity) * fill.price + fill.commission

        existing = self._positions.get(fill.symbol)
        if existing is None or (existing.quantity > 0) == (fill.quantity > 0):
            # No existing position or same-side add
            new_qty = (existing.quantity if existing else 0) + fill.quantity
            if new_qty == 0:
                self._close_position(fill.symbol, fill)
                return
            # Volume-weighted average entry price
            old_notional = (existing.avg_entry_price * existing.quantity) if existing else Decimal("0")
            new_notional = fill.price * Decimal(fill.quantity)
            avg_price = (old_notional + new_notional) / Decimal(new_qty)
            signal_tag = getattr(fill, "signal_tag", "")
            self._positions[fill.symbol] = Position(
                symbol=fill.symbol, quantity=new_qty,
                avg_entry_price=avg_price,
                entry_date=existing.entry_date if existing else fill.asof,
                tag=existing.tag if existing else signal_tag,
            )
            if fill.symbol not in self._open_trades:
                self._open_trades[fill.symbol] = Trade(
                    symbol=fill.symbol, entry_date=fill.asof,
                    entry_price=fill.price, quantity=new_qty,
                    tag=signal_tag,
                )
        else:
            # Opposite-side: closes or flips position
            if abs(fill.quantity) >= abs(existing.quantity):
                # Closes (and possibly flips)
                self._close_position(fill.symbol, fill)
                remainder = fill.quantity + existing.quantity  # signed
                if remainder != 0:
                    # Flipped: open new position with the remainder
                    signal_tag = getattr(fill, "signal_tag", "")
                    self._positions[fill.symbol] = Position(
                        symbol=fill.symbol, quantity=remainder,
                        avg_entry_price=fill.price, entry_date=fill.asof,
                        tag=signal_tag,
                    )
                    self._open_trades[fill.symbol] = Trade(
                        symbol=fill.symbol, entry_date=fill.asof,
                        entry_price=fill.price, quantity=remainder,
                        tag=signal_tag,
                    )
            else:
                # Partial close
                new_qty = existing.quantity + fill.quantity  # signed, smaller magnitude
                self._positions[fill.symbol] = existing.model_copy(
                    update={"quantity": new_qty}
                )

    def _close_position(self, symbol: str, fill: object) -> None:
        existing = self._positions.pop(symbol, None)
        open_trade = self._open_trades.pop(symbol, None)
        if existing is None or open_trade is None:
            return
        pnl = (fill.price - existing.avg_entry_price) * Decimal(existing.quantity)
        self._trades.append(open_trade.model_copy(update={
            "exit_date": fill.asof,
            "exit_price": fill.price,
            "pnl": pnl,
        }))
