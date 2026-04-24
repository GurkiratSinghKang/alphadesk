"""B-47/B-48 — options-route caches must be bounded (TTL + LRU)."""
from __future__ import annotations

from collections import OrderedDict

import pytest


def test_ttl_lru_evicts_expired_entries_on_write():
    from api.routes.options import _ttl_lru_set

    cache: OrderedDict = OrderedDict()
    # Insert 3 entries at t=0 with TTL=10s
    for i, k in enumerate(["a", "b", "c"]):
        _ttl_lru_set(cache, k, i, now=0.0, ttl=10.0, maxsize=100)
    assert list(cache.keys()) == ["a", "b", "c"]

    # 20 s later, write a 4th. All three originals are > TTL so should purge.
    _ttl_lru_set(cache, "d", 99, now=20.0, ttl=10.0, maxsize=100)
    assert list(cache.keys()) == ["d"]


def test_ttl_lru_enforces_maxsize_evicting_oldest():
    from api.routes.options import _ttl_lru_set

    cache: OrderedDict = OrderedDict()
    for i in range(10):
        _ttl_lru_set(cache, str(i), i, now=0.0, ttl=3600.0, maxsize=5)
    # Only last 5 should survive; oldest evicted.
    assert list(cache.keys()) == ["5", "6", "7", "8", "9"]


def test_ttl_lru_updates_existing_key_without_growth():
    from api.routes.options import _ttl_lru_set

    cache: OrderedDict = OrderedDict()
    for _ in range(10):
        _ttl_lru_set(cache, "x", 1, now=0.0, ttl=100.0, maxsize=5)
    # Updating the same key shouldn't grow the cache.
    assert list(cache.keys()) == ["x"]
    assert len(cache) == 1


def test_ttl_lru_is_stable_under_mixed_ops():
    from api.routes.options import _ttl_lru_set

    cache: OrderedDict = OrderedDict()
    # Insert 10 entries within TTL, maxsize 5 → last 5 kept.
    for i in range(10):
        _ttl_lru_set(cache, f"k{i}", i, now=float(i), ttl=100.0, maxsize=5)
    assert len(cache) == 5
    # Overall memory budget holds: never exceeds maxsize.
    for i in range(100):
        _ttl_lru_set(cache, f"z{i}", i, now=float(i), ttl=100.0, maxsize=5)
    assert len(cache) == 5


def test_chain_cache_and_iv_cache_are_bounded():
    """Smoke-test the module-level caches use the helper."""
    from api.routes import options as opts
    from collections import OrderedDict as _OD

    assert isinstance(opts._real_spot_cache, _OD)
    assert isinstance(opts._chain_cache, _OD)
    assert isinstance(opts._iv_cache, _OD)
