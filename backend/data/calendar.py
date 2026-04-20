"""US equity market calendar (NYSE/NASDAQ).

Thin wrapper around :mod:`pandas_market_calendars` that exposes the subset of
calendar behaviour every strategy and the backtest engine need: session days,
session open/close times in UTC, half-day awareness, and "next session"
navigation. Holidays are inherited from ``pandas_market_calendars`` which
tracks the exchange's published schedule (including ad-hoc closures such as
the passing-of-Carter in Jan 2025).

Everything is lazily cached on the class instance — constructing the calendar
is cheap but repeatedly calling ``schedule`` for the same range is not.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timezone
from functools import lru_cache

import pandas as pd
import pandas_market_calendars as mcal

logger = logging.getLogger(__name__)

_NY = "America/New_York"
REGULAR_OPEN = time(9, 30)
REGULAR_CLOSE = time(16, 0)
EARLY_CLOSE = time(13, 0)


def _to_date(d: date | datetime | str) -> date:
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    return pd.Timestamp(d).date()


class USMarketCalendar:
    """Satisfies :class:`backend.data.providers.base.CalendarProvider`.

    Default exchange is ``"NYSE"`` — NYSE and NASDAQ share a session schedule
    and common holidays, so a single calendar serves both.
    """

    def __init__(self, exchange: str = "NYSE") -> None:
        self.exchange = exchange
        self._cal = mcal.get_calendar(exchange)

    # ------------------------------------------------------------------ #
    # Public API (CalendarProvider protocol)                             #
    # ------------------------------------------------------------------ #
    def sessions(
        self, start: date | datetime | str, end: date | datetime | str
    ) -> pd.DatetimeIndex:
        """All trading sessions in ``[start, end]`` inclusive as dates."""
        sched = self._schedule(_to_date(start), _to_date(end))
        return pd.DatetimeIndex(sched.index).normalize()

    def is_trading_day(self, d: date | datetime | str) -> bool:
        day = _to_date(d)
        sched = self._schedule(day, day)
        return not sched.empty

    def next_session(self, d: date | datetime | str) -> date:
        day = _to_date(d)
        # Look 14 calendar days ahead — enough to cover any market closure.
        start = (pd.Timestamp(day) + pd.Timedelta(days=1)).date()
        end = (pd.Timestamp(day) + pd.Timedelta(days=14)).date()
        sched = self._schedule(start, end)
        if sched.empty:
            raise RuntimeError(
                f"no trading session in the 14 days after {day}; calendar data gap?"
            )
        return sched.index[0].date()

    def session_hours(
        self, d: date | datetime | str
    ) -> tuple[datetime, datetime]:
        """UTC-aware ``(open, close)`` tuple. Half days return 13:00 ET close."""
        day = _to_date(d)
        sched = self._schedule(day, day)
        if sched.empty:
            raise ValueError(f"{day} is not a trading day")
        row = sched.iloc[0]
        # pandas_market_calendars returns tz-aware UTC timestamps already.
        open_ts: pd.Timestamp = row["market_open"]
        close_ts: pd.Timestamp = row["market_close"]
        return open_ts.to_pydatetime(), close_ts.to_pydatetime()

    def is_early_close(self, d: date | datetime | str) -> bool:
        _, close_utc = self.session_hours(d)
        close_local = pd.Timestamp(close_utc).tz_convert(_NY)
        # Compare against 16:00 ET
        return close_local.time() < REGULAR_CLOSE

    # ------------------------------------------------------------------ #
    # Private                                                            #
    # ------------------------------------------------------------------ #
    @lru_cache(maxsize=64)
    def _schedule(self, start: date, end: date) -> pd.DataFrame:
        return self._cal.schedule(start_date=start, end_date=end)


# ---------------------------------------------------------------------- #
# Module-level convenience wrappers                                      #
# ---------------------------------------------------------------------- #
# Wave 4R: the scheduler and daily-pipeline callers reach for simple
# module-level helpers rather than threading a class instance through every
# layer. All of them delegate to a single shared :class:`USMarketCalendar`
# so the schedule cache is shared across callers.

_DEFAULT_CALENDAR: USMarketCalendar | None = None


def _default() -> USMarketCalendar:
    """Return the module-level singleton calendar (lazy)."""
    global _DEFAULT_CALENDAR
    if _DEFAULT_CALENDAR is None:
        _DEFAULT_CALENDAR = USMarketCalendar()
    return _DEFAULT_CALENDAR


def is_trading_day(d: date | datetime | str) -> bool:
    """True if ``d`` is a regular or half-day trading session."""
    return _default().is_trading_day(d)


def market_open(d: date | datetime | str) -> datetime:
    """Return UTC-aware session open for ``d``.

    Raises :class:`ValueError` if ``d`` is not a trading day.
    """
    open_utc, _ = _default().session_hours(d)
    return open_utc


def market_close(d: date | datetime | str) -> datetime:
    """Return UTC-aware session close for ``d`` (half-days return 13:00 ET).

    Raises :class:`ValueError` if ``d`` is not a trading day.
    """
    _, close_utc = _default().session_hours(d)
    return close_utc


def is_early_close(d: date | datetime | str) -> bool:
    """True if ``d`` has an early close (e.g. half-day)."""
    return _default().is_early_close(d)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    cal = USMarketCalendar()

    print("sessions 2024-12-23..2024-12-27:")
    for d in cal.sessions("2024-12-23", "2024-12-27"):
        o, c = cal.session_hours(d)
        print(f"  {d.date()} open={o.isoformat()} close={c.isoformat()}")

    july3 = date(2024, 7, 3)
    print(f"\n2024-07-03 is trading day? {cal.is_trading_day(july3)}")
    o, c = cal.session_hours(july3)
    print(f"  hours: {o.isoformat()} -> {c.isoformat()} (early close expected)")

    ny1 = date(2025, 1, 1)
    print(f"\n2025-01-01 trading? {cal.is_trading_day(ny1)}")
    print(f"next session after 2025-01-01: {cal.next_session(ny1)}")
