"""Idempotency-Key dedup semantics for ``POST /api/v1/trades/orders``.

Wave 2F / persona-78 gap #6: ~40 code references to ``Idempotency-Key``
across ``backend/api/routes/trades.py`` but ZERO tests exercising the
round-trip. This module closes that gap.

Scope (matches the Wave-A race-safe ordering in ``create_order``):

* Duplicate key within the 10-minute TTL returns the cached 200 verbatim.
* Two concurrent requests with the same key: the first claims the
  PENDING sentinel (SET NX), the second sees PENDING and gets a 409.
* Idempotency-Key longer than 128 chars is rejected at the edge with 400.
* When the broker POST errors, the PENDING sentinel is cleared so a
  retry with the same key can proceed (NOT cached as an error response).
* The idempotency key short-slug is forwarded into Alpaca's
  ``client_order_id`` (broker-side dedup layer; Alpaca refuses duplicates
  within 24h).

Implementation notes:

* ``fakeredis`` gives us a real Redis protocol without a sidecar — the
  ``set(..., nx=True, ex=600)`` semantics are exact.
* ``_submit_to_broker`` is monkeypatched so the tests never touch
  ``httpx`` or Alpaca. The probe captures the ``client_order_id``
  argument so we can assert broker-side dedup parity.
* ``require_auth`` is overridden at the app level; JWT is not involved.
"""
from __future__ import annotations

import asyncio
from typing import Any

