"""Market-time helpers — pin earnings-window semantics to America/New_York.

The earnings calendar's "current week" / "next week" notion is anchored to
the NY market week, not the server's UTC clock. A box in Frankfurt and one
in San Francisco both decide which Mon-Fri to surface based on what NY
considers "today" — anything else creates the user-reported bug where a
Friday-evening UTC call shows Monday's reports as part of "next week"
because UTC has already crossed midnight.

Use :func:`market_today` and :func:`market_now` everywhere the earnings
feature would otherwise reach for ``date.today()`` / ``datetime.now()``.
``zoneinfo`` is stdlib (PEP 615) so no new dependency.

Imports are kept narrow so this module is import-safe from any service —
no FastAPI / pydantic transitive pulls.
"""
from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal
from zoneinfo import ZoneInfo

_NY = ZoneInfo("America/New_York")

# US equity session bounds in NY local time.
# Pre-market: 04:00 - 09:30 ET
# Regular: 09:30 - 16:00 ET
# Post-market: 16:00 - 20:00 ET
# Outside those windows we report "closed" — extended-hours quotes are
# typically still the most-recent available trade (carried forward from
# the last session).
_PRE_MARKET_OPEN = time(4, 0)
_REGULAR_OPEN = time(9, 30)
_REGULAR_CLOSE = time(16, 0)
_POST_MARKET_CLOSE = time(20, 0)


def market_today() -> date:
    """Return today's date as observed in America/New_York."""
    return datetime.now(_NY).date()


def market_now() -> datetime:
    """Return the current wall-clock time in America/New_York (tz-aware)."""
    return datetime.now(_NY)


Session = Literal["pre", "regular", "post", "closed"]


def current_session(now: datetime | None = None) -> Session:
    """Classify the supplied (or current) wall-clock time into a US equity session.

    Weekends are always ``"closed"``. Holiday-aware classification is left
    to :mod:`data.calendar` callers — this helper is a fast, dependency-free
    classifier suitable for tagging individual quote responses. Strategies
    that need true holiday handling can layer the calendar on top.

    Bounds (NY local time):
      * pre 04:00–09:30
      * regular 09:30–16:00
      * post 16:00–20:00
      * closed otherwise (weekends, overnight 20:00–04:00)
    """
    ny_dt = datetime.now(_NY) if now is None else now.astimezone(_NY)
    # Saturday=5, Sunday=6
    if ny_dt.weekday() >= 5:
        return "closed"
    t = ny_dt.timetz().replace(tzinfo=None)
    if _PRE_MARKET_OPEN <= t < _REGULAR_OPEN:
        return "pre"
    if _REGULAR_OPEN <= t < _REGULAR_CLOSE:
        return "regular"
    if _REGULAR_CLOSE <= t < _POST_MARKET_CLOSE:
        return "post"
    return "closed"


def classify_trade_session(trade_dt: datetime, now: datetime | None = None) -> Session:
    """Classify the session a specific trade timestamp belongs to.

    Same bounds as :func:`current_session`, but driven by the trade's own
    wall-clock time. Used by quote handlers to label whether
    ``lastTrade`` printed during pre/regular/post hours so the frontend
    can show "Post-market: $403" alongside "Close: $356".
    """
    return current_session(trade_dt)


__all__ = [
    "market_today",
    "market_now",
    "current_session",
    "classify_trade_session",
    "Session",
]
