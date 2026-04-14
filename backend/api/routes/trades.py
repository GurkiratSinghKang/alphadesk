from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from core.auth import require_auth

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Emergency halt state (persisted in Redis)
# ---------------------------------------------------------------------------

async def _is_trading_halted() -> bool:
    """Check if trading is halted. FAILS CLOSED — blocks trading if Redis unavailable."""
    try:
        from core.redis import cache_get
        result = await cache_get("trading:halted")
        if result is not None:
            return result.get("halted", False)
        return False  # Key doesn't exist = not halted
    except Exception:
        logger.warning("Redis unavailable — trading halted as safety precaution")
        return True  # FAIL CLOSED: block trading when we can't check


async def _set_trading_halted(halted: bool) -> None:
    """Set trading halt state in Redis."""
    try:
        from core.redis import cache_set
        if halted:
            await cache_set("trading:halted", {"halted": True}, ttl_seconds=86400)  # 24h max
        else:
            from core.redis import get_redis
            redis = await get_redis()
            if redis:
                await redis.delete("trading:halted")
    except Exception:
        logger.warning("Failed to set trading halt state in Redis", exc_info=True)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class OrderSide(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"


class TimeInForce(str, Enum):
    DAY = "day"
    GTC = "gtc"
    IOC = "ioc"
    FOK = "fok"
    OPG = "opg"
    CLS = "cls"


class OrderStatus(str, Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    PARTIAL = "partial_fill"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class OrderLeg(BaseModel):
    symbol: str = Field(..., pattern=r"^[A-Z]{1,10}$")
    side: OrderSide
    qty: float = Field(..., gt=0, le=100000)
    order_type: OrderType = OrderType.LIMIT
    limit_price: float | None = None
    stop_price: float | None = None
    asset_class: str = Field("equity", description="equity or option")

    @field_validator("limit_price")
    @classmethod
    def limit_price_must_be_positive(cls, v: float | None) -> float | None:
        if v is not None and v <= 0:
            raise ValueError("limit_price must be greater than 0")
        return v

    @field_validator("stop_price")
    @classmethod
    def stop_price_must_be_positive(cls, v: float | None) -> float | None:
        if v is not None and v <= 0:
            raise ValueError("stop_price must be greater than 0")
        return v


class CreateOrderRequest(BaseModel):
    legs: list[OrderLeg] = Field(..., min_length=1, max_length=4)
    time_in_force: TimeInForce = TimeInForce.DAY
    strategy: str | None = Field(None, description="Originating strategy name")
    notes: str | None = Field(None, max_length=1000)


class OrderResponse(BaseModel):
    id: str
    status: OrderStatus
    legs: list[OrderLeg]
    time_in_force: TimeInForce
    strategy: str | None = None
    submitted_at: datetime
    filled_at: datetime | None = None
    avg_fill_price: float | None = None
    notes: str | None = None


class PositionResponse(BaseModel):
    symbol: str
    quantity: float
    side: str
    avg_cost: float
    current_price: float
    market_value: float
    unrealized_pnl: float
    unrealized_pnl_pct: float
    asset_class: str = "equity"


class TradeHistoryEntry(BaseModel):
    id: int
    symbol: str
    strategy: str | None = None
    side: str
    quantity: float
    entry_price: float
    exit_price: float | None = None
    pnl: float | None = None
    pnl_pct: float | None = None
    entry_time: datetime
    exit_time: datetime | None = None
    status: str
    notes: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _alpaca_keys_empty() -> bool:
    from core.config import settings
    return (
        not settings.ALPACA_API_KEY.get_secret_value()
        or not settings.ALPACA_SECRET_KEY.get_secret_value()
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/orders", response_model=OrderResponse, status_code=201)
async def create_order(
    request: CreateOrderRequest,
    username: str = Depends(require_auth),
) -> OrderResponse:
    """Submit a new order through the broker (Alpaca).

    Supports single-leg equity orders and multi-leg options orders.
    All orders pass through the RiskManagerAgent before submission.
    """
    if await _is_trading_halted():
        raise HTTPException(
            status_code=503,
            detail="Trading is halted. Use POST /api/v1/trades/resume to resume.",
        )

    if _alpaca_keys_empty():
        raise HTTPException(
            status_code=503,
            detail="Broker not configured. Add ALPACA_API_KEY and ALPACA_SECRET_KEY to .env to enable trading.",
        )

    # Reject market orders outside regular trading hours (9:30 AM – 4:00 PM ET)
    if any(leg.order_type == OrderType.MARKET for leg in request.legs):
        et_now = datetime.now(ZoneInfo("America/New_York"))
        if (
            et_now.weekday() >= 5
            or et_now.hour < 9
            or (et_now.hour == 9 and et_now.minute < 30)
            or et_now.hour >= 16
        ):
            raise HTTPException(
                status_code=400,
                detail="Market orders can only be placed during regular trading hours (9:30 AM - 4:00 PM ET)",
            )

    from core.config import settings
    from core.redis import publish

    # Risk check
    risk_ok, risk_msg = await _risk_check(request)
    if not risk_ok:
        raise HTTPException(status_code=422, detail=f"Risk check failed: {risk_msg}")

    # Duplicate order check
    await _check_duplicate_order(request)

    # Submit to broker
    order_id = await _submit_to_broker(request, settings)

    # Observability: log every submitted order with the acting user
    logger.info(
        "Order submitted: %s %s %s @ %s (user: %s)",
        request.legs[0].side,
        request.legs[0].qty,
        request.legs[0].symbol,
        "market" if request.legs[0].order_type == OrderType.MARKET else f"${request.legs[0].limit_price}",
        username,
    )

    # Persist trade record (best-effort)
    try:
        from core.config import settings as _s
        if not _s.SKIP_DB_INIT:
            from core.database import _get_session_factory
            from data.storage.models import Trade

            factory = _get_session_factory()
            async with factory() as db:
                trade = Trade(
                    symbol=request.legs[0].symbol,
                    strategy=request.strategy,
                    legs=[leg.model_dump() for leg in request.legs],
                    entry_time=datetime.now(timezone.utc),
                    status="submitted",
                    notes=request.notes,
                )
                db.add(trade)
                await db.flush()
                await db.commit()
    except Exception:
        logger.warning("Failed to persist trade record to DB (order still submitted to broker)", exc_info=True)

    response = OrderResponse(
        id=order_id,
        status=OrderStatus.SUBMITTED,
        legs=request.legs,
        time_in_force=request.time_in_force,
        strategy=request.strategy,
        submitted_at=datetime.now(timezone.utc),
        notes=request.notes,
    )

    # Notify via websocket
    await publish("portfolio", {
        "type": "order_submitted",
        "order": response.model_dump(mode="json"),
    })

    return response


@router.get("/orders", response_model=list[OrderResponse])
async def list_orders(
    status: OrderStatus | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
) -> list[OrderResponse]:
    """List recent orders, optionally filtered by status."""
    if _alpaca_keys_empty():
        return []

    try:
        from core.config import settings
        import httpx

        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }

        params: dict[str, Any] = {"limit": limit, "nested": "true"}
        if status:
            params["status"] = status.value

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/orders",
                headers=headers,
                params=params,
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch orders from broker")
            orders_data = resp.json()

        _alpaca_status_map: dict[str, OrderStatus] = {
            "new": OrderStatus.SUBMITTED,
            "accepted": OrderStatus.SUBMITTED,
            "partially_filled": OrderStatus.PARTIAL,
            "filled": OrderStatus.FILLED,
            "done_for_day": OrderStatus.FILLED,
            "canceled": OrderStatus.CANCELLED,
            "cancelled": OrderStatus.CANCELLED,
            "expired": OrderStatus.CANCELLED,
            "replaced": OrderStatus.CANCELLED,
            "rejected": OrderStatus.CANCELLED,
            "stopped": OrderStatus.FILLED,
            "suspended": OrderStatus.PENDING,
            "pending_new": OrderStatus.PENDING,
            "pending_cancel": OrderStatus.PENDING,
            "pending_replace": OrderStatus.PENDING,
        }

        return [
            OrderResponse(
                id=o["id"],
                status=_alpaca_status_map.get(o.get("status", ""), OrderStatus.PENDING),
                legs=[OrderLeg(
                    symbol=o["symbol"],
                    side=OrderSide(o["side"]),
                    qty=float(o.get("qty", 0)),
                    order_type=OrderType(o.get("type", "market")),
                    limit_price=float(o["limit_price"]) if o.get("limit_price") else None,
                )],
                time_in_force=TimeInForce(o.get("time_in_force", "day")),
                submitted_at=o.get("submitted_at", datetime.now(timezone.utc).isoformat()),
                filled_at=o.get("filled_at"),
                avg_fill_price=float(o["filled_avg_price"]) if o.get("filled_avg_price") else None,
            )
            for o in orders_data
        ]
    except HTTPException:
        raise
    except Exception:
        logger.warning("Failed to fetch orders from broker", exc_info=True)
        return []


@router.delete("/orders/{order_id}", status_code=204, response_model=None)
async def cancel_order(order_id: str) -> None:
    """Cancel a pending order by ID."""
    if _alpaca_keys_empty():
        raise HTTPException(
            status_code=503,
            detail="Broker not configured. Add ALPACA_API_KEY and ALPACA_SECRET_KEY to .env to enable trading.",
        )

    from core.config import settings
    import httpx

    headers = {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.delete(
            f"{settings.ALPACA_BASE_URL}/v2/orders/{order_id}",
            headers=headers,
        )
        if resp.status_code not in (200, 204):
            raise HTTPException(status_code=resp.status_code, detail="Failed to cancel order")


@router.get("/positions", response_model=list[PositionResponse])
async def list_positions() -> list[PositionResponse]:
    """Fetch all open positions from the broker."""
    if _alpaca_keys_empty():
        return []

    try:
        from core.config import settings
        import httpx

        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions",
                headers=headers,
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch positions")
            data = resp.json()

        return [
            PositionResponse(
                symbol=p["symbol"],
                quantity=float(p["qty"]),
                side=p["side"],
                avg_cost=float(p["avg_entry_price"]),
                current_price=float(p["current_price"]),
                market_value=float(p["market_value"]),
                unrealized_pnl=float(p["unrealized_pl"]),
                unrealized_pnl_pct=float(p["unrealized_plpc"]) * 100,
                asset_class=p.get("asset_class", "us_equity"),
            )
            for p in data
        ]
    except HTTPException:
        raise
    except Exception:
        logger.warning("Failed to fetch positions from broker", exc_info=True)
        return []


@router.get("/history", response_model=list[TradeHistoryEntry])
async def get_trade_history(
    symbol: str | None = Query(None),
    strategy: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
) -> list[TradeHistoryEntry]:
    """Retrieve historical trades from the trade ledger (primary) and local database (fallback)."""

    # Strategy route ID -> ledger strategy name mapping
    _ID_TO_LEDGER_NAME: dict[str, str] = {
        "momentum-quality": "momentum_quality",
        "pead": "pead",
        "vrp-harvesting": "vrp_harvest",
        "earnings-vol-premium": "earnings_vol",
        "regime-adaptive": "regime_adaptive",
        "claude-alpha": "claude_alpha",
        "mean-reversion": "mean_reversion",
        "vcp-breakout": "vcp_breakout",
        "manual-discretionary": "manual",
        "pairs-trading": "pairs_trading",
        "dividend-capture": "dividend_capture",
        "sector-rotation": "sector_rotation",
        "gap-fill": "gap_fill",
    }

    # Try trade ledger first (this is where pipeline trades live)
    try:
        from data.ingestion.trade_ledger import TradeLedger
        ledger = TradeLedger()
        all_trades = ledger._data.get("trades", [])

        # Filter by strategy if provided (map route ID to ledger name)
        if strategy:
            ledger_name = _ID_TO_LEDGER_NAME.get(strategy, strategy)
            all_trades = [t for t in all_trades if t.get("strategy") == ledger_name]

        # Filter by symbol if provided
        if symbol:
            sym_upper = symbol.upper()
            all_trades = [t for t in all_trades if t.get("symbol") == sym_upper]

        # Sort by entry_time descending, limit
        all_trades = sorted(all_trades, key=lambda t: t.get("entry_time", ""), reverse=True)[:limit]

        if all_trades:
            results: list[TradeHistoryEntry] = []
            for t in all_trades:
                entry_time_str = t.get("entry_time", "")
                exit_time_str = t.get("exit_time")
                try:
                    entry_dt = datetime.fromisoformat(entry_time_str) if entry_time_str else datetime.now(timezone.utc)
                except (ValueError, TypeError):
                    entry_dt = datetime.now(timezone.utc)
                try:
                    exit_dt = datetime.fromisoformat(exit_time_str) if exit_time_str else None
                except (ValueError, TypeError):
                    exit_dt = None

                results.append(TradeHistoryEntry(
                    id=t.get("id", 0),
                    symbol=t.get("symbol", ""),
                    strategy=t.get("strategy"),
                    side=t.get("side", "buy"),
                    quantity=float(t.get("shares", 0)),
                    entry_price=float(t.get("entry_price", 0)),
                    exit_price=float(t["exit_price"]) if t.get("exit_price") else None,
                    pnl=float(t["pnl"]) if t.get("pnl") is not None else None,
                    pnl_pct=float(t["pnl_pct"]) if t.get("pnl_pct") is not None else None,
                    entry_time=entry_dt,
                    exit_time=exit_dt,
                    status=t.get("status", "open"),
                    notes=t.get("rationale"),
                ))
            return results
    except Exception:
        logger.warning("Failed to retrieve trades from trade ledger, trying DB", exc_info=True)

    # Fallback to database
    from core.config import settings
    if settings.SKIP_DB_INIT:
        return []

    try:
        from sqlalchemy import select
        from data.storage.models import Trade
        from core.database import _get_session_factory

        factory = _get_session_factory()
        async with factory() as db:
            query = select(Trade).order_by(Trade.entry_time.desc()).limit(limit)
            if symbol:
                query = query.where(Trade.symbol == symbol.upper())
            if strategy:
                query = query.where(Trade.strategy == strategy)

            result = await db.execute(query)
            trades = result.scalars().all()

        results = []
        for t in trades:
            qty = t.legs[0].get("qty", 1) if t.legs else 1
            results.append(TradeHistoryEntry(
                id=t.id,
                symbol=t.symbol,
                strategy=t.strategy,
                side=t.legs[0].get("side", "buy") if t.legs else "buy",
                quantity=t.legs[0].get("qty", 0) if t.legs else 0,
                entry_price=t.entry_price or 0,
                exit_price=t.exit_price,
                pnl=t.pnl,
                pnl_pct=round(t.pnl / (t.entry_price * qty) * 100, 2) if t.pnl is not None and t.entry_price and t.entry_price > 0 else None,
                entry_time=t.entry_time,
                exit_time=t.exit_time,
                status=t.status,
                notes=t.notes,
            ))
        return results
    except Exception:
        logger.warning("Failed to retrieve trade history from DB", exc_info=True)
        return []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _check_duplicate_order(request: CreateOrderRequest) -> None:
    """Prevent duplicate orders within a 30-second window using atomic Redis SET NX."""
    from core.redis import get_redis

    # Create a hash of ALL legs (not just the first)
    order_key = hashlib.sha256(
        json.dumps(
            [{"s": l.symbol, "sd": l.side.value, "q": l.qty, "t": l.order_type.value} for l in request.legs],
            sort_keys=True,
        ).encode()
    ).hexdigest()

    cache_key = f"order_dedup:{order_key}"

    redis = await get_redis()
    if redis:
        # Atomic set-if-not-exists with 30s expiry — no race condition
        was_set = await redis.set(cache_key, "1", nx=True, ex=30)
        if not was_set:
            raise HTTPException(status_code=409, detail="Duplicate order detected. Please wait before resubmitting.")


async def _get_current_price(symbol: str) -> float:
    """Get current price for notional calculation.

    Checks Redis cache first, then falls back to Alpaca market data API.
    Returns 0.0 only if both sources fail.
    """
    from core.redis import cache_get
    cached = await cache_get(f"quote:{symbol}")
    if cached and cached.get("last"):
        return float(cached["last"])

    # Fallback: fetch latest trade from Alpaca
    try:
        from core.config import settings
        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"https://data.alpaca.markets/v2/stocks/{symbol}/trades/latest",
                headers=headers,
            )
            if resp.status_code == 200:
                price = resp.json().get("trade", {}).get("p", 0)
                if price and price > 0:
                    return float(price)
    except Exception:
        logger.warning("Failed to fetch price from Alpaca for %s", symbol)

    return 0.0


async def _risk_check(request: CreateOrderRequest) -> tuple[bool, str]:
    """Run risk checks before submitting an order (BUG-026: simple notional check)."""
    total_notional = 0.0
    for leg in request.legs:
        if leg.limit_price:
            total_notional += leg.limit_price * leg.qty
        else:
            price = await _get_current_price(leg.symbol)
            if price <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot determine price for {leg.symbol}. Use a limit order.",
                )
            total_notional += price * leg.qty

    if total_notional > 50_000:
        return False, f"Order notional ${total_notional:,.0f} exceeds single-order limit of $50,000"

    return True, "passed"


@router.post("/halt")
async def halt_trading(username: str = Depends(require_auth)):
    """Emergency halt — prevents all new orders."""
    await _set_trading_halted(True)
    # Cancel all open orders on Alpaca
    try:
        from core.config import settings
        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.delete(f"{settings.ALPACA_BASE_URL}/v2/orders", headers=headers)
    except Exception as e:
        logger.error("Failed to cancel orders during halt: %s", e)
    return {"halted": True, "message": "All trading halted. All open orders cancelled."}


@router.post("/resume")
async def resume_trading(username: str = Depends(require_auth)):
    """Resume trading after emergency halt."""
    try:
        await _set_trading_halted(False)
        # Verify the halt key was actually removed
        from core.redis import get_redis
        redis = await get_redis()
        if redis:
            still_halted = await redis.get("trading:halted")
            if still_halted:
                raise HTTPException(
                    status_code=503,
                    detail="Failed to resume trading — halt state could not be cleared.",
                )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Failed to resume trading — could not verify halt state was cleared.",
        )
    return {"halted": False, "message": "Trading resumed."}


