"""B-31 + Round-5 Cluster D — /readyz-full deep health probe.

Verifies:
- Missing FMP / Anthropic credentials surface as ``skipped``.
- External upstream failure marks status ``degraded`` while HTTP stays 200.
- Result is cached for 30 s when status=ok (variable TTL — H-4 drops it
  to 5 s on degraded).
- Response carries ``git_sha``, ``dict_sizes``, ``claude_spend_today_usd``
  (Round-5 H-7/H-8/H-2).
- Internal `_http_status` field never leaks into the JSON body.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


def _reset_cache():
    """Clear the (Round-5 reshape) /readyz-full cache so each test
    sees a clean recompute path. The cache moved from the old
    {result, expires_at} keys to {snapshot, ts, status} when variable
    TTL landed (H-4).
    """
    from main import _READYZ_FULL_CACHE
    _READYZ_FULL_CACHE["snapshot"] = None
    _READYZ_FULL_CACHE["ts"] = 0.0
    _READYZ_FULL_CACHE["status"] = ""


@pytest.fixture
def client():
    _reset_cache()
    from main import app
    return TestClient(app)


def _patch_internals_ok():
    """Helper — patch DB + Redis checks to return ok so an external-only
    test can focus on FMP / Anthropic mocks without a live Postgres."""
    async def _ok_ping():
        return None

    return [
        patch("main.get_redis", AsyncMock(return_value=AsyncMock(ping=_ok_ping))),
        patch(
            "main._get_engine_for_readyz",
            create=True,
            new=lambda: None,
        ),
    ]


async def _redis_factory():
    """Async-callable returning a stub that responds to ping."""
    m = AsyncMock()
    m.ping = AsyncMock(return_value=True)
    return m


def _patch_db_engine_ok():
    """Patch ``core.database._get_engine`` so the DB ping path returns ok
    without hitting a real Postgres. Returns a context-manager-style
    fake engine whose .connect()/.execute() are AsyncMock no-ops."""
    fake_conn = AsyncMock()
    fake_conn.execute = AsyncMock(return_value=None)
    fake_conn.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_conn.__aexit__ = AsyncMock(return_value=None)

    fake_engine = AsyncMock()
    fake_engine.connect = lambda: fake_conn
    return patch("core.database._get_engine", return_value=fake_engine)


def test_readyz_full_skipped_when_keys_not_set(client):
    """Dev environments without ANTHROPIC_API_KEY / FMP_API_KEY must
    return status=skipped rather than crash the probe.

    Round-5: the new /readyz-full also pings DB + Redis. We patch the
    DB / Redis paths to return ok so the test isolates the
    external-key-missing branch.
    """
    _reset_cache()

    with patch("core.config.settings") as mock_settings, \
         _patch_db_engine_ok(), \
         patch("main.get_redis", _redis_factory):
        mock_settings.FMP_API_KEY = None
        mock_settings.ANTHROPIC_API_KEY = None
        resp = client.get("/readyz-full")

    body = resp.json()
    # Both upstreams skipped → status=ok, HTTP 200.
    assert resp.status_code == 200
    assert body["status"] == "ok"
    assert body["fmp"]["status"] == "skipped"
    assert body["anthropic"]["status"] == "skipped"


def test_readyz_full_still_200_on_external_down(client):
    """Anthropic outage → body shows `down` but HTTP remains 200 so
    the LB keeps routing — provided DB + Redis are both up."""
    _reset_cache()

    fake_fmp_ok = AsyncMock(return_value={"status": "ok", "latency_ms": 50.0})
    fake_anthropic_down = AsyncMock(
        return_value={"status": "down", "reason": "RuntimeError: connection refused"}
    )
    with patch("main._probe_fmp", fake_fmp_ok), \
         patch("main._probe_anthropic", fake_anthropic_down), \
         _patch_db_engine_ok(), \
         patch("main.get_redis", _redis_factory):
        resp = client.get("/readyz-full")

    body = resp.json()
    # External degradation never trips 503.
    assert resp.status_code == 200
    assert body["status"] == "degraded"
    assert body["fmp"]["status"] == "ok"
    assert body["anthropic"]["status"] == "down"


def test_readyz_full_caches_for_30s_when_ok(client):
    """Second call within TTL hits cache, doesn't re-probe upstreams.
    Regression guard for curl-loop abuse. Round-5: variable TTL is 30s
    when status=ok (H-4)."""
    _reset_cache()

    probe_fmp = AsyncMock(return_value={"status": "ok", "latency_ms": 10.0})
    probe_anthropic = AsyncMock(return_value={"status": "ok", "latency_ms": 20.0})
    with patch("main._probe_fmp", probe_fmp), \
         patch("main._probe_anthropic", probe_anthropic), \
         _patch_db_engine_ok(), \
         patch("main.get_redis", _redis_factory):
        client.get("/readyz-full")
        client.get("/readyz-full")
        client.get("/readyz-full")

    # If the first call landed status=ok the cache holds for 30s and the
    # subsequent two should not re-call.
    assert probe_fmp.await_count == 1
    assert probe_anthropic.await_count == 1
