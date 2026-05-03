from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from core.config import settings


async def get_user(username: str) -> Any | None:
    if settings.SKIP_DB_INIT:
        return None
    from core.database import _get_session_factory
    from data.storage.models import User

    factory = _get_session_factory()
    async with factory() as db:
        return (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()


async def is_admin_user(username: str) -> bool:
    if username == settings.ADMIN_USERNAME:
        return True
    row = await get_user(username)
    return bool(row and row.status == "active" and row.role == "admin")


async def ensure_user_record(
    username: str,
    *,
    email: str | None = None,
    password_hash: str | None = None,
    role: str | None = None,
    display_name: str | None = None,
    mark_login: bool = False,
) -> Any | None:
    """Create/update the durable user profile without disturbing auth fallback."""
    if settings.SKIP_DB_INIT:
        return None
    from core.database import _get_session_factory
    from data.storage.models import User

    normalized = username.strip()
    if not normalized:
        return None
    factory = _get_session_factory()
    async with factory() as db:
        row = (await db.execute(select(User).where(User.username == normalized))).scalar_one_or_none()
        if row is None:
            row = User(
                username=normalized,
                email=email,
                password_hash=password_hash,
                role=role or ("admin" if normalized == settings.ADMIN_USERNAME else "user"),
                status="active",
                display_name=display_name,
                profile={},
            )
            db.add(row)
        else:
            if email is not None:
                row.email = email
            if password_hash is not None:
                row.password_hash = password_hash
            if role is not None:
                row.role = role
            if display_name is not None:
                row.display_name = display_name
        if mark_login:
            row.last_login_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(row)
        return row


def user_to_dict(row: Any, *, include_email: bool = True) -> dict[str, Any]:
    return {
        "id": row.id,
        "username": row.username,
        "email": row.email if include_email else None,
        "role": row.role,
        "status": row.status,
        "display_name": row.display_name,
        "profile": row.profile or {},
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "last_login_at": row.last_login_at.isoformat() if row.last_login_at else None,
    }
