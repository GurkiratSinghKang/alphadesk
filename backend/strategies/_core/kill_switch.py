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


class KillSwitch:
    """The three-layer kill-switch.

    Default thresholds are conservative and safe for the initial live flip.
    Per-strategy overrides can be set via ``StrategyMeta.kill_switch_overrides``
    (a follow-on plan); for now, all strategies share the defaults.
    """

    DEFAULT_LAYER1_THRESHOLD: float = -0.08  # -8% drawdown
    DEFAULT_LAYER2_THRESHOLD: float = -0.02  # -2% of allocated capital realized

    def __init__(
        self,
        repo: DisabledEventsRepo,
        layer1_threshold: float | None = None,
        layer2_threshold: float | None = None,
    ) -> None:
        self.repo = repo
        # Constructor-supplied thresholds win when set (test paths,
        # back-compat). When None, the per-call resolver in
        # ``_resolve_layer{1,2}_threshold`` reads
        # ``core.config.get_strategy_layer*_threshold(strategy)`` so
        # operators can tune a single strategy's thresholds at runtime
        # via the env config or the admin overlay endpoint.
        self._ctor_layer1_threshold = layer1_threshold
        self._ctor_layer2_threshold = layer2_threshold
        self.layer1_threshold = (
            layer1_threshold if layer1_threshold is not None else self.DEFAULT_LAYER1_THRESHOLD
        )
        self.layer2_threshold = (
            layer2_threshold if layer2_threshold is not None else self.DEFAULT_LAYER2_THRESHOLD
        )

    def _resolve_layer1_threshold(self, strategy: str) -> float:
        """Per-strategy Layer 1 threshold resolver.

        Precedence: constructor-supplied value (tests / bench) →
        per-strategy config (overlay → env → default). Returns a
        non-positive float (-0.08 = -8%).
        """
        if self._ctor_layer1_threshold is not None:
            return float(self._ctor_layer1_threshold)
        try:
            from core.config import get_strategy_layer1_threshold
            return float(get_strategy_layer1_threshold(strategy))
        except Exception:
            return float(self.DEFAULT_LAYER1_THRESHOLD)

    def _resolve_layer2_threshold(self, strategy: str) -> float:
        if self._ctor_layer2_threshold is not None:
            return float(self._ctor_layer2_threshold)
        try:
            from core.config import get_strategy_layer2_threshold
            return float(get_strategy_layer2_threshold(strategy))
        except Exception:
            return float(self.DEFAULT_LAYER2_THRESHOLD)

    # -- Layer 1: drawdown from peak NAV ----------------------------------

    def check_layer1_drawdown(self, strategy: str, ctx: KillSwitchContext) -> Decision:
        if ctx.peak_nav <= 0.0:
            return Decision(
                enabled=True,
                layer=0,
                reason="layer1: peak_nav <= 0, no DD definable",
                metrics={"peak_nav": ctx.peak_nav, "current_nav": ctx.current_nav},
            )
        dd = (ctx.current_nav - ctx.peak_nav) / ctx.peak_nav
        threshold = self._resolve_layer1_threshold(strategy)
        if dd > threshold:
            return Decision(
                enabled=True,
                layer=0,
                reason=f"layer1: dd {dd:.2%} > threshold {threshold:.2%}",
                metrics={"peak_nav": ctx.peak_nav, "current_nav": ctx.current_nav, "dd": dd},
            )
        # Triggered: log idempotently, return disabled
        existing = self.repo.latest_unresolved_for_strategy(strategy, layer=1)
        if existing is None:
            self.repo.insert(
                DisabledEvent(
                    id=None,
                    strategy=strategy,
                    layer=1,
                    triggered_at=datetime.now(timezone.utc),
                    peak_nav=ctx.peak_nav,
                    current_nav=ctx.current_nav,
                    threshold=threshold,
                    reason=f"dd {dd:.2%} <= threshold {threshold:.2%}",
                )
            )
        return Decision(
            enabled=False,
            layer=1,
            reason=f"layer1: dd {dd:.2%} <= threshold {threshold:.2%}",
            metrics={"peak_nav": ctx.peak_nav, "current_nav": ctx.current_nav, "dd": dd},
        )

    # -- Layer 2: daily realized PnL as fraction of allocated capital -----

    def check_layer2_daily_pnl(self, strategy: str, ctx: KillSwitchContext) -> Decision:
        if ctx.alloc_capital <= 0.0:
            return Decision(
                enabled=True,
                layer=0,
                reason="layer2: alloc_capital <= 0, no ratio definable",
                metrics={"alloc_capital": ctx.alloc_capital, "realized_today": ctx.realized_today},
            )
        ratio = ctx.realized_today / ctx.alloc_capital
        threshold = self._resolve_layer2_threshold(strategy)
        if ratio > threshold:
            return Decision(
                enabled=True,
                layer=0,
                reason=f"layer2: ratio {ratio:.2%} > threshold {threshold:.2%}",
                metrics={"alloc_capital": ctx.alloc_capital, "realized_today": ctx.realized_today, "ratio": ratio},
            )
        existing = self.repo.latest_unresolved_for_strategy(strategy, layer=2)
        if existing is None:
            self.repo.insert(
                DisabledEvent(
                    id=None,
                    strategy=strategy,
                    layer=2,
                    triggered_at=datetime.now(timezone.utc),
                    realized_pnl=ctx.realized_today,
                    alloc_capital=ctx.alloc_capital,
                    threshold=threshold,
                    reason=f"daily PnL {ratio:.2%} <= threshold {threshold:.2%}",
                )
            )
        return Decision(
            enabled=False,
            layer=2,
            reason=f"layer2: ratio {ratio:.2%} <= threshold {threshold:.2%}",
            metrics={"alloc_capital": ctx.alloc_capital, "realized_today": ctx.realized_today, "ratio": ratio},
        )

    # -- Layer 3: manual emergency disable --------------------------------

    def check_layer3_manual(self, strategy: str) -> Decision:
        ev = self.repo.latest_unresolved_for_strategy(strategy, layer=3)
        if ev is None:
            return Decision(
                enabled=True,
                layer=0,
                reason="layer3: no unresolved manual event",
                metrics={},
            )
        return Decision(
            enabled=False,
            layer=3,
            reason=f"layer3: manual disable — {ev.reason or 'no reason given'}",
            metrics={
                "event_id": ev.id,
                "manual_actor": ev.manual_actor,
                "triggered_at": ev.triggered_at.isoformat() if ev.triggered_at else None,
            },
        )

    # -- Composite + manual operations ------------------------------------

    def is_enabled(self, strategy: str, ctx: KillSwitchContext) -> Decision:
        """Run all three layers; return the FIRST disabled, else enabled.

        Short-circuits on first failure: subsequent layers are not checked,
        which keeps logging idempotent and matches "if the strategy is
        already disabled by Layer 1, don't bother checking Layer 2".
        """
        d1 = self.check_layer1_drawdown(strategy, ctx)
        if not d1.enabled:
            return d1
        d2 = self.check_layer2_daily_pnl(strategy, ctx)
        if not d2.enabled:
            return d2
        d3 = self.check_layer3_manual(strategy)
        if not d3.enabled:
            return d3
        return Decision(
            enabled=True,
            layer=0,
            reason="all layers passed",
            metrics={
                "peak_nav": ctx.peak_nav,
                "current_nav": ctx.current_nav,
                "alloc_capital": ctx.alloc_capital,
                "realized_today": ctx.realized_today,
            },
        )

    # -- Async variants (live pipeline hot path) --------------------------
    # The production pipeline runner (`DailyPipelineRunner.run_today`) is
    # async, and the production repo (`PostgresDisabledEventsRepo`) is
    # natively async — these helpers let the runner await the async repo
    # methods directly instead of bouncing through the sync facade's
    # thread-pool bridge on every layer-3 check.
    #
    # Sync `is_enabled` remains for back-compat (CLI scripts, in-memory
    # repos in unit tests, the disable_manual / re_enable admin helpers).

    async def check_layer3_manual_async(self, strategy: str) -> Decision:
        repo_get = getattr(
            self.repo, "latest_unresolved_for_strategy_async", None
        )
        if repo_get is not None:
            ev = await repo_get(strategy, 3)
        else:
            ev = self.repo.latest_unresolved_for_strategy(strategy, layer=3)
        if ev is None:
            return Decision(
                enabled=True,
                layer=0,
                reason="layer3: no unresolved manual event",
                metrics={},
            )
        return Decision(
            enabled=False,
            layer=3,
            reason=f"layer3: manual disable — {ev.reason or 'no reason given'}",
            metrics={
                "event_id": ev.id,
                "manual_actor": ev.manual_actor,
                "triggered_at": ev.triggered_at.isoformat() if ev.triggered_at else None,
            },
        )

    async def is_enabled_async(self, strategy: str, ctx: KillSwitchContext) -> Decision:
        """Async variant of :meth:`is_enabled` for use from the live runner.

        Layer 1 + Layer 2 do not consult the repo on the happy path (they
        only insert when triggered, and that insert is fire-and-forget via
        the sync facade — same as today). Layer 3 is the only path that
        reads the repo on every tick, so awaiting the native async query
        here removes the per-tick thread-pool round-trip.
        """
        d1 = self.check_layer1_drawdown(strategy, ctx)
        if not d1.enabled:
            return d1
        d2 = self.check_layer2_daily_pnl(strategy, ctx)
        if not d2.enabled:
            return d2
        d3 = await self.check_layer3_manual_async(strategy)
        if not d3.enabled:
            return d3
        return Decision(
            enabled=True,
            layer=0,
            reason="all layers passed",
            metrics={
                "peak_nav": ctx.peak_nav,
                "current_nav": ctx.current_nav,
                "alloc_capital": ctx.alloc_capital,
                "realized_today": ctx.realized_today,
            },
        )

    def disable_manual(self, strategy: str, actor: str, reason: str) -> DisabledEvent | None:
        """Insert a layer-3 event. No-op if already disabled.

        Returns the new event, or ``None`` if the strategy already had an
        unresolved layer-3 event (idempotent).
        """
        existing = self.repo.latest_unresolved_for_strategy(strategy, layer=3)
        if existing is not None:
            return None
        event = self.repo.insert(
            DisabledEvent(
                id=None,
                strategy=strategy,
                layer=3,
                triggered_at=datetime.now(timezone.utc),
                manual_actor=actor,
                reason=reason,
            )
        )
        # Audit P0-5 (2026-05-05): page oncall when Layer 3 (manual
        # emergency disable) trips. Layer 3 is the "operator pulled the
        # red handle" path — by definition someone is responding, but a
        # PagerDuty page wakes a co-oncall to double-cover the response
        # and the alert lands in the durable incident channel.
        # Fire-and-forget: this is sync code, so we kick the coroutine
        # via a fresh event loop in a worker thread when there's no
        # loop already running, otherwise schedule it as a background
        # task on the running loop.
        try:
            _fire_layer3_alert(strategy, actor, reason)
        except Exception:
            import logging as _logging
            _logging.getLogger(__name__).error(
                "Layer-3 alert dispatch raised", exc_info=True
            )
        return event

    def re_enable(self, strategy: str, actor: str) -> None:
        """Resolve the strategy's most recent unresolved layer-3 event.

        No-op if the strategy has no active layer-3 disable.
        """
        existing = self.repo.latest_unresolved_for_strategy(strategy, layer=3)
        if existing is None or existing.id is None:
            return
        self.repo.resolve(existing.id, resolved_by=actor)


