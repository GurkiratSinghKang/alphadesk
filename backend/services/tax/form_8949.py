"""B.13 — Form 8949 CSV export.

IRS Form 8949 captures sales of capital assets. We export a CSV
that fits the columns most consumer tax-prep tools accept:
  Description · Date acquired · Date sold · Proceeds · Cost basis ·
  Adjustment code · Adjustment amount · Gain/loss · Holding period

v2 scope: equity, cash account, exact-symbol-match wash-sale.
TurboTax-TXF and Form 8949 PDF rendering ship in Phase 1.x.

Disclaimer: NOT TAX ADVICE. The "BYO CPA" flow remains required
pre-launch — see the tax/__init__.py docstring + the redesign
plan §1.9.
"""
from __future__ import annotations

import csv
import io
from decimal import Decimal
from typing import Iterable

from .lots import Disposal


def export_csv(
    disposals: Iterable[Disposal],
    wash_sale_adjustments: dict[str, Decimal] | None = None,
) -> str:
    """Render disposals as IRS Form 8949–style CSV.

    `wash_sale_adjustments` maps lot_id → disallowed-loss amount
    (per the wash_sale.find_wash_sales output). When present, the
    "Adjustment code" column is set to "W" and the "Adjustment
    amount" column carries the disallowed amount.
    """
    adjustments = wash_sale_adjustments or {}
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([
        "Description",
        "Date acquired",
        "Date sold",
        "Proceeds",
        "Cost basis",
        "Adjustment code",
        "Adjustment amount",
        "Gain/loss",
        "Holding period",
    ])
    for d in disposals:
        proceeds = d.proceeds_per_share * d.qty
        basis = d.cost_per_share * d.qty
        adj_amount = adjustments.get(d.lot_id, Decimal("0"))
        adj_code = "W" if adj_amount > 0 else ""
        gain_loss = proceeds - basis + adj_amount
        writer.writerow([
            f"{int(d.qty)} sh {d.symbol}",
            d.acquisition_date.isoformat(),
            d.disposal_date.isoformat(),
            f"{proceeds:.2f}",
            f"{basis:.2f}",
            adj_code,
            f"{adj_amount:.2f}" if adj_amount > 0 else "",
            f"{gain_loss:.2f}",
            "Long-term" if d.holding_period == "long" else "Short-term",
        ])
    return out.getvalue()


__all__ = ["export_csv"]
