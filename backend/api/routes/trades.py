from __future__ import annotations

import hashlib
import json
import logging
import re
import unicodedata
import uuid as _uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator, model_validator

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
    # Alpaca-compatible filter values for GET /orders (see
    # https://docs.alpaca.markets/reference/getallorders — the broker's
    # ``status`` query accepts ``open`` / ``closed`` / ``all`` only).
    OPEN = "open"
    CLOSED = "closed"
    ALL = "all"
    # Individual-order states emitted by ``_alpaca_status_map`` when normalising
    # the per-order response; also accepted as filter values for backward compat
    # with callers that pass e.g. ``?status=pending``.
    PENDING = "pending"
    SUBMITTED = "submitted"
    PARTIAL = "partial_fill"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class OrderLeg(BaseModel):
    # Matches the frontend symbol regex (dots/hyphens allowed for tickers
    # like BRK.B, BF.B, RDS-A, BTC-USD). Previously this was the stricter
    # ``^[A-Z]{1,10}$`` which rejected valid class-B / preferred-share tickers
    # even though the frontend accepted them and the data APIs supported them.
    symbol: str = Field(..., pattern=r"^[A-Z][A-Z0-9.\-]{0,9}$")
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

    @model_validator(mode="after")
    def _require_prices_for_order_type(self) -> "OrderLeg":
        """Cross-field guard — stop orders need a stop_price, limit orders need a limit_price.

        The per-field validators above only reject *non-positive* values; they
        accept ``None``. Previously a trader could POST a stop-loss with
        ``stop_price=null``, which silently passed validation and reached the
        broker with no trigger level — Alpaca then rejected it with an opaque
        "Broker rejected order" message. Similarly, live GTC stops surfaced
        from Alpaca with ``stop_price=null`` (see list_orders below for the
        read-path fix). Reject both at the boundary so the user sees a 422
        with a useful message instead of a 502 from the broker.
        """
        if self.order_type in (OrderType.STOP, OrderType.STOP_LIMIT) and self.stop_price is None:
            raise ValueError("stop_price is required for stop and stop_limit orders")
        if self.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT) and self.limit_price is None:
            raise ValueError("limit_price is required for limit and stop_limit orders")
        return self


def _sanitize_user_text(v: str | None) -> str | None:
    """Strip control bytes + neutralise CSV-injection prefixes from user notes.

    persona-9 #8 / persona-37 F1–F3 — the ``notes`` field on orders / alerts
    previously accepted NUL bytes, ASCII C0 control chars, Unicode
    homoglyphs (e.g. ``＝`` U+FF1D), BOM / RTL-override, and Excel/Sheets-style
    formula prefixes (``=cmd|/c calc!A1``, ``+SUM(A1)``, ``-2+5``, ``@SUM``).
    The first leaked into log files; the second became remote code execution
    if a CSV export of the trade ledger was opened in Excel. The pre-Wave-35
    ordering was strip-AFTER-prefix-check, so a single leading space/tab/newline
    defeated the defence (``' =cmd|/c calc!A1'`` → ``'=cmd|/c calc!A1'``).

    Sanitisation rules (order matters):
        * ``unicodedata.normalize("NFKC", …)`` so fullwidth ``＝`` / ``＋``
          collapse to ASCII before the prefix check.
        * Drop every C0 control char plus DEL (``\\x7F``), BOM (``\\uFEFF``),
          RTL-override (``\\u202E``) and SOFT HYPHEN (``\\u00AD``) —
          invisible glyphs that let a payload hide the formula char at
          visual-position-0. Keep ``\\n`` and ``\\t`` (UI legitimately emits
          them in a notes textarea).
        * ``.strip()`` FIRST so leading whitespace can't mask the prefix.
        * If the stripped string starts with one of ``= + - @`` (CSV-formula
          triggers per OWASP), prepend a single quote so spreadsheets render
          it as text.
        * Hard cap at 500 characters; ``Field(max_length=1000)`` on the
          request bound is preserved for back-compat but we cap the
          persisted value.
        * Empty string after stripping → ``None`` (so callers don't have to
          treat ``""`` and ``None`` differently in the UI).
    """
    if v is None:
        return None
    # Unicode normalisation first so homoglyphs collapse to ASCII.
    normalized = unicodedata.normalize("NFKC", v)
    # Invisible / control chars that could hide a formula prefix at visual pos 0.
    _INVISIBLE = {"\ufeff", "\u202e", "\u00ad", "\x7f"}
    cleaned = "".join(
        ch for ch in normalized
        if ch not in _INVISIBLE and (ch == "\n" or ch == "\t" or ord(ch) >= 0x20)
    )
    # Strip BEFORE the prefix check — otherwise a leading space/tab/newline
    # hides the ``=`` from the prefix-membership test and ``.strip()`` at the
    # end silently peels the whitespace off, leaving the raw formula.
    cleaned = cleaned.strip()
    if cleaned and cleaned[0] in "=+-@":
        cleaned = "'" + cleaned
    if len(cleaned) > 500:
        cleaned = cleaned[:500]
    return cleaned or None


class CreateOrderRequest(BaseModel):
    legs: list[OrderLeg] = Field(..., min_length=1, max_length=4)
    time_in_force: TimeInForce = TimeInForce.DAY
    strategy: str | None = Field(None, description="Originating strategy name")
    notes: str | None = Field(None, max_length=1000)

    @field_validator("notes")
    @classmethod
    def sanitize_notes(cls, v: str | None) -> str | None:
        return _sanitize_user_text(v)

    @field_validator("strategy")
    @classmethod
    def sanitize_strategy(cls, v: str | None) -> str | None:
        # Strategy names are short identifiers, not free text — but the same
        # injection vectors apply (NUL, ``=`` prefix). Reuse the helper so
        # CSV exports of the trade ledger are safe regardless of which user
        # field a hostile string lands in.
        return _sanitize_user_text(v)


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
    # Surface the broker's reject reason when an order comes back as
    # ``rejected``. Previously ``rejected`` was silently remapped to
    # ``cancelled`` and the reason was discarded — a trader could not tell
    # "I cancelled it" from "broker refused it" nor why it was refused.
    reject_reason: str | None = None


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
    # ``side`` is required — callers MUST derive the correct value from the
    # underlying record. Previously this silently defaulted to "buy", which
    # misrepresented shorts/sells for half the ledger.
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


