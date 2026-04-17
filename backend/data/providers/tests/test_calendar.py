"""Unit tests for USMarketCalendar (no network)."""

from __future__ import annotations

from datetime import date

import pytest

from backend.data.calendar import USMarketCalendar


@pytest.fixture(scope="module")
def cal():
    return USMarketCalendar()


def test_new_years_not_trading(cal):
    assert not cal.is_trading_day(date(2025, 1, 1))


def test_next_session_skips_holiday(cal):
    assert cal.next_session(date(2025, 1, 1)) == date(2025, 1, 2)


def test_thanksgiving_half_day(cal):
    # Black Friday 2024 is an early close (13:00 ET = 18:00 UTC)
    assert cal.is_early_close(date(2024, 11, 29))


def test_regular_close_16h(cal):
    assert not cal.is_early_close(date(2024, 3, 15))


def test_sessions_range(cal):
    sessions = cal.sessions("2024-01-02", "2024-01-10")
    # 2024-01-02 Tue -> 2024-01-10 Wed inclusive: 7 sessions
    assert len(sessions) == 7


def test_session_hours_returns_utc_tuple(cal):
    o, c = cal.session_hours(date(2024, 3, 15))
    assert o < c
    assert o.tzinfo is not None and c.tzinfo is not None
