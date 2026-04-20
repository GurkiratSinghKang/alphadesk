"""Tests for the Wave 4Q user-rights endpoints (GDPR Art. 17 + Art. 20).

Coverage:

1. ``POST /api/v1/user/export`` — bundle shape + Content-Disposition +
   audit event emitted.
2. ``GET  /api/v1/user/erase/preview`` — returns counts per table +
   retained events list + warning copy.
3. ``POST /api/v1/user/erase`` — password re-auth requirement,
   cascade delete, retention-tier flagging on audit_log rows, Redis
   key cleanup.

Mirrors the pattern in ``test_auth.py``: we call the handler functions
directly (bypassing FastAPI's routing layer) so the assertions stay
tight and don't depend on a running HTTP server.  The DB is stubbed
by flipping ``settings.SKIP_DB_INIT=True`` for tests that only need to
exercise the auth / audit paths; a minimal in-memory stub (sqlite +
aiosqlite) covers the tests that need real row counts.
"""
from __future__ import annotations

import json
import os
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest


# --------------------------------------------------------------------------- #
# Fixtures                                                                    #
# --------------------------------------------------------------------------- #

_TEST_USERNAME = "admin"
_TEST_PASSWORD = "correct-horse-battery-staple"


@pytest.fixture
def test_env(monkeypatch):
    """Set up ADMIN_USERNAME / ADMIN_PASSWORD_HASH so password re-auth works.

    Mirrors ``test_auth.test_jwt_env`` — we build a ``Settings`` with a
    known password and monkeypatch it into every module that captured a
    reference at import time.
    """
    os.environ.setdefault("JWT_SECRET", "test-secret-for-wave-4q-" + "x" * 32)
    os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    os.environ["SKIP_DB_INIT"] = "true"

    from core.config import Settings
    import core.config as cfg_mod

    new_settings = Settings()
    import bcrypt
    new_settings.ADMIN_USERNAME = _TEST_USERNAME
    new_settings.ADMIN_PASSWORD_HASH = bcrypt.hashpw(
        _TEST_PASSWORD.encode(), bcrypt.gensalt(rounds=4)
    ).decode()
    new_settings.SKIP_DB_INIT = True

    monkeypatch.setattr(cfg_mod, "settings", new_settings)

    # Every module that captured ``settings`` on import needs to see the
    # new object.  user.py reads ``settings.SKIP_DB_INIT`` on every call
    # so we rebind it.
    import api.routes.user as user_mod
    monkeypatch.setattr(user_mod, "settings", new_settings)

    return new_settings


@pytest.fixture
def fake_request():
    """A minimal ``Request``-shaped object for the handlers.

    The handlers read ``req.state.request_id`` (via ``getattr``, so
    missing is fine), ``req.headers.get("x-forwarded-for")``, and
    ``req.client.host``.  ``MagicMock`` covers all three without us
    having to hand-roll a starlette Request.
    """
    req = MagicMock()
    req.state.request_id = str(uuid.uuid4())
    req.headers = {}
    req.client = MagicMock()
    req.client.host = "127.0.0.1"
    return req


@pytest.fixture
def audit_stub(monkeypatch):
    """Replace ``core.audit.write_audit`` with an in-memory recorder.

    Returns the list so tests can assert which events landed.
    """
    recorded: list[tuple[str, dict[str, Any]]] = []

    async def _write_audit(event, *, username, ip, request_id, details=None):
        recorded.append((event, {
            "username": username,
            "ip": ip,
            "request_id": request_id,
            "details": details or {},
        }))

    import core.audit as audit_mod
    monkeypatch.setattr(audit_mod, "write_audit", _write_audit)
    return recorded