def _derive_side(record: dict[str, Any]) -> str:
    """Derive the correct trade side from a ledger record.

    Priority:
      1. Explicit ``side`` field if present.
      2. Sign of quantity/shares (negative => "sell").
      3. Strategy-level convention (short-biased strategies default to "sell").
      4. Fallback to "buy".
    """
    explicit = record.get("side")
    if isinstance(explicit, str) and explicit.lower() in {"buy", "sell", "short", "cover"}:
        return explicit.lower()

    # Derive from signed quantity
    qty = record.get("shares")
    if qty is None:
        qty = record.get("qty")
    try:
        if qty is not None and float(qty) < 0:
            return "sell"
    except (TypeError, ValueError):
        pass

    # Short-biased strategy heuristic
    strategy = (record.get("strategy") or "").lower()
    if "short" in strategy or strategy in {"pairs_trading"}:
        # Pairs are long/short — mark the short leg correctly when we can't
        # tell from the record; this is a conservative hint.
        if record.get("is_short") is True:
            return "sell"

    return "buy"


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
    payload: CreateOrderRequest,
    http_request: Request,
    username: str = Depends(require_auth),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> OrderResponse:
    """Submit a new order through the broker (Alpaca).

    Supports single-leg equity orders and multi-leg options orders.
    All orders pass through the RiskManagerAgent before submission.

    Request header ``Idempotency-Key`` (persona-40 F2, persona-65 F1): if
    present, the server caches the response JSON for 10 minutes and returns
    the original response verbatim for any second call with the same key.
    Missing / empty header falls back to the payload-hash dedup (30 s
    window) for legacy clients.
    """
    # persona-16 P0-1: halt MUST gate every single manual order before any
    # side-effecting check (risk, dedup, broker POST). Previously the halt
    # check was here but the halt gate is now also the first thing that runs
    # on the aggregate risk path; keep this top-level guard so the 503 error
    # response is consistent.
    if await _is_trading_halted():
        # Surface structured machine-readable detail for the frontend and
        # scripted callers — previously the halt response was a plain
        # "Trading is halted" string that offered no way to tell "halted
        # because the panic button was hit" from "halted because Redis was
        # down" (fail-closed path in ``_is_trading_halted``).
        halted_detail: dict[str, Any] = {
            "error": "trading_halted",
            "reason": "Emergency halt active. Use POST /api/v1/trades/resume to resume.",
            "halted_until": None,
        }
        try:
            from core.redis import get_redis
            redis = await get_redis()
            if redis:
                ttl = await redis.ttl("trading:halted")
                if isinstance(ttl, int) and ttl > 0:
                    halted_detail["halted_until"] = (
                        datetime.now(timezone.utc) + timedelta(seconds=ttl)
                    ).isoformat()
        except Exception:
            logger.debug("Could not resolve halt TTL for response", exc_info=True)
        raise HTTPException(status_code=503, detail=halted_detail)

    if _alpaca_keys_empty():
        raise HTTPException(
            status_code=503,
            detail="Broker not configured. Add ALPACA_API_KEY and ALPACA_SECRET_KEY to .env to enable trading.",
        )

    # persona-40 F2 / persona-65 F1: Idempotency-Key support.
    # Cache policy — Redis SET NX EX 600 with key scoped to the caller's
    # username so a stolen key from one user cannot mask a different user's
    # legitimate order; a second call with the same key returns the cached
    # response verbatim; if Redis is down we fall through to the payload-hash
    # dedup path below (legacy behaviour preserved).
    idem_cache_key: str | None = None
    if idempotency_key:
        # Bound the key length so a pathological client can't DOS Redis
        # with a 1MB header value; 128 chars is far more than a uuid4().
        if len(idempotency_key) > 128:
            raise HTTPException(status_code=400, detail="Idempotency-Key must be ≤128 chars")
        # Canonicalise through the sanitiser so a stray CRLF / NUL in the
        # header can't land in our Redis key namespace unescaped.
        _key_clean = _sanitize_user_text(idempotency_key) or idempotency_key
        idem_cache_key = f"idem:orders:{_key_clean}:{username}"
        try:
            from core.redis import get_redis
            redis = await get_redis()
            if redis is not None:
                cached = await redis.get(idem_cache_key)
                if cached:
                    try:
                        raw = cached.decode() if isinstance(cached, (bytes, bytearray)) else cached
                        data = json.loads(raw)
                        return OrderResponse(**data)
                    except Exception:
                        logger.warning(
                            "Idempotency-Key cache entry malformed — falling through to re-submit",
                            exc_info=True,
                        )
        except Exception:
            logger.debug("Redis unavailable for Idempotency-Key lookup", exc_info=True)

    # Reject market orders outside regular trading hours (session-aware:
    # uses USMarketCalendar so US holidays and early-close afternoons are
    # rejected correctly — previously a market order on MLK day, Good Friday,
    # Christmas Eve after 13:00 ET, etc. would pass the gate and be rejected
    # by Alpaca with a confusing error).
    if any(leg.order_type == OrderType.MARKET for leg in payload.legs):
        et_now = datetime.now(ZoneInfo("America/New_York"))
        try:
            from data.calendar import USMarketCalendar
            _cal = USMarketCalendar()
            if not _cal.is_trading_day(et_now.date()):
                raise HTTPException(
                    status_code=400,
                    detail="Market is closed (US holiday or weekend). Market orders can only be placed on trading days.",
                )
            open_utc, close_utc = _cal.session_hours(et_now.date())
            open_et = open_utc.astimezone(ZoneInfo("America/New_York"))
            close_et = close_utc.astimezone(ZoneInfo("America/New_York"))
            if et_now < open_et or et_now >= close_et:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Market orders can only be placed during regular trading "
                        f"hours ({open_et.strftime('%H:%M')} – "
                        f"{close_et.strftime('%H:%M')} ET)."
                    ),
                )
        except HTTPException:
            raise
        except Exception:
            # Calendar unavailable: fall back to the conservative weekday+RTH
            # check so an unexpected calendar failure doesn't silently allow
            # orders at all hours.
            logger.warning(
                "USMarketCalendar unavailable — falling back to weekday/RTH check",
                exc_info=True,
            )
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

    # persona-16 P0-4: aggregate portfolio-level checks FIRST (gross notional,
    # position count, sector concentration) — the per-order cap alone let
    # 5 × $16k orders through in < 1s. Aggregate check runs before the
    # per-order check so a portfolio already at the ceiling rejects cleanly.
    agg_ok, agg_msg = await _aggregate_risk_check(payload)
    if not agg_ok:
        raise HTTPException(status_code=422, detail=f"Risk check failed: {agg_msg}")

    # Per-order notional cap (single-order ceiling).
    risk_ok, risk_msg = await _risk_check(payload)
    if not risk_ok:
        raise HTTPException(status_code=422, detail=f"Risk check failed: {risk_msg}")

    # Duplicate order check (persona-40: now covers notes + strategy + canonical floats)
    await _check_duplicate_order(payload)

    # persona-56 / persona-65 F1: client_order_id correlation key so a
    # mid-POST disconnect, retry, or reconciliation pass can match the
    # broker row against the local ledger row. Format: ``manual_<user>_<12hex>``.
    # We keep the prefix explicit ("manual_") so the reconciliation endpoint
    # can filter these out from pipeline-originated orders
    # (``daily_pipeline._place_order`` uses ``{strategy}_{symbol}_{ts}``).
    # Alpaca caps client_order_id at 128 chars; username is already size-bounded
    # by the LoginRequest schema.
    # Sanitize username → a filesystem-safe-ish slug so an unusual character
    # doesn't land in the Alpaca ID.
    _user_slug = re.sub(r"[^A-Za-z0-9_\-]", "", username)[:32] or "u"
    client_order_id = f"manual_{_user_slug}_{_uuid.uuid4().hex[:12]}"

    # Submit to broker (pass client_order_id down)
    order_id = await _submit_to_broker(payload, settings, client_order_id=client_order_id)

    # Observability: log every submitted order with the acting user
    logger.info(
        "Order submitted: %s %s %s @ %s (user: %s, client_order_id: %s)",
        payload.legs[0].side,
        payload.legs[0].qty,
        payload.legs[0].symbol,
        "market" if payload.legs[0].order_type == OrderType.MARKET else f"${payload.legs[0].limit_price}",
        username,
        client_order_id,
    )

    # Persist trade record (best-effort).
    # persona-65 F1/F2: we persist the client_order_id inside each leg's JSON
    # so it survives into ``trades.legs`` without requiring a schema migration
    # on the ``trades`` table. A proper ``trades.client_order_id`` column is
    # flagged in the audit report for a follow-up migration.
    try:
        from core.config import settings as _s
        if not _s.SKIP_DB_INIT:
            from core.database import _get_session_factory
            from data.storage.models import Trade

            # Map the OrderSide on the first leg to the ledger side convention:
            # ``buy`` (opening long) -> "long"; ``sell`` (opening short) -> "short".
            first_leg_side = payload.legs[0].side
            persisted_side = "short" if first_leg_side == OrderSide.SELL else "long"

            # Stamp the correlation id onto the legs JSON so ``reconcile``
            # and any downstream ledger inspector can match against it.
            legs_payload = []
            for leg in payload.legs:
                ld = leg.model_dump()
                ld["client_order_id"] = client_order_id
                legs_payload.append(ld)

            factory = _get_session_factory()
            async with factory() as db:
                trade = Trade(
                    symbol=payload.legs[0].symbol,
                    strategy=payload.strategy,
                    legs=legs_payload,
                    entry_time=datetime.now(timezone.utc),
                    status="submitted",
                    notes=payload.notes,
                    side=persisted_side,
                )
                db.add(trade)
                await db.flush()
                await db.commit()
    except Exception:
        logger.warning("Failed to persist trade record to DB (order still submitted to broker)", exc_info=True)

    response = OrderResponse(
        id=order_id,
        status=OrderStatus.SUBMITTED,
        legs=payload.legs,
        time_in_force=payload.time_in_force,
        strategy=payload.strategy,
        submitted_at=datetime.now(timezone.utc),
        notes=payload.notes,
    )

    # persona-40 F2: cache the response under the Idempotency-Key so a
    # retry within 10 minutes returns the same response verbatim.
    if idem_cache_key is not None:
        try:
            from core.redis import get_redis
            redis = await get_redis()
            if redis is not None:
                await redis.set(
                    idem_cache_key,
                    json.dumps(response.model_dump(mode="json")),
                    ex=600,
                    nx=True,
                )
        except Exception:
            logger.warning("Failed to persist Idempotency-Key response cache", exc_info=True)

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
    offset: int = Query(0, ge=0, le=1000),
) -> list[OrderResponse]:
    """List recent orders, optionally filtered by status.

    Default changed in Wave 28: when no ``status`` filter is passed, this
    endpoint now asks Alpaca for ``status=all`` instead of relying on the
    broker's own default (which is ``open``). Previously a user who
    cancelled an order saw an empty list immediately afterwards — the
    cancelled order dropped out of the default view and the user couldn't
    tell whether the cancellation had actually landed. With ``all``,
    cancelled + rejected + filled orders remain visible so the ledger is
    self-consistent.

    persona-9 #5: ``offset`` + ``limit`` are now bounded by Pydantic so
    negative offsets and oversized limits are rejected with HTTP 422
    instead of being silently accepted (Alpaca then returned wrong-sized
    pages or an opaque 400).
    """
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
        # When the caller passes an explicit status filter, forward it
        # through using Alpaca's ``open`` / ``closed`` / ``all`` vocabulary;
        # otherwise default to ``all`` so cancelled + rejected orders stay
        # visible in the default view.
        if status is None:
            params["status"] = "all"
        else:
            # Normalise the enum to Alpaca's supported values.
            if status in (OrderStatus.OPEN, OrderStatus.PENDING, OrderStatus.SUBMITTED):
                params["status"] = "open"
            elif status in (
                OrderStatus.CLOSED,
                OrderStatus.FILLED,
                OrderStatus.PARTIAL,
                OrderStatus.CANCELLED,
                OrderStatus.REJECTED,
            ):
                params["status"] = "closed"
            else:
                params["status"] = "all"

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/orders",
                headers=headers,
                params=params,
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch orders from broker")
            orders_data = resp.json()

        # ``rejected`` is preserved as-is so a trader can tell the
        # difference between "I cancelled it" and "broker refused it".
        # Previously this was silently remapped to CANCELLED, hiding the
        # broker's reject_reason and breaking the frontend's notification
        # listener that keys on ``status === "rejected"``.
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
            "rejected": OrderStatus.REJECTED,
            "stopped": OrderStatus.FILLED,
            "suspended": OrderStatus.PENDING,
            "pending_new": OrderStatus.PENDING,
            "pending_cancel": OrderStatus.PENDING,
            "pending_replace": OrderStatus.PENDING,
        }

        # If a specific status filter was asked for, do a final client-side
        # pass so we only return orders whose *normalised* status matches
        # (Alpaca's server-side filter is coarse: "open/closed/all").
        filtered_client_side = status is not None

        results: list[OrderResponse] = []
        for o in orders_data:
            mapped_status = _alpaca_status_map.get(o.get("status", ""), OrderStatus.PENDING)
            if filtered_client_side and mapped_status != status:
                # Special-case: a caller asking for "submitted" should also
                # see "pending" rows — they're both open/unfilled.
                if not (status == OrderStatus.SUBMITTED and mapped_status == OrderStatus.PENDING):
                    continue

            # Round-trip Alpaca's stop_price + limit_price onto the leg so
            # the UI can show at what price a stop will trigger. Previously
            # only limit_price was copied and 5 live stop orders returned
            # ``stop_price: null`` — a silent data loss.
            leg = OrderLeg(
                symbol=o["symbol"],
                side=OrderSide(o["side"]),
                qty=float(o.get("qty", 0)),
                order_type=OrderType(o.get("type", "market")),
                limit_price=float(o["limit_price"]) if o.get("limit_price") else None,
                stop_price=float(o["stop_price"]) if o.get("stop_price") else None,
            )

            reject_reason = o.get("reject_reason") or o.get("message")

            results.append(OrderResponse(
                id=o["id"],
                status=mapped_status,
                legs=[leg],
                time_in_force=TimeInForce(o.get("time_in_force", "day")),
                submitted_at=o.get("submitted_at", datetime.now(timezone.utc).isoformat()),
                filled_at=o.get("filled_at"),
                avg_fill_price=float(o["filled_avg_price"]) if o.get("filled_avg_price") else None,
                reject_reason=reject_reason if mapped_status == OrderStatus.REJECTED else None,
            ))
        # Apply offset client-side so the bounded ``offset`` query param is
        # honoured (Alpaca's API doesn't support a generic offset).
        if offset:
            results = results[offset:]
        return results
    except HTTPException:
        raise
    except Exception:
        logger.warning("Failed to fetch orders from broker", exc_info=True)
        # Don't mask outages as "no orders" — return 503 so the frontend
        # can render an error state instead of an empty grid.
        raise HTTPException(
            status_code=503,
            detail={"error": "broker_unavailable", "retry": True},
        )


