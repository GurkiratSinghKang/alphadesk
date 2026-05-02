from __future__ import annotations

from typing import Any

import pytest


class _FakeResponse:
    status_code = 200

    def __init__(self, payload: list[dict[str, Any]]) -> None:
        self._payload = payload

    def json(self) -> list[dict[str, Any]]:
        return self._payload


class _FakeAsyncClient:
    payload: list[dict[str, Any]] = []
    captured_params: dict[str, Any] | None = None

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def get(self, _url: str, *, headers: dict[str, str], params: dict[str, Any]) -> _FakeResponse:
        assert headers["APCA-API-KEY-ID"] == "TEST_KEY"
        assert headers["APCA-API-SECRET-KEY"] == "TEST_SECRET"
        self.__class__.captured_params = params
        return _FakeResponse(self.__class__.payload)


class _FakePostResponse:
    status_code = 201
    text = "{}"

    def json(self) -> dict[str, Any]:
        return {"id": "broker-new-mleg"}


class _FakePostAsyncClient:
    captured_json: dict[str, Any] | None = None

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> "_FakePostAsyncClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def post(
        self,
        _url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> _FakePostResponse:
        assert headers["APCA-API-KEY-ID"] == "TEST_KEY"
        assert headers["APCA-API-SECRET-KEY"] == "TEST_SECRET"
        self.__class__.captured_json = json
        return _FakePostResponse()


@pytest.mark.asyncio
async def test_list_orders_preserves_nested_mleg_option_legs(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.routes import trades as trades_mod
    from core import config as core_config

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
    monkeypatch.setattr("httpx.AsyncClient", _FakeAsyncClient)

    _FakeAsyncClient.payload = [
        {
            "id": "broker-mleg-1",
            "status": "new",
            "symbol": "AAPL",
            "side": "buy",
            "qty": "1",
            "type": "limit",
            "time_in_force": "day",
            "order_class": "mleg",
            "submitted_at": "2026-04-30T13:30:00+00:00",
            "legs": [
                {"symbol": "AAPL260501P00260000", "side": "sell", "qty": "1", "type": "limit", "limit_price": "1.1", "asset_class": "us_option"},
                {"symbol": "AAPL260501P00255000", "side": "buy", "qty": "1", "type": "limit", "limit_price": "0.55", "asset_class": "us_option"},
                {"symbol": "AAPL260501C00280000", "side": "sell", "qty": "1", "type": "limit", "limit_price": "1.2", "asset_class": "us_option"},
                {"symbol": "AAPL260501C00285000", "side": "buy", "qty": "1", "type": "limit", "limit_price": "0.6", "asset_class": "us_option"},
            ],
        }
    ]

    orders = await trades_mod.list_orders(status=None, limit=50, offset=0)

    assert _FakeAsyncClient.captured_params == {"limit": 50, "nested": "true", "status": "all"}
    assert len(orders) == 1
    assert orders[0].combo_type == "mleg"
    assert [leg.symbol for leg in orders[0].legs] == [
        "AAPL260501P00260000",
        "AAPL260501P00255000",
        "AAPL260501C00280000",
        "AAPL260501C00285000",
    ]
    assert [leg.side.value for leg in orders[0].legs] == ["sell", "buy", "sell", "buy"]
    assert all(leg.asset_class == "option" for leg in orders[0].legs)


@pytest.mark.asyncio
async def test_list_orders_preserves_single_leg_stop_prices(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.routes import trades as trades_mod
    from core import config as core_config

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
    monkeypatch.setattr("httpx.AsyncClient", _FakeAsyncClient)

    _FakeAsyncClient.payload = [
        {
            "id": "broker-stop-1",
            "status": "accepted",
            "symbol": "MSFT",
            "side": "sell",
            "qty": "3",
            "type": "stop",
            "stop_price": "417.25",
            "time_in_force": "gtc",
            "submitted_at": "2026-04-30T13:31:00+00:00",
        }
    ]

    orders = await trades_mod.list_orders(status=None, limit=50, offset=0)

    assert len(orders) == 1
    assert len(orders[0].legs) == 1
    assert orders[0].legs[0].order_type.value == "stop"
    assert orders[0].legs[0].stop_price == 417.25


@pytest.mark.asyncio
async def test_submit_to_broker_uses_native_alpaca_mleg_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.routes import trades as trades_mod
    from api.routes.trades import CreateOrderRequest, OrderLeg, OrderSide, OrderType
    from core import config as core_config

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
    monkeypatch.setattr(core_config.settings, "ALPACA_BASE_URL", "https://paper-api.alpaca.markets")
    monkeypatch.setattr("httpx.AsyncClient", _FakePostAsyncClient)

    request = CreateOrderRequest(
        combo_type="vertical_spread",
        legs=[
            OrderLeg(
                symbol="AAPL260501C00270000",
                side=OrderSide.BUY,
                qty=1,
                order_type=OrderType.LIMIT,
                limit_price=1.25,
            ),
            OrderLeg(
                symbol="AAPL260501C00275000",
                side=OrderSide.SELL,
                qty=1,
                order_type=OrderType.LIMIT,
                limit_price=0.40,
            ),
        ],
    )

    broker_id = await trades_mod._submit_to_broker(
        request,
        core_config.settings,
        client_order_id="idem-mleg-1",
    )

    assert broker_id == "broker-new-mleg"
    assert _FakePostAsyncClient.captured_json == {
        "order_class": "mleg",
        "qty": "1",
        "type": "limit",
        "time_in_force": "day",
        "legs": [
            {
                "symbol": "AAPL260501C00270000",
                "ratio_qty": "1",
                "side": "buy",
                "position_intent": "buy_to_open",
            },
            {
                "symbol": "AAPL260501C00275000",
                "ratio_qty": "1",
                "side": "sell",
                "position_intent": "sell_to_open",
            },
        ],
        "limit_price": "0.85",
        "client_order_id": "idem-mleg-1",
    }


@pytest.mark.asyncio
async def test_submit_to_broker_preserves_credit_mleg_limit_sign(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.routes import trades as trades_mod
    from api.routes.trades import CreateOrderRequest, OrderLeg, OrderSide, OrderType
    from core import config as core_config

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
    monkeypatch.setattr(core_config.settings, "ALPACA_BASE_URL", "https://paper-api.alpaca.markets")
    monkeypatch.setattr("httpx.AsyncClient", _FakePostAsyncClient)

    request = CreateOrderRequest(
        combo_type="vertical_spread",
        legs=[
            OrderLeg(
                symbol="AAPL260501C00270000",
                side=OrderSide.SELL,
                qty=1,
                order_type=OrderType.LIMIT,
                limit_price=1.10,
            ),
            OrderLeg(
                symbol="AAPL260501C00275000",
                side=OrderSide.BUY,
                qty=1,
                order_type=OrderType.LIMIT,
                limit_price=0.55,
            ),
        ],
    )

    broker_id = await trades_mod._submit_to_broker(
        request,
        core_config.settings,
        client_order_id="idem-mleg-credit-1",
    )

    assert broker_id == "broker-new-mleg"
    assert _FakePostAsyncClient.captured_json is not None
    assert _FakePostAsyncClient.captured_json["limit_price"] == "-0.55"
