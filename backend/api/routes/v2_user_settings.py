"""B.16 — Per-user settings.

The Phase 1.5 v2 Appearance section in the frontend reads this for
density / theme persistence. Other v2 features (B.5 approval, B.11
onboarding) seed defaults via the same model.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.routes.auth import require_auth
from core.audit import write_audit
from core.database import get_db


router = APIRouter(prefix="/user/settings", tags=["user-settings-v2"])


class UserSettingsOut(BaseModel):
    default_broker_connection_id: int | None = None
    slippage_tolerance_bps: float = 10.0
    default_order_qty: int = 100
    fast_fill_confirms: bool = True
    appearance: dict | None = None
    shortcuts: dict | None = None
    feed_providers: dict | None = None


class UserSettingsPatch(BaseModel):
    default_broker_connection_id: int | None = None
    slippage_tolerance_bps: float | None = Field(default=None, ge=0, le=1000)
    default_order_qty: int | None = Field(default=None, ge=1, le=100_000)
    fast_fill_confirms: bool | None = None
    appearance: dict | None = None
    shortcuts: dict | None = None
    feed_providers: dict | None = None


def _row_to_out(row) -> UserSettingsOut:
    return UserSettingsOut(
        default_broker_connection_id=row.default_broker_connection_id,
        slippage_tolerance_bps=float(row.slippage_tolerance_bps),
        default_order_qty=int(row.default_order_qty),
        fast_fill_confirms=bool(row.fast_fill_confirms),
        appearance=row.appearance,
        shortcuts=row.shortcuts,
        feed_providers=row.feed_providers,
    )


@router.get("", response_model=UserSettingsOut)
async def get_user_settings(
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> UserSettingsOut:
    from data.storage.models import UserSettings

    result = await db.execute(
        select(UserSettings).where(UserSettings.username == username)
    )
    row = result.scalars().first()
    if row is None:
        # Auto-provision on first read so consumers always get a row.
        row = UserSettings(username=username)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return _row_to_out(row)


@router.patch("", response_model=UserSettingsOut)
async def patch_user_settings(
    payload: UserSettingsPatch,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> UserSettingsOut:
    from data.storage.models import UserSettings

    result = await db.execute(
        select(UserSettings).where(UserSettings.username == username)
    )
    row = result.scalars().first()
    if row is None:
        row = UserSettings(username=username)
        db.add(row)
        await db.flush()
    patch = payload.model_dump(exclude_unset=True)
    for field, value in patch.items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    await write_audit(
        event="user_settings_updated",
        username=username,
        ip=None,
        request_id=None,
        details={"patch_keys": list(patch.keys())},
    )
    return _row_to_out(row)


@router.post("/reset", response_model=UserSettingsOut)
async def reset_user_settings(
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> UserSettingsOut:
    from data.storage.models import UserSettings

    result = await db.execute(
        select(UserSettings).where(UserSettings.username == username)
    )
    row = result.scalars().first()
    if row is None:
        row = UserSettings(username=username)
        db.add(row)
    else:
        row.slippage_tolerance_bps = 10
        row.default_order_qty = 100
        row.fast_fill_confirms = True
        row.appearance = None
        row.shortcuts = None
        row.feed_providers = None
    await db.commit()
    await db.refresh(row)
    await write_audit(
        event="user_settings_reset",
        username=username,
        ip=None,
        request_id=None,
        details={},
    )
    return _row_to_out(row)
