"""Regression tests for audit 2026-05-11 fix-loop work.

Each test maps to a single BUG-NNN from
``.audit/2026-05-11/BUGS.md`` so a future regression points straight
back at the audit row that defined the contract. Tests focus on the
behaviors that, if reverted, would re-open the originally-found bug.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import fakeredis.aioredis
import pytest
from fastapi.testclient import TestClient

from main import app

# Auth override is installed by conftest.py's session-scoped autouse fixture.
client = TestClient(app)


@pytest.fixture(autouse=True)
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Provide Redis for idempotency middleware in tests that POST orders."""
    import core.redis as redis_mod

    instance = fakeredis.aioredis.FakeRedis(decode_responses=True)

    async def _fake_get_redis() -> Any:
        return instance

    monkeypatch.setattr(redis_mod, "get_redis", _fake_get_redis)
    return instance


# ─── BUG-058 ─────────────────────────────────────────────────────────
# `_require_matching_order_review` used to skip the review check when
# the client omitted `route_intent`. M4 demonstrated by firing a raw
# `POST /api/v1/trades/orders {"symbol": "SPY", "side": "buy", "qty": 1,
# "order_type": "market"}` and getting a live broker fill — no preview,
# no idempotency, no max-loss gate. The newer submit flow also requires
# `confirm=true` after preview; these tests set confirm explicitly so
# they pin the preview-review token gate rather than the earlier confirm gate.


def test_bug_058_post_orders_without_review_id_returns_428():
    """Confirmed POST must still reject (428) when no review_id is present."""
    r = client.post(
        "/api/v1/trades/orders",
        headers={"Idempotency-Key": "bug-058-missing-review"},
        json={
            # Minimal payload that would have slipped past the prior
            # model_fields_set bypass (no route_intent).
            "legs": [{"symbol": "SPY", "side": "buy", "qty": 1, "order_type": "market"}],
            "confirm": True,
            "mode": "paper",
        },
    )
    assert r.status_code == 428, f"expected 428 (Precondition Required), got {r.status_code}: {r.text[:300]}"
    body = r.json()
    detail = body.get("detail", {})
    assert isinstance(detail, dict), f"detail must be the structured error dict, got {detail!r}"
    assert detail.get("error") == "order_review_required", f"error code mismatch: {detail!r}"


def test_bug_058_review_id_field_explicitly_named_in_error_reason():
    """The 428 reason should name the two-step flow so callers know what to do."""
    r = client.post(
        "/api/v1/trades/orders",
        headers={"Idempotency-Key": "bug-058-review-reason"},
        json={
            "legs": [{"symbol": "SPY", "side": "buy", "qty": 1, "order_type": "market"}],
            "confirm": True,
            "mode": "paper",
        },
    )
    assert r.status_code == 428
    reason = (r.json().get("detail") or {}).get("reason", "")
    # The reason wording matters — the user-facing toast quotes it.
    # Stable substring so we catch silent rewording that drops the
    # "preview first" affordance.
    assert "preview" in reason.lower(), f"reason missing 'preview' guidance: {reason!r}"


# ─── BUG-064 ─────────────────────────────────────────────────────────
# `core.logging.redact_secrets` scrubs API keys + bearer tokens before
# the formatter emits the JSON record. Polygon + FMP keys had been
# leaking 300+ times in a 32-minute audit window via httpx URL logging.


def test_bug_064_redact_polygon_apikey_in_url():
    from core.logging import redact_secrets

    url = "https://api.polygon.io/v2/aggs/ticker/SPY?apiKey=tEOIGlik0K6EIEgYWHW3hDLTs8CYnfF9"
    out = redact_secrets(url)
    assert "tEOIGlik" not in out, "polygon key leaked through redactor"
    assert "apiKey=<REDACTED>" in out


def test_bug_064_redact_fmp_apikey_in_url():
    from core.logging import redact_secrets

    url = "https://financialmodelingprep.com/api/v3/quote/AAPL?apikey=UaSJgprABCDEFGHIJK"
    out = redact_secrets(url)
    assert "UaSJgpr" not in out, "FMP key leaked through redactor"
    assert "apikey=<REDACTED>" in out


