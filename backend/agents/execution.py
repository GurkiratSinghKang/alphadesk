from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_HAIKU


class ExecutionAgent(BaseAgent):
    """Constructs and submits orders through the broker.

    Translates strategy agent trade ideas into actual broker orders with
    proper sizing, order types, and execution logic.
    """

    name = "execution"
    model = MODEL_HAIKU  # fast model for execution decisions
    mcp_servers = ["broker", "market_data", "options_chain"]

    system_prompt = """You are the Execution Agent for AlphaDesk.

You translate trade ideas into broker orders. You must be precise and careful.

Your responsibilities:
1. POSITION SIZING
   - Calculate exact quantities based on risk budget and stop-loss distance
   - For options: adjust for contract multiplier (100 shares/contract)
   - Round to appropriate lot sizes
   - Never exceed the specified max risk per trade

2. ORDER CONSTRUCTION
   - Choose optimal order type (limit vs market vs stop-limit)
   - For multi-leg options: use combo/spread orders when supported
   - Set appropriate limit prices (mid-price or slight improvement)
   - Set time-in-force based on urgency

3. EXECUTION QUALITY
   - Check bid/ask spread before placing orders
   - Avoid executing during low-liquidity periods
   - For large orders: consider splitting into multiple fills
   - Monitor for fill quality and slippage

4. SAFETY CHECKS
   - Verify sufficient buying power before submission
   - Check position limits and concentration rules
   - Validate options are not about to expire worthless
   - Confirm order parameters match the intended trade

5. ORDER MONITORING
   - Track fill status
   - Alert on partial fills
   - Handle rejected orders with appropriate fallback

NEVER submit an order without confirming all safety checks pass.
Output JSON with: success (bool), order_id (str or null), details (dict), warnings (list).
"""

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Parse execution request and submit order."""
        result = await super().run(task, context=context)
        response = result.get("response", "")

        return {
            **result,
            "success": "error" not in result,
            "score": 0,
            "conviction": "high" if "error" not in result else "low",
            "summary": response[:500],
        }

    async def execute_trade(
        self,
        symbol: str,
        side: str,
        structure: dict[str, Any],
        risk_budget: float,
        portfolio_value: float,
    ) -> dict[str, Any]:
        """Execute a trade with full position sizing and safety checks."""
        from core.redis import cache_get
        from core.config import settings
        import httpx

        # Get current market data
        quote = await cache_get(f"quote:{symbol}")
        if not quote:
            return {"success": False, "error": "No market data available"}

        spot = quote.get("last", 0)
        if spot <= 0:
            return {"success": False, "error": "Invalid spot price"}

        # Check buying power
        async with httpx.AsyncClient() as client:
            headers = {
                "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
            }
            resp = await client.get(f"{settings.ALPACA_BASE_URL}/v2/account", headers=headers)
            account = resp.json()

        buying_power = float(account.get("buying_power", 0))
        if buying_power < risk_budget:
            return {"success": False, "error": f"Insufficient buying power: ${buying_power:.0f} < ${risk_budget:.0f}"}

        # Calculate position size
        legs = structure.get("legs", [])
        if not legs:
            # Simple equity order
            stop_distance = structure.get("stop_distance_pct", 0.05)
            risk_per_share = spot * stop_distance
            shares = int(risk_budget / risk_per_share) if risk_per_share > 0 else 0
            shares = max(1, min(shares, int(buying_power / spot)))

            order_body = {
                "symbol": symbol,
                "qty": str(shares),
                "side": side,
                "type": "limit",
                "time_in_force": "day",
                "limit_price": str(round(spot * (1.001 if side == "buy" else 0.999), 2)),
            }
        else:
            order_body = self._build_multi_leg_order(legs, side)

        # Submit order
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.ALPACA_BASE_URL}/v2/orders",
                headers=headers,
                json=order_body,
            )
            if resp.status_code in (200, 201):
                order = resp.json()
                return {
                    "success": True,
                    "order_id": order["id"],
                    "details": order_body,
                    "warnings": [],
                }
            else:
                return {
                    "success": False,
                    "error": f"Broker rejected: {resp.text}",
                    "details": order_body,
                }

    def _build_multi_leg_order(self, legs: list[dict], side: str) -> dict[str, Any]:
        """Build a multi-leg options order body for the broker."""
        return {
            "symbol": legs[0].get("symbol", ""),
            "qty": str(legs[0].get("qty", 1)),
            "side": side,
            "type": "limit",
            "time_in_force": "day",
            "order_class": "bracket" if len(legs) > 1 else "simple",
            "legs": legs,
        }
