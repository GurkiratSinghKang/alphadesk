from __future__ import annotations

import logging
import time
from collections.abc import AsyncGenerator
from typing import Any

import orjson
import redis.asyncio as aioredis

from core.config import settings

logger = logging.getLogger(__name__)

_redis_pool: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    """Return the global Redis connection (lazily initialised).

    Wave 3L Fix 8 (persona-86/90): connection pool sized for a single
    worker (Fix 7 drops gunicorn to ``-w 1``). 50 keepalive connections
    comfortably covers ~50 concurrent Redis-using coroutines — more than
    enough for WS pubsub + cache reads + streams. If we ever reintroduce
    multi-worker + leader election, this can stay at 50 per worker (each
    worker has its own pool, tracked independently by Redis).
    """
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=50,
        )
    return _redis_pool


async def close_redis() -> None:
    global _redis_pool
    if _redis_pool is not None:
        await _redis_pool.aclose()
        _redis_pool = None
        logger.info("Redis connection closed")


# ---------------------------------------------------------------------------
# Pub / Sub helpers
# ---------------------------------------------------------------------------

CHANNEL_QUOTES = "quotes"
CHANNEL_PORTFOLIO = "portfolio"
CHANNEL_ALERTS = "alerts"
CHANNEL_AGENTS = "agents"
CHANNEL_BARS = "bars"
# Alpaca trade_updates fan-out — published to by
# ``data.ingestion.alpaca_stream`` when the broker emits fill / partial_fill
# / canceled / rejected events. Keeping it on its own channel lets the
# frontend subscribe just to trading events without receiving every
# portfolio snapshot refresh on the portfolio channel (persona-r P27/P43).
CHANNEL_TRADE_UPDATES = "trade_updates"

ALL_CHANNELS = [
    CHANNEL_QUOTES,
    CHANNEL_PORTFOLIO,
    CHANNEL_ALERTS,
    CHANNEL_AGENTS,
    CHANNEL_BARS,
    CHANNEL_TRADE_UPDATES,
]


async def publish(channel: str, data: dict[str, Any]) -> int:
    """Publish a JSON-serialised message to a Redis channel.

    Copies the caller's dict before injecting ``_ts`` so we never mutate the
    argument. The previous in-place mutation tripped readers that iterated
    the same dict concurrently (concurrency-audit-r4 P0 #3).
    """
    payload_dict = {**data, "_ts": time.time()}
    r = await get_redis()
    payload = orjson.dumps(payload_dict).decode()
    return await r.publish(channel, payload)


async def subscribe(*channels: str) -> aioredis.client.PubSub:
    """Return a PubSub instance subscribed to the given channels."""
    r = await get_redis()
    pubsub = r.pubsub()
    await pubsub.subscribe(*channels)
    return pubsub


# ---------------------------------------------------------------------------
# Redis Streams — durable trade_updates / portfolio fan-out (Wave C)
# ---------------------------------------------------------------------------
#
# Pub/sub is fire-and-forget: a WS client that drops during a fill loses the
# event forever and has no resume path. Wave C (persona 74 P0/P1) switches
# ``trade_updates`` and ``portfolio`` to Redis Streams so a client can
# reconnect, send its last-seen ID, and replay anything it missed.
#
# Stream naming:
#   * ``trade_updates:{user_id}`` — per-user stream (keeps fanout cheap even
#     when we go multi-user; a single shared stream would force every
#     consumer to filter by user_id on every read).
#   * ``portfolio`` — single stream for now (snapshots are user-scoped inside
#     the payload; frontend filters client-side).
#
# Capacity is bounded via ``MAXLEN ~ 10000`` so a long-running server can't
# blow the Redis memory budget. The ``~`` is the approximate trim — Redis
# may keep a few hundred extra entries for efficiency, which is fine for our
# resume window.

STREAM_MAXLEN = 10000
STREAM_TRADE_UPDATES_PREFIX = "trade_updates"
STREAM_PORTFOLIO = "portfolio"


