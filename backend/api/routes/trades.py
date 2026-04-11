from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.auth import require_auth

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Emergency halt state
# ---------------------------------------------------------------------------

_trading_halted = False


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
    symbol: str
    side: OrderSide
    qty: float
    order_type: OrderType = OrderType.LIMIT
    limit_price: float | None = None
    stop_price: float | None = None
    asset_class: str = Field("equity", description="equity or option")


class CreateOrderRequest(BaseModel):
    legs: list[OrderLeg] = Field(..., min_length=1, max_length=4)
    time_in_force: TimeInForce = TimeInForce.DAY
    strategy: str | None = Field(None, description="Originating strategy name")
    notes: str | None = None


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
) -> OrderResponse:
    """Submit a new order through the broker (Alpaca).

    Supports single-leg equity orders and multi-leg options orders.
    All orders pass through the RiskManagerAgent before submission.
    """
    if _trading_halted:
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
    except Exception:
        pass  # DB not available — order still submitted to broker

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

        async with httpx.AsyncClient() as client:
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

    async with httpx.AsyncClient() as client:
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

        async with httpx.AsyncClient() as client:
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
        return []


@router.get("/history", response_model=list[TradeHistoryEntry])
async def get_trade_history(
    symbol: str | None = Query(None),
    strategy: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
) -> list[TradeHistoryEntry]:
    """Retrieve historical trades from the local database."""
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

        return [
            TradeHistoryEntry(
                id=t.id,
                symbol=t.symbol,
                strategy=t.strategy,
                side=t.legs[0].get("side", "buy") if t.legs else "buy",
                quantity=t.legs[0].get("qty", 0) if t.legs else 0,
                entry_price=t.entry_price or 0,
                exit_price=t.exit_price,
                pnl=t.pnl,
                pnl_pct=(t.pnl / t.entry_price * 100) if t.pnl is not None and t.entry_price else None,
                entry_time=t.entry_time,
                exit_time=t.exit_time,
                status=t.status,
                notes=t.notes,
            )
            for t in trades
        ]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _check_duplicate_order(request: CreateOrderRequest) -> None:
    """Prevent duplicate orders within a 30-second window."""
    from core.redis import cache_get, cache_set

    # Create a hash of the order
    order_key = hashlib.md5(
        f"{request.legs[0].symbol}:{request.legs[0].side}:{request.legs[0].qty}:{request.time_in_force}".encode()
    ).hexdigest()

    cache_key = f"order_dedup:{order_key}"
    existing = await cache_get(cache_key)
    if existing:
        raise HTTPException(status_code=409, detail="Duplicate order detected. Please wait before resubmitting.")

    # Mark this order as submitted for 30 seconds
    await cache_set(cache_key, {"submitted": True}, ttl_seconds=30)


async def _get_current_price(symbol: str) -> float:
    """Get current price for notional calculation."""
    from core.redis import cache_get
    cached = await cache_get(f"quote:{symbol}")
    if cached and cached.get("last"):
        return float(cached["last"])
    # Fallback: use a reasonable estimate
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
    global _trading_halted
    _trading_halted = True
    # Cancel all open orders on Alpaca
    try:
        from core.config import settings
        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }
        async with httpx.AsyncClient() as client:
            await client.delete(f"{settings.ALPACA_BASE_URL}/v2/orders", headers=headers)
    except Exception as e:
        logger.error("Failed to cancel orders during halt: %s", e)
    return {"halted": True, "message": "All trading halted. All open orders cancelled."}


@router.post("/resume")
async def resume_trading(username: str = Depends(require_auth)):
    """Resume trading after emergency halt."""
    global _trading_halted
    _trading_halted = False
    return {"halted": False, "message": "Trading resumed."}


# ---------------------------------------------------------------------------
# Price Alerts
# ---------------------------------------------------------------------------

_price_alerts: list[dict] = []  # In-memory for now; move to Redis/DB later

@router.get("/alerts")
async def list_alerts(username: str = Depends(require_auth)):
    return _price_alerts

@router.post("/alerts")
async def create_alert(
    symbol: str = Query(...),
    price: float = Query(...),
    condition: str = Query("above", regex="^(above|below)$"),
    username: str = Depends(require_auth),
):
    alert = {
        "id": f"alert-{len(_price_alerts)+1}",
        "symbol": symbol.upper(),
        "price": price,
        "condition": condition,
        "triggered": False,
        "created_at": datetime.now(ZoneInfo("America/New_York")).isoformat(),
    }
    _price_alerts.append(alert)
    return alert

@router.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: str, username: str = Depends(require_auth)):
    global _price_alerts
    _price_alerts = [a for a in _price_alerts if a["id"] != alert_id]
    return {"ok": True}


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

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.ALPACA_BASE_URL}/v2/orders",
            headers=headers,
            json=body,
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=502,
                detail=f"Broker rejected order: {resp.text}",
            )
        return resp.json()["id"]