# ---------------------------------------------------------------------------
# Price Alerts — Redis-persisted, real-time trigger checking
# ---------------------------------------------------------------------------

ALERTS_REDIS_KEY = "price_alerts"


class CreateAlertRequest(BaseModel):
    symbol: str = Field(..., pattern=r"^[A-Z]{1,10}$")
    price: float = Field(..., gt=0)
    condition: str = Field("above", pattern=r"^(above|below)$")


async def _get_all_alerts() -> list[dict]:
    """Retrieve all price alerts from Redis hash."""
    from core.redis import get_redis
    try:
        r = await get_redis()
        raw = await r.hgetall(ALERTS_REDIS_KEY)
        alerts = []
        for _id, data in raw.items():
            try:
                alert = json.loads(data) if isinstance(data, str) else json.loads(data.decode())
                alerts.append(alert)
            except Exception:
                continue
        # Sort by created_at descending
        alerts.sort(key=lambda a: a.get("created_at", ""), reverse=True)
        return alerts
    except Exception:
        logger.warning("Failed to retrieve alerts from Redis", exc_info=True)
        return []


async def _save_alert(alert: dict) -> None:
    """Save a single alert to Redis hash."""
    from core.redis import get_redis
    try:
        r = await get_redis()
        await r.hset(ALERTS_REDIS_KEY, alert["id"], json.dumps(alert))
    except Exception:
        logger.warning("Failed to save alert to Redis", exc_info=True)


