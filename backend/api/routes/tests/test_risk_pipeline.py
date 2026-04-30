from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from api.routes import _risk_pipeline
from api.routes.trades import CreateOrderRequest, OrderLeg, OrderSide, OrderType


def _request() -> CreateOrderRequest:
    return CreateOrderRequest(
        legs=[
            OrderLeg(
                symbol="AAPL",
                side=OrderSide.BUY,
                qty=1,
                order_type=OrderType.LIMIT,
                limit_price=100.0,
            )
        ],
    )


@pytest.mark.asyncio
async def test_shared_risk_pipeline_honors_admin_halt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Webhook/MCP order paths must stop at the admin halt before risk work."""
    from api.routes import trades as trades_mod

    aggregate = AsyncMock(return_value=(True, "passed"))
    monkeypatch.setattr(trades_mod, "_is_trading_halted", AsyncMock(return_value=True))
    monkeypatch.setattr(trades_mod, "_aggregate_risk_check", aggregate)

    passed, reason = await _risk_pipeline.run_aggregate_risk_check(_request())

    assert passed is False
    assert "Emergency halt active" in reason
    aggregate.assert_not_awaited()


@pytest.mark.asyncio
async def test_shared_risk_pipeline_delegates_when_not_halted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api.routes import trades as trades_mod

    aggregate = AsyncMock(return_value=(True, "passed"))
    monkeypatch.setattr(trades_mod, "_is_trading_halted", AsyncMock(return_value=False))
    monkeypatch.setattr(trades_mod, "_aggregate_risk_check", aggregate)

    passed, reason = await _risk_pipeline.run_aggregate_risk_check(_request())

    assert (passed, reason) == (True, "passed")
    aggregate.assert_awaited_once()
