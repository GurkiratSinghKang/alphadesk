"""Durable audit-log helper (Wave 3K — persona-87 P1 #1).

Every ``_audit(...)`` event emitted by ``backend/api/routes/auth.py``,
``backend/api/routes/trades.py`` and ``backend/core/trading_gate.py`` used
to go to stdout only.  On container rotation the compliance trail
disappeared together with whatever the log buffer had not yet shipped to
the aggregator.  Regulators auditing a FINRA 4530 / SEC 17a-4 event found
nothing beyond Loki's retention window.

This module exposes a single async helper that:

1. Persists the audit event to the ``audit_log`` Postgres table defined by
   ``alembic/versions/0005_audit_log.py`` / ``data.storage.models.AuditLog``.
2. Emits the same record to the ``alphadesk.audit`` structured logger so
   existing log-aggregation pipelines continue to function unchanged — this
   is a **superset** of the old behaviour, not a replacement.

Design notes:

* **DB failure is never fatal.** An audit write that cannot reach Postgres
  must NOT break the request path — the caller has already done the real
  work (minted tokens, halted trading, rejected an order).  On exception
  we fall back to log-only and continue.  A compliance auditor that sees
  the structured log line but no DB row is strictly better than a 5xx
  handed to the user because the Postgres pool was exhausted.
* **``request_id`` is first-class.** The caller passes it explicitly
  (``request.state.request_id`` inside a handler or ``REQUEST_ID.get()``
  in a background task) rather than the helper reading the ContextVar
  directly — this keeps the function testable without having to set up
  the ``contextvars`` propagation machinery, and it documents at the call
  site which request the event belongs to.
* **``SKIP_DB_INIT=True`` is respected.** Local / test deployments that
  deliberately bypass the DB still get the log emission.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("alphadesk.audit")


async def write_audit(
    event: str,
    *,
    username: str | None,
    ip: str | None,
    request_id: str | None,
    details: dict[str, Any] | None = None,
) -> None:
    """Persist an audit event to ``audit_log`` and emit a structured log line.

    Callers:

    * ``auth.py`` — login / logout / refresh / change_password /
      logout_all / totp_*.
    * ``trades.py`` — halt_trading / resume_trading / flatten_all /
      wash_trade_rejected / restricted_symbol_rejected /
      closing_auction_allowed.
    * ``trading_gate.py`` — live_gate_reject (strategy on denylist, etc.).
    * ``daily_pipeline.py`` — halt_state_resync (Wave 4P Fix 1 P96):
      emitted on boot when the durable Postgres halt flag and the
      Redis cache disagree (e.g. Redis was FLUSHALL-ed, cold restart
      without AOF/RDB persistence). The cache is rehydrated from the
      authoritative Postgres row and this audit row records the drift
      so the operator can trace "why did the halt re-materialise at
      02:17 UTC?" to the precise boot event.

    Parameters
    ----------
    event:
        Short snake_case identifier.  Constrained to 64 chars by the DB
        column — callers should stick to ``login`` / ``halt_trading`` /
        ``wash_trade_rejected`` / etc. rather than free-form prose.
    username:
        Acting principal when resolvable.  ``None`` for pre-auth events
        (e.g. failed login against an unknown user).
    ip:
        Caller's IP address when available.  Stored as Postgres ``INET``
        so CIDR containment queries work natively.
    request_id:
        Request-correlation id plumbed through from
        ``request.state.request_id`` or ``REQUEST_ID.get()``.  Lets
        investigators pivot from an audit row to every structured log
        line emitted during the same request.
    details:
        Free-form kwargs captured as JSONB.  Anything that helps an
        auditor understand the event —
        ``{"reason": "bad_old_password"}``,
        ``{"symbol": "AAPL", "prev_price": 100.0, "bps": 8.3}`` etc.

    Error semantics
    ---------------
    The DB write is wrapped so a Postgres outage or a session-pool
    exhaustion never turns an audit call into a 5xx.  The structured log
    line always emits — the aggregator will still see the event even if
    the DB row did not land.
    """
    details = details or {}

    # 1. Always emit the structured log line FIRST.  If the DB write
    #    blows up we still have the event in the log stream — the opposite
    #    ordering would mean a crashy DB write could mask the log line too.
    #
    #    ``extra=`` kwargs are promoted to top-level JSON fields by
    #    ``core.logging.JsonFormatter`` so downstream queries like
    #    ``event="login" AND username="admin"`` work uniformly.
    logger.info(
        "audit event=%s user=%s ip=%s request_id=%s",
        event,
        username or "-",
        ip or "-",
        request_id or "-",
        extra={
            "event": event,
            "user": username,
            "username": username,
            "ip": ip,
            "audit_request_id": request_id,
            **details,
        },
    )

    # 2. Persist to the DB.  Lazy imports keep this module importable in
    #    test contexts that stub away the DB, and avoid pulling sqlalchemy
    #    at module load for the SKIP_DB_INIT=True deployment.
    try:
        from core.config import settings

        # In SKIP_DB_INIT mode there is no pool to talk to — the log
        # emission above is the whole story.  This path is exercised by
        # offline dev loops and any ``pytest`` run that defaults to
        # SQLite in-memory without explicit DB fixtures.
        if settings.SKIP_DB_INIT:
            return

        from core.database import _get_session_factory
        from data.storage.models import AuditLog

        factory = _get_session_factory()
        async with factory() as session:
            row = AuditLog(
                event=event,
                username=username,
                ip=ip,
                request_id=request_id,
                details=details or None,
            )
            session.add(row)
            await session.commit()
    except Exception:
        # Fall back to log-only.  The earlier ``logger.info`` already
        # fired; add a warning so operators can see audit persistence is
        # degraded without losing the event itself.  ``exc_info=True``
        # captures the Postgres error for the on-call dashboards but
        # does NOT re-raise — the caller's request path must stay
        # 2xx-able even if the audit DB is down.
        logger.warning(
            "audit_db_write_failed",
            extra={
                "event": event,
                "username": username,
                "ip": ip,
                "audit_request_id": request_id,
            },
            exc_info=True,
        )


__all__ = ["write_audit"]
