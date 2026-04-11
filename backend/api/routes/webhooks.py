from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from core.config import settings
from core.redis import publish

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class TradingViewAlert(BaseModel):
    """Schema matching TradingView webhook alert JSON payload."""
    ticker: str
    action: str = Field(..., description="buy, sell, close, alert")
    price: float | None = None
    volume: float | None = None
    interval: str | None = None
    strategy: str | None = Field(None, description="Originating strategy name in TV")
    message: str | None = None
    time: str | None = None


class WebhookResponse(BaseModel):
    status: str
    alert_id: str
    processed_at: datetime
    actions: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/tradingview", response_model=WebhookResponse)
async def receive_tradingview_webhook(
    request: Request,
    x_tv_secret: str | None = Header(None, alias="X-TV-Secret"),
) -> WebhookResponse:
    """Receive and process TradingView webhook alerts.

    Validates the webhook secret, parses the alert, and routes it to the
    appropriate handler (direct trade execution, agent analysis, or
    notification).

    TradingView alert message should be JSON with the TradingViewAlert schema.
    Include the TRADINGVIEW_WEBHOOK_SECRET as an X-TV-Secret header or in the
    JSON body as 'secret'.
    """
    import uuid

    # Parse JSON body with error handling (BUG-034)
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid JSON payload: {e}")

    alert_id = str(uuid.uuid4())

    # Validate secret (BUG-035: reject ALL requests when secret is not configured)
    secret = settings.TRADINGVIEW_WEBHOOK_SECRET.get_secret_value()
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    provided_secret = x_tv_secret or body.get("secret", "")
    if not hmac.compare_digest(provided_secret, secret):
        logger.warning("Invalid TradingView webhook secret from %s", request.client.host if request.client else "unknown")
        raise HTTPException(status_code=403, detail="Invalid webhook secret")

    # Remove secret from body before processing
    body.pop("secret", None)

    try:
        alert = TradingViewAlert(**body)
    except Exception as e:
        logger.error("Failed to parse TradingView alert: %s", e)
        raise HTTPException(status_code=422, detail=f"Invalid alert payload: {e}")

    logger.info(
        "TradingView alert received: %s %s @ %s (strategy: %s)",
        alert.action, alert.ticker, alert.price, alert.strategy,
    )

    actions: list[dict[str, Any]] = []

    # Route based on action
    if alert.action in ("buy", "sell"):
        action_result = await _handle_trade_signal(alert)
        actions.append(action_result)
    elif alert.action == "close":
        action_result = await _handle_close_signal(alert)
        actions.append(action_result)
    elif alert.action == "alert":
        action_result = await _handle_info_alert(alert)
        actions.append(action_result)
    else:
        logger.warning("Unknown TradingView action: %s", alert.action)

    # Broadcast alert via websocket
    await publish("alerts", {
        "type": "tradingview_alert",
        "alert_id": alert_id,
        "ticker": alert.ticker,
        "action": alert.action,
        "price": alert.price,
        "strategy": alert.strategy,
        "message": alert.message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    return WebhookResponse(
        status="processed",
        alert_id=alert_id,
        processed_at=datetime.now(timezone.utc),
        actions=actions,
    )


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

async def _handle_trade_signal(alert: TradingViewAlert) -> dict[str, Any]:
    """Convert a buy/sell alert into an order via the execution pipeline."""
    from agents import get_agent

    execution_agent = get_agent("execution")
    if execution_agent is None:
        # Fall back to direct notification
        await _send_notification(
            f"Trade signal: {alert.action.upper()} {alert.ticker} @ {alert.price}"
        )
        return {"action": "notified", "detail": "Execution agent unavailable, sent notification"}

    result = await execution_agent.run(
        f"Execute {alert.action} signal for {alert.ticker} at {alert.price}. "
        f"Strategy: {alert.strategy or 'tradingview'}. "
        f"Context: {alert.message or 'TradingView alert'}"
    )

    return {
        "action": "order_submitted" if result.get("success") else "order_failed",
        "detail": result,
    }


async def _handle_close_signal(alert: TradingViewAlert) -> dict[str, Any]:
    """Handle a position close signal."""
    await _send_notification(
        f"Close signal: {alert.ticker} @ {alert.price} ({alert.strategy})"
    )
    return {"action": "close_requested", "ticker": alert.ticker}


async def _handle_info_alert(alert: TradingViewAlert) -> dict[str, Any]:
    """Handle an informational alert (no trade action)."""
    await _send_notification(
        f"Alert: {alert.ticker} - {alert.message or alert.strategy}"
    )
    return {"action": "notification_sent", "ticker": alert.ticker}


async def _send_notification(message: str) -> None:
    """Send notification via Telegram and/or Discord."""
    import httpx

    # Telegram
    if settings.TELEGRAM_BOT_TOKEN.get_secret_value() and settings.TELEGRAM_CHAT_ID:
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN.get_secret_value()}/sendMessage",
                    json={
                        "chat_id": settings.TELEGRAM_CHAT_ID,
                        "text": f"[AlphaDesk] {message}",
                        "parse_mode": "HTML",
                    },
                )
        except Exception as e:
            logger.error("Failed to send Telegram notification: %s", e)

    # Discord
    if settings.DISCORD_WEBHOOK_URL.get_secret_value():
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    settings.DISCORD_WEBHOOK_URL.get_secret_value(),
                    json={"content": f"**[AlphaDesk]** {message}"},
                )
        except Exception as e:
            logger.error("Failed to send Discord notification: %s", e)
