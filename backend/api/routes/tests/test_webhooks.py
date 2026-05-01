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


# --------------------------------------------------------------------------- #
# Wave 6γ — HMAC-over-timestamp+body signature coverage (persona 123 P1).   #
# --------------------------------------------------------------------------- #
# Static-secret compare was vulnerable to replay of a captured payload with
# a fresh timestamp (the body itself was unsigned). The signature scheme
# binds secret + timestamp + body together; an attacker without the secret
# cannot forge a signature for any new body regardless of the timestamp
# window. These tests drive the route handler through both the preferred
# signature path and the deprecated legacy-secret fallback.


def _healthy_redis_monkeypatch(monkeypatch: pytest.MonkeyPatch) -> None:
    """Wire a healthy Redis mock so the rate-limit path returns count=1."""
    from api.routes import webhooks as webhooks_mod

    class _HealthyRedis:
        def __init__(self) -> None:
            self._values: dict[str, str] = {}

        async def incr(self, key: str) -> int:
            return 1

        async def expire(self, key: str, ttl: int) -> bool:
            return True

        async def set(
            self,
            key: str,
            value: str,
            ex: int | None = None,
            nx: bool = False,
        ) -> bool:
            if nx and key in self._values:
                return False
            self._values[key] = value
            return True

        async def get(self, key: str) -> str | None:
            return self._values.get(key)

    redis = _HealthyRedis()

    async def _fake_get_redis() -> Any:
        return redis

    monkeypatch.setattr(webhooks_mod, "get_redis", _fake_get_redis)


def _request_with_body(body_bytes: bytes, client_ip: str = "198.51.100.7") -> Any:
    client = MagicMock()
    client.host = client_ip

    request = MagicMock()
    request.client = client

    async def _body() -> bytes:
        return body_bytes

    async def _json() -> Any:  # pragma: no cover — handler uses body() + json.loads
        import json as _json_mod
        return _json_mod.loads(body_bytes.decode("utf-8") or "{}")

    request.body = _body
    request.json = _json
    return request


@pytest.mark.asyncio
async def test_signature_success_accepts_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Correct HMAC over timestamp+body authenticates the caller.

    This is the preferred authentication path. An attacker who captured a
    legitimate payload cannot reuse its signature with a different body
    because the body is part of the signed message.
    """
    import hashlib
    import hmac
    import time

    from api.routes import webhooks as webhooks_mod
    from core.config import settings as _settings

    _healthy_redis_monkeypatch(monkeypatch)
    monkeypatch.setattr(
        _settings.TRADINGVIEW_WEBHOOK_SECRET,
        "get_secret_value",
        lambda: "test-secret-123",
    )
    # Stub out the downstream actions — we only care the handler reaches them
    # after authenticating. ``publish`` is async, so swap it for a no-op.
    async def _noop_publish(*a: Any, **kw: Any) -> None:
        return None

    monkeypatch.setattr(webhooks_mod, "publish", _noop_publish)

    async def _handle_info(alert: Any) -> dict[str, Any]:
        return {"action": "notification_sent", "ticker": alert.ticker}

    monkeypatch.setattr(webhooks_mod, "_handle_info_alert", _handle_info)

    ts = str(int(time.time()))
    body = b'{"ticker":"SPY","action":"alert","message":"test"}'
    signed = f"{ts}:{body.decode()}".encode()
    sig = hmac.new(b"test-secret-123", signed, hashlib.sha256).hexdigest()

    request = _request_with_body(body)
    resp = await webhooks_mod.receive_tradingview_webhook(
        request=request,
        x_tv_secret=None,
        x_tv_timestamp=ts,
        x_tv_signature=sig,
    )
    assert resp.status == "processed"


@pytest.mark.asyncio
async def test_signature_mismatch_rejected_403(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bad signature yields 403 — not 500, and not silently passed.

    Regression guard for a tampered body or a signature computed with the
    wrong key.
    """
    import time

    from api.routes import webhooks as webhooks_mod
    from core.config import settings as _settings

    _healthy_redis_monkeypatch(monkeypatch)
    monkeypatch.setattr(
        _settings.TRADINGVIEW_WEBHOOK_SECRET,
        "get_secret_value",
        lambda: "real-secret",
    )

    ts = str(int(time.time()))
    body = b'{"ticker":"SPY","action":"alert"}'
    request = _request_with_body(body)

    with pytest.raises(HTTPException) as exc_info:
        await webhooks_mod.receive_tradingview_webhook(
            request=request,
            x_tv_secret=None,
            x_tv_timestamp=ts,
            x_tv_signature="deadbeef" * 8,  # wrong sig, right length
        )

    assert exc_info.value.status_code == 403
    assert "signature" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_replay_attack_with_different_body_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Signature bound to body A must NOT authenticate body B.

    This is the core property the signature scheme buys us versus the
    static-secret compare. An attacker who captures a legitimate
    ``{action:alert}`` payload must not be able to swap in
    ``{action:buy, ticker:XYZ}`` and have it execute.
    """
    import hashlib
    import hmac
    import time

    from api.routes import webhooks as webhooks_mod
    from core.config import settings as _settings

    _healthy_redis_monkeypatch(monkeypatch)
    monkeypatch.setattr(
        _settings.TRADINGVIEW_WEBHOOK_SECRET,
        "get_secret_value",
        lambda: "shared-secret",
    )

    ts = str(int(time.time()))
    legit_body = b'{"ticker":"SPY","action":"alert"}'
    attack_body = b'{"ticker":"XYZ","action":"buy","price":1}'
    # Signature is over the LEGITIMATE body.
    signed = f"{ts}:{legit_body.decode()}".encode()
    sig = hmac.new(b"shared-secret", signed, hashlib.sha256).hexdigest()

    # Attacker forwards the signature with a DIFFERENT body, same timestamp.
    request = _request_with_body(attack_body)

    with pytest.raises(HTTPException) as exc_info:
        await webhooks_mod.receive_tradingview_webhook(
            request=request,
            x_tv_secret=None,
            x_tv_timestamp=ts,
            x_tv_signature=sig,
        )

    assert exc_info.value.status_code == 403, (
        "SECURITY: replaying a captured signature against a different body "
        "must be rejected. The signature binds the body; swapping the body "
        "invalidates the HMAC."
    )


@pytest.mark.asyncio
async def test_exact_signed_payload_replay_is_idempotently_ignored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The same authenticated payload inside the freshness window runs once.

    Timestamp freshness only rejects stale captures; without an exact replay
    cache, an attacker who captures a valid signed request can replay it
    immediately and trigger duplicate webhook side effects.
    """
    import hashlib
    import hmac
    import time

    from api.routes import webhooks as webhooks_mod
    from core.config import settings as _settings

    _healthy_redis_monkeypatch(monkeypatch)
    monkeypatch.setattr(
        _settings.TRADINGVIEW_WEBHOOK_SECRET,
        "get_secret_value",
        lambda: "replay-secret",
    )

    calls: dict[str, int] = {"handler": 0, "publish": 0}

    async def _handle_info(alert: Any) -> dict[str, Any]:
        calls["handler"] += 1
        return {"action": "notification_sent", "ticker": alert.ticker}

    async def _publish(*_args: Any, **_kwargs: Any) -> None:
        calls["publish"] += 1

    monkeypatch.setattr(webhooks_mod, "_handle_info_alert", _handle_info)
    monkeypatch.setattr(webhooks_mod, "publish", _publish)

    ts = str(int(time.time()))
    body = b'{"ticker":"SPY","action":"alert","message":"dedupe"}'
    signed = f"{ts}:{body.decode()}".encode()
    sig = hmac.new(b"replay-secret", signed, hashlib.sha256).hexdigest()

    first = await webhooks_mod.receive_tradingview_webhook(
        request=_request_with_body(body),
        x_tv_secret=None,
        x_tv_timestamp=ts,
        x_tv_signature=sig,
    )
    second = await webhooks_mod.receive_tradingview_webhook(
        request=_request_with_body(body),
        x_tv_secret=None,
        x_tv_timestamp=ts,
        x_tv_signature=sig,
    )

    assert first.status == "processed"
    assert second.status == "duplicate"
    assert second.alert_id == first.alert_id
    assert second.actions == [{"action": "duplicate_ignored", "ticker": "SPY"}]
    assert calls == {"handler": 1, "publish": 1}


