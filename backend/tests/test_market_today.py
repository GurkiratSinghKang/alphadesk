"""Tests for ``core.time.market_today`` / ``market_now``.

Round-4 CLUSTER 1 #1: the user-reported "only end-of-month dates showing"
bug had its root in the earnings calendar using UTC ``date.today()``
instead of the NY market date. A Friday-evening UTC call (Friday 20:00 ET
→ Saturday 01:00 UTC) silently shifted the window.

These tests freeze ``datetime.now`` at boundary times via
``unittest.mock.patch`` to verify the helpers respect America/New_York
in all the places UTC and ET disagree."""
from __future__ import annotations

from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from core import time as core_time


def _fake_now(et_dt: datetime):
    """Return a `datetime.now(_NY)`-style replacement that always yields
    the supplied ET-localised datetime. We patch the core.time module's
    `datetime.now` rather than the global so other test modules aren't
    affected."""

    class _Frozen:
        @staticmethod
        def now(tz=None):
            if tz is None:
                # The module asks for an aware datetime in NY tz.
                return et_dt
            return et_dt.astimezone(tz)

    return _Frozen


def test_market_today_friday_evening_ny():
    """Friday 22:00 ET = Saturday 02:00 UTC. UTC-based date.today() would
    say Saturday; NY-based market_today() says Friday."""
    et = datetime(2026, 4, 24, 22, 0, tzinfo=ZoneInfo("America/New_York"))
    with patch.object(core_time, "datetime", _fake_now(et)):
        assert core_time.market_today() == date(2026, 4, 24)


def test_market_today_late_sunday_in_utc_is_still_sunday_in_ny():
    """Sunday 23:00 ET = Monday 03:00 UTC. UTC says Monday; NY says
    Sunday. Demonstrates the NY anchor matters around midnight."""
    et = datetime(2026, 4, 26, 23, 0, tzinfo=ZoneInfo("America/New_York"))
    with patch.object(core_time, "datetime", _fake_now(et)):
        assert core_time.market_today() == date(2026, 4, 26)


def test_market_today_monday_morning_ny():
    """Monday 09:00 ET = Monday 13:00 UTC. Both agree, but the helper
    must still return the NY date and not break."""
    et = datetime(2026, 4, 27, 9, 0, tzinfo=ZoneInfo("America/New_York"))
    with patch.object(core_time, "datetime", _fake_now(et)):
        assert core_time.market_today() == date(2026, 4, 27)


def test_market_now_is_tz_aware():
    """market_now() must return a timezone-aware datetime so callers can
    safely compare against other tz-aware values."""
    now = core_time.market_now()
    assert now.tzinfo is not None


def test_market_now_returns_ny_zone():
    """The returned datetime should carry the NY zoneinfo (or an
    equivalent zone). UTC offset is -4 (EDT) or -5 (EST) depending on
    DST — assert it's negative and within range."""
    now = core_time.market_now()
    offset = now.utcoffset()
    assert offset is not None
    total_seconds = offset.total_seconds()
    assert -5 * 3600 <= total_seconds <= -4 * 3600