class PostgresDisabledEventsRepo:
    """Async-Postgres implementation of ``DisabledEventsRepo``.

    Note on async vs sync API: the in-memory repo exposes sync methods to
    keep unit tests simple; this class adds ``_async`` variants for production
    callers (the pipeline runner is async). For the sync interface required by
    ``KillSwitch``, a thin ``run_until_complete`` facade is provided.

    Notes carried forward from the Task 3 spec/quality review:
    - ``insert_async`` uses ``RETURNING id`` (no second SELECT)
    - ``latest_unresolved_for_strategy_async`` orders by ``triggered_at DESC, id DESC``
      so simultaneous events get a deterministic tiebreaker
    - ``resolve_async`` is a no-op on unknown id (matches in-memory semantics;
      the column-level audit trail is the source of truth)
    """

    def __init__(self, session: Any) -> None:  # AsyncSession
        self.session = session

    async def insert_async(self, event: DisabledEvent) -> DisabledEvent:
        from sqlalchemy import text
        result = await self.session.execute(
            text("""
                INSERT INTO strategy_disabled_events
                (strategy, layer, triggered_at, peak_nav, current_nav,
                 realized_pnl, alloc_capital, threshold, manual_actor, reason)
                VALUES (:strategy, :layer, :triggered_at, :peak_nav, :current_nav,
                        :realized_pnl, :alloc_capital, :threshold, :manual_actor, :reason)
                RETURNING id
            """),
            {
                "strategy": event.strategy,
                "layer": event.layer,
                "triggered_at": event.triggered_at,
                "peak_nav": event.peak_nav,
                "current_nav": event.current_nav,
                "realized_pnl": event.realized_pnl,
                "alloc_capital": event.alloc_capital,
                "threshold": event.threshold,
                "manual_actor": event.manual_actor,
                "reason": event.reason,
            },
        )
        row = result.fetchone()
        await self.session.commit()
        event.id = int(row[0])
        return event

    async def latest_unresolved_for_strategy_async(
        self, strategy: str, layer: int | None = None
    ) -> DisabledEvent | None:
        from sqlalchemy import text
        if layer is not None:
            result = await self.session.execute(
                text("""
                    SELECT id, strategy, layer, triggered_at, peak_nav, current_nav,
                           realized_pnl, alloc_capital, threshold, manual_actor, reason,
                           resolved_at, resolved_by
                    FROM strategy_disabled_events
                    WHERE strategy = :strategy
                      AND layer = :layer
                      AND resolved_at IS NULL
                    ORDER BY triggered_at DESC, id DESC
                    LIMIT 1
                """),
                {"strategy": strategy, "layer": layer},
            )
        else:
            result = await self.session.execute(
                text("""
                    SELECT id, strategy, layer, triggered_at, peak_nav, current_nav,
                           realized_pnl, alloc_capital, threshold, manual_actor, reason,
                           resolved_at, resolved_by
                    FROM strategy_disabled_events
                    WHERE strategy = :strategy
                      AND resolved_at IS NULL
                    ORDER BY triggered_at DESC, id DESC
                    LIMIT 1
                """),
                {"strategy": strategy},
            )
        row = result.fetchone()
        if row is None:
            return None
        return DisabledEvent(
            id=row[0], strategy=row[1], layer=row[2], triggered_at=row[3],
            peak_nav=row[4], current_nav=row[5], realized_pnl=row[6],
            alloc_capital=row[7], threshold=row[8], manual_actor=row[9],
            reason=row[10], resolved_at=row[11], resolved_by=row[12],
        )

    async def resolve_async(self, event_id: int, resolved_by: str) -> None:
        from sqlalchemy import text
        await self.session.execute(
            text("""
                UPDATE strategy_disabled_events
                SET resolved_at = NOW(),
                    resolved_by = :resolved_by
                WHERE id = :event_id
            """),
            {"event_id": event_id, "resolved_by": resolved_by},
        )
        await self.session.commit()

    # Sync facade: KillSwitch is sync but the underlying SQLAlchemy
    # session is async. Audit B-F4 / R-F2 (2026-05-05): the previous
    # implementation called ``asyncio.get_event_loop().run_until_complete(...)``
    # which raises ``RuntimeError: This event loop is already running``
    # when the caller is itself in an async context (e.g. the kill-switch
    # layer-3 check now wired into pipeline_runner.run_for_strategy is
    # async). The bridge below detects whether a loop is running and
    # routes the async coro through a thread-pool executor in that case
    # so we never re-enter a running loop.
    def insert(self, event: DisabledEvent) -> DisabledEvent:
        return _run_async_from_sync(self.insert_async(event))

    def latest_unresolved_for_strategy(
        self, strategy: str, layer: int | None = None
    ) -> DisabledEvent | None:
        return _run_async_from_sync(
            self.latest_unresolved_for_strategy_async(strategy, layer)
        )

    def resolve(self, event_id: int, resolved_by: str) -> None:
        _run_async_from_sync(self.resolve_async(event_id, resolved_by))


