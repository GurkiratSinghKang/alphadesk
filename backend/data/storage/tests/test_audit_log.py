"""Tests for the durable audit-log helper (Wave 3K / persona-87 P1 #1).

Exercises ``core.audit.write_audit`` end-to-end:

* Happy path — an audit event is persisted via the injected session
  factory AND emitted to the ``alphadesk.audit`` logger with the right
  structured fields.
* Failure path — when the DB session raises, the call does NOT propagate
  the exception (audit persistence must never break the calling request
  path). The log emission still fires so the aggregator captures the
  event even when the durable store is degraded.

We intentionally do NOT spin up a real DB engine here — the ``aiosqlite``
driver isn't in the minimum test dependency set, and the contract under
test is purely "does ``write_audit`` call ``session.add`` + ``session.commit``
with the right ``AuditLog`` instance". A tiny ``_FakeSessionFactory`` that
captures the inserted row is sufficient. End-to-end DB round-tripping is
covered by the real-Postgres integration suite.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

import pytest

# Make ``backend/`` importable — mirrors the other test modules in this
# directory.
BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


# ---------------------------------------------------------------------------
# Fake async session factory — capture ``session.add(AuditLog(...))``.
# ---------------------------------------------------------------------------


class _FakeSession:
    """Minimal async context-manager that records ``.add`` / ``.commit``."""

    def __init__(self, added: list[Any]) -> None:
        self._added = added
        self.commit_count = 0

    async def __aenter__(self) -> "_FakeSession":
        return self

    async def __aexit__(self, *args: Any, **kwargs: Any) -> None:
        return None

    def add(self, row: Any) -> None:
        self._added.append(row)

    async def commit(self) -> None:
        self.commit_count += 1


class _FakeSessionFactory:
    """Callable that returns a fresh ``_FakeSession`` on each invocation."""

    def __init__(self) -> None:
        self.added: list[Any] = []
        self.sessions: list[_FakeSession] = []

    def __call__(self) -> _FakeSession:
        s = _FakeSession(self.added)
        self.sessions.append(s)
        return s


# ---------------------------------------------------------------------------
# Log-record capture — confirm the structured log line fires.
# ---------------------------------------------------------------------------


class _ListHandler(logging.Handler):
    """Capture log records emitted by ``alphadesk.audit`` during the test."""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:  # pragma: no cover — trivial
        self.records.append(record)


@pytest.fixture
def audit_log_capture() -> _ListHandler:
    """Attach a capture handler to the ``alphadesk.audit`` logger."""
    logger = logging.getLogger("alphadesk.audit")
    handler = _ListHandler()
    handler.setLevel(logging.DEBUG)
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    try:
        yield handler
    finally:
        logger.removeHandler(handler)


# ---------------------------------------------------------------------------
# Happy-path test
# ---------------------------------------------------------------------------


def _resolve_audit_log_model() -> Any:
    """Return the real mapped ``AuditLog`` class, bypassing cache poisoning.

    The fill_reconciler test fixture stubs ``_models_cache["Trade"]`` with
    a namespace and does so BEFORE ``_define_models`` populates the real
    ORM classes.  Because ``_define_models`` short-circuits on a non-empty
    cache, subsequent tests that need ``AuditLog`` (added in Wave 3K) see
    a KeyError — the cache has Trade-only and never gains the new class.

    Recovery mirrors ``test_optimistic_locking.py``: wipe the cache and
    force a fresh ``_define_models`` pass.  If pytest has already run the
    reconciler-stub path, clearing the cache + re-invoking is safe because
    the stub only poisoned an entry we do not care about in this test.
    """
    import data.storage.models as _models_mod

    cached = _models_mod._models_cache.get("AuditLog")
    if cached is not None and hasattr(cached, "__table__"):
        return cached

    # Walk the mapper registry first — survives any cache poisoning.
    from core.database import get_base
    base = get_base()
    for mapper in base.registry.mappers:
        cls = mapper.class_
        if getattr(cls, "__name__", "") == "AuditLog":
            _models_mod._models_cache["AuditLog"] = cls
            return cls

    # First-time setup: cache is poisoned but no real mapping exists yet.
    # Wipe the cache and force a fresh _define_models pass.
    _models_mod._models_cache.clear()
    from data.storage.models import _define_models

    _define_models()
    return _models_mod._models_cache["AuditLog"]


@pytest.mark.asyncio
async def test_write_audit_persists_to_db_and_emits_log(
    monkeypatch: pytest.MonkeyPatch,
    audit_log_capture: _ListHandler,
) -> None:
    """One write_audit call → one AuditLog instance added + committed AND one log record."""
    # Pull the real ORM class.  ``_resolve_audit_log_model`` survives the
    # cache-poisoning that the fill_reconciler test's Trade stub causes
    # when both suites run in the same pytest session.
    AuditLog = _resolve_audit_log_model()

    factory = _FakeSessionFactory()

    # Redirect write_audit's session factory to the fake.
    from core import database as core_db
    monkeypatch.setattr(core_db, "_get_session_factory", lambda: factory)

    # Make sure SKIP_DB_INIT is not True — otherwise the helper would
    # short-circuit before touching the DB. conftest.py defaults
    # SKIP_DB_INIT=true so we override here for this test only.
    from core.config import settings
    monkeypatch.setattr(settings, "SKIP_DB_INIT", False, raising=False)

    from core.audit import write_audit

    await write_audit(
        "halt_trading",
        username="admin",
        ip="127.0.0.1",
        request_id="req-abc-123",
        details={"result": "success", "cancel_open_orders_ok": True},
    )

    # --- DB row check ---
    assert len(factory.added) == 1, "write_audit must add exactly one row"
    row = factory.added[0]
    assert isinstance(row, AuditLog)
    assert row.event == "halt_trading"
    assert row.username == "admin"
    assert row.ip == "127.0.0.1"
    assert row.request_id == "req-abc-123"
    assert row.details == {"result": "success", "cancel_open_orders_ok": True}

    # The session must have committed exactly once so the row survives
    # a ``write_audit`` race with the following request in the worker.
    assert len(factory.sessions) == 1
    assert factory.sessions[0].commit_count == 1

    # --- Log record check ---
    events = [
        r for r in audit_log_capture.records
        if getattr(r, "event", None) == "halt_trading"
    ]
    assert len(events) == 1, "structured log record must fire exactly once"
    rec = events[0]
    assert getattr(rec, "username", None) == "admin"
    assert getattr(rec, "ip", None) == "127.0.0.1"
    assert getattr(rec, "audit_request_id", None) == "req-abc-123"
    # Extras from ``details`` are merged into the log record.
    assert getattr(rec, "result", None) == "success"


@pytest.mark.asyncio
async def test_write_audit_skips_db_when_skip_db_init(
    monkeypatch: pytest.MonkeyPatch,
    audit_log_capture: _ListHandler,
) -> None:
    """SKIP_DB_INIT=True → log emits but the session factory is never called."""
    factory = _FakeSessionFactory()

    from core import database as core_db
    monkeypatch.setattr(core_db, "_get_session_factory", lambda: factory)

    from core.config import settings
    monkeypatch.setattr(settings, "SKIP_DB_INIT", True, raising=False)

    from core.audit import write_audit

    await write_audit(
        "login",
        username="admin",
        ip="127.0.0.1",
        request_id="req-skip",
        details={"result": "success"},
    )

    # Factory never invoked — no session opened, no add, no commit.
    assert factory.added == []
    assert factory.sessions == []

    # Log line still fires.
    events = [
        r for r in audit_log_capture.records
        if r.levelno == logging.INFO and getattr(r, "event", None) == "login"
    ]
    assert len(events) == 1


# ---------------------------------------------------------------------------
# Degraded-DB fallback test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_write_audit_falls_back_to_log_only_on_db_error(
    monkeypatch: pytest.MonkeyPatch,
    audit_log_capture: _ListHandler,
) -> None:
    """DB outage must NOT propagate — log line still fires, call returns None."""

    class _BoomSession:
        """Async context-manager that raises on entry to simulate a DB outage."""

        async def __aenter__(self) -> Any:
            raise RuntimeError("pool exhausted")

        async def __aexit__(self, *a: Any, **kw: Any) -> None:
            return None

    def _boom_factory() -> Any:
        class _Factory:
            def __call__(self) -> Any:
                return _BoomSession()

        return _Factory()

    from core import database as core_db
    monkeypatch.setattr(core_db, "_get_session_factory", _boom_factory)

    from core.config import settings
    monkeypatch.setattr(settings, "SKIP_DB_INIT", False, raising=False)

    from core.audit import write_audit

    # Must not raise — audit path is firewalled from the caller.
    result = await write_audit(
        "login",
        username="admin",
        ip="127.0.0.1",
        request_id="req-xyz",
        details={"result": "success"},
    )
    assert result is None

    # The primary structured record still fires (event=login) — this is
    # the whole point of the "log-first" ordering in write_audit.
    # Filter on level=INFO to separate the primary record from the
    # degraded-mode WARNING that fires below; both carry event=login
    # because the warning re-stamps the original event for correlation.
    login_infos = [
        r for r in audit_log_capture.records
        if r.levelno == logging.INFO and getattr(r, "event", None) == "login"
    ]
    assert len(login_infos) == 1

    # The degraded-mode warning also fires so the oncall can see the
    # audit DB is unhealthy. It carries the same username/ip so the
    # record is correlatable with the event it failed to persist.
    warnings = [
        r for r in audit_log_capture.records
        if r.levelno == logging.WARNING and r.getMessage() == "audit_db_write_failed"
    ]
    assert len(warnings) == 1
    warn = warnings[0]
    assert getattr(warn, "event", None) == "login"
    assert getattr(warn, "username", None) == "admin"
