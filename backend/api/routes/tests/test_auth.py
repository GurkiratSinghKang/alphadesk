"""Tests for the Wave 2I backend auth hardening.

Covers:

1. ``password_version`` bump invalidates outstanding tokens (Fix 1 / P81-2).
2. ``session_epoch`` bump via /logout-all invalidates outstanding tokens
   (Fix 3 / P81-6).
3. Rate limit is keyed by (IP, username) pair (Fix 5 / P83-1).
4. JWT ``decode_token`` honours ±60s leeway (Fix 4 / P83-4).

These tests intentionally avoid spinning up the full FastAPI app — they
exercise the primitives directly with a fake Redis-like store, because the
project's running test suite has no HTTP integration harness yet.
"""

from __future__ import annotations

import asyncio
import importlib
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

# A plausible bcrypt hash for the test admin. Generated at import time so we
# don't hard-code anything; bcrypt's cost=4 keeps the test suite snappy.
_TEST_USERNAME = "admin"
_TEST_PASSWORD = "correct-horse-battery-staple"  # 28 chars — passes the 12-char policy


# --------------------------------------------------------------------------- #
# Shared fake Redis                                                           #
# --------------------------------------------------------------------------- #
#
# ``core.auth`` and ``api.routes.auth`` call out to a real Redis via
# ``core.redis.get_redis``. For unit tests we swap that with an in-memory
# dict-backed double that supports the handful of commands the auth code
# uses: ``get``, ``set``, ``delete``, ``incr``, ``pipeline`` (``incr`` +
# ``expire`` + ``execute``).


class _FakeRedisPipeline:
    def __init__(self, store: dict[str, Any]):
        self._store = store
        self._ops: list = []

    def incr(self, key: str) -> "_FakeRedisPipeline":
        self._ops.append(("incr", key))
        return self

    def expire(self, key: str, seconds: int, nx: bool = False) -> "_FakeRedisPipeline":
        self._ops.append(("expire", key, seconds, nx))
        return self

    async def execute(self):
        results = []
        for op in self._ops:
            if op[0] == "incr":
                _, k = op
                val = int(self._store.get(k, 0)) + 1
                self._store[k] = str(val)
                results.append(val)
            elif op[0] == "expire":
                # Fake TTL — we don't need real expiration for these tests.
                results.append(True)
        self._ops.clear()
        return results


class _FakeRedis:
    def __init__(self):
        self.store: dict[str, Any] = {}

    async def get(self, key: str):
        v = self.store.get(key)
        if v is None:
            return None
        # decode_responses=True semantics — return str, not bytes
        return v

    async def set(self, key: str, value: Any, ex: int | None = None):
        self.store[key] = value
        return True

    async def incr(self, key: str) -> int:
        val = int(self.store.get(key, 0)) + 1
        self.store[key] = str(val)
        return val

    async def delete(self, key: str):
        self.store.pop(key, None)
        return 1

    def pipeline(self) -> _FakeRedisPipeline:
        return _FakeRedisPipeline(self.store)


@pytest.fixture
def fake_redis(monkeypatch):
    """Install a module-wide fake Redis so all auth helpers share state.

    Patches both ``core.redis.get_redis`` and ``core.redis.cache_set`` —
    the latter is what ``revoke_token`` uses to add jtis to the blocklist.
    """
    import core.redis as redis_mod

    fake = _FakeRedis()

    async def _get_redis():
        return fake

    async def _cache_set(key: str, data: Any, ttl_seconds: int = 300) -> None:
        # We don't need orjson encoding for these tests — store the dict
        # directly but keep the key shape identical to production.
        fake.store[key] = "revoked"

    async def _cache_get(key: str):
        v = fake.store.get(key)
        return v

    monkeypatch.setattr(redis_mod, "get_redis", _get_redis)
    monkeypatch.setattr(redis_mod, "cache_set", _cache_set)
    monkeypatch.setattr(redis_mod, "cache_get", _cache_get)

    # In-process revocation cache survives across tests if we don't wipe it.
    import core.auth as core_auth_mod
    core_auth_mod._REVOCATION_CACHE.clear()

    # In-memory rate-limit counters are process-local; wipe them too.
    import api.routes.auth as auth_routes_mod
    auth_routes_mod._INMEM_ATTEMPTS.clear()
    auth_routes_mod._RUNTIME_ADMIN_HASH = None

    yield fake


