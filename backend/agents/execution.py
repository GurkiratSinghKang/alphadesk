from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

from agents.base import BaseAgent, MODEL_HAIKU

logger = logging.getLogger("alphadesk.agents.execution")


# ---------------------------------------------------------------------------
# Trade gates replicated inline from ``backend/api/routes/trades.py``.
#
# Persona-65 F7 called out that ``ExecutionAgent.execute_trade`` submits to
# Alpaca without the risk check, dedup, DB persistence, or halt-flag
# enforcement that the manual `/trades/orders` handler runs. Until those
# gates are refactored into a shared helper (see TODO below), we run
# equivalent checks here so the agent path is no longer a risk bypass.
#
# TODO(wave-41 follow-up): extract ``_apply_trade_gates(symbol, side, qty,
# price, strategy, client_order_id)`` out of ``backend/api/routes/trades.py``
# (halt check + aggregate notional + Redis dedup + DB insert) and call it
# from both the manual HTTP handler and this agent path. Keeping the
# implementations in sync manually is a known hazard.
# ---------------------------------------------------------------------------

# Per-order notional ceiling mirroring trades._risk_check (BUG-026).
_AGENT_NOTIONAL_CEILING = 50_000.0
# Dedup window (seconds) — same 30s used by the HTTP path so a user
# clicking "submit" in the UI and an agent racing on the same idea do not
# both reach the broker.
_AGENT_DEDUP_TTL_SECONDS = 30
_AGENT_HALT_REDIS_KEY = "trading:halted"


async def _agent_is_trading_halted() -> bool:
    """Return True when the admin halt flag is set.

    Fails *closed* (treats Redis outage as halted) so a connectivity blip
    never turns into free trading through the agent path.
    """
    try:
        from core.redis import cache_get
        result = await cache_get(_AGENT_HALT_REDIS_KEY)
        if result is not None and isinstance(result, dict):
            return bool(result.get("halted", False))
        return False
    except Exception:
        logger.warning(
            "agent halt-flag check failed; treating as HALTED for safety",
            exc_info=True,
        )
        return True


async def _agent_check_duplicate(order_body: dict[str, Any]) -> bool:
    """Atomic SET NX dedup mirroring trades._check_duplicate_order.

    Returns ``True`` if this is a new request (ok to submit), ``False``
    if it duplicates another request seen in the last 30s. Keyed by a
    hash of the order body so identical legs collide with the manual path.
    """
    try:
        from core.redis import get_redis
        # Normalize the fields that make orders distinct — same shape the
        # HTTP dedup hash uses for equity orders (single-leg agent path).
        payload = {
            "s": order_body.get("symbol"),
            "sd": order_body.get("side"),
            "q": str(order_body.get("qty")),
            "t": order_body.get("type"),
            "lp": order_body.get("limit_price", ""),
            "sp": order_body.get("stop_price", ""),
            "tif": order_body.get("time_in_force", ""),
        }
        key_hash = hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest()
        cache_key = f"order_dedup:{key_hash}"
        redis = await get_redis()
        if redis is None:
            # Fail closed on dedup too — better to miss a trade than double it.
            return False
        was_set = await redis.set(
            cache_key, "1", nx=True, ex=_AGENT_DEDUP_TTL_SECONDS,
        )
        return bool(was_set)
    except Exception:
        logger.warning(
            "agent dedup check failed; blocking submission to avoid doubles",
            exc_info=True,
        )
        return False


