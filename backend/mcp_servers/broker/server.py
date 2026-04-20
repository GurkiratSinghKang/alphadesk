from __future__ import annotations

from typing import Any

import httpx

from core.config import settings
from mcp_servers.base import BaseMCPServer


class BrokerServer(BaseMCPServer):
    """MCP server for broker operations via Alpaca API."""

    name = "broker"

    def _headers(self) -> dict[str, str]:
        return {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }

    @BaseMCPServer.tool("get_account", "Retrieve current account information including equity, cash, and buying power")
    async def get_account(self) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/account",
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
        return {
            "equity": float(data.get("equity", 0)),
            "cash": float(data.get("cash", 0)),
            "buying_power": float(data.get("buying_power", 0)),
            "portfolio_value": float(data.get("portfolio_value", 0)),
            "day_trade_count": data.get("daytrade_count", 0),
            "pattern_day_trader": data.get("pattern_day_trader", False),
        }

    @BaseMCPServer.tool("get_positions", "List all open positions with current P&L")
    async def get_positions(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions",
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            {
                "symbol": p["symbol"],
                "qty": float(p["qty"]),
                "side": p["side"],
                "avg_entry_price": float(p["avg_entry_price"]),
                "current_price": float(p["current_price"]),
                "market_value": float(p["market_value"]),
                "unrealized_pl": float(p["unrealized_pl"]),
                "unrealized_plpc": float(p["unrealized_plpc"]),
            }
            for p in data
        ]

    @BaseMCPServer.tool(
        "submit_order",
        "Submit a new order to the broker",
        {
            "symbol": {"type": "string", "description": "Ticker symbol"},
            "qty": {"type": "number", "description": "Number of shares"},
            "side": {"type": "string", "description": "buy or sell"},
            "order_type": {"type": "string", "description": "market, limit, stop, stop_limit"},
            "limit_price": {"type": "number", "description": "Limit price (required for limit orders)", "optional": True},
            "time_in_force": {"type": "string", "description": "day, gtc, ioc, fok"},
            # Wave 5β Fix 3 (P108 P1): ``strategy`` is now REQUIRED. Prior
            # wave permitted ``None`` for back-compat; the live-trading gate
            # then received ``None`` and the denylist check was skipped. An
            # LLM agent submitting ``strategy=None`` could therefore route
            # denylisted ideas to live capital without triggering
            # ``reject_if_live_forbidden``. Requiring the originating
            # strategy forces every call through the gate.
            "strategy": {
                "type": "string",
                "description": "Originating strategy name (REQUIRED — gates live submissions)",
            },
        },
    )
    async def submit_order(
        self,
        symbol: str,
        qty: float,
        side: str,
        order_type: str = "market",
        limit_price: float | None = None,
        time_in_force: str = "day",
        strategy: str | None = None,
    ) -> dict[str, Any]:
        # Wave 5β Fix 3 (P108 P1): fail fast if no strategy supplied. The
        # signature retains the ``str | None`` type for ergonomics (agents
        # may omit the kwarg accidentally), but a missing strategy is a
        # programming error and must raise rather than fall through to the
        # broker — the live-trading denylist check is a no-op on ``None``.
        if strategy is None or not str(strategy).strip():
            raise ValueError(
                "mcp.broker.submit_order: 'strategy' is required. "
                "Manual / discretionary orders must pass the explicit "
                "'manual' strategy (or another non-empty identifier)."
            )

        # Wave-A bypass-fix: the MCP broker tool previously had ZERO live-
        # trading gates — an LLM agent invoking this tool could submit any
        # strategy to live capital. Personas 66/67/69 converged on this as the
        # most under-protected path. Enforce the centralized gate here.
        from core.trading_gate import reject_if_live_forbidden
        try:
            reject_if_live_forbidden(
                strategy,
                caller="mcp.broker.submit_order",
                http_context=False,
            )
        except RuntimeError as exc:
            return {
                "error": str(exc),
                "order_id": None,
                "status": "rejected_by_gate",
                "symbol": symbol,
                "qty": str(qty),
                "side": side,
                "type": order_type,
            }

        body: dict[str, Any] = {
            "symbol": symbol,
            "qty": str(qty),
            "side": side,
            "type": order_type,
            "time_in_force": time_in_force,
        }
        if limit_price is not None:
            body["limit_price"] = str(limit_price)

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.ALPACA_BASE_URL}/v2/orders",
                headers=self._headers(),
                json=body,
            )
            resp.raise_for_status()
            order = resp.json()

        return {
            "order_id": order["id"],
            "status": order["status"],
            "symbol": order["symbol"],
            "qty": order["qty"],
            "side": order["side"],
            "type": order["type"],
        }

    @BaseMCPServer.tool("cancel_order", "Cancel an existing order by ID", {"order_id": {"type": "string"}})
    async def cancel_order(self, order_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.delete(
                f"{settings.ALPACA_BASE_URL}/v2/orders/{order_id}",
                headers=self._headers(),
            )
        return {"cancelled": resp.status_code in (200, 204), "order_id": order_id}

    @BaseMCPServer.tool("list_orders", "List recent orders with optional status filter", {"status": {"type": "string", "optional": True}})
    async def list_orders(self, status: str = "open") -> list[dict[str, Any]]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/orders",
                headers=self._headers(),
                params={"status": status, "limit": 50},
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            {
                "id": o["id"],
                "symbol": o["symbol"],
                "side": o["side"],
                "qty": o["qty"],
                "type": o["type"],
                "status": o["status"],
                "submitted_at": o.get("submitted_at"),
                "filled_avg_price": o.get("filled_avg_price"),
            }
            for o in data
        ]

    @BaseMCPServer.tool("close_position", "Close an entire position for a symbol", {"symbol": {"type": "string"}})
    async def close_position(self, symbol: str) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.delete(
                f"{settings.ALPACA_BASE_URL}/v2/positions/{symbol}",
                headers=self._headers(),
            )
        return {"closed": resp.status_code in (200, 204), "symbol": symbol}
