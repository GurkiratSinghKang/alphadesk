"""Round-6 (Persona-J / FIX-1) risk-gate + audit-log tests.

Covers:

* J-2  combo notional (iron_condor / vertical_spread / strangle).
* J-3  daily loss limit gate.
* J-7  quote staleness gate.
* J-11 symbol halt / tradability gate.
* L-12 combo_type / combo_correlation_id sanitisation.
* J-15 quote-cache key uppercased.
* L-13 cancel_order ownership check.
* J-9  reconcile_positions_on_boot drift report.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.routes import trades as trades_mod
from api.routes.trades import (
    BracketSpec,
    CreateOrderRequest,
    OrderLeg,
    OrderSide,
    OrderType,
)


# --------------------------------------------------------------------------- #
# J-2 — combo notional                                                        #
# --------------------------------------------------------------------------- #


def _occ_leg(symbol: str, side: OrderSide, qty: int, limit: float) -> OrderLeg:
    return OrderLeg(
        symbol=symbol,
        side=side,
        qty=qty,
        order_type=OrderType.LIMIT,
        limit_price=limit,
        asset_class="option",
    )


def test_combo_iron_condor_notional_uses_widest_wing() -> None:
    """Iron condor with $5 put-side and $10 call-side widths → notional 10×qty×100."""
    legs = [
        _occ_leg("SPY260424P00500000", OrderSide.SELL, 1, 1.50),  # short put @ 500
        _occ_leg("SPY260424P00495000", OrderSide.BUY,  1, 0.50),  # long  put @ 495 (5 wide)
        _occ_leg("SPY260424C00540000", OrderSide.SELL, 1, 1.50),  # short call @ 540
        _occ_leg("SPY260424C00550000", OrderSide.BUY,  1, 0.50),  # long  call @ 550 (10 wide)
    ]
    req = CreateOrderRequest(legs=legs, combo_type="iron_condor")
    width = trades_mod._combo_spread_width(req)
    assert width == 10.0


def test_combo_vertical_spread_notional() -> None:
    """A 2-leg vertical: width is |strike_a - strike_b| × qty × 100."""
    legs = [
        _occ_leg("AAPL260424C00200000", OrderSide.SELL, 2, 3.0),
        _occ_leg("AAPL260424C00210000", OrderSide.BUY,  2, 1.5),
    ]
    req = CreateOrderRequest(legs=legs, combo_type="vertical_spread")
    width = trades_mod._combo_spread_width(req)
    assert width == 10.0


def test_defined_risk_spreads_reject_ratio_quantities() -> None:
    legs = [
        _occ_leg("AAPL260424C00200000", OrderSide.SELL, 1, 3.0),
        _occ_leg("AAPL260424C00210000", OrderSide.BUY, 100, 1.5),
    ]
    req = CreateOrderRequest(legs=legs, combo_type="vertical_spread")
    with pytest.raises(Exception, match="same contract quantity"):
        trades_mod._combo_spread_width(req)


def test_iron_condor_rejects_mixed_underlyings() -> None:
    legs = [
        _occ_leg("SPY260424P00500000", OrderSide.SELL, 1, 1.50),
        _occ_leg("SPY260424P00495000", OrderSide.BUY, 1, 0.50),
        _occ_leg("QQQ260424C00540000", OrderSide.SELL, 1, 1.50),
        _occ_leg("QQQ260424C00550000", OrderSide.BUY, 1, 0.50),
    ]
    req = CreateOrderRequest(legs=legs, combo_type="iron_condor")
    with pytest.raises(Exception, match="same underlying"):
        trades_mod._combo_spread_width(req)


def test_iron_condor_rejects_inverted_wings() -> None:
    legs = [
        _occ_leg("SPY260424P00495000", OrderSide.SELL, 1, 1.50),
        _occ_leg("SPY260424P00500000", OrderSide.BUY, 1, 0.50),
        _occ_leg("SPY260424C00540000", OrderSide.SELL, 1, 1.50),
        _occ_leg("SPY260424C00550000", OrderSide.BUY, 1, 0.50),
    ]
    req = CreateOrderRequest(legs=legs, combo_type="iron_condor")
    with pytest.raises(Exception, match="Put wing"):
        trades_mod._combo_spread_width(req)


def test_combo_strangle_rejected_as_undefined_risk() -> None:
    """Round-12 / DR-1: ``combo_type="strangle"`` is no longer accepted —
    naked strangles are UNDEFINED-risk and AlphaDesk now refuses them at
    the validator. The legacy ``_combo_strangle_max_notional`` helper
    still exists for the per-leg fallback notional path on legacy data,
    but the route's combo_type allowlist rejects ``"strangle"`` outright.
    """
    import pytest
    from pydantic import ValidationError

    legs = [
        _occ_leg("AAPL260424C00200000", OrderSide.SELL, 1, 5.0),
        _occ_leg("AAPL260424P00180000", OrderSide.SELL, 1, 3.0),
    ]
    with pytest.raises(ValidationError, match="DEFINED-RISK"):
        CreateOrderRequest(legs=legs, combo_type="strangle")


def test_short_option_coverage_is_quantity_aware() -> None:
    from pydantic import ValidationError

    legs = [
        _occ_leg("AAPL260424C00200000", OrderSide.SELL, 10, 5.0),
        _occ_leg("AAPL260424C00210000", OrderSide.BUY, 1, 1.5),
    ]
    with pytest.raises(ValidationError, match="covering long qty 1"):
        CreateOrderRequest(legs=legs, combo_type="vertical_spread")


def test_fake_covered_call_combo_does_not_bypass_short_option_gate() -> None:
    from pydantic import ValidationError

    legs = [_occ_leg("AAPL260424C00200000", OrderSide.SELL, 1, 5.0)]
    with pytest.raises(ValidationError, match="portfolio collateral checks"):
        CreateOrderRequest(legs=legs, combo_type="covered_call")


# --------------------------------------------------------------------------- #
# J-3 — daily loss check                                                      #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_daily_loss_check_passes_when_realized_below_cap() -> None:
    """Realised P&L <= 5% of equity → passes."""
    with (
        patch.object(trades_mod, "_get_realized_pnl_today", new=AsyncMock(return_value=-2000.0)),
        patch("api.routes.portfolio._get_unrealized_pnl_today", new=AsyncMock(return_value=0.0)),
    ):
        passed, reason, realized = await trades_mod._daily_loss_check(equity=100_000.0)
    assert passed is True
    assert realized == -2000.0


@pytest.mark.asyncio
async def test_daily_loss_check_rejects_at_threshold() -> None:
    """Realised P&L > 5% of equity → rejects."""
    with (
        patch.object(trades_mod, "_get_realized_pnl_today", new=AsyncMock(return_value=-6000.0)),
        patch("api.routes.portfolio._get_unrealized_pnl_today", new=AsyncMock(return_value=0.0)),
    ):
        passed, reason, realized = await trades_mod._daily_loss_check(equity=100_000.0)
    assert passed is False
    assert "Daily loss limit reached" in reason
    assert realized == -6000.0


@pytest.mark.asyncio
async def test_daily_loss_check_skips_when_equity_zero() -> None:
    """Zero equity (broker unavailable) defers the decision."""
    passed, reason, realized = await trades_mod._daily_loss_check(equity=0.0)
    assert passed is True
    assert reason == "skipped_no_equity"


# --------------------------------------------------------------------------- #
# J-7 — quote staleness                                                       #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_quote_staleness_skipped_when_no_ts() -> None:
    """No quote_at_fill_ts → gate is a no-op."""
    leg = OrderLeg(
        symbol="AAPL", side=OrderSide.BUY, qty=10,
        order_type=OrderType.LIMIT, limit_price=150.0,
    )
    req = CreateOrderRequest(legs=[leg])
    passed, reason = await trades_mod._quote_staleness_check(req)
    assert passed is True
    assert reason == "skipped_no_ts"


@pytest.mark.asyncio
async def test_quote_staleness_requires_ts_for_option_orders() -> None:
    """OCC option orders fail closed when the UI omits quote freshness."""
    leg = OrderLeg(
        symbol="AAPL260417C00200000", side=OrderSide.BUY, qty=1,
        order_type=OrderType.LIMIT, limit_price=5.0,
    )
    req = CreateOrderRequest(legs=[leg])
    passed, reason = await trades_mod._quote_staleness_check(req)
    assert passed is False
    assert "Quote freshness required" in reason


@pytest.mark.asyncio
async def test_aggregate_risk_rejects_option_when_chain_probe_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Option provenance must fail closed when chain freshness is unknown."""

    async def _tradable(_symbol: str) -> tuple[bool, str]:
        return True, "passed"

    monkeypatch.delenv("TRADES_ALLOW_DEMO_CHAIN_ORDERS", raising=False)
    monkeypatch.setattr(trades_mod, "_check_symbol_tradable", _tradable)
    with patch(
        "services.options.fetch_chain",
        new=AsyncMock(side_effect=RuntimeError("polygon unavailable")),
    ):
        leg = OrderLeg(
            symbol="AAPL260417C00200000",
            side=OrderSide.BUY,
            qty=1,
            order_type=OrderType.LIMIT,
            limit_price=5.0,
            asset_class="option",
        )
        req = CreateOrderRequest(
            legs=[leg],
            quote_at_fill_ts=time.time(),
        )
        passed, reason = await trades_mod._aggregate_risk_check(req)

    assert passed is False
    assert "Options chain verification unavailable" in reason


