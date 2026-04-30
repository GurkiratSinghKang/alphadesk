"""Redis → DB consumer for Alpaca ``trade_updates`` events (Wave B / persona-72).

The broker WebSocket in ``data.ingestion.alpaca_stream`` publishes a JSON
payload for every fill / partial_fill / canceled / rejected / expired
event onto Redis channel ``trade_updates`` (see ``CHANNEL_TRADE_UPDATES``
in ``core.redis``).  Until this module landed there was **no DB consumer**
— the pub/sub messages were fanned out to WebSocket clients but the
authoritative ``Trade`` row stayed stuck at ``status="submitted"``
forever.  Persona-72 flagged this as P0 because every fill silently
diverged from the local ledger and the dashboard's P&L could not be
trusted.

What this module does
---------------------
* Subscribes to ``CHANNEL_TRADE_UPDATES`` with a dedicated async task.
* For each event:
    1. Parses the Alpaca payload shape published by ``alpaca_stream``.
    2. Looks up the local Trade row first by ``client_order_id`` (exact
       correlation), then falls back to ``broker_order_id``.  If neither
       match, the event is logged WARN (no ledger row for this order_id)
       and dropped — nothing to do until the row materialises (e.g. the
       submit is still in-flight).
    3. Applies the state transition:
         * ``fill``          → status=``filled``
         * ``partial_fill``  → status=``partial``
         * ``canceled``      → status=``canceled``
         * ``rejected``      → status=``rejected``
         * ``expired``       → status=``expired``
    4. Stamps ``broker_order_id``, ``filled_at``, ``filled_avg_price``,
       and ``account_env`` (paper vs live vs backtest).
* Retries on DB errors with exponential backoff so a transient Postgres
  blip does not drop a fill.

Wire-up
-------
``backend/main.py`` lifespan:

    await start_alpaca_stream()
    await start_fill_reconciler()   # <-- AFTER the stream so the pub/sub
                                    #     channel has a publisher

and the reverse on shutdown.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import orjson

from core.redis import CHANNEL_TRADE_UPDATES, subscribe

logger = logging.getLogger(__name__)

# Module-level task handle so start/stop are idempotent and symmetric with
# the rest of the ingestion supervisors (``start_alpaca_stream``,
# ``start_pipeline_scheduler``, etc.).  ``asyncio.Task | None`` is the
# conventional pattern used in this codebase.
_reconciler_task: asyncio.Task | None = None
_should_stop: bool = False


# ---------------------------------------------------------------------------
# Event → ORM state transition table
# ---------------------------------------------------------------------------

# Alpaca's ``data.event`` values we care about.  Everything else (``new``,
# ``accepted``, ``order_replaced``, ``pending_new``, ``stopped``, …) is
# informational and intentionally dropped here — we only persist terminal
# or semi-terminal states to avoid flapping the ``status`` column.
_EVENT_TO_STATUS: dict[str, str] = {
    "fill": "filled",
    "partial_fill": "partial",
    "canceled": "canceled",
    "cancelled": "canceled",  # spelling variant guard
    "rejected": "rejected",
    "expired": "expired",
}

# Fill events can beat the create-order DB commit by a few milliseconds:
# broker ACK returns, the stream publishes the fill, and only then the submit
# route finishes writing ``Trade``. Retry a missing local row briefly before
# declaring the event orphaned.
_MISSING_ROW_RETRY_DELAYS = (0.05, 0.1, 0.25, 0.5, 1.0)


class _MissingTradeRowRetry(Exception):
    """Signal a missing-row retry after releasing the DB session."""

    def __init__(self, delay: float) -> None:
        super().__init__(f"retry missing trade row in {delay:.2f}s")
        self.delay = delay


async def _compute_trade_kind(
    *, symbol: str, side: str, filled_qty: float, pre_fill_qty: float | None,
) -> str | None:
    """Classify a fill as ``long_open`` / ``long_close`` / ``short_open`` / ``short_close``.

    Wave 4P Fix 3 (P97) — the pre-fill position qty determines whether
    this fill OPENS or CLOSES a position:

        pre-fill qty > 0 (long)  + buy   → ``long_open``   (adding to long)
        pre-fill qty > 0 (long)  + sell  → ``long_close``  (trimming / exit)
        pre-fill qty < 0 (short) + sell  → ``short_open``  (adding to short)
        pre-fill qty < 0 (short) + buy   → ``short_close`` (cover / exit)
        pre-fill qty == 0 (flat) + buy   → ``long_open``
        pre-fill qty == 0 (flat) + sell  → ``short_open``

    Returns None when ``pre_fill_qty`` is None (broker lookup failed)
    so the Trade row keeps a None trade_kind rather than a fabricated
    one.
    """
    if pre_fill_qty is None:
        return None
    s = (side or "").lower()
    if pre_fill_qty > 0:
        return "long_open" if s == "buy" else "long_close"
    if pre_fill_qty < 0:
        return "short_open" if s == "sell" else "short_close"
    return "long_open" if s == "buy" else "short_open"


async def _fetch_pre_fill_qty(
    symbol: str, filled_qty: float, side: str,
) -> float | None:
    """Return the pre-fill position qty for ``symbol``.

    Wave 4P Fix 3 (P97) — we need the qty AT THE INSTANT the fill
    event was emitted, but Alpaca's ``/v2/positions`` returns the
    CURRENT qty (post-fill).  Reconstruct pre-fill by subtracting the
    ``filled_qty`` with the correct sign:

        post_fill_qty = pre_fill_qty + signed_fill_delta
        signed_fill_delta = +filled_qty for buy, -filled_qty for sell
        → pre_fill_qty    = post_fill_qty - signed_fill_delta

    Returns None on broker lookup failure.
    """
    try:
        from core.config import settings
        import httpx
        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions/{symbol}",
                headers=headers,
            )
            if resp.status_code == 404:
                post_qty = 0.0
            elif resp.status_code == 200:
                body = resp.json() or {}
                raw_qty = body.get("qty")
                try:
                    post_qty = float(raw_qty) if raw_qty is not None else 0.0
                except (TypeError, ValueError):
                    return None
            else:
                return None
        s = (side or "").lower()
        signed_delta = filled_qty if s == "buy" else -filled_qty
        return post_qty - signed_delta
    except Exception:
        logger.debug(
            "fill_reconciler: pre-fill qty lookup failed for %s",
            symbol, exc_info=True,
        )
        return None


def _resolve_account_env() -> str:
    """Return ``'paper'`` | ``'live'`` | ``'backtest'``.

    Wave A is centralising the live-trading flag on ``settings`` as
    ``LIVE_TRADING_ENABLED``.  While that wave is in flight we read the
    flag if present, otherwise fall back to the existing
    ``is_live_alpaca_base_url`` helper which already ships.  Either way
    we return a canonical 3-value string for the ``account_env`` column.
    """
    try:
        from core.config import settings
    except Exception:
        return "paper"

    # Wave A coordination: honour the centralised flag once it lands.
    live_flag = getattr(settings, "LIVE_TRADING_ENABLED", None)
    if isinstance(live_flag, bool):
        return "live" if live_flag else "paper"

    # Fallback while Wave A is in flight.
    try:
        from core.config import is_live_alpaca_base_url
        return "live" if is_live_alpaca_base_url() else "paper"
    except Exception:
        return "paper"


def _parse_fill_timestamp(value: Any) -> datetime | None:
    """Normalise an Alpaca timestamp (ISO-8601 string with Z suffix) to UTC.

    Returns None if the input is missing / unparseable rather than raising,
    since a missing fill timestamp should not block the status update.
    """
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            logger.debug("fill_reconciler: unparseable timestamp %r", value)
            return None
    return None


# ---------------------------------------------------------------------------
# Core apply logic — one event at a time.
# ---------------------------------------------------------------------------


async def _apply_event(event: dict[str, Any]) -> None:
    """Apply a single ``trade_updates`` Redis payload to the DB.

    Retries transient DB errors with exponential backoff.  WARN-logs and
    returns silently if no matching Trade row exists — nothing for the
    consumer to do until the submit path has written the row (which can
    race the broker acknowledgement by a few ms).
    """
    event_name = str(event.get("event") or "").lower().strip()
    new_status = _EVENT_TO_STATUS.get(event_name)
    if not new_status:
        # Ignore non-terminal events (``new``, ``accepted``, …) — they are
        # informational and would only thrash the column.
        #
        # Wave 3K Fix 7 (persona-87 P2): debug-level breadcrumb so an
        # operator can tail ``event=reconciler_ignored_event`` and
        # confirm the reconciler is actually seeing the stream during
        # an investigation, without the noise on INFO.
        raw = event.get("raw") or {}
        _order = raw.get("order") if isinstance(raw, dict) else None
        _order = _order or {}
        logger.debug(
            "reconciler_ignored_event",
            extra={
                "event": event_name,
                "order_id": event.get("order_id") or _order.get("id"),
                "client_order_id": (
                    event.get("client_order_id")
                    or _order.get("client_order_id")
                ),
            },
        )
        return

    raw = event.get("raw") or {}
    order = raw.get("order") if isinstance(raw, dict) else None
    order = order or {}

    client_order_id = order.get("client_order_id") or event.get("client_order_id")
    broker_order_id = event.get("order_id") or order.get("id")
    fill_price = event.get("fill_price") or order.get("filled_avg_price")
    # Wave 2G — persona-79 / persona-85 gap 1: do NOT fall back to
    # ``datetime.now()`` (or any client clock) when Alpaca's payload lacks
    # a fill timestamp. The local Trade row keeps ``filled_at = None``
    # rather than a fabricated value the auditor can't trust. Only the
    # genuine broker-supplied timestamp populates the column.
    fill_ts = event.get("timestamp") or order.get("filled_at") or order.get("updated_at")

    # Wave 2G / persona-85 gap 2: capture the execution venue from the
    # Alpaca payload when present. The field has lived in a few places
    # across the broker's API generations (top-level, on the order
    # subobject, or nested inside an execution sub-record), so we probe
    # them in order of specificity. Truncate to the column width (16
    # chars — matches typical NYSE / ARCA / EDGX / CITADEL_INT
    # identifiers).
    execution_obj = order.get("execution") if isinstance(order.get("execution"), dict) else None
    execution_venue = (
        event.get("execution_venue")
        or order.get("execution_venue")
        or order.get("venue")
        or (execution_obj.get("venue") if execution_obj else None)
    )
    if isinstance(execution_venue, str):
        execution_venue = execution_venue.strip()[:16] or None
    else:
        execution_venue = None

    if not client_order_id and not broker_order_id:
        logger.warning(
            "fill_reconciler: event without any correlation id (event=%s) — dropped",
            event_name,
        )
        return

    filled_at = _parse_fill_timestamp(fill_ts)
    try:
        filled_avg_price: Decimal | None = (
            Decimal(str(fill_price)) if fill_price is not None else None
        )
    except Exception:
        logger.debug(
            "fill_reconciler: unparseable fill_price %r for order %s",
            fill_price, broker_order_id,
        )
        filled_avg_price = None

    account_env = _resolve_account_env()

    # Wave 2G / persona-85 gap 10: NBBO snapshot at fill time. Wave C is
    # the producer side (writes the latest tick to a Redis hash keyed by
    # symbol). If that key is present we read bid/ask and compute the
    # signed price-improvement against the mid. If the cache hasn't
    # shipped yet (or is empty for this symbol), all three NBBO columns
    # stay None — better than persisting a stale or fabricated quote.
    # TODO(persona-85 gap 10): wire up the dedicated NBBO Redis cache
    # once Wave C ships ``CHANNEL_NBBO_TICKS`` + the corresponding
    # subscriber. Until then this block is intentionally a no-op.
    nbbo_bid: Decimal | None = None
    nbbo_ask: Decimal | None = None
    price_improvement_cents: Decimal | None = None
    side = (event.get("side") or order.get("side") or "").lower()
    try:
        from core.redis import get_redis
        redis = await get_redis()
        symbol_for_quote = event.get("symbol") or order.get("symbol")
        if redis is not None and symbol_for_quote:
            quote = await redis.hgetall(f"nbbo:{symbol_for_quote}")
            if quote:
                bid_raw = quote.get("bid") if isinstance(quote, dict) else None
                ask_raw = quote.get("ask") if isinstance(quote, dict) else None
                if bid_raw is not None:
                    nbbo_bid = Decimal(str(bid_raw))
                if ask_raw is not None:
                    nbbo_ask = Decimal(str(ask_raw))
                if (nbbo_bid is not None
                        and nbbo_ask is not None
                        and filled_avg_price is not None
                        and side in ("buy", "sell")):
                    mid = (nbbo_bid + nbbo_ask) / Decimal(2)
                    # Sign so that a buy filled BELOW the mid + a sell
                    # filled ABOVE the mid both report POSITIVE
                    # improvement (cents). Multiply by 100 to convert
                    # dollars-per-share to cents-per-share.
                    sign = Decimal(1) if side == "buy" else Decimal(-1)
                    price_improvement_cents = (
                        (mid - filled_avg_price) * sign * Decimal(100)
                    )
    except Exception:
        # NBBO enrichment is best-effort; never block the fill update.
        logger.debug(
            "fill_reconciler: NBBO enrichment skipped (event=%s)",
            event_name, exc_info=True,
        )

    # Retry on DB error with exponential backoff.  Cap at 60s so a long
    # outage doesn't pin a task in a tight retry loop; if we can't write
    # for > 60s the supervisor will log and the next event will try again
    # from scratch.
    backoff = 0.5
    for attempt in range(max(6, len(_MISSING_ROW_RETRY_DELAYS) + 1)):
        try:
            from core.config import settings
            if settings.SKIP_DB_INIT:
                # Degraded mode — nothing to persist.  Log once so oncall
                # knows the reconciler is a no-op.
                logger.debug(
                    "fill_reconciler: SKIP_DB_INIT=True — dropping %s for %s",
                    event_name, client_order_id or broker_order_id,
                )
                return

            from sqlalchemy import select, or_
            from core.database import _get_session_factory
            from data.storage.models import Trade

            factory = _get_session_factory()
            async with factory() as db:
                # Lookup chain: client_order_id column → broker_order_id
                # column → legacy legs JSON (older rows wrote the
                # correlation id into the first leg dict).
                q = select(Trade).where(
                    or_(
                        Trade.client_order_id == client_order_id if client_order_id else False,
                        Trade.broker_order_id == broker_order_id if broker_order_id else False,
                    )
                )
                trade = (await db.execute(q)).scalar_one_or_none()

                if trade is None and client_order_id:
                    # Legacy fallback: the submit path used to write the
                    # client_order_id inside legs[0].client_order_id before
                    # we added a dedicated column.  Scan recent rows.
                    from datetime import timedelta
                    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
                    legacy_q = (
                        select(Trade)
                        .where(Trade.entry_time >= cutoff)
                        .where(Trade.status.in_(("submitted", "pending")))
                        .order_by(Trade.entry_time.desc())
                        .limit(500)
                    )
                    candidates = (await db.execute(legacy_q)).scalars().all()
                    for t in candidates:
                        for leg in (t.legs or []):
                            if isinstance(leg, dict) and leg.get("client_order_id") == client_order_id:
                                trade = t
                                break
                        if trade is not None:
                            break

                if trade is None:
                    if attempt < len(_MISSING_ROW_RETRY_DELAYS):
                        delay = _MISSING_ROW_RETRY_DELAYS[attempt]
                        logger.debug(
                            "fill_reconciler: no ledger row yet for client_order_id=%s "
                            "broker_order_id=%s event=%s — retrying in %.2fs",
                            client_order_id, broker_order_id, event_name, delay,
                        )
                        raise _MissingTradeRowRetry(delay)
                    logger.warning(
                        "fill_reconciler: no ledger row for client_order_id=%s "
                        "broker_order_id=%s event=%s — dropped",
                        client_order_id, broker_order_id, event_name,
                    )
                    return

                # Apply the state transition + fill metadata.  These
                # columns are the Wave B additions (migration 0003) plus
                # the Wave 2G execution-quality additions (migration 0004).
                trade.status = new_status
                if broker_order_id and not trade.broker_order_id:
                    trade.broker_order_id = broker_order_id
                if client_order_id and not trade.client_order_id:
                    trade.client_order_id = client_order_id
                if filled_at is not None:
                    trade.filled_at = filled_at
                if filled_avg_price is not None:
                    trade.filled_avg_price = filled_avg_price
                    # Keep the legacy ``entry_price`` column in sync for
                    # existing P&L code that hasn't migrated.
                    if trade.entry_price is None:
                        try:
                            trade.entry_price = float(filled_avg_price)
                        except Exception:
                            pass
                # Only overwrite account_env if not already set to a
                # non-default; the submit path is authoritative but this
                # path is a safety net for reconciled rows.
                if not trade.account_env or trade.account_env == "paper":
                    trade.account_env = account_env

                # Wave 4P Fix 3 (P97): position-aware trade_kind.
                # Only stamp for genuine fill events (not cancels /
                # rejects / expires) AND only when not already set —
                # the submit path may have pre-classified at order
                # time.  Skipping these states keeps us from clobbering
                # a pre-filled classification with a "nothing happened"
                # no-op.
                #
                # ``getattr(..., "trade_kind", None)`` tolerates legacy
                # ORM classes and test SimpleNamespace rows that
                # predate the column.  Writing the attribute via
                # ``setattr`` below is also tolerant — if the row has
                # no such slot (pre-migration fixture) we silently skip.
                if (
                    event_name in ("fill", "partial_fill")
                    and getattr(trade, "trade_kind", None) is None
                ):
                    try:
                        filled_qty_raw = (
                            order.get("filled_qty") or event.get("filled_qty") or 0
                        )
                        filled_qty = float(filled_qty_raw or 0)
                    except (TypeError, ValueError):
                        filled_qty = 0.0
                    symbol_for_kind = (
                        event.get("symbol")
                        or order.get("symbol")
                        or trade.symbol
                    )
                    if symbol_for_kind and filled_qty > 0 and side in ("buy", "sell"):
                        pre_fill_qty = await _fetch_pre_fill_qty(
                            symbol_for_kind, filled_qty, side,
                        )
                        trade.trade_kind = await _compute_trade_kind(
                            symbol=symbol_for_kind,
                            side=side,
                            filled_qty=filled_qty,
                            pre_fill_qty=pre_fill_qty,
                        )

                # Wave 2G — persona-85 gaps 1, 2, 10: stamp the
                # execution-quality columns. Each is independently nullable
                # and we only write when we have a real value, so a payload
                # missing the venue or NBBO doesn't clobber a previously-
                # stamped value with NULL.
                if execution_venue and not trade.execution_venue:
                    trade.execution_venue = execution_venue
                if nbbo_bid is not None and trade.nbbo_bid_at_fill is None:
                    trade.nbbo_bid_at_fill = nbbo_bid
                if nbbo_ask is not None and trade.nbbo_ask_at_fill is None:
                    trade.nbbo_ask_at_fill = nbbo_ask
                if price_improvement_cents is not None and trade.price_improvement_cents is None:
                    trade.price_improvement_cents = price_improvement_cents

                # J-17 (Round-6) — stamp filled_qty on partial / full
                # fill events so downstream pipeline code can size
                # against the actually-filled qty rather than the
                # leg-level qty.
                if event_name in ("fill", "partial_fill"):
                    try:
                        from decimal import Decimal as _Decimal
                        fq_raw = (
                            order.get("filled_qty")
                            or event.get("filled_qty")
                            or 0
                        )
                        fq_dec = _Decimal(str(fq_raw or 0))
                        if fq_dec > 0 and hasattr(trade, "filled_qty"):
                            trade.filled_qty = fq_dec
                    except Exception:
                        logger.debug(
                            "filled_qty stamp failed for %s",
                            client_order_id, exc_info=True,
                        )

                # J-4 (Round-6) — auto-cancel position-tied alerts on
                # close. The fill that flips a position from open to
                # flat must also tear down any alerts the trader
                # hung off the position.
                position_id_for_cancel: str | None = None
                if (
                    new_status == "filled"
                    and getattr(trade, "trade_kind", None)
                        in ("long_close", "short_close")
                ):
                    for leg in (trade.legs or []):
                        if isinstance(leg, dict):
                            pid = leg.get("position_id")
                            if pid:
                                position_id_for_cancel = str(pid)
                                break
                    if not position_id_for_cancel and trade.broker_order_id:
                        position_id_for_cancel = trade.broker_order_id

                # The session.commit() invokes SQLAlchemy's optimistic-
                # locking machinery: the UPDATE WHERE includes
                # ``version = :old_version`` and the column is
                # auto-bumped on each successful write. A concurrent
                # transition to the same row will raise StaleDataError
                # on commit; the outer retry loop will catch that and
                # re-fetch on the next attempt.
                await db.commit()
            logger.info(
                "fill_reconciler: %s → status=%s client_order_id=%s broker_order_id=%s "
                "filled_avg_price=%s filled_at=%s",
                event_name, new_status, client_order_id, broker_order_id,
                filled_avg_price, filled_at,
            )

            # J-4 (Round-6) — fire-and-forget alert cancellation.
            # Outside the DB transaction so a Redis hiccup can't roll
            # back a successful fill stamp.
            if position_id_for_cancel:
                try:
                    from api.routes.trades import cancel_alerts_for_position
                    cancelled = await cancel_alerts_for_position(
                        position_id_for_cancel
                    )
                    if cancelled:
                        logger.info(
                            "fill_reconciler: cancelled %d alerts on close "
                            "of position %s",
                            cancelled, position_id_for_cancel,
                        )
                except Exception:
                    logger.debug(
                        "fill_reconciler: cancel_alerts_for_position "
                        "failed for %s",
                        position_id_for_cancel, exc_info=True,
                    )
            return
        except _MissingTradeRowRetry as retry:
            await asyncio.sleep(retry.delay)
            continue
        except Exception:
            logger.warning(
                "fill_reconciler: DB apply failed for event=%s client_order_id=%s "
                "(attempt %d/6) — retry in %.1fs",
                event_name, client_order_id, attempt + 1, backoff,
                exc_info=True,
            )
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)
    logger.error(
        "fill_reconciler: permanent DB failure for event=%s client_order_id=%s — dropped",
        event_name, client_order_id,
    )


# ---------------------------------------------------------------------------
# Supervised pub/sub loop
# ---------------------------------------------------------------------------


async def _reconciler_loop() -> None:
    """Long-running subscriber loop.  Reconnects on Redis outage."""
    global _should_stop
    backoff = 1.0

    while not _should_stop:
        pubsub = None
        try:
            pubsub = await subscribe(CHANNEL_TRADE_UPDATES)
            logger.info("fill_reconciler: subscribed to %s", CHANNEL_TRADE_UPDATES)
            backoff = 1.0  # reset on successful subscribe

            async for msg in pubsub.listen():
                if _should_stop:
                    break
                if msg is None or msg.get("type") != "message":
                    continue
                data = msg.get("data")
                if data is None:
                    continue
                try:
                    if isinstance(data, (bytes, bytearray)):
                        payload = orjson.loads(data)
                    elif isinstance(data, str):
                        payload = orjson.loads(data)
                    elif isinstance(data, dict):
                        payload = data
                    else:
                        logger.debug(
                            "fill_reconciler: unexpected payload type %s",
                            type(data).__name__,
                        )
                        continue
                except Exception:
                    logger.debug(
                        "fill_reconciler: malformed JSON frame dropped",
                        exc_info=True,
                    )
                    continue

                try:
                    await _apply_event(payload)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # Never let a single-event failure kill the loop;
                    # each event has its own retry budget inside
                    # ``_apply_event``.
                    logger.warning(
                        "fill_reconciler: unhandled exception applying event",
                        exc_info=True,
                    )

        except asyncio.CancelledError:
            break
        except Exception:
            if _should_stop:
                break
            logger.error(
                "fill_reconciler: loop crashed (reconnect in %.1fs)",
                backoff, exc_info=True,
            )
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)
        finally:
            if pubsub is not None:
                try:
                    await pubsub.unsubscribe(CHANNEL_TRADE_UPDATES)
                    await pubsub.aclose()
                except Exception:
                    logger.debug(
                        "fill_reconciler: pubsub teardown raised", exc_info=True,
                    )

    logger.info("fill_reconciler: loop exited")


async def start_fill_reconciler() -> None:
    """Start the fill-reconciler background task.  Idempotent."""
    global _reconciler_task, _should_stop
    if _reconciler_task is not None and not _reconciler_task.done():
        logger.debug("fill_reconciler: already running")
        return
    _should_stop = False
    # Round-11 / BB-13: supervised so a silent death surfaces at ERROR.
    from core.supervised_task import create_supervised_task

    _reconciler_task = create_supervised_task(
        _reconciler_loop(), name="fill_reconciler"
    )
    logger.info("fill_reconciler: started")


async def stop_fill_reconciler() -> None:
    """Cancel the fill-reconciler task and wait for it to exit.  Idempotent."""
    global _reconciler_task, _should_stop
    _should_stop = True
    if _reconciler_task is None:
        return
    _reconciler_task.cancel()
    try:
        await _reconciler_task
    except (asyncio.CancelledError, Exception):
        pass
    _reconciler_task = None
    logger.info("fill_reconciler: stopped")
