"""Route contract tests — these check request → response shape and wiring.
The aggregator is mocked; pure HTTP plumbing is what we're verifying here."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app  # FastAPI app instance lives in backend/main.py
from core.auth import require_auth


async def _fake_user() -> str:
    return "test_user"


# Override auth for the whole test module — no JWT machinery needed here.
app.dependency_overrides[require_auth] = _fake_user

client = TestClient(app)


def test_calendar_route_returns_empty_list_gracefully():
    from api.schemas.earnings import CalendarResponse
    empty = CalendarResponse(earnings=[], generated_at=datetime.now(timezone.utc), partial=False)
    with patch("services.earnings_screener.list_upcoming", AsyncMock(return_value=empty)):
        r = client.get("/api/v1/earnings/calendar?window=both&min_iv_rank=50")
    assert r.status_code == 200
    assert r.json()["earnings"] == []


def test_detail_route_404s_on_unknown_symbol():
    with patch("services.earnings_screener.get_detail", AsyncMock(side_effect=ValueError("unknown"))):
        r = client.get("/api/v1/earnings/XYZZY/detail")
    assert r.status_code == 404


def test_full_research_route_requires_valid_symbol():
    with patch("services.earnings_screener.run_full_research", AsyncMock(side_effect=ValueError("unknown"))):
        r = client.post("/api/v1/earnings/XYZZY/full-research")
    assert r.status_code == 404


def test_calendar_route_passes_filters_through():
    from api.schemas.earnings import CalendarResponse
    called = {}

    async def fake_list(**kwargs):
        called.update(kwargs)
        return CalendarResponse(earnings=[], generated_at=datetime.now(timezone.utc), partial=False)

    with patch("services.earnings_screener.list_upcoming", fake_list):
        r = client.get("/api/v1/earnings/calendar?window=current&min_iv_rank=70&sort=iv_rank")
    assert r.status_code == 200
    assert called["window"] == "current"
    assert called["min_iv_rank"] == 70.0
    assert called["sort"] == "iv_rank"
