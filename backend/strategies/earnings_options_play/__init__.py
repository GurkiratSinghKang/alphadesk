"""Earnings Options Play — research-kind registration.

This strategy is a UI-only decision-support screener — the engine never
calls `generate_signals`. Registered only so /strategies surfaces it in the
Research section, and so the backend earnings router can resolve
`earnings-options-play` as a known strategy id.
"""
from . import strategy  # noqa: F401 — decorator side-effect