@pytest.fixture
def test_jwt_env(monkeypatch):
    """Make sure settings.jwt_secret_value resolves to a deterministic value.

    Pydantic reads from env on first access; we seed JWT_SECRET and ensure
    ADMIN_USERNAME / ADMIN_PASSWORD_HASH match the test fixture constants.
    """
    # Lazy import so monkeypatching env before import takes effect.
    os.environ["JWT_SECRET"] = "test-secret-for-wave-2i-" + "x" * 32

    from core.config import Settings
    import core.config as cfg_mod

    new_settings = Settings()
    # The bcrypt hash for _TEST_PASSWORD at cost=4 — precomputed so we don't
    # pay bcrypt setup cost per test.
    import bcrypt
    new_settings.ADMIN_USERNAME = _TEST_USERNAME
    new_settings.ADMIN_PASSWORD_HASH = bcrypt.hashpw(
        _TEST_PASSWORD.encode(), bcrypt.gensalt(rounds=4)
    ).decode()
    # Point every module that captured a reference at this new object.
    monkeypatch.setattr(cfg_mod, "settings", new_settings)

    import core.auth as core_auth_mod
    monkeypatch.setattr(core_auth_mod, "settings", new_settings)

    import api.routes.auth as auth_routes_mod
    monkeypatch.setattr(auth_routes_mod, "settings", new_settings)

    return new_settings


# --------------------------------------------------------------------------- #
# Fix 1 — password-version invalidation                                       #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_password_change_invalidates_existing_access_token(
    fake_redis, test_jwt_env,
):
    """After bumping password_version, a previously-minted token fails auth."""
    from core.auth import (
        bump_password_version,
        create_access_token,
        get_password_version,
        require_auth,
    )

    # Mint a token under the default pv=1.
    pv = await get_password_version(_TEST_USERNAME)
    assert pv == 1
    token = create_access_token(_TEST_USERNAME, password_version=pv, session_epoch=1)

    # Token is valid before the password change.
    from fastapi.security import HTTPAuthorizationCredentials

    class _ReqStub:
        cookies: dict[str, str] = {}
        headers: dict[str, str] = {}
        client = None

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    who = await require_auth(_ReqStub(), credentials=credentials)
    assert who == _TEST_USERNAME

    # Bump password_version — simulates a successful /change-password.
    new_pv = await bump_password_version(_TEST_USERNAME)
    assert new_pv == 2

    # Same token no longer validates.
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await require_auth(_ReqStub(), credentials=credentials)
    assert exc_info.value.status_code == 401
    assert "password change" in str(exc_info.value.detail).lower()


@pytest.mark.asyncio
async def test_new_token_after_password_change_still_works(
    fake_redis, test_jwt_env,
):
    """A token minted AT the new pv survives the bump — only older tokens die."""
    from core.auth import (
        bump_password_version,
        create_access_token,
        get_password_version,
        require_auth,
    )
    from fastapi.security import HTTPAuthorizationCredentials

    # Bump first, then mint.
    new_pv = await bump_password_version(_TEST_USERNAME)
    assert new_pv == 2

    current_pv = await get_password_version(_TEST_USERNAME)
    token = create_access_token(_TEST_USERNAME, password_version=current_pv, session_epoch=1)

    class _ReqStub:
        cookies: dict[str, str] = {}
        headers: dict[str, str] = {}
        client = None

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    who = await require_auth(_ReqStub(), credentials=credentials)
    assert who == _TEST_USERNAME


