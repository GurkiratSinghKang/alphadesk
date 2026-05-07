from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from core.auth import require_auth
from services.broker_connections import (
    BrokerCredentialError,
    broker_connection_to_dict,
    get_alpaca_credentials,
    supported_brokers_to_dict,
    upsert_broker_connection,
    upsert_alpaca_connection,
)

router = APIRouter()
logger = logging.getLogger(__name__)


# Audit B-F12 (2026-05-05): the broker connection write endpoints
# (POST /connections/alpaca, POST /connections/{provider}, DELETE
# /connections/{id}) and the reconciliation kicker (POST
# /reconciliation/run) shipped behind ``require_auth`` only — no rate
# limit. A single authenticated user could pound them and exhaust DB
# round-trips, Alpaca's verify endpoint, and the reconciler's outbound
# fan-out. Apply a per-user fixed-window cap (very generous; this is
# DoS protection, not abuse-accounting).
_BROKER_WRITE_RL_PER_MINUTE = 30
_BROKER_RECONCILE_RL_PER_MINUTE = 6


async def _broker_rate_limit_or_429(
    username: str, action: str, *, cap: int = _BROKER_WRITE_RL_PER_MINUTE
) -> None:
    """Rate-limit broker write operations per (user, action) per minute."""
    try:
        from core.redis import get_redis
        bucket = int(time.time()) // 60
        key = f"broker_rl:{action}:{username}:{bucket}"
        r = await get_redis()
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, 60)
        results = await pipe.execute()
        current = int(results[0] or 0)
    except Exception:
        # Fail open on Redis outage — same posture as the market route.
        logger.warning("broker rate-limit: redis failure, failing open", exc_info=True)
        return

    if current > cap:
        retry_after = max(1, 60 - (int(time.time()) % 60))
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": f"Too many broker {action} requests. Please slow down.",
                "retry_after_seconds": retry_after,
            },
            headers={"Retry-After": str(retry_after)},
        )


class AlpacaConnectionRequest(BaseModel):
    api_key: str = Field(..., min_length=8, max_length=256)
    secret_key: str = Field(..., min_length=8, max_length=512)
    account_env: str = Field("paper", pattern="^(paper|live)$")
    display_name: str | None = Field(None, max_length=160)


class BrokerConnectionRequest(BaseModel):
    account_env: str = Field("paper", pattern="^(paper|live)$")
    display_name: str | None = Field(None, max_length=160)
    credentials: dict[str, Any]


class ReconciliationDecision(BaseModel):
    note: str | None = Field(None, max_length=500)


@router.get("/providers")
async def list_supported_brokers() -> list[dict[str, Any]]:
    return supported_brokers_to_dict()


@router.get("/connections")
async def list_connections(username: str = Depends(require_auth)) -> list[dict[str, Any]]:
    from core.config import settings
    if settings.SKIP_DB_INIT:
        return []
    from core.database import _get_session_factory
    from data.storage.models import BrokerConnection

    factory = _get_session_factory()
    async with factory() as db:
        rows = (
            await db.execute(
                select(BrokerConnection)
                .where(BrokerConnection.username == username)
                .order_by(BrokerConnection.provider, BrokerConnection.account_env)
            )
        ).scalars().all()
    return [broker_connection_to_dict(row) for row in rows]


@router.post("/connections/alpaca", status_code=201)
async def save_alpaca_connection(
    request: AlpacaConnectionRequest,
    username: str = Depends(require_auth),
) -> dict[str, Any]:
    await _broker_rate_limit_or_429(username, "save_alpaca")
    try:
        row = await upsert_alpaca_connection(
            username=username,
            api_key=request.api_key.strip(),
            secret_key=request.secret_key.strip(),
            account_env=request.account_env,
            display_name=request.display_name,
        )
    except BrokerCredentialError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return broker_connection_to_dict(row)


