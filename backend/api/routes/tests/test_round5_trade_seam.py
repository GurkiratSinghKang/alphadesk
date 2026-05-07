"""Round-5 trade-workflow seam tests.

Covers:

* F-1  — `strategy` field round-trips on POST /trades/orders. The
        request payload carries `strategy="earnings-options-play"` and
        the response body must surface that string back so the frontend
        recent-orders strip can render attribution.
* F-14 — multi-leg combo orders forward `combo_type` to the broker risk
        gate and persist alongside the legs. The mock broker probe
        captures the constructed `OrderRequest` so the test can assert
        the combo payload is intact.
* F-7  — alerts accept percent-move conditions + OCC option symbols and
        reject `<script>...` payloads at the regex boundary.
* F-7  — percent-move conditions with `reference=static` require an
        explicit reference_price (422 otherwise).
"""
from __future__ import annotations

from typing import Any

import fakeredis.aioredis
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------#
# Fixtures                                                                    #
# ---------------------------------------------------------------------------#


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Drop-in fakeredis. Same shape as test_idempotency.py."""
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
    """Mount the trades router with broker / DB / publish stubbed out."""
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
        probes["broker_posts"].append({
            "payload": payload,
            "client_order_id": client_order_id,
            "combo_type": payload.combo_type,
            "strategy": payload.strategy,
            "leg_count": len(payload.legs),
        })
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


def _single_leg_payload(strategy: str | None = None) -> dict:
    # J-10 (Round-6): opt into extended_hours so the RTH gate doesn't
    # reject these unit tests outside market hours.
    body: dict[str, Any] = {
        "legs": [
            {
                "symbol": "AAPL",
                "side": "buy",
                "qty": 1,
                "order_type": "limit",
                "limit_price": 150.0,
                "asset_class": "equity",
            },
        ],
        "time_in_force": "day",
        "extended_hours": True,
    }
    if strategy is not None:
        body["strategy"] = strategy
    return body


def _iron_condor_payload(strategy: str | None = "earnings-options-play") -> dict:
    """4-leg iron condor on NVDA — short the body, long the wings."""
    body: dict[str, Any] = {
        "legs": [
            # Short put + long lower wing + short call + long upper wing.
            {
                "symbol": "NVDA260424P00200000", "side": "sell", "qty": 1,
                "order_type": "limit", "limit_price": 1.45,
                "asset_class": "option",
            },
            {
                "symbol": "NVDA260424P00190000", "side": "buy", "qty": 1,
                "order_type": "limit", "limit_price": 0.55,
                "asset_class": "option",
            },
            {
                "symbol": "NVDA260424C00220000", "side": "sell", "qty": 1,
                "order_type": "limit", "limit_price": 1.32,
                "asset_class": "option",
            },
            {
                "symbol": "NVDA260424C00230000", "side": "buy", "qty": 1,
                "order_type": "limit", "limit_price": 0.48,
                "asset_class": "option",
            },
        ],
        "time_in_force": "day",
        "combo_type": "iron_condor",
        "extended_hours": True,
    }
    if strategy is not None:
        body["strategy"] = strategy
    return body


# ---------------------------------------------------------------------------#
# F-1 — strategy round-trips on order POST                                    #
# ---------------------------------------------------------------------------#


def test_order_carries_strategy_field(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """POST with `strategy="earnings-options-play"` → response carries it back.

    This is the single-test contract for F-1: the FE sends the tag with
    the order, the backend persists it on the Trade row, and the
    OrderResponse echoes it so /reports/strategy-performance can
    attribute the position correctly.
    """
    app, probes = app_with_trades
    client = TestClient(app)

    resp = client.post(
        "/api/v1/trades/orders",
        json=_single_leg_payload(strategy="earnings-options-play"),
        headers={"Idempotency-Key": "f1-strategy-roundtrip"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["strategy"] == "earnings-options-play"

    # The broker layer also saw the tag (so the live-gate / risk gate
    # can reason about it).
    assert len(probes["broker_posts"]) == 1
    assert probes["broker_posts"][0]["strategy"] == "earnings-options-play"


def test_order_without_strategy_returns_null_strategy(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """A manual order (no strategy field) round-trips strategy=None — proving
    the field is genuinely optional and we haven't broken legacy callers."""
    app, _probes = app_with_trades
    client = TestClient(app)

    resp = client.post(
        "/api/v1/trades/orders",
        json=_single_leg_payload(strategy=None),
        headers={"Idempotency-Key": "f1-no-strategy"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json().get("strategy") is None


def test_broker_review_preview_mints_submit_token(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Broker-routed orders must submit with the matching server preview."""
    app, probes = app_with_trades
    client = TestClient(app)
    payload = {
        **_single_leg_payload(strategy="earnings-options-play"),
        "route_intent": "broker_order_review",
        "broker_provider": "alpaca",
    }

    preview = client.post("/api/v1/trades/orders/preview", json=payload)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["can_submit"] is True
    assert isinstance(body["review_id"], str)

    resp = client.post(
        "/api/v1/trades/orders",
        json={**payload, "review_id": body["review_id"]},
        headers={"Idempotency-Key": "broker-review-submit"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["broker_provider"] == "alpaca"
    assert len(probes["broker_posts"]) == 1


def test_broker_review_submit_requires_preview_token(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    app, probes = app_with_trades
    client = TestClient(app)

    resp = client.post(
        "/api/v1/trades/orders",
        json={
            **_single_leg_payload(strategy="earnings-options-play"),
            "route_intent": "broker_order_review",
            "broker_provider": "alpaca",
        },
        headers={"Idempotency-Key": "broker-review-missing-token"},
    )
    assert resp.status_code == 428, resp.text
    assert resp.json()["detail"]["error"] == "order_review_required"
    assert probes["broker_posts"] == []


def test_broker_review_submit_rejects_changed_order_after_preview(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    app, probes = app_with_trades
    client = TestClient(app)
    payload = {
        **_single_leg_payload(strategy="earnings-options-play"),
        "route_intent": "broker_order_review",
        "broker_provider": "alpaca",
    }
    preview = client.post("/api/v1/trades/orders/preview", json=payload)
    assert preview.status_code == 200, preview.text
    changed = _single_leg_payload(strategy="earnings-options-play")
    changed["legs"][0]["limit_price"] = 151.0
    changed["route_intent"] = "broker_order_review"
    changed["broker_provider"] = "alpaca"
    changed["review_id"] = preview.json()["review_id"]

    resp = client.post(
        "/api/v1/trades/orders",
        json=changed,
        headers={"Idempotency-Key": "broker-review-changed-order"},
    )
    assert resp.status_code == 428, resp.text
    assert resp.json()["detail"]["error"] == "order_review_mismatch"
    assert probes["broker_posts"] == []


def test_unsupported_broker_provider_rejects_before_broker_submit(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    app, probes = app_with_trades
    client = TestClient(app)
    payload = {
        **_single_leg_payload(strategy="earnings-options-play"),
        "route_intent": "broker_order_review",
        "broker_provider": "robinhood",
    }

    preview = client.post("/api/v1/trades/orders/preview", json=payload)
    assert preview.status_code == 422, preview.text
    assert preview.json()["detail"]["error"] == "unsupported_broker_provider"

    resp = client.post(
        "/api/v1/trades/orders",
        json=payload,
        headers={"Idempotency-Key": "robinhood-provider-gate"},
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["error"] == "unsupported_broker_provider"
    assert probes["broker_posts"] == []


# ---------------------------------------------------------------------------#
# F-14 — combo_type persists end-to-end                                       #
# ---------------------------------------------------------------------------#


def test_multi_leg_order_combo_type_persists(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """4-leg iron condor: combo_type reaches the broker mock + response.

    Without F-14 the broker layer would see 4 independent options and
    apply naked-option risk gates. The response also surfaces the combo
    classification so the frontend can render it on the recent-orders
    strip.
    """
    app, probes = app_with_trades
    client = TestClient(app)

    resp = client.post(
        "/api/v1/trades/orders",
        json=_iron_condor_payload(),
        headers={"Idempotency-Key": "f14-iron-condor"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["combo_type"] == "iron_condor"
    assert len(body["legs"]) == 4
    assert body["strategy"] == "earnings-options-play"

    # Broker call had the combo metadata too.
    assert len(probes["broker_posts"]) == 1
    bp = probes["broker_posts"][0]
    assert bp["combo_type"] == "iron_condor"
    assert bp["leg_count"] == 4
    # All four legs are options on the same underlying (NVDA260424…).
    for leg in bp["payload"].legs:
        assert leg.symbol.startswith("NVDA260424")


# ---------------------------------------------------------------------------#
# F-7 — alerts accept OCC + percent-move + reject XSS                         #
# ---------------------------------------------------------------------------#


def test_alert_rejects_xss_payload_in_symbol(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """`<script>alert(1)</script>` must be rejected at the regex boundary.

    The alternation `(equity|OCC)` cannot match `<` so the value never
    reaches storage. Returns 422 (Pydantic validation error).
    """
    app, _probes = app_with_trades
    client = TestClient(app)

    resp = client.post(
        "/api/v1/trades/alerts",
        json={
            "symbol": "<script>alert(1)</script>",
            "price": 100.0,
            "condition": "above",
        },
    )
    assert resp.status_code == 422


def test_alert_accepts_full_occ_option_contract(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """An OCC contract symbol like `NVDA260424P00200000` is now a valid
    alert symbol so a user can alert when a specific contract crosses a
    price. The alert auto-defaults `expires_at` to the contract's
    expiration date (2026-04-24 ET) so it doesn't fire post-expiry."""
    app, _probes = app_with_trades
    client = TestClient(app)

    resp = client.post(
        "/api/v1/trades/alerts",
        json={
            "symbol": "NVDA260424P00200000",
            "price": 1.50,
            "condition": "above",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["symbol"] == "NVDA260424P00200000"
    # F-8: OCC-tied alert auto-default's expires_at to expiry.
    assert body["expires_at"] is not None
    assert body["expires_at"].startswith("2026-04-24")


def test_alert_percent_move_static_requires_reference_price(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """`reference=static` + condition=percent_move_above without
    reference_price → 422. Without the anchor the trigger could not be
    evaluated, so we reject at create time."""
    app, _probes = app_with_trades
    client = TestClient(app)

    resp = client.post(
        "/api/v1/trades/alerts",
        json={
            "symbol": "NVDA",
            "price": 5.0,
            "condition": "percent_move_above",
            "reference": "static",
        },
    )
    assert resp.status_code == 422


def test_alert_percent_move_with_static_reference_succeeds(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """percent_move_above with reference=static + reference_price=180 →
    201; reference_price round-trips on the saved alert."""
    app, _probes = app_with_trades
    client = TestClient(app)

    resp = client.post(
        "/api/v1/trades/alerts",
        json={
            "symbol": "NVDA",
            "price": 5.0,
            "condition": "percent_move_above",
            "reference": "static",
            "reference_price": 180.0,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["condition"] == "percent_move_above"
    assert float(body["reference_price"]) == pytest.approx(180.0)
    assert body["reference"] == "static"


def test_check_alerts_for_symbol_handles_percent_move(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """End-to-end check_alerts_for_symbol: a `percent_move_above 5%`
    alert vs reference $100 fires when current price >= $105 and stays
    silent at $104.99.
    """
    import asyncio
    from api.routes import trades as trades_mod

    app, _probes = app_with_trades
    client = TestClient(app)

    # Create the alert via the public API.
    create = client.post(
        "/api/v1/trades/alerts",
        json={
            "symbol": "NVDA",
            "price": 5.0,
            "condition": "percent_move_above",
            "reference": "static",
            "reference_price": 100.0,
        },
    )
    assert create.status_code == 201, create.text

    loop = asyncio.new_event_loop()
    try:
        # +4.99% should NOT fire.
        loop.run_until_complete(
            trades_mod.check_alerts_for_symbol("NVDA", 104.99),
        )
        listed = client.get("/api/v1/trades/alerts").json()
        assert all(not a["triggered"] for a in listed if a["symbol"] == "NVDA")

        # +5.00% should fire.
        loop.run_until_complete(
            trades_mod.check_alerts_for_symbol("NVDA", 105.00),
        )
        listed = client.get("/api/v1/trades/alerts").json()
        nvda_alerts = [a for a in listed if a["symbol"] == "NVDA"]
        assert len(nvda_alerts) == 1
        assert nvda_alerts[0]["triggered"] is True
    finally:
        loop.close()


def test_alert_expires_at_skips_trigger(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """An alert with expires_at in the past must NOT fire even when the
    price condition is met. Round-5 F-8."""
    import asyncio
    from datetime import datetime, timedelta, timezone
    from api.routes import trades as trades_mod

    app, _probes = app_with_trades
    client = TestClient(app)

    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    resp = client.post(
        "/api/v1/trades/alerts",
        json={
            "symbol": "NVDA",
            "price": 100.0,
            "condition": "above",
            "expires_at": past,
        },
    )
    assert resp.status_code == 201, resp.text

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(
            trades_mod.check_alerts_for_symbol("NVDA", 200.0),
        )
        # Despite price >= $100, the expired alert stays untriggered.
        listed = client.get("/api/v1/trades/alerts").json()
        nvda = [a for a in listed if a["symbol"] == "NVDA"]
        assert len(nvda) == 1
        assert nvda[0]["triggered"] is False
    finally:
        loop.close()


def test_cancel_alerts_for_position_removes_position_tied_alerts(
    app_with_trades: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Round-5 F-8: cancel_alerts_for_position deletes alerts whose
    position_id matches and leaves unrelated alerts alone."""
    import asyncio
    from api.routes import trades as trades_mod

    app, _probes = app_with_trades
    client = TestClient(app)

    # Two alerts on the position, one unrelated.
    for body in (
        {"symbol": "NVDA", "price": 100.0, "condition": "above", "position_id": "pos-1"},
        {"symbol": "NVDA", "price": 90.0, "condition": "below", "position_id": "pos-1"},
        {"symbol": "AAPL", "price": 200.0, "condition": "above"},
    ):
        r = client.post("/api/v1/trades/alerts", json=body)
        assert r.status_code == 201

    loop = asyncio.new_event_loop()
    try:
        deleted = loop.run_until_complete(
            trades_mod.cancel_alerts_for_position("pos-1"),
        )
        assert deleted == 2
        listed = client.get("/api/v1/trades/alerts").json()
        assert len(listed) == 1
        assert listed[0]["symbol"] == "AAPL"
    finally:
        loop.close()