async def _agent_persist_trade(
    *,
    symbol: str,
    strategy: str | None,
    side: str,
    order_body: dict[str, Any],
    client_order_id: str,
) -> None:
    """Best-effort DB insert mirroring trades.create_order's persist block.

    We keep the same fail-soft behaviour (broker submit succeeds even when
    DB is temporarily unavailable) but surface the warning so the operator
    can reconcile later — persona-65 F2 covers this split.
    """
    try:
        from core.config import settings as _s
        if _s.SKIP_DB_INIT:
            return
        from core.database import _get_session_factory
        from data.storage.models import Trade

        factory = _get_session_factory()
        async with factory() as db:
            trade = Trade(
                symbol=symbol,
                strategy=strategy or "agent_execution",
                legs=[order_body],
                entry_time=datetime.now(timezone.utc),
                status="submitted",
                notes=f"agent_execution client_order_id={client_order_id}",
                side="short" if side == "sell" else "long",
            )
            db.add(trade)
            await db.flush()
            await db.commit()
    except Exception:
        logger.warning(
            "ExecutionAgent: failed to persist Trade row (order still at broker)",
            exc_info=True,
        )


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
        """Execute a trade with full position sizing and safety checks.

        Now honours the same gates as the manual ``POST /trades/orders``
        endpoint — persona-65 F7:

        * Halt flag — if ``trading:halted`` is set in Redis, refuse.
        * Aggregate notional check — single-order $50k cap (BUG-026).
        * Redis dedup — SET NX EX 30 under ``order_dedup:{hash}``.
        * Client order id — stable correlation key forwarded to Alpaca.
        * Best-effort Trade row insert for ledger parity.
        """
        from core.redis import cache_get
        from core.config import settings
        import httpx
        import uuid

        # Halt flag FIRST — refuse even to read market data if trading
        # has been admin-halted. Mirrors trades.create_order's first check.
        if await _agent_is_trading_halted():
            return {
                "success": False,
                "error": "Trading is halted. Admin must /trades/resume first.",
            }

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

            limit_price = round(spot * (1.001 if side == "buy" else 0.999), 2)

            # Aggregate notional sanity check (mirrors trades._risk_check).
            notional = limit_price * shares
            if notional > _AGENT_NOTIONAL_CEILING:
                return {
                    "success": False,
                    "error": (
                        f"Agent order notional ${notional:,.0f} exceeds "
                        f"${_AGENT_NOTIONAL_CEILING:,.0f} single-order cap."
                    ),
                }

            # Stable correlation key so broker rows can be matched back to
            # this agent invocation after a crash. Persona-65 F1 / F7.
            client_order_id = (
                f"agent_exec_{symbol}_{uuid.uuid4().hex[:12]}"
            )

            order_body = {
                "symbol": symbol,
                "qty": str(shares),
                "side": side,
                "type": "limit",
                "time_in_force": "day",
                "limit_price": str(limit_price),
                "client_order_id": client_order_id,
            }
        else:
            order_body = self._build_multi_leg_order(legs, side)
            # Multi-leg path inherits the structure-supplied id or gets a
            # fresh one — same correlation guarantee as the equity path.
            client_order_id = order_body.get("client_order_id") or (
                f"agent_exec_{symbol}_{uuid.uuid4().hex[:12]}"
            )
            order_body["client_order_id"] = client_order_id
            # Multi-leg notional check uses the naive sum (best-effort —
            # options combos have complex margin; this still catches
            # "clearly too big" typos before they reach Alpaca).
            try:
                ml_notional = sum(
                    float(l.get("qty", 0)) * float(l.get("limit_price", spot))
                    for l in legs
                )
                if ml_notional > _AGENT_NOTIONAL_CEILING:
                    return {
                        "success": False,
                        "error": (
                            f"Agent multi-leg notional ${ml_notional:,.0f} "
                            f"exceeds ${_AGENT_NOTIONAL_CEILING:,.0f} cap."
                        ),
                    }
            except Exception:
                logger.warning(
                    "Could not compute multi-leg notional for %s; proceeding "
                    "without ceiling check", symbol, exc_info=True,
                )

        # Dedup check AFTER we've built the final body so it matches the
        # shape the HTTP path hashes. Burns the key atomically — if another
        # request already claimed this hash inside the 30s window, bail.
        if not await _agent_check_duplicate(order_body):
            return {
                "success": False,
                "error": (
                    "Duplicate order detected (same symbol/qty/side/price in "
                    "last 30s). Wait before resubmitting."
                ),
            }

        # Submit order
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.ALPACA_BASE_URL}/v2/orders",
                headers=headers,
                json=order_body,
            )
            if resp.status_code in (200, 201):
                order = resp.json()
                # Best-effort ledger insert so the DB matches Alpaca for
                # the agent path too. Persona-65 F2 / F7.
                await _agent_persist_trade(
                    symbol=symbol,
                    strategy=structure.get("strategy"),
                    side=side,
                    order_body=order_body,
                    client_order_id=client_order_id,
                )
                return {
                    "success": True,
                    "order_id": order["id"],
                    "client_order_id": client_order_id,
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
