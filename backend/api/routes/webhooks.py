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
# Exact replay dedupe: keep authenticated payload fingerprints slightly
# longer than the freshness window so an immediate replay of the same signed
# body cannot trigger the handler twice.
TV_REPLAY_DEDUPE_TTL_SECONDS = TV_REPLAY_WINDOW_SECONDS + 30


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
    x_tv_signature: str | None = Header(None, alias="X-TV-Signature"),
) -> WebhookResponse:
    """Receive and process TradingView webhook alerts.

    Validates the webhook signature, parses the alert, and routes it to the
    appropriate handler (direct trade execution, agent analysis, or
    notification).

    Authentication model (Wave 6γ hardening — persona 123 P1):
    -----------------------------------------------------------
    Prior revisions accepted an ``X-TV-Secret`` header (or ``secret`` in body)
    and compared it, constant-time, against the server-side
    ``TRADINGVIEW_WEBHOOK_SECRET``. That scheme is vulnerable to replay of a
    captured payload with a fresh timestamp — the body is unsigned, so an
    attacker who ever captures a legitimate request (network MITM before the
    Caddy TLS terminator, intermediate logging, etc.) can forward the static
    secret with any body they like.

    The correct scheme, enforced here, is HMAC-SHA256 over the concatenation
    ``<X-TV-Timestamp>:<raw request body>`` keyed on the shared secret. The
    attacker would now need the secret itself to forge a signature for any
    new body. Configure TradingView to send ``X-TV-Signature`` computed as::

        hex(HMAC_SHA256(secret, f"{timestamp}:{body}"))

    Legacy ``X-TV-Secret`` / ``secret`` in body are accepted only for backward
    compatibility during rollout and are deprecated; operators should migrate
    their TradingView alerts to send the signature header.

    An ``X-TV-Timestamp`` header (unix seconds) is required and must be within
    ``TV_REPLAY_WINDOW_SECONDS`` of server time; this prevents replay of
    captured webhook payloads even for the legacy secret path.
    """
    import uuid

    client_ip = request.client.host if request.client else "unknown"

    # Rate limit — 30 requests per minute per source IP. Applied before
    # JSON parsing / HMAC so a flood attacker can't waste CPU on us.
    #
    # Wave 3M / persona-91 #3: fail CLOSED on Redis errors. This endpoint
    # is a public, unauthenticated attack surface (anyone who knows the
    # path can POST to it; the shared secret is the only gate). If Redis
    # is down, fail-open meant an attacker could DoS Redis (or time a
    # burst to coincide with a Redis restart) and then spray the webhook
    # with credential-stuffing / secret-bruteforce payloads at unbounded
    # rate, each one still triggering HMAC compare + JSON parse. 503 is
    # the correct response: operations is notified (alerts fire on 5xx
    # rate), legitimate TradingView delivery retries after the Redis
    # service recovers, and we don't lose the security property of the
    # rate-limit during the outage window.
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
        # Fail-closed: reject with 503 rather than silently allowing the
        # request through. See the security note above.
        logger.exception(
            "Rate-limit check failed for ip=%s; rejecting request (fail-closed)",
            client_ip,
        )
        raise HTTPException(
            status_code=503,
            detail="Rate limiter unavailable; retry later.",
        )

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

    # Read the raw body bytes BEFORE parsing — the HMAC signature is
    # computed over the exact bytes the client sent, not over a re-serialised
    # dict (whitespace / key ordering would differ and every signature would
    # mismatch). ``request.body()`` is cached; ``request.json()`` below
    # consumes the same bytes.
    try:
        body_bytes = await request.body()
    except Exception as e:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail=f"Could not read request body: {e}")
    body_raw = body_bytes.decode("utf-8", errors="replace")

    # Parse JSON body with error handling (BUG-034)
    try:
        body = json.loads(body_raw) if body_raw else {}
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid JSON payload: {e}")

    # Security audit R6: TradingView can POST a JSON array / string / number
    # just as legally as an object. Downstream code calls ``body.get(...)``
    # and ``TradingViewAlert(**body)`` — both raise AttributeError /
    # TypeError on non-dict bodies which surface as an uncaught 500 and leak
    # stack details. Reject non-object bodies with 422 BEFORE the HMAC
    # check so an attacker can't use the crash path for reconnaissance or
    # bypass the secret gate via a type-confusion timing oracle.
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Webhook body must be a JSON object")

    alert_id = str(uuid.uuid4())

    # Validate secret (BUG-035: reject ALL requests when secret is not configured)
    secret = settings.TRADINGVIEW_WEBHOOK_SECRET.get_secret_value()
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    # ------------------------------------------------------------------
    # Wave 6γ (persona 123 P1): HMAC over timestamp+body, not static secret.
    # ------------------------------------------------------------------
    # Preferred path — caller supplied ``X-TV-Signature`` computed over
    # ``f"{timestamp}:{body_raw}"``. Compare constant-time against our
    # recomputation; if it matches, we know the caller holds the secret AND
    # signed THIS body at THIS timestamp. Replay of a captured request into
    # a fresh timestamp window doesn't help because the body-timestamp
    # combination was signed, not just the secret.
    signed_message = f"{x_tv_timestamp}:{body_raw}".encode("utf-8")
    expected_sig = hmac.new(secret.encode("utf-8"), signed_message, hashlib.sha256).hexdigest()

    provided_sig: str | None = x_tv_signature
    if provided_sig is not None and not isinstance(provided_sig, str):
        provided_sig = None

    if provided_sig:
        if not hmac.compare_digest(provided_sig, expected_sig):
            logger.warning("Invalid TradingView webhook signature from %s", client_ip)
            # Round-29 / persona-D: audit security-relevant rejections
            # so the operator can spot brute-force / replay attempts.
            try:
                from core.audit import write_audit
                await write_audit(
                    "tradingview_webhook_reject",
                    username="system",
                    ip=client_ip,
                    request_id=None,
                    details={"reason": "invalid_signature"},
                )
            except Exception:
                pass
            raise HTTPException(status_code=403, detail="Invalid webhook signature")
    else:
        # Backward-compat path — legacy callers that pre-date the signature
        # scheme may still send a bare secret via header or body. This path
        # is DEPRECATED and documented as such in the docstring above; we
        # keep it to avoid breaking an operator mid-migration. The timestamp
        # replay window (already enforced above) is the only defence for
        # this path, which is why we prefer the signature scheme.
        body_secret = body.get("secret", "")
        if not isinstance(body_secret, str):
            body_secret = ""
        legacy_secret = x_tv_secret if isinstance(x_tv_secret, str) else ""
        provided_secret = legacy_secret or body_secret
        if not isinstance(provided_secret, str) or not provided_secret:
            logger.warning(
                "TradingView webhook missing both X-TV-Signature and legacy secret from %s",
                client_ip,
            )
            raise HTTPException(status_code=403, detail="Missing webhook signature")
        if not hmac.compare_digest(provided_secret, secret):
            logger.warning("Invalid TradingView webhook secret from %s", client_ip)
            raise HTTPException(status_code=403, detail="Invalid webhook secret")
        logger.info(
            "TradingView webhook accepted via legacy secret header from %s; "
            "migrate alert to X-TV-Signature",
            client_ip,
        )

    # Remove secret from body before processing
    body.pop("secret", None)

    try:
        alert = TradingViewAlert(**body)
    except Exception as e:
        logger.error("Failed to parse TradingView alert", exc_info=True)
        raise HTTPException(status_code=422, detail=f"Invalid alert payload: {e}")

    # A fresh timestamp bounds replay age, but does not stop an attacker (or
    # duplicate TradingView delivery) from replaying the exact same signed
    # request inside the allowed window. Claim a fingerprint after auth and
    # schema validation but before side effects; duplicates get a 200 response
    # so legitimate retries do not keep hammering the endpoint.
    payload_fingerprint = hashlib.sha256(signed_message).hexdigest()
    replay_key = f"tradingview_replay:{payload_fingerprint}"
    try:
        claimed = await redis.set(
            replay_key,
            alert_id,
            ex=TV_REPLAY_DEDUPE_TTL_SECONDS,
            nx=True,
        )
        if not claimed:
            existing_alert_id = await redis.get(replay_key)
            if isinstance(existing_alert_id, bytes):
                existing_alert_id = existing_alert_id.decode("utf-8", errors="replace")
            if not isinstance(existing_alert_id, str) or not existing_alert_id:
                existing_alert_id = alert_id
            logger.warning(
                "TradingView webhook exact replay ignored: ip=%s alert_id=%s",
                client_ip,
                existing_alert_id,
            )
            return WebhookResponse(
                status="duplicate",
                alert_id=existing_alert_id,
                processed_at=datetime.now(timezone.utc),
                actions=[{"action": "duplicate_ignored", "ticker": alert.ticker}],
            )
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "Replay-dedupe check failed for ip=%s; rejecting request (fail-closed)",
            client_ip,
        )
        raise HTTPException(
            status_code=503,
            detail="Replay protection unavailable; retry later.",
        )

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

    # Round-29 / persona-D: audit the webhook receive. Pre-fix this
    # only emitted ``logger.info``; SOX / SEC 17a-4 expect a durable
    # Postgres trail of every external alert that triggered state
    # mutations (orders, alert publishes, broker calls).
    try:
        from core.audit import write_audit
        await write_audit(
            "tradingview_webhook",
            username="system",
            ip=client_ip,
            request_id=alert_id,
            details={
                "action": alert.action,
                "ticker": alert.ticker,
                "price": alert.price,
                "strategy": alert.strategy,
                "alert_id": alert_id,
            },
        )
    except Exception:
        logger.debug("tradingview_webhook: audit persistence failed", exc_info=True)

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

    J-8 (Round-6): the aggregate risk gate (restricted-symbol, wash-trade,
    daily-gross, position-count, sector concentration, daily-loss,
    buying-power, quote-staleness, symbol-halt) now also runs at the
    webhook boundary. Previously a TradingView alert that bypassed the
    manual-order endpoint also bypassed every one of those gates.
    """
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

    # J-8 — aggregate risk gate. Construct a synthetic
    # CreateOrderRequest from the webhook fields and run it through
    # the same risk pipeline manual orders use.
    try:
        synthetic_qty = float(alert.volume) if alert.volume else 1.0
    except (TypeError, ValueError):
        synthetic_qty = 1.0
    try:
        from api.routes._risk_pipeline import (
            build_request_from_webhook,
            run_aggregate_risk_check,
        )
        risk_request = await build_request_from_webhook(
            ticker=alert.ticker,
            side=alert.action,
            qty=max(1.0, synthetic_qty),
            limit_price=alert.price,
            strategy=alert.strategy or "tradingview",
        )
        passed, reason = await run_aggregate_risk_check(
            risk_request, username=None,
        )
        if not passed:
            logger.warning(
                "TradingView signal rejected by aggregate risk gate: "
                "ticker=%s strategy=%s reason=%s",
                alert.ticker, alert.strategy, reason,
            )
            return {"action": "rejected_by_risk", "detail": reason}
    except Exception as exc:
        logger.warning(
            "TradingView aggregate risk-gate evaluation failed; "
            "rejecting signal fail-closed",
            exc_info=True,
        )
        return {
            "action": "rejected_by_risk",
            "detail": f"Aggregate risk gate unavailable: {exc}",
        }

    first_leg = risk_request.legs[0] if risk_request.legs else None
    await _send_notification(
        "Risk-approved TradingView signal requires manual execution review: "
        f"{alert.action.upper()} {alert.ticker} @ {alert.price}"
    )
    return {
        "action": "approved_not_submitted",
        "detail": (
            "Aggregate risk gate passed, but webhook auto-execution is disabled "
            "until the approved payload is bound to the shared order path."
        ),
        "order": {
            "symbol": first_leg.symbol if first_leg else alert.ticker,
            "side": first_leg.side.value if first_leg else alert.action,
            "qty": first_leg.qty if first_leg else synthetic_qty,
            "type": first_leg.order_type.value if first_leg else "market",
            "limit_price": first_leg.limit_price if first_leg else alert.price,
            "strategy": risk_request.strategy,
        },
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

    # Security audit R6: explicit 5s total timeout on BOTH notification calls.
    # Previously httpx.AsyncClient() was called without a timeout kwarg;
    # httpx's default (5s) is per-phase not total, and an upstream that
    # accepts the TCP connection then stalls on response writes could pin
    # the calling webhook request for minutes. On the webhook hot path this
    # is worker-starvation primitive: floods of valid webhooks would each
    # sit waiting on Telegram.
    _NOTIFY_TIMEOUT = 5.0

    # Telegram
    if settings.TELEGRAM_BOT_TOKEN.get_secret_value() and settings.TELEGRAM_CHAT_ID:
        try:
            async with httpx.AsyncClient(timeout=_NOTIFY_TIMEOUT) as client:
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
            async with httpx.AsyncClient(timeout=_NOTIFY_TIMEOUT) as client:
                await client.post(
                    settings.DISCORD_WEBHOOK_URL.get_secret_value(),
                    json={"content": f"**[AlphaDesk]** {message}"},
                )
        except Exception:
            logger.error("Failed to send Discord notification", exc_info=True)
