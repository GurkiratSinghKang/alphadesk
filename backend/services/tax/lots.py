"""B.13 — Lot accumulator + holding-period classification.

Pure logic — given a stream of buys and sells, produces the open
lot ledger with FIFO/LIFO/HIFO matching, plus short-term/long-term
classification per IRS holding-period rules (1 year + 1 day to
qualify as long-term).

v2 scope: equity, cash account. Options assignment, corporate
actions, foreign withholding all out of scope.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

LONG_TERM_THRESHOLD_DAYS = 365


LotMethod = Literal["fifo", "lifo", "hifo"]


@dataclass
class OpenLot:
    """A buy that hasn't been fully disposed."""

    lot_id: str
    symbol: str
    acquisition_date: date
    qty: Decimal
    price: Decimal

    @property
    def remaining_basis(self) -> Decimal:
        return self.qty * self.price


@dataclass(frozen=True)
class Disposal:
    """A sale matched against a specific lot."""

    lot_id: str
    symbol: str
    acquisition_date: date
    disposal_date: date
    qty: Decimal
    cost_per_share: Decimal
    proceeds_per_share: Decimal
    holding_period: Literal["short", "long"]

    @property
    def gain(self) -> Decimal:
        return (self.proceeds_per_share - self.cost_per_share) * self.qty


@dataclass
class LotLedger:
    """Per-symbol lot state, grown one event at a time."""

    method: LotMethod = "fifo"
    open_lots: dict[str, list[OpenLot]] = field(default_factory=dict)
    disposals: list[Disposal] = field(default_factory=list)

    def buy(self, lot_id: str, symbol: str, acq_date: date, qty: Decimal, price: Decimal) -> None:
        sym = symbol.upper()
        self.open_lots.setdefault(sym, []).append(
            OpenLot(lot_id=lot_id, symbol=sym, acquisition_date=acq_date, qty=qty, price=price)
        )

    def sell(
        self,
        symbol: str,
        sale_date: date,
        qty: Decimal,
        proceeds_per_share: Decimal,
    ) -> list[Disposal]:
        """Match a sale against open lots per the current method.

        Returns the list of disposal slices created (one per matched
        lot — partial or full). Raises ValueError if there isn't
        enough open inventory.
        """
        sym = symbol.upper()
        lots = self.open_lots.get(sym, [])
        if not lots:
            raise ValueError(f"No open lots for {sym}; cannot sell {qty}")
        if self.method == "lifo":
            ordered = sorted(lots, key=lambda l: l.acquisition_date, reverse=True)
        elif self.method == "hifo":
            ordered = sorted(lots, key=lambda l: l.price, reverse=True)
        else:  # fifo
            ordered = sorted(lots, key=lambda l: l.acquisition_date)

        remaining = qty
        new_disposals: list[Disposal] = []
        for lot in list(ordered):
            if remaining <= 0:
                break
            take = min(lot.qty, remaining)
            holding_days = (sale_date - lot.acquisition_date).days
            classification: Literal["short", "long"] = (
                "long" if holding_days > LONG_TERM_THRESHOLD_DAYS else "short"
            )
            new_disposals.append(
                Disposal(
                    lot_id=lot.lot_id,
                    symbol=sym,
                    acquisition_date=lot.acquisition_date,
                    disposal_date=sale_date,
                    qty=take,
                    cost_per_share=lot.price,
                    proceeds_per_share=proceeds_per_share,
                    holding_period=classification,
                )
            )
            lot.qty -= take
            remaining -= take

        if remaining > 0:
            raise ValueError(
                f"Insufficient inventory for {sym}: short {remaining}"
            )

        # Drop fully-consumed lots from the open ledger.
        self.open_lots[sym] = [l for l in lots if l.qty > 0]
        self.disposals.extend(new_disposals)
        return new_disposals

    def open_lot_summary(self, symbol: str | None = None) -> list[OpenLot]:
        """Return all currently-open lots, optionally filtered by symbol."""
        if symbol:
            return list(self.open_lots.get(symbol.upper(), []))
        return [lot for lots in self.open_lots.values() for lot in lots]

    def realized_gain(self) -> Decimal:
        return sum((d.gain for d in self.disposals), Decimal("0"))


__all__ = ["LONG_TERM_THRESHOLD_DAYS", "LotMethod", "OpenLot", "Disposal", "LotLedger"]
