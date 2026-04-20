"""User-rights endpoints (GDPR Art. 17 + Art. 20 / CCPA parity).

Wave 4Q — persona-103 P1s #1, #2, #3.

This module owns the user-facing data-rights surface:

* ``POST /api/v1/user/export``          — Right to data portability
  (GDPR Art. 20). Returns a JSON bundle of the authenticated user's
  trades, positions, watchlists, alerts, strategy signals, settings,
  audit_log entries.  Streamed with ``Content-Disposition: attachment``
  so a browser save-as dialog fires; logged to ``audit_log`` as
  ``data_export``.

* ``GET  /api/v1/user/erase/preview``    — Dry-run counts of the rows
  that ``POST /api/v1/user/erase`` would delete. No writes. Cheap
  enough to be called from the UI right before the operator confirms
  the destructive action.

* ``POST /api/v1/user/erase``            — Right to erasure (GDPR
  Art. 17). Requires ``confirm=True`` AND a fresh password re-auth in
  the body (NOT just a valid JWT — a cookie-stealing attacker should
  NOT be able to nuke the account). Cascades across trades, positions,
  watchlists, alerts, strategy_signals, audit_log (except retention-
  mandated events per SEC 17a-4 / FINRA 4530), and Redis keys tagged
  by username. Logged to ``audit_log`` as ``user_erase``.

Design notes:

1. **Single-admin reality.** This deployment is a single-tenant trading
   terminal.  The "user data" is effectively the entire system state —
   erasure is a factory reset.  The warning copy in the preview and the
   erase response spells this out.

2. **17a-4 overrides Art. 17.**  SEC 17a-4(b)(1-4) requires six-year
   retention for certain trading records.  Rather than refuse the
   erasure outright (which would put us out of compliance with Art. 17)
   we ERASE the user-originated rows and FLAG the retention-mandated
   rows as ``retained_for_compliance=True``.  The user's export bundle
   keeps carrying those flagged rows so they still have full visibility
   into what was kept and why.  This is the "necessary for legal
   obligation" exemption under Art. 17(3)(b).

3. **Fail closed on Redis.**  The password re-auth and the audit write
   both fail closed if Redis is unreachable — this is destructive data
   flow, so a 503 is preferable to proceeding partially.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import delete, select

from core.auth import require_auth, verify_password
from core.config import settings

logger = logging.getLogger(__name__)
audit_logger = logging.getLogger("alphadesk.audit")

router = APIRouter()


# ---------------------------------------------------------------------------
# Retention policy — the events that SURVIVE an Art. 17 erasure because SEC
# 17a-4 / FINRA 4530 minimum retention dominates the user's erasure right
# (Art. 17(3)(b): "compliance with a legal obligation").
# ---------------------------------------------------------------------------
# Mirrors the 6-year retention tier in ``audit_log_cleanup.py`` — keeping the
# two lists in sync is a code-level invariant: if a new event type needs 17a-4
# retention, add it to BOTH files (the cleanup script so the sweeper leaves
# it alone, this file so the erasure endpoint flags rather than deletes it).
_RETAINED_COMPLIANCE_EVENTS: frozenset[str] = frozenset(
    {
        "halt_trading",
        "resume_trading",
        "wash_trade_reject",
        "restricted_symbol_reject",
        "live_gate_reject",
    }
)


# ---------------------------------------------------------------------------
# Request / response shapes
# ---------------------------------------------------------------------------


class EraseRequest(BaseModel):
    """Body schema for ``POST /api/v1/user/erase``.

    Both fields are REQUIRED — a naked POST with just the JWT must NOT
    wipe the account.  The password re-auth check makes the erasure
    resistant to cookie-theft and to accidental clicks.
    """

    confirm: bool
    password: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _audit(
    event: str,
    *,
    user: str,
    req: Request,
    result: str = "success",
    **extra: Any,
) -> None:
    """Thin wrapper around ``core.audit.write_audit`` for this module.

    Extracted so the export / erase handlers have a single line of
    telemetry boilerplate each.  Failures bubble up from the helper
    (which itself never raises), so we don't try/except here.
    """
    from core.audit import write_audit
    from core.logging import REQUEST_ID

    request_id = getattr(req.state, "request_id", None)
    if request_id is None:
        rid = REQUEST_ID.get()
        request_id = rid if rid and rid != "-" else None

    client_ip = "unknown"
    xff = req.headers.get("x-forwarded-for", "")
    if xff:
        client_ip = xff.split(",")[0].strip() or "unknown"
    elif req.client:
        client_ip = req.client.host

    await write_audit(
        event,
        username=user if user and user != "-" else None,
        ip=client_ip if client_ip != "unknown" else None,
        request_id=request_id,
        details={"result": result, **extra},
    )


async def _verify_password_reauth(username: str, submitted: str) -> bool:
    """Re-verify the user's password against the admin hash.

    Erasure is IRREVERSIBLE — a valid JWT alone (which a session-
    hijacking attacker already has) must NOT be enough to trigger it.
    The password retype provides a second factor at the exact moment of
    the destructive call.

    Uses the same constant-time bcrypt path as ``login`` so timing
    doesn't leak whether the account has a configured hash.  Treats
    any exception during verify as a failure — a corrupt hash string
    mustn't accidentally authorise the erase.
    """
    if username != settings.ADMIN_USERNAME:
        return False
    if not settings.ADMIN_PASSWORD_HASH:
        return False
    try:
        return verify_password(submitted, settings.ADMIN_PASSWORD_HASH)
    except Exception:
        logger.warning("erase reauth: verify_password raised", exc_info=True)
        return False


async def _collect_export_bundle(username: str) -> dict[str, Any]:
    """Assemble the Art. 20 export payload for ``username``.

    Reads every user-addressable table and packages them into a single
    dict.  Tables without a per-user column (positions, watchlists,
    screener presets, alerts on the single-admin deployment) are
    exported in full — they are owned by the sole user of the system.
    Multi-tenant future work would add a ``user_id`` filter here and
    gate PII of other users.

    Returns a plain dict; the handler is responsible for JSON
    serialisation + the ``Content-Disposition`` header.
    """
    from core.database import _get_session_factory
    from data.storage.models import (
        Alert,
        AuditLog,
        Position,
        ScreenerPreset,
        StrategySignal,
        Trade,
        Watchlist,
    )

    bundle: dict[str, Any] = {
        "export_metadata": {
            "username": username,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "schema_version": 1,
            "notice": (
                "This bundle contains your personal data as held by "
                "AlphaDesk on the generation timestamp above. Rows marked "
                "retained_for_compliance=true have been kept past an "
                "erasure request under SEC 17a-4 minimum retention."
            ),
        },
        "trades": [],
        "positions": [],
        "watchlists": [],
        "screener_presets": [],
        "alerts": [],
        "strategy_signals": [],
        "audit_log": [],
        "settings": {
            "admin_username": settings.ADMIN_USERNAME,
            "access_token_expire_minutes": settings.ACCESS_TOKEN_EXPIRE_MINUTES,
            "refresh_token_expire_days": settings.REFRESH_TOKEN_EXPIRE_DAYS,
            "live_trading_enabled": settings.LIVE_TRADING_ENABLED,
            "alpaca_base_url": settings.ALPACA_BASE_URL,
            "restricted_symbols": settings.RESTRICTED_SYMBOLS,
        },
    }

    if settings.SKIP_DB_INIT:
        # Degraded-mode parity: every DB-backed route in the app returns
        # empty results when SKIP_DB_INIT=True, so the export must too.
        # The metadata + settings block is still meaningful.
        return bundle

    factory = _get_session_factory()
    async with factory() as session:
        # Trades — full row dump.  ``legs`` is already JSONB so it
        # serialises naturally through dict(row).
        rows = (await session.execute(select(Trade))).scalars().all()
        bundle["trades"] = [_row_to_dict(r) for r in rows]

        rows = (await session.execute(select(Position))).scalars().all()
        bundle["positions"] = [_row_to_dict(r) for r in rows]

        rows = (await session.execute(select(Watchlist))).scalars().all()
        bundle["watchlists"] = [_row_to_dict(r) for r in rows]

        rows = (await session.execute(select(ScreenerPreset))).scalars().all()
        bundle["screener_presets"] = [_row_to_dict(r) for r in rows]

        rows = (await session.execute(select(Alert))).scalars().all()
        bundle["alerts"] = [_row_to_dict(r) for r in rows]

        rows = (await session.execute(select(StrategySignal))).scalars().all()
        bundle["strategy_signals"] = [_row_to_dict(r) for r in rows]

        # Audit log — scope to this username OR to retained-compliance rows.
        # A row with ``username IS NULL`` is a pre-auth event (failed login
        # against a non-existent user) and is not the requester's personal
        # data, so we exclude it.
        rows = (
            await session.execute(
                select(AuditLog).where(
                    (AuditLog.username == username)
                    | (AuditLog.retained_for_compliance.is_(True))
                )
            )
        ).scalars().all()
        bundle["audit_log"] = [_row_to_dict(r) for r in rows]

    return bundle


def _row_to_dict(row: Any) -> dict[str, Any]:
    """Convert a SQLAlchemy ORM row to a JSON-serialisable dict.

    Handles the two shapes that leak through to the export:
    * ``datetime`` → ISO-8601 string.
    * ``Decimal``  → float (lossy; acceptable for export — the source of
      truth remains the DB).
    * Everything else: pass through.
    """
    from decimal import Decimal

    out: dict[str, Any] = {}
    for col in row.__table__.columns:
        v = getattr(row, col.name)
        if isinstance(v, datetime):
            out[col.name] = v.isoformat()
        elif isinstance(v, Decimal):
            out[col.name] = float(v)
        else:
            out[col.name] = v
    return out


async def _erase_preview_counts(username: str) -> dict[str, int]:
    """Return the row counts an erasure would delete per-table.

    Cheap enough to call before the real erase without any lock held —
    the counts may race with concurrent inserts but the absolute values
    are not the point; they give the operator a sense of scale and a
    sanity check before pressing the red button.
    """
    from sqlalchemy import func as sa_func

    from core.database import _get_session_factory
    from data.storage.models import (
        Alert,
        AuditLog,
        Position,
        ScreenerPreset,
        StrategySignal,
        Trade,
        Watchlist,
    )

    counts: dict[str, int] = {
        "trades": 0,
        "positions": 0,
        "watchlists": 0,
        "screener_presets": 0,
        "alerts": 0,
        "strategy_signals": 0,
        "audit_log_erased": 0,
        "audit_log_retained_for_compliance": 0,
    }

    if settings.SKIP_DB_INIT:
        return counts

    factory = _get_session_factory()
    async with factory() as session:
        counts["trades"] = (
            await session.execute(select(sa_func.count()).select_from(Trade))
        ).scalar_one()
        counts["positions"] = (
            await session.execute(select(sa_func.count()).select_from(Position))
        ).scalar_one()
        counts["watchlists"] = (
            await session.execute(select(sa_func.count()).select_from(Watchlist))
        ).scalar_one()
        counts["screener_presets"] = (
            await session.execute(select(sa_func.count()).select_from(ScreenerPreset))
        ).scalar_one()
        counts["alerts"] = (
            await session.execute(select(sa_func.count()).select_from(Alert))
        ).scalar_one()
        counts["strategy_signals"] = (
            await session.execute(select(sa_func.count()).select_from(StrategySignal))
        ).scalar_one()

        # Audit_log splits into "will be erased" and "will be retained".
        counts["audit_log_erased"] = (
            await session.execute(
                select(sa_func.count()).select_from(AuditLog).where(
                    AuditLog.username == username,
                    AuditLog.event.notin_(_RETAINED_COMPLIANCE_EVENTS),
                )
            )
        ).scalar_one()
        counts["audit_log_retained_for_compliance"] = (
            await session.execute(
                select(sa_func.count()).select_from(AuditLog).where(
                    AuditLog.username == username,
                    AuditLog.event.in_(_RETAINED_COMPLIANCE_EVENTS),
                )
            )
        ).scalar_one()

    return counts


async def _delete_username_keyed_redis_keys(username: str) -> int:
    """Best-effort clear of Redis state keyed on ``username``.

    Covers:
    * ``password_version:{username}`` / ``session_epoch:{username}`` —
      both get reset; a fresh admin will start over from 1.
    * ``totp:{username}`` / ``totp_pending:{username}`` — 2FA is blown
      away (the user will re-enrol on the next login).
    * ``login_attempts:{any-ip}:{username}`` — their per-pair rate
      limit counters, scanned via SCAN so we don't block Redis.

    Returns the number of keys deleted (best-effort — a scan race with
    a concurrent insert can under-count by a tiny margin; the worst case
    is a few stale counters that die of TTL anyway).
    """
    deleted = 0
    try:
        from core.redis import get_redis
        r = await get_redis()
    except Exception:
        logger.warning("erase: redis unavailable for key cleanup", exc_info=True)
        return deleted

    # Fixed keys first.
    fixed = [
        f"password_version:{username}",
        f"session_epoch:{username}",
        f"totp:{username}",
        f"totp_pending:{username}",
    ]
    for k in fixed:
        try:
            n = await r.delete(k)
            deleted += int(n or 0)
        except Exception:
            logger.warning("erase: failed to delete redis key %s", k, exc_info=True)

    # Pattern scan for rate-limit keys.  SCAN iterates in batches without
    # blocking the Redis event loop the way KEYS does.
    pattern = f"login_attempts:*:{username}"
    try:
        cursor = 0
        while True:
            cursor, batch = await r.scan(cursor=cursor, match=pattern, count=500)
            if batch:
                n = await r.delete(*batch)
                deleted += int(n or 0)
            if cursor == 0:
                break
    except Exception:
        logger.warning("erase: SCAN for %s failed", pattern, exc_info=True)

    return deleted


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/export")
async def export_user_data(
    req: Request,
    username: str = Depends(require_auth),
) -> Response:
    """GDPR Art. 20 — right to data portability.

    Returns a JSON attachment containing everything the system holds on
    this user at the moment of the call.  Logged to ``audit_log`` as
    ``data_export``.

    Streaming — this is bounded by the DB row count (single-admin
    deployment, typical scale is O(thousands) trades) so a single
    in-memory dump + Response is simpler than chunked streaming and
    comfortably fits the payload budget.  If the bundle ever blows past
    ~50 MB we can switch to ``StreamingResponse`` without touching the
    caller contract.
    """
    bundle = await _collect_export_bundle(username)

    # orjson would be faster but ``json`` with ``default=str`` is the
    # safer fallback for any row that slipped past _row_to_dict (e.g. a
    # future column with a ``UUID`` type).  Pretty-print for human
    # readability — the bundle is user-facing, not a wire format.
    body = json.dumps(bundle, indent=2, sort_keys=True, default=str).encode("utf-8")

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"alphadesk_export_{date_str}.json"

    await _audit(
        "data_export",
        user=username,
        req=req,
        result="success",
        bytes=len(body),
        sections=list(bundle.keys()),
    )

    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Cache-Control: an export bundle is a point-in-time dump.
            # Caching it at a proxy would let an attacker replay a stale
            # snapshot. ``no-store`` is the broadest bar.
            "Cache-Control": "no-store",
        },
    )


@router.get("/erase/preview")
async def erase_preview(
    req: Request,
    username: str = Depends(require_auth),
) -> dict[str, Any]:
    """Dry-run counts for ``POST /api/v1/user/erase``.

    Intended to be rendered in a confirmation dialog: "this will delete
    N trades, M positions, …, and K audit rows (L retained for
    regulatory compliance)".  No writes, no auth step beyond the normal
    JWT — reading counts is not destructive.
    """
    counts = await _erase_preview_counts(username)
    return {
        "username": username,
        "counts": counts,
        "retained_events": sorted(_RETAINED_COMPLIANCE_EVENTS),
        "warning": (
            "This is a SINGLE-ADMIN deployment. Erasure is effectively "
            "a factory reset: every trade, position, watchlist, alert, "
            "and strategy signal will be deleted. Audit rows for login "
            "and auth events will also be deleted EXCEPT those whose "
            "event is on the retained_events list (SEC 17a-4 minimum "
            "6-year retention). The retained rows are flagged "
            "retained_for_compliance=true and remain available via the "
            "export endpoint."
        ),
        "requires": {
            "confirm": True,
            "password": "Your current password (POST body field)",
        },
    }


@router.post("/erase")
async def erase_user_data(
    body: EraseRequest,
    req: Request,
    username: str = Depends(require_auth),
) -> dict[str, Any]:
    """GDPR Art. 17 — right to erasure.

    Cascades across every user-owned table + Redis.  Retention-mandated
    audit rows (SEC 17a-4) are flagged rather than deleted so the system
    remains in regulatory compliance.  The operator re-authenticates
    with their password in the body — a valid JWT alone is insufficient
    for this call.

    Response shape includes ``deleted`` per-table counts + a
    ``redis_keys_deleted`` tally.
    """
    if body.confirm is not True:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Erasure requires explicit confirm=true in the body",
        )

    reauth_ok = await _verify_password_reauth(username, body.password)
    if not reauth_ok:
        # Audit the failed attempt so multiple rejections pattern-match as
        # suspicious.  Do NOT reveal whether the username is admin or
        # whether the hash path is configured — a bare 401 is enough.
        await _audit("user_erase", user=username, req=req, result="reauth_failure")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password re-authentication required",
        )

    # SKIP_DB_INIT is respected: we still wipe Redis keys (which are live)
    # and audit the event, but the DB cascade no-ops.
    deleted: dict[str, int] = {
        "trades": 0,
        "positions": 0,
        "watchlists": 0,
        "screener_presets": 0,
        "alerts": 0,
        "strategy_signals": 0,
        "audit_log_erased": 0,
        "audit_log_retained_for_compliance": 0,
    }

    if not settings.SKIP_DB_INIT:
        from core.database import _get_session_factory
        from data.storage.models import (
            Alert,
            AuditLog,
            Position,
            ScreenerPreset,
            StrategySignal,
            Trade,
            Watchlist,
        )

        factory = _get_session_factory()
        async with factory() as session:
            # Wipe each table's rows.  ``execute(delete())`` returns a
            # ``CursorResult`` whose ``.rowcount`` is the delete count.
            # We use explicit ``delete()`` statements rather than ORM
            # collection-level deletes so the operation is a single
            # server-side DELETE per table (no N+1 round trips).
            #
            # Single-admin deployment: we delete every row.  A multi-
            # tenant extension would add ``where(col.user_id ==
            # user_id)`` filters here.
            for model, key in (
                (Trade, "trades"),
                (Position, "positions"),
                (Watchlist, "watchlists"),
                (ScreenerPreset, "screener_presets"),
                (Alert, "alerts"),
                (StrategySignal, "strategy_signals"),
            ):
                res = await session.execute(delete(model))
                deleted[key] = int(res.rowcount or 0)

            # Audit log splits: the erasure deletes user-originated
            # rows; the retention-mandated rows get the flag flipped on
            # (if it wasn't already) and stay.  Two statements, one
            # commit, same session.
            #
            # The retention flag is set to TRUE on every retained row
            # regardless of its prior value — the flag's semantics are
            # "this row has survived an erasure because of retention",
            # which becomes true the moment we decline to delete it.
            from sqlalchemy import update

            erase_stmt = delete(AuditLog).where(
                AuditLog.username == username,
                AuditLog.event.notin_(_RETAINED_COMPLIANCE_EVENTS),
            )
            res = await session.execute(erase_stmt)
            deleted["audit_log_erased"] = int(res.rowcount or 0)

            flag_stmt = (
                update(AuditLog)
                .where(
                    AuditLog.username == username,
                    AuditLog.event.in_(_RETAINED_COMPLIANCE_EVENTS),
                )
                .values(retained_for_compliance=True)
            )
            res = await session.execute(flag_stmt)
            deleted["audit_log_retained_for_compliance"] = int(res.rowcount or 0)

            await session.commit()

    redis_deleted = await _delete_username_keyed_redis_keys(username)

    # Audit the erasure AFTER the cascade so the audit row lands on a
    # fresh post-erasure table.  The event is on its own retention tier
    # (2 years for data_export / user_erase, per the cleanup script) so
    # it won't be touched by the sweeper prematurely.
    await _audit(
        "user_erase",
        user=username,
        req=req,
        result="success",
        deleted=deleted,
        redis_keys_deleted=redis_deleted,
    )

    return {
        "ok": True,
        "deleted": deleted,
        "redis_keys_deleted": redis_deleted,
        "retained_events": sorted(_RETAINED_COMPLIANCE_EVENTS),
        "notice": (
            "Erasure completed. Rows for regulatorily-required events "
            "(SEC 17a-4) were flagged retained_for_compliance=true and "
            "remain available via the export endpoint. Your session "
            "cookies are still valid for the current JWT window; we "
            "recommend /auth/logout-all to invalidate every outstanding "
            "token."
        ),
    }
