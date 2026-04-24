"""Route contract tests — these check request → response shape and wiring.
The aggregator is mocked; pure HTTP plumbing is what we're verifying here."""
from datetime import date, datetime, timezone
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
    # NB: the symbol must pass the Path pattern (^[A-Z]{1,6}(\.[A-Z])?$ — B-51)
    # for the ValueError → 404 fallback to fire; otherwise FastAPI 422s.
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


# ───────────────────────── B-41 stub-detail fallback ─────────────────────────


def test_detail_route_returns_stub_for_off_calendar_symbol():
    """A symbol not on the current FMP calendar (e.g. a watchlist
    deep-link to something reporting next quarter) must return 200 with
    a stub body — the old behavior 404'd and broke deep-links.

    We mock the service layer at its _load_earnings_meta + next-date +
    quote seams so the test doesn't hit live FMP/Alpaca."""
    from services import earnings_screener

    future_date = date(2099, 1, 15)

    async def fake_meta(symbol: str):
        return None  # symbol NOT on the current FMP calendar

    async def fake_next(symbol: str):
        return future_date

    async def fake_quote(symbol: str):
        return {"last": 410.5, "change": -1.25, "change_pct": -0.003}

    with patch.object(earnings_screener, "_load_earnings_meta", new=fake_meta), \
         patch.object(earnings_screener, "_fetch_next_earnings_date", new=fake_next), \
         patch.object(earnings_screener, "_load_quote", new=fake_quote):
        r = client.get("/api/v1/earnings/BRK.B/detail")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["symbol"] == "BRK.B"
    assert body["report_date"] == future_date.isoformat()
    # Claude / options fields unpopulated on the stub path
    assert body["claude_structured"] is None
    assert body["claude_full_research"] is None
    assert body["strike_ladder"] is None
    # B-63 removed the `historical_earnings` field from EarningsDetail entirely;
    # it used to hold stub data and was replaced by `metrics.hist_avg_abs_move_pct`.
    assert "historical_earnings" not in body
    assert body["iv_term_structure"] is None
    assert body["skew"] is None
    assert body["news"] == []
    # Quote IS surfaced when the adapter returns one
    assert body["quote"] is not None
    assert body["quote"]["last"] == 410.5


def test_detail_route_stub_tolerates_missing_fmp_next_date():
    """If FMP has no forward earnings record either, the stub still
    returns 200 — just with report_date null."""
    from services import earnings_screener

    async def fake_meta(symbol: str):
        return None

    async def fake_next(symbol: str):
        return None  # FMP also doesn't know

    async def fake_quote(symbol: str):
        return None  # and the quote adapter is also down

    with patch.object(earnings_screener, "_load_earnings_meta", new=fake_meta), \
         patch.object(earnings_screener, "_fetch_next_earnings_date", new=fake_next), \
         patch.object(earnings_screener, "_load_quote", new=fake_quote):
        r = client.get("/api/v1/earnings/OBSCUR/detail")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["symbol"] == "OBSCUR"
    assert body["report_date"] is None
    assert body["quote"] is None
