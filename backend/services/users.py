from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func as sa_func, select

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


# ---------------------------------------------------------------------------
# is_demo_seed derivation (iter 19)
# ---------------------------------------------------------------------------
# Audit Batch E P0-05 added a "Connect your broker" CTA to the dashboard
# Action stack so brand-new operators couldn't mistake the demo seed book
# for their real one. The frontend was using ``username === "admin"`` as a
# stop-gap proxy until this flag landed — that proxy is inverted (it fires
# only for the literal admin username, which is exactly the user least
# likely to be on demo seed data).
#
# Derivation: ``is_demo_seed`` is True iff
#     * the row's role is NOT "admin"  (admins are operators, not demo
#       users — they're expected to wire credentials via env or settings)
#   AND
#     * the username has no rows in ``broker_connections`` (no broker
#       connected = still on the demo seed book).
#
# The route handlers ``GET /api/v1/user/me`` + ``POST /admin/users``
# return the dict on every authenticated profile fetch / admin user
# creation. ``/me`` is the warm path — it's hit on every dashboard load
# and (depending on the React Query cache TTL) on every navigation
# back to the desk. We cache the broker count for 60s in-process to keep
# the extra COUNT(*) off the hot path. Cache key is ``username`` (broker
# count is what we're caching), value is a tuple ``(count, expires_at)``.
# A change-to-broker-connections from elsewhere in the app may take up to
# 60s to flip the flag — acceptable: the CTA is visual nudge, not gating.
_BROKER_COUNT_TTL_S: float = 60.0
_broker_count_cache: dict[str, tuple[int, float]] = {}


def _clear_broker_count_cache() -> None:
    """Test hook — drop the in-process cache so each test starts clean."""
    _broker_count_cache.clear()


async def _broker_count_for(username: str) -> int:
    """Return the cached count of broker_connections rows for ``username``.

    60-second TTL. Read-through on miss / expiry. ``user_to_dict`` is
    invoked from the warm /me path; without the cache every dashboard
    load that bypasses React Query's stale window would emit a COUNT
    query against ``broker_connections``.
    """
    now = time.monotonic()
    cached = _broker_count_cache.get(username)
    if cached is not None and cached[1] > now:
        return cached[0]

    if settings.SKIP_DB_INIT:
        # Degraded mode — assume zero rows so a non-admin still sees the
        # demo CTA (they cannot have connected a broker without the DB).
        _broker_count_cache[username] = (0, now + _BROKER_COUNT_TTL_S)
        return 0

    from core.database import _get_session_factory
    from data.storage.models import BrokerConnection

    factory = _get_session_factory()
    async with factory() as session:
        count = (
            await session.execute(
                select(sa_func.count())
                .select_from(BrokerConnection)
                .where(BrokerConnection.username == username)
            )
        ).scalar_one()
    count_int = int(count or 0)
    _broker_count_cache[username] = (count_int, now + _BROKER_COUNT_TTL_S)
    return count_int


async def user_to_dict(row: Any, *, include_email: bool = True) -> dict[str, Any]:
    """Serialise a user row for the wire.

    Adds the derived ``is_demo_seed`` flag (iter 19, audit Batch E P0-05).
    Coroutine because the derivation queries ``broker_connections``; all
    callers are async route handlers so the await is free.
    """
    role_lower = (row.role or "").lower()
    is_demo_seed = False
    if role_lower != "admin":
        broker_count = await _broker_count_for(row.username)
        is_demo_seed = broker_count == 0
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
        "is_demo_seed": is_demo_seed,
    }
