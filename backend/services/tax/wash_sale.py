"""B.13 — IRS Pub 550 wash-sale rule engine (equity, cash account).

A wash sale occurs when a security is sold at a loss and "substantially
identical" stock or securities are bought within a 30-day window
before OR after the sale (61-day total window centered on the sale
date). The disallowed loss is added to the cost basis of the
replacement shares.

v2 scope (per decision D9-A): "substantially identical" =
exact symbol match. Options on the same underlying, ETFs vs the
same index, etc., are out of scope and surface in the disclaimer.
Equity only; cash account; no corporate actions.

Public API:
  - LotEvent: minimal data class for buy/sell events
  - WashSaleViolation: matched (loss_lot, replacement_lot, amount)
  - find_wash_sales(events) -> list[WashSaleViolation]
  - apply_wash_sale_basis(violations) -> dict[lot_id, adjusted_basis]
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable


WASH_SALE_WINDOW_DAYS = 30


@dataclass(frozen=True)
class LotEvent:
    """A single buy or sell of an equity. Matches the Lot ORM shape
    minimally so callers can adapt either direction."""

    lot_id: int
    symbol: str
    event_date: date
    quantity: Decimal
    price: Decimal
    is_buy: bool

    @property
    def basis(self) -> Decimal:
        return self.quantity * self.price


@dataclass(frozen=True)
class WashSaleViolation:
    """A loss disallowed by the wash-sale rule.

    `loss_lot_id` is the original sold-at-loss lot.
    `replacement_lot_id` is the buy that triggered the disallowance.
    `disallowed_amount` is the loss reclassified to the replacement
    lot's cost basis (per share × shares).
    """

    loss_lot_id: int
    replacement_lot_id: int
    disallowed_amount: Decimal
    rule_window_days: int = WASH_SALE_WINDOW_DAYS

    def to_dict(self) -> dict:
        return {
            "loss_lot_id": self.loss_lot_id,
            "replacement_lot_id": self.replacement_lot_id,
            "disallowed_amount": str(self.disallowed_amount),
            "rule_window_days": self.rule_window_days,
        }


def find_wash_sales(events: Iterable[LotEvent]) -> list[WashSaleViolation]:
    """Scan events for wash-sale violations.

    Pairs every loss-sale with the nearest qualifying replacement buy
    in the 61-day window (30d before + sale day + 30d after). When
    multiple replacements qualify, prefers the closer event date.

    Sorted: events are sorted by date for deterministic pairing.
    Quantity matching: the disallowed amount is min(loss_qty,
    replacement_qty) × loss_per_share.
    """
    by_symbol: dict[str, list[LotEvent]] = {}
    for ev in events:
        by_symbol.setdefault(ev.symbol.upper(), []).append(ev)
    for sym in by_symbol:
        by_symbol[sym].sort(key=lambda e: e.event_date)

    violations: list[WashSaleViolation] = []
    for sym, sym_events in by_symbol.items():
        for sale in sym_events:
            if sale.is_buy:
                continue
            # Loss check requires a previous buy on the same symbol; we
            # approximate by treating any sale as a candidate when the
            # caller passes the per-event basis as price (i.e. the lot
            # sold below cost). Real callers should pre-filter to losses.
            # To keep the engine pure, we require the caller to send
            # only loss-sales — flag with `is_buy=False`. We then look
            # for a replacement buy within ±30 days.
            window_start = sale.event_date - timedelta(days=WASH_SALE_WINDOW_DAYS)
            window_end = sale.event_date + timedelta(days=WASH_SALE_WINDOW_DAYS)
            best: LotEvent | None = None
            best_dist = None
            for cand in sym_events:
                if not cand.is_buy:
                    continue
                if cand.event_date < window_start or cand.event_date > window_end:
                    continue
                if cand.event_date == sale.event_date and cand.lot_id == sale.lot_id:
                    continue
                dist = abs((cand.event_date - sale.event_date).days)
                if best is None or (best_dist is not None and dist < best_dist):
                    best, best_dist = cand, dist
            if best is None:
                continue
            qty = min(sale.quantity, best.quantity)
            # Disallowed amount = per-share loss × shares matched. Per-
            # share loss is the difference between the sale's per-share
            # proceeds and the original lot's cost. Caller passes the
            # already-realized loss via a sentinel by setting `price` on
            # the sale event to (cost_per_share - sale_per_share). We
            # use the absolute value to be safe.
            per_share_loss = abs(sale.price)
            violations.append(
                WashSaleViolation(
                    loss_lot_id=sale.lot_id,
                    replacement_lot_id=best.lot_id,
                    disallowed_amount=qty * per_share_loss,
                )
            )
    return violations


def apply_wash_sale_basis(
    violations: Iterable[WashSaleViolation],
) -> dict[int, Decimal]:
    """Aggregate disallowed losses into per-replacement-lot cost basis
    additions. Returns ``{replacement_lot_id: amount_to_add_to_basis}``.

    Callers update their Lot.cost_basis_adjusted column from this map.
    """
    out: dict[int, Decimal] = {}
    for v in violations:
        out[v.replacement_lot_id] = out.get(
            v.replacement_lot_id, Decimal("0")
        ) + v.disallowed_amount
    return out


__all__ = [
    "WASH_SALE_WINDOW_DAYS",
    "LotEvent",
    "WashSaleViolation",
    "find_wash_sales",
    "apply_wash_sale_basis",
]
