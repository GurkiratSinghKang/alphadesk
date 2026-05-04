"""Three-layer kill-switch for production strategy execution.

Layer 1 — per-strategy drawdown from peak NAV (default -8%): auto-disable
          until manually re-enabled via Layer 3 resolve.
Layer 2 — daily realized PnL as fraction of allocated capital (default -2%):
          pause for the rest of the trading session; auto-resets at 00:00 UTC.
Layer 3 — manual emergency disable: a row in ``strategy_disabled_events``
          with ``layer=3`` and ``resolved_at IS NULL`` blocks every run().

The pipeline runner consults ``KillSwitch.is_enabled(name, ctx)`` before
each ``Strategy.run()`` invocation. Backtest and signal runners do not.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol


@dataclass(frozen=True)
class Decision:
    """The result of one or more kill-switch layer checks.

    ``layer == 0`` is the convention for "no layer triggered" (i.e., enabled).
    """

    enabled: bool
    layer: int
    reason: str
    metrics: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class KillSwitchContext:
    """Runtime snapshot a strategy gives the kill-switch at decision time.

    The pipeline runner builds this from current portfolio state +
    master_agent capital allocation + the day's realized P&L feed.
    """

    peak_nav: float
    current_nav: float
    alloc_capital: float
    realized_today: float


@dataclass
class DisabledEvent:
    """An entry in ``strategy_disabled_events``."""

    id: int | None
    strategy: str
    layer: int
    triggered_at: datetime
    peak_nav: float | None = None
    current_nav: float | None = None
    realized_pnl: float | None = None
    alloc_capital: float | None = None
    threshold: float | None = None
    manual_actor: str | None = None
    reason: str | None = None
    resolved_at: datetime | None = None
    resolved_by: str | None = None


class DisabledEventsRepo(Protocol):
    """Repository for ``strategy_disabled_events`` rows."""

    def insert(self, event: DisabledEvent) -> DisabledEvent:
        """Persist ``event`` and return it with ``id`` populated."""
        ...

    def latest_unresolved_for_strategy(
        self, strategy: str, layer: int | None = None
    ) -> DisabledEvent | None:
        """Latest event with ``resolved_at IS NULL`` for ``strategy``, optionally filtered by layer."""
        ...

    def resolve(self, event_id: int, resolved_by: str) -> None:
        """Mark a single event resolved with ``resolved_at = now()`` and ``resolved_by``."""
        ...


class InMemoryDisabledEventsRepo:
    """In-memory implementation for unit tests. NOT thread-safe; one repo per test."""

    def __init__(self) -> None:
        self._events: dict[int, DisabledEvent] = {}
        self._next_id: int = 1

    def insert(self, event: DisabledEvent) -> DisabledEvent:
        event.id = self._next_id
        self._next_id += 1
        self._events[event.id] = event
        return event

    def latest_unresolved_for_strategy(
        self, strategy: str, layer: int | None = None
    ) -> DisabledEvent | None:
        candidates = [
            ev for ev in self._events.values()
            if ev.strategy == strategy
            and ev.resolved_at is None
            and (layer is None or ev.layer == layer)
        ]
        if not candidates:
            return None
        return max(candidates, key=lambda ev: ev.triggered_at)

    def resolve(self, event_id: int, resolved_by: str) -> None:
        if event_id not in self._events:
            return
        self._events[event_id].resolved_at = datetime.now(timezone.utc)
        self._events[event_id].resolved_by = resolved_by
