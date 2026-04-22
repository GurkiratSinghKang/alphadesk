"""Async cache facade wrapping the project's Redis-backed cache helpers.

Other services (see `services.earnings_screener`) want a single object with
``get`` / ``set`` methods, rather than the module-level ``cache_get`` /
``cache_set`` functions exposed by :mod:`core.redis`. This wrapper
provides that shape without duplicating the underlying implementation.
"""
from __future__ import annotations

from typing import Any

from core.redis import cache_get, cache_set


class _RedisCache:
    """Thin async wrapper over :mod:`core.redis` cache helpers.

    Exposes the interface the aggregators want
    (``await cache.get(key)`` / ``await cache.set(key, value, ttl_seconds=…)``)
    without forcing callers to know about the module-level functions.
    """

    async def get(self, key: str) -> Any | None:
        return await cache_get(key)

    async def set(self, key: str, value: Any, *, ttl_seconds: int = 300) -> None:
        await cache_set(key, value, ttl_seconds=ttl_seconds)


_CACHE: _RedisCache | None = None


def get_cache() -> _RedisCache:
    """Return the shared cache instance (lazily constructed)."""
    global _CACHE
    if _CACHE is None:
        _CACHE = _RedisCache()
    return _CACHE
