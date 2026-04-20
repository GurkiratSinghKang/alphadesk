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
        return

    raw = event.get("raw") or {}
    order = raw.get("order") if isinstance(raw, dict) else None
    order = order or {}

    client_order_id = order.get("client_order_id") or event.get("client_order_id")
    broker_order_id = event.get("order_id") or order.get("id")
    fill_price = event.get("fill_price") or order.get("filled_avg_price")
    fill_ts = event.get("timestamp") or order.get("filled_at") or order.get("updated_at")

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

    # Retry on DB error with exponential backoff.  Cap at 60s so a long
    # outage doesn't pin a task in a tight retry loop; if we can't write
    # for > 60s the supervisor will log and the next event will try again
    # from scratch.
    backoff = 0.5
    for attempt in range(6):
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
                    logger.warning(
                        "fill_reconciler: no ledger row for client_order_id=%s "
                        "broker_order_id=%s event=%s — dropped",
                        client_order_id, broker_order_id, event_name,
                    )
                    return

                # Apply the state transition + fill metadata.  These
                # columns are the Wave B additions (migration 0003).
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

                await db.commit()
            logger.info(
                "fill_reconciler: %s → status=%s client_order_id=%s broker_order_id=%s "
                "filled_avg_price=%s filled_at=%s",
                event_name, new_status, client_order_id, broker_order_id,
                filled_avg_price, filled_at,
            )
            return
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
    _reconciler_task = asyncio.create_task(
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