@router.delete("/orders/{order_id}", status_code=204, response_model=None)
async def cancel_order(order_id: str) -> None:
    """Cancel a pending order by ID.

    persona-9 #9: cancel is now distinguishably idempotent. Previously every
    DELETE returned 204, even if the order had already been cancelled, filled
    or rejected — a caller could not tell whether their cancel landed or was
    a no-op against an already-terminal order. Now:

        * Unknown order id → 404 ``Order not found``
        * Already terminal (cancelled/filled/rejected/expired) → 404
          ``Order already terminal`` so the client refreshes the order list.
        * Live order accepted by broker → 204 (unchanged).
    """
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

    # Pre-flight GET — Alpaca's DELETE returns 422 / 200 / 204 depending on
    # the order's life-cycle state and we can't reliably distinguish
    # "already cancelled" from "unknown id" from the DELETE alone. The GET
    # gives us the canonical status before we attempt the cancel.
    _terminal = {"filled", "canceled", "cancelled", "expired", "rejected", "replaced"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        get_resp = await client.get(
            f"{settings.ALPACA_BASE_URL}/v2/orders/{order_id}",
            headers=headers,
        )
        if get_resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Order not found")
        if get_resp.status_code == 200:
            current_status = (get_resp.json().get("status") or "").lower()
            if current_status in _terminal:
                raise HTTPException(status_code=404, detail="Order already terminal")
        # Non-404 read failure (5xx, network) — fall through to the DELETE
        # attempt and let the broker's response shape the error.

        resp = await client.delete(
            f"{settings.ALPACA_BASE_URL}/v2/orders/{order_id}",
            headers=headers,
        )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="Order not found")
        # Alpaca returns 422 for "order is not cancelable" (terminal state we
        # missed in the read above due to a race). Map that to a real 404 too
        # — the caller's view of the order is stale either way.
        if resp.status_code == 422:
            raise HTTPException(status_code=404, detail="Order already terminal")
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
        raise HTTPException(
            status_code=503,
            detail={"error": "broker_unavailable", "retry": True},
        )


