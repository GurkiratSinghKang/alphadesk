"""Tests for Round 7 Fix 2 (P127) — per-IP market-route rate limit.

We can't install the caddy-ratelimit plugin on the managed edge, so the
cap lives in the application at ``api.routes.market._market_rate_limit_or_429``.
These tests drive that helper directly with a fakeredis-backed Redis
client — the FastAPI app flow is tested implicitly elsewhere; what we
actually want to assert here is the cap itself.

Contract:
  * Within a minute bucket: up to ``cap`` requests succeed; the next one
    raises HTTPException(429, Retry-After header set).
  * Separate trusted client IPs do not share a bucket.
  * Authed vs unauth traffic uses different caps
    (``MARKET_RL_AUTH_PER_MIN`` vs ``MARKET_RL_UNAUTH_PER_MIN``).
  * On Redis failure the helper fails OPEN (no exception raised).
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException


class _FakeRequest:
    """Minimal stand-in for ``fastapi.Request`` used by the helper.

    The helper only reads ``.headers.get``, ``.cookies.get`` and
    ``.client.host`` — matches the real shape enough to exercise the
    IP + auth-detection branches without spinning up an ASGI app.
    """

    def __init__(
        self,
        ip: str = "1.2.3.4",
        *,
        authorization: str | None = None,
        access_cookie: str | None = None,
        xff: str | None = None,
    ) -> None:
        hdr: dict[str, str] = {}
        if authorization:
            hdr["authorization"] = authorization
        if xff:
            hdr["x-forwarded-for"] = xff
        self.headers = _HeaderDict(hdr)
        self.cookies = {"access_token": access_cookie} if access_cookie else {}

        class _Client:
            def __init__(self, host: str) -> None:
                self.host = host

        self.client = _Client(ip)


class _HeaderDict(dict):
    """Case-insensitive dict-like facade for request headers."""

    def get(self, key: str, default: Any = None) -> Any:  # type: ignore[override]
        return super().get(key.lower(), default)


class _FakeResponse:
    """Stand-in for ``fastapi.Response`` — records header mutations."""

    def __init__(self) -> None:
        self.headers: dict[str, str] = {}


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Swap ``core.redis.get_redis`` with a fakeredis-backed client."""
    fakeredis = pytest.importorskip("fakeredis")
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)

    from core import redis as redis_module

    async def _get_fake() -> Any:
        return client

    monkeypatch.setattr(redis_module, "get_redis", _get_fake)
    return client


@pytest.fixture
def low_caps(monkeypatch: pytest.MonkeyPatch) -> tuple[int, int]:
    """Shrink the cap so the test doesn't need to issue 600 calls."""
    from core.config import settings

    monkeypatch.setattr(settings, "MARKET_RL_UNAUTH_PER_MIN", 3, raising=False)
    monkeypatch.setattr(settings, "MARKET_RL_AUTH_PER_MIN", 5, raising=False)
    return (3, 5)


@pytest.mark.asyncio
async def test_under_cap_does_not_raise(fake_redis: Any, low_caps: tuple[int, int]) -> None:
    """Up to ``cap`` requests from the same IP must pass without raising.

    Also asserts the ``X-RateLimit-Remaining`` header counts down so a
    cooperating client can self-throttle before hitting 429.
    """
    from api.routes.market import _market_rate_limit_or_429

    cap_unauth, _ = low_caps
    req = _FakeRequest(ip="10.0.0.1")
    resp = _FakeResponse()

    for i in range(cap_unauth):
        # No raise — the helper returns None on success.
        await _market_rate_limit_or_429(req, resp)

    # Remaining budget after ``cap_unauth`` calls should be 0 (we just
    # consumed the last slot).
    assert resp.headers.get("X-RateLimit-Limit") == str(cap_unauth)
    assert resp.headers.get("X-RateLimit-Remaining") == "0"


@pytest.mark.asyncio
async def test_over_cap_raises_429_with_retry_after(
    fake_redis: Any, low_caps: tuple[int, int]
) -> None:
    """The first request past the cap must raise 429 with Retry-After."""
    from api.routes.market import _market_rate_limit_or_429

    cap_unauth, _ = low_caps
    req = _FakeRequest(ip="10.0.0.2")
    resp = _FakeResponse()

    for _ in range(cap_unauth):
        await _market_rate_limit_or_429(req, resp)

    # The (cap+1)th request must be rejected.
    with pytest.raises(HTTPException) as excinfo:
        await _market_rate_limit_or_429(req, resp)

    assert excinfo.value.status_code == 429
    # Retry-After header must be set (RFC 7231) and be a positive integer.
    headers = excinfo.value.headers or {}
    ra = headers.get("Retry-After")
    assert ra is not None, "429 response must carry a Retry-After header"
    assert int(ra) >= 1

    # Separate IPs are not affected — fresh bucket, still under cap.
    other_req = _FakeRequest(ip="10.0.0.99")
    other_resp = _FakeResponse()
    # Should not raise.
    await _market_rate_limit_or_429(other_req, other_resp)


@pytest.mark.asyncio
async def test_authed_gets_higher_cap(fake_redis: Any, low_caps: tuple[int, int]) -> None:
    """Authed callers use ``MARKET_RL_AUTH_PER_MIN`` instead of the
    unauth budget.

    With low_caps fixture (auth=5, unauth=3), an authed caller should
    survive the 4th request that an unauth caller would have been
    rejected on.
    """
    from api.routes.market import _market_rate_limit_or_429

    _, cap_auth = low_caps
    req = _FakeRequest(
        ip="10.0.0.3",
        authorization="Bearer abc",  # flip the auth branch
    )
    resp = _FakeResponse()

    # All ``cap_auth`` requests must succeed — 5 is above the 3-unauth cap.
    for _ in range(cap_auth):
        await _market_rate_limit_or_429(req, resp)

    # And the (cap_auth+1)th fails.
    with pytest.raises(HTTPException) as excinfo:
        await _market_rate_limit_or_429(req, resp)
    assert excinfo.value.status_code == 429