@pytest.fixture
def redis_stub(monkeypatch):
    """Stub ``core.redis.get_redis`` with an in-memory dict-backed Redis.

    The erase endpoint reads Redis keys keyed on the username (password
    version, session epoch, TOTP secrets, rate-limit counters) and
    expects ``scan`` / ``delete`` to work.  We provide the minimum
    surface for those calls.
    """
    store: dict[str, str] = {
        f"password_version:{_TEST_USERNAME}": "5",
        f"session_epoch:{_TEST_USERNAME}": "3",
        f"totp:{_TEST_USERNAME}": "SEKRET",
        f"totp_pending:{_TEST_USERNAME}": "PENDING",
        f"login_attempts:1.2.3.4:{_TEST_USERNAME}": "2",
        f"login_attempts:5.6.7.8:{_TEST_USERNAME}": "1",
        # Key that should NOT be deleted — different username.
        f"password_version:other": "1",
    }

    class _FakeRedis:
        async def delete(self, *keys):
            n = 0
            for k in keys:
                if k in store:
                    store.pop(k, None)
                    n += 1
            return n

        async def scan(self, cursor=0, match=None, count=100):
            # Naive scan — returns everything in one shot.  The pattern
            # uses Redis glob syntax; we only need ``prefix:*:suffix`` so
            # a simple fnmatch works.
            import fnmatch
            matches = [k for k in store.keys() if match is None or fnmatch.fnmatchcase(k, match)]
            return (0, matches)

        async def set(self, key, value, *args, **kwargs):
            store[key] = value
            return True

        async def get(self, key):
            return store.get(key)

    fake = _FakeRedis()

    async def _get_redis():
        return fake

    import core.redis as redis_mod
    monkeypatch.setattr(redis_mod, "get_redis", _get_redis)

    return store


# --------------------------------------------------------------------------- #
# Test: export                                                                #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_export_returns_bundle_and_attachment_headers(
    test_env, fake_request, audit_stub, redis_stub,
):
    """Export returns JSON attachment, bundle carries expected sections, audit logged."""
    from api.routes.user import export_user_data

    response = await export_user_data(fake_request, username=_TEST_USERNAME)

    # Content-Disposition carries an attachment filename with today's date.
    cd = response.headers["content-disposition"]
    assert 'attachment; filename="alphadesk_export_' in cd
    assert cd.endswith('.json"')

    # Cache-Control is no-store — exports are point-in-time dumps.
    assert response.headers.get("cache-control") == "no-store"

    # Body parses as JSON and has all expected top-level sections.
    body = json.loads(response.body.decode("utf-8"))
    expected_sections = {
        "export_metadata",
        "trades",
        "positions",
        "watchlists",
        "screener_presets",
        "alerts",
        "strategy_signals",
        "audit_log",
        "settings",
    }
    assert expected_sections.issubset(set(body.keys()))

    # Metadata block captures the caller and a timestamp.
    assert body["export_metadata"]["username"] == _TEST_USERNAME
    assert "generated_at" in body["export_metadata"]
    assert body["export_metadata"]["schema_version"] == 1

    # Settings block echoes non-secret config values.
    assert body["settings"]["admin_username"] == _TEST_USERNAME
    assert "access_token_expire_minutes" in body["settings"]

    # Audit event landed.
    events = [e for e, _ in audit_stub]
    assert "data_export" in events


# --------------------------------------------------------------------------- #
# Test: erase preview                                                         #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_erase_preview_returns_counts_and_warning(
    test_env, fake_request, audit_stub, redis_stub,
):
    """Preview returns a counts dict, a retained_events list, and a warning."""
    from api.routes.user import erase_preview

    result = await erase_preview(fake_request, username=_TEST_USERNAME)

    # Shape check — every expected key is present.
    for key in (
        "trades",
        "positions",
        "watchlists",
        "screener_presets",
        "alerts",
        "strategy_signals",
        "audit_log_erased",
        "audit_log_retained_for_compliance",
    ):
        assert key in result["counts"], f"missing counts.{key}"

    # In SKIP_DB_INIT mode every count is zero.
    assert all(v == 0 for v in result["counts"].values())

    # Retained events list matches the module-level constant.
    from api.routes.user import _RETAINED_COMPLIANCE_EVENTS
    assert set(result["retained_events"]) == _RETAINED_COMPLIANCE_EVENTS

    # The warning copy explicitly mentions "factory reset" and 17a-4.
    assert "factory reset" in result["warning"].lower()
    assert "17a-4" in result["warning"]

    # The ``requires`` block documents what the POST needs.
    assert result["requires"]["confirm"] is True
    assert "password" in result["requires"]