import fakeredis.aioredis
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# --------------------------------------------------------------------------- #
# Fixtures                                                                    #
# --------------------------------------------------------------------------- #


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Install a fakeredis instance in place of the real Redis client.

    ``core.redis.get_redis`` is the single entry point every helper uses;
    swap it for a thunk that returns the same fakeredis instance each time.
    """
    import core.redis as redis_mod

    instance = fakeredis.aioredis.FakeRedis(decode_responses=True)

    async def _fake_get_redis() -> Any:
        return instance

    monkeypatch.setattr(redis_mod, "get_redis", _fake_get_redis)
    return instance


@pytest.fixture
def app_with_trades(
    monkeypatch: pytest.MonkeyPatch, fake_redis: Any,
) -> tuple[FastAPI, dict[str, Any]]:
    """Mount the trades router with every non-broker side effect stubbed.

    Returns the FastAPI app plus a probes dict the test can read:

    * ``probes["broker_posts"]`` — list of ``(payload, client_order_id)``
      tuples, one per ``_submit_to_broker`` invocation.
    * ``probes["broker_should_fail"]`` — flip to True to make the next
      broker call raise ``HTTPException(502)`` (simulating a broker outage).
    """
    from api.routes import trades as trades_mod

    probes: dict[str, Any] = {
        "broker_posts": [],
        "broker_should_fail": False,
    }

    async def _fake_submit(
        payload: Any,
        settings: Any,
        client_order_id: str | None = None,
        broker_credentials: Any | None = None,
    ) -> str:
        probes["broker_posts"].append((payload, client_order_id))
        if probes["broker_should_fail"]:
            from fastapi import HTTPException

            raise HTTPException(status_code=502, detail="Broker unavailable (test)")
        return f"broker-order-{len(probes['broker_posts'])}"

    async def _fake_is_halted() -> bool:
        return False

    async def _fake_dup(_payload: Any, _username: str = "test_user") -> None:
        return None

    async def _fake_agg(_payload: Any, username: str | None = None) -> tuple[bool, str]:
        return True, "ok"

    async def _fake_per(_payload: Any) -> tuple[bool, str]:
        return True, "ok"

    async def _fake_notional(_payload: Any) -> float:
        return 150.0

    async def _fake_max_loss(
        _payload: Any,
        *,
        username: str,
    ) -> tuple[bool, str, float, float]:
        return True, "passed", 150.0, 100_000.0

    monkeypatch.setattr(trades_mod, "_submit_to_broker", _fake_submit)
    monkeypatch.setattr(trades_mod, "_is_trading_halted", _fake_is_halted)
    monkeypatch.setattr(trades_mod, "_check_duplicate_order", _fake_dup)
    monkeypatch.setattr(trades_mod, "_aggregate_risk_check", _fake_agg)
    monkeypatch.setattr(trades_mod, "_risk_check", _fake_per)
    monkeypatch.setattr(trades_mod, "_compute_order_notional", _fake_notional)
    monkeypatch.setattr(trades_mod, "_max_loss_vs_equity_check", _fake_max_loss)

    # Bypass DB + portfolio websocket fanout.
    from core import config as core_config

    monkeypatch.setattr(core_config.settings, "SKIP_DB_INIT", True, raising=False)
    # ALPACA_BASE_URL defaults to paper — leave it; the idempotency tests
    # must work on paper so the live-gate doesn't short-circuit them.
    monkeypatch.setattr(
        core_config.settings.ALPACA_API_KEY,
        "get_secret_value",
        lambda: "TEST_KEY",
        raising=False,
    )
    monkeypatch.setattr(
        core_config.settings.ALPACA_SECRET_KEY,
        "get_secret_value",
        lambda: "TEST_SECRET",
        raising=False,
    )

    import core.redis as redis_mod

    async def _fake_publish(_channel: str, _data: dict) -> int:
        return 0

    monkeypatch.setattr(redis_mod, "publish", _fake_publish)
    if hasattr(trades_mod, "publish"):
        monkeypatch.setattr(trades_mod, "publish", _fake_publish)

    # Dependency override for auth.
    from core.auth import require_auth

    async def _fake_user() -> str:
        return "alice"

    app = FastAPI()
    app.include_router(trades_mod.router, prefix="/api/v1/trades")
    app.dependency_overrides[require_auth] = _fake_user
    return app, probes


def _payload(symbol: str = "AAPL", qty: int = 10) -> dict:
    """Minimal manual-order payload (no strategy → bypasses the live-gate).

    J-10 (Round-6): opt into ``extended_hours=True`` so the new RTH
    gate doesn't reject these unit tests outside market hours.
    """
    return {
        "legs": [
            {
                "symbol": symbol,
                "side": "buy",
                "qty": qty,
                "order_type": "limit",
                "limit_price": 150.0,
                "asset_class": "equity",
            },
        ],
        "time_in_force": "day",
        "notes": "idempotency test",
        "extended_hours": True,
        "mode": "paper",
    }


def _reviewed_payload(client: TestClient, payload: dict | None = None) -> dict:
    base = payload or _payload()
    preview = client.post("/api/v1/trades/orders/preview", json=base)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["can_submit"] is True
    return {**base, "review_id": body["review_id"], "confirm": True}


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #


def test_duplicate_key_within_window_returns_cached_response(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Retry with the same Idempotency-Key returns the cached response verbatim.

    First call: posts to broker, caches the 201. Second call with the
    same key: cache hit, returns the ORIGINAL order id WITHOUT touching
    the broker. That's the load-bearing invariant — the client should
    not double-submit on a mid-POST disconnect + retry.
    """
    app, probes = app_with_trades
    client = TestClient(app)
    idem = "test-key-alpha-12345"
    payload = _reviewed_payload(client)

    r1 = client.post(
        "/api/v1/trades/orders", json=payload, headers={"Idempotency-Key": idem},
    )
    assert r1.status_code == 201, r1.text
    first_id = r1.json()["id"]
    assert len(probes["broker_posts"]) == 1

    # Retry with the same key. The cached-hit path returns the response
    # via the same route's declared ``status_code=201`` — same shape and
    # same status as the original. The cache-hit invariant is:
    # same response body + broker NOT touched a second time.
    r2 = client.post(
        "/api/v1/trades/orders", json=payload, headers={"Idempotency-Key": idem},
    )
    assert r2.status_code == 201
    assert r2.json()["id"] == first_id
    # Crucially: the broker was not hit a second time.
    assert len(probes["broker_posts"]) == 1


