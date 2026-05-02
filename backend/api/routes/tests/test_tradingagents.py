from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

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
        "analysts": ["market", "news"],
        "research_depth": 1,
        "progress_message": "Queued for TradingAgents research.",
        "timeout_s": 600,
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

    monkeypatch.setattr(route, "get_tradingagents_runtime_status", lambda _provider=None: {"ready": True})
    monkeypatch.setattr(route, "get_active_tradingagents_run_for_request", AsyncMock(return_value=None))
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


def test_runtime_status_does_not_expose_secret(monkeypatch: pytest.MonkeyPatch, authed_client) -> None:
    monkeypatch.setattr(
        route,
        "get_tradingagents_runtime_status",
        lambda: {
            "enabled": True,
            "ready": True,
            "script_path": "/app/tools/tradingagents/scripts/run_tradingagents.sh",
            "script_exists": True,
            "script_runnable": True,
            "skill_home": "/app/data/tradingagents-skill",
            "runtime_python_exists": True,
            "upstream_checkout_exists": True,
            "installed_ref": "v0.2.3",
            "bootstrap_required": False,
            "provider": "anthropic",
            "provider_env": "ANTHROPIC_API_KEY",
            "provider_key_configured": True,
            "deep_model": "claude-sonnet-4-6",
            "quick_model": "claude-haiku-4-5",
            "supported_analysts": ["market", "social", "news", "fundamentals"],
            "output_language": "English",
            "timeout_s": 600,
            "runs_per_hour": 12,
            "history_limit": 20,
            "warnings": [],
        },
    )

    resp = authed_client.get("/api/v1/tradingagents/runtime")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["ready"] is True
    assert payload["provider_env"] == "ANTHROPIC_API_KEY"
    assert "api_key" not in payload
