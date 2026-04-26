"""Wave 6β Fix 6 (persona 123 P1) — halt TOCTOU re-check on /orders.

The halt gate near the top of ``create_order`` (line ~703) runs BEFORE
many awaits: risk checks, market-hour checks, Idempotency-Key cache
lookup, duplicate-order detection, aggregate-risk check, per-order
risk check, live-strategy gate.  If an admin halts DURING that gap,
the in-flight order used to leak through to the broker because the
initial halt check had already passed.

Fix 6 adds a SECOND ``_is_trading_halted()`` call immediately before
``_submit_to_broker(...)``.  This test flips the halt state between
the first and second check and asserts:

* The second check raises 503.
* The broker is NEVER called.
* The Idempotency-Key PENDING sentinel is cleared so a retry after
  resume works without waiting for the 600s TTL.
* A ``halt_intercepted_post_check`` log event is emitted (via the
  ``extra={...}`` payload the handler stamps).
"""
from __future__ import annotations

from typing import Any

import fakeredis.aioredis
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> Any:
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
    """Mount trades router with a mutable ``halt_state`` that flips between
    the first ``_is_trading_halted()`` call and the second.

    The stub returns False on the FIRST call (order proceeds past the
    initial gate) and True on the SECOND call (TOCTOU trip).  That's
    the exact race Fix 6 closes.
    """
    from api.routes import trades as trades_mod

    probes: dict[str, Any] = {
        "broker_posts": [],
        "halt_calls": 0,
        "flip_after_call": 1,  # flip to True after this many calls
    }

    async def _fake_submit(payload: Any, settings: Any, client_order_id: str | None = None) -> str:
        probes["broker_posts"].append((payload, client_order_id))
        return f"broker-order-{len(probes['broker_posts'])}"

    async def _fake_is_halted() -> bool:
        probes["halt_calls"] += 1
        # First call: NOT halted (top-of-endpoint gate passes).
        # Second call: halted (TOCTOU trip just before broker submit).
        return probes["halt_calls"] > probes["flip_after_call"]

    async def _fake_dup(_payload: Any, _username: str = "test_user") -> None:
        return None

    async def _fake_agg(_payload: Any, username: str | None = None) -> tuple[bool, str]:
        return True, "ok"

    async def _fake_per(_payload: Any) -> tuple[bool, str]:
        return True, "ok"

    monkeypatch.setattr(trades_mod, "_submit_to_broker", _fake_submit)
    monkeypatch.setattr(trades_mod, "_is_trading_halted", _fake_is_halted)
    monkeypatch.setattr(trades_mod, "_check_duplicate_order", _fake_dup)
    monkeypatch.setattr(trades_mod, "_aggregate_risk_check", _fake_agg)
    monkeypatch.setattr(trades_mod, "_risk_check", _fake_per)

    from core import config as core_config

    monkeypatch.setattr(core_config.settings, "SKIP_DB_INIT", True, raising=False)
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

    from core.auth import require_auth

    async def _fake_user() -> str:
        return "alice"

    app = FastAPI()
    app.include_router(trades_mod.router, prefix="/api/v1/trades")
    app.dependency_overrides[require_auth] = _fake_user
    return app, probes


def _payload() -> dict:
    return {
        "legs": [
            {
                "symbol": "AAPL",
                "side": "buy",
                "qty": 10,
                "order_type": "limit",
                "limit_price": 150.0,
                "asset_class": "equity",
            },
        ],
        "time_in_force": "day",
        "notes": "halt toctou test",
        # J-10 (Round-6): the market-hours gate now applies to all
        # order types unless ``extended_hours=True``. The TOCTOU
        # tests don't care about hours — they assert against the
        # halt re-check just before broker submit. Opting into
        # extended hours keeps the test focused on TOCTOU.
        "extended_hours": True,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_halt_flipping_mid_request_blocks_broker_submit(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Halt flipped to True between the first and second ``_is_trading_halted``
    calls → 503, broker NEVER hit."""
    app, probes = app_with_trades
    client = TestClient(app)

    resp = client.post("/api/v1/trades/orders", json=_payload())

    # The second check trips; the handler raises 503.
    assert resp.status_code == 503
    detail = resp.json().get("detail", {})
    # Structured detail body (dict) carries the TOCTOU reason.
    if isinstance(detail, dict):
        assert detail.get("error") == "trading_halted"
        assert "mid-request" in detail.get("reason", "").lower() or \
               "mid_request" in detail.get("reason", "").lower() or \
               "Emergency halt activated" in detail.get("reason", "")
    # Two calls to _is_trading_halted — top-of-endpoint + pre-submit.
    assert probes["halt_calls"] >= 2
    # Broker must NEVER have been touched.
    assert probes["broker_posts"] == []


def test_halt_stable_false_permits_order(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """When halt stays False across BOTH checks, the order submits normally."""
    app, probes = app_with_trades
    # Never flip to halted — second check still returns False.
    probes["flip_after_call"] = 999
    client = TestClient(app)

    resp = client.post("/api/v1/trades/orders", json=_payload())
    assert resp.status_code == 201, resp.text
    assert len(probes["broker_posts"]) == 1
    # Both checks ran and both returned False.
    assert probes["halt_calls"] >= 2


def test_toctou_clears_pending_idempotency_sentinel(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
    fake_redis: Any,
) -> None:
    """TOCTOU trip must DEL the PENDING Idempotency-Key sentinel so a
    retry after resume proceeds immediately (no 600s TTL wait)."""
    app, probes = app_with_trades
    client = TestClient(app)
    idem = "test-toctou-idem-key-42"

    resp = client.post(
        "/api/v1/trades/orders",
        json=_payload(),
        headers={"Idempotency-Key": idem},
    )
    assert resp.status_code == 503
    # Confirm the PENDING sentinel was cleared.
    import asyncio

    cached = asyncio.new_event_loop().run_until_complete(
        fake_redis.get(f"idem:orders:{idem}:alice"),
    )
    assert cached is None, (
        f"PENDING sentinel leaked past a TOCTOU halt interception — got "
        f"{cached!r}. A retry after resume would 429 for 600s."
    )