@pytest.mark.asyncio
async def test_replay_dedupe_redis_error_returns_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Replay protection state is security-critical, so Redis errors fail closed."""
    import hashlib
    import hmac
    import time

    from api.routes import webhooks as webhooks_mod
    from core.config import settings as _settings

    class _ReplayBrokenRedis:
        async def incr(self, key: str) -> int:
            return 1

        async def expire(self, key: str, ttl: int) -> bool:
            return True

        async def set(
            self,
            key: str,
            value: str,
            ex: int | None = None,
            nx: bool = False,
        ) -> bool:
            raise RuntimeError("replay cache unavailable")

    async def _fake_get_redis() -> Any:
        return _ReplayBrokenRedis()

    monkeypatch.setattr(webhooks_mod, "get_redis", _fake_get_redis)
    monkeypatch.setattr(
        _settings.TRADINGVIEW_WEBHOOK_SECRET,
        "get_secret_value",
        lambda: "replay-secret",
    )

    async def _must_not_run(alert: Any) -> dict[str, Any]:
        raise AssertionError("handler must not run when replay protection fails")

    monkeypatch.setattr(webhooks_mod, "_handle_info_alert", _must_not_run)

    ts = str(int(time.time()))
    body = b'{"ticker":"SPY","action":"alert","message":"dedupe"}'
    signed = f"{ts}:{body.decode()}".encode()
    sig = hmac.new(b"replay-secret", signed, hashlib.sha256).hexdigest()

    with pytest.raises(HTTPException) as exc_info:
        await webhooks_mod.receive_tradingview_webhook(
            request=_request_with_body(body),
            x_tv_secret=None,
            x_tv_timestamp=ts,
            x_tv_signature=sig,
        )

    assert exc_info.value.status_code == 503
    assert "Replay protection unavailable" in exc_info.value.detail


@pytest.mark.asyncio
async def test_missing_signature_and_secret_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No signature AND no legacy secret → 403.

    The handler must not fall through to order-handling paths when the
    caller supplied neither authentication mechanism.
    """
    import time

    from api.routes import webhooks as webhooks_mod
    from core.config import settings as _settings

    _healthy_redis_monkeypatch(monkeypatch)
    monkeypatch.setattr(
        _settings.TRADINGVIEW_WEBHOOK_SECRET,
        "get_secret_value",
        lambda: "real-secret",
    )

    ts = str(int(time.time()))
    body = b'{"ticker":"SPY","action":"alert"}'
    request = _request_with_body(body)

    with pytest.raises(HTTPException) as exc_info:
        await webhooks_mod.receive_tradingview_webhook(
            request=request,
            x_tv_secret=None,
            x_tv_timestamp=ts,
            x_tv_signature=None,
        )

    assert exc_info.value.status_code == 403
