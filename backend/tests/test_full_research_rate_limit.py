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

# Auth override is installed by conftest.py's session-scoped autouse fixture.
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
        "services.earnings_screener._load_earnings_meta",
        AsyncMock(return_value={
            "symbol": "AAPL",
            "company": "Apple",
            "sector": "Tech",
            "report_date": "2026-04-30",
            "report_time": "AMC",
        }),
    ), patch(
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


def test_full_research_404_does_not_charge_rate_bucket():
    """Off-calendar metadata misses should not burn the Claude quota."""
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
        "services.earnings_screener._load_earnings_meta",
        AsyncMock(return_value=None),
    ):
        for _ in range(_BUCKET_MAX + 1):
            r = client.post("/api/v1/earnings/AAPL/full-research")
            assert r.status_code == 404

    with patch(
        "services.earnings_screener._load_earnings_meta",
        AsyncMock(return_value={
            "symbol": "AAPL",
            "company": "Apple",
            "sector": "Tech",
            "report_date": "2026-04-30",
            "report_time": "AMC",
        }),
    ), patch(
        "services.earnings_screener.run_full_research",
        AsyncMock(return_value=fake_payload),
    ):
        r = client.post("/api/v1/earnings/AAPL/full-research")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_full_research_cache_hit_does_not_charge_rate_bucket(monkeypatch: pytest.MonkeyPatch):
    """Warm full-research cache returns before the expensive Claude limiter."""
    from api.routes import earnings as earnings_route
    from api.schemas.earnings import ClaudeFullResearch

    fake_payload = ClaudeFullResearch(
        thesis_paragraph="cached",
        comparable_setups=[],
        post_earnings_drift_playbook="cached",
        sector_backdrop="cached",
        analyst_consensus_delta="cached",
        what_would_change_my_mind="cached",
        confidence=0.5,
        model="claude-stub",
        generated_at=datetime.now(timezone.utc),
    )

    async def _boom_rate(ip: str) -> None:
        raise AssertionError("rate limiter should not run on cache hit")

    monkeypatch.setattr(
        earnings_route.earnings_screener,
        "_load_earnings_meta",
        AsyncMock(return_value={
            "symbol": "AAPL",
            "company": "Apple",
            "sector": "Tech",
            "report_date": "2026-04-30",
            "report_time": "AMC",
        }),
    )
    monkeypatch.setattr(
        earnings_route.earnings_screener,
        "load_cached_full_research",
        AsyncMock(return_value=fake_payload),
    )
    monkeypatch.setattr(earnings_route, "check_full_research_rate", _boom_rate)

    result = await earnings_route.post_full_research("AAPL", object(), username="alice")

    assert result.thesis_paragraph == "cached"


