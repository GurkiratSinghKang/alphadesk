"""PM-C: per-contract NBBO snapshot tests.

Covers the eight cases pinned in the PM-C spec:

  1. Valid OCC symbol returns 200 with the full ContractSnapshot shape.
  2. Invalid OCC format returns 422.
  3. Underlying parsing extracts correctly (e.g. AMD260508C00360000 -> AMD).
  4. Polygon failure falls back to Alpaca (mock both).
  5. Both upstream failures fall through to demo (is_demo=True).
  6. Exchange ID mapping: 304 -> "CBOE".
  7. Cache: two calls within the 2s TTL hit the upstream once.
  8. Rate limit fires after the configured per-IP cap.

The tests patch ``services.options`` helpers directly rather than a network
mock library because the existing test suite uses ``unittest.mock.AsyncMock``
patches throughout — keeps the dependency surface small and avoids pulling
in pytest-httpx which is not currently a project dep.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from services import options as opts


_VALID_OCC = "AAPL250418C00250000"
_AMD_OCC = "AMD260508C00360000"


def _make_polygon_payload(
    *,
    bid: float = 13.6,
    ask: float = 13.8,
    bid_exchange: int = 304,
    ask_exchange: int = 322,
) -> dict:
    """Return a minimal Polygon-shaped response with the fields PM-C reads."""
    return {
        "results": {
            "details": {
                "contract_type": "call",
                "strike_price": 250.0,
                "expiration_date": "2025-04-18",
            },
            "last_quote": {
                "bid": bid,
                "bid_size": 5,
                "ask": ask,
                "ask_size": 12,
                "bid_exchange": bid_exchange,
                "ask_exchange": ask_exchange,
                "midpoint": (bid + ask) / 2,
                "timeframe": "REAL-TIME",
            },
            "last_trade": {
                "price": (bid + ask) / 2,
                # Polygon's sip_timestamp is nanoseconds since epoch.
                "sip_timestamp": 1_700_000_000_000_000_000,
                "size": 1,
            },
            "day": {"volume": 24, "open": 12.0, "high": 14.0, "low": 11.5, "close": 13.6},
            "open_interest": 0,
            "implied_volatility": 1.1927,
        }
    }


def _make_alpaca_payload(*, bp: float = 1.05, ap: float = 1.20) -> dict:
    """Alpaca OPRA snapshots singular-shape envelope."""
    return {
        "latestQuote": {"bp": bp, "ap": ap, "bs": 4, "as": 7, "t": "2026-05-05T13:30:00Z"},
        "latestTrade": {"p": (bp + ap) / 2, "t": "2026-05-05T13:29:45Z", "s": 2},
        "dailyBar": {"v": 99, "c": 1.10},
        "openInterest": 1234,
        "impliedVolatility": 0.42,
    }


@pytest.fixture(autouse=True)
def _clear_caches_and_buckets():
    """Reset the per-symbol snapshot cache and rate-limit history between tests."""
    from api.routes import _rate_limit
    opts._contract_snapshot_cache.clear()
    _rate_limit._reset_for_tests()
    yield
    opts._contract_snapshot_cache.clear()
    _rate_limit._reset_for_tests()


# ---------------------------------------------------------------------------
# 1. Valid OCC + 200 + full shape
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_valid_symbol_returns_full_snapshot_via_polygon():
    """Polygon path returns a 200 response with every documented field set."""
    polygon_response = _make_polygon_payload()

    class _FakeResp:
        status_code = 200

        def json(self):
            return polygon_response

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def get(self, *a, **kw):
            return _FakeResp()

    with patch.object(opts, "_polygon_key_empty", return_value=False), \
         patch("httpx.AsyncClient", _FakeClient):
        snap = await opts.fetch_contract_snapshot(_VALID_OCC)

    assert snap.symbol == _VALID_OCC
    assert snap.bid == 13.6
    assert snap.ask == 13.8
    assert snap.bid_size == 5
    assert snap.ask_size == 12
    assert snap.bid_exchange == "CBOE"
    assert snap.ask_exchange == "PHLX"
    assert snap.midpoint == pytest.approx(13.7, rel=1e-3)
    assert snap.last_price == pytest.approx(13.7, rel=1e-3)
    assert snap.last_timestamp is not None and "T" in snap.last_timestamp
    assert snap.volume == 24
    assert snap.open_interest == 0
    assert snap.implied_volatility == pytest.approx(1.1927, rel=1e-3)
    assert snap.fetched_at  # ISO populated
    assert snap.is_demo is False


# ---------------------------------------------------------------------------
# 2. Invalid OCC -> 422
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_invalid_occ_format_raises_422():
    """Symbols that don't match the OCC pattern raise HTTPException(422)."""
    from fastapi import HTTPException

    for bad in ("not-an-occ", "AAPL", "AAPL250418X00250000", "12345"):
        with pytest.raises(HTTPException) as exc_info:
            await opts.fetch_contract_snapshot(bad)
        assert exc_info.value.status_code == 422


def test_invalid_occ_via_route_returns_422():
    """The HTTP route surfaces the 422 too."""
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    resp = client.get("/api/v1/options/contract-snapshot", params={"symbol": "BAD"})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# 3. Underlying parsing
# ---------------------------------------------------------------------------

