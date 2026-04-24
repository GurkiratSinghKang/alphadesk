"""Tests for B-50 — per-IP in-process rate limit on /full-research.

The endpoint fires an Opus call that costs $0.05–$0.30 each — without a
cap, a hot-looping client could burn $100 in a minute. The limiter is
deliberately simple (in-process deque; no Redis) because we ship as a
single worker. These tests pin the contract:

  * up to ``_BUCKET_MAX`` calls from one IP succeed
  * the next call raises HTTPException(429) with a Retry-After header
  * different IPs get independent buckets
  * the wiring in post_full_research is live (not just the helper)
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from main import app  # FastAPI app instance lives in backend/main.py
from core.auth import require_auth


async def _fake_user() -> str:
    return "test_user"


app.dependency_overrides[require_auth] = _fake_user
client = TestClient(app)


# ───────────────────────── helper-level tests ─────────────────────────


@pytest.fixture(autouse=True)
def _reset_rate_limit_state():
    """Every test starts with an empty per-IP history so runs don't
    leak state across each other."""
    from api.routes import _rate_limit as rl
    rl._reset_for_tests()
    yield
    rl._reset_for_tests()


@pytest.mark.asyncio
async def test_helper_allows_up_to_bucket_max_calls():
    from api.routes._rate_limit import _BUCKET_MAX, check_full_research_rate
    for _ in range(_BUCKET_MAX):
        await check_full_research_rate("10.0.0.1")  # should NOT raise


@pytest.mark.asyncio
async def test_helper_raises_429_on_bucket_overflow():
    from api.routes._rate_limit import _BUCKET_MAX, check_full_research_rate
    for _ in range(_BUCKET_MAX):
        await check_full_research_rate("10.0.0.2")
    with pytest.raises(HTTPException) as exc:
        await check_full_research_rate("10.0.0.2")
    assert exc.value.status_code == 429
    # Retry-After header set in whole seconds ≥ 1
    assert "Retry-After" in exc.value.headers
    assert int(exc.value.headers["Retry-After"]) >= 1


@pytest.mark.asyncio
async def test_helper_isolates_buckets_per_ip():
    from api.routes._rate_limit import _BUCKET_MAX, check_full_research_rate
    # Fill IP A to the brim
    for _ in range(_BUCKET_MAX):
        await check_full_research_rate("10.0.0.3")
    # IP B has an independent bucket and should sail through
    await check_full_research_rate("10.0.0.4")


@pytest.mark.asyncio
async def test_helper_evicts_old_entries():
    """Entries older than _BUCKET_WINDOW_S should roll off the edge."""
    from api.routes import _rate_limit as rl

    # Prefill the deque with timestamps from way in the past.
    stale_time = time.monotonic() - rl._BUCKET_WINDOW_S - 1
    for _ in range(rl._BUCKET_MAX):
        rl._history["10.0.0.5"].append(stale_time)
    # Next call should succeed because the window sweep evicts them.
    await rl.check_full_research_rate("10.0.0.5")


# ───────────────────────── route-level wiring ─────────────────────────


def test_route_allows_up_to_bucket_max_then_429s():
    """Hit the endpoint 5× successfully, then the 6th returns 429."""
    from api.schemas.earnings import ClaudeFullResearch
    from api.routes._rate_limit import _BUCKET_MAX

    fake_payload = ClaudeFullResearch(
        thesis_paragraph="stub",
        comparable_setups=[],
        post_earnings_drift_playbook="stub",
        sector_backdrop="stub",
        analyst_consensus_delta="stub",
        what_would_change_my_mind="stub",
        confidence=0.5,
        model="claude-stub",
        generated_at=datetime.now(timezone.utc),
    )

    with patch(
        "services.earnings_screener.run_full_research",
        AsyncMock(return_value=fake_payload),
    ):
        # First _BUCKET_MAX calls succeed
        for i in range(_BUCKET_MAX):
            r = client.post("/api/v1/earnings/AAPL/full-research")
            assert r.status_code == 200, f"call {i} should succeed, got {r.status_code}: {r.text}"
        # Next call is blocked
        r = client.post("/api/v1/earnings/AAPL/full-research")
        assert r.status_code == 429
        assert "retry-after" in {k.lower() for k in r.headers.keys()}