def _fire_layer3_alert(strategy: str, actor: str, reason: str) -> None:
    """Fan out a Layer-3 manual-disable alert via the oncall dispatcher.

    Audit P0-5 (2026-05-05). The kill-switch is sync-callable (the
    in-memory repo path, the admin route, CLI scripts) but the alert
    dispatcher is async. This helper does the same trick as
    :func:`_run_async_from_sync` but as fire-and-forget — the manual
    disable itself has already succeeded by the time we get here, so
    blocking on alert delivery would harm response latency for no win.
    """
    import asyncio

    async def _run() -> None:
        try:
            from services.alerts import (
                Alert,
                AlertSeverity,
                fire_alert,
            )

            await fire_alert(Alert(
                severity=AlertSeverity.P0,
                title=f"Kill-switch Layer-3 manual disable: {strategy}",
                description=(
                    f"Strategy {strategy} disabled by {actor}. "
                    f"Reason: {reason}. See "
                    "docs/RUNBOOK-alerts.md#kill-switch-layer-3"
                ),
                source="kill_switch.layer3",
                deduplication_key=f"kill_switch.layer3.{strategy}",
                occurred_at=datetime.now(timezone.utc),
                metadata={
                    "strategy": strategy,
                    "actor": actor,
                    "reason": reason,
                },
            ))
        except Exception:
            import logging as _logging
            _logging.getLogger(__name__).error(
                "Layer-3 fire_alert raised", exc_info=True
            )

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No loop — synchronous caller. Spin one up briefly.
        try:
            asyncio.run(_run())
        except Exception:
            pass
        return
    # Loop running — schedule as fire-and-forget background task.
    loop.create_task(_run())


def _run_async_from_sync(coro: Any) -> Any:
    """Run an async coroutine from a sync context.

    Audit B-F4 / R-F2 fix: works both inside and outside a running
    event loop. When called from an async context (the typical case
    now that the kill-switch is consulted from the async pipeline
    runner), schedules the coroutine on a fresh event loop in a
    worker thread — the calling event loop is never blocked or
    re-entered. Outside an event loop (e.g. ad-hoc CLI scripts),
    runs the coro directly via ``asyncio.run``.
    """
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    # Inside a running loop — bounce to a thread with its own loop.
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(asyncio.run, coro).result()
