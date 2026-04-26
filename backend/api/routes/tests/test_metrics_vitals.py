"""Tests for /api/v1/metrics/vitals — Round-7 / M-8.

The frontend's web-vitals beacon previously hit a 404 because no
backend route existed. These tests pin down:

  * Happy-path: a valid web-vitals@4 payload returns 204 No Content.
  * Strict shape: an unknown ``name`` (typo, hostile) returns 422.
  * Strict shape: out-of-range ``value`` returns 422.
  * Optional fields: ``navigationType`` and ``url`` may be omitted.
  * Public access: no Authorization header is required (the beacon
    fires from unauthenticated landing pages — gating it would
    silently drop the cohort that matters most for landing LCP).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client() -> TestClient:
    """TestClient against the real app — the metrics vitals endpoint
    is intentionally public so no auth override is needed."""
    from main import app
    return TestClient(app)


def _payload(**overrides: object) -> dict:
    base = {
        "name": "LCP",
        "value": 1234.5,
        "rating": "good",
        "delta": 1234.5,
        "id": "v4-1234567890-12",
        "navigationType": "navigate",
        "url": "https://tradingalpha.net/",
    }
    base.update(overrides)
    return base


def test_vitals_happy_path_returns_204(client: TestClient) -> None:
    """A valid web-vitals@4 payload returns 204 No Content."""
    resp = client.post("/api/v1/metrics/vitals", json=_payload())
    assert resp.status_code == 204
    assert resp.content == b""


def test_vitals_unknown_name_rejected(client: TestClient) -> None:
    """A typo'd / hostile ``name`` is rejected with 422 so it can't
    pollute the structured log."""
    resp = client.post(
        "/api/v1/metrics/vitals", json=_payload(name="LCPP"),
    )
    assert resp.status_code == 422


def test_vitals_value_clamp(client: TestClient) -> None:
    """``value`` must be a non-negative number bounded at 1e7."""
    resp = client.post(
        "/api/v1/metrics/vitals", json=_payload(value=-1.0),
    )
    assert resp.status_code == 422
    resp = client.post(
        "/api/v1/metrics/vitals", json=_payload(value=1e8),
    )
    assert resp.status_code == 422


def test_vitals_optional_fields_omitted(client: TestClient) -> None:
    """``navigationType`` and ``url`` are optional."""
    payload = _payload()
    payload.pop("navigationType")
    payload.pop("url")
    resp = client.post("/api/v1/metrics/vitals", json=payload)
    assert resp.status_code == 204


def test_vitals_unauthenticated_allowed(client: TestClient) -> None:
    """The endpoint must NOT be gated by ``require_auth``. The fixture
    pre-installs an auth override but the route is registered without
    a router-level dep, so this exercises the public path."""
    # Strip the Authorization header by using the underlying ASGI app
    # via TestClient with no custom headers — the fixture's
    # dependency override applies only to require_auth-gated routes.
    resp = client.post("/api/v1/metrics/vitals", json=_payload())
    assert resp.status_code == 204
