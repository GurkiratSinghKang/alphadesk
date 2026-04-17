"""Order-to-fill simulation.

The :class:`ExecutionSimulator` converts :class:`Signal` objects queued by the
strategy on bar T into :class:`Fill` objects on bar T+1 (for MOO / LMT / STOP
/ TP) or on bar T's close (for MOC / MKT). It enforces no-look-ahead by
requiring the engine to stage each signal with the bar on which it was
issued.

Supported order types:

* ``MKT``  -- fills at the bar close on which the order is staged (engine
              behaviour: engines that stage market orders on T fill at T close).
* ``MOO``  -- fills at the open of the next bar.
* ``MOC``  -- fills at the close of the current bar (same-bar execution).
* ``LMT``  -- fills on the next bar iff the bar's range crosses the limit,
              using the limit price itself.
* ``STOP`` -- triggered if the next bar's range crosses the stop; fills at the
              stop price.
* ``TP``   -- same as STOP but for a favourable level.

Time-in-force:

* ``DAY`` -- one-bar life; unfilled after its fill bar is cancelled.
* ``GTC`` -- remains alive until filled or explicitly cancelled.
* ``IOC`` -- same as DAY for our bar-level simulation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Iterable, Mapping, Optional

from backend.backtest.costs import CostModel
from backend.backtest.types import (
    AssetClass,
    Bar,
    Fill,
    OptionLeg,
    OrderType,
    Side,
    Signal,
    TimeInForce,
)


def _d(x) -> Decimal:
    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))


@dataclass
class PendingOrder:
    """An order queued by the strategy, awaiting its eligible execution bar."""

    signal: Signal
    staged_on: datetime
    submitted_on: datetime
    symbol: str
    side: Side
    quantity: int
    order_type: OrderType
    time_in_force: TimeInForce
    limit_price: Optional[Decimal] = None
    stop_price: Optional[Decimal] = None
    take_profit: Optional[Decimal] = None
    legs: tuple[OptionLeg, ...] = field(default_factory=tuple)
    tag: str = ""
    # True once the order has been exposed to at least one fill bar. Used
    # to retire DAY / IOC orders.
    seen_fill_bar: bool = False


class ExecutionSimulator:
    """Convert signals into fills using a single-pass bar model."""

    def __init__(
        self,
        cost_model: CostModel,
        default_spread_pct: Optional[Decimal] = None,
    ) -> None:
        self.cost_model = cost_model
        self.default_spread_pct = (
            _d(default_spread_pct) if default_spread_pct is not None else None
        )
        self._pending: list[PendingOrder] = []

    # ------------------------------------------------------------------
    # Queueing
    # ------------------------------------------------------------------

    def queue(
        self,
        signal: Signal,
        staged_on: datetime,
        side: Side,
        quantity: int,
    ) -> None:
        """Queue a signal for execution on the next eligible bar."""

        if quantity <= 0:
            return

        self._pending.append(
            PendingOrder(
                signal=signal,
                staged_on=staged_on,
                submitted_on=staged_on,
                symbol=signal.symbol,
                side=side,
                quantity=quantity,
                order_type=signal.order_type,
                time_in_force=signal.time_in_force,
                limit_price=signal.limit_price,
                stop_price=signal.stop_price,
                take_profit=signal.take_profit,
                legs=signal.legs,
                tag=signal.tag,
            )
        )

    def cancel(self, symbol: str) -> int:
        """Cancel all pending orders for a symbol. Returns count cancelled."""

        before = len(self._pending)
        self._pending = [p for p in self._pending if p.symbol != symbol]
        return before - len(self._pending)

    def pending(self) -> list[PendingOrder]:
        return list(self._pending)

    # ------------------------------------------------------------------
    # Fill simulation
    # ------------------------------------------------------------------

    def fill_bar(
        self,
        bar: Bar,
        *,
        adv_20d: Optional[Decimal] = None,
        spread_pct: Optional[Decimal] = None,
    ) -> list[Fill]:
        """Run one bar worth of execution for a single symbol.

        Returns the list of fills produced on this bar.

        Called twice per bar-cycle in the engine (once at open for MOO orders,
        once at close for MOC / MKT / bar-contingent orders). The simulator
        does not know about open vs close itself — instead the engine passes
        the same :class:`Bar` with different order types eligible.

        Strategy: iterate ``self._pending``, attempt each order, collect fills,
        drop DAY / IOC orders after their fill bar.
        """

        fills: list[Fill] = []
        survivors: list[PendingOrder] = []

        for order in self._pending:
            if order.symbol != bar.symbol:
                survivors.append(order)
                continue

            # Orders can only fill on bars strictly after they were staged,
            # except MOC / MKT which fill on the staging bar's close.
            if order.order_type in (OrderType.MOC, OrderType.MKT):
                if bar.ts < order.staged_on:
                    survivors.append(order)
                    continue
            else:
                if bar.ts <= order.staged_on:
                    survivors.append(order)
                    continue

            fill = self._try_fill(
                order, bar, adv_20d=adv_20d, spread_pct=spread_pct
            )
            order.seen_fill_bar = True
            if fill is not None:
                fills.append(fill)
                # Filled orders are removed.
                continue

            if order.time_in_force in (TimeInForce.DAY, TimeInForce.IOC):
                # Gone after this bar.
                continue

            # GTC lives on.
            survivors.append(order)

        self._pending = survivors
        return fills

    # ------------------------------------------------------------------
    # Per-order fill rules
    # ------------------------------------------------------------------

    def _try_fill(
        self,
        order: PendingOrder,
        bar: Bar,
        *,
        adv_20d: Optional[Decimal],
        spread_pct: Optional[Decimal],
    ) -> Optional[Fill]:
        ot = order.order_type
        price: Optional[Decimal] = None

        if ot is OrderType.MOO:
            price = bar.open
        elif ot is OrderType.MOC:
            price = bar.close
        elif ot is OrderType.MKT:
            price = bar.close
        elif ot is OrderType.LMT:
            if order.limit_price is None:
                return None
            lmt = order.limit_price
            if order.side is Side.BUY and bar.low <= lmt:
                price = min(lmt, bar.open)  # fill at better of open or limit
            elif order.side is Side.SELL and bar.high >= lmt:
                price = max(lmt, bar.open)
        elif ot is OrderType.STOP:
            stop = order.stop_price
            if stop is None:
                return None
            if order.side is Side.SELL and bar.low <= stop:
                price = stop  # stop-loss on a long
            elif order.side is Side.BUY and bar.high >= stop:
                price = stop  # stop-buy / short-cover
        elif ot is OrderType.TP:
            tp = order.take_profit
            if tp is None:
                return None
            if order.side is Side.SELL and bar.high >= tp:
                price = tp
            elif order.side is Side.BUY and bar.low <= tp:
                price = tp

        if price is None:
            return None

        return self._build_fill(
            order, bar, price, adv_20d=adv_20d, spread_pct=spread_pct
        )

    def _build_fill(
        self,
        order: PendingOrder,
        bar: Bar,
        price: Decimal,
        *,
        adv_20d: Optional[Decimal],
        spread_pct: Optional[Decimal],
    ) -> Fill:
        asset_class = (
            AssetClass.MULTILEG if order.legs else AssetClass.EQUITY
        )
        commission = self.cost_model.commission(
            order.symbol,
            order.quantity,
            price,
            asset_class,
            order.side,
            legs=order.legs,
        )
        slip_spread = (
            _d(spread_pct)
            if spread_pct is not None
            else self.default_spread_pct
        )
        slippage = self.cost_model.slippage(
            order.symbol,
            order.quantity,
            price,
            adv_20d=adv_20d,
            spread_pct=slip_spread,
        )

        # Bake slippage into the traded price so the position's cost basis
        # reflects realised execution cost.
        if order.side is Side.BUY:
            fill_price = price + (
                slippage / Decimal(order.quantity) if order.quantity else Decimal("0")
            )
        else:
            fill_price = price - (
                slippage / Decimal(order.quantity) if order.quantity else Decimal("0")
            )

        return Fill(
            symbol=order.symbol,
            ts=bar.ts,
            side=order.side,
            quantity=order.quantity,
            price=fill_price,
            commission=commission,
            slippage=slippage,
            legs=order.legs,
            tag=order.tag,
        )


__all__ = ["ExecutionSimulator", "PendingOrder"]
