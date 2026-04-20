"""Integration test for the HTTP ``POST /trades/orders`` live-gate path.

Wave 2F / persona-78 gap #1: the previous test module
``test_trades_live_gate.py`` only covered ``_reject_if_live_forbidden`` as a
pure unit. There was no test that drove the full FastAPI TestClient →
``/trades/orders`` → ``_submit_to_broker`` path and asserted that the 422
surfaced to the HTTP boundary with the correct body. This test closes that
gap by mounting the trades router on a minimal FastAPI app, monkeypatching
``_submit_to_broker`` (so no network / broker is involved), forcing the
live + env-flag both to ``True`` via ``core.trading_gate``'s hook points,
and POSTing an ``orb`` order through the actual route handler.

The expected outcome is a 422 whose ``detail`` references the denylist.
If ``_submit_to_broker`` is ever called in this test (the probe flag),
the live-gate has been silently bypassed — the test fails loudly.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def live_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin both gate inputs so the deny-list actually evaluates.

    Mirrors the ``force_live_alpaca`` fixture in ``test_trades_live_gate.py``
    but scoped to the integration test's imports. We patch the symbols
    ``core.trading_gate`` resolves lazily (``is_live_alpaca_base_url`` and
    ``settings.LIVE_TRADING_ENABLED``) so the centralized gate treats the
    environment as armed for live trading.
    """
    from core import config as core_config

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)
    # Provide broker keys so ``_alpaca_keys_empty`` does not short-circuit
    # with 503 before the gate is reached — the 422 must come from the
    # gate, not from a missing-key check.
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


@pytest.fixture
def app_with_trades(
    monkeypatch: pytest.MonkeyPatch,
    live_env: None,
) -> tuple[FastAPI, dict[str, bool]]:
    """Mount the real ``trades`` router on a minimal FastAPI app.

    Returns the app plus a ``probes`` dict the test can inspect:

    * ``probes["broker_called"]`` — True if ``_submit_to_broker`` was
      reached. Must be False on a gated 422 — a True value means the gate
      silently bypassed and the test has caught a regression.
    * ``probes["dup_called"]`` / ``probes["halt_called"]`` — similar
      wrapper probes around cheaper checks so the test can assert the
      gate ran BEFORE them (the gate must fail-fast).
    """
    from api.routes import trades as trades_mod

    probes: dict[str, bool] = {
        "broker_called": False,
        "dup_called": False,
        "halt_called": False,
        "agg_called": False,
        "per_called": False,
    }

    async def _fake_submit(*args, **kwargs):
        probes["broker_called"] = True
        return "fake-order-id"

    async def _fake_is_halted():
        probes["halt_called"] = True
        return False

    async def _fake_dup(payload):
        probes["dup_called"] = True
        return None

    async def _fake_agg(payload, username=None):
        probes["agg_called"] = True
        return True, "ok"

    async def _fake_per(payload):
        probes["per_called"] = True
        return True, "ok"

    monkeypatch.setattr(trades_mod, "_submit_to_broker", _fake_submit)
    monkeypatch.setattr(trades_mod, "_is_trading_halted", _fake_is_halted)
    monkeypatch.setattr(trades_mod, "_check_duplicate_order", _fake_dup)
    monkeypatch.setattr(trades_mod, "_aggregate_risk_check", _fake_agg)
    monkeypatch.setattr(trades_mod, "_risk_check", _fake_per)

    # Also skip DB persistence and the final Redis ``publish`` — neither
    # is relevant to the gate semantics and both try to open real sockets
    # in this test harness. ``SKIP_DB_INIT`` short-circuits the DB insert
    # block; ``core.redis.publish`` is replaced with a no-op so the
    # happy-path 201 doesn't fail on a missing Redis.
    from core import config as core_config

    monkeypatch.setattr(core_config.settings, "SKIP_DB_INIT", True, raising=False)

    import core.redis as _redis_mod

    async def _fake_publish(channel, data):
        return 0

    monkeypatch.setattr(_redis_mod, "publish", _fake_publish)
    # ``trades`` imports ``publish`` into its own namespace lazily; patch
    # the already-imported copy too if it's there.
    if hasattr(trades_mod, "publish"):
        monkeypatch.setattr(trades_mod, "publish", _fake_publish)

    # Bypass ``require_auth`` so the integration test doesn't need JWT
    # machinery. We override the dependency at the app level — FastAPI's
    # ``dependency_overrides`` swaps the callable while routing is
    # happening, so the router itself is untouched.
    from core.auth import require_auth

    async def _fake_user() -> str:
        return "test_user"

    app = FastAPI()
    app.include_router(trades_mod.router, prefix="/api/v1/trades")
    app.dependency_overrides[require_auth] = _fake_user
    return app, probes


