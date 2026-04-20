"""Rate-limit / fail-closed coverage for the TradingView webhook.

Wave 3M / persona-91 #3: the pre-Wave-3M handler caught every Redis
exception and logged "allowing request". That meant an attacker who
could DoS Redis (or time the request to coincide with a Redis restart)
could then hammer the webhook at unbounded rate — each request still
ran HMAC compare + JSON parse, so the CPU cost scaled with attacker
traffic. Wave 3M converted this to fail-CLOSED: on any Redis error,
the webhook returns 503.

This module asserts that contract directly against the route function.
We deliberately skip wiring a full FastAPI TestClient because:

1. The fail-closed check is a single `raise HTTPException(503)` on the
   Redis exception path — exercising the function directly gives a
   tighter, more obvious assertion.
2. The live-gate sibling file (``test_webhooks_live_gate.py``) also
   calls the handlers directly; we follow the same pattern.

Coverage:

* Redis ``incr`` raising ``ConnectionError`` → handler raises 503 with
  the "Rate limiter unavailable" detail.
* Redis ``incr`` raising a generic ``RuntimeError`` → handler still
  raises 503 (catch-all branch).
* The sentinel used is HTTP 503, NOT 429 — the latter would signal
  "back off" but still imply the endpoint is functional, which is
  misleading during a Redis outage.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #


def _make_request(client_ip: str = "198.51.100.7") -> Any:
    """Build a minimal ``Request``-shaped object for the route handler.

    ``receive_tradingview_webhook`` only reads ``request.client.host``
    before the Redis call returns — we never reach the body-parse path
    in these tests because Redis fails first. A lightweight
    ``MagicMock`` is enough.
    """
    client = MagicMock()
    client.host = client_ip
    request = MagicMock()
    request.client = client
    return request


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_redis_connection_error_returns_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Simulated Redis outage → webhook rejects with 503 (fail-closed).

    The pre-fix behaviour was ``logger.exception(...); # fall through``
    which silently let the request continue to the HMAC-compare and
    JSON-parse stages. That neutered the rate limit as an attack
    mitigation: an attacker who can DoS Redis gets an unbounded rate
    on the expensive cryptographic compare path.

    The fix raises ``HTTPException(503)`` on the except branch. This
    test asserts that contract.
    """
    from api.routes import webhooks as webhooks_mod

    # Install a fake get_redis that returns a client whose ``incr``
    # raises a ConnectionError — the specific class redis.asyncio emits
    # when its TCP connection to Redis drops.
    class _BrokenRedis:
        async def incr(self, key: str) -> int:
            raise ConnectionError("Redis is unreachable")

        async def expire(self, key: str, ttl: int) -> bool:  # pragma: no cover
            # Never called when ``incr`` raises first.
            raise AssertionError("expire must not be reached")

    async def _fake_get_redis() -> Any:
        return _BrokenRedis()

    monkeypatch.setattr(webhooks_mod, "get_redis", _fake_get_redis)

    request = _make_request()

    with pytest.raises(HTTPException) as exc_info:
        await webhooks_mod.receive_tradingview_webhook(
            request=request,
            x_tv_secret="anything",
            x_tv_timestamp="1700000000",
        )

    assert exc_info.value.status_code == 503, (
        "SECURITY: webhook must fail CLOSED on Redis outage. Allowing "
        "requests through when rate-limiting state is unavailable "
        "lets attackers DoS Redis to bypass the rate limit and spray "
        "HMAC-compare payloads at unbounded rate."
    )
    # Message must clearly indicate rate limiter unavailability so
    # upstream alerting (which pattern-matches 5xx detail strings) can
    # page the infra team instead of the application team.
    assert "Rate limiter unavailable" in exc_info.value.detail


@pytest.mark.asyncio
async def test_generic_redis_error_returns_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Any unexpected exception from Redis → 503, not fall-through.

    The ``except Exception`` catch-all MUST still fail-closed. This
    guards against a future refactor that narrows the catch to a
    specific Redis exception class: the generic branch would then
    silently re-enable fail-open for any new exception type.
    """
    from api.routes import webhooks as webhooks_mod

    class _FlakyRedis:
        async def incr(self, key: str) -> int:
            raise RuntimeError("unexpected redis client state")

    async def _fake_get_redis() -> Any:
        return _FlakyRedis()

    monkeypatch.setattr(webhooks_mod, "get_redis", _fake_get_redis)

    request = _make_request()

    with pytest.raises(HTTPException) as exc_info:
        await webhooks_mod.receive_tradingview_webhook(
            request=request,
            x_tv_secret="anything",
            x_tv_timestamp="1700000000",
        )

    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_get_redis_failure_returns_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Even ``get_redis()`` itself blowing up must fail-closed.

    Covers the case where the Redis client can't be constructed at all
    (e.g. misconfigured connection URL, DNS failure during the pool
    init). The except branch lives around the *entire* try block, so
    this path also yields 503.
    """
    from api.routes import webhooks as webhooks_mod

    async def _fake_get_redis() -> Any:
        raise ConnectionError("cannot reach redis host")

    monkeypatch.setattr(webhooks_mod, "get_redis", _fake_get_redis)

    request = _make_request()

    with pytest.raises(HTTPException) as exc_info:
        await webhooks_mod.receive_tradingview_webhook(
            request=request,
            x_tv_secret="anything",
            x_tv_timestamp="1700000000",
        )

    assert exc_info.value.status_code == 503
    assert "Rate limiter unavailable" in exc_info.value.detail


@pytest.mark.asyncio
async def test_rate_limit_429_still_raised_on_healthy_redis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sanity check: the 429 path (Redis healthy, count > limit) is not
    swallowed by the broader fail-closed change.

    Regression guard: the ``except HTTPException: raise`` re-raise MUST
    sit before the ``except Exception: raise 503`` branch so a genuine
    429 doesn't get rewritten to 503. This test confirms the ordering.
    """
    from api.routes import webhooks as webhooks_mod

    class _SpammedRedis:
        async def incr(self, key: str) -> int:
            # Past the TV_RATE_LIMIT_PER_MIN (30) cap — handler should 429.
            return webhooks_mod.TV_RATE_LIMIT_PER_MIN + 1

        async def expire(self, key: str, ttl: int) -> bool:
            return True

    async def _fake_get_redis() -> Any:
        return _SpammedRedis()

    monkeypatch.setattr(webhooks_mod, "get_redis", _fake_get_redis)

    request = _make_request()

    with pytest.raises(HTTPException) as exc_info:
        await webhooks_mod.receive_tradingview_webhook(
            request=request,
            x_tv_secret="anything",
            x_tv_timestamp="1700000000",
        )

    assert exc_info.value.status_code == 429
