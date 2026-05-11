"""B.16 — Per-user settings.

The Phase 1.5 v2 Appearance section in the frontend reads this for
density / theme persistence. Other v2 features (B.5 approval, B.11
onboarding) seed defaults via the same model.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.routes.auth import require_auth
from core.audit import write_audit
from core.database import get_db
from core.http import client_ip


router = APIRouter(prefix="/user/settings", tags=["user-settings-v2"])
mode_router = APIRouter(prefix="/user", tags=["user-trading-mode-v2"])

TradingMode = Literal["paper", "live"]


class UserSettingsOut(BaseModel):
    default_broker_connection_id: int | None = None
    slippage_tolerance_bps: float = 10.0
    default_order_qty: int = 100
    fast_fill_confirms: bool = True
    trading_mode: TradingMode = "paper"
    trading_mode_updated_at: datetime | None = None
    live_step_up_at: datetime | None = None
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


class TradingModeRequest(BaseModel):
    mode: TradingMode
    totp_code: str | None = Field(default=None, min_length=6, max_length=8)


class TradingModeOut(BaseModel):
    mode: TradingMode
    updated_at: datetime | None = None
    live_step_up_at: datetime | None = None


def _row_to_out(row) -> UserSettingsOut:
    return UserSettingsOut(
        default_broker_connection_id=row.default_broker_connection_id,
        slippage_tolerance_bps=float(row.slippage_tolerance_bps),
        default_order_qty=int(row.default_order_qty),
        fast_fill_confirms=bool(row.fast_fill_confirms),
        trading_mode=(row.trading_mode or "paper"),
        trading_mode_updated_at=row.trading_mode_updated_at,
        live_step_up_at=row.live_step_up_at,
        appearance=row.appearance,
        shortcuts=row.shortcuts,
        feed_providers=row.feed_providers,
    )


def _mode_out(row) -> TradingModeOut:
    return TradingModeOut(
        mode=(row.trading_mode or "paper"),
        updated_at=row.trading_mode_updated_at,
        live_step_up_at=row.live_step_up_at,
    )


async def _get_or_create_settings(username: str, db):
    from data.storage.models import UserSettings

    changed = False
    result = await db.execute(
        select(UserSettings).where(UserSettings.username == username)
    )
    row = result.scalars().first()
    if row is None:
        row = UserSettings(username=username)
        db.add(row)
        await db.flush()
        changed = True
    if not row.trading_mode:
        row.trading_mode = "paper"
        changed = True
    return row, changed


async def _validate_live_step_up(username: str, totp_code: str | None) -> None:
    from api.routes.auth import _get_totp_secret, _require_pyotp

    secret = await _get_totp_secret(username)
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="2FA enrollment required before enabling live trading",
        )
    code = (totp_code or "").strip()
    if not code:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="TOTP code required to enable live trading",
        )
    pyotp = _require_pyotp()
    if not pyotp.TOTP(secret).verify(code, valid_window=1):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid TOTP code",
        )


@router.get("", response_model=UserSettingsOut)
async def get_user_settings(
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> UserSettingsOut:
    row, changed = await _get_or_create_settings(username, db)
    if changed:
        await db.commit()
        await db.refresh(row)
    return _row_to_out(row)


@router.patch("", response_model=UserSettingsOut)
async def patch_user_settings(
    payload: UserSettingsPatch,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> UserSettingsOut:
    row, _changed = await _get_or_create_settings(username, db)
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
    row, _changed = await _get_or_create_settings(username, db)
    row.slippage_tolerance_bps = 10
    row.default_order_qty = 100
    row.fast_fill_confirms = True
    row.trading_mode = "paper"
    row.trading_mode_updated_at = datetime.now(timezone.utc)
    row.live_step_up_at = None
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


@mode_router.get("/trading-mode", response_model=TradingModeOut)
async def get_trading_mode(
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> TradingModeOut:
    row, changed = await _get_or_create_settings(username, db)
    if changed:
        await db.commit()
        await db.refresh(row)
    return _mode_out(row)


@mode_router.post("/trading-mode", response_model=TradingModeOut)
async def set_trading_mode(
    payload: TradingModeRequest,
    req: Request,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> TradingModeOut:
    row, _changed = await _get_or_create_settings(username, db)
    previous_mode = row.trading_mode or "paper"
    now = datetime.now(timezone.utc)

    if payload.mode == "live" and previous_mode != "live":
        try:
            await _validate_live_step_up(username, payload.totp_code)
        except HTTPException as exc:
            await write_audit(
                event="mode_change_denied",
                username=username,
                ip=client_ip(req),
                request_id=getattr(req.state, "request_id", None),
                details={
                    "from": previous_mode,
                    "to": payload.mode,
                    "reason": str(exc.detail),
                },
            )
            raise
        row.live_step_up_at = now

    if payload.mode == "paper":
        row.live_step_up_at = None

    row.trading_mode = payload.mode
    row.trading_mode_updated_at = now
    await db.commit()
    await db.refresh(row)
    await write_audit(
        event="mode_change",
        username=username,
        ip=client_ip(req),
        request_id=getattr(req.state, "request_id", None),
        details={"from": previous_mode, "to": payload.mode},
    )
    return _mode_out(row)
