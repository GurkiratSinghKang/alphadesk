"""Earnings Options Play — research-kind registration.

UI-only decision-support screener; engine never invokes it. Registered so
``get_strategy("earnings-options-play")`` succeeds and the route-id
surfaces in the /strategies rail.
"""

from .strategy import EarningsOptionsPlay

__all__ = ["EarningsOptionsPlay"]
