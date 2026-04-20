"""Drain the ``halt_state.pending_flatten`` queue on next market open
(Wave 6β Fix 2, from Round-5 deferred + persona 106).

Why this exists
---------------
Wave 4P Fix 2 (P104) added a ``pending_flatten`` boolean on the
``halt_state`` singleton row.  When an operator halts while the market
is CLOSED with ``flatten=True``, the halt endpoint persists the halt
state AND sets ``pending_flatten = TRUE`` — the intent is that the
next-open code path FIRES the close orders so the account doesn't
sit naked through the session open.

Until this module landed, NOTHING consumed the flag.  The column was
written but never read.  A halt-with-flatten-while-closed left the
account exposed at the next open with nobody to close it.

What this module does
---------------------
``check_and_drain_pending_flatten()`` is idempotent and cheap:

    1. Read ``halt_state`` from Postgres.
    2. If ``pending_flatten`` is False — exit immediately (no-op).
    3. If market is NOT currently open — exit (we'll try next tick).
    4. Acquire a Redis lock so multi-worker deployments only fire
       flatten ONCE.
    5. Call ``_flatten_all_positions()`` — the same helper used by
       ``POST /halt?flatten=true`` and ``POST /flatten_all``.
    6. Write an audit log entry with the summary.
    7. Clear ``pending_flatten = FALSE`` in a dedicated UPDATE so the
       next tick sees the clean state.

Note that the halt flag ITSELF is NOT cleared here — the operator
explicitly halted, and they must explicitly resume via
``POST /api/v1/trades/resume``.  We're only draining the queued
FLATTEN intent, not un-halting the system.

Hook-up
-------
Called at every tick of the ``periodic_reconciler._run_one_cycle``
(every 5 min).  Also safe to invoke manually from the ``MasterAgent``
pre-trade gate if a finer cadence is ever needed — the Redis lock
+ idempotent read ensures no double-flatten.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)


# Redis lock key.  Short TTL because a flatten generally completes in
# well under 60s; the lock exists so two workers starting their reconcile
# cycles at the same second don't BOTH fire flatten at Alpaca.
_DRAIN_LOCK_KEY = "pending_flatten_drain:lock"
_DRAIN_LOCK_TTL_SECONDS = 120  # 2 minutes — covers slow Alpaca responses


async def _acquire_drain_lock() -> str | None:
    """Acquire the Redis-based drain lock.  Returns UUID token or None.

    Mirrors the Redlock-lite pattern used by ``periodic_reconciler`` and
    ``scripts/audit_log_cleanup``.  On redis-unavailable we return None
    and the caller exits — better to skip a tick than to risk two
    workers firing flatten orders concurrently.
    """
    try:
        from core.redis import get_redis
        r = await get_redis()
        if r is None:
            return None
        token = uuid.uuid4().hex
        ok = await r.set(
            _DRAIN_LOCK_KEY, token, nx=True, ex=_DRAIN_LOCK_TTL_SECONDS,
        )
        return token if ok else None
    except Exception:
        logger.debug(
            "pending_flatten_drain: lock acquisition failed",
            exc_info=True,
        )
        return None


async def _release_drain_lock(token: str) -> None:
    """Release the drain lock iff the stored value matches our token."""
    try:
        from core.redis import get_redis
        r = await get_redis()
        if r is None:
            return
        current = await r.get(_DRAIN_LOCK_KEY)
        if current == token:
            await r.delete(_DRAIN_LOCK_KEY)
    except Exception:
        logger.debug(
            "pending_flatten_drain: lock release failed", exc_info=True,
        )


async def _read_pending_flatten() -> bool:
    """Return True iff ``halt_state.pending_flatten == TRUE``.

    Reads Postgres directly (not the Redis halt cache) because Redis
    only mirrors ``is_halted`` — the ``pending_flatten`` column is
    never cached.  On DB failure return False: fail-CLOSED on the
    side of "don't fire flatten" when we can't prove the intent
    is queued.
    """
    try:
        from core.config import settings as _s
        if _s.SKIP_DB_INIT:
            return False
        from core.database import _get_session_factory
        from data.storage.models import HaltState

        factory = _get_session_factory()
        async with factory() as db:
            row = await db.get(HaltState, 1)
            if row is None:
                return False
            return bool(getattr(row, "pending_flatten", False))
    except Exception:
        logger.debug(
            "pending_flatten_drain: DB read failed — treating as no-op",
            exc_info=True,
        )
        return False


async def _clear_pending_flatten() -> None:
    """Set ``halt_state.pending_flatten = FALSE`` after a successful drain.

    Runs in its own session + transaction so a failure here doesn't
    roll back the broker-side flatten.  If the clear fails, the next
    tick will re-read pending_flatten=TRUE and (via the Redis lock +
    the Alpaca ``client_order_id`` dedup on the close orders)
    effectively retry — either Alpaca returns a no-op ("position
    already closed") or we do nothing because there's nothing to
    close.
    """
    try:
        from core.config import settings as _s
        if _s.SKIP_DB_INIT:
            return
        from core.database import _get_session_factory
        from data.storage.models import HaltState

        factory = _get_session_factory()
        async with factory() as db:
            row = await db.get(HaltState, 1)
            if row is None:
                return
            row.pending_flatten = False
            await db.commit()
    except Exception:
        logger.warning(
            "pending_flatten_drain: failed to clear pending_flatten flag",
            exc_info=True,
        )


async def check_and_drain_pending_flatten() -> dict[str, Any] | None:
    """Main entry point.

    Returns:
        * ``None`` when nothing was done (no queued intent, market closed,
          or another worker holds the drain lock).
        * The flatten summary dict when a drain actually ran.
    """
    # Step 1: cheap DB read.  Bail out fast when nothing is queued —
    # this runs on every periodic-reconciler tick (every 5 min) so it
    # must stay cheap in the common case.
    if not await _read_pending_flatten():
        return None

    # Step 2: is the market actually open right now?  We DO NOT fire
    # flatten during closed hours because market orders would queue at
    # Alpaca with no fill until open — and we've already been sitting
    # on ``pending_flatten = TRUE`` precisely to avoid that.
    try:
        from api.routes.trades import _is_market_open_now
        market_open = await _is_market_open_now()
    except Exception:
        logger.warning(
            "pending_flatten_drain: could not resolve market session — "
            "retrying next tick",
            exc_info=True,
        )
        return None
    if not market_open:
        logger.debug(
            "pending_flatten_drain: pending_flatten=TRUE but market closed — "
            "will retry next tick",
        )
        return None

    # Step 3: take the drain lock.  Another worker may be about to
    # do the same; we must not double-flatten.
    token = await _acquire_drain_lock()
    if token is None:
        logger.info(
            "pending_flatten_drain: drain lock held by another worker — skipping",
        )
        return None

    # Step 4: actual work, inside a try/finally so the lock always
    # releases even on exception.
    try:
        # Re-check inside the lock.  Prevents a double-drain where the
        # previous owner finished AND cleared the flag between our
        # initial read and the lock acquisition.
        if not await _read_pending_flatten():
            logger.debug(
                "pending_flatten_drain: flag cleared by another worker "
                "before we took the lock — skipping",
            )
            return None

        # Lazy import to avoid the ``trades -> master_agent ->
        # daily_pipeline`` circular chain at module load.
        from api.routes.trades import _flatten_all_positions

        logger.warning(
            "pending_flatten_drain: firing queued flatten at market open",
        )
        summary = await _flatten_all_positions()

        # Audit trail — same event shape as ``POST /halt?flatten=true``
        # uses so an auditor can correlate the halt with the deferred
        # drain.  ``username=None`` because the system (not a user)
        # fired this.  ``request_id=None`` because this runs outside
        # of any HTTP request.
        try:
            from core.audit import write_audit
            await write_audit(
                "pending_flatten_drained",
                username=None,
                ip=None,
                request_id=None,
                details={
                    "summary": summary,
                    "reason": "market_open_drain_of_queued_halt_flatten",
                },
            )
        except Exception:
            logger.warning(
                "pending_flatten_drain: audit write failed (drain still ran)",
                exc_info=True,
            )

        # Step 5: clear the flag so we don't drain twice.  Done AFTER
        # the audit write so a crash between flatten and audit still
        # leaves the flag set — next tick will drain a no-op (Alpaca
        # returns "position already closed") and re-audit.  That's a
        # spurious audit row, not a missed flatten, which is the
        # tradeoff we want.
        await _clear_pending_flatten()

        logger.info(
            "pending_flatten_drain: drained — flatten_attempts=%d, "
            "flatten_successes=%d, flatten_failures=%d",
            summary.get("flatten_attempts", 0),
            summary.get("flatten_successes", 0),
            summary.get("flatten_failures", 0),
        )
        return summary

    except Exception:
        logger.error(
            "pending_flatten_drain: drain raised — flag will remain "
            "set for next tick retry",
            exc_info=True,
        )
        return None
    finally:
        await _release_drain_lock(token)


__all__ = [
    "check_and_drain_pending_flatten",
]
