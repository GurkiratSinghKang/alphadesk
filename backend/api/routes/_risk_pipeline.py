"""Shared aggregate risk-check pipeline used by every order-entry path.

J-8 (Round-6) — until this module landed, ``_aggregate_risk_check`` lived
inside ``api/routes/trades.py`` only. The TradingView webhook
(``api/routes/webhooks.py``) and the MCP broker tool
(``mcp_servers/broker/server.py``) bypassed every gate the manual order
path enforced: restricted-symbol deny-list, wash-trade detection,
closing-auction throttle, daily-gross / position-count / sector caps,
quote staleness, buying-power preflight, daily-loss limit, symbol halt.

This file is intentionally a thin shim: it imports the original helpers
back from ``trades.py`` and exposes a single ``run_aggregate_risk_check``
entry-point. We do NOT duplicate the implementation here — that would
guarantee the gates drift out of sync between the two callers.

The directive in Round-6 was specifically: DO NOT use
``backend/core/risk_pipeline.py`` — FIX-2 owns ``core/``. So we host the
shared entry-point under ``api/routes/`` where both callers already
import from. Once FIX-2 lands a clean ``core/risk_pipeline.py`` we can
re-point this shim at the canonical location.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from api.routes.trades import CreateOrderRequest


async def run_aggregate_risk_check(
    request: "CreateOrderRequest",
    *,
    username: str | None = None,
) -> tuple[bool, str]:
    """Run the aggregate / portfolio-level risk gates against a request.

    Mirrors the semantics of ``api.routes.trades._aggregate_risk_check``
    1:1 — both webhook and MCP order paths now go through this entry
    point so a deny-list / wash-trade / closing-auction / daily-loss
    rejection shows the exact same string regardless of which surface
    triggered it.
    """
    from api.routes.trades import _aggregate_risk_check, _is_trading_halted

    if await _is_trading_halted():
        return (
            False,
            "Emergency halt active. Use POST /api/v1/trades/resume to resume.",
        )
    return await _aggregate_risk_check(request, username=username)


async def build_request_from_webhook(
    *,
    ticker: str,
    side: str,
    qty: float,
    limit_price: float | None = None,
    strategy: str | None = None,
    order_type: str | None = None,
    time_in_force: str = "day",
    extended_hours: bool = False,
) -> "CreateOrderRequest":
    """Helper for webhook / MCP callers to build a ``CreateOrderRequest``.

    Centralises the conversion so a future model-shape change only
    needs to be edited in one place. Defaults match the manual-order
    handler's defaults (TIF=DAY, single leg, equity asset class).
    """
    from api.routes.trades import (
        CreateOrderRequest,
        OrderLeg,
        OrderSide,
        OrderType,
        TimeInForce,
    )
    side_normalised = OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL
    order_type_normalised = (
        OrderType(order_type.lower())
        if order_type
        else (OrderType.LIMIT if limit_price is not None else OrderType.MARKET)
    )
    leg = OrderLeg(
        symbol=ticker.upper(),
        side=side_normalised,
        qty=qty,
        order_type=order_type_normalised,
        limit_price=limit_price,
    )
    return CreateOrderRequest(
        legs=[leg],
        time_in_force=TimeInForce(time_in_force.lower()),
        strategy=strategy,
        extended_hours=extended_hours,
    )


async def submit_order_via_api(
    request: "CreateOrderRequest",
    *,
    username: str = "mcp",
    idempotency_key: str | None = None,
) -> object:
    """Submit through ``api.routes.trades.create_order`` without HTTP I/O.

    MCP and other in-process automation callers must share the same order
    route as the web app: halt checks, market-hours gating, idempotency,
    rate limits, aggregate risk, per-order caps, audit logs, broker submit,
    ledger persistence, and websocket publication. Calling the route handler
    directly keeps the path in-process while avoiding the old direct-Alpaca
    bypass.
    """
    from fastapi import Request
    from api.routes.trades import create_order

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/mcp/broker/submit_order",
        "headers": [],
        "client": ("mcp", 0),
        "server": ("mcp", 0),
        "scheme": "http",
    }
    http_request = Request(scope)
    return await create_order(
        request,
        http_request=http_request,
        username=username,
        idempotency_key=idempotency_key,
    )
