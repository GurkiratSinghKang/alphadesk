from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from core.config import settings
from core.redis import get_redis, publish

router = APIRouter()
logger = logging.getLogger(__name__)

# Persona 67/85 — webhook replay + rate limit hardening.
# Replay window: TradingView cannot reasonably deliver an alert > 2 minutes
# after it fires; anything older is almost certainly replayed. 120s also
# covers clock skew between TV's servers and ours.
TV_REPLAY_WINDOW_SECONDS = 120
# Rate limit: the most aggressive legitimate TradingView alert setup fires
# a few times per minute. 30/min is a comfortable ceiling that still
# protects against a leaked secret being used to spam us.
TV_RATE_LIMIT_PER_MIN = 30


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
    x_tv_timestamp: str | None = Header(None, alias="X-TV-Timestamp"),
) -> WebhookResponse:
    """Receive and process TradingView webhook alerts.

    Validates the webhook secret, parses the alert, and routes it to the
    appropriate handler (direct trade execution, agent analysis, or
    notification).

    TradingView alert message should be JSON with the TradingViewAlert schema.
    Include the TRADINGVIEW_WEBHOOK_SECRET as an X-TV-Secret header or in the
    JSON body as 'secret'. An ``X-TV-Timestamp`` header (unix seconds) is
    required and must be within ``TV_REPLAY_WINDOW_SECONDS`` of server time;
    this prevents replay of captured webhook payloads.
    """
    import uuid

    client_ip = request.client.host if request.client else "unknown"

    # Rate limit — 30 requests per minute per source IP. Applied before
    # JSON parsing / HMAC so a flood attacker can't waste CPU on us.
    # Fail-open on Redis errors: don't lose legitimate TV alerts because
    # of a transient infra blip.
    try:
        redis = await get_redis()
        minute_bucket = int(time.time() // 60)
        rate_key = f"tradingview_signals:{client_ip}:{minute_bucket}"
        count = await redis.incr(rate_key)
        if count == 1:
            # First hit this minute — set TTL so the key auto-evicts.
            await redis.expire(rate_key, 60)
        if count > TV_RATE_LIMIT_PER_MIN:
            logger.warning(
                "TradingView webhook rate limit exceeded: ip=%s count=%s",
                client_ip, count,
            )
            raise HTTPException(
                status_code=429,
                detail="Too many webhook requests; slow down.",
            )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Rate-limit check failed; allowing request")

    # Replay protection — require a fresh timestamp header. Reject anything
    # older/newer than TV_REPLAY_WINDOW_SECONDS to defeat captured-payload
    # replays where the attacker knows the secret but can't generate a
    # fresh timestamp within the window.
    if not x_tv_timestamp:
        logger.warning("TradingView webhook missing X-TV-Timestamp from %s", client_ip)
        raise HTTPException(
            status_code=400,
            detail="Missing X-TV-Timestamp header",
        )
    try:
        ts = int(x_tv_timestamp)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="X-TV-Timestamp must be an integer unix-seconds value",
        )
    now = int(time.time())
    if abs(now - ts) > TV_REPLAY_WINDOW_SECONDS:
        logger.warning(
            "TradingView webhook replay window violation: ip=%s now=%s ts=%s delta=%s",
            client_ip, now, ts, now - ts,
        )
        raise HTTPException(
            status_code=400,
            detail=f"X-TV-Timestamp outside ±{TV_REPLAY_WINDOW_SECONDS}s window",
        )

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
        logger.warning("Invalid TradingView webhook secret from %s", client_ip)
        raise HTTPException(status_code=403, detail="Invalid webhook secret")

    # Remove secret from body before processing
    body.pop("secret", None)

    try:
        alert = TradingViewAlert(**body)
    except Exception as e:
        logger.error("Failed to parse TradingView alert", exc_info=True)
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
    """Convert a buy/sell alert into an order via the execution pipeline.

    Wave-A bypass-fix: the live-trading deny-gate is enforced HERE, before
    the agent is invoked. Persona-66/67/69 flagged this path because a
    TradingView webhook with ``strategy=orb`` previously routed straight
    through to ``execution_agent.run`` with no gate at all. Refusing at the
    webhook boundary also avoids burning an LLM call on an order that
    cannot legally execute.
    """
    from agents import get_agent
    from core.trading_gate import reject_if_live_forbidden

    # Live-trading strategy gate — refuse before invoking the agent. We
    # convert ``RuntimeError`` to a structured failure so the webhook still
    # returns 200 (TradingView retries on 5xx, and we don't want it to
    # repeatedly hit a denylisted strategy).
    try:
        reject_if_live_forbidden(
            alert.strategy,
            caller="webhooks._handle_trade_signal",
            http_context=False,
        )
    except RuntimeError as exc:
        logger.warning(
            "TradingView signal refused by live gate: ticker=%s strategy=%s err=%s",
            alert.ticker, alert.strategy, exc,
        )
        return {"action": "rejected_by_gate", "detail": str(exc)}

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
        except Exception:
            logger.error("Failed to send Telegram notification", exc_info=True)

    # Discord
    if settings.DISCORD_WEBHOOK_URL.get_secret_value():
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    settings.DISCORD_WEBHOOK_URL.get_secret_value(),
                    json={"content": f"**[AlphaDesk]** {message}"},
                )
        except Exception:
            logger.error("Failed to send Discord notification", exc_info=True)