async def _delete_alert_from_redis(alert_id: str) -> bool:
    """Delete a single alert from Redis hash. Returns True if deleted."""
    from core.redis import get_redis
    try:
        r = await get_redis()
        removed = await r.hdel(ALERTS_REDIS_KEY, alert_id)
        return removed > 0
    except Exception:
        logger.warning("Failed to delete alert from Redis", exc_info=True)
        return False


@router.get("/alerts")
async def list_alerts(
    symbol: str | None = Query(None),
    username: str = Depends(require_auth),
):
    """List all price alerts, optionally filtered by symbol."""
    alerts = await _get_all_alerts()
    if symbol:
        alerts = [a for a in alerts if a["symbol"] == symbol.upper()]
    return alerts


@router.post("/alerts", status_code=201)
async def create_alert(
    body: CreateAlertRequest,
    username: str = Depends(require_auth),
):
    """Create a new price alert. Persisted in Redis."""
    import uuid
    alert = {
        "id": f"alert-{uuid.uuid4().hex[:8]}",
        "symbol": body.symbol.upper(),
        "price": body.price,
        "condition": body.condition,
        "triggered": False,
        "triggered_at": None,
        "created_at": datetime.now(ZoneInfo("America/New_York")).isoformat(),
    }
    await _save_alert(alert)
    logger.info("Price alert created: %s %s $%.2f", alert["symbol"], alert["condition"], alert["price"])
    return alert


