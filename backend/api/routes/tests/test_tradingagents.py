from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from api.routes import tradingagents as route


@pytest.fixture
def authed_client():
    from core.auth import require_auth
    from main import app

    async def fake_user() -> str:
        return "test_user"

    app.dependency_overrides[require_auth] = fake_user
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(require_auth, None)


def _run_payload(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "run_id": "abc123abc123abc123abc123",
        "symbol": "AAPL",
        "trade_date": "2026-05-01",
        "status": "queued",
        "provider": "openai",
        "deep_model": "gpt-5.4",
        "quick_model": "gpt-5.4-mini",
        "research_depth": 1,
        "summary_lines": [],
        "decision_text": None,
        "artifact_files": [],
        "error": None,
        "created_at": "2026-05-01T12:00:00+00:00",
        "updated_at": "2026-05-01T12:00:00+00:00",
        "started_at": None,
        "completed_at": None,
        "advisory_disclaimer": route.ADVISORY_DISCLAIMER,
    }
    base.update(overrides)
    return base


def test_create_run_validates_and_starts(monkeypatch: pytest.MonkeyPatch, authed_client) -> None:
    async def no_rate_limit(username: str) -> None:
        return None

    async def fake_start(username: str, request: dict[str, Any]) -> dict[str, Any]:
        assert username == "test_user"
        assert request["symbol"] == "AAPL"
        return _run_payload(symbol=request["symbol"])

    monkeypatch.setattr(route, "_enforce_run_rate_limit", no_rate_limit)
    monkeypatch.setattr(route, "start_tradingagents_run", fake_start)

    resp = authed_client.post(
        "/api/v1/tradingagents/runs",
        json={"symbol": "aapl", "trade_date": "2026-05-01"},
    )

    assert resp.status_code == 202
    assert resp.json()["symbol"] == "AAPL"
    assert resp.json()["status"] == "queued"


def test_create_run_rejects_bad_symbol(monkeypatch: pytest.MonkeyPatch, authed_client) -> None:
    async def no_rate_limit(username: str) -> None:
        return None

    monkeypatch.setattr(route, "_enforce_run_rate_limit", no_rate_limit)

    resp = authed_client.post(
        "/api/v1/tradingagents/runs",
        json={"symbol": "AAPL;DROP", "trade_date": "2026-05-01"},
    )

    assert resp.status_code == 422


def test_get_run_404(monkeypatch: pytest.MonkeyPatch, authed_client) -> None:
    async def fake_get(username: str, run_id: str) -> None:
        return None

    monkeypatch.setattr(route, "get_tradingagents_run", fake_get)
    resp = authed_client.get("/api/v1/tradingagents/runs/abc123abc123abc123abc123")
    assert resp.status_code == 404