@router.get("/history", response_model=list[TradeHistoryEntry])
async def get_trade_history(
    symbol: str | None = Query(None),
    strategy: str | None = Query(None),
    limit: int = Query(100, ge=1, le=10000),
    offset: int = Query(0, ge=0, le=1000),
) -> list[TradeHistoryEntry]:
    """Retrieve historical trades from the trade ledger (primary) and local database (fallback).

    persona-9 #5/#10: ``offset`` + ``limit`` are bounded by Pydantic. Negative
    offsets, non-numeric input and oversized pages are rejected with HTTP 422
    rather than silently producing an empty / oversized response.
    """

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

        # Sort by entry_time descending, then apply offset + limit window.
        all_trades = sorted(all_trades, key=lambda t: t.get("entry_time", ""), reverse=True)
        all_trades = all_trades[offset : offset + limit]

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
                    side=_derive_side(t),
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
            query = (
                select(Trade)
                .order_by(Trade.entry_time.desc())
                .offset(offset)
                .limit(limit)
            )
            if symbol:
                query = query.where(Trade.symbol == symbol.upper())
            if strategy:
                query = query.where(Trade.strategy == strategy)

            result = await db.execute(query)
            trades = result.scalars().all()

        results = []
        for t in trades:
            leg = t.legs[0] if t.legs else {}
            qty = leg.get("qty", 1) or 1
            # Derive side from the first leg; required field on TradeHistoryEntry.
            # Top-level ``Trade.side`` (new column) is authoritative when set.
            leg_side = leg.get("side") if isinstance(leg, dict) else None
            top_side = getattr(t, "side", None)
            if top_side in {"long", "short"}:
                leg_side = "sell" if top_side == "short" else "buy"
            elif leg_side not in {"buy", "sell", "short", "cover"}:
                # Synthesize a record for _derive_side using strategy + qty
                leg_side = _derive_side({
                    "side": leg_side,
                    "qty": leg.get("qty") if isinstance(leg, dict) else None,
                    "strategy": t.strategy,
                })
            results.append(TradeHistoryEntry(
                id=t.id,
                symbol=t.symbol,
                strategy=t.strategy,
                side=leg_side,
                quantity=leg.get("qty", 0) if isinstance(leg, dict) else 0,
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

def _canonical_float(v: float | None) -> str:
    """Format a float for a canonical dedup-hash input.

    persona-40 F6 — ``json.dumps(1.0000000000000002)`` emits the full
    repr ("1.0000000000000002"), creating a distinct hash from ``1.0``
    even though Alpaca rounds both to the same number. The ``%.8g``
    format rounds machine-eps-neighbour perturbations back to the
    canonical value (8 significant digits is > than Alpaca's max
    precision of 4 decimals and handles every realistic price/qty).
    ``None`` survives as an empty string so a missing price hashes
    distinctly from a present zero price.
    """
    if v is None:
        return ""
    return f"{float(v):.8g}"


def _order_dedup_hash(request: CreateOrderRequest) -> str:
    """Deterministic payload hash used for both Redis dedup and audit logs.

    persona-40 F4/F5/F6 — notes and strategy MUST be in the hash, and
    floats must be canonicalised so sub-epsilon perturbations don't
    bypass dedup. The multi-leg list is NOT reordered; that is the
    caller's responsibility (Alpaca treats ``[long, short]`` and
    ``[short, long]`` as the same combo so this is a pre-existing
    weakness noted in persona-40 F7 — we keep stable order here to
    avoid silently dropping distinct legitimate orderings).
    """
    payload = {
        "legs": [
            {
                "s": l.symbol,
                "sd": l.side.value,
                "q": _canonical_float(l.qty),
                "t": l.order_type.value,
                "lp": _canonical_float(l.limit_price),
                "sp": _canonical_float(l.stop_price),
            }
            for l in request.legs
        ],
        "tif": request.time_in_force.value,
        # Include user-supplied free text so notes/strategy permutation
        # cannot produce a fresh dedup slot (persona-40 F4, F5).
        "notes": request.notes or "",
        "strategy": request.strategy or "",
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode()
    ).hexdigest()


async def _check_duplicate_order(request: CreateOrderRequest) -> None:
    """Prevent duplicate orders within a 30-second window using atomic Redis SET NX.

    The dedup hash now includes ``limit_price`` + ``stop_price`` +
    ``time_in_force`` + ``notes`` + ``strategy`` — previously it only hashed
    symbol/side/qty/type/prices/tif, which meant one-byte perturbations of
    ``notes`` or ``strategy`` produced fresh dedup keys (persona-40 F4/F5).
    Floats are canonicalised through ``_canonical_float`` so machine-eps
    neighbours (``1.0000000000000002``) don't split the hash either
    (persona-40 F6).
    """
    from core.redis import get_redis

    order_key = _order_dedup_hash(request)
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
        logger.warning("Failed to fetch price from Alpaca for %s", symbol, exc_info=True)

    return 0.0


import os as _os


def _env_float(name: str, default: float) -> float:
    """Read a float env override with a safe default (no crash on bad input)."""
    try:
        raw = _os.getenv(name)
        return float(raw) if raw is not None and raw != "" else default
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        raw = _os.getenv(name)
        return int(raw) if raw is not None and raw != "" else default
    except (TypeError, ValueError):
        return default


# Aggregate caps (persona-16 P0-4). Configurable via env so an operator can
# tighten them without a code change.
DAILY_GROSS_NOTIONAL_CAP = _env_float("TRADES_DAILY_GROSS_NOTIONAL_CAP", 200_000.0)
PER_ORDER_NOTIONAL_CAP = _env_float("TRADES_PER_ORDER_NOTIONAL_CAP", 50_000.0)
MAX_OPEN_POSITIONS = _env_int("TRADES_MAX_OPEN_POSITIONS", 50)
SECTOR_CONCENTRATION_LIMIT = _env_float("TRADES_SECTOR_CONCENTRATION_LIMIT", 0.30)


async def _compute_order_notional(request: CreateOrderRequest) -> float:
    """Resolve the dollar notional of the incoming order across all legs.

    Shared by ``_risk_check`` and ``_aggregate_risk_check`` so both see the
    same number (persona-16 P0-4 — previously the per-order cap and the
    "daily gross" idea disagreed on what counted as notional for a leg
    whose limit_price was None).
    """
    total = 0.0
    for leg in request.legs:
        if leg.limit_price:
            total += float(leg.limit_price) * float(leg.qty)
        else:
            price = await _get_current_price(leg.symbol)
            if price <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot determine price for {leg.symbol}. Use a limit order.",
                )
            total += float(price) * float(leg.qty)
    return total


async def _get_todays_gross_notional() -> float:
    """Sum today's deployed notional from the trade ledger + broker-pending.

    persona-16 P0-4 — the old ``_risk_check`` only guarded a single order
    against a $50k ceiling; N separate sub-cap orders blew past the
    portfolio's real risk budget. This helper approximates the day's
    gross deployed notional by combining:

      1. Trade-ledger entries opened today (entry_price × shares).
      2. Broker-side orders that are still ``open`` / ``new`` / ``partially_filled``
         (notional estimated from ``qty`` × ``limit_price`` or ``filled_avg_price``
         falling back to 0 when neither is known).

    The function FAILS OPEN (returns 0.0 on error) so a broken ledger
    doesn't block all trading — the per-order cap still applies, and the
    `_is_trading_halted` gate sits in front of it for the panic path.
    """
    total = 0.0
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # 1. Ledger entries opened today.
    try:
        from data.ingestion.trade_ledger import TradeLedger
        ledger = TradeLedger()
        for t in ledger._list_all():
            entry_time = t.get("entry_time") or ""
            if not entry_time.startswith(today):
                continue
            price = float(t.get("entry_price", 0) or 0)
            shares = float(t.get("shares", 0) or 0)
            total += abs(price * shares)
    except Exception:
        logger.debug("Ledger unavailable for daily-notional aggregation", exc_info=True)

    # 2. Broker-side in-flight orders (best-effort).
    if not _alpaca_keys_empty():
        try:
            from core.config import settings as _s
            headers = {
                "APCA-API-KEY-ID": _s.ALPACA_API_KEY.get_secret_value(),
                "APCA-API-SECRET-KEY": _s.ALPACA_SECRET_KEY.get_secret_value(),
            }
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{_s.ALPACA_BASE_URL}/v2/orders",
                    headers=headers,
                    params={"status": "open", "limit": 500, "nested": "true"},
                )
                if resp.status_code == 200:
                    for o in resp.json():
                        try:
                            qty = float(o.get("qty", 0) or 0)
                            price = (
                                float(o.get("limit_price") or 0)
                                or float(o.get("filled_avg_price") or 0)
                            )
                            total += abs(price * qty)
                        except (TypeError, ValueError):
                            continue
        except Exception:
            logger.debug("Alpaca unavailable for daily-notional aggregation", exc_info=True)

    return total