@router.post("/connections/{provider}", status_code=201)
async def save_broker_connection(
    provider: str,
    request: BrokerConnectionRequest,
    username: str = Depends(require_auth),
) -> dict[str, Any]:
    await _broker_rate_limit_or_429(username, "save_provider")
    provider_key = provider.strip().lower()
    if provider_key not in {"alpaca", "ibkr", "etrade", "schwab", "robinhood"}:
        raise HTTPException(status_code=422, detail="Unsupported broker provider")
    try:
        row = await upsert_broker_connection(
            username=username,
            provider=provider_key,  # type: ignore[arg-type]
            account_env=request.account_env,
            credentials={
                k: str(v).strip()
                for k, v in request.credentials.items()
                if v is not None
            },
            display_name=request.display_name,
        )
    except BrokerCredentialError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return broker_connection_to_dict(row)


@router.delete("/connections/{connection_id}", status_code=204)
async def disable_connection(
    connection_id: int,
    username: str = Depends(require_auth),
) -> None:
    await _broker_rate_limit_or_429(username, "delete_connection")
    from core.config import settings
    if settings.SKIP_DB_INIT:
        return
    from core.database import _get_session_factory
    from data.storage.models import BrokerConnection

    factory = _get_session_factory()
    async with factory() as db:
        row = await db.get(BrokerConnection, connection_id)
        if row is None or row.username != username:
            raise HTTPException(status_code=404, detail="Broker connection not found")
        row.status = "disabled"
        await db.commit()


@router.get("/reconciliation/issues")
async def list_reconciliation_issues(
    status_filter: str = Query("open", alias="status"),
    username: str = Depends(require_auth),
) -> list[dict[str, Any]]:
    from core.config import settings
    if settings.SKIP_DB_INIT:
        return []
    from core.database import _get_session_factory
    from data.storage.models import ReconciliationIssue

    factory = _get_session_factory()
    async with factory() as db:
        q = (
            select(ReconciliationIssue)
            .where(ReconciliationIssue.username == username)
            .order_by(ReconciliationIssue.detected_at.desc())
            .limit(100)
        )
        if status_filter != "all":
            q = q.where(ReconciliationIssue.status == status_filter)
        rows = (await db.execute(q)).scalars().all()
    return [_issue_to_dict(row) for row in rows]


@router.post("/reconciliation/run")
async def run_reconciliation_now(username: str = Depends(require_auth)) -> dict[str, int]:
    # Tighter cap on reconciliation than on credential writes — each call
    # spawns Alpaca round-trips and DB scans, so 6/min is plenty.
    await _broker_rate_limit_or_429(
        username, "reconciliation_run", cap=_BROKER_RECONCILE_RL_PER_MINUTE
    )
    try:
        creds = await get_alpaca_credentials(username)
    except BrokerCredentialError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if creds is None:
        raise HTTPException(status_code=503, detail="No Alpaca broker connection configured")
    from api.routes.trades import _reconcile_last_24h

    return await _reconcile_last_24h(
        since=datetime.now(timezone.utc) - timedelta(hours=3),
        username=username,
    )


@router.post("/reconciliation/issues/{issue_id}/approve")
async def approve_reconciliation_issue(
    issue_id: int,
    decision: ReconciliationDecision | None = None,
    username: str = Depends(require_auth),
) -> dict[str, Any]:
    return await _decide_issue(issue_id, username, approved=True, note=decision.note if decision else None)


@router.post("/reconciliation/issues/{issue_id}/reject")
async def reject_reconciliation_issue(
    issue_id: int,
    decision: ReconciliationDecision | None = None,
    username: str = Depends(require_auth),
) -> dict[str, Any]:
    return await _decide_issue(issue_id, username, approved=False, note=decision.note if decision else None)


async def _decide_issue(
    issue_id: int,
    username: str,
    *,
    approved: bool,
    note: str | None,
) -> dict[str, Any]:
    from core.config import settings
    if settings.SKIP_DB_INIT:
        raise HTTPException(status_code=503, detail="Database disabled")
    from core.database import _get_session_factory
    from data.storage.models import ReconciliationIssue

    factory = _get_session_factory()
    async with factory() as db:
        issue = await db.get(ReconciliationIssue, issue_id)
        if issue is None or issue.username != username:
            raise HTTPException(status_code=404, detail="Reconciliation issue not found")
        if issue.status != "open":
            raise HTTPException(status_code=409, detail="Issue already decided")
        if approved:
            await _apply_issue_action(db, issue)
            issue.status = "approved"
        else:
            issue.status = "rejected"
        issue.decided_at = datetime.now(timezone.utc)
        issue.decided_by = username
        issue.resolution_note = note
        await db.commit()
        await db.refresh(issue)
        return _issue_to_dict(issue)


