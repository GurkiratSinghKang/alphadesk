"""Unit tests for ``services.users.user_to_dict`` — iter 19.

Audit Batch E P0-05 added a "Connect your broker" CTA to the dashboard
Action stack. The frontend was using ``username === "admin"`` as a
stop-gap proxy for "is this a demo-seed account" — that proxy was
inverted (it fired only for the literal admin username, the operator who
is least likely to be on demo seed data).

This module pins the derived ``is_demo_seed`` invariants so a future
refactor can't accidentally regress the CTA visibility for new
self-serve operators:

1. ``role != "admin"`` AND zero ``broker_connections`` rows → True
2. ``role == "admin"`` regardless of broker count → False
3. ``role != "admin"`` BUT >=1 ``broker_connections`` row → False

The tests run against the in-process SQLAlchemy stack with
``SKIP_DB_INIT=true`` (set in the root ``conftest.py``); they patch the
broker-count helper directly so they don't depend on a live Postgres
fixture. The cache is cleared between cases so each one starts from a
known state.
"""
from __future__ import annotations

import pytest

from services import users as users_service


class _FakeUserRow:
    """Minimal duck-typed stand-in for a ``data.storage.models.User`` row.

    ``user_to_dict`` only reads attributes; we don't need the live ORM
    class here. Mirrors the columns the helper touches plus enough
    ``isoformat()``-able timestamps to satisfy the dict shape.
    """

    def __init__(self, *, username: str, role: str | None) -> None:
        self.id = 1
        self.username = username
        self.email = f"{username}@example.com"
        self.role = role
        self.status = "active"
        self.display_name = None
        self.profile = {}
        self.created_at = None
        self.updated_at = None
        self.last_login_at = None


@pytest.fixture(autouse=True)
def _reset_broker_cache() -> None:
    """Clear the in-process broker-count cache between tests.

    ``user_to_dict`` caches the broker count per-username for 60s; the
    cache lives at module scope so a previous test's count would bleed
    into the next case if we didn't reset it here.
    """
    users_service._clear_broker_count_cache()
    yield
    users_service._clear_broker_count_cache()


@pytest.fixture
def patch_broker_count(monkeypatch: pytest.MonkeyPatch):
    """Stub ``_broker_count_for`` so tests can pretend the DB has N rows.

    Returns a setter that the test calls with the desired count. The
    setter installs a fresh coroutine each time so the captured
    ``broker_count`` closes over the most-recently-set value.
    """

    def _set(count: int) -> None:
        async def _fake(_username: str) -> int:
            return count

        monkeypatch.setattr(users_service, "_broker_count_for", _fake)

    return _set


# ---------------------------------------------------------------------------
# Derivation cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_user_to_dict_is_demo_seed_true_for_non_admin_with_no_broker(
    patch_broker_count,
) -> None:
    """A self-serve operator with no broker wired = on demo seed.

    This is the case the dashboard CTA is built for: the user signed up,
    landed on the desk, sees the demo book, and needs the Connect-broker
    nudge. ``is_demo_seed`` MUST be True so the frontend hoists the CTA.
    """
    patch_broker_count(0)
    row = _FakeUserRow(username="alice", role="user")

    out = await users_service.user_to_dict(row)

    assert out["is_demo_seed"] is True
    assert out["username"] == "alice"
    assert out["role"] == "user"


@pytest.mark.asyncio
async def test_user_to_dict_is_demo_seed_false_for_admin_regardless_of_broker(
    patch_broker_count,
) -> None:
    """Admins are operators of the desk, not demo users.

    Even if an admin has zero broker_connections rows (e.g. they wire
    creds via the env-configured Alpaca URL instead of the per-user
    connection table), the CTA must NOT fire for them — the audit copy
    ("Your desk is showing demo data") would be misleading for an
    operator who picked the env-credential path on purpose.
    """
    patch_broker_count(0)
    row = _FakeUserRow(username="admin", role="admin")

    out = await users_service.user_to_dict(row)

    assert out["is_demo_seed"] is False


@pytest.mark.asyncio
async def test_user_to_dict_is_demo_seed_false_when_broker_connected(
    patch_broker_count,
) -> None:
    """A non-admin who has wired up at least one broker is no longer demo.

    The CTA is one-shot: once the user has connected ANY broker (paper
    or live), the desk is no longer "showing demo data" and the prompt
    has served its purpose. ``is_demo_seed`` flips to False so the
    Action stack hides the card.
    """
    patch_broker_count(1)
    row = _FakeUserRow(username="bob", role="user")

    out = await users_service.user_to_dict(row)

    assert out["is_demo_seed"] is False


@pytest.mark.asyncio
async def test_user_to_dict_is_demo_seed_role_case_insensitive(
    patch_broker_count,
) -> None:
    """``role`` comparison must be case-insensitive.

    The seed-data scripts and the ``ensure_user_record`` helper both
    write ``role="admin"`` (lowercase) but the column is a free-form
    String(64). A mixed-case "Admin" row should still suppress the
    flag — we don't want a one-character DB drift to misfire the CTA
    on a real operator.
    """
    patch_broker_count(0)
    row = _FakeUserRow(username="admin", role="Admin")

    out = await users_service.user_to_dict(row)

    assert out["is_demo_seed"] is False


@pytest.mark.asyncio
async def test_user_to_dict_preserves_existing_keys(patch_broker_count) -> None:
    """The new flag MUST be additive — existing wire shape stays stable.

    Frontend mapper code reads ``id``, ``username``, ``email``, ``role``,
    ``status``, ``display_name``, ``profile``, ``created_at``,
    ``updated_at``, ``last_login_at``. Pin them so a future refactor
    that drops a key surfaces here as a test failure rather than a
    silent UI regression.
    """
    patch_broker_count(0)
    row = _FakeUserRow(username="alice", role="user")

    out = await users_service.user_to_dict(row)

    expected_keys = {
        "id",
        "username",
        "email",
        "role",
        "status",
        "display_name",
        "profile",
        "created_at",
        "updated_at",
        "last_login_at",
        "is_demo_seed",
    }
    assert set(out.keys()) == expected_keys


@pytest.mark.asyncio
async def test_user_to_dict_include_email_false_strips_address(
    patch_broker_count,
) -> None:
    """``include_email=False`` keeps the key but blanks the value.

    Existing semantics — the helper preserves the key so downstream
    consumers don't get a KeyError; the value is None when the caller
    wants to keep the address out of a serialised payload.
    """
    patch_broker_count(0)
    row = _FakeUserRow(username="alice", role="user")

    out = await users_service.user_to_dict(row, include_email=False)

    assert "email" in out
    assert out["email"] is None