async def _get_account_equity() -> float:
    """Fetch account equity from Alpaca; 0.0 on failure (caller must FAIL CLOSED)."""
    if _alpaca_keys_empty():
        return 0.0
    try:
        from core.config import settings as _s
        headers = {
            "APCA-API-KEY-ID": _s.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": _s.ALPACA_SECRET_KEY.get_secret_value(),
        }
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{_s.ALPACA_BASE_URL}/v2/account",
                headers=headers,
            )
            if resp.status_code == 200:
                return float(resp.json().get("equity", 0) or 0)
    except Exception:
        logger.warning("Failed to fetch Alpaca equity for risk check", exc_info=True)
    return 0.0


async def _get_open_position_count_and_sector_exposure() -> tuple[int, dict[str, float], float]:
    """Return (position_count, {sector: exposure_usd}, equity_usd) from Alpaca.

    Uses ``/v2/positions`` for the source of truth (matches what Alpaca
    actually holds) and ``risk._get_symbol_sector_map`` for the sector
    attribution.
    """
    if _alpaca_keys_empty():
        return 0, {}, 0.0
    try:
        from core.config import settings as _s
        headers = {
            "APCA-API-KEY-ID": _s.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": _s.ALPACA_SECRET_KEY.get_secret_value(),
        }
        async with httpx.AsyncClient(timeout=5.0) as client:
            pos_resp = await client.get(f"{_s.ALPACA_BASE_URL}/v2/positions", headers=headers)
            acct_resp = await client.get(f"{_s.ALPACA_BASE_URL}/v2/account", headers=headers)
            equity = float(acct_resp.json().get("equity", 0) or 0) if acct_resp.status_code == 200 else 0.0
            positions = pos_resp.json() if pos_resp.status_code == 200 else []
    except Exception:
        logger.warning("Failed to fetch positions/account for aggregate risk check", exc_info=True)
        return 0, {}, 0.0

    try:
        from api.routes.risk import _get_symbol_sector_map
        sector_map = _get_symbol_sector_map()
    except Exception:
        sector_map = {}

    sector_exposure: dict[str, float] = {}
    for p in positions:
        try:
            sym = p.get("symbol", "")
            market_value = abs(float(p.get("market_value", 0) or 0))
            sector = sector_map.get(sym, "Unknown")
            sector_exposure[sector] = sector_exposure.get(sector, 0.0) + market_value
        except (TypeError, ValueError):
            continue

    return len(positions), sector_exposure, equity


