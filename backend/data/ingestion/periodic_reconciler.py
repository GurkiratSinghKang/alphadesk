"""Background periodic broker/ledger reconciler (Wave 6β Fix 1, P117).

Closes the broker-vs-ledger split window that ``reconcile_on_boot`` in
``backend/api/routes/trades.py`` only ever catches on the next restart.

The split window
----------------
``POST /api/v1/trades/`` submits to Alpaca at line ~937 and then writes
the local ledger row at lines ~1092-1098.  If the container is hit with
``kill -9`` (OOM, segfault, forced redeploy) *between* those two steps,
the broker has an accepted order but the local DB has no row.  The Trade
row for that order is born only when a user retries, which they often
don't.

Until this module landed the only remediation was ``reconcile_on_boot``
— which only fires on the NEXT backend start.  In the worst case that's
hours or days after the split, long after the fill has already been
mis-counted in P&L.

What this module does
---------------------
Every 3 hours (``_RECONCILE_INTERVAL_SECONDS``), spin through active
per-user Alpaca connections and call ``_reconcile_last_24h`` with
``since = now - 3h``.  The reconciler now queues broker/local mismatches
as ``reconciliation_issues`` rows instead of silently mutating the local
ledger.  Users approve or reject those proposed changes from Settings.

Redis lock
----------
Guarded by a Redis-based lock (``_LOCK_KEY``) using the same Redlock-lite
pattern as ``scripts/audit_log_cleanup.py``.  In a multi-worker deployment
this ensures only ONE worker reconciles at each tick — otherwise every
worker would concurrently backfill the same Alpaca orders and the last
writer would win against an optimistic-lock storm.

Pending-flatten drain
---------------------
At every tick (regardless of whether we own the lock) we also call
``pending_flatten_drain.check_and_drain_pending_flatten``.  That helper
is idempotent, cheap (a single ``halt_state`` row read), and carries its
own Redis lock, so running it on every worker at every tick is safe —
it exits as a no-op unless ``pending_flatten = TRUE AND market_open``.

Wire-up
-------
``backend/main.py`` lifespan:

    await start_fill_reconciler()         # consumer of trade_updates
    await start_periodic_reconciler()     # <-- AFTER boot reconcile so
                                          #     the first tick doesn't
                                          #     race the boot path.

and the reverse on shutdown.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

# How long between cycles.  User-facing reconciliation is intentionally
# review-gated, so a 3-hour cadence keeps broker calls light while still
# catching drift within the same trading day.
_RECONCILE_INTERVAL_SECONDS: int = 3 * 60 * 60

# Window passed to ``_reconcile_last_24h``.  Matches the 3-hour tick so a
# normal cycle rechecks the period since the last run.  The boot path still
# owns the longer cursor-driven catch-up window.
_LIVE_RECONCILE_WINDOW = timedelta(hours=3)

# Redis lock for multi-worker safety.  Token-scoped release matches the
# audit_log_cleanup pattern (UUID token; DELETE only if value == token).
# Lock TTL > expected run duration so a process crash doesn't instantly
# let another worker start a new reconcile while the broker-state for
# the previous one is still in flux.
_LOCK_KEY: str = "periodic_reconciler:lock"
_LOCK_TTL_SECONDS: int = 90  # reconcile typically < 5s; 90s covers slow broker

# Initial jitter so workers starting in lockstep (compose up) don't all
# hit the first tick simultaneously.
_INITIAL_JITTER_SECONDS: float = 15.0


# ---------------------------------------------------------------------------
# Module state — mirrors fill_reconciler's idempotent start/stop pattern.
# ---------------------------------------------------------------------------

_task: asyncio.Task | None = None
_should_stop: bool = False


# ---------------------------------------------------------------------------
# Redis lock helpers
# ---------------------------------------------------------------------------


async def _acquire_lock() -> str | None:
    """Acquire the Redis-based reconcile lock.

    Returns a UUID token on success, ``None`` if another worker already
    holds the lock.  Same SET NX EX pattern as
    ``scripts/audit_log_cleanup._acquire_lock``.
    """
    try:
        from core.redis import get_redis
        r = await get_redis()
    except Exception:
        logger.debug(
            "periodic_reconciler: redis unavailable; skipping lock",
            exc_info=True,
        )
        return None
    if r is None:
        return None

    token = uuid.uuid4().hex
    try:
        ok = await r.set(_LOCK_KEY, token, nx=True, ex=_LOCK_TTL_SECONDS)
        return token if ok else None
    except Exception:
        logger.warning(
            "periodic_reconciler: lock acquisition raised", exc_info=True,
        )
        return None


async def _release_lock(token: str) -> None:
    """Release the lock iff we still own it.  Matches audit_log_cleanup."""
    try:
        from core.redis import get_redis
        r = await get_redis()
        if r is None:
            return
        current = await r.get(_LOCK_KEY)
        if current == token:
            await r.delete(_LOCK_KEY)
    except Exception:
        logger.debug(
            "periodic_reconciler: lock release raised", exc_info=True,
        )


# ---------------------------------------------------------------------------
# Core tick
# ---------------------------------------------------------------------------


async def _active_reconcile_usernames() -> list[str]:
    """Return users with active Alpaca connections.

    Best-effort: if the database is unavailable, fall back to the legacy
    env-backed single-account reconcile path by returning an empty list.
    """
    try:
        from core.config import settings
        if settings.SKIP_DB_INIT:
            return []
        from sqlalchemy import select
        from core.database import _get_session_factory
        from data.storage.models import BrokerConnection

        factory = _get_session_factory()
        async with factory() as db:
            rows = (
                await db.execute(
                    select(BrokerConnection.username)
                    .where(BrokerConnection.provider == "alpaca")
                    .where(BrokerConnection.status == "active")
                    .distinct()
                )
            ).scalars().all()
        return sorted({str(username) for username in rows if username})
    except Exception:
        logger.debug(
            "periodic_reconciler: active-user lookup failed; using env fallback",
            exc_info=True,
        )
        return []


def _merge_counts(target: dict[str, int], delta: dict[str, int]) -> None:
    for key in ("backfilled", "orphaned", "matched"):
        target[key] = target.get(key, 0) + int(delta.get(key, 0))


async def start_periodic_reconciler() -> None:
    """Start the background reconciler task.  Idempotent.

    Matches the ``start_fill_reconciler`` / ``stop_fill_reconciler``
    contract so the lifespan code in ``main.py`` treats all ingestion
    supervisors uniformly.
    """
    global _task, _should_stop
    if _task is not None and not _task.done():
        logger.debug("periodic_reconciler: already running")
        return
    _should_stop = False
    # Round-11 / BB-13: supervised so a silent death surfaces at ERROR.
    from core.supervised_task import create_supervised_task

    _task = create_supervised_task(
        _reconciler_loop(), name="periodic_reconciler"
    )
    logger.info(
        "periodic_reconciler: started (interval=%ds, window=%s)",
        _RECONCILE_INTERVAL_SECONDS, _LIVE_RECONCILE_WINDOW,
    )


async def stop_periodic_reconciler() -> None:
    """Cancel the reconciler task and wait for clean exit.  Idempotent."""
    global _task, _should_stop
    _should_stop = True
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):
        pass
    _task = None
    logger.info("periodic_reconciler: stopped")


async def _run_one_cycle() -> dict[str, int]:
    """Run a single reconcile cycle + pending-flatten drain.

    Returns the counts dict from ``_reconcile_last_24h`` (possibly empty
    when another worker held the lock).  Exposed separately so tests can
    exercise the per-tick path without the asyncio loop.
    """
    # ---- Broker-vs-ledger reconcile (lock-guarded) -----------------
    token = await _acquire_lock()
    counts: dict[str, int] = {"backfilled": 0, "orphaned": 0, "matched": 0}
    if token is None:
        logger.debug(
            "periodic_reconciler: lock held by another worker — skipping reconcile",
        )
    else:
        try:
            # Lazy import — ``trades`` imports ``master_agent`` which imports
            # ``daily_pipeline`` → circular chain at module load. Import inside
            # the function to break the cycle (same pattern used by the
            # ``trades._is_trading_halted`` thin wrapper).
            from api.routes.trades import _reconcile_last_24h
            since = datetime.now(timezone.utc) - _LIVE_RECONCILE_WINDOW
            usernames = await _active_reconcile_usernames()
            if usernames:
                counts = {"backfilled": 0, "orphaned": 0, "matched": 0}
                for reconcile_username in usernames:
                    user_counts = await _reconcile_last_24h(
                        since=since,
                        username=reconcile_username,
                    )
                    _merge_counts(counts, user_counts)
            else:
                counts = await _reconcile_last_24h(since=since)
            logger.info(
                "periodic_reconciler: reconcile — since=%s users=%d backfilled=%d orphaned=%d matched=%d",
                since.isoformat(),
                len(usernames),
                counts.get("backfilled", 0),
                counts.get("orphaned", 0),
                counts.get("matched", 0),
            )
        except Exception:
            logger.warning(
                "periodic_reconciler: reconcile raised (non-fatal)",
                exc_info=True,
            )
        finally:
            await _release_lock(token)

    # ---- Pending-flatten drain (carries its own lock) --------------
    # Run every tick regardless of whether we own the reconcile lock —
    # the drain helper is idempotent + Redis-locked internally.
    try:
        from data.ingestion.pending_flatten_drain import (
            check_and_drain_pending_flatten,
        )
        await check_and_drain_pending_flatten()
    except Exception:
        logger.warning(
            "periodic_reconciler: pending_flatten_drain raised",
            exc_info=True,
        )

    return counts


async def _reconciler_loop() -> None:
    """Long-running periodic loop.  Resilient to transient failures."""
    global _should_stop

    # Initial jitter to avoid lock contention at boot on multi-worker
    # deployments.  Matches audit_log_cleanup's schedule_lifespan_task.
    import random
    try:
        await asyncio.sleep(random.uniform(0, _INITIAL_JITTER_SECONDS))
    except asyncio.CancelledError:
        return

    while not _should_stop:
        try:
            await _run_one_cycle()
        except asyncio.CancelledError:
            break
        except Exception:
            # _run_one_cycle already swallows exceptions internally; this
            # is a belt-and-braces guard so a coding bug can't kill the
            # loop silently.
            logger.error(
                "periodic_reconciler: cycle crashed", exc_info=True,
            )
        try:
            await asyncio.sleep(_RECONCILE_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            break

    logger.info("periodic_reconciler: loop exited")


__all__ = [
    "start_periodic_reconciler",
    "stop_periodic_reconciler",
    "_run_one_cycle",
]