# --------------------------------------------------------------------------- #
# Fix 3 — logout-all / session_epoch                                          #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_logout_all_invalidates_existing_tokens(fake_redis, test_jwt_env):
    """Bumping session_epoch kills every token minted at the prior epoch."""
    from core.auth import (
        bump_session_epoch,
        create_access_token,
        get_session_epoch,
        require_auth,
    )
    from fastapi.security import HTTPAuthorizationCredentials
    from fastapi import HTTPException

    # Mint at epoch=1.
    epoch = await get_session_epoch(_TEST_USERNAME)
    assert epoch == 1
    token = create_access_token(_TEST_USERNAME, password_version=1, session_epoch=epoch)

    class _ReqStub:
        cookies: dict[str, str] = {}
        headers: dict[str, str] = {}
        client = None

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    # Valid before.
    assert await require_auth(_ReqStub(), credentials=credentials) == _TEST_USERNAME

    # Bump — simulates /logout-all.
    new_epoch = await bump_session_epoch(_TEST_USERNAME)
    assert new_epoch == 2

    # Invalid after.
    with pytest.raises(HTTPException) as exc_info:
        await require_auth(_ReqStub(), credentials=credentials)
    assert exc_info.value.status_code == 401
    assert "session" in str(exc_info.value.detail).lower()


# --------------------------------------------------------------------------- #
# Fix 5 — rate limit keyed by (IP, username)                                  #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_rate_limit_keyed_by_ip_and_username(fake_redis, test_jwt_env):
    """User A's typos on IP X must not lock out user B on the same IP.

    Exercises ``_check_rate_limit`` + ``_record_login_failure`` directly.
    We run 5 failures against (IP=1.2.3.4, username=alice). The 6th attempt
    for alice trips the cap (HTTP 429). BUT an attempt for (1.2.3.4, bob)
    must still pass the check.
    """
    from fastapi import HTTPException
    import api.routes.auth as auth_mod

    ip = "1.2.3.4"
    alice = "alice"
    bob = "bob"

    # Pump alice's bucket up to the cap.
    for _ in range(auth_mod._RATE_LIMIT_MAX_PER_PAIR):
        await auth_mod._record_login_failure(ip, alice)

    # alice is locked out.
    with pytest.raises(HTTPException) as exc_info:
        await auth_mod._check_rate_limit(ip, alice)
    assert exc_info.value.status_code == 429

    # bob, same IP, is NOT locked out.
    try:
        await auth_mod._check_rate_limit(ip, bob)
    except HTTPException:
        pytest.fail("bob got locked out by alice's failures — per-pair keying broken")


@pytest.mark.asyncio
async def test_rate_limit_per_ip_backstop(fake_redis, test_jwt_env):
    """The per-IP backstop trips after the configured bot-defense cap.

    Credential-stuffing scripts iterate through many usernames from one IP.
    The per-pair cap does nothing against that pattern — this is what the
    per-IP backstop catches.
    """
    from fastapi import HTTPException
    import api.routes.auth as auth_mod

    ip = "9.9.9.9"

    # Simulate 100 failed logins against 100 different usernames.
    for i in range(auth_mod._RATE_LIMIT_MAX_PER_IP):
        await auth_mod._record_login_failure(ip, f"user{i}")

    # 101st attempt against a fresh username — the pair is clean, but the
    # IP backstop should reject.
    with pytest.raises(HTTPException) as exc_info:
        await auth_mod._check_rate_limit(ip, "user-novel")
    assert exc_info.value.status_code == 429
    assert "network" in str(exc_info.value.detail).lower()


@pytest.mark.asyncio
async def test_successful_login_clears_failures(fake_redis, test_jwt_env):
    """``_clear_login_failures`` wipes both the per-pair and per-IP counters."""
    import api.routes.auth as auth_mod

    ip = "5.5.5.5"
    user = "alice"

    for _ in range(3):
        await auth_mod._record_login_failure(ip, user)

    pair_count = await auth_mod._get_count(auth_mod._pair_key(ip, user))
    ip_count = await auth_mod._get_count(auth_mod._ip_key(ip))
    assert pair_count == 3
    assert ip_count == 3

    await auth_mod._clear_login_failures(ip, user)
    assert await auth_mod._get_count(auth_mod._pair_key(ip, user)) == 0
    assert await auth_mod._get_count(auth_mod._ip_key(ip)) == 0


