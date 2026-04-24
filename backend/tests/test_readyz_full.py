"""B-31 — /readyz-full deep health probe.

Verifies:
- Missing credentials produce ``status=skipped`` without attempting a call.
- Probe failures surface as ``down`` in the body but stay HTTP 200 (so
  the load balancer doesn't drop the container on an upstream outage).
- Result is cached for 30 s — two consecutive requests hit the cache.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    # Reset the module-level cache so tests don't bleed into each other.
    from main import _READYZ_FULL_CACHE, app
    _READYZ_FULL_CACHE["result"] = None
    _READYZ_FULL_CACHE["expires_at"] = 0.0
    return TestClient(app)


def test_readyz_full_skipped_when_keys_not_set(client):
    """Dev environments without ANTHROPIC_API_KEY / FMP_API_KEY must
    return status=skipped rather than crash the probe."""
    from main import _READYZ_FULL_CACHE
    _READYZ_FULL_CACHE["result"] = None
    _READYZ_FULL_CACHE["expires_at"] = 0.0

    with patch("core.config.settings") as mock_settings:
        mock_settings.FMP_API_KEY = None
        mock_settings.ANTHROPIC_API_KEY = None
        resp = client.get("/readyz-full")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["fmp"]["status"] == "skipped"
    assert body["anthropic"]["status"] == "skipped"


def test_readyz_full_still_200_on_external_down(client):
    """Anthropic outage → body shows `down` but HTTP remains 200 so
    the LB keeps routing."""
    from main import _READYZ_FULL_CACHE
    _READYZ_FULL_CACHE["result"] = None
    _READYZ_FULL_CACHE["expires_at"] = 0.0

    fake_fmp_ok = AsyncMock(return_value={"status": "ok", "latency_ms": 50.0})
    fake_anthropic_down = AsyncMock(
        return_value={"status": "down", "reason": "RuntimeError: connection refused"}
    )
    with patch("main._probe_fmp", fake_fmp_ok), \
         patch("main._probe_anthropic", fake_anthropic_down):
        resp = client.get("/readyz-full")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["fmp"]["status"] == "ok"
    assert body["anthropic"]["status"] == "down"


def test_readyz_full_caches_for_30s(client):
    """Second call within TTL hits cache, doesn't re-probe upstreams.
    Regression guard for curl-loop abuse."""
    from main import _READYZ_FULL_CACHE
    _READYZ_FULL_CACHE["result"] = None
    _READYZ_FULL_CACHE["expires_at"] = 0.0

    probe_fmp = AsyncMock(return_value={"status": "ok", "latency_ms": 10.0})
    probe_anthropic = AsyncMock(return_value={"status": "ok", "latency_ms": 20.0})
    with patch("main._probe_fmp", probe_fmp), \
         patch("main._probe_anthropic", probe_anthropic):
        client.get("/readyz-full")
        client.get("/readyz-full")
        client.get("/readyz-full")

    assert probe_fmp.await_count == 1
    assert probe_anthropic.await_count == 1
