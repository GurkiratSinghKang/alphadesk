"""B.12 — Report HTML renderer tests.

Pins the deterministic HTML structure so reports stay reproducible
across reruns + diffs.
"""
from __future__ import annotations

from datetime import date


def test_render_html_includes_required_sections() -> None:
    from services.reports.renderer import render_html

    html = render_html(
        report_type="monthly",
        title="Monthly review · April 2026",
        period_start=date(2026, 4, 1),
        period_end=date(2026, 4, 30),
        ai_summary="The book navigated April's vol spike well; sector concentration tightened.",
        data={
            "totals": {
                "Equity": 1_790_240,
                "Day P&L": 12_412,
                "MTD P&L": 48_200,
                "YTD P&L": 184_120,
            },
            "positions": [
                {
                    "symbol": "NVDA",
                    "strategy": "Momentum + Quality",
                    "qty": 80,
                    "cost": 11_240,
                    "market_value": 11_616,
                    "unrealized": 376,
                },
            ],
            "realized": [
                {
                    "symbol": "CRM",
                    "strategy": "PEAD",
                    "closed": "2026-04-15",
                    "gain": 412,
                    "holding": "Short-term",
                },
            ],
            "strategies": [
                {"name": "Momentum + Quality", "pct": "62%", "mtd": "+4.8%"},
                {"name": "PEAD", "pct": "28%", "mtd": "+2.1%"},
            ],
        },
    )

    assert "<h1>Monthly review · April 2026</h1>" in html
    assert "REPORT · MONTHLY" in html
    assert "2026-04-01 → 2026-04-30" in html
    # Disclaimer is mandatory
    assert "NOT TAX ADVICE" in html
    # Sections render
    assert "Open positions" in html
    assert "Realized trades" in html
    assert "Strategy attribution" in html
    # AI summary callout (apostrophe is html-escaped per the defensive
    # _esc pass — see the XSS-defense test below).
    assert "navigated April" in html
    assert "vol spike" in html
    assert 'class="ai-summary"' in html
    # Numbers are formatted
    assert "$1,790,240.00" in html
    assert "+$12,412.00" in html


def test_render_html_handles_empty_data() -> None:
    from services.reports.renderer import render_html

    html = render_html(
        report_type="daily_eod",
        title="Daily EOD · 2026-05-08",
        period_start=date(2026, 5, 8),
        period_end=date(2026, 5, 8),
        data={},
    )
    assert "No data for this period." in html
    assert "NOT TAX ADVICE" in html


def test_render_pdf_raises_without_weasyprint() -> None:
    """Defensive — WeasyPrint is optional. Raises ImportError when
    not installed so the caller can fall back to serving HTML."""
    import sys
    import pytest

    from services.reports.renderer import render_pdf

    if "weasyprint" in sys.modules:
        # WeasyPrint IS installed — skip; the fallback path doesn't apply.
        pytest.skip("WeasyPrint installed; ImportError fallback not exercised")
    with pytest.raises(ImportError, match="WeasyPrint"):
        render_pdf("<html></html>")


def test_html_escapes_user_supplied_strings() -> None:
    """Defensive: caller-supplied strategy names + summaries can't
    inject HTML. Validates the html.escape pass."""
    from services.reports.renderer import render_html

    html = render_html(
        report_type="weekly",
        title="<script>alert('xss')</script>",
        period_start=date(2026, 5, 1),
        period_end=date(2026, 5, 7),
        ai_summary="<img src=x onerror=alert(1)>",
        data={"positions": [{"symbol": "<svg/onload=alert(1)>", "strategy": "MQ"}]},
    )
    assert "<script>alert" not in html
    assert "&lt;script&gt;" in html
    assert "&lt;img " in html
