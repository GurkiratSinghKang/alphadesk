"""Tests for the /api/v1/tickers/{symbol}/fundamentals endpoint."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def authed_client():
    from core.auth import require_auth
    from main import app

    async def fake_user() -> str:
        return "test_user"

    previous = app.dependency_overrides.get(require_auth)
    app.dependency_overrides[require_auth] = fake_user
    try:
        yield TestClient(app)
    finally:
        if previous is None:
            app.dependency_overrides.pop(require_auth, None)
        else:
            app.dependency_overrides[require_auth] = previous


@pytest.fixture(autouse=True)
def _patch_cache(monkeypatch: pytest.MonkeyPatch):
    """No-op the Redis cache so tests don't bleed across each other and
    don't need a live Redis. ``cache_get`` always misses, ``cache_set``
    is captured but ignored.
    """
    from api.routes import tickers_fundamentals as tf

    async def _miss(_key):
        return None

    async def _set(_key, _data, _ttl):
        return None

    monkeypatch.setattr(tf, "cache_get", _miss)
    monkeypatch.setattr(tf, "cache_set", _set)


def _patch_fetchers(monkeypatch: pytest.MonkeyPatch, *, poly=None, bars=None):
    from api.routes import tickers_fundamentals as tf

    async def _poly(_sym):
        return poly or {}

    async def _bars(_sym, days=260):
        return bars or []

    monkeypatch.setattr(tf, "_fetch_polygon_reference", _poly)
    monkeypatch.setattr(tf, "_fetch_polygon_daily_bars", _bars)


def test_fundamentals_returns_200_with_expected_shape_for_known_symbol(
    monkeypatch: pytest.MonkeyPatch, authed_client
):
    poly = {
        "name": "NVIDIA Corporation",
        "sic_description": "Semiconductors",
        "type": "CS",
        "market_cap": 2_480_000_000_000,
        "share_class_shares_outstanding": 24_500_000_000,
        "description": "NVIDIA is the world leader in accelerated computing.",
    }
    bars = [
        {"h": 200.0, "l": 100.0, "v": 5_000_000},
        {"h": 220.0, "l": 110.0, "v": 6_000_000},
        {"h": 237.68, "l": 100.02, "v": 7_060_268},
    ] * 10
    _patch_fetchers(monkeypatch, poly=poly, bars=bars)

    resp = authed_client.get("/api/v1/tickers/NVDA/fundamentals")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["symbol"] == "NVDA"
    assert data["name"] == "NVIDIA Corporation"
    assert data["sector"] == "Semiconductors"
    assert data["market_cap"] == 2_480_000_000_000
    assert data["shares_outstanding"] == 24_500_000_000
    # 52w hi/lo derived from bars
    assert data["fifty_two_week_high"] == 237.68
    assert data["fifty_two_week_low"] == 100.0
    # avg_volume_30d derived from last 30 bars
    assert data["avg_volume_30d"] is not None
    assert data["is_demo"] is False
    # P/E etc. not exposed by Polygon /reference — explicit null
    assert data["pe_ratio"] is None
    assert data["eps_ttm"] is None
    assert data["beta"] is None


def test_fundamentals_returns_null_fields_gracefully_on_partial_polygon_data(
    monkeypatch: pytest.MonkeyPatch, authed_client
):
    # Only name + sector come back; everything else absent — the wire
    # shape must still validate so the FE renders em-dashes for the gaps.
    _patch_fetchers(
        monkeypatch,
        poly={"name": "Tesla Inc", "sic_description": "Motor Vehicles"},
        bars=[],
    )

    resp = authed_client.get("/api/v1/tickers/TSLA/fundamentals")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["symbol"] == "TSLA"
    assert data["name"] == "Tesla Inc"
    assert data["sector"] == "Motor Vehicles"
    assert data["market_cap"] is None
    assert data["shares_outstanding"] is None
    assert data["fifty_two_week_high"] is None
    assert data["fifty_two_week_low"] is None
    assert data["avg_volume_30d"] is None
    assert data["is_demo"] is False


def test_fundamentals_returns_all_null_with_demo_flag_on_total_upstream_failure(
    monkeypatch: pytest.MonkeyPatch, authed_client
):
    _patch_fetchers(monkeypatch, poly={}, bars=[])

    resp = authed_client.get("/api/v1/tickers/UNKNWN/fundamentals")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["symbol"] == "UNKNWN"
    assert data["name"] is None
    assert data["market_cap"] is None
    assert data["fifty_two_week_high"] is None
    assert data["is_demo"] is True


def test_fundamentals_rejects_invalid_symbol(authed_client):
    resp = authed_client.get("/api/v1/tickers/!!!/fundamentals")
    assert resp.status_code == 422


def test_fundamentals_uppercases_symbol(monkeypatch: pytest.MonkeyPatch, authed_client):
    captured: dict[str, str] = {}
    from api.routes import tickers_fundamentals as tf

    async def _poly(sym):
        captured["sym"] = sym
        return {"name": "Apple Inc."}

    async def _bars(sym, days=260):
        return []

    monkeypatch.setattr(tf, "_fetch_polygon_reference", _poly)
    monkeypatch.setattr(tf, "_fetch_polygon_daily_bars", _bars)

    resp = authed_client.get("/api/v1/tickers/aapl/fundamentals")
    assert resp.status_code == 200
    assert captured["sym"] == "AAPL"
    assert resp.json()["symbol"] == "AAPL"


def test_fundamentals_falls_back_to_weighted_shares_when_class_missing(
    monkeypatch: pytest.MonkeyPatch, authed_client
):
    _patch_fetchers(
        monkeypatch,
        poly={
            "name": "Test Co",
            "weighted_shares_outstanding": 100_000_000,
        },
        bars=[],
    )

    resp = authed_client.get("/api/v1/tickers/TEST/fundamentals")
    assert resp.status_code == 200
    assert resp.json()["shares_outstanding"] == 100_000_000
