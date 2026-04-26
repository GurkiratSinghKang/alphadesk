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
        """Convert signals to fills. ``next_bars`` maps symbol → next bar's OHLCV row.

        Round-11 / AA-1.2 (P0): the previous version filled every
        signal at ``self._reference_price(bar)`` regardless of
        ``signal.order_type`` / ``signal.limit_price`` — a LMT buy at
        $50 on a gap-up to $55 still "filled" at $55 in the
        backtest, systematically inflating event-day strategy
        backtests. Now branches on ``order_type``:

        * MOO  — fill at next bar's open
        * MOC  — fill at next bar's close
        * MKT  — fill at the configured ``fill_model`` reference
        * LMT  — fill only if the bar's range crosses ``limit_price``;
                 fills at the limit (best-case under no-touch
                 assumption); slippage still applied as a small
                 adverse step inside the limit.
        * STP  — fill if the bar's range crosses ``stop_price``;
                 entry at the stop (also conservative).
        * STP_LMT — combined: stop must trigger AND limit must clear.

        Where a limit can't fill, the signal silently drops for this
        bar — no Fill is emitted and the strategy's intent expires
        (matching the typical real-broker behaviour for a DAY-TIF
        order that didn't print).
        """
        from strategies._core.contracts import OrderType

        fills: list[Fill] = []
        for s in signals:
            if s.quantity is None:
                # target_weight path: caller should have translated; skip here
                continue
            bar = next_bars.get(s.symbol)
            if bar is None:
                continue  # no fill — symbol not in next-bar universe

            ref_price = self._reference_price_for(s, bar)
            if ref_price is None:
                # Limit / stop did not clear on this bar; signal expires.
                continue

            slip = ref_price * Decimal(str(self._config.slippage_bps / 10_000))
            # Buy side slips up, sell side slips down (adverse selection).
            # On LMT/STP_LMT we still apply slippage but cap it so the
            # final fill price never exceeds the user's limit on buys
            # (or undercuts it on sells). That's the worst-case fill
            # under "marketable limit" semantics — the limit order
            # acted as a price ceiling, not just a trigger.
            fill_price = ref_price + slip if s.quantity > 0 else ref_price - slip
            if s.order_type in {OrderType.LMT, OrderType.STP_LMT} and s.limit_price is not None:
                limit = Decimal(str(s.limit_price))
                if s.quantity > 0 and fill_price > limit:
                    fill_price = limit
                elif s.quantity < 0 and fill_price < limit:
                    fill_price = limit

            commission = Decimal(abs(s.quantity)) * self._config.commission_per_share

            fills.append(Fill(
                symbol=s.symbol, asof=asof, quantity=s.quantity,
                price=fill_price.quantize(Decimal("0.01")),
                commission=commission.quantize(Decimal("0.01")),
                signal_tag=s.tag,
            ))
        return fills

    def _reference_price_for(self, s: Signal, bar: pd.Series) -> Decimal | None:
        """Pick the reference fill price for a signal given the next bar.

        Returns ``None`` when an order_type / limit / stop combination
        doesn't trigger on this bar (so the caller skips emitting a
        Fill). Round-11 / AA-1.2.
        """
        from strategies._core.contracts import OrderType

        bar_open = Decimal(str(bar["open"]))
        bar_high = Decimal(str(bar["high"]))
        bar_low = Decimal(str(bar["low"]))
        bar_close = Decimal(str(bar["close"]))

        if s.order_type == OrderType.MOO:
            return bar_open
        if s.order_type == OrderType.MOC:
            return bar_close
        if s.order_type == OrderType.MKT:
            return self._reference_price(bar)

        # Limit-bearing types: check the bar's intraday range.
        if s.order_type in {OrderType.LMT, OrderType.STP, OrderType.STP_LMT}:
            limit = Decimal(str(s.limit_price)) if s.limit_price is not None else None
            stop = Decimal(str(s.stop_price)) if s.stop_price is not None else None

            if s.order_type == OrderType.LMT:
                if limit is None:
                    return None
                # Buy LMT triggers when bar dips at/below limit.
                # Sell LMT triggers when bar rallies at/above limit.
                if s.quantity > 0 and bar_low <= limit:
                    return min(bar_open, limit) if bar_open <= limit else limit
                if s.quantity < 0 and bar_high >= limit:
                    return max(bar_open, limit) if bar_open >= limit else limit
                return None

            if s.order_type == OrderType.STP:
                if stop is None:
                    return None
                if s.quantity > 0 and bar_high >= stop:
                    return max(bar_open, stop) if bar_open >= stop else stop
                if s.quantity < 0 and bar_low <= stop:
                    return min(bar_open, stop) if bar_open <= stop else stop
                return None

            # STP_LMT — stop must trigger AND limit must clear.
            if stop is None or limit is None:
                return None
            if s.quantity > 0:
                if bar_high < stop:
                    return None  # stop never triggered
                # Within the bar after stop trigger, fill at min(post-trigger, limit)
                trigger_price = max(bar_open, stop) if bar_open >= stop else stop
                if trigger_price > limit:
                    return None
                return trigger_price
            else:
                if bar_low > stop:
                    return None
                trigger_price = min(bar_open, stop) if bar_open <= stop else stop
                if trigger_price < limit:
                    return None
                return trigger_price

        # Fallback: configured fill_model for unknown order types.
        return self._reference_price(bar)

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
