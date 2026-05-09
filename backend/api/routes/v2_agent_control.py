"""B.2 — Per-agent control (pause + spend cap).

Controls four archetypes (research / signal / risk / exec). Phase B
seeds a wildcard row per archetype with a $50/day default cap.

Endpoints:
  GET   /api/v1/agents/controls
  PATCH /api/v1/agents/controls/{id}
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.routes.auth import require_admin, require_auth
from core.audit import write_audit
from core.database import get_db


router = APIRouter(prefix="/agents/controls", tags=["agents-controls"])


class AgentControlOut(BaseModel):
    id: int
    archetype: str
    model: str | None = None
    provider: str | None = None
    is_paused: bool
    daily_spend_cap_usd: float | None = None
    paused_by: str | None = None
    paused_at: str | None = None
    reason: str | None = None
    updated_at: str | None = None


class AgentControlPatch(BaseModel):
    is_paused: bool | None = None
    daily_spend_cap_usd: float | None = Field(default=None, ge=0)
    reason: str | None = Field(default=None, max_length=500)


def _row_to_out(row) -> AgentControlOut:
    return AgentControlOut(
        id=int(row.id),
        archetype=row.archetype,
        model=row.model,
        provider=row.provider,
        is_paused=bool(row.is_paused),
        daily_spend_cap_usd=float(row.daily_spend_cap_usd) if row.daily_spend_cap_usd is not None else None,
        paused_by=row.paused_by,
        paused_at=row.paused_at.isoformat() if row.paused_at else None,
        reason=row.reason,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )


@router.get("", response_model=list[AgentControlOut])
async def list_controls(
    _: str = Depends(require_auth),
    db=Depends(get_db),
) -> list[AgentControlOut]:
    from data.storage.models import AgentControl

    result = await db.execute(
        select(AgentControl).order_by(AgentControl.archetype.asc(), AgentControl.id.asc())
    )
    return [_row_to_out(r) for r in result.scalars().all()]


@router.patch("/{control_id}", response_model=AgentControlOut)
async def patch_control(
    control_id: int,
    payload: AgentControlPatch,
    actor: str = Depends(require_admin),
    db=Depends(get_db),
) -> AgentControlOut:
    from data.storage.models import AgentControl

    result = await db.execute(
        select(AgentControl).where(AgentControl.id == control_id)
    )
    row = result.scalars().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Control not found")

    changed: dict = {}
    if payload.is_paused is not None and bool(row.is_paused) != bool(payload.is_paused):
        row.is_paused = bool(payload.is_paused)
        changed["is_paused"] = row.is_paused
        if row.is_paused:
            row.paused_by = actor
            row.paused_at = datetime.now(timezone.utc)
        else:
            row.paused_by = None
            row.paused_at = None
    if payload.daily_spend_cap_usd is not None:
        row.daily_spend_cap_usd = payload.daily_spend_cap_usd
        changed["daily_spend_cap_usd"] = float(payload.daily_spend_cap_usd)
    if payload.reason is not None:
        row.reason = payload.reason
        changed["reason"] = payload.reason

    if changed:
        await db.commit()
        await db.refresh(row)
        await write_audit(
            event="agent_control_changed",
            username=actor,
            ip=None,
            request_id=None,
            details={"id": control_id, "archetype": row.archetype, "changes": changed},
        )
    return _row_to_out(row)