@router.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: str, username: str = Depends(require_auth)):
    """Delete a price alert by ID."""
    deleted = await _delete_alert_from_redis(alert_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"ok": True}


async def check_alerts_for_symbol(symbol: str, price: float) -> None:
    """Check if any alerts for this symbol should trigger.

    Called from the Alpaca stream when a new quote/trade arrives.
    When triggered, updates the alert in Redis and publishes a
    notification on the 'alerts' channel for real-time delivery.
    """
    if price <= 0:
        return

    from core.redis import publish

    alerts = await _get_all_alerts()
    for alert in alerts:
        if alert["symbol"] != symbol or alert.get("triggered"):
            continue

        should_trigger = (
            (alert["condition"] == "above" and price >= alert["price"])
            or (alert["condition"] == "below" and price <= alert["price"])
        )

        if should_trigger:
            alert["triggered"] = True
            alert["triggered_at"] = datetime.now(ZoneInfo("America/New_York")).isoformat()
            await _save_alert(alert)

            # Publish notification to all connected WebSocket clients
            await publish("alerts", {
                "id": f"triggered-{alert['id']}",
                "type": "price",
                "symbol": alert["symbol"],
                "message": f"Price Alert: {alert['symbol']} crossed {alert['condition']} ${alert['price']:.2f}",
                "time": int(datetime.now(timezone.utc).timestamp() * 1000),
                "acknowledged": False,
                "alert": alert,
            })
            logger.info(
                "Price alert triggered: %s %s $%.2f (current: $%.2f)",
                alert["symbol"], alert["condition"], alert["price"], price,
            )