def test_parse_contract_underlying_extracts_ticker():
    assert opts._parse_contract_underlying(_AMD_OCC) == "AMD"
    assert opts._parse_contract_underlying("AAPL250418C00250000") == "AAPL"
    assert opts._parse_contract_underlying("SPY260619P00400000") == "SPY"
    assert opts._parse_contract_underlying("not-an-occ") is None


# ---------------------------------------------------------------------------
# 4. Polygon failure -> Alpaca fallback
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_polygon_failure_falls_back_to_alpaca():
    """When Polygon returns None, the Alpaca path serves the snapshot."""
    alpaca_snap = await _build_alpaca_snapshot()

    with patch.object(opts, "_fetch_polygon_contract_snapshot", AsyncMock(return_value=None)), \
         patch.object(opts, "_fetch_alpaca_contract_snapshot", AsyncMock(return_value=alpaca_snap)):
        snap = await opts.fetch_contract_snapshot(_VALID_OCC)

    assert snap.is_demo is False
    assert snap.symbol == _VALID_OCC
    # Alpaca path leaves exchanges null because it doesn't carry venue IDs.
    assert snap.bid_exchange is None
    assert snap.ask_exchange is None
    assert snap.bid == alpaca_snap.bid
    assert snap.ask == alpaca_snap.ask


async def _build_alpaca_snapshot() -> opts.ContractSnapshot:
    """Helper: build a real ContractSnapshot via the Alpaca path with mocked HTTP."""
    payload = _make_alpaca_payload()

    class _FakeResp:
        status_code = 200

        def json(self):
            return payload

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def get(self, *a, **kw):
            return _FakeResp()

    with patch.object(opts, "_alpaca_keys_empty", return_value=False), \
         patch("httpx.AsyncClient", _FakeClient):
        result = await opts._fetch_alpaca_contract_snapshot(_VALID_OCC)
    assert result is not None
    return result


# ---------------------------------------------------------------------------
# 5. Both fail -> demo (is_demo=True)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_both_providers_fail_returns_demo_snapshot():
    """Polygon AND Alpaca returning None falls through to demo synthesis."""
    with patch.object(opts, "_fetch_polygon_contract_snapshot", AsyncMock(return_value=None)), \
         patch.object(opts, "_fetch_alpaca_contract_snapshot", AsyncMock(return_value=None)), \
         patch.object(opts, "_fetch_alpaca_spot", AsyncMock(return_value=None)):
        snap = await opts.fetch_contract_snapshot(_AMD_OCC)

    assert snap.is_demo is True
    assert snap.symbol == _AMD_OCC
    assert snap.bid > 0
    assert snap.ask > snap.bid
    # Demo path must NOT fabricate exchange attribution.
    assert snap.bid_exchange is None
    assert snap.ask_exchange is None
    assert snap.implied_volatility is not None and snap.implied_volatility > 0


# ---------------------------------------------------------------------------
# 6. Exchange ID mapping
# ---------------------------------------------------------------------------

def test_exchange_id_mapping_seeded():
    """At least 8 OPRA exchanges seeded; 304 -> CBOE; unknown -> None."""
    assert len(opts._OPTIONS_EXCHANGE_MAP) >= 8
    assert opts._polygon_exchange_id_to_name(304) == "CBOE"
    assert opts._polygon_exchange_id_to_name(322) == "PHLX"
    assert opts._polygon_exchange_id_to_name(313) == "MIAX"
    assert opts._polygon_exchange_id_to_name(99999) is None
    assert opts._polygon_exchange_id_to_name(None) is None


# ---------------------------------------------------------------------------
# 7. Cache: 2 calls within TTL -> 1 upstream call
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cache_collapses_repeat_calls_within_ttl():
    """Two calls inside the 2s TTL hit the upstream exactly once."""
    polygon_payload = _make_polygon_payload()

    class _FakeResp:
        status_code = 200

        def json(self):
            return polygon_payload

    call_count = {"n": 0}

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def get(self, *a, **kw):
            call_count["n"] += 1
            return _FakeResp()

    with patch.object(opts, "_polygon_key_empty", return_value=False), \
         patch("httpx.AsyncClient", _FakeClient):
        a = await opts.fetch_contract_snapshot(_VALID_OCC)
        b = await opts.fetch_contract_snapshot(_VALID_OCC)

    assert call_count["n"] == 1, f"expected 1 upstream call, got {call_count['n']}"
    # Same in-memory ContractSnapshot returned -> cache hit.
    assert a is b


# ---------------------------------------------------------------------------
# 8. Rate limit fires after N calls
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_rate_limit_fires_after_cap():
    """The per-IP rate-limit raises HTTP 429 once the cap is hit."""
    from api.routes._rate_limit import (
        _CONTRACT_SNAPSHOT_BUCKET_MAX,
        check_contract_snapshot_rate,
        _reset_for_tests,
    )
    from fastapi import HTTPException

    _reset_for_tests()

    # Fill the bucket exactly to cap — these calls must succeed.
    for _ in range(_CONTRACT_SNAPSHOT_BUCKET_MAX):
        await check_contract_snapshot_rate("1.2.3.4")

    # The very next call from the same IP must trip the limiter.
    with pytest.raises(HTTPException) as exc_info:
        await check_contract_snapshot_rate("1.2.3.4")
    assert exc_info.value.status_code == 429