def test_bug_064_redact_bearer_token():
    from core.logging import redact_secrets

    msg = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig"
    out = redact_secrets(msg)
    assert "eyJhbG" not in out, "bearer token leaked through redactor"
    assert "Bearer <REDACTED>" in out


# ─── BUG-077 ─────────────────────────────────────────────────────────
# CSRF Origin middleware: state-changing /api/v1/* requests with a
# disallowed Origin header get 403. Requests WITHOUT an Origin header
# (curl, server-to-server) pass through. Webhooks + csp-report
# endpoints are exempt.


def test_bug_077_post_with_disallowed_origin_is_rejected():
    """POST with Origin: https://evil.example must 403."""
    r = client.post(
        "/api/v1/trades/orders",
        headers={"Origin": "https://evil.example"},
        json={"legs": [{"symbol": "SPY", "side": "buy", "qty": 1, "order_type": "market"}]},
    )
    assert r.status_code == 403, f"expected 403, got {r.status_code}"
    assert "Origin" in r.text


def test_bug_077_post_without_origin_passes_csrf_check():
    """POST without Origin header is server-to-server; CSRF middleware
    passes it through. The request will still 4xx for other reasons
    (auth, missing review_id) but NOT for the CSRF reason."""
    r = client.post(
        "/api/v1/trades/orders",
        json={"legs": [{"symbol": "SPY", "side": "buy", "qty": 1, "order_type": "market"}]},
    )
    # 428 = order_review_required (BUG-058 check fires after CSRF passes).
    # 401 = auth gate. Either is acceptable; the point is NOT 403.
    assert r.status_code != 403, f"CSRF middleware incorrectly rejected an Origin-less request: {r.text[:300]}"


def test_bug_077_webhook_path_exempt_from_csrf():
    """`/api/v1/webhooks/*` endpoints exempt — third-party callers
    don't share our Origin profile."""
    r = client.post(
        "/api/v1/webhooks/test",
        headers={"Origin": "https://alpaca.markets"},
        json={"event": "test"},
    )
    # The webhooks router may 404/422 the body, but it should NOT 403
    # on the Origin-mismatch path.
    assert r.status_code != 403, (
        f"webhook path incorrectly hit the CSRF rejection: {r.text[:300]}"
    )


# ─── BUG-093 ─────────────────────────────────────────────────────────
# CLIENT_IP context var was added so the wash_trade audit emitter (and
# any other audit writer without a Request in scope) can stamp the
# originating IP. Verify the contextvar is wired and settable.


def test_bug_093_client_ip_contextvar_exists():
    from core.logging import CLIENT_IP

    # Default is None — set by the request-id middleware on every
    # inbound request. Outside a request, defaults to None.
    assert CLIENT_IP.get() is None or isinstance(CLIENT_IP.get(), str)


def test_bug_093_client_ip_roundtrip():
    """The contextvar must be settable and resettable so the
    middleware's `set` + `reset(token)` pattern works."""
    from core.logging import CLIENT_IP

    token = CLIENT_IP.set("203.0.113.42")
    try:
        assert CLIENT_IP.get() == "203.0.113.42"
    finally:
        CLIENT_IP.reset(token)
    # After reset, default returns.
    assert CLIENT_IP.get() is None


# ─── BUG-090 ─────────────────────────────────────────────────────────
# `verify_password` now truncates plaintext to 72 bytes before bcrypt
# sees it — closing the ValueError class that had been leaking a stack
# trace at WARN.


def test_bug_090_verify_long_password_does_not_raise():
    """100-byte plaintext must not raise; should return False on
    a hash that was minted from a different (legal-length) password."""
    from core.auth import verify_password, hash_password

    long_plain = "a" * 100  # > 72 bytes
    # Hash a short password; verify the long one against it. We don't
    # care about the result — only that no exception escapes.
    hashed = hash_password("realpw")
    result = verify_password(long_plain, hashed)
    assert result is False  # different inputs, no match


def test_bug_090_round_trip_long_password():
    """Hashing then verifying the SAME long plaintext must round-trip
    True under the 72-byte truncation contract."""
    from core.auth import verify_password, hash_password

    plain = "x" * 100
    hashed = hash_password(plain)
    assert verify_password(plain, hashed) is True
