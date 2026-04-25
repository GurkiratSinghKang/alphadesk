"""Route contract tests — these check request → response shape and wiring.
The aggregator is mocked; pure HTTP plumbing is what we're verifying here.

Auth override + TestClient are provided by conftest.py (see simplify review —
three files used to duplicate this harness)."""
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app  # FastAPI app instance lives in backend/main.py


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


# ───────────────────────── Round-4 regression tests ─────────────────────────


def test_detail_route_404s_for_non_curated_symbol():
    """Round-4 CLUSTER 2 #6: the /detail endpoint must reject requests
    for symbols outside the curated universe BEFORE touching any
    upstream provider — otherwise we'd burn FMP/Alpaca/Claude budget on
    symbols we'll never trade. ZZZZZ is well-formed (passes the path
    pattern) but isn't curated."""
    r = client.get("/api/v1/earnings/ZZZZZ/detail")
    assert r.status_code == 404
    assert "curated" in r.json()["detail"].lower()


def test_full_research_route_404s_for_non_curated_symbol():
    """Round-4 CLUSTER 2 #6: same gate on /full-research — Opus is even
    more expensive, so this is the higher-stakes version of the test."""
    from api.routes import _rate_limit as rl
    rl._reset_for_tests()
    r = client.post("/api/v1/earnings/ZZZZZ/full-research")
    assert r.status_code == 404
    assert "curated" in r.json()["detail"].lower()


def test_detail_route_curated_gate_runs_before_service():
    """Round-4 CLUSTER 2 #6: even when the service layer is mocked to
    return a successful response, the curated gate at the route must
    block non-curated symbols. Verifies the check order."""
    from api.schemas.earnings import EarningsDetail
    from datetime import datetime, timezone

    fake_detail = EarningsDetail(
        symbol="X", company="X", sector="", report_date=None,
        report_time="DMT", quote=None, metrics=None, strike_ladder=None,
        claude_structured=None, claude_full_research=None,
        iv_term_structure=None, skew=None, news=[],
        partial=False, generated_at=datetime.now(timezone.utc),
    )
    with patch("services.earnings_screener.get_detail",
               AsyncMock(return_value=fake_detail)) as svc_mock:
        r = client.get("/api/v1/earnings/ZZZZZ/detail")
    assert r.status_code == 404
    # Service must NOT have been called — the gate ran first.
    svc_mock.assert_not_called()


def test_calendar_response_carries_window_label():
    """Round-4 CLUSTER 1 #3: the calendar response now exposes
    window_start / window_end / window_label so the frontend can render
    a "Apr 27 - May 1, 2026" header. Verify the wire format."""
    from api.schemas.earnings import CalendarResponse
    from datetime import date, datetime, timezone

    resp = CalendarResponse(
        earnings=[],
        generated_at=datetime.now(timezone.utc),
        partial=False,
        window_start=date(2026, 4, 27),
        window_end=date(2026, 5, 1),
        window_label="Apr 27 - May 1, 2026",
        meta={"reason": "ok", "before_curated": 0},
    )
    with patch("services.earnings_screener.list_upcoming", AsyncMock(return_value=resp)):
        r = client.get("/api/v1/earnings/calendar?window=current")
    assert r.status_code == 200
    body = r.json()
    assert body["window_start"] == "2026-04-27"
    assert body["window_end"] == "2026-05-01"
    assert body["window_label"] == "Apr 27 - May 1, 2026"
    assert body["meta"]["reason"] == "ok"


def test_detail_route_stub_tolerates_missing_fmp_next_date():
    """If FMP has no forward earnings record either, the stub still
    returns 200 — just with report_date null.

    Round-4 CLUSTER 2 #6: the symbol must be in the curated universe to
    get past the route's curated-gate check. Use BRK.B (curated) and
    mock the per-symbol FMP lookups to return None — that exercises the
    stub-tolerates-missing-record path without falling foul of the
    cost-burning gate."""
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
        r = client.get("/api/v1/earnings/BRK.B/detail")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["symbol"] == "BRK.B"
    assert body["report_date"] is None
    assert body["quote"] is None
