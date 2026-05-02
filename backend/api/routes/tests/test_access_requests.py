from __future__ import annotations

from fastapi.testclient import TestClient

from core.database import get_db
from main import app


class _FakeDb:
    def __init__(self) -> None:
        self.added: list[object] = []

    def add(self, row: object) -> None:
        self.added.append(row)

    async def flush(self) -> None:
        return None


def _payload() -> dict[str, object]:
    return {
        "name": "Mira Patel",
        "email": "MIRA@FUND.EXAMPLE",
        "firm": "Independent PM",
        "role": "Portfolio manager",
        "jurisdiction": "United States",
        "capital_band": "250k_1m",
        "trading_mode": "paper_to_live",
        "instruments": ["us_equities", "listed_options", "us_equities"],
        "note": "I run a systematic equities and options workflow and need paper-first onboarding.",
        "referral": "Operator referral",
    }


async def _noop_audit(*args, **kwargs) -> None:
    return None


def test_access_request_persists_public_intake(monkeypatch) -> None:
    from api.routes import access_requests
    import core.audit as audit_mod

    access_requests._RATE_HITS.clear()
    fake_db = _FakeDb()

    async def fake_get_db():
        yield fake_db

    monkeypatch.setattr(audit_mod, "write_audit", _noop_audit)
    app.dependency_overrides[get_db] = fake_get_db
    try:
        resp = TestClient(app).post("/api/v1/access-requests", json=_payload())
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert resp.status_code == 202
    body = resp.json()
    assert body["ok"] is True
    assert body["request_id"].startswith("AR-")
    assert body["status"] == "received"
    assert len(fake_db.added) == 1

    row = fake_db.added[0]
    assert row.email == "mira@fund.example"
    assert row.instruments == ["us_equities", "listed_options"]
    assert row.status == "received"


def test_access_request_honeypot_is_accepted_without_persisting(monkeypatch) -> None:
    fake_db = _FakeDb()

    async def fake_get_db():
        yield fake_db

    app.dependency_overrides[get_db] = fake_get_db
    try:
        payload = {**_payload(), "website": "https://spam.example"}
        resp = TestClient(app).post("/api/v1/access-requests", json=payload)
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert resp.status_code == 202
    assert resp.json()["ok"] is True
    assert fake_db.added == []


def test_access_request_rejects_bad_email() -> None:
    async def fake_get_db():
        yield _FakeDb()

    app.dependency_overrides[get_db] = fake_get_db
    payload = {**_payload(), "email": "not-an-email"}
    try:
        resp = TestClient(app).post("/api/v1/access-requests", json=payload)
        assert resp.status_code == 422
    finally:
        app.dependency_overrides.pop(get_db, None)