def test_oversize_idempotency_key_returns_400(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Keys longer than 128 chars are rejected at the edge.

    Rationale: an unbounded header value would let a hostile client DOS
    Redis with a multi-megabyte key. 128 chars is generous (uuid4 is 32
    hex) — anything longer is certainly abuse.
    """
    app, probes = app_with_trades
    client = TestClient(app)

    oversize = "x" * 129
    resp = client.post(
        "/api/v1/trades/orders",
        json=_reviewed_payload(client),
        headers={"Idempotency-Key": oversize},
    )
    assert resp.status_code == 400
    assert "128" in resp.json().get("detail", "")
    # Broker was never touched; the check is strictly before submission.
    assert probes["broker_posts"] == []


def test_concurrent_same_key_one_wins_other_gets_409_pending(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
    fake_redis: Any,
) -> None:
    """Two parallel requests with the same key: exactly one reaches the
    broker, the other sees the PENDING sentinel and gets 409.

    Simulating true concurrency inside TestClient is awkward, so we
    simulate the race by pre-planting the PENDING sentinel in Redis
    before the second request hits — mirroring the state the second
    worker would see after the first worker ran ``SET NX = PENDING``
    but BEFORE it wrote the final response. The code path under test
    is: ``GET cache`` sees PENDING → 409.
    """
    app, probes = app_with_trades
    client = TestClient(app)
    idem = "test-key-race-67890"

    # Manually set the PENDING sentinel under the exact cache key shape
    # the route constructs. The username is "alice" per our fake_auth.
    asyncio.new_event_loop().run_until_complete(
        fake_redis.set(f"idem:orders:{idem}:alice", "__PENDING__", ex=600),
    )

    resp = client.post(
        "/api/v1/trades/orders", json=_reviewed_payload(client), headers={"Idempotency-Key": idem},
    )
    assert resp.status_code == 409
    assert "in flight" in resp.json()["detail"].lower()
    # Broker never touched — the route short-circuited on the sentinel.
    assert probes["broker_posts"] == []


def test_broker_error_clears_pending_so_retry_proceeds(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
    fake_redis: Any,
) -> None:
    """A broker error must DEL the PENDING sentinel so retries work.

    Without this cleanup, a transient broker outage would lock the
    caller out of resubmitting with the same key for the full 600s TTL.
    """
    app, probes = app_with_trades
    client = TestClient(app)
    idem = "test-key-broker-err-retry"

    # Force the next broker call to fail.
    probes["broker_should_fail"] = True
    payload = _reviewed_payload(client)
    r1 = client.post(
        "/api/v1/trades/orders", json=payload, headers={"Idempotency-Key": idem},
    )
    assert r1.status_code == 502
    assert len(probes["broker_posts"]) == 1

    # The PENDING sentinel must be gone — retry should proceed.
    cached = asyncio.new_event_loop().run_until_complete(
        fake_redis.get(f"idem:orders:{idem}:alice"),
    )
    assert cached is None, (
        f"PENDING sentinel leaked past a broker error — got {cached!r}. "
        "Subsequent retries with the same key would 409 for 600s."
    )

    # Now let the broker succeed and retry with the same key.
    probes["broker_should_fail"] = False
    r2 = client.post(
        "/api/v1/trades/orders", json=payload, headers={"Idempotency-Key": idem},
    )
    assert r2.status_code == 201, r2.text
    assert len(probes["broker_posts"]) == 2  # retry DID reach the broker.


def test_idempotency_key_forwarded_as_client_order_id_to_alpaca(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """The idempotency-key tail lands in Alpaca's ``client_order_id``.

    Alpaca refuses duplicate ``client_order_id`` within ~24h (their
    broker-side dedup). Forwarding the idempotency key as the
    client_order_id means the broker acts as a belt-and-braces dedup
    layer — even if our Redis is down, Alpaca will still reject the
    double-submit on its own.

    The route uses the LAST 24 chars of the sanitised key (so the
    client_order_id fits under Alpaca's 128-char cap with username +
    separator room to spare). Assert the broker saw an id that embeds
    those tail chars.
    """
    app, probes = app_with_trades
    client = TestClient(app)
    idem = "abcdef1234567890abcdef1234567890abcdef12"  # 40 chars
    expected_tail = idem[-24:]
    payload = _reviewed_payload(client)

    resp = client.post(
        "/api/v1/trades/orders", json=payload, headers={"Idempotency-Key": idem},
    )
    assert resp.status_code == 201, resp.text
    assert len(probes["broker_posts"]) == 1
    _, broker_coid = probes["broker_posts"][0]
    assert broker_coid is not None
    # The username slug is "alice"; the coid format is
    # ``{user}_{idem_tail}`` capped at 128 chars.
    assert broker_coid.startswith("alice_")
    assert expected_tail in broker_coid


def test_submit_requires_confirm_true_after_preview(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    app, probes = app_with_trades
    client = TestClient(app)
    payload = _payload()
    preview = client.post("/api/v1/trades/orders/preview", json=payload)
    assert preview.status_code == 200, preview.text
    resp = client.post(
        "/api/v1/trades/orders",
        json={**payload, "review_id": preview.json()["review_id"]},
        headers={"Idempotency-Key": "confirm-required"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["error"] == "order_confirmation_required"
    assert probes["broker_posts"] == []


def test_submit_requires_explicit_trading_mode(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    app, probes = app_with_trades
    client = TestClient(app)
    payload = _payload()
    payload.pop("mode")
    preview = client.post("/api/v1/trades/orders/preview", json=payload)
    assert preview.status_code == 200, preview.text
    resp = client.post(
        "/api/v1/trades/orders",
        json={**payload, "review_id": preview.json()["review_id"], "confirm": True},
        headers={"Idempotency-Key": "mode-required"},
    )
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["error"] == "trading_mode_required"
    assert probes["broker_posts"] == []


def test_submit_rejects_mode_disagreement(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api.routes import trades as trades_mod

    async def _fake_committed(_username: str) -> tuple[str, None]:
        return "live", None

    monkeypatch.setattr(trades_mod, "_committed_trading_mode", _fake_committed)

    app, probes = app_with_trades
    client = TestClient(app)
    resp = client.post(
        "/api/v1/trades/orders",
        json=_reviewed_payload(client),
        headers={"Idempotency-Key": "mode-disagreement"},
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["error"] == "mode_disagreement"
    assert probes["broker_posts"] == []


def test_live_submit_requires_fresh_step_up(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api.routes import trades as trades_mod

    async def _fake_committed(_username: str) -> tuple[str, None]:
        return "live", None

    monkeypatch.setattr(trades_mod, "_committed_trading_mode", _fake_committed)

    app, probes = app_with_trades
    client = TestClient(app)
    payload = _reviewed_payload(client, {**_payload(), "mode": "live"})
    resp = client.post(
        "/api/v1/trades/orders",
        json=payload,
        headers={"Idempotency-Key": "live-step-up-required"},
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"]["error"] == "live_step_up_required"
    assert probes["broker_posts"] == []


def test_live_submit_with_fresh_step_up_reaches_broker(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from datetime import datetime, timezone
    from api.routes import trades as trades_mod

    async def _fake_committed(_username: str) -> tuple[str, datetime]:
        return "live", datetime.now(timezone.utc)

    monkeypatch.setattr(trades_mod, "_committed_trading_mode", _fake_committed)

    app, probes = app_with_trades
    client = TestClient(app)
    payload = _reviewed_payload(client, {**_payload(), "mode": "live"})
    resp = client.post(
        "/api/v1/trades/orders",
        json=payload,
        headers={"Idempotency-Key": "live-step-up-fresh"},
    )
    assert resp.status_code == 201, resp.text
    assert len(probes["broker_posts"]) == 1


def test_no_idempotency_key_is_rejected_before_broker(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """When no Idempotency-Key is sent, submit fails before broker touch."""
    app, probes = app_with_trades
    client = TestClient(app)

    resp = client.post("/api/v1/trades/orders", json=_reviewed_payload(client))
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"]["error"] == "idempotency_key_required"
    assert probes["broker_posts"] == []