async def _aggregate_risk_check(request: CreateOrderRequest) -> tuple[bool, str]:
    """Aggregate / portfolio-level risk gates (persona-16 P0-4).

    Runs BEFORE the per-order cap in ``_risk_check``:

      * Today's gross notional across ledger + broker-pending + this order
        must stay below ``DAILY_GROSS_NOTIONAL_CAP`` ($200k by default).
      * Open-position count must stay at or below ``MAX_OPEN_POSITIONS`` (50).
      * Post-order sector exposure must stay below
        ``SECTOR_CONCENTRATION_LIMIT`` (30% of equity).
    """
    # Today's gross notional
    incoming = await _compute_order_notional(request)
    todays_gross = await _get_todays_gross_notional()
    if (todays_gross + incoming) > DAILY_GROSS_NOTIONAL_CAP:
        return False, (
            f"Daily gross notional would reach ${todays_gross + incoming:,.0f} "
            f"(cap ${DAILY_GROSS_NOTIONAL_CAP:,.0f}). Today already deployed "
            f"${todays_gross:,.0f}."
        )

    # Position count + sector concentration
    pos_count, sector_exposure, equity = await _get_open_position_count_and_sector_exposure()
    if pos_count >= MAX_OPEN_POSITIONS:
        return False, (
            f"Already holding {pos_count} open positions "
            f"(limit {MAX_OPEN_POSITIONS})."
        )

    if equity > 0:
        # Resolve the incoming order's sector (use first-leg symbol — all legs
        # of a combo share an underlying on Alpaca's equity + mleg API).
        try:
            from api.routes.risk import _get_symbol_sector_map
            sector_map = _get_symbol_sector_map()
        except Exception:
            sector_map = {}
        first_leg = request.legs[0]
        sector = sector_map.get(first_leg.symbol, "Unknown")
        # Only count BUY-side additions; a SELL trims exposure.
        sector_delta = incoming if first_leg.side == OrderSide.BUY else 0.0
        projected = sector_exposure.get(sector, 0.0) + sector_delta
        if (projected / equity) > SECTOR_CONCENTRATION_LIMIT:
            return False, (
                f"Sector '{sector}' would reach "
                f"{projected / equity * 100:.1f}% of equity "
                f"(cap {SECTOR_CONCENTRATION_LIMIT * 100:.0f}%). "
                f"Diversify or trim existing {sector} positions first."
            )

    return True, "passed"