@pytest.mark.asyncio
async def test_redis_failure_fails_open(
    monkeypatch: pytest.MonkeyPatch,
    low_caps: tuple[int, int],
) -> None:
    """Redis unavailable → the helper MUST NOT raise.

    Market data is a read-only path; blocking every client during a
    Redis outage would turn a transient blip into a full blackout.
    The helper logs and returns None. Asserts no exception across many
    consecutive failing calls.
    """
    from api.routes import market as market_module

    # Force get_redis to raise so the except branch runs.
    async def _boom() -> Any:
        raise RuntimeError("simulated redis outage")

    from core import redis as redis_module
    monkeypatch.setattr(redis_module, "get_redis", _boom)

    req = _FakeRequest(ip="10.0.0.4")
    resp = _FakeResponse()

    # 50 calls — no raise even well past the cap, because the limiter
    # never successfully read a count.
    for _ in range(50):
        await market_module._market_rate_limit_or_429(req, resp)


@pytest.mark.asyncio
async def test_raw_xff_header_is_not_trusted_directly(
    fake_redis: Any, low_caps: tuple[int, int]
) -> None:
    """Raw X-Forwarded-For does not bypass trusted-proxy handling.

    ``ProxyHeadersMiddleware`` rewrites ``request.client.host`` only
    when the TCP peer is trusted. The route helper must use that
    rewritten peer value instead of parsing raw XFF itself; otherwise a
    direct caller could rotate spoofed XFF first hops and evade the cap.
    """
    from api.routes.market import _market_rate_limit_or_429

    cap_unauth, _ = low_caps

    # Both requests share the peer IP but differ in raw XFF. They must
    # still share one bucket because middleware has not rewritten the
    # fake request.client.host.
    req_a = _FakeRequest(ip="127.0.0.1", xff="203.0.113.10")
    req_b = _FakeRequest(ip="127.0.0.1", xff="203.0.113.20")
    resp = _FakeResponse()

    # Burn the peer-IP budget via A.
    for _ in range(cap_unauth):
        await _market_rate_limit_or_429(req_a, resp)
    with pytest.raises(HTTPException):
        await _market_rate_limit_or_429(req_a, resp)

    # B presents a different raw XFF, but the same trusted peer bucket is
    # already exhausted.
    with pytest.raises(HTTPException):
        await _market_rate_limit_or_429(req_b, resp)

    # A truly separate middleware-resolved peer still gets its own bucket.
    req_c = _FakeRequest(ip="203.0.113.20")
    await _market_rate_limit_or_429(req_c, resp)


@pytest.mark.asyncio
async def test_batched_snapshots_route_invokes_rate_limiter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The batched /snapshots endpoint must share the market-data limiter."""
    from api.routes import market as market_module

    calls: list[str] = []

    async def _fake_limiter(request: Any, response: Any) -> None:
        calls.append(request.client.host)

    async def _fake_snapshot(symbol: str) -> Any:
        return {"symbol": symbol}

    monkeypatch.setattr(market_module, "_market_rate_limit_or_429", _fake_limiter)
    monkeypatch.setattr(market_module, "_alpaca_keys_available", lambda: False)
    monkeypatch.setattr(market_module, "_fetch_snapshot_impl", _fake_snapshot)

    req = _FakeRequest(ip="10.0.0.55")
    resp = _FakeResponse()

    result = await market_module.get_snapshots(req, resp, symbols="AAPL,MSFT")

    assert calls == ["10.0.0.55"]
    assert sorted(result) == ["AAPL", "MSFT"]


@pytest.mark.asyncio
async def test_depth_route_invokes_limiter_and_returns_depth_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The /depth route should be rate-limited and expose the stable contract."""
    from api.routes import market as market_module

    calls: list[str] = []

    async def _fake_limiter(request: Any, response: Any) -> None:
        calls.append(request.client.host)

    async def _fake_depth(symbol: str, *, levels: int, client_host: str | None) -> dict[str, Any]:
        return {
            "symbol": symbol,
            "levels": levels,
            "client_host": client_host,
            "kind": "top_of_book",
            "is_l2": False,
        }

    monkeypatch.setattr(market_module, "_market_rate_limit_or_429", _fake_limiter)
    monkeypatch.setattr(market_module, "fetch_market_depth", _fake_depth)

    req = _FakeRequest(ip="10.0.0.77")
    resp = _FakeResponse()

    result = await market_module.get_market_depth("AAPL", req, resp, levels=5)

    assert calls == ["10.0.0.77"]
    assert result["symbol"] == "AAPL"
    assert result["levels"] == 5
    assert result["client_host"] == "10.0.0.77"
    assert result["is_l2"] is False


@pytest.mark.asyncio
async def test_depth_capabilities_route_invokes_limiter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Capabilities are also a market-data route and should share limits."""
    from api.routes import market as market_module

    calls: list[str] = []

    async def _fake_limiter(request: Any, response: Any) -> None:
        calls.append(request.client.host)

    monkeypatch.setattr(market_module, "_market_rate_limit_or_429", _fake_limiter)
    monkeypatch.setattr(
        market_module,
        "market_depth_capabilities",
        lambda: {"active_kind": "top_of_book", "true_l2_available": False},
    )

    req = _FakeRequest(ip="10.0.0.88")
    resp = _FakeResponse()

    result = await market_module.get_depth_capabilities(req, resp)

    assert calls == ["10.0.0.88"]
    assert result["active_kind"] == "top_of_book"
    assert result["true_l2_available"] is False