def _valid_orb_order_payload() -> dict:
    """Minimal ``CreateOrderRequest`` body with ``strategy=orb``.

    ``orb`` is on ``STRATEGY_LIVE_DISABLED`` in ``core.config``; the gate
    MUST refuse this exact payload with 422 when the environment is live.
    """
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
        "strategy": "orb",
        "notes": "integration test",
    }


def test_post_orders_orb_on_live_returns_422_without_reaching_broker(
    app_with_trades: tuple[FastAPI, dict[str, bool]],
) -> None:
    """The Wave A fix: on a live config the ORB gate fires at the HTTP layer.

    Asserts the full ``POST /api/v1/trades/orders`` → route handler →
    ``_reject_if_live_forbidden`` → ``HTTPException(422)`` path:

    1. Response status is 422 (NOT 500 / 403 / 201).
    2. Response detail mentions ``denylist`` so the operator sees WHY.
    3. ``_submit_to_broker`` was never called — the order never reached
       Alpaca. This is the assertion that catches a silent bypass.
    """
    app, probes = app_with_trades
    client = TestClient(app)

    resp = client.post(
        "/api/v1/trades/orders",
        json=_valid_orb_order_payload(),
    )

    assert resp.status_code == 422, f"expected 422 but got {resp.status_code}: {resp.text}"
    assert "denylist" in (resp.json().get("detail") or "")
    assert probes["broker_called"] is False, (
        "SECURITY: _submit_to_broker was reached despite the ORB live-gate — "
        "gate has silently bypassed."
    )


def test_post_orders_orb_gate_runs_before_risk_and_dedup(
    app_with_trades: tuple[FastAPI, dict[str, bool]],
) -> None:
    """The gate must short-circuit BEFORE the aggregate risk / dedup checks.

    Rationale: risk + dedup checks hit Redis + the DB. If the gate ran
    AFTER them, a denylisted strategy on a cold Redis would still cost a
    round-trip per rejected order. The fail-fast ordering in
    ``trades.create_order`` is contract. Assert it here so a refactor
    that moves the gate below risk fails loudly.

    The gate itself raises before any of the ``dup/agg/per`` wrappers
    were reached, so all four probe flags stay False.
    """
    app, probes = app_with_trades
    client = TestClient(app)

    resp = client.post(
        "/api/v1/trades/orders",
        json=_valid_orb_order_payload(),
    )
    assert resp.status_code == 422
    # Gate runs BEFORE: aggregate risk, per-order risk, dedup, broker POST.
    assert probes["agg_called"] is False
    assert probes["per_called"] is False
    assert probes["dup_called"] is False
    assert probes["broker_called"] is False


def test_post_orders_unknown_strategy_on_live_returns_400(
    app_with_trades: tuple[FastAPI, dict[str, bool]],
) -> None:
    """Spoofed strategy names are 400, not 422 or 201.

    ``orbx`` is not on the allowlist — the gate must refuse with 400
    (unknown strategy) rather than 422 (denylisted). The distinct error
    code matters: 422 would confirm to an attacker that ``orb`` in
    particular is blocked, giving them enumeration signal. 400 treats
    the request as malformed.
    """
    app, probes = app_with_trades
    client = TestClient(app)

    payload = _valid_orb_order_payload()
    payload["strategy"] = "orbx"  # spoof — not on the allowlist.

    resp = client.post("/api/v1/trades/orders", json=payload)
    assert resp.status_code == 400
    assert "unknown strategy" in (resp.json().get("detail") or "")
    assert probes["broker_called"] is False


def test_post_orders_manual_none_strategy_passes_gate(
    app_with_trades: tuple[FastAPI, dict[str, bool]],
) -> None:
    """Manual orders (strategy=None) pass the gate even when live is armed.

    The gate has an intentional pass-through for manual / discretionary
    orders — they're the operator's deliberate action and not the
    automated strategy path the deny-list governs. Mocked risk checks
    return True, so the request should make it all the way to
    ``_submit_to_broker`` and return 201.
    """
    app, probes = app_with_trades
    client = TestClient(app)

    payload = _valid_orb_order_payload()
    payload.pop("strategy")  # manual / discretionary

    resp = client.post("/api/v1/trades/orders", json=payload)
    # The manual path hits the broker mock and returns 201 with the fake id.
    assert resp.status_code == 201, f"expected 201 but got {resp.status_code}: {resp.text}"
    assert probes["broker_called"] is True
