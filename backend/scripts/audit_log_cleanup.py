"""Audit-log retention sweeper (Wave 4Q — persona-103 P1 #3).

Enforces a per-event retention window on ``audit_log``.  Before this
script the table had no retention policy at all — the default behaviour
of "keep everything forever" was on paper good for forensics, but in
practice two problems tore at it:

1. **GDPR / CCPA.** Indefinite retention without a compelling
   justification is a bar failure under Art. 5(1)(e) ("storage
   limitation").  The table has to shrink on a schedule.
2. **Row volume.** ``login`` / ``refresh`` / ``logout`` are the hottest
   emitters — each successful auth event pushes one row.  At even
   modest traffic a multi-year table will move the indexes out of
   hot-cache, which degrades the "everything user X did in the last
   hour" query that every compliance dashboard depends on.

Retention tiers (by ``event`` column):

============================== ==========  ===================================
event                          days        rationale
============================== ==========  ===================================
login, logout, refresh,        90          Hot auth events — 90d is plenty
  token_revoked                            for incident-response timelines.

halt_trading, resume_trading,  2190 (6y)   SEC 17a-4(b)(1-4) minimum
  wash_trade_reject,                       retention for trading records.
  restricted_symbol_reject,                (2190 = 365 × 6; we don't
  live_gate_reject                         bother with leap-year adjust.)

data_export, user_erase        730 (2y)    GDPR-mandated traces of
                                           rights-request fulfilment.

<everything else>              365 (1y)    Default.  Covers totp_enroll,
                                           change_password, etc.
============================== ==========  ===================================

This script is idempotent: running it twice in a row on the same table
is a no-op the second time.  Safe to schedule daily OR weekly.  The
recommended cadence is WEEKLY (see ``schedule_lifespan_task``) because
a daily sweep buys almost nothing on a single-admin deployment and
weekly keeps the DB-churn overhead near zero.

Usage:
    # One-shot manual run (CLI)
    python -m scripts.audit_log_cleanup

    # Embedded mode — import from ``main.py`` lifespan
    from scripts.audit_log_cleanup import schedule_lifespan_task
    await schedule_lifespan_task()
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger("alphadesk.audit_cleanup")


# ---------------------------------------------------------------------------
# Retention policy table — the single source of truth for this module.
# ---------------------------------------------------------------------------
# Each key is an event string; the value is the retention in days.  Events
# NOT listed fall through to ``DEFAULT_RETENTION_DAYS``.  Keeping the map
# explicit (rather than buried in conditionals) makes it trivial to audit:
# git-blame this module and you have the full compliance trail of every
# policy change.

RETENTION_DAYS_BY_EVENT: dict[str, int] = {
    # Hot auth events — 90d.
    "login": 90,
    "logout": 90,
    "refresh": 90,
    "token_revoked": 90,
    # SEC 17a-4 / FINRA 4530 — 6 years.  These MUST survive any user
    # erasure request too; see ``api/routes/user.py``'s
    # ``_RETAINED_COMPLIANCE_EVENTS`` for the mirror list.
    "halt_trading": 365 * 6,
    "resume_trading": 365 * 6,
    "wash_trade_reject": 365 * 6,
    "restricted_symbol_reject": 365 * 6,
    "live_gate_reject": 365 * 6,
    # Rights-request traces — 2 years.
    "data_export": 365 * 2,
    "user_erase": 365 * 2,
}

DEFAULT_RETENTION_DAYS: int = 365  # 1 year fallback

# Redis lock TTL — longer than the worst-case sweep duration so that a
# mid-sweep process crash does NOT immediately release the lock to another
# worker (which would then double-sweep, which is safe but wasteful).
_LOCK_KEY = "audit_log_cleanup:lock"
_LOCK_TTL_SECONDS = 60 * 30  # 30 minutes

# Lifespan-mode sweep cadence.  Weekly is the pragmatic cadence for a
# single-admin deployment; any delete budget we save by running daily
# would be dwarfed by the schedule noise.
_SWEEP_INTERVAL_SECONDS = 60 * 60 * 24 * 7  # 7 days


# ---------------------------------------------------------------------------
# Core sweep
# ---------------------------------------------------------------------------


async def sweep_once() -> dict[str, int]:
    """Delete every ``audit_log`` row that has aged past its retention.

    Returns a ``{event: rows_deleted}`` map so the caller (or the
    structured log line this function emits) can see what moved.

    Implementation notes:

    * One DELETE statement per event tier.  Batching all events into a
      single ``CASE WHEN`` expression would work but produces an opaque
      query plan; separate statements are easier to explain to an
      auditor and each takes its own row-count metric.
    * The default tier (``event NOT IN (...)``) runs LAST so it only
      touches rows the explicit tiers haven't already handled.
    * ``retained_for_compliance = TRUE`` rows are NEVER swept,
      regardless of their event tier or age.  Those are tombstones
      from an erasure request (see ``api/routes/user.py``) and must
      survive for regulatory review.
    """
    from sqlalchemy import and_, delete as sa_delete

    from core.config import settings
    from core.database import _get_session_factory
    from data.storage.models import AuditLog

    if settings.SKIP_DB_INIT:
        # In degraded mode there is no DB to sweep.  Log and return the
        # empty tally so the caller's metrics pipeline gets a uniform
        # shape.
        logger.info("audit_log_cleanup: SKIP_DB_INIT is set — no-op sweep")
        return {}

    now = datetime.now(timezone.utc)
    tally: dict[str, int] = {}

    factory = _get_session_factory()
    async with factory() as session:
        # Explicit per-event tiers FIRST.
        for event, retention_days in RETENTION_DAYS_BY_EVENT.items():
            cutoff = now - timedelta(days=retention_days)
            stmt = sa_delete(AuditLog).where(
                and_(
                    AuditLog.event == event,
                    AuditLog.ts < cutoff,
                    AuditLog.retained_for_compliance.is_(False),
                )
            )
            res = await session.execute(stmt)
            deleted = int(res.rowcount or 0)
            if deleted:
                tally[event] = deleted

        # Default tier — everything we didn't list explicitly.  The NOT
        # IN clause mirrors RETENTION_DAYS_BY_EVENT.keys() so the set is
        # stable against future policy edits.
        #
        # Wave 6α Fix 4 (persona-124 P1): the ``(event, ts DESC)`` index
        # CANNOT serve ``event NOT IN (...)`` — Postgres has to seq-scan
        # the whole ``audit_log`` table to eliminate rows by anti-match.
        # Alembic migration ``0008_trade_ledger_perf_indexes`` adds a
        # partial index scoped to the exact predicate used here:
        #
        #     CREATE INDEX ix_audit_log_default_cleanup
        #         ON audit_log (ts)
        #         WHERE retained_for_compliance IS FALSE
        #
        # That turns the default-tier DELETE into a bounded index range
        # scan over ``ts < cutoff``.  We also rely on the explicit
        # per-event tiers above having already pruned the known events
        # within their own (event, ts) index, so the default scan only
        # touches rows the planner deems relevant.
        known_events = list(RETENTION_DAYS_BY_EVENT.keys())
        cutoff = now - timedelta(days=DEFAULT_RETENTION_DAYS)
        stmt = sa_delete(AuditLog).where(
            and_(
                AuditLog.event.notin_(known_events),
                AuditLog.ts < cutoff,
                AuditLog.retained_for_compliance.is_(False),
            )
        )
        res = await session.execute(stmt)
        deleted = int(res.rowcount or 0)
        if deleted:
            tally["__default__"] = deleted

        await session.commit()

    total = sum(tally.values())
    logger.info(
        "audit_log_cleanup swept %d rows across %d event tiers",
        total,
        len(tally),
        extra={"event": "audit_cleanup_sweep", "tally": tally},
    )
    return tally


# ---------------------------------------------------------------------------
# Redis-locked scheduling — prevents concurrent sweeps across multi-worker
# deployments.
# ---------------------------------------------------------------------------


async def _acquire_lock() -> str | None:
    """Acquire a Redis-based sweep lock.

    Returns the lock token on success, ``None`` if another worker
    already holds it.  Uses ``SET key value NX EX ttl`` — the canonical
    Redlock-lite pattern.  Token is a UUID so a buggy release can't
    free a lock held by somebody else (we check the token before
    DELETE).
    """
    import uuid
    try:
        from core.redis import get_redis
        r = await get_redis()
    except Exception:
        logger.warning("audit_log_cleanup: redis unavailable, skipping lock")
        return None

    token = uuid.uuid4().hex
    try:
        ok = await r.set(_LOCK_KEY, token, nx=True, ex=_LOCK_TTL_SECONDS)
        return token if ok else None
    except Exception:
        logger.warning("audit_log_cleanup: lock acquisition raised", exc_info=True)
        return None


async def _release_lock(token: str) -> None:
    """Release the sweep lock if and only if we still hold it.

    Reads the current token, compares to ours, and deletes only on
    match.  Not atomic with a simple GET+DEL but good enough here: the
    only race we guard against is a DIFFERENT worker picking up the
    lock because ours expired, and that worker will refuse to delete
    our token via the same check.
    """
    try:
        from core.redis import get_redis
        r = await get_redis()
        current = await r.get(_LOCK_KEY)
        if current == token:
            await r.delete(_LOCK_KEY)
    except Exception:
        logger.warning("audit_log_cleanup: lock release raised", exc_info=True)


async def run_locked_sweep() -> dict[str, int]:
    """Acquire the Redis lock, run a sweep, release the lock.

    Returns the tally from ``sweep_once`` on success, or an empty dict
    if the lock could not be acquired (another worker is sweeping).
    """
    token = await _acquire_lock()
    if token is None:
        logger.info("audit_log_cleanup: another worker holds the lock — skipping")
        return {}
    try:
        return await sweep_once()
    finally:
        await _release_lock(token)


async def schedule_lifespan_task() -> asyncio.Task[Any]:
    """Spawn a background task that sweeps on ``_SWEEP_INTERVAL_SECONDS``.

    Intended to be called from ``main.py``'s ``lifespan`` — each worker
    launches the task, the Redis lock ensures only one worker actually
    deletes.  The task is daemon-style: its reference is returned so
    lifespan can ``.cancel()`` it on shutdown.

    A brief initial sleep (``_SWEEP_JITTER``) means workers starting in
    lockstep don't all pile onto the lock at boot.
    """
    import random

    async def _loop() -> None:
        # Jitter the first sweep so workers started together don't
        # contend on the lock simultaneously.
        jitter = random.uniform(0, 60)
        await asyncio.sleep(jitter)
        while True:
            try:
                await run_locked_sweep()
            except Exception:
                logger.warning(
                    "audit_log_cleanup: sweep raised, will retry next tick",
                    exc_info=True,
                )
            await asyncio.sleep(_SWEEP_INTERVAL_SECONDS)

    task = asyncio.create_task(_loop(), name="audit_log_cleanup")
    return task


# ---------------------------------------------------------------------------
# CLI entry point — ``python -m scripts.audit_log_cleanup``.
# ---------------------------------------------------------------------------


async def _main() -> None:
    """One-shot CLI entry point.  Does NOT acquire the lock because an
    operator-initiated run is intentional and should not be starved by
    a concurrent scheduled sweep.
    """
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    tally = await sweep_once()
    total = sum(tally.values())
    print(f"Swept {total} rows: {tally}")


if __name__ == "__main__":
    asyncio.run(_main())
