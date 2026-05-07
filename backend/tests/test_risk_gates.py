"""SHF-1 / SHF-2 risk-gate tests (audit 2026-05-05 P0-3 / P0-4).

Two gaps the audit flagged that previously let capital-loss-bearing
orders sail past the desk:

* SHF-1 (P0-3): the 3-layer kill-switch (``backend/strategies/_core/
  kill_switch.py``) is consulted by the daily pipeline runner before
  strategy-driven orders, but NOT on the manual-order path. A user
  could submit ``strategy="momentum_quality"`` even after operator
  pressed the kill button.

* SHF-2 (P0-4): the existing $50k absolute notional cap does NOT
  prevent a $48k iron-condor max-loss landing on a $100k account
  (= 48% of book in one trade). A configurable equity-percentage
  cap (``MAX_LOSS_PER_TRADE_PCT_OF_EQUITY``, default 5%) closes
  that gap.

Both gates support an admin override (``?override_kill_switch=true``
/ ``?override_size_limit=true``) which is logged at WARN.
"""
from __future__ import annotations

import logging
from typing import Any
from unittest.mock import AsyncMock, patch

import fakeredis.aioredis
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Drop-in fake Redis so the trades router can call get_redis() safely."""
    import core.redis as redis_mod

    instance = fakeredis.aioredis.FakeRedis(decode_responses=True)

    async def _fake_get_redis() -> Any:
        return instance

    monkeypatch.setattr(redis_mod, "get_redis", _fake_get_redis)
    return instance


@pytest.fixture
def risk_gate_app(
    monkeypatch: pytest.MonkeyPatch,
    fake_redis: Any,
) -> tuple[FastAPI, dict[str, Any]]:
    """Mount the trades router with the broker / DB / risk wiring stubbed.

    Stubs:
      * ``_submit_to_broker`` records each call (asserts in tests).
      * ``_aggregate_risk_check`` / ``_risk_check`` always pass.
      * ``_check_duplicate_order`` no-op.
      * ``_is_trading_halted`` always False.
      * ``_check_kill_switch`` is left alive (it's the SUT) but Postgres
        is disabled via ``SKIP_DB_INIT``; tests use ``patch.object`` to
        force the kill-switch decision.
      * ``_get_account_equity`` defaults to $100k; ``_get_account_equity_cached``
        is force-cleared between tests.

    The fixture returns the app + a ``probes`` dict the tests inspect.
    """
    from api.routes import trades as trades_mod

    probes: dict[str, Any] = {
        "broker_posts": [],
        "equity_calls": 0,
        "equity_value": 100_000.0,
    }

    async def _fake_submit(
        payload: Any,
        settings: Any,
        client_order_id: str | None = None,
        broker_credentials: Any | None = None,
    ) -> str:
        probes["broker_posts"].append((payload, client_order_id))
        return f"broker-{len(probes['broker_posts'])}"

    async def _fake_is_halted() -> bool:
        return False

    async def _fake_dup(_payload: Any, _username: str = "test_user") -> None:
        return None

    async def _fake_agg(_payload: Any, username: str | None = None) -> tuple[bool, str]:
        return True, "ok"

    async def _fake_per(_payload: Any) -> tuple[bool, str]:
        return True, "ok"

    async def _fake_credentials(_username: str | None = None) -> Any:
        from types import SimpleNamespace
        return SimpleNamespace(
            base_url="https://paper-api.alpaca.markets",
            headers={"APCA-API-KEY-ID": "test", "APCA-API-SECRET-KEY": "test"},
            account_env="paper",
        )

    async def _fake_equity(username: str | None = None) -> float:
        probes["equity_calls"] += 1
        return float(probes["equity_value"])

    monkeypatch.setattr(trades_mod, "_submit_to_broker", _fake_submit)
    monkeypatch.setattr(trades_mod, "_is_trading_halted", _fake_is_halted)
    monkeypatch.setattr(trades_mod, "_check_duplicate_order", _fake_dup)
    monkeypatch.setattr(trades_mod, "_aggregate_risk_check", _fake_agg)
    monkeypatch.setattr(trades_mod, "_risk_check", _fake_per)
    monkeypatch.setattr(trades_mod, "_alpaca_credentials_or_503", _fake_credentials)
    monkeypatch.setattr(trades_mod, "_get_account_equity", _fake_equity)
    # Reset the 60s equity cache so each test starts cold.
    trades_mod._equity_cache_clear()

    # The trades.create_order body checks rate limits / market hours; stub
    # them out so the tests focus on the SHF gates only.
    async def _fake_rate(_username: str) -> None:
        return None
    monkeypatch.setattr(trades_mod, "_enforce_order_rate_limit", _fake_rate)

    async def _fake_record_submit(_username: str) -> None:
        return None
    monkeypatch.setattr(
        trades_mod, "_record_submit_for_cancel_rate", _fake_record_submit,
    )

    async def _fake_record_wash(*_args: Any, **_kwargs: Any) -> None:
        return None
    monkeypatch.setattr(
        trades_mod, "_record_fill_for_wash_detection", _fake_record_wash,
    )

    async def _fake_record_close(*_args: Any, **_kwargs: Any) -> None:
        return None
    monkeypatch.setattr(
        trades_mod, "_record_closing_auction_notional", _fake_record_close,
    )

    async def _fake_classify(*_args: Any, **_kwargs: Any) -> str:
        return "long_open"
    monkeypatch.setattr(
        trades_mod, "_classify_trade_kind_pre_submit", _fake_classify,
    )

    # Skip live-strategy gate (it raises 422 for known live-disabled names).
    def _fake_live_gate(_strategy: str | None, *, username: str | None = None) -> None:
        return None
    monkeypatch.setattr(trades_mod, "_reject_if_live_forbidden", _fake_live_gate)

    # Force market-hours check to "open" so non-extended-hours orders
    # (single-leg options can't use extended_hours, only equity single-leg
    # or multi-leg option combos can) don't get 422'd by the RTH gate.
    import data.calendar as _calmod

    class _FakeCalendar:
        def is_trading_day(self, _d: Any) -> bool:
            return True

        def session_hours(self, _d: Any) -> tuple[Any, Any]:
            from datetime import datetime as _dt, timezone as _tz, timedelta as _td
            now = _dt.now(_tz.utc)
            return now - _td(hours=2), now + _td(hours=2)

    monkeypatch.setattr(_calmod, "USMarketCalendar", _FakeCalendar)

    # Skip the inner audit / DB write paths.
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

    # Each test sets the authenticated user via probes["username"].
    probes["username"] = "alice"

    async def _fake_user() -> str:
        return probes["username"]

    app = FastAPI()
    app.include_router(trades_mod.router, prefix="/api/v1/trades")
    app.dependency_overrides[require_auth] = _fake_user
    return app, probes


def _equity_payload() -> dict:
    """Single-leg equity LIMIT BUY at $150 × 10 shares = $1.5k notional."""
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
        "notes": "risk-gate test",
        "extended_hours": True,
    }


def _iron_condor_payload() -> dict:
    """4-leg iron condor on SPY with $5 width — $500 max loss × qty.

    The notional gate ALREADY computes width × 100 × qty; we use the same
    envelope to size against equity.
    """
    return {
        "legs": [
            {"symbol": "SPY260424P00500000", "side": "sell", "qty": 1,
             "order_type": "limit", "limit_price": 1.50, "asset_class": "option"},
            {"symbol": "SPY260424P00495000", "side": "buy", "qty": 1,
             "order_type": "limit", "limit_price": 0.50, "asset_class": "option"},
            {"symbol": "SPY260424C00540000", "side": "sell", "qty": 1,
             "order_type": "limit", "limit_price": 1.50, "asset_class": "option"},
            {"symbol": "SPY260424C00545000", "side": "buy", "qty": 1,
             "order_type": "limit", "limit_price": 0.50, "asset_class": "option"},
        ],
        "time_in_force": "day",
        "combo_type": "iron_condor",
        "extended_hours": True,
    }


# ---------------------------------------------------------------------------
# SHF-1 — kill-switch on manual-order path
# ---------------------------------------------------------------------------


def test_killed_strategy_rejected_with_423(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """POST with strategy="momentum_quality" while Layer-3 disabled → 423."""
    app, probes = risk_gate_app
    from api.routes import trades as trades_mod

    async def _fake_check(strategy: str | None) -> tuple[bool, str | None]:
        return (True, "operator pressed kill button")

    with patch.object(trades_mod, "_check_kill_switch", new=_fake_check):
        client = TestClient(app)
        body = _equity_payload()
        body["strategy"] = "momentum_quality"
        resp = client.post("/api/v1/trades/orders", json=body)

    assert resp.status_code == 423, resp.text
    detail = resp.json().get("detail")
    assert isinstance(detail, dict)
    assert detail.get("code") == "STRATEGY_DISABLED"
    assert detail.get("strategy") == "momentum_quality"
    assert "operator pressed kill button" in (detail.get("reason") or "")
    assert detail.get("hint")
    # Broker MUST NOT have been touched.
    assert probes["broker_posts"] == []


def test_admin_override_kill_switch_succeeds(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Admin + ?override_kill_switch=true → order proceeds, WARN logged."""
    app, probes = risk_gate_app
    from api.routes import trades as trades_mod
    from core.config import settings as _cfg

    probes["username"] = _cfg.ADMIN_USERNAME

    async def _fake_check(strategy: str | None) -> tuple[bool, str | None]:
        return (True, "operator pressed kill button")

    async def _fake_admin(username: str) -> bool:
        return username == _cfg.ADMIN_USERNAME

    with (
        patch.object(trades_mod, "_check_kill_switch", new=_fake_check),
        patch("services.users.is_admin_user", new=_fake_admin),
        caplog.at_level(logging.WARNING, logger="api.routes.trades"),
    ):
        client = TestClient(app)
        body = _equity_payload()
        body["strategy"] = "momentum_quality"
        resp = client.post(
            "/api/v1/trades/orders?override_kill_switch=true",
            json=body,
        )

    assert resp.status_code == 201, resp.text
    assert len(probes["broker_posts"]) == 1
    # Verify the WARN log was emitted.
    override_logs = [
        rec for rec in caplog.records
        if getattr(rec, "event", "") == "kill_switch_overridden"
    ]
    assert override_logs, "expected kill_switch_overridden WARN log"
    assert override_logs[0].levelno == logging.WARNING


def test_non_admin_override_kill_switch_forbidden(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Non-admin + ?override_kill_switch=true → 403."""
    app, probes = risk_gate_app
    from api.routes import trades as trades_mod

    probes["username"] = "regular_user"

    async def _fake_admin(_username: str) -> bool:
        return False

    async def _fake_check(strategy: str | None) -> tuple[bool, str | None]:
        # Kill-switch wouldn't be reached but stub anyway for safety.
        return (True, "irrelevant")

    with (
        patch.object(trades_mod, "_check_kill_switch", new=_fake_check),
        patch("services.users.is_admin_user", new=_fake_admin),
    ):
        client = TestClient(app)
        body = _equity_payload()
        body["strategy"] = "momentum_quality"
        resp = client.post(
            "/api/v1/trades/orders?override_kill_switch=true",
            json=body,
        )

    assert resp.status_code == 403
    assert "admin-only" in resp.json().get("detail", "")
    assert probes["broker_posts"] == []


def test_manual_order_unaffected_by_kill_switch(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Order without a strategy field passes regardless of kill-switch state.

    The "manual" pseudo-strategy is default-permissive — there is no
    strategy row to disable. Operators who want to lock down ALL manual
    orders should use the global emergency halt instead. We exercise
    the REAL ``_check_kill_switch`` helper here (no patch) so the
    short-circuit on strategy=None is validated end-to-end through
    the route.
    """
    app, probes = risk_gate_app

    client = TestClient(app)
    body = _equity_payload()  # no "strategy" key
    resp = client.post("/api/v1/trades/orders", json=body)

    assert resp.status_code == 201, resp.text
    assert len(probes["broker_posts"]) == 1


def test_kill_switch_helper_short_circuits_on_manual(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Direct unit test of ``_check_kill_switch``: None / "manual" / "" → permissive.

    Complements test_manual_order_unaffected_by_kill_switch by hitting the
    helper directly so we can prove the short-circuit happens BEFORE any
    Postgres lookup attempt — the audit asked for fail-OPEN on the
    "manual" pseudo-strategy.
    """
    import asyncio
    from api.routes import trades as trades_mod

    async def _run() -> list[tuple[bool, str | None]]:
        return [
            await trades_mod._check_kill_switch(None),
            await trades_mod._check_kill_switch("manual"),
            await trades_mod._check_kill_switch(""),
            await trades_mod._check_kill_switch("   "),
        ]

    results = asyncio.new_event_loop().run_until_complete(_run())
    for disabled, _reason in results:
        assert disabled is False


# ---------------------------------------------------------------------------
# SHF-2 — max-loss-vs-equity gate
# ---------------------------------------------------------------------------


def test_oversized_debit_order_rejected_422(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Single-leg debit order with max_loss > 5% of equity → 422.

    Equity is $100k → 5% cap = $5k. A single-leg long call paid at $50
    per contract × 1 contract × 100 mult = $5k debit; we round up by
    asking for 2 contracts ($10k debit > $5k cap).
    """
    app, probes = risk_gate_app
    probes["equity_value"] = 100_000.0

    body = {
        "legs": [
            {
                "symbol": "AAPL260424C00200000",
                "side": "buy",
                "qty": 2,
                "order_type": "limit",
                "limit_price": 50.0,
                "asset_class": "option",
            },
        ],
        "time_in_force": "day",
    }
    client = TestClient(app)
    resp = client.post("/api/v1/trades/orders", json=body)

    assert resp.status_code == 422, resp.text
    detail = resp.json().get("detail", "")
    assert "max loss" in detail.lower()
    assert "equity" in detail.lower()
    assert probes["broker_posts"] == []


def test_admin_override_size_limit_succeeds(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Admin + ?override_size_limit=true → oversized debit succeeds."""
    app, probes = risk_gate_app
    from core.config import settings as _cfg
    probes["username"] = _cfg.ADMIN_USERNAME
    probes["equity_value"] = 100_000.0

    async def _fake_admin(username: str) -> bool:
        return username == _cfg.ADMIN_USERNAME

    body = {
        "legs": [
            {
                "symbol": "AAPL260424C00200000",
                "side": "buy",
                "qty": 2,
                "order_type": "limit",
                "limit_price": 50.0,
                "asset_class": "option",
            },
        ],
        "time_in_force": "day",
    }
    with (
        patch("services.users.is_admin_user", new=_fake_admin),
        caplog.at_level(logging.WARNING, logger="api.routes.trades"),
    ):
        client = TestClient(app)
        resp = client.post(
            "/api/v1/trades/orders?override_size_limit=true",
            json=body,
        )

    assert resp.status_code == 201, resp.text
    assert len(probes["broker_posts"]) == 1
    override_logs = [
        rec for rec in caplog.records
        if getattr(rec, "event", "") == "size_limit_overridden"
    ]
    assert override_logs, "expected size_limit_overridden WARN log"


def test_iron_condor_within_cap_succeeds(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """4-leg iron condor with max_loss < 5% of equity → submits cleanly.

    Width = $5; max_loss = 5 × 1 × 100 = $500. Equity $100k → cap $5k.
    """
    app, probes = risk_gate_app
    probes["equity_value"] = 100_000.0

    client = TestClient(app)
    resp = client.post(
        "/api/v1/trades/orders",
        json=_iron_condor_payload(),
    )
    assert resp.status_code == 201, resp.text
    assert len(probes["broker_posts"]) == 1


def test_naked_short_option_rejected_as_undefined_risk(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Naked short call (single leg, side=SELL) → 422 unless override.

    SHF-2 spec: naked / undefined-risk shapes REJECT outright unless
    ``override_size_limit=true``.
    """
    app, probes = risk_gate_app

    body = {
        "legs": [
            {
                "symbol": "AAPL260424C00200000",
                "side": "sell",
                "qty": 1,
                "order_type": "limit",
                "limit_price": 5.0,
                "asset_class": "option",
            },
        ],
        "time_in_force": "day",
    }
    client = TestClient(app)
    resp = client.post("/api/v1/trades/orders", json=body)

    assert resp.status_code == 422, resp.text
    detail = resp.json().get("detail", "")
    assert "undefined" in detail.lower() or "naked" in detail.lower()
    assert probes["broker_posts"] == []


def test_equity_cache_avoids_per_order_alpaca_calls(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Two orders within 60s share the same cached equity (1 broker call)."""
    app, probes = risk_gate_app
    probes["equity_value"] = 100_000.0

    client = TestClient(app)
    body = _equity_payload()  # tiny order, well under cap

    r1 = client.post("/api/v1/trades/orders", json=body)
    r2 = client.post("/api/v1/trades/orders", json=body)

    assert r1.status_code == 201, r1.text
    assert r2.status_code == 201, r2.text
    assert len(probes["broker_posts"]) == 2
    # The cache should have folded the second call's equity fetch into
    # the first call's. Depending on test ordering, the cache may have
    # been hit elsewhere — but for two consecutive calls sharing the
    # same username we expect exactly one underlying Alpaca call.
    assert probes["equity_calls"] == 1, (
        f"Expected 1 _get_account_equity call after caching; got "
        f"{probes['equity_calls']}"
    )


# ---------------------------------------------------------------------------
# Audit fix — long straddle / strangle equity-gate is defined-risk
# ---------------------------------------------------------------------------
#
# Pre-fix: ``_compute_order_max_loss`` blanket-treated ``combo == "strangle"``
# as undefined risk and ``"straddle"`` fell through to the generic per-leg
# path. Long straddles / strangles (all BUY) have a deterministic max loss
# = total debit paid; the equity gate over-rejected them.


def _long_straddle_payload() -> dict:
    """2-leg long straddle on SPY 500 strike — both BUY."""
    return {
        "legs": [
            {"symbol": "SPY260424C00500000", "side": "buy", "qty": 1,
             "order_type": "limit", "limit_price": 5.00, "asset_class": "option"},
            {"symbol": "SPY260424P00500000", "side": "buy", "qty": 1,
             "order_type": "limit", "limit_price": 4.50, "asset_class": "option"},
        ],
        "time_in_force": "day",
        "combo_type": "straddle",
        "extended_hours": True,
    }


def _short_straddle_payload() -> dict:
    """2-leg short straddle on SPY 500 strike — both SELL."""
    return {
        "legs": [
            {"symbol": "SPY260424C00500000", "side": "sell", "qty": 1,
             "order_type": "limit", "limit_price": 5.00, "asset_class": "option"},
            {"symbol": "SPY260424P00500000", "side": "sell", "qty": 1,
             "order_type": "limit", "limit_price": 4.50, "asset_class": "option"},
        ],
        "time_in_force": "day",
        "combo_type": "straddle",
        "extended_hours": True,
    }


def _long_strangle_payload() -> dict:
    """2-leg long strangle on SPY (505 call + 495 put) — both BUY."""
    return {
        "legs": [
            {"symbol": "SPY260424C00505000", "side": "buy", "qty": 1,
             "order_type": "limit", "limit_price": 3.00, "asset_class": "option"},
            {"symbol": "SPY260424P00495000", "side": "buy", "qty": 1,
             "order_type": "limit", "limit_price": 2.50, "asset_class": "option"},
        ],
        "time_in_force": "day",
        "combo_type": "strangle",
        "extended_hours": True,
    }


def _short_strangle_payload() -> dict:
    """2-leg short strangle on SPY (505 call + 495 put) — both SELL."""
    return {
        "legs": [
            {"symbol": "SPY260424C00505000", "side": "sell", "qty": 1,
             "order_type": "limit", "limit_price": 3.00, "asset_class": "option"},
            {"symbol": "SPY260424P00495000", "side": "sell", "qty": 1,
             "order_type": "limit", "limit_price": 2.50, "asset_class": "option"},
        ],
        "time_in_force": "day",
        "combo_type": "strangle",
        "extended_hours": True,
    }


def _make_order_request(payload: dict) -> Any:
    """Build a CreateOrderRequest from a JSON-shaped payload."""
    from api.routes.trades import CreateOrderRequest
    return CreateOrderRequest.model_validate(payload)


def test_long_straddle_max_loss_equals_debit() -> None:
    """Long straddle (all BUY) → max_loss = sum(debit), undefined=False.

    SPY 500 strike, $5.00 + $4.50 debit, 1 contract each:
    max_loss = (5.00 + 4.50) × 1 × 100 = $950
    """
    import asyncio
    from api.routes import trades as trades_mod

    request = _make_order_request(_long_straddle_payload())
    max_loss, undefined = asyncio.new_event_loop().run_until_complete(
        trades_mod._compute_order_max_loss(request)
    )
    assert undefined is False
    assert max_loss == pytest.approx((5.00 + 4.50) * 1 * 100.0)


def test_short_straddle_remains_undefined_risk() -> None:
    """Short straddle (all SELL) keeps the undefined-risk gate.

    Short call has unbounded loss; short put has near-strike loss
    capped only by collateral. Without a defined hedge we treat as
    undefined and force the admin override.
    """
    import asyncio
    from api.routes import trades as trades_mod

    request = _make_order_request(_short_straddle_payload())
    max_loss, undefined = asyncio.new_event_loop().run_until_complete(
        trades_mod._compute_order_max_loss(request)
    )
    assert undefined is True
    assert max_loss == 0.0


def test_long_strangle_max_loss_equals_debit() -> None:
    """Long strangle (all BUY) → max_loss = sum(debit), undefined=False.

    505 call $3.00 + 495 put $2.50, 1 contract each:
    max_loss = (3.00 + 2.50) × 1 × 100 = $550
    """
    import asyncio
    from api.routes import trades as trades_mod

    request = _make_order_request(_long_strangle_payload())
    max_loss, undefined = asyncio.new_event_loop().run_until_complete(
        trades_mod._compute_order_max_loss(request)
    )
    assert undefined is False
    assert max_loss == pytest.approx((3.00 + 2.50) * 1 * 100.0)


def test_short_strangle_remains_undefined_risk() -> None:
    """Short strangle (all SELL) keeps the undefined-risk gate."""
    import asyncio
    from api.routes import trades as trades_mod

    request = _make_order_request(_short_strangle_payload())
    max_loss, undefined = asyncio.new_event_loop().run_until_complete(
        trades_mod._compute_order_max_loss(request)
    )
    assert undefined is True
    assert max_loss == 0.0


def test_mixed_strangle_remains_undefined_risk() -> None:
    """Mixed-side strangle (1 BUY + 1 SELL) is treated as undefined.

    Can't happen via a normal-shape strangle but the gate must default
    to undefined for any non-pure-buy / non-pure-sell shape.
    """
    import asyncio
    from api.routes import trades as trades_mod

    payload = _long_strangle_payload()
    payload["legs"][1]["side"] = "sell"  # flip put to SELL → mixed
    request = _make_order_request(payload)
    max_loss, undefined = asyncio.new_event_loop().run_until_complete(
        trades_mod._compute_order_max_loss(request)
    )
    assert undefined is True
    assert max_loss == 0.0


def test_long_straddle_combo_notional_equals_debit() -> None:
    """``_compute_order_notional`` returns sum(debit) for long straddle."""
    import asyncio
    from api.routes import trades as trades_mod

    request = _make_order_request(_long_straddle_payload())
    notional = asyncio.new_event_loop().run_until_complete(
        trades_mod._compute_order_notional(request)
    )
    assert notional == pytest.approx((5.00 + 4.50) * 1 * 100.0)


def test_long_strangle_combo_notional_equals_debit() -> None:
    """``_compute_order_notional`` returns sum(debit) for long strangle.

    Long shape uses the debit envelope, NOT the naked-side max envelope
    (which would over-count by ~2× for a long-vol structure).
    """
    import asyncio
    from api.routes import trades as trades_mod

    request = _make_order_request(_long_strangle_payload())
    notional = asyncio.new_event_loop().run_until_complete(
        trades_mod._compute_order_notional(request)
    )
    assert notional == pytest.approx((3.00 + 2.50) * 1 * 100.0)


def test_short_strangle_combo_notional_uses_naked_envelope() -> None:
    """``_compute_order_notional`` for short strangle = max(naked C, naked P).

    SHORT 505C @ $3.00, SHORT 495P @ $2.50:
    naked_call = 3.00 × 1 × 100 = $300
    naked_put  = 2.50 × 1 × 100 = $250
    envelope = max($300, $250) = $300
    """
    import asyncio
    from api.routes import trades as trades_mod

    request = _make_order_request(_short_strangle_payload())
    notional = asyncio.new_event_loop().run_until_complete(
        trades_mod._compute_order_notional(request)
    )
    assert notional == pytest.approx(300.0)


def test_long_straddle_within_cap_succeeds_via_api(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """End-to-end: long straddle with debit < 5% of equity → 201.

    Pre-fix this same payload would have been rejected as undefined-risk
    even though the max loss is bounded by the debit paid.
    """
    app, probes = risk_gate_app
    probes["equity_value"] = 100_000.0

    client = TestClient(app)
    resp = client.post(
        "/api/v1/trades/orders",
        json=_long_straddle_payload(),
    )
    assert resp.status_code == 201, resp.text
    assert len(probes["broker_posts"]) == 1


def test_long_strangle_within_cap_succeeds_via_api(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """End-to-end: long strangle with debit < 5% of equity → 201."""
    app, probes = risk_gate_app
    probes["equity_value"] = 100_000.0

    client = TestClient(app)
    resp = client.post(
        "/api/v1/trades/orders",
        json=_long_strangle_payload(),
    )
    assert resp.status_code == 201, resp.text
    assert len(probes["broker_posts"]) == 1


def test_short_strangle_rejected_as_undefined_risk_via_api(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Short strangle without override → 422 (undefined-risk reject).

    Sanity-checks that we did NOT accidentally relax the short path
    while widening the long path.
    """
    app, probes = risk_gate_app

    client = TestClient(app)
    resp = client.post(
        "/api/v1/trades/orders",
        json=_short_strangle_payload(),
    )
    assert resp.status_code == 422, resp.text
    detail = resp.json().get("detail", "")
    assert "undefined" in detail.lower() or "naked" in detail.lower()
    assert probes["broker_posts"] == []


# ---------------------------------------------------------------------------
# SHF-3 — aggregate-position max-loss gate
# ---------------------------------------------------------------------------
#
# Per-trade gate fires only on the new request in isolation, so a trader
# could stack four 4.9%-of-equity defined-risk trades for ~20% aggregate
# exposure without ever tripping it. The aggregate gate sums
# ``max_loss_at_submit`` across this user's open / pending trades and
# combines with the new request before comparing to a higher cap
# (``MAX_LOSS_AGGREGATE_PCT_OF_EQUITY``, default 0.20).
#
# A note on test shapes: tests 4 + 5 mock ``_get_open_positions_max_loss_total``
# at the route level so we can assert the gate's pass/reject behavior
# end-to-end without a real DB. Tests 6 + 7 exercise the helper directly
# against a fake session spy that mirrors PostgreSQL's
# ``COALESCE(SUM(...), 0)`` over a filtered WHERE ... IN (...) — so the
# NULL-handling and status-filter semantics are pinned.


def _at_5pct_per_trade_cap_payload() -> dict:
    """4-leg iron condor priced to land EXACTLY at the 5% per-trade cap.

    Equity $100k → cap $5k. Width $50 × 1 contract × 100 = $5,000 max-loss.
    """
    return {
        "legs": [
            {"symbol": "SPY260424P00500000", "side": "sell", "qty": 1,
             "order_type": "limit", "limit_price": 1.50, "asset_class": "option"},
            {"symbol": "SPY260424P00450000", "side": "buy", "qty": 1,
             "order_type": "limit", "limit_price": 0.50, "asset_class": "option"},
            {"symbol": "SPY260424C00540000", "side": "sell", "qty": 1,
             "order_type": "limit", "limit_price": 1.50, "asset_class": "option"},
            {"symbol": "SPY260424C00590000", "side": "buy", "qty": 1,
             "order_type": "limit", "limit_price": 0.50, "asset_class": "option"},
        ],
        "time_in_force": "day",
        "combo_type": "iron_condor",
        "extended_hours": True,
    }


def test_single_trade_at_5pct_per_trade_cap_allowed(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """Single trade exactly at the 5% per-trade cap → 201 (boundary inclusive).

    Width $50 × 1 contract × 100 = $5,000 max-loss; 5% of $100k = $5,000.
    With ``max_loss > cap`` (strict greater-than) the boundary case must
    pass — this protects operators from hitting a phantom rejection on
    a legitimately-sized trade. No existing open positions for the user.
    """
    app, probes = risk_gate_app
    probes["equity_value"] = 100_000.0

    client = TestClient(app)
    resp = client.post(
        "/api/v1/trades/orders",
        json=_at_5pct_per_trade_cap_payload(),
    )
    assert resp.status_code == 201, resp.text
    assert len(probes["broker_posts"]) == 1


def test_aggregate_under_20pct_allowed(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """$15k existing + $4k new = $19k vs $100k = 19% → 201.

    Just under the 20% aggregate cap. The per-trade gate at 5% cap also
    passes ($4k < $5k).
    """
    app, probes = risk_gate_app
    from api.routes import trades as trades_mod
    probes["equity_value"] = 100_000.0

    async def _fake_open_total(_username: str) -> float:
        return 15_000.0

    # $4k order: width $40 × 1 contract × 100 = $4,000.
    payload = _at_5pct_per_trade_cap_payload()
    payload["legs"] = [
        {"symbol": "SPY260424P00500000", "side": "sell", "qty": 1,
         "order_type": "limit", "limit_price": 1.50, "asset_class": "option"},
        {"symbol": "SPY260424P00460000", "side": "buy", "qty": 1,
         "order_type": "limit", "limit_price": 0.50, "asset_class": "option"},
        {"symbol": "SPY260424C00540000", "side": "sell", "qty": 1,
         "order_type": "limit", "limit_price": 1.50, "asset_class": "option"},
        {"symbol": "SPY260424C00580000", "side": "buy", "qty": 1,
         "order_type": "limit", "limit_price": 0.50, "asset_class": "option"},
    ]

    with patch.object(
        trades_mod, "_get_open_positions_max_loss_total", new=_fake_open_total,
    ):
        client = TestClient(app)
        resp = client.post("/api/v1/trades/orders", json=payload)

    assert resp.status_code == 201, resp.text
    assert len(probes["broker_posts"]) == 1


def test_aggregate_over_20pct_rejected(
    risk_gate_app: tuple[FastAPI, dict[str, Any]],
) -> None:
    """$18k existing + $3k new = $21k vs $100k = 21% → 422 with aggregate-cap message.

    Per-trade gate alone would let this through ($3k < $5k cap), so this
    test pins the new behavior end-to-end.
    """
    app, probes = risk_gate_app
    from api.routes import trades as trades_mod
    probes["equity_value"] = 100_000.0

    async def _fake_open_total(_username: str) -> float:
        return 18_000.0

    # $3k order: width $30 × 1 contract × 100 = $3,000.
    payload = {
        "legs": [
            {"symbol": "SPY260424P00500000", "side": "sell", "qty": 1,
             "order_type": "limit", "limit_price": 1.50, "asset_class": "option"},
            {"symbol": "SPY260424P00470000", "side": "buy", "qty": 1,
             "order_type": "limit", "limit_price": 0.50, "asset_class": "option"},
            {"symbol": "SPY260424C00540000", "side": "sell", "qty": 1,
             "order_type": "limit", "limit_price": 1.50, "asset_class": "option"},
            {"symbol": "SPY260424C00570000", "side": "buy", "qty": 1,
             "order_type": "limit", "limit_price": 0.50, "asset_class": "option"},
        ],
        "time_in_force": "day",
        "combo_type": "iron_condor",
        "extended_hours": True,
    }

    with patch.object(
        trades_mod, "_get_open_positions_max_loss_total", new=_fake_open_total,
    ):
        client = TestClient(app)
        resp = client.post("/api/v1/trades/orders", json=payload)

    assert resp.status_code == 422, resp.text
    detail = resp.json().get("detail", "")
    # Reject message must include both the existing aggregate AND the
    # new request's max-loss so the operator can reason about it.
    assert "aggregate" in detail.lower(), detail
    assert "$18,000" in detail or "$18,000.00" in detail, detail
    assert "$3,000" in detail or "$3,000.00" in detail, detail
    assert "20%" in detail, detail
    assert probes["broker_posts"] == []


def test_aggregate_helper_treats_null_max_loss_as_zero() -> None:
    """SQL ``SUM`` skips NULLs → legacy rows don't break the aggregate.

    A user with three open trades [4_000, NULL, 1_000] sums to 5,000
    (the NULL row is skipped — those positions are conservatively
    excluded from the aggregate, which matches the migration's NULL-
    backfill policy).
    """
    import asyncio

    from api.routes import trades as trades_mod
    from data.storage.models import Trade

    captured_stmts: list[Any] = []

    class _FakeResult:
        def __init__(self, scalar_value: float) -> None:
            self._scalar = scalar_value

        def scalar(self) -> float:
            return self._scalar

    class _FakeSession:
        async def __aenter__(self) -> _FakeSession:
            return self

        async def __aexit__(self, *_a: Any) -> None:
            return None

        async def execute(self, stmt: Any) -> _FakeResult:
            captured_stmts.append(stmt)
            # Simulate ``COALESCE(SUM(max_loss_at_submit), 0)`` across the
            # filtered WHERE ... IN (...) — NULL row excluded by SUM:
            # 4_000 + 1_000 = 5_000.
            return _FakeResult(5_000.0)

    def _fake_factory() -> Any:
        return _FakeSession()

    async def _run() -> float:
        with patch("core.config.settings.SKIP_DB_INIT", False):
            with patch(
                "core.database._get_session_factory", return_value=_fake_factory,
            ):
                return await trades_mod._get_open_positions_max_loss_total("alice")

    total = asyncio.new_event_loop().run_until_complete(_run())
    assert total == 5_000.0
    # The query should target the Trade table.
    assert captured_stmts, "execute() was not called"
    stmt_str = str(captured_stmts[0]).lower()
    assert "trades" in stmt_str
    # And it must reference max_loss_at_submit (not entry_price etc.).
    assert "max_loss_at_submit" in stmt_str


def test_aggregate_helper_excludes_closed_cancelled_rejected_trades() -> None:
    """Helper's WHERE clause must exclude terminal-state rows.

    Pins the exact status set: pending / submitted / open / partial /
    partial_fill IN; closed / cancelled / rejected NOT IN. A regression
    that adds ``closed`` to the IN list (or drops one of the open
    statuses) would re-introduce the SHF-3 leak.
    """
    import asyncio

    from api.routes import trades as trades_mod

    captured_stmts: list[Any] = []

    class _FakeResult:
        def scalar(self) -> float:
            return 0.0

    class _FakeSession:
        async def __aenter__(self) -> _FakeSession:
            return self

        async def __aexit__(self, *_a: Any) -> None:
            return None

        async def execute(self, stmt: Any) -> _FakeResult:
            captured_stmts.append(stmt)
            return _FakeResult()

    def _fake_factory() -> Any:
        return _FakeSession()

    async def _run() -> None:
        with patch("core.config.settings.SKIP_DB_INIT", False):
            with patch(
                "core.database._get_session_factory", return_value=_fake_factory,
            ):
                await trades_mod._get_open_positions_max_loss_total("alice")

    asyncio.new_event_loop().run_until_complete(_run())
    assert captured_stmts, "execute() was not called"
    # Compile the statement so the IN literal is visible — the WHERE
    # clause must reference each open status and must NOT reference any
    # of the terminal statuses.
    compiled = str(captured_stmts[0].compile(compile_kwargs={"literal_binds": True})).lower()
    for must_have in ("pending", "submitted", "open", "partial", "partial_fill"):
        assert must_have in compiled, f"open status {must_have!r} missing from WHERE: {compiled}"
    for must_not_have in ("closed", "cancelled", "rejected"):
        # Whole-token check — substring of any other column name would
        # otherwise false-positive (e.g. "open" ⊂ "open_id").
        assert f"'{must_not_have}'" not in compiled, (
            f"terminal status {must_not_have!r} unexpectedly in WHERE: {compiled}"
        )
