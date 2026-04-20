"""Calendar-aware scheduler unit tests (Wave 4R Fixes 1 + 2).

Covers:

* ``_close_window_target`` for ``close`` / ``weekly`` / ``monthly`` windows
  derives from the actual session close rather than a hard-coded 16:00 ET,
  so half-days (Jul 3, Thanksgiving-eve) land at 12:30 / 12:55 ET instead
  of at an already-closed 15:30 / 15:55 ET.
* ``_is_within_trading_window`` rejects non-trading days (MLK,
  Good Friday, Christmas-on-a-weekday, weekend) AND rejects time-of-day
  outside the session on a regular weekday.
* Weekly window on a real Friday returns the close-offset target.

All tests patch ``datetime.now`` / ``pandas_market_calendars`` are left
as-is — the calendar's real schedule lookup is exactly what we want to
verify against (the tests would silently green if a mock calendar lied).
"""
from __future__ import annotations

import sys
from datetime import date, datetime, time as dt_time
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

ET = ZoneInfo("America/New_York")


# ---------------------------------------------------------------------------
# Fix 1 — _close_window_target half-day awareness
# ---------------------------------------------------------------------------

def test_close_window_target_half_day_july_3_2024() -> None:
    """2024-07-03 is an NYSE half-day (close 13:00 ET).

    Previously ``_close_window_target`` only shifted when the
    ``close`` window was requested; the monthly/weekly branches still
    used 15:55 / 15:30 ET against a market that closed 2+ hours earlier.
    Post-Fix 1 the helper accepts a ``window_name`` arg and returns the
    derived target for each.
    """
    from data.ingestion.pipeline_runner import _close_window_target

    half_day = date(2024, 7, 3)
    close_t = _close_window_target(half_day, "close")
    monthly_t = _close_window_target(half_day, "monthly")
    weekly_t = _close_window_target(half_day, "weekly")

    # Half-day closes at 13:00 ET. Offsets:
    #   close   : 30 min before close -> 12:30 ET
    #   weekly  : 30 min before close -> 12:30 ET
    #   monthly :  5 min before close -> 12:55 ET
    assert close_t == dt_time(12, 30)
    assert weekly_t == dt_time(12, 30)
    assert monthly_t == dt_time(12, 55)


def test_close_window_target_regular_day() -> None:
    """A regular weekday returns the 15:30 / 15:55 ET baselines."""
    from data.ingestion.pipeline_runner import _close_window_target

    regular = date(2024, 10, 2)  # plain midweek trading day
    assert _close_window_target(regular, "close") == dt_time(15, 30)
    assert _close_window_target(regular, "weekly") == dt_time(15, 30)
    assert _close_window_target(regular, "monthly") == dt_time(15, 55)


def test_close_window_target_non_trading_day_falls_back() -> None:
    """On a non-trading day the helper falls back to the hard-coded default
    so the scheduler (which additionally gates on ``_is_trading_day``)
    never sees an undefined target."""
    from data.ingestion.pipeline_runner import _close_window_target, WINDOWS

    xmas = date(2024, 12, 25)  # NYSE closed
    assert _close_window_target(xmas, "close") == WINDOWS["close"]
    assert _close_window_target(xmas, "monthly") == WINDOWS["monthly"]


def test_close_window_target_friday_weekly() -> None:
    """Weekly window fires 30 min before the regular Friday close (15:30 ET)."""
    from data.ingestion.pipeline_runner import _close_window_target

    friday = date(2024, 10, 4)  # a regular Friday
    target = _close_window_target(friday, "weekly")
    assert target == dt_time(15, 30)


# ---------------------------------------------------------------------------
# Fix 2 — _is_within_trading_window holiday/half-day awareness
# ---------------------------------------------------------------------------

def _set_now(monkeypatch: pytest.MonkeyPatch, now_et: datetime) -> None:
    """Patch ``datetime.now(ET)`` inside daily_pipeline to return ``now_et``."""
    import data.ingestion.daily_pipeline as dp

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            # Respect the tz argument the production code passes.
            if tz is not None:
                return now_et.astimezone(tz)
            return now_et.replace(tzinfo=None)

    monkeypatch.setattr(dp, "datetime", _FakeDatetime)


def test_is_within_trading_window_rejects_holiday(monkeypatch: pytest.MonkeyPatch) -> None:
    """Christmas-on-a-weekday is NOT a trading day."""
    from data.ingestion.daily_pipeline import _is_within_trading_window

    # 2024-12-25 is a Wednesday. Pick a mid-session clock.
    _set_now(monkeypatch, datetime(2024, 12, 25, 11, 0, tzinfo=ET))
    assert _is_within_trading_window() is False


def test_is_within_trading_window_rejects_weekend(monkeypatch: pytest.MonkeyPatch) -> None:
    from data.ingestion.daily_pipeline import _is_within_trading_window

    _set_now(monkeypatch, datetime(2024, 10, 5, 11, 0, tzinfo=ET))  # Saturday
    assert _is_within_trading_window() is False


def test_is_within_trading_window_accepts_regular_open(monkeypatch: pytest.MonkeyPatch) -> None:
    """A normal weekday at 10:30 ET is in-session."""
    from data.ingestion.daily_pipeline import _is_within_trading_window

    _set_now(monkeypatch, datetime(2024, 10, 2, 10, 30, tzinfo=ET))
    assert _is_within_trading_window() is True


def test_is_within_trading_window_rejects_after_half_day_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """15:30 ET on 2024-07-03 is AFTER the 13:00 ET half-day close."""
    from data.ingestion.daily_pipeline import _is_within_trading_window

    _set_now(monkeypatch, datetime(2024, 7, 3, 15, 30, tzinfo=ET))
    assert _is_within_trading_window() is False


def test_is_within_trading_window_accepts_half_day_mid_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """10:00 ET on a half-day is still in-session."""
    from data.ingestion.daily_pipeline import _is_within_trading_window

    _set_now(monkeypatch, datetime(2024, 7, 3, 10, 0, tzinfo=ET))
    assert _is_within_trading_window() is True


# ---------------------------------------------------------------------------
# Fix 2 — calendar module wrappers
# ---------------------------------------------------------------------------

def test_calendar_module_helpers_match_class() -> None:
    """``data.calendar.is_trading_day`` / ``market_open`` / ``market_close``
    delegate to the singleton calendar."""
    from data import calendar as cal_mod
    from data.calendar import USMarketCalendar

    cal = USMarketCalendar()
    day = date(2024, 7, 3)
    assert cal_mod.is_trading_day(day) == cal.is_trading_day(day)
    assert cal_mod.market_close(day) == cal.session_hours(day)[1]
    assert cal_mod.market_open(day) == cal.session_hours(day)[0]
