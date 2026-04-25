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

# Schema versioning
# -----------------
# ``_CURRENT_SCHEMA_VERSION`` stamps every value the cache writes. On
# read, mismatched versions are treated as a miss so an old payload
# can never deserialise into a newer Pydantic shape that has added or
# renamed fields. This is the migration trigger — bump the version any
# time a cached schema gains, drops, or renames a field. Old entries
# return None (a normal cache miss) and the next call refills with the
# new version; nothing is permanently lost.
#
# v1 → v2 (Round-5 Cluster D G-12): EarningsDetail gained
# ``error_codes``, ``StrikeLadder`` gained ``is_demo``, ``OptionChain``
# gained ``is_demo``. Old v1 entries written by pre-Round-5 code would
# drop these fields silently, so we stamp v2 on writes and reject v1
# on reads.
"""
from __future__ import annotations

import logging
from typing import Any

from core.redis import cache_get, cache_set

logger = logging.getLogger(__name__)


# Round-5 Cluster D G-12: bumped from 1 → 2 to invalidate cached entries
# written before the EarningsDetail / StrikeLadder / OptionChain field
# additions. See module docstring for the migration story.
_CURRENT_SCHEMA_VERSION = 2
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

        Round-5 Cluster D H-5: hit/miss/schema_mismatch outcomes emit
        DEBUG log records with ``key_prefix`` so operators can trace
        cache performance during incidents without enabling Redis
        MONITOR (which has a non-trivial perf cost).
        """
        # The key prefix (chunk before the first colon) is high-cardinality
        # but bounded; it segments the log without leaking per-symbol PII
        # like full key bodies might.
        key_prefix = key.split(":", 1)[0]
        raw = await cache_get(key)
        if raw is None:
            logger.debug(
                "cache.miss",
                extra={
                    "event": "cache",
                    "outcome": "miss",
                    "key_prefix": key_prefix,
                },
            )
            return None
        # Back-compat: values written before envelopes shipped are plain
        # dicts/lists/scalars. Treat them as v0 and discard. A second
        # ``set`` from the same caller will rewrite under the new shape.
        if not (isinstance(raw, dict) and "schema_version" in raw and "value" in raw):
            logger.info(
                "cache: discarding pre-envelope entry key=%s (will refill)", key,
                extra={
                    "event": "cache",
                    "outcome": "legacy_untyped",
                    "key_prefix": key_prefix,
                },
            )
            return None
        stored_v = raw.get("schema_version")
        if stored_v != schema_version:
            logger.info(
                "cache: schema mismatch key=%s stored_v=%s expected_v=%s",
                key, stored_v, schema_version,
                extra={
                    "event": "cache",
                    "outcome": "schema_mismatch",
                    "key_prefix": key_prefix,
                    "found_version": stored_v,
                    "expected_version": schema_version,
                },
            )
            return None
        logger.debug(
            "cache.hit",
            extra={
                "event": "cache",
                "outcome": "hit",
                "key_prefix": key_prefix,
            },
        )
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
