"""B-32 — cache envelope + schema versioning."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_set_wraps_in_envelope():
    from core.cache import get_cache

    with patch("core.cache.cache_set", new_callable=AsyncMock) as mock_set:
        await get_cache().set("k", {"foo": "bar"}, ttl_seconds=10, schema_version=3)

    args, kwargs = mock_set.call_args
    assert args[0] == "k"
    envelope = args[1]
    assert envelope == {"schema_version": 3, "value": {"foo": "bar"}}
    assert kwargs["ttl_seconds"] == 10


@pytest.mark.asyncio
async def test_get_returns_value_on_version_match():
    from core.cache import get_cache

    with patch(
        "core.cache.cache_get",
        new_callable=AsyncMock,
        return_value={"schema_version": 2, "value": {"hi": 1}},
    ):
        out = await get_cache().get("k", schema_version=2)
    assert out == {"hi": 1}


@pytest.mark.asyncio
async def test_get_returns_none_on_version_mismatch():
    from core.cache import get_cache

    with patch(
        "core.cache.cache_get",
        new_callable=AsyncMock,
        return_value={"schema_version": 1, "value": {"old": True}},
    ):
        out = await get_cache().get("k", schema_version=2)
    assert out is None, "version mismatch must be treated as cache miss"


@pytest.mark.asyncio
async def test_get_returns_none_on_legacy_unwrapped_entry():
    """Entries written before envelopes shipped have no schema_version key.
    They must be discarded so callers refill with the wrapped shape."""
    from core.cache import get_cache

    with patch(
        "core.cache.cache_get",
        new_callable=AsyncMock,
        return_value={"foo": "bar"},  # pre-envelope shape
    ):
        out = await get_cache().get("k")
    assert out is None


@pytest.mark.asyncio
async def test_get_returns_none_on_true_cache_miss():
    from core.cache import get_cache

    with patch("core.cache.cache_get", new_callable=AsyncMock, return_value=None):
        out = await get_cache().get("k")
    assert out is None
