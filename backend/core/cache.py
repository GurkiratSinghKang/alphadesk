"""Async cache facade wrapping the project's Redis-backed cache helpers.

Other services (see `services.earnings_screener`) want a single object with
``get`` / ``set`` methods, rather than the module-level ``cache_get`` /
``cache_set`` functions exposed by :mod:`core.redis`. This wrapper
provides that shape without duplicating the underlying implementation.

B-32 — every value written through ``set`` is wrapped in an envelope
``{"schema_version": N, "value": <payload>}``. On ``get`` we unwrap and
verify the version matches the caller's expectation; a mismatch (e.g.
after a schema change across deploys) is treated as a cache miss rather
than being silently deserialised into the current schema and crashing
downstream. This prevents the classic "old Pydantic shape cached under
``foo`` but the new code expects a required field that's absent" cascade
of 422s that would otherwise follow a rolling deploy.
"""
from __future__ import annotations

import logging
from typing import Any

from core.redis import cache_get, cache_set

logger = logging.getLogger(__name__)


_CURRENT_SCHEMA_VERSION = 1
"""Default envelope version when the caller doesn't specify one.

Bump this only for breaking changes to values that are shared across the
app. Per-key subsystems (like the earnings-options-play Claude cache)
should pass their own ``schema_version`` to ``set/get`` so one subsystem
forcing a bump doesn't invalidate everyone else's entries."""


class _RedisCache:
    """Thin async wrapper over :mod:`core.redis` cache helpers."""

    async def get(
        self,
        key: str,
        *,
        schema_version: int = _CURRENT_SCHEMA_VERSION,
    ) -> Any | None:
        """Return the cached value if the stored envelope version matches.

        Cache misses AND schema-version mismatches both return ``None``;
        the caller can't tell the difference and shouldn't need to. A
        mismatch is logged at INFO so oncall can see the rebuild cost
        after a schema-bumping deploy.
        """
        raw = await cache_get(key)
        if raw is None:
            return None
        # Back-compat: values written before envelopes shipped are plain
        # dicts/lists/scalars. Treat them as v0 and discard. A second
        # ``set`` from the same caller will rewrite under the new shape.
        if not (isinstance(raw, dict) and "schema_version" in raw and "value" in raw):
            logger.info(
                "cache: discarding pre-envelope entry key=%s (will refill)", key,
            )
            return None
        stored_v = raw.get("schema_version")
        if stored_v != schema_version:
            logger.info(
                "cache: schema mismatch key=%s stored_v=%s expected_v=%s",
                key, stored_v, schema_version,
            )
            return None
        return raw.get("value")

    async def set(
        self,
        key: str,
        value: Any,
        *,
        ttl_seconds: int = 300,
        schema_version: int = _CURRENT_SCHEMA_VERSION,
    ) -> None:
        """Wrap ``value`` in a versioned envelope before writing to Redis."""
        envelope = {"schema_version": schema_version, "value": value}
        await cache_set(key, envelope, ttl_seconds=ttl_seconds)


_CACHE: _RedisCache | None = None


def get_cache() -> _RedisCache:
    """Return the shared cache instance (lazily constructed)."""
    global _CACHE
    if _CACHE is None:
        _CACHE = _RedisCache()
    return _CACHE


__all__ = ["get_cache", "_CURRENT_SCHEMA_VERSION"]