def test_occ_symbol_infers_option_asset_class() -> None:
    """Legacy callers cannot leave OCC legs classified as equity."""
    leg = OrderLeg(
        symbol="aapl260417c00200000".upper(),
        side=OrderSide.BUY,
        qty=1,
        order_type=OrderType.LIMIT,
        limit_price=5.0,
    )
    assert leg.asset_class == "option"


# --------------------------------------------------------------------------- #
# J-6 — live account preflight                                                #
# --------------------------------------------------------------------------- #


def _single_equity_limit_order() -> CreateOrderRequest:
    return CreateOrderRequest(
        legs=[
            OrderLeg(
                symbol="AAPL",
                side=OrderSide.BUY,
                qty=1,
                order_type=OrderType.LIMIT,
                limit_price=100.0,
            )
        ]
    )


@pytest.mark.asyncio
async def test_live_aggregate_risk_rejects_when_account_preflight_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Live mode must not approve orders without current account data."""

    async def _tradable(_symbol: str) -> tuple[bool, str]:
        return True, "passed"

    monkeypatch.setattr(trades_mod, "_live_broker_intent_enabled", lambda: True)
    monkeypatch.setattr(trades_mod, "_check_symbol_tradable", _tradable)
    monkeypatch.setattr(trades_mod, "_compute_order_notional", AsyncMock(return_value=100.0))
    monkeypatch.setattr(trades_mod, "_get_todays_gross_notional", AsyncMock(return_value=0.0))
    monkeypatch.setattr(
        trades_mod,
        "_get_account_equity_and_buying_power",
        AsyncMock(return_value=(0.0, 0.0)),
    )

    passed, reason = await trades_mod._aggregate_risk_check(_single_equity_limit_order())

    assert passed is False
    assert "Account preflight unavailable" in reason


@pytest.mark.asyncio
async def test_live_aggregate_risk_rejects_buy_when_buying_power_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Live buy orders require a positive buying-power snapshot."""

    async def _tradable(_symbol: str) -> tuple[bool, str]:
        return True, "passed"

    monkeypatch.setattr(trades_mod, "_live_broker_intent_enabled", lambda: True)
    monkeypatch.setattr(trades_mod, "_check_symbol_tradable", _tradable)
    monkeypatch.setattr(trades_mod, "_compute_order_notional", AsyncMock(return_value=100.0))
    monkeypatch.setattr(trades_mod, "_get_todays_gross_notional", AsyncMock(return_value=0.0))
    monkeypatch.setattr(
        trades_mod,
        "_get_account_equity_and_buying_power",
        AsyncMock(return_value=(100_000.0, 0.0)),
    )

    passed, reason = await trades_mod._aggregate_risk_check(_single_equity_limit_order())

    assert passed is False
    assert "Buying-power preflight unavailable" in reason