def _stream_encode(event: dict[str, Any]) -> dict[str, str]:
    """Encode a dict to string fields for XADD.

    Redis streams only accept string values. Non-string values are JSON-encoded
    so ``XREAD`` consumers can round-trip back to a dict. The ``_payload`` key
    holds the whole JSON blob so the consumer only has to decode one field.
    """
    return {"_payload": orjson.dumps({**event, "_ts": time.time()}).decode()}


def _stream_decode(fields: dict[str, str]) -> dict[str, Any]:
    """Decode a stream entry's fields back into the original event dict."""
    payload = fields.get("_payload")
    if not payload:
        # Fallback for manually-added entries that didn't use _stream_encode.
        return dict(fields)
    try:
        return orjson.loads(payload)
    except Exception:
        return {"_raw": payload}


async def redis_xadd_trade_update(user_id: str, event: dict[str, Any]) -> str:
    """Append ``event`` to ``trade_updates:{user_id}`` and return the event ID.

    Trims the stream to ~10k entries (MAXLEN ~ 10000) so we never exceed the
    Redis memory budget. Callers should ignore the returned ID unless they
    need to echo it back to a requester (e.g. for debugging or confirmation).
    """
    r = await get_redis()
    stream = f"{STREAM_TRADE_UPDATES_PREFIX}:{user_id}"
    fields = _stream_encode(event)
    # approximate=True emits ``MAXLEN ~`` which is O(1) amortised vs. the
    # exact trim. We don't care about the exact head/tail boundary for a
    # resume window — we just need a bound.
    return await r.xadd(stream, fields, maxlen=STREAM_MAXLEN, approximate=True)


async def redis_xadd_portfolio(event: dict[str, Any]) -> str:
    """Append a portfolio event to the shared ``portfolio`` stream."""
    r = await get_redis()
    fields = _stream_encode(event)
    return await r.xadd(STREAM_PORTFOLIO, fields, maxlen=STREAM_MAXLEN, approximate=True)


async def redis_xread_trade_updates(
    user_id: str,
    last_id: str = "$",
    block_ms: int = 0,
    count: int = 100,
) -> list[tuple[str, dict[str, Any]]]:
    """Read new trade_updates for ``user_id`` after ``last_id``.

    ``last_id`` can be:
      * ``"0-0"`` — replay from the beginning of the stream.
      * ``"$"``   — live-only (no replay; pair with ``block_ms`` > 0 to wait
        for a new event). Default for fresh subscribers that don't send a
        resume token.
      * A real stream ID — replay everything strictly after that ID.

    ``block_ms`` semantics mirror redis-py:
      * 0 → non-blocking (return immediately with whatever is available).
      * > 0 → block up to this many milliseconds waiting for new data.

    Note the redis-py convention is ``block=0`` → block-forever; we flip
    the semantics here so the more conservative "don't block" is the
    default. Pass ``block_ms`` > 0 explicitly when you want to wait.

    Returns a list of ``(id, event)`` tuples. Empty list on timeout / no data.
    """
    r = await get_redis()
    stream = f"{STREAM_TRADE_UPDATES_PREFIX}:{user_id}"
    # redis-py: block=None -> non-blocking, block=0 -> block-forever. We
    # want block_ms=0 to mean "don't block" since that's the safer default
    # for a web handler. Translate.
    block_arg: int | None = None if block_ms <= 0 else block_ms
    raw = await r.xread({stream: last_id}, count=count, block=block_arg)
    out: list[tuple[str, dict[str, Any]]] = []
    if not raw:
        return out
    for _stream_name, entries in raw:
        for entry_id, fields in entries:
            out.append((entry_id, _stream_decode(fields)))
    return out