async def _apply_issue_action(db: Any, issue: Any) -> None:
    from data.storage.models import Trade

    action = (issue.proposed_action or {}).get("action")
    if action == "insert_trade":
        snapshot = issue.broker_snapshot or {}
        existing = None
        if issue.broker_order_id:
            existing = (
                await db.execute(select(Trade).where(Trade.broker_order_id == issue.broker_order_id))
            ).scalar_one_or_none()
        if existing is None and issue.client_order_id:
            existing = (
                await db.execute(select(Trade).where(Trade.client_order_id == issue.client_order_id))
            ).scalar_one_or_none()
        if existing is not None:
            return
        trade = _trade_from_broker_snapshot(issue, snapshot)
        db.add(trade)
        await db.flush()
    elif action in {"mark_orphaned", "update_trade_status"}:
        values = {"status": (issue.proposed_action or {}).get("status", "orphaned")}
        if action == "update_trade_status":
            if (issue.proposed_action or {}).get("filled_at") is not None:
                values["filled_at"] = datetime.fromisoformat(
                    str((issue.proposed_action or {})["filled_at"]).replace("Z", "+00:00")
                )
            if (issue.proposed_action or {}).get("filled_avg_price") is not None:
                values["filled_avg_price"] = (issue.proposed_action or {})["filled_avg_price"]
        await db.execute(
            update(Trade)
            .where(Trade.id == issue.local_trade_id)
            .values(**values)
        )
    else:
        raise HTTPException(status_code=422, detail="Unsupported reconciliation action")


def _trade_from_broker_snapshot(issue: Any, snapshot: dict[str, Any]) -> Any:
    from data.storage.models import Trade

    side = str(snapshot.get("side") or "buy").lower()
    symbol = str(snapshot.get("symbol") or issue.symbol or "").upper()
    qty = _as_float(snapshot.get("qty") or snapshot.get("filled_qty")) or 0
    entry_price = _as_float(snapshot.get("filled_avg_price")) or _as_float(snapshot.get("limit_price"))
    submitted_at = snapshot.get("submitted_at")
    try:
        entry_time = (
            datetime.fromisoformat(str(submitted_at).replace("Z", "+00:00"))
            if submitted_at
            else datetime.now(timezone.utc)
        )
    except Exception:
        entry_time = datetime.now(timezone.utc)
    return Trade(
        username=issue.username,
        symbol=symbol,
        strategy=None,
        legs=[{
            "symbol": symbol,
            "side": side,
            "qty": qty,
            "order_type": snapshot.get("type", "market"),
            "limit_price": _as_float(snapshot.get("limit_price")),
            "stop_price": _as_float(snapshot.get("stop_price")),
            "client_order_id": issue.client_order_id,
        }],
        entry_time=entry_time,
        entry_price=entry_price,
        status=(issue.proposed_action or {}).get("status", "reconciled"),
        notes=f"Approved reconciliation from broker (alpaca_id={issue.broker_order_id})",
        side="short" if side == "sell" else "long",
        trade_kind="short_open" if side == "sell" else "long_open",
        client_order_id=issue.client_order_id,
        broker_order_id=issue.broker_order_id,
        account_env=issue.account_env,
    )


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _issue_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "issue_key": row.issue_key,
        "provider": row.provider,
        "account_env": row.account_env,
        "issue_type": row.issue_type,
        "severity": row.severity,
        "status": row.status,
        "symbol": row.symbol,
        "broker_order_id": row.broker_order_id,
        "client_order_id": row.client_order_id,
        "local_trade_id": row.local_trade_id,
        "broker_snapshot": row.broker_snapshot,
        "local_snapshot": row.local_snapshot,
        "proposed_action": row.proposed_action,
        "detected_at": row.detected_at.isoformat() if row.detected_at else None,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
        "decided_by": row.decided_by,
        "resolution_note": row.resolution_note,
    }
