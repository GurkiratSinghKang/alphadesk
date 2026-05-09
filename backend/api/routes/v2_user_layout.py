"""B.6 — User-scoped layout config + admin override.

Mirrors the existing app_config layout (admin global) with a per-user
override layer. Resolution: user-row wins; falls back to global.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.routes.auth import require_auth
from core.audit import write_audit
from core.database import get_db


router = APIRouter(prefix="/user/layout", tags=["user-layout-v2"])


class LayoutOut(BaseModel):
    key: str
    value: dict


class LayoutPatch(BaseModel):
    key: str = Field(..., min_length=1, max_length=64)
    value: dict


@router.get("", response_model=list[LayoutOut])
async def get_user_layout(
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> list[LayoutOut]:
    from data.storage.models import UserLayoutConfig

    result = await db.execute(
        select(UserLayoutConfig).where(UserLayoutConfig.username == username)
    )
    return [
        LayoutOut(key=row.config_key, value=row.value_json)
        for row in result.scalars().all()
    ]


@router.patch("", response_model=LayoutOut)
async def patch_user_layout(
    payload: LayoutPatch,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> LayoutOut:
    from data.storage.models import UserLayoutConfig

    result = await db.execute(
        select(UserLayoutConfig).where(
            UserLayoutConfig.username == username,
            UserLayoutConfig.config_key == payload.key,
        )
    )
    row = result.scalars().first()
    if row is None:
        row = UserLayoutConfig(
            username=username,
            config_key=payload.key,
            value_json=payload.value,
            updated_by=username,
        )
        db.add(row)
    else:
        row.value_json = payload.value
        row.updated_by = username
    await db.commit()
    await db.refresh(row)
    await write_audit(
        event="user_layout_updated",
        username=username,
        ip=None,
        request_id=None,
        details={"key": payload.key},
    )
    return LayoutOut(key=row.config_key, value=row.value_json)