# --------------------------------------------------------------------------- #
# Fix 4 — JWT clock-skew leeway                                                #
# --------------------------------------------------------------------------- #


def test_jwt_decode_accepts_token_with_small_clock_drift(fake_redis, test_jwt_env):
    """Tokens whose ``exp`` is 30s in the past still decode (±60s leeway).

    Simulates a Tor-routed client whose system clock is running slightly
    ahead of the server. Without leeway, its tokens 401 immediately on the
    first authenticated request.

    Round-6 L-5: token now also carries iat/iss/aud claims so it
    passes the new validation gate.
    """
    import jwt as jwt_lib
    from core.auth import ALGORITHM, JWT_AUDIENCE, JWT_ISSUER, decode_token
    from core.config import settings

    # Mint a token with exp=now-30s. Well inside the 60s leeway, should
    # decode.
    now = datetime.now(timezone.utc)
    past = now - timedelta(seconds=30)
    token = jwt_lib.encode(
        {
            "sub": _TEST_USERNAME,
            "exp": past,
            "iat": now - timedelta(minutes=5),
            "nbf": now - timedelta(minutes=5),
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "type": "access",
            "jti": "test-jti-1",
            "pv": 1,
            "epoch": 1,
        },
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )
    payload = decode_token(token, expected_type="access")
    assert payload["sub"] == _TEST_USERNAME


def test_jwt_decode_rejects_token_past_leeway(fake_redis, test_jwt_env):
    """A token >60s expired still fails — leeway is a pragmatic window, not unbounded."""
    import jwt as jwt_lib
    from fastapi import HTTPException
    from core.auth import ALGORITHM, decode_token
    from core.config import settings

    past = datetime.now(timezone.utc) - timedelta(seconds=120)  # 2 min past leeway
    token = jwt_lib.encode(
        {
            "sub": _TEST_USERNAME,
            "exp": past,
            "type": "access",
            "jti": "test-jti-2",
            "pv": 1,
            "epoch": 1,
        },
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )
    with pytest.raises(HTTPException) as exc_info:
        decode_token(token, expected_type="access")
    assert exc_info.value.status_code == 401


# --------------------------------------------------------------------------- #
# Sanity: create_access_token embeds pv + epoch                               #
# --------------------------------------------------------------------------- #


def test_access_token_embeds_pv_and_epoch(fake_redis, test_jwt_env):
    """Round-6 L-5: pass audience+issuer to jwt.decode so the validator
    doesn't trip on the new aud claim."""
    import jwt as jwt_lib
    from core.auth import ALGORITHM, JWT_AUDIENCE, JWT_ISSUER, create_access_token
    from core.config import settings

    token = create_access_token(_TEST_USERNAME, password_version=7, session_epoch=13)
    payload = jwt_lib.decode(
        token,
        settings.jwt_secret_value,
        algorithms=[ALGORITHM],
        audience=JWT_AUDIENCE,
        issuer=JWT_ISSUER,
    )
    assert payload["pv"] == 7
    assert payload["epoch"] == 13
    assert payload["sub"] == _TEST_USERNAME


@pytest.mark.asyncio
async def test_revoke_token_accepts_current_audience_claims(fake_redis, test_jwt_env):
    import jwt as jwt_lib
    from core.auth import ALGORITHM, JWT_AUDIENCE, JWT_ISSUER, create_refresh_token, revoke_token
    from core.config import settings

    token = create_refresh_token(_TEST_USERNAME, password_version=7, session_epoch=13)
    payload = jwt_lib.decode(
        token,
        settings.jwt_secret_value,
        algorithms=[ALGORITHM],
        audience=JWT_AUDIENCE,
        issuer=JWT_ISSUER,
    )
    await revoke_token(token)
    assert fake_redis.store.get(f"revoked:{payload['jti']}") == "revoked"
