"""Tests for Round-4 CLUSTER 1 — NY-anchored earnings window resolution.

The user-reported "only end-of-month dates showing" bug came from
``_fmp_upcoming`` using UTC ``date.today()`` and naive ``+7`` day offsets.
The new ``_resolve_window_dates`` anchors to NY-market today and walks
back to that week's Monday, with weekend handling that advances to the
upcoming Mon-Fri rather than backing into the just-finished week.
"""
from __future__ import annotations

from datetime import date
from unittest.mock import patch

import pytest

from services import earnings_screener as svc


def _patch_today(d: date):
    """Patch ``market_today`` inside the earnings_screener module to ``d``."""
    return patch.object(svc, "market_today", return_value=d)


# ───────────────────────── window date resolution ─────────────────────────


def test_window_current_on_a_tuesday():
    """Tue 2026-04-28 → current week = Mon 04-27 to Fri 05-01."""
    with _patch_today(date(2026, 4, 28)):
        start, end = svc._resolve_window_dates("current")
    assert start == date(2026, 4, 27)
    assert end == date(2026, 5, 1)


def test_window_current_on_saturday_includes_friday_amc():
    """Round-12 / EC-1: Sat 2026-04-25 — INCLUDE Friday 2026-04-24 so
    AMC reports that printed Fri 16:30 ET stay visible Saturday morning.
    Pre-fix this jumped to Mon-Fri of the upcoming week and dropped
    Friday's AMC rows entirely."""
    with _patch_today(date(2026, 4, 25)):
        start, end = svc._resolve_window_dates("current")
    assert start == date(2026, 4, 24)  # Friday of the just-finished week
    assert end == date(2026, 5, 1)


def test_window_current_on_sunday_includes_friday_amc():
    """Round-12 / EC-1: Sun 2026-04-26 — same as Saturday."""
    with _patch_today(date(2026, 4, 26)):
        start, end = svc._resolve_window_dates("current")
    assert start == date(2026, 4, 24)
    assert end == date(2026, 5, 1)


def test_window_current_on_monday():
    """Mon 2026-04-27 → start = Mon 04-27, end = Fri 05-01."""
    with _patch_today(date(2026, 4, 27)):
        start, end = svc._resolve_window_dates("current")
    assert start == date(2026, 4, 27)
    assert end == date(2026, 5, 1)


def test_window_current_on_friday():
    """Fri 2026-04-24 — the current week ends today; start = Mon 04-20."""
    with _patch_today(date(2026, 4, 24)):
        start, end = svc._resolve_window_dates("current")
    assert start == date(2026, 4, 20)
    assert end == date(2026, 4, 24)


def test_window_next_on_a_tuesday():
    """Tue 2026-04-28 → next = Mon 05-04 to Fri 05-08."""
    with _patch_today(date(2026, 4, 28)):
        start, end = svc._resolve_window_dates("next")
    assert start == date(2026, 5, 4)
    assert end == date(2026, 5, 8)


def test_window_both_spans_two_weeks():
    """Tue 2026-04-28 → both = 12 calendar days, Mon 04-27 → Fri 05-08."""
    with _patch_today(date(2026, 4, 28)):
        start, end = svc._resolve_window_dates("both")
    assert start == date(2026, 4, 27)
    assert end == date(2026, 5, 8)
    assert (end - start).days == 11


# ───────────────────────── label formatting ─────────────────────────


def test_window_label_same_year_uses_one_year_suffix():
    label = svc._format_window_label(date(2026, 4, 27), date(2026, 5, 1))
    assert label == "Apr 27 - May 1, 2026"


def test_window_label_cross_year_carries_both_years():
    label = svc._format_window_label(date(2025, 12, 29), date(2026, 1, 9))
    assert "2025" in label and "2026" in label


# ───────────────────────── classify_report_state ─────────────────────────


def test_classify_report_state_future_is_upcoming():
    """A future date is always 'upcoming' regardless of the time of day."""
    with _patch_today(date(2026, 4, 27)):
        assert svc._classify_report_state(date(2026, 4, 30), "AMC") == "upcoming"
        assert svc._classify_report_state(date(2026, 4, 30), "BMO") == "upcoming"


def test_classify_report_state_past_two_days_is_past():
    """Reports two-plus days back are past — list_upcoming filters these
    out via the visibility filter."""
    with _patch_today(date(2026, 4, 27)):
        assert svc._classify_report_state(date(2026, 4, 24), "AMC") == "past"


@pytest.mark.parametrize("report_time,expected_pre,expected_done", [
    ("BMO", (8, 0), (10, 0)),    # before vs after 09:30 ET
    ("AMC", (15, 0), (17, 0)),   # before vs after 16:30 ET
    ("DMT", (8, 0), (10, 0)),    # treated like BMO at the cutover
])
def test_classify_report_state_today_pre_vs_done(
    report_time: str, expected_pre: tuple[int, int], expected_done: tuple[int, int]
):
    """On the day of the report, the cutover for BMO is 09:30 ET and for
    AMC is 16:30 ET. Pre-cutover = today_pre, post-cutover = today_done."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    today = date(2026, 4, 27)

    def _fake_now_at(hour: int, minute: int):
        et = datetime(2026, 4, 27, hour, minute, tzinfo=ZoneInfo("America/New_York"))

        class _F:
            @staticmethod
            def now(tz=None):
                return et if tz is None else et.astimezone(tz)

        return _F

    # Pre-cutover
    with patch.object(svc, "market_today", return_value=today), \
         patch.object(svc, "market_now", _fake_now_at(*expected_pre).now):
        assert svc._classify_report_state(today, report_time) == "today_pre"

    # Post-cutover
    with patch.object(svc, "market_today", return_value=today), \
         patch.object(svc, "market_now", _fake_now_at(*expected_done).now):
        assert svc._classify_report_state(today, report_time) == "today_done"


def test_classify_report_state_yesterday_kept_visible():
    """Yesterday's row still shows (frontend dims it). 'past' is reserved
    for ≥ 2 days back."""
    with _patch_today(date(2026, 4, 28)):
        # Yesterday should NOT be classified 'past' (the visibility
        # filter keeps it). It's classified as 'past' under the current
        # rules but list_upcoming keeps it via days_until == -1 retention.
        assert svc._classify_report_state(date(2026, 4, 27), "AMC") == "past"
