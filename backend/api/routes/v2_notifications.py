"""B.4 — User-scoped notifications inbox.

v2 categories: fill / agent / risk / system / billing / support.
Routes the /api/v1/notifications surface that the frontend
NotificationDrawer consumes.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from api.routes.auth import require_auth
from core.audit import write_audit
from core.database import get_db


router = APIRouter(prefix="/notifications", tags=["notifications-v2"])


NotificationType = Literal["fill", "agent", "risk", "system", "billing", "support"]


class NotificationOut(BaseModel):
    id: int
    type: str
    severity: str
    title: str
    body: str
    link: str | None = None
    created_at: str
    read_at: str | None = None


class NotificationPreferenceOut(BaseModel):
    type: str
    channel_email: bool
    channel_push: bool
    channel_slack: bool
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None
    quiet_hours_tz: str | None = None
    min_severity: str


class NotificationPreferencePatch(BaseModel):
    channel_email: bool | None = None
    channel_push: bool | None = None
    channel_slack: bool | None = None
    quiet_hours_start: str | None = Field(default=None, max_length=8)
    quiet_hours_end: str | None = Field(default=None, max_length=8)
    quiet_hours_tz: str | None = Field(default=None, max_length=48)
    min_severity: Literal["info", "warning", "error"] | None = None


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    type: NotificationType | None = None,
    unread_only: bool = False,
    limit: int = 50,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> list[NotificationOut]:
    from data.storage.models import Notification

    stmt = select(Notification).where(Notification.username == username)
    if type:
        stmt = stmt.where(Notification.type == type)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(min(limit, 200))
    result = await db.execute(stmt)
    return [
        NotificationOut(
            id=int(row.id),
            type=row.type,
            severity=row.severity,
            title=row.title,
            body=row.body,
            link=row.link,
            created_at=row.created_at.isoformat(),
            read_at=row.read_at.isoformat() if row.read_at else None,
        )
        for row in result.scalars().all()
    ]


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    notification_id: int,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> None:
    from data.storage.models import Notification

    await db.execute(
        update(Notification)
        .where(Notification.id == notification_id, Notification.username == username)
        .values(read_at=datetime.now(timezone.utc))
    )
    await db.commit()


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    type: NotificationType | None = None,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> None:
    from data.storage.models import Notification

    stmt = (
        update(Notification)
        .where(Notification.username == username, Notification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
    )
    if type:
        stmt = stmt.where(Notification.type == type)
    await db.execute(stmt)
    await db.commit()


@router.get("/preferences", response_model=list[NotificationPreferenceOut])
async def list_preferences(
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> list[NotificationPreferenceOut]:
    from data.storage.models import NotificationPreference

    result = await db.execute(
        select(NotificationPreference).where(NotificationPreference.username == username)
    )
    return [
        NotificationPreferenceOut(
            type=row.type,
            channel_email=bool(row.channel_email),
            channel_push=bool(row.channel_push),
            channel_slack=bool(row.channel_slack),
            quiet_hours_start=row.quiet_hours_start,
            quiet_hours_end=row.quiet_hours_end,
            quiet_hours_tz=row.quiet_hours_tz,
            min_severity=row.min_severity,
        )
        for row in result.scalars().all()
    ]


@router.patch("/preferences/{type}", response_model=NotificationPreferenceOut)
async def patch_preference(
    type: NotificationType,
    payload: NotificationPreferencePatch,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> NotificationPreferenceOut:
    from data.storage.models import NotificationPreference

    result = await db.execute(
        select(NotificationPreference).where(
            NotificationPreference.username == username,
            NotificationPreference.type == type,
        )
    )
    row = result.scalars().first()
    if row is None:
        # Auto-provision a default row for first-time pref edits.
        row = NotificationPreference(username=username, type=type)
        db.add(row)
        await db.flush()

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.commit()
    await db.refresh(row)
    await write_audit(
        event="notification_preferences_updated",
        username=username,
        ip=None,
        request_id=None,
        details={"type": type, "patch": payload.model_dump(exclude_unset=True)},
    )
    return NotificationPreferenceOut(
        type=row.type,
        channel_email=bool(row.channel_email),
        channel_push=bool(row.channel_push),
        channel_slack=bool(row.channel_slack),
        quiet_hours_start=row.quiet_hours_start,
        quiet_hours_end=row.quiet_hours_end,
        quiet_hours_tz=row.quiet_hours_tz,
        min_severity=row.min_severity,
    )