async def redis_xread_portfolio(
    last_id: str = "$",
    block_ms: int = 0,
    count: int = 100,
) -> list[tuple[str, dict[str, Any]]]:
    """Read portfolio stream entries after ``last_id``.

    See :func:`redis_xread_trade_updates` for the ``block_ms`` convention
    (0 = non-blocking; positive = wait up to that many ms for new data).
    """
    r = await get_redis()
    block_arg: int | None = None if block_ms <= 0 else block_ms
    raw = await r.xread({STREAM_PORTFOLIO: last_id}, count=count, block=block_arg)
    out: list[tuple[str, dict[str, Any]]] = []
    if not raw:
        return out
    for _stream_name, entries in raw:
        for entry_id, fields in entries:
            out.append((entry_id, _stream_decode(fields)))
    return out


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

async def cache_get(key: str) -> Any | None:
    """Read+decode a JSON value from Redis. Returns ``None`` on miss
    or operational error.

    Round-11 / BB-15 (P1): split the failure modes. A
    ``JSONDecodeError`` means the value at ``key`` is corrupt — the
    previous swallow-all returned ``None`` and the caller silently
    fetched fresh + wrote back, leaving the bad value in place for
    its full TTL. Now we delete the corrupt key and emit ERROR. A
    connection error stays at the original quiet behaviour because
    Redis flaps are recoverable and noisy on ERROR would drown the
    real problems.
    """
    try:
        r = await get_redis()
        raw = await r.get(key)
        if raw is None:
            return None
        try:
            return orjson.loads(raw)
        except Exception as decode_err:
            # Round-11 / BB-15: poisoned key — delete it and surface so
            # a future visitor doesn't re-hit the same corruption for
            # the rest of the TTL.
            try:
                await r.delete(key)
            except Exception:  # pragma: no cover — defensive
                pass
            import logging
            logging.getLogger(__name__).error(
                "cache_get: corrupt JSON at key=%s; deleted",
                key,
                exc_info=decode_err,
            )
            return None
    except Exception:
        return None


async def cache_set(key: str, data: Any, ttl_seconds: int = 300) -> None:
    try:
        r = await get_redis()
        if ttl_seconds <= 0:
            # No expiry — persist indefinitely (survives restarts)
            await r.set(key, orjson.dumps(data).decode())
        else:
            await r.set(key, orjson.dumps(data).decode(), ex=ttl_seconds)
    except Exception:
        pass


async def cache_incr(key: str, *, ttl_seconds: int = 86_400) -> int | None:
    """Atomically increment a Redis counter by 1 and (re-)set its TTL.

    Round-11 / Batch-F simplify: the four metric counters introduced for
    BB-11/BB-12/BB-16/BB-19 were each a non-atomic
    ``cache_get → int(prev) → cache_set(prev+1)`` block — racy under
    contention (two workers reading 5 both write 6 → one increment lost)
    and twice the round-trips a Redis ``INCR`` would take. This helper
    collapses the pattern to a single atomic ``INCR`` + ``EXPIRE``.

    Audit B-F11 (2026-05-05): the original implementation issued INCR
    and EXPIRE as separate round-trips. If the worker crashed (or the
    Redis connection dropped) between the two, the freshly-created
    counter key would persist with no TTL — a memory leak per missing
    EXPIRE. Replaced with a single Lua EVAL that performs both ops
    atomically inside Redis. The ``incr`` + best-effort ``expire``
    fallback path is kept for clients that don't support EVAL.

    Returns the new counter value, or ``None`` when Redis is
    unreachable (caller treats as best-effort metric).
    """
    _LUA = (
        "local v = redis.call('INCR', KEYS[1])\n"
        "if tonumber(ARGV[1]) > 0 then\n"
        "  redis.call('EXPIRE', KEYS[1], ARGV[1])\n"
        "end\n"
        "return v\n"
    )
    try:
        r = await get_redis()
        try:
            new = await r.eval(_LUA, 1, key, str(ttl_seconds))
            return int(new)
        except Exception:
            # Best-effort fallback for redis clients without EVAL.
            new = await r.incr(key)
            if ttl_seconds > 0:
                try:
                    await r.expire(key, ttl_seconds)
                except Exception:
                    pass
            return int(new)
    except Exception:
        return None