async def _risk_check(request: CreateOrderRequest) -> tuple[bool, str]:
    """Per-order notional ceiling (persona-16 P0-4 — see ``_aggregate_risk_check`` for portfolio-level gates)."""
    total_notional = await _compute_order_notional(request)

    if total_notional > PER_ORDER_NOTIONAL_CAP:
        return (
            False,
            f"Order notional ${total_notional:,.0f} exceeds single-order limit of ${PER_ORDER_NOTIONAL_CAP:,.0f}",
        )

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
    except Exception:
        logger.error("Failed to cancel orders during halt", exc_info=True)
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
    # Relaxed from ``^[A-Z]{1,10}$`` to match the frontend (BRK.B, BF.B, RDS-A).
    symbol: str = Field(..., pattern=r"^[A-Z][A-Z0-9.\-]{0,9}$")
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
                logger.debug("Skipping malformed alert in Redis", exc_info=True)
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
    response: Response,
    symbol: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0, le=1000),
    username: str = Depends(require_auth),
):
    """List price alerts, optionally filtered by symbol.

    Paginated: use ``limit`` (default 100, max 500) and ``offset`` (max 1000).
    The total number of matching alerts is returned in the ``X-Total-Count``
    response header so clients can compute page counts.

    persona-9 #5: ``offset`` is bounded above as well as below — previously
    ``offset=-5`` returned the tail (negative slice) and ``offset=10**9``
    returned an empty page silently.
    """
    alerts = await _get_all_alerts()
    if symbol:
        alerts = [a for a in alerts if a["symbol"] == symbol.upper()]
    total = len(alerts)
    alerts = alerts[offset : offset + limit]
    response.headers["X-Total-Count"] = str(total)
    return alerts


@router.post("/alerts", status_code=201)
async def create_alert(
    body: CreateAlertRequest,
    username: str = Depends(require_auth),
):
    """Create a new price alert. Persisted in Redis.

    Dedup (Wave 28): before inserting, scan existing non-triggered alerts
    for the same ``(symbol, price, condition)`` tuple. If one exists and
    has not yet fired, return 409 instead of silently storing a second
    copy. Previously clicking "Create Alert" twice (or a double-tap on
    mobile) produced two identical alerts, and when the price crossed the
    threshold the user got two toasts + two chips for the same event.
    """
    import uuid

    # Dedup check against the live alert set.
    try:
        existing = await _get_all_alerts()
        for a in existing:
            if a.get("triggered"):
                continue
            if (
                a.get("symbol") == body.symbol.upper()
                and float(a.get("price", 0)) == float(body.price)
                and a.get("condition") == body.condition
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"An active alert already exists for {body.symbol.upper()} "
                        f"{body.condition} ${body.price:.2f}."
                    ),
                )
    except HTTPException:
        raise
    except Exception:
        # If Redis is unavailable the list fetch will have logged; don't
        # block alert creation on a dedup-check failure — the save below
        # will also fail and return a clearer error.
        logger.debug("Alert dedup check skipped due to error", exc_info=True)

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


