from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.routes import v2_user_settings
from api.routes.auth import require_auth
from core.database import get_db
from main import app


class _Result:
    def __init__(self, row: Any | None) -> None:
        self.row = row

    def scalars(self) -> "_Result":
        return self

    def first(self) -> Any | None:
        return self.row


class _FakeDb:
    def __init__(self, row: Any | None = None) -> None:
        self.row = row
        self.commits = 0
        self.refreshed: list[Any] = []

    async def execute(self, *args: Any, **kwargs: Any) -> _Result:
        return _Result(self.row)

    def add(self, row: Any) -> None:
        self.row = row

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, row: Any) -> None:
        self.refreshed.append(row)


async def _fake_user() -> str:
    return "mode-user"


def _install_db(fake_db: _FakeDb) -> None:
    async def fake_get_db():
        yield fake_db

    app.dependency_overrides[get_db] = fake_get_db
    app.dependency_overrides[require_auth] = _fake_user


def _clear_overrides() -> None:
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(require_auth, None)


def test_trading_mode_defaults_to_paper_and_persists_row(monkeypatch) -> None:
    events: list[dict[str, Any]] = []
    fake_db = _FakeDb()

    async def audit(**kwargs: Any) -> None:
        events.append(kwargs)

    monkeypatch.setattr(v2_user_settings, "write_audit", audit)
    _install_db(fake_db)
    try:
        resp = TestClient(app).get("/api/v1/user/trading-mode")
    finally:
        _clear_overrides()

    assert resp.status_code == 200
    assert resp.json()["mode"] == "paper"
    assert fake_db.row.username == "mode-user"
    assert fake_db.row.trading_mode == "paper"
    assert fake_db.commits == 1
    assert events == []


def test_trading_mode_live_requires_step_up_and_audits_denial(monkeypatch) -> None:
    events: list[dict[str, Any]] = []
    fake_db = _FakeDb()

    async def audit(**kwargs: Any) -> None:
        events.append(kwargs)

    async def deny_step_up(username: str, totp_code: str | None) -> None:
        raise HTTPException(status_code=403, detail="TOTP code required")

    monkeypatch.setattr(v2_user_settings, "write_audit", audit)
    monkeypatch.setattr(v2_user_settings, "_validate_live_step_up", deny_step_up)
    _install_db(fake_db)
    try:
        resp = TestClient(app).post("/api/v1/user/trading-mode", json={"mode": "live"})
    finally:
        _clear_overrides()

    assert resp.status_code == 403
    assert fake_db.row.trading_mode == "paper"
    assert len(events) == 1
    assert events[0]["event"] == "mode_change_denied"
    assert events[0]["details"]["from"] == "paper"
    assert events[0]["details"]["to"] == "live"


def test_trading_mode_live_commit_records_step_up_and_audit(monkeypatch) -> None:
    events: list[dict[str, Any]] = []
    fake_db = _FakeDb()

    async def audit(**kwargs: Any) -> None:
        events.append(kwargs)

    async def allow_step_up(username: str, totp_code: str | None) -> None:
        assert username == "mode-user"
        assert totp_code == "123456"

    monkeypatch.setattr(v2_user_settings, "write_audit", audit)
    monkeypatch.setattr(v2_user_settings, "_validate_live_step_up", allow_step_up)
    _install_db(fake_db)
    try:
        resp = TestClient(app).post(
            "/api/v1/user/trading-mode",
            json={"mode": "live", "totp_code": "123456"},
        )
    finally:
        _clear_overrides()

    assert resp.status_code == 200
    assert resp.json()["mode"] == "live"
    assert fake_db.row.trading_mode == "live"
    assert fake_db.row.live_step_up_at is not None
    assert len(events) == 1
    assert events[0]["event"] == "mode_change"
    assert events[0]["details"] == {"from": "paper", "to": "live"}


def test_trading_mode_paper_clears_live_step_up(monkeypatch) -> None:
    from data.storage.models import UserSettings

    events: list[dict[str, Any]] = []
    row = UserSettings(username="mode-user")
    row.trading_mode = "live"
    row.live_step_up_at = "existing"
    fake_db = _FakeDb(row=row)

    async def audit(**kwargs: Any) -> None:
        events.append(kwargs)

    monkeypatch.setattr(v2_user_settings, "write_audit", audit)
    _install_db(fake_db)
    try:
        resp = TestClient(app).post("/api/v1/user/trading-mode", json={"mode": "paper"})
    finally:
        _clear_overrides()

    assert resp.status_code == 200
    assert resp.json()["mode"] == "paper"
    assert row.trading_mode == "paper"
    assert row.live_step_up_at is None
    assert events[0]["details"] == {"from": "live", "to": "paper"}
