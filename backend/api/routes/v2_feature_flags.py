"""B.8 — Runtime feature flags.

Resolution order: user override > tenant override > environment
override > default. Phase 1 backend skips the override scopes for
simplicity — endpoint returns the default-enabled set with admin
toggles. Phase 2 follow-up wires the override resolver.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from api.routes.auth import require_admin, require_auth
from core.audit import write_audit
from core.database import get_db


router = APIRouter(prefix="/feature-flags", tags=["feature-flags"])
admin_router = APIRouter(prefix="/admin/feature-flags", tags=["feature-flags-admin"])


class FlagOut(BaseModel):
    key: str
    enabled: bool
    default_enabled: bool
    rollout_status: str
    description: str | None = None


class FlagPatch(BaseModel):
    default_enabled: bool | None = None
    rollout_status: str | None = None


@router.get("", response_model=list[FlagOut])
async def list_caller_flags(
    _: str = Depends(require_auth),
    db=Depends(get_db),
) -> list[FlagOut]:
    """Caller-visible flag set. Phase 1: returns default-enabled."""
    from data.storage.models import FeatureFlag

    result = await db.execute(select(FeatureFlag).order_by(FeatureFlag.flag_key.asc()))
    return [
        FlagOut(
            key=row.flag_key,
            enabled=bool(row.default_enabled),
            default_enabled=bool(row.default_enabled),
            rollout_status=row.rollout_status,
            description=row.description,
        )
        for row in result.scalars().all()
    ]


@admin_router.get("", response_model=list[FlagOut])
async def list_all_flags(
    _: str = Depends(require_admin),
    db=Depends(get_db),
) -> list[FlagOut]:
    from data.storage.models import FeatureFlag

    result = await db.execute(select(FeatureFlag).order_by(FeatureFlag.flag_key.asc()))
    return [
        FlagOut(
            key=row.flag_key,
            enabled=bool(row.default_enabled),
            default_enabled=bool(row.default_enabled),
            rollout_status=row.rollout_status,
            description=row.description,
        )
        for row in result.scalars().all()
    ]


@admin_router.patch("/{key}", response_model=FlagOut)
async def patch_flag(
    key: str,
    payload: FlagPatch,
    actor: str = Depends(require_admin),
    db=Depends(get_db),
) -> FlagOut:
    from data.storage.models import FeatureFlag

    result = await db.execute(select(FeatureFlag).where(FeatureFlag.flag_key == key))
    row = result.scalars().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flag not found")
    changed: dict = {}
    if payload.default_enabled is not None and bool(row.default_enabled) != bool(payload.default_enabled):
        row.default_enabled = bool(payload.default_enabled)
        changed["default_enabled"] = row.default_enabled
    if payload.rollout_status is not None and payload.rollout_status != row.rollout_status:
        row.rollout_status = payload.rollout_status
        changed["rollout_status"] = payload.rollout_status
    if changed:
        await db.commit()
        await db.refresh(row)
        await write_audit(
            event="feature_flag_default_changed",
            username=actor,
            ip=None,
            request_id=None,
            details={"key": key, "changes": changed},
        )
    return FlagOut(
        key=row.flag_key,
        enabled=bool(row.default_enabled),
        default_enabled=bool(row.default_enabled),
        rollout_status=row.rollout_status,
        description=row.description,
    )