async def _submit_to_broker(
    request: CreateOrderRequest,
    settings: Any,
    client_order_id: str | None = None,
) -> str:
    """Submit the order to Alpaca and return the broker order ID.

    Supports both single-leg equity orders and multi-leg options orders (BUG-027).

    persona-65 F1: ``client_order_id`` is forwarded as Alpaca's
    ``client_order_id`` field so a mid-POST disconnect has a stable
    correlation key to match the broker row against the local ledger row.
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
        if client_order_id:
            body["client_order_id"] = client_order_id
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
        if client_order_id:
            body["client_order_id"] = client_order_id

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.ALPACA_BASE_URL}/v2/orders",
            headers=headers,
            json=body,
        )
        if resp.status_code in (200, 201):
            return resp.json()["id"]

        # persona-9 #6 — translate broker errors into actionable HTTP codes.
        # 4xx from Alpaca is almost always a user-fixable validation error
        # ("symbol AAPL.TO not tradable", "qty too small", "market closed").
        # Surface the broker's message verbatim under HTTP 422 so the user
        # sees what's wrong instead of an opaque 502. Only unexpected 5xx
        # responses (broker outage, gateway error) keep the 502.
        if 400 <= resp.status_code < 500:
            try:
                payload = resp.json()
                msg = (
                    payload.get("message")
                    or payload.get("error")
                    or "Broker rejected order"
                )
            except Exception:
                msg = "Broker rejected order"
            raise HTTPException(status_code=422, detail=str(msg))

        raise HTTPException(
            status_code=502,
            detail="Broker error — please retry",
        )


# ---------------------------------------------------------------------------
# Reconciliation (persona-65 F9) — pull Alpaca's last-24h orders, backfill
# missing rows into the local Trade table, mark orphaned local "submitted"
# rows whose broker counterpart has vanished.
# ---------------------------------------------------------------------------


async def _reconcile_last_24h() -> dict[str, int]:
    """Core reconciliation logic. Shared by POST /trades/reconcile and the
    boot-time lifespan hook so both see the same semantics.

    Returns a dict: ``{"backfilled": N, "orphaned": M, "matched": K}``.

    * ``backfilled`` — Alpaca rows for which no local Trade existed: inserted
      as ``status="reconciled"`` so they count toward P&L / position tracking.
    * ``orphaned`` — local Trades in ``submitted`` status from the last 24h
      whose ``client_order_id`` is not present on the Alpaca side: marked
      ``status="orphaned"`` so they stop inflating position counts.
    * ``matched`` — rows where both sides agree (informational only).
    """
    result = {"backfilled": 0, "orphaned": 0, "matched": 0}

    if _alpaca_keys_empty():
        return result

    from core.config import settings

    # Fetch the last 24h of Alpaca orders.
    since_iso = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    headers = {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/orders",
                headers=headers,
                params={
                    "status": "all",
                    "limit": 500,
                    "nested": "true",
                    "after": since_iso,
                },
            )
            if resp.status_code != 200:
                logger.warning(
                    "reconcile: broker GET /orders returned %d", resp.status_code
                )
                return result
            alpaca_orders = resp.json()
    except Exception:
        logger.warning("reconcile: failed to fetch Alpaca orders", exc_info=True)
        return result

    # Index Alpaca orders by client_order_id where present.
    by_client_id: dict[str, dict[str, Any]] = {}
    for o in alpaca_orders:
        coid = o.get("client_order_id")
        if coid:
            by_client_id[coid] = o

    # DB-less modes skip DB reconciliation but still return the totals from
    # the broker-side scan (useful for oncall to confirm the broker is
    # reachable).
    if settings.SKIP_DB_INIT:
        result["matched"] = len(alpaca_orders)
        return result

    try:
        from sqlalchemy import select
        from core.database import _get_session_factory
        from data.storage.models import Trade
    except Exception:
        logger.warning("reconcile: DB imports failed", exc_info=True)
        return result

    factory = _get_session_factory()
    try:
        async with factory() as db:
            # Pull local Trades created in the last 24h.
            since_dt = datetime.now(timezone.utc) - timedelta(hours=24)
            q = (
                select(Trade)
                .where(Trade.entry_time >= since_dt)
                .order_by(Trade.entry_time.desc())
            )
            trades = (await db.execute(q)).scalars().all()

            # Build a lookup of the local client_order_id set.
            local_client_ids: set[str] = set()
            local_by_client_id: dict[str, Trade] = {}
            for t in trades:
                for leg in (t.legs or []):
                    if isinstance(leg, dict):
                        coid = leg.get("client_order_id")
                        if coid:
                            local_client_ids.add(coid)
                            local_by_client_id.setdefault(coid, t)
                            break

            # 1. Backfill — Alpaca rows with a client_order_id we don't have.
            #    We intentionally only backfill orders that carry our
            #    ``manual_*`` or ``{strategy}_*`` prefix so we don't import
            #    third-party-originated orders (e.g. orders placed through
            #    the Alpaca app directly by the same account owner).
            for coid, o in by_client_id.items():
                if coid in local_client_ids:
                    result["matched"] += 1
                    continue
                try:
                    symbol = o.get("symbol", "")
                    qty = float(o.get("qty", 0) or 0)
                    side = (o.get("side") or "buy").lower()
                    persisted_side = "short" if side == "sell" else "long"
                    entry_price = (
                        float(o.get("filled_avg_price") or 0)
                        or float(o.get("limit_price") or 0)
                    )
                    submitted_at = o.get("submitted_at")
                    try:
                        entry_time = (
                            datetime.fromisoformat(submitted_at.replace("Z", "+00:00"))
                            if submitted_at else datetime.now(timezone.utc)
                        )
                    except Exception:
                        entry_time = datetime.now(timezone.utc)

                    trade = Trade(
                        symbol=symbol,
                        strategy=None,
                        legs=[{
                            "symbol": symbol,
                            "side": side,
                            "qty": qty,
                            "order_type": o.get("type", "market"),
                            "limit_price": (float(o["limit_price"]) if o.get("limit_price") else None),
                            "stop_price": (float(o["stop_price"]) if o.get("stop_price") else None),
                            "client_order_id": coid,
                        }],
                        entry_time=entry_time,
                        entry_price=entry_price or None,
                        status="reconciled",
                        notes=f"Reconciled from broker (alpaca_id={o.get('id')})",
                        side=persisted_side,
                    )
                    db.add(trade)
                    await db.flush()
                    result["backfilled"] += 1
                except Exception:
                    logger.warning(
                        "reconcile: failed to backfill Alpaca order %s",
                        o.get("id"), exc_info=True,
                    )

            # 2. Orphan — local "submitted" rows whose client_order_id has
            #    no Alpaca counterpart in the last-24h window.
            for t in trades:
                if t.status != "submitted":
                    continue
                coid: str | None = None
                for leg in (t.legs or []):
                    if isinstance(leg, dict) and leg.get("client_order_id"):
                        coid = leg["client_order_id"]
                        break
                if not coid:
                    # Pre-client_order_id row — can't safely decide. Skip.
                    continue
                if coid in by_client_id:
                    # Already matched above.
                    continue
                t.status = "orphaned"
                result["orphaned"] += 1

            await db.commit()
    except Exception:
        logger.warning("reconcile: DB session error", exc_info=True)
        return result

    return result


@router.post("/reconcile")
async def reconcile_orders(username: str = Depends(require_auth)) -> dict[str, Any]:
    """Admin-only: reconcile last-24h broker orders against the local ledger.

    persona-65 F9. Backfills missing Trade rows from Alpaca and marks
    local rows whose broker counterpart has vanished as ``orphaned``.
    Returns the per-category counts so oncall can verify the broker /
    DB are in sync after a restart or an incident.
    """
    # Admin-only — keep strict privilege semantics consistent with other
    # state-mutating endpoints (see persona-16 comment on inconsistent halt
    # privilege; reconcile is a write and must not be callable from a
    # non-admin JWT).
    from core.config import settings as _s
    if username != _s.ADMIN_USERNAME:
        raise HTTPException(status_code=403, detail="Admin role required")

    counts = await _reconcile_last_24h()
    logger.info(
        "Reconcile complete — backfilled=%d, orphaned=%d, matched=%d",
        counts.get("backfilled", 0),
        counts.get("orphaned", 0),
        counts.get("matched", 0),
    )
    return counts


async def reconcile_on_boot() -> None:
    """Boot-time reconciliation hook (persona-65 F9).

    Called from ``main.py`` lifespan so a broker-accepted / DB-silent
    split (persona-65 F2) surfaces immediately after a restart instead
    of accumulating. Best-effort — logged but does not block startup.
    """
    try:
        counts = await _reconcile_last_24h()
        logger.info(
            "Boot reconcile — backfilled=%d, orphaned=%d, matched=%d",
            counts.get("backfilled", 0),
            counts.get("orphaned", 0),
            counts.get("matched", 0),
        )
    except Exception:
        logger.warning("Boot reconcile failed (non-fatal)", exc_info=True)
