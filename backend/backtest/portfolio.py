"""Portfolio bookkeeping.

The :class:`Portfolio` owns cash, open positions, realized + unrealized P&L,
and closed trades. All monetary math is performed in :class:`~decimal.Decimal`.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Iterable, Mapping, Optional

from backend.backtest.types import (
    AssetClass,
    Fill,
    OptionLeg,
    Position,
    Side,
    Trade,
)


def _d(x) -> Decimal:
    """Coerce to ``Decimal`` preserving precision."""

    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))


class Portfolio:
    """A portfolio state machine.

    Parameters
    ----------
    starting_cash:
        Initial cash balance.
    borrow_rate:
        Annualised short-borrow rate (1.0% = ``Decimal("0.01")``).
    """

    def __init__(
        self,
        starting_cash: Decimal | float | int = Decimal("100000"),
        borrow_rate: Decimal | float = Decimal("0.01"),
    ) -> None:
        self.starting_cash: Decimal = _d(starting_cash)
        self.cash: Decimal = _d(starting_cash)
        self.positions: list[Position] = []
        self.trades: list[Trade] = []
        self._last_prices: dict[str, Decimal] = {}
        self.realized_pnl: Decimal = Decimal("0")
        self.borrow_rate: Decimal = _d(borrow_rate)
        # per-ticker override, e.g. HTB names at 20%. The engine wires this.
        self.borrow_rate_overrides: dict[str, Decimal] = {}

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def get_position(self, symbol: str) -> Optional[Position]:
        for p in self.positions:
            if p.symbol == symbol:
                return p
        return None

    def positions_value(
        self, prices: Optional[Mapping[str, Decimal]] = None
    ) -> Decimal:
        """Total signed mark-to-market value of open positions."""

        prices = prices or {}
        total = Decimal("0")
        for p in self.positions:
            mark = _d(prices.get(p.symbol, p.last_price or p.avg_price))
            if p.asset_class is AssetClass.MULTILEG:
                # Multi-leg spreads quote as a net per-spread price; the
                # option multiplier is baked into the provided ``mark``.
                total += Decimal(p.quantity) * mark
            else:
                total += Decimal(p.quantity) * mark
        return total

    def unrealized_pnl(
        self, prices: Optional[Mapping[str, Decimal]] = None
    ) -> Decimal:
        prices = prices or {}
        total = Decimal("0")
        for p in self.positions:
            mark = _d(prices.get(p.symbol, p.last_price or p.avg_price))
            total += p.unrealized_pnl(mark)
        return total

    def current_equity(
        self, prices: Optional[Mapping[str, Decimal]] = None
    ) -> Decimal:
        """Cash + positions value."""

        return self.cash + self.positions_value(prices)

    # ------------------------------------------------------------------
    # Mutators
    # ------------------------------------------------------------------

    def mark_to_market(self, prices: Mapping[str, Decimal]) -> None:
        """Update each position's ``last_price`` from a prices dict."""

        for p in self.positions:
            if p.symbol in prices:
                p.last_price = _d(prices[p.symbol])
                self._last_prices[p.symbol] = p.last_price

    def apply_dividends(self, dividends: Mapping[str, Decimal]) -> None:
        """Credit / debit cash for dividends on the ex-date.

        ``dividends`` maps symbol -> per-share dividend. Longs are credited,
        shorts are debited the same amount.
        """

        for sym, div in dividends.items():
            pos = self.get_position(sym)
            if pos is None or pos.is_flat:
                continue
            cash_delta = _d(div) * Decimal(pos.quantity)
            self.cash += cash_delta

    def apply_splits(self, splits: Mapping[str, Decimal]) -> None:
        """Apply split ratios to open equity positions.

        A 2:1 forward split is ``split_ratio=Decimal("2")``: quantity doubles,
        average price halves.
        """

        for sym, ratio in splits.items():
            ratio_d = _d(ratio)
            if ratio_d == 1:
                continue
            pos = self.get_position(sym)
            if pos is None or pos.is_flat:
                continue
            if pos.asset_class is not AssetClass.EQUITY:
                continue
            new_qty_d = Decimal(pos.quantity) * ratio_d
            # Equity positions hold integer shares after the split in the
            # adjusted-close convention; round to nearest share and spill the
            # fractional remainder into realized P&L at the adjusted mark.
            new_qty = int(new_qty_d.to_integral_value())
            pos.quantity = new_qty
            if ratio_d != 0:
                pos.avg_price = (pos.avg_price / ratio_d).quantize(Decimal("0.000001"))
                if pos.stop_price is not None:
                    pos.stop_price = (pos.stop_price / ratio_d).quantize(
                        Decimal("0.000001")
                    )
                if pos.take_profit is not None:
                    pos.take_profit = (pos.take_profit / ratio_d).quantize(
                        Decimal("0.000001")
                    )
                if pos.last_price:
                    pos.last_price = (pos.last_price / ratio_d).quantize(
                        Decimal("0.000001")
                    )

    # ------------------------------------------------------------------
    # Fills
    # ------------------------------------------------------------------

    def apply_fill(self, fill: Fill) -> None:
        """Apply a fill to cash, position, and trade log."""

        if fill.legs:
            self._apply_multileg_fill(fill)
            return

        signed_qty = fill.signed_quantity
        notional = Decimal(fill.quantity) * fill.price
        # Buys reduce cash (minus commission+slippage), sells increase cash.
        if fill.side is Side.BUY:
            self.cash -= notional
        else:
            self.cash += notional
        self.cash -= fill.commission
        self.cash -= fill.slippage

        pos = self.get_position(fill.symbol)
        if pos is None:
            pos = Position(
                symbol=fill.symbol,
                quantity=0,
                avg_price=Decimal("0"),
                asset_class=AssetClass.EQUITY,
                opened_at=fill.ts,
            )
            self.positions.append(pos)

        self._merge_equity_fill(pos, fill, signed_qty)

        if pos.is_flat:
            # Clean up flat positions to keep the list small.
            self.positions = [p for p in self.positions if p is not pos]

    def _merge_equity_fill(
        self, pos: Position, fill: Fill, signed_qty: int
    ) -> None:
        prev_qty = pos.quantity
        new_qty = prev_qty + signed_qty

        # Case 1: adding to existing position in the same direction (or from
        # flat). Update weighted-average cost.
        same_direction = (prev_qty >= 0 and signed_qty > 0) or (
            prev_qty <= 0 and signed_qty < 0
        )
        if prev_qty == 0 or same_direction:
            if new_qty == 0:
                pos.avg_price = Decimal("0")
            else:
                total_cost = (
                    pos.avg_price * Decimal(abs(prev_qty))
                    + fill.price * Decimal(abs(signed_qty))
                )
                pos.avg_price = total_cost / Decimal(abs(new_qty))
            pos.quantity = new_qty
            if pos.opened_at is None:
                pos.opened_at = fill.ts
            if not pos.tag and fill.tag:
                pos.tag = fill.tag
            return

        # Case 2: reducing / flipping the position. Book realized P&L on the
        # portion that closes.
        closing_qty = min(abs(prev_qty), abs(signed_qty))
        # realized for closing_qty shares at fill price vs avg_price.
        direction_sign = 1 if prev_qty > 0 else -1
        realized = (
            Decimal(closing_qty) * (fill.price - pos.avg_price) * Decimal(direction_sign)
        )
        pos.realized_pnl += realized
        self.realized_pnl += realized

        # Record the round-trip trade for the closed portion.
        self.trades.append(
            Trade(
                symbol=pos.symbol,
                side=Side.BUY if prev_qty > 0 else Side.SELL,
                quantity=closing_qty,
                entry_ts=pos.opened_at or fill.ts,
                entry_price=pos.avg_price,
                exit_ts=fill.ts,
                exit_price=fill.price,
                pnl=realized,
                commission=fill.commission,
                tag=pos.tag or fill.tag,
            )
        )

        pos.quantity = new_qty
        if new_qty == 0:
            pos.avg_price = Decimal("0")
            pos.opened_at = None
        elif (prev_qty > 0 and new_qty < 0) or (prev_qty < 0 and new_qty > 0):
            # Flipped: avg price resets to the fill price for the residual.
            pos.avg_price = fill.price
            pos.opened_at = fill.ts

    def _apply_multileg_fill(self, fill: Fill) -> None:
        """Apply a multi-leg options fill.

        ``fill.price`` is the net per-spread premium (buy side pays, sell side
        receives). ``fill.quantity`` is the number of spreads filled.
        """

        qty = fill.quantity
        if qty <= 0:
            return

        net_premium_per_spread = fill.price  # already signed per leg math upstream
        notional = Decimal(qty) * net_premium_per_spread
        if fill.side is Side.BUY:
            self.cash -= notional
        else:
            self.cash += notional
        self.cash -= fill.commission
        self.cash -= fill.slippage

        pos = self.get_position(fill.symbol)
        if pos is None:
            pos = Position(
                symbol=fill.symbol,
                quantity=0,
                avg_price=Decimal("0"),
                asset_class=AssetClass.MULTILEG,
                legs=fill.legs,
                opened_at=fill.ts,
            )
            self.positions.append(pos)
            pos.avg_price = net_premium_per_spread
            pos.quantity = qty if fill.side is Side.BUY else -qty
            return

        signed = qty if fill.side is Side.BUY else -qty
        prev_qty = pos.quantity
        new_qty = prev_qty + signed

        same_dir = (prev_qty >= 0 and signed > 0) or (prev_qty <= 0 and signed < 0)
        if prev_qty == 0 or same_dir:
            if new_qty != 0:
                total_cost = (
                    pos.avg_price * Decimal(abs(prev_qty))
                    + net_premium_per_spread * Decimal(abs(signed))
                )
                pos.avg_price = total_cost / Decimal(abs(new_qty))
            pos.quantity = new_qty
            return

        closing = min(abs(prev_qty), abs(signed))
        dir_sign = 1 if prev_qty > 0 else -1
        realized = (
            Decimal(closing)
            * (net_premium_per_spread - pos.avg_price)
            * Decimal(dir_sign)
        )
        pos.realized_pnl += realized
        self.realized_pnl += realized
        self.trades.append(
            Trade(
                symbol=pos.symbol,
                side=Side.BUY if prev_qty > 0 else Side.SELL,
                quantity=closing,
                entry_ts=pos.opened_at or fill.ts,
                entry_price=pos.avg_price,
                exit_ts=fill.ts,
                exit_price=net_premium_per_spread,
                pnl=realized,
                commission=fill.commission,
                tag=pos.tag or fill.tag,
            )
        )

        pos.quantity = new_qty
        if new_qty == 0:
            self.positions = [p for p in self.positions if p is not pos]

    # ------------------------------------------------------------------
    # Daily hooks
    # ------------------------------------------------------------------

    def accrue_borrow_cost(self, ts: datetime) -> Decimal:
        """Charge one day of borrow cost on short positions.

        Returns the total dollar amount accrued (positive = charged).
        """

        total_charged = Decimal("0")
        if not self.positions:
            return total_charged
        # Use ACT/365 to match broker convention for simplicity.
        day_fraction = Decimal("1") / Decimal("365")
        for p in self.positions:
            if not p.is_short or p.asset_class is not AssetClass.EQUITY:
                continue
            rate = self.borrow_rate_overrides.get(p.symbol, self.borrow_rate)
            mark = p.last_price or p.avg_price
            notional = Decimal(abs(p.quantity)) * mark
            charge = notional * rate * day_fraction
            self.cash -= charge
            total_charged += charge
        return total_charged

    # ------------------------------------------------------------------
    # Rep / debug
    # ------------------------------------------------------------------

    def snapshot(
        self, prices: Optional[Mapping[str, Decimal]] = None
    ) -> dict[str, Decimal]:
        return {
            "cash": self.cash,
            "positions_value": self.positions_value(prices),
            "equity": self.current_equity(prices),
            "realized_pnl": self.realized_pnl,
            "unrealized_pnl": self.unrealized_pnl(prices),
        }


__all__ = ["Portfolio"]
