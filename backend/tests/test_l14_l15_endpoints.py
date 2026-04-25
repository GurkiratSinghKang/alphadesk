"""Round-6 L-14 + L-15 — endpoint hardening.

L-14: /readyz-full now requires auth; /livez and /readyz no longer
leak ``git_sha`` to unauthenticated callers.
L-15: /refresh rejects concurrent calls on the same refresh-token jti
with 401 ``concurrent_refresh``.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

# Set env BEFORE module import.
os.environ.setdefault("JWT_SECRET", "test-secret-for-l14-l15-" + "x" * 32)
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SKIP_DB_INIT", "true")

import pytest


# ---------------------------------------------------------------------------
# L-14 — public health endpoints don't leak git_sha
# ---------------------------------------------------------------------------


def test_livez_does_not_leak_git_sha():
    """Unauthenticated /livez carries only ``status``."""
    from fastapi.testclient import TestClient

    from main import app

    with TestClient(app) as client:
        resp = client.get("/livez")
    body = resp.json()
    assert resp.status_code == 200
    assert body == {"status": "ok"}
    assert "git_sha" not in body


def test_health_does_not_leak_git_sha():
    """Backward-compat /health alias also strips git_sha."""
    from fastapi.testclient import TestClient

    from main import app

    with TestClient(app) as client:
        resp = client.get("/health")
    body = resp.json()
    assert resp.status_code == 200
    assert body == {"status": "ok"}
    assert "git_sha" not in body


def test_readyz_full_requires_auth():
    """Without the conftest auth override, /readyz-full 401s."""
    from fastapi.testclient import TestClient

    from main import app
    from core.auth import require_auth

    # Temporarily REMOVE the test-suite's auth override so the
    # production behaviour applies — /readyz-full should reject
    # unauthenticated callers.
    saved = app.dependency_overrides.pop(require_auth, None)
    try:
        with TestClient(app) as client:
            resp = client.get("/readyz-full")
        assert resp.status_code == 401, (
            f"expected 401 without auth, got {resp.status_code}: {resp.text!r}"
        )
    finally:
        if saved is not None:
            app.dependency_overrides[require_auth] = saved


# ---------------------------------------------------------------------------
# L-15 — concurrent refresh on the same jti is rejected
# ---------------------------------------------------------------------------


def _build_refresh_token(*, jti: str = "ref-jti-1") -> str:
    """Hand-craft a Round-6 refresh token with a known jti."""
    import jwt as _jwt
    from core.auth import (
        ALGORITHM,
        JWT_AUDIENCE,
        JWT_ISSUER,
    )
    from core.config import settings

    now = datetime.now(timezone.utc)
    return _jwt.encode(
        {
            "sub": "admin",
            "exp": now + timedelta(days=30),
            "iat": now,
            "nbf": now,
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "type": "refresh",
            "jti": jti,
            "pv": 1,
            "epoch": 1,
        },
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )


@pytest.mark.asyncio
async def test_refresh_rejects_concurrent_request(monkeypatch):
    """Two concurrent /refresh calls with the same jti: the second
    sees the in-progress lock and 401s with reason=concurrent_refresh.

    We simulate by stubbing redis.set to return False (the NX path
    when the key already exists).
    """
    from api.routes.auth import refresh, RefreshRequest
    from fastapi import HTTPException

    token = _build_refresh_token(jti="ref-jti-concurrent")

    # Fake Redis whose .set(NX=True) returns False — simulating that
    # another caller already holds the lock.
    fake_redis = AsyncMock()
    fake_redis.set = AsyncMock(return_value=False)
    fake_redis.get = AsyncMock(return_value=None)

    async def _get_redis():
        return fake_redis

    import core.redis as redis_mod
    monkeypatch.setattr(redis_mod, "get_redis", _get_redis)

    # Stub revocation check so the prior gate doesn't interfere.
    async def _not_revoked(_jti):
        return False

    import core.auth as auth_mod
    monkeypatch.setattr(auth_mod, "is_token_revoked", _not_revoked)

    fake_req = MagicMock()
    fake_req.client.host = "127.0.0.1"
    fake_req.headers = {"x-client": "cli"}
    fake_req.state.request_id = "req-1"
    fake_req.cookies = {}

    body = RefreshRequest(refresh_token=token)
    with pytest.raises(HTTPException) as exc_info:
        await refresh(body, fake_req)
    assert exc_info.value.status_code == 401
    detail = str(exc_info.value.detail).lower()
    assert "concurrent" in detail


@pytest.mark.asyncio
async def test_refresh_acquires_lock_on_first_call(monkeypatch):
    """When redis.set(NX=True) returns truthy, the refresh proceeds
    (or fails on a later step — we just check the lock didn't 401)."""
    from api.routes.auth import refresh, RefreshRequest
    from fastapi import HTTPException

    token = _build_refresh_token(jti="ref-jti-first-call")

    # Lock acquired (set returns True).
    fake_redis = AsyncMock()
    fake_redis.set = AsyncMock(return_value=True)
    fake_redis.get = AsyncMock(return_value=None)

    async def _get_redis():
        return fake_redis

    import core.redis as redis_mod
    monkeypatch.setattr(redis_mod, "get_redis", _get_redis)

    async def _not_revoked(_jti):
        return False

    import core.auth as auth_mod
    monkeypatch.setattr(auth_mod, "is_token_revoked", _not_revoked)

    fake_req = MagicMock()
    fake_req.client.host = "127.0.0.1"
    fake_req.headers = {"x-client": "cli"}
    fake_req.state.request_id = "req-1"
    fake_req.cookies = {}

    body = RefreshRequest(refresh_token=token)
    # Will eventually fail at the password_version step (Redis stub
    # doesn't match real semantics), but the FIRST possible 401 with
    # ``concurrent`` in the detail must NOT fire.
    try:
        await refresh(body, fake_req)
    except HTTPException as e:
        if e.status_code == 401 and "concurrent" in str(e.detail).lower():
            raise AssertionError(
                f"refresh wrongly rejected with concurrent_refresh: {e.detail}"
            )
    # Either succeeded or hit a different step; both prove the L-15
    # path didn't 401 us.