async def _submit_to_broker(request: CreateOrderRequest, settings: Any) -> str:
    """Submit the order to Alpaca and return the broker order ID.

    Supports both single-leg equity orders and multi-leg options orders (BUG-027).
    """
    # Safety: reject live trading from the manual endpoint
    base_url = settings.ALPACA_BASE_URL
    if "paper" not in base_url.lower():
        raise HTTPException(
            status_code=403,
            detail="Live trading is not enabled. Manual orders are restricted to paper trading.",
        )

    import httpx

    headers = {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }

    if len(request.legs) == 1:
        # Single-leg order
        leg = request.legs[0]
        body: dict[str, Any] = {
            "symbol": leg.symbol,
            "qty": str(leg.qty),
            "side": leg.side.value,
            "type": leg.order_type.value,
            "time_in_force": request.time_in_force.value,
        }
        if leg.limit_price is not None:
            body["limit_price"] = str(leg.limit_price)
        if leg.stop_price is not None:
            body["stop_price"] = str(leg.stop_price)
    else:
        # Multi-leg order (options combo) (BUG-027)
        body = {
            "symbol": request.legs[0].symbol,
            "order_class": "mleg",
            "time_in_force": request.time_in_force.value,
            "legs": [
                {
                    "symbol": leg.symbol,
                    "qty": str(leg.qty),
                    "side": leg.side.value,
                    "type": leg.order_type.value,
                    **({"limit_price": str(leg.limit_price)} if leg.limit_price is not None else {}),
                    **({"stop_price": str(leg.stop_price)} if leg.stop_price is not None else {}),
                }
                for leg in request.legs
            ],
        }

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.ALPACA_BASE_URL}/v2/orders",
            headers=headers,
            json=body,
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=502,
                detail="Broker rejected order. Check order parameters and try again.",
            )
        return resp.json()["id"]
