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
    """Return the global Redis connection (lazily initialised)."""
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

ALL_CHANNELS = [CHANNEL_QUOTES, CHANNEL_PORTFOLIO, CHANNEL_ALERTS, CHANNEL_AGENTS, CHANNEL_BARS]


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
# Cache helpers
# ---------------------------------------------------------------------------

async def cache_get(key: str) -> Any | None:
    try:
        r = await get_redis()
        raw = await r.get(key)
        if raw is None:
            return None
        return orjson.loads(raw)
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
