"""B.13 — Tax engine tests.

Pins the lot accumulator + wash-sale rule + 8949 export against
canonical IRS Pub 550 examples. Per the redesign plan's risk
register: tax engine correctness is legally fraught and these
tests protect against silent regressions during follow-up edits.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal


def test_fifo_short_term() -> None:
    from services.tax.lots import LotLedger

    ledger = LotLedger(method="fifo")
    ledger.buy("L1", "AAPL", date(2026, 1, 10), Decimal("100"), Decimal("180"))
    disposals = ledger.sell("AAPL", date(2026, 4, 15), Decimal("60"), Decimal("220"))
    assert len(disposals) == 1
    d = disposals[0]
    assert d.lot_id == "L1"
    assert d.qty == Decimal("60")
    assert d.holding_period == "short"
    # gain = (220 - 180) * 60 = 2400
    assert d.gain == Decimal("2400")
    # 40 shares remain open
    assert ledger.open_lot_summary("AAPL")[0].qty == Decimal("40")


def test_fifo_crosses_long_term_threshold() -> None:
    from services.tax.lots import LONG_TERM_THRESHOLD_DAYS, LotLedger

    ledger = LotLedger(method="fifo")
    ledger.buy("L1", "MSFT", date(2024, 1, 10), Decimal("100"), Decimal("400"))
    # 366 days later → long-term (1 year + 1 day)
    sell_date = date(2024, 1, 10).fromordinal(
        date(2024, 1, 10).toordinal() + LONG_TERM_THRESHOLD_DAYS + 1
    )
    disposals = ledger.sell("MSFT", sell_date, Decimal("50"), Decimal("450"))
    assert disposals[0].holding_period == "long"


def test_lifo_picks_newest_first() -> None:
    from services.tax.lots import LotLedger

    ledger = LotLedger(method="lifo")
    ledger.buy("L1", "NVDA", date(2025, 6, 1), Decimal("50"), Decimal("100"))
    ledger.buy("L2", "NVDA", date(2025, 12, 1), Decimal("50"), Decimal("140"))
    disposals = ledger.sell("NVDA", date(2026, 1, 10), Decimal("30"), Decimal("160"))
    assert disposals[0].lot_id == "L2"
    assert disposals[0].qty == Decimal("30")


def test_hifo_picks_highest_basis_first() -> None:
    from services.tax.lots import LotLedger

    ledger = LotLedger(method="hifo")
    ledger.buy("L1", "TSLA", date(2025, 6, 1), Decimal("50"), Decimal("180"))
    ledger.buy("L2", "TSLA", date(2025, 9, 1), Decimal("50"), Decimal("220"))
    disposals = ledger.sell("TSLA", date(2025, 12, 1), Decimal("30"), Decimal("200"))
    assert disposals[0].lot_id == "L2"
    # Loss: (200 - 220) * 30 = -600
    assert disposals[0].gain == Decimal("-600")


def test_sell_more_than_inventory_raises() -> None:
    import pytest

    from services.tax.lots import LotLedger

    ledger = LotLedger(method="fifo")
    ledger.buy("L1", "GOOG", date(2026, 1, 1), Decimal("10"), Decimal("100"))
    with pytest.raises(ValueError, match="Insufficient"):
        ledger.sell("GOOG", date(2026, 2, 1), Decimal("20"), Decimal("90"))


def test_wash_sale_finds_replacement_within_window() -> None:
    from services.tax.wash_sale import LotEvent, find_wash_sales

    # Loss-sale on 2026-04-09 of TSLA (price field = per-share loss).
    sale = LotEvent(
        lot_id=42,
        symbol="TSLA",
        event_date=date(2026, 4, 9),
        quantity=Decimal("50"),
        price=Decimal("8.24"),  # per-share loss
        is_buy=False,
    )
    # Replacement buy 3 days later — inside the 30-day window.
    replacement = LotEvent(
        lot_id=99,
        symbol="TSLA",
        event_date=date(2026, 4, 12),
        quantity=Decimal("50"),
        price=Decimal("198"),
        is_buy=True,
    )
    violations = find_wash_sales([sale, replacement])
    assert len(violations) == 1
    v = violations[0]
    assert v.loss_lot_id == 42
    assert v.replacement_lot_id == 99
    # Disallowed = min(50, 50) * 8.24 = 412
    assert v.disallowed_amount == Decimal("412.00")


def test_wash_sale_ignores_replacement_outside_window() -> None:
    from services.tax.wash_sale import LotEvent, find_wash_sales

    sale = LotEvent(
        lot_id=42,
        symbol="TSLA",
        event_date=date(2026, 4, 1),
        quantity=Decimal("50"),
        price=Decimal("10"),
        is_buy=False,
    )
    # Buy 35 days later — outside the 30-day window.
    far = LotEvent(
        lot_id=99,
        symbol="TSLA",
        event_date=date(2026, 5, 6),
        quantity=Decimal("50"),
        price=Decimal("180"),
        is_buy=True,
    )
    assert find_wash_sales([sale, far]) == []


def test_wash_sale_basis_aggregation() -> None:
    from services.tax.wash_sale import WashSaleViolation, apply_wash_sale_basis

    violations = [
        WashSaleViolation(
            loss_lot_id=1, replacement_lot_id=10, disallowed_amount=Decimal("200")
        ),
        WashSaleViolation(
            loss_lot_id=2, replacement_lot_id=10, disallowed_amount=Decimal("150")
        ),
        WashSaleViolation(
            loss_lot_id=3, replacement_lot_id=20, disallowed_amount=Decimal("75")
        ),
    ]
    out = apply_wash_sale_basis(violations)
    assert out[10] == Decimal("350")
    assert out[20] == Decimal("75")


def test_form_8949_csv_round_trip() -> None:
    import csv
    import io

    from services.tax.form_8949 import export_csv
    from services.tax.lots import Disposal

    disposals = [
        Disposal(
            lot_id="L1",
            symbol="AAPL",
            acquisition_date=date(2025, 1, 10),
            disposal_date=date(2026, 4, 15),
            qty=Decimal("60"),
            cost_per_share=Decimal("180"),
            proceeds_per_share=Decimal("220"),
            holding_period="long",
        ),
    ]
    csv_text = export_csv(disposals)
    rows = list(csv.reader(io.StringIO(csv_text)))
    assert rows[0][0] == "Description"
    assert rows[1][0] == "60 sh AAPL"
    assert rows[1][3] == "13200.00"  # proceeds
    assert rows[1][4] == "10800.00"  # basis
    assert rows[1][7] == "2400.00"   # gain
    assert rows[1][8] == "Long-term"


def test_form_8949_marks_wash_sale_adjustment() -> None:
    import csv
    import io

    from services.tax.form_8949 import export_csv
    from services.tax.lots import Disposal

    disposals = [
        Disposal(
            lot_id="L42",
            symbol="TSLA",
            acquisition_date=date(2026, 1, 5),
            disposal_date=date(2026, 4, 9),
            qty=Decimal("50"),
            cost_per_share=Decimal("220"),
            proceeds_per_share=Decimal("180"),
            holding_period="short",
        ),
    ]
    csv_text = export_csv(disposals, wash_sale_adjustments={"L42": Decimal("412")})
    rows = list(csv.reader(io.StringIO(csv_text)))
    assert rows[1][5] == "W"      # adjustment code
    assert rows[1][6] == "412.00"  # adjustment amount
    # gain = proceeds - basis + adjustment = 9000 - 11000 + 412 = -1588
    assert rows[1][7] == "-1588.00"
