"""Contract tests for earnings-screener response schemas.

These lock the wire format so the frontend can depend on it. Any breaking
change here should either bump a version or land with a coordinated
frontend change in the same commit.
"""
from datetime import date, datetime, timezone
import pytest
from pydantic import ValidationError

from api.schemas.earnings import (
    CalendarRow,
    CalendarResponse,
    EarningsDetail,
    LadderRow,
    StrikeLadder,
    ClaudeStructured,
    ClaudeFullResearch,
    IVTermPoint,
    SkewBlock,
    MetricsBlock,
    QuoteBlock,
    NewsArticle,
)


def test_calendar_row_minimal():
    row = CalendarRow(
        symbol="NVDA", company="Nvidia", sector="Semiconductors",
        report_date=date(2026, 4, 23), report_time="AMC", days_until=1,
    )
    assert row.symbol == "NVDA"
    # All optional fields default to None
    assert row.iv_rank is None
    assert row.claude_verdict is None


def test_calendar_row_rejects_bad_report_time():
    with pytest.raises(ValidationError):
        CalendarRow(
            symbol="X", company="X", sector="X",
            report_date=date.today(), report_time="NOPE", days_until=0,
        )


def test_ladder_row_roundtrip():
    row = LadderRow(
        strike=205.0, side="call", bucket="ATM",
        delta=0.5, bid=6.1, ask=6.3, mid=6.2, iv=0.78,
        yield_pct=0.031, pop=0.5,
        theta=-0.22, gamma=0.018, vega=0.31, oi=1000, volume=500,
    )
    dumped = row.model_dump()
    reloaded = LadderRow(**dumped)
    assert reloaded == row


def test_earnings_detail_all_optional():
    """Every leaf must be nullable so partial provider failures don't 500."""
    detail = EarningsDetail(
        symbol="NVDA", company="Nvidia", sector="Semiconductors",
        report_date=date(2026, 4, 23), report_time="AMC",
        news=[],
        partial=False,
        generated_at=datetime.now(timezone.utc),
    )
    assert detail.quote is None
    assert detail.metrics is None
    assert detail.claude_structured is None
    assert detail.claude_full_research is None


def test_claude_structured_verdict_vocabulary():
    with pytest.raises(ValidationError):
        ClaudeStructured(
            verdict="manic",  # invalid
            direction_magnitude={"bull_case_pct": 0.04, "bear_case_pct": -0.05},
            thesis="x", catalysts=[], risks=[],
            suggested_play="short strangle",
            suggested_play_reason="x",
            confidence=0.5, model="claude-opus-4-7",
            generated_at=datetime.now(timezone.utc),
        )


def test_calendar_response_shape():
    resp = CalendarResponse(earnings=[], generated_at=datetime.now(timezone.utc), partial=False)
    assert resp.earnings == []
    assert resp.partial is False