@pytest.mark.asyncio
async def test_full_research_user_rate_limit_sets_retry_after(monkeypatch: pytest.MonkeyPatch):
    """Per-user limiter must include Retry-After so the UI shows a real cooldown."""
    from api.routes import earnings as earnings_route
    from core import redis as redis_module

    class _Redis:
        async def incr(self, key: str) -> int:
            return 11

        async def expire(self, key: str, ttl: int) -> None:
            return None

    async def _ok_ip_rate(ip: str) -> None:
        return None

    async def _redis() -> _Redis:
        return _Redis()

    monkeypatch.setattr(
        earnings_route.earnings_screener,
        "_load_earnings_meta",
        AsyncMock(return_value={
            "symbol": "AAPL",
            "company": "Apple",
            "sector": "Tech",
            "report_date": "2026-04-30",
            "report_time": "AMC",
        }),
    )
    monkeypatch.setattr(
        earnings_route.earnings_screener,
        "load_cached_full_research",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(earnings_route, "check_full_research_rate", _ok_ip_rate)
    monkeypatch.setattr(redis_module, "get_redis", _redis)

    class _Request:
        class _Client:
            host = "10.0.0.88"

        client = _Client()

    with pytest.raises(HTTPException) as excinfo:
        await earnings_route.post_full_research("AAPL", _Request(), username="alice")

    assert excinfo.value.status_code == 429
    assert int((excinfo.value.headers or {})["Retry-After"]) >= 1


# ───────────────────────── Round-4 detail rate-limit tests ─────────────────────────


@pytest.mark.asyncio
async def test_detail_helper_allows_up_to_bucket_max():
    """Round-4 CLUSTER 2 #8: check_detail_rate accepts up to
    _DETAIL_BUCKET_MAX calls without raising."""
    from api.routes._rate_limit import _DETAIL_BUCKET_MAX, check_detail_rate
    for _ in range(_DETAIL_BUCKET_MAX):
        await check_detail_rate("10.0.0.10")


@pytest.mark.asyncio
async def test_detail_helper_429s_on_overflow():
    """Round-4 CLUSTER 2 #8: 31st call within the window returns 429."""
    from api.routes._rate_limit import _DETAIL_BUCKET_MAX, check_detail_rate
    for _ in range(_DETAIL_BUCKET_MAX):
        await check_detail_rate("10.0.0.11")
    with pytest.raises(HTTPException) as exc:
        await check_detail_rate("10.0.0.11")
    assert exc.value.status_code == 429
    assert "Retry-After" in exc.value.headers


@pytest.mark.asyncio
async def test_detail_and_full_research_buckets_are_independent():
    """Round-4 CLUSTER 2 #8: the two endpoints have separate buckets,
    so saturating /detail's bucket doesn't affect /full-research."""
    from api.routes._rate_limit import (
        _DETAIL_BUCKET_MAX, check_detail_rate, check_full_research_rate,
    )
    for _ in range(_DETAIL_BUCKET_MAX):
        await check_detail_rate("10.0.0.12")
    # full-research bucket for the same IP should still accept calls
    await check_full_research_rate("10.0.0.12")


def test_detail_route_rate_limited_after_30_calls():
    """Round-4 CLUSTER 2 #8: hitting /detail 30 times succeeds; the 31st
    returns 429."""
    from api.schemas.earnings import EarningsDetail
    from api.routes._rate_limit import _DETAIL_BUCKET_MAX

    fake_detail = EarningsDetail(
        symbol="AAPL", company="Apple", sector="Tech",
        report_date=None, report_time="DMT",
        quote=None, metrics=None, strike_ladder=None,
        claude_structured=None, claude_full_research=None,
        iv_term_structure=None, skew=None, news=[],
        partial=True, error_codes=["stub_detail"],
        generated_at=datetime.now(timezone.utc),
    )
    with patch(
        "services.earnings_screener.get_detail",
        AsyncMock(return_value=fake_detail),
    ):
        for i in range(_DETAIL_BUCKET_MAX):
            r = client.get("/api/v1/earnings/AAPL/detail")
            assert r.status_code == 200, f"call {i} should succeed"
        r = client.get("/api/v1/earnings/AAPL/detail")
        assert r.status_code == 429


@pytest.mark.asyncio
async def test_periodic_sweep_drops_stale_buckets():
    """Round-4 CLUSTER 6 #23: the slowloris-resistant sweep clears empty
    or fully-aged-out deques even when the caller doesn't hit the cap."""
    import time as _time
    from api.routes import _rate_limit as rl

    # Seed a bucket with timestamps from way in the past.
    stale_time = _time.monotonic() - rl._BUCKET_WINDOW_S - 60
    rl._history["10.99.99.99"].append(stale_time)
    rl._detail_history["10.99.99.98"].append(stale_time)
    # Also seed an empty deque
    rl._history["10.99.99.97"]  # touch via defaultdict to create the entry

    await rl._periodic_sweep_once()

    assert "10.99.99.99" not in rl._history
    assert "10.99.99.98" not in rl._detail_history
    assert "10.99.99.97" not in rl._history