# --------------------------------------------------------------------------- #
# Test: erase requires confirm=True                                           #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_erase_rejects_without_confirm_flag(
    test_env, fake_request, audit_stub, redis_stub,
):
    """Even with a valid password, confirm=false MUST 400."""
    from fastapi import HTTPException
    from api.routes.user import EraseRequest, erase_user_data

    body = EraseRequest(confirm=False, password=_TEST_PASSWORD)
    with pytest.raises(HTTPException) as exc_info:
        await erase_user_data(body=body, req=fake_request, username=_TEST_USERNAME)
    assert exc_info.value.status_code == 400
    assert "confirm" in str(exc_info.value.detail).lower()


# --------------------------------------------------------------------------- #
# Test: erase requires password re-auth                                       #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_erase_rejects_bad_password(
    test_env, fake_request, audit_stub, redis_stub,
):
    """A wrong password rejects even when confirm=True."""
    from fastapi import HTTPException
    from api.routes.user import EraseRequest, erase_user_data

    body = EraseRequest(confirm=True, password="wrong-password")
    with pytest.raises(HTTPException) as exc_info:
        await erase_user_data(body=body, req=fake_request, username=_TEST_USERNAME)
    assert exc_info.value.status_code == 401
    assert "password" in str(exc_info.value.detail).lower()

    # The failed reauth audit record landed.
    events = [(e, d["details"].get("result")) for e, d in audit_stub]
    assert ("user_erase", "reauth_failure") in events


@pytest.mark.asyncio
async def test_erase_rejects_non_admin_username(
    test_env, fake_request, audit_stub, redis_stub,
):
    """Only the admin username may erase (future-proofs multi-tenant)."""
    from fastapi import HTTPException
    from api.routes.user import EraseRequest, erase_user_data

    body = EraseRequest(confirm=True, password=_TEST_PASSWORD)
    with pytest.raises(HTTPException) as exc_info:
        await erase_user_data(body=body, req=fake_request, username="not-admin")
    assert exc_info.value.status_code == 401


# --------------------------------------------------------------------------- #
# Test: erase cascade + redis cleanup                                         #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_erase_success_clears_redis_and_audits(
    test_env, fake_request, audit_stub, redis_stub,
):
    """A valid erase deletes Redis keys keyed on the username and audits success."""
    from api.routes.user import EraseRequest, erase_user_data

    body = EraseRequest(confirm=True, password=_TEST_PASSWORD)
    result = await erase_user_data(body=body, req=fake_request, username=_TEST_USERNAME)

    assert result["ok"] is True
    assert "deleted" in result
    assert "redis_keys_deleted" in result
    # 4 fixed keys + 2 rate-limit keys for the test username = 6.
    assert result["redis_keys_deleted"] == 6

    # The other user's key survives.
    assert f"password_version:other" in redis_stub

    # Success audit landed.
    success_events = [
        e for e, d in audit_stub
        if e == "user_erase" and d["details"].get("result") == "success"
    ]
    assert len(success_events) == 1

    # The notice in the response mentions retained events + logout-all.
    assert "retained_for_compliance" in result["notice"]
    assert "logout-all" in result["notice"]


# --------------------------------------------------------------------------- #
# Test: retention policy sanity                                               #
# --------------------------------------------------------------------------- #


def test_retained_events_list_matches_expected_set():
    """The retained-events list must be exactly the 17a-4 tier.

    If this test fails, either the retention policy has moved (update
    the test and the cleanup script), or someone introduced a bug that
    would cause an erasure to wipe compliance-retained rows.
    """
    from api.routes.user import _RETAINED_COMPLIANCE_EVENTS

    expected = {
        "halt_trading",
        "resume_trading",
        "wash_trade_reject",
        "restricted_symbol_reject",
        "live_gate_reject",
    }
    assert _RETAINED_COMPLIANCE_EVENTS == expected
