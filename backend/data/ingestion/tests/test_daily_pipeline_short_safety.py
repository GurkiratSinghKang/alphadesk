from __future__ import annotations

from typing import Any

import pytest


class _Resp:
    def __init__(self, payload: Any, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> Any:
        return self._payload


class _Client:
    def __init__(self, open_orders: list[dict] | None = None) -> None:
        self.open_orders = open_orders or []
        self.deleted: list[str] = []

    async def get(self, *args: Any, **kwargs: Any) -> _Resp:
        return _Resp(self.open_orders)

    async def delete(self, url: str, *args: Any, **kwargs: Any) -> _Resp:
        self.deleted.append(url)
        return _Resp({})


@pytest.mark.asyncio
async def test_check_exits_covers_short_take_profit(monkeypatch: pytest.MonkeyPatch) -> None:
    from data.ingestion import daily_pipeline as dp

    calls: list[dict] = []
    exits: list[dict] = []

    class _Ledger:
        def get_open_positions(self) -> list[dict]:
            return [{
                "id": 1,
                "symbol": "TSLA",
                "shares": 10,
                "entry_price": 100.0,
                "stop_loss": 105.0,
                "take_profit": 90.0,
                "side": "short",
                "strategy": "pairs_trading",
            }]

        def record_exit(self, symbol: str, shares: int, price: float, reason: str, side: str | None = None) -> None:
            exits.append({"symbol": symbol, "shares": shares, "price": price, "reason": reason, "side": side})

    async def _positions(client: Any, **kwargs: Any) -> list[dict]:
        return [{"symbol": "TSLA", "current_price": "90"}]

    async def _order(
        client: Any, symbol: str, qty: int, side: str, strategy: str = "unknown",
        **kwargs: Any,
    ) -> dict:
        calls.append({"symbol": symbol, "qty": qty, "side": side, "strategy": strategy})
        return {"id": "cover-1", "status": "accepted"}

    async def _fill(client: Any, order_id: str, **kwargs: Any) -> float:
        return 90.0

    monkeypatch.setattr(dp, "_get_positions", _positions)
    monkeypatch.setattr(dp, "_place_order", _order)
    monkeypatch.setattr(dp, "_poll_fill_price", _fill)

    closed = await dp._check_exits(_Client(), _Ledger())

    assert calls == [{"symbol": "TSLA", "qty": 10, "side": "buy", "strategy": "pairs_trading"}]
    assert exits == [{"symbol": "TSLA", "shares": 10, "price": 90.0, "reason": "take_profit", "side": "short"}]
    assert closed[0]["broker_side"] == "buy"


@pytest.mark.asyncio
async def test_ensure_stop_orders_uses_buy_stop_for_short(monkeypatch: pytest.MonkeyPatch) -> None:
    from data.ingestion import daily_pipeline as dp

    placed: list[dict] = []

    class _Ledger:
        def get_open_positions(self) -> list[dict]:
            return [{
                "symbol": "TSLA",
                "shares": 10,
                "entry_price": 100.0,
                "stop_loss": 105.0,
                "side": "short",
                "strategy": "pairs_trading",
            }]

    async def _stop(
        client: Any, symbol: str, qty: int, stop_price: float,
        side: str = "sell", strategy: str = "unknown",
        **kwargs: Any,
    ) -> dict:
        placed.append({"symbol": symbol, "qty": qty, "stop_price": stop_price, "side": side, "strategy": strategy})
        return {"id": "stop-1"}

    monkeypatch.setattr(dp, "_place_stop_order", _stop)

    result = await dp._ensure_stop_orders(_Client(open_orders=[]), _Ledger())

    assert placed == [{"symbol": "TSLA", "qty": 10, "stop_price": 105.0, "side": "buy", "strategy": "pairs_trading"}]
    assert result[0]["side"] == "buy"


@pytest.mark.asyncio
async def test_execute_approved_orders_respects_trade_cap_inside_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from data.ingestion import daily_pipeline as dp

    calls: list[dict] = []

    class _Ledger:
        def count_today_trades(self) -> int:
            return dp.MAX_DAILY_TRADES - 1

        def get_open_positions(self) -> list[dict]:
            return []

        def record_entry(self, **kwargs: Any) -> None:
            pass

        def update_entry_price(self, symbol: str, new_price: float) -> bool:
            return True

    class _Master:
        pending_orders = [
            {"strategy": "pead", "symbol": "AAPL", "side": "buy", "notional": 1000, "shares": 5, "entry_price": 0.0, "conviction": 80},
            {"strategy": "pead", "symbol": "MSFT", "side": "buy", "notional": 1000, "shares": 2, "entry_price": 0.0, "conviction": 80},
        ]
        existing_positions: dict[str, dict] = {}
        cash = 10_000.0

    async def _order(
        client: Any, symbol: str, qty: int, side: str, strategy: str = "unknown",
        **kwargs: Any,
    ) -> dict:
        calls.append({"symbol": symbol, "qty": qty, "side": side, "strategy": strategy})
        return {"id": f"{symbol}-1", "status": "accepted"}

    async def _no_fill(*args: Any, **kwargs: Any) -> None:
        return None

    async def _noop(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(dp, "_place_order", _order)
    monkeypatch.setattr(dp, "_poll_fill_price", _no_fill)
    monkeypatch.setattr(dp, "_outbox_create", _noop)
    monkeypatch.setattr(dp, "_outbox_update", _noop)
    monkeypatch.setattr(dp, "_outbox_delete", _noop)

    placed = await dp._execute_approved_orders(_Client(), _Master(), _Ledger())

    assert [c["symbol"] for c in calls] == ["AAPL"]
    assert [p["symbol"] for p in placed if "error" not in p] == ["AAPL"]


@pytest.mark.asyncio
async def test_sell_signal_without_open_position_never_opens_short(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from data.ingestion import daily_pipeline as dp

    calls: list[dict] = []

    class _Ledger:
        def count_today_trades(self) -> int:
            return 0

        def get_open_positions(self) -> list[dict]:
            return []

        def record_exit(self, *args: Any, **kwargs: Any) -> None:
            raise AssertionError("record_exit should not run for an untracked sell")

    class _Master:
        pending_orders = [
            {"strategy": "pead", "symbol": "AAPL", "side": "sell", "shares": 5, "entry_price": 180.0},
        ]

    async def _order(
        client: Any, symbol: str, qty: int, side: str, strategy: str = "unknown",
        **kwargs: Any,
    ) -> dict:
        calls.append({"symbol": symbol, "qty": qty, "side": side, "strategy": strategy})
        return {"id": "bad-short", "status": "accepted"}

    monkeypatch.setattr(dp, "_place_order", _order)

    placed = await dp._execute_approved_orders(_Client(), _Master(), _Ledger())

    assert calls == []
    assert placed == [{
        "symbol": "AAPL",
        "side": "sell",
        "shares": 5,
        "strategy": "pead",
        "error": "sell signal refused: no tracked open position for AAPL; use side='short' for new short exposure",
    }]


@pytest.mark.asyncio
async def test_sell_signal_cannot_exit_more_than_tracked_open_shares(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from data.ingestion import daily_pipeline as dp

    calls: list[dict] = []

    class _Ledger:
        def count_today_trades(self) -> int:
            return 0

        def get_open_positions(self) -> list[dict]:
            return [{"symbol": "AAPL", "shares": 2, "side": "long", "entry_price": 180.0}]

        def record_exit(self, *args: Any, **kwargs: Any) -> None:
            raise AssertionError("record_exit should not run when requested exit exceeds position")

    class _Master:
        pending_orders = [
            {"strategy": "pead", "symbol": "AAPL", "side": "sell", "shares": 5, "entry_price": 180.0},
        ]

    async def _order(
        client: Any, symbol: str, qty: int, side: str, strategy: str = "unknown",
        **kwargs: Any,
    ) -> dict:
        calls.append({"symbol": symbol, "qty": qty, "side": side, "strategy": strategy})
        return {"id": "too-large", "status": "accepted"}

    monkeypatch.setattr(dp, "_place_order", _order)

    placed = await dp._execute_approved_orders(_Client(), _Master(), _Ledger())

    assert calls == []
    assert placed[0]["error"] == (
        "sell signal refused: requested 5 shares of AAPL but only 2 are tracked open"
    )
