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

from datetime import date, datetime
from zoneinfo import ZoneInfo

_NY = ZoneInfo("America/New_York")


def market_today() -> date:
    """Return today's date as observed in America/New_York."""
    return datetime.now(_NY).date()


def market_now() -> datetime:
    """Return the current wall-clock time in America/New_York (tz-aware)."""
    return datetime.now(_NY)


__all__ = ["market_today", "market_now"]