@pytest.mark.asyncio
async def test_paper_aggregate_risk_keeps_legacy_account_preflight_skip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Paper/dev flows can still run without live broker account data."""

    async def _tradable(_symbol: str) -> tuple[bool, str]:
        return True, "passed"

    monkeypatch.setattr(trades_mod, "_live_broker_intent_enabled", lambda: False)
    monkeypatch.setattr(trades_mod, "_check_symbol_tradable", _tradable)
    monkeypatch.setattr(trades_mod, "_compute_order_notional", AsyncMock(return_value=100.0))
    monkeypatch.setattr(trades_mod, "_get_todays_gross_notional", AsyncMock(return_value=0.0))
    monkeypatch.setattr(
        trades_mod,
        "_get_account_equity_and_buying_power",
        AsyncMock(return_value=(0.0, 0.0)),
    )
    monkeypatch.setattr(
        trades_mod,
        "_get_open_position_count_and_sector_exposure",
        AsyncMock(return_value=(0, {}, 0.0)),
    )

    passed, reason = await trades_mod._aggregate_risk_check(_single_equity_limit_order())

    assert passed is True
    assert reason == "passed"


@pytest.mark.asyncio
async def test_quote_staleness_rejects_old_snapshot() -> None:
    """Snapshot older than 30s → rejected."""
    leg = OrderLeg(
        symbol="AAPL", side=OrderSide.BUY, qty=10,
        order_type=OrderType.LIMIT, limit_price=150.0,
    )
    req = CreateOrderRequest(
        legs=[leg],
        quote_at_fill_ts=time.time() - 120,  # 2-min stale
    )
    passed, reason = await trades_mod._quote_staleness_check(req)
    assert passed is False
    assert "Quote staleness" in reason


@pytest.mark.asyncio
async def test_quote_drift_rejects_distant_limit() -> None:
    """Limit price > 0.5% from current quote → rejected."""
    leg = OrderLeg(
        symbol="AAPL", side=OrderSide.BUY, qty=10,
        order_type=OrderType.LIMIT, limit_price=200.0,  # 33% above 150
    )
    req = CreateOrderRequest(
        legs=[leg],
        quote_at_fill_ts=time.time() - 5,  # fresh
    )
    with patch.object(
        trades_mod, "_get_current_price", new=AsyncMock(return_value=150.0),
    ):
        passed, reason = await trades_mod._quote_staleness_check(req)
    assert passed is False
    assert "Quote drift" in reason


@pytest.mark.asyncio
async def test_quote_drift_fails_closed_when_option_quote_unavailable() -> None:
    """Fresh timestamp is not enough if an OCC leg has no live option quote."""
    leg = OrderLeg(
        symbol="AAPL260417C00200000",
        side=OrderSide.BUY,
        qty=1,
        order_type=OrderType.LIMIT,
        limit_price=2.0,
    )
    req = CreateOrderRequest(
        legs=[leg],
        quote_at_fill_ts=time.time() - 5,
    )
    with patch.object(
        trades_mod, "_get_current_option_mid", new=AsyncMock(return_value=0.0),
    ):
        passed, reason = await trades_mod._quote_staleness_check(req)
    assert passed is False
    assert "live option quote unavailable" in reason


@pytest.mark.asyncio
async def test_quote_drift_uses_option_mid_for_occ_legs() -> None:
    """OCC drift compares against option NBBO mid, not the equity quote path."""
    leg = OrderLeg(
        symbol="AAPL260417C00200000",
        side=OrderSide.BUY,
        qty=1,
        order_type=OrderType.LIMIT,
        limit_price=2.01,
    )
    req = CreateOrderRequest(
        legs=[leg],
        quote_at_fill_ts=time.time() - 5,
    )
    with patch.object(
        trades_mod, "_get_current_option_mid", new=AsyncMock(return_value=2.0),
    ), patch.object(
        trades_mod, "_get_current_price", new=AsyncMock(side_effect=AssertionError("equity quote path used for OCC")),
    ):
        passed, reason = await trades_mod._quote_staleness_check(req)
    assert passed is True
    assert reason == "passed"


# --------------------------------------------------------------------------- #
# J-11 — symbol halt / tradability                                            #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_symbol_tradable_passes_with_active_status() -> None:
    """Cached active symbol → passes."""
    with patch(
        "core.redis.cache_get",
        new=AsyncMock(return_value={"tradable": True, "reason": "passed"}),
    ):
        passed, reason = await trades_mod._check_symbol_tradable("AAPL")
    assert passed is True


@pytest.mark.asyncio
async def test_symbol_tradable_rejects_halted_cached() -> None:
    """Cached halted symbol → rejected."""
    with patch(
        "core.redis.cache_get",
        new=AsyncMock(return_value={"tradable": False, "reason": "Symbol halted"}),
    ):
        passed, reason = await trades_mod._check_symbol_tradable("AAPL")
    assert passed is False
    assert "halted" in reason


# --------------------------------------------------------------------------- #
# L-12 — combo_type / combo_correlation_id sanitisation                       #
# --------------------------------------------------------------------------- #


def test_combo_type_accepts_known_literals() -> None:
    """Round-12 / DR-1: defined-risk allowlist replaces ``strangle``
    with the protective shapes ``iron_butterfly``, ``calendar_spread``,
    ``diagonal_spread``, ``cash_secured_put``, ``married_put``."""
    leg = OrderLeg(
        symbol="AAPL", side=OrderSide.BUY, qty=1,
        order_type=OrderType.LIMIT, limit_price=150.0,
    )
    accepted = (
        "iron_condor",
        "iron_butterfly",
        "vertical_spread",
        "calendar_spread",
        "diagonal_spread",
        "covered_call",
        "cash_secured_put",
        "married_put",
    )
    for v in accepted:
        req = CreateOrderRequest(legs=[leg], combo_type=v)
        assert req.combo_type == v


def test_combo_type_rejects_unknown() -> None:
    leg = OrderLeg(
        symbol="AAPL", side=OrderSide.BUY, qty=1,
        order_type=OrderType.LIMIT, limit_price=150.0,
    )
    with pytest.raises(ValueError):
        CreateOrderRequest(legs=[leg], combo_type="bogus_combo")


def test_combo_correlation_id_accepts_uuid() -> None:
    leg = OrderLeg(
        symbol="AAPL", side=OrderSide.BUY, qty=1,
        order_type=OrderType.LIMIT, limit_price=150.0,
    )
    req = CreateOrderRequest(
        legs=[leg], combo_correlation_id="550e8400-e29b-41d4-a716-446655440000",
    )
    assert req.combo_correlation_id == "550e8400-e29b-41d4-a716-446655440000"


def test_combo_correlation_id_rejects_non_uuid() -> None:
    leg = OrderLeg(
        symbol="AAPL", side=OrderSide.BUY, qty=1,
        order_type=OrderType.LIMIT, limit_price=150.0,
    )
    with pytest.raises(ValueError):
        CreateOrderRequest(legs=[leg], combo_correlation_id="not_a_uuid")


# --------------------------------------------------------------------------- #
# J-15 — quote cache key uppercased                                           #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_quote_cache_key_uppercased() -> None:
    """Lowercased symbol still hits the uppercase cache key."""
    captured: list[str] = []

    async def fake_cache_get(key: str) -> Any:
        captured.append(key)
        return None

    with patch("core.redis.cache_get", new=fake_cache_get), \
         patch.object(trades_mod, "_alpaca_keys_empty", return_value=True):
        await trades_mod._get_current_price("aapl")

    assert captured == ["quote:AAPL"]


# --------------------------------------------------------------------------- #
# J-14 — BracketSpec model                                                    #
# --------------------------------------------------------------------------- #


def test_bracket_spec_requires_positive_levels() -> None:
    with pytest.raises(ValueError):
        BracketSpec(stop_loss=0.0, take_profit=200.0)
    with pytest.raises(ValueError):
        BracketSpec(stop_loss=140.0, take_profit=-1.0)


def test_create_order_with_bracket() -> None:
    leg = OrderLeg(
        symbol="AAPL", side=OrderSide.BUY, qty=10,
        order_type=OrderType.LIMIT, limit_price=150.0,
    )
    req = CreateOrderRequest(
        legs=[leg],
        bracket=BracketSpec(stop_loss=140.0, take_profit=160.0),
    )
    assert req.bracket is not None
    assert req.bracket.stop_loss == 140.0
    assert req.bracket.take_profit == 160.0


# --------------------------------------------------------------------------- #
# J-9 — reconcile_positions_on_boot                                           #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_reconcile_positions_on_boot_keys_missing_returns_zero_counts() -> None:
    """Without Alpaca keys the function returns zero counts and skips."""
    with patch.object(trades_mod, "_alpaca_keys_empty", return_value=True):
        result = await trades_mod.reconcile_positions_on_boot()
    assert result == {
        "matched": 0,
        "drift_qty": 0,
        "drift_orphan_local": 0,
        "drift_orphan_broker": 0,
    }


class _BootReconcileResponse:
    status_code = 200

    def __init__(self, payload: list[dict[str, Any]]) -> None:
        self._payload = payload

    def json(self) -> list[dict[str, Any]]:
        return self._payload


class _BootReconcileClient:
    payload: list[dict[str, Any]] = []

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> "_BootReconcileClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def get(self, _url: str, *, headers: dict[str, str]) -> _BootReconcileResponse:
        assert headers["APCA-API-KEY-ID"] == "TEST_KEY"
        assert headers["APCA-API-SECRET-KEY"] == "TEST_SECRET"
        return _BootReconcileResponse(self.__class__.payload)


@pytest.mark.asyncio
async def test_reconcile_positions_on_boot_uses_trade_ledger(monkeypatch: pytest.MonkeyPatch) -> None:
    """Boot drift should compare broker positions with the canonical ledger.

    The ORM ``trades`` table stores order history, not net strategy
    positions. Reading it here produced false drift alerts even after
    ``TradeLedger.sync_with_alpaca`` had aligned the actual ledger.
    """
    from core import config as core_config
    from data.ingestion import trade_ledger as ledger_mod

    class _Ledger:
        def get_open_positions(self) -> list[dict[str, Any]]:
            return [
                {"symbol": "AAPL", "shares": 10, "side": "long"},
                {"symbol": "TSLA", "shares": 3, "side": "short"},
            ]

    monkeypatch.setattr(trades_mod, "_alpaca_keys_empty", lambda: False)
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
    monkeypatch.setattr(core_config.settings, "SKIP_DB_INIT", False, raising=False)
    monkeypatch.setattr(trades_mod.httpx, "AsyncClient", _BootReconcileClient)
    monkeypatch.setattr(ledger_mod, "TradeLedger", _Ledger)
    _BootReconcileClient.payload = [
        {"symbol": "AAPL", "qty": "10"},
        {"symbol": "TSLA", "qty": "-3"},
    ]

    result = await trades_mod.reconcile_positions_on_boot()

    assert result == {
        "matched": 2,
        "drift_qty": 0,
        "drift_orphan_local": 0,
        "drift_orphan_broker": 0,
    }


def test_broker_open_order_notional_uses_option_multiplier() -> None:
    order = {
        "symbol": "AAPL260501C00270000",
        "qty": "2",
        "limit_price": "1.25",
    }
    assert trades_mod._broker_open_order_notional(order) == 250.0


def test_broker_open_order_notional_uses_spread_width_for_mleg() -> None:
    order = {
        "order_class": "mleg",
        "qty": "1",
        "limit_price": "0.85",
        "legs": [
            {"symbol": "AAPL260501C00270000", "side": "buy"},
            {"symbol": "AAPL260501C00275000", "side": "sell"},
        ],
    }
    assert trades_mod._broker_open_order_notional(order) == 500.0
