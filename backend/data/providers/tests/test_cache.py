"""Unit tests for the ParquetCache (no network)."""

from __future__ import annotations

import threading
import time

import pandas as pd
import pytest

from data.providers.cache import ParquetCache, cached


def test_roundtrip(tmp_path):
    c = ParquetCache(tmp_path)
    df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
    c.set("k1", df)
    out = c.get("k1", ttl_seconds=60)
    assert out is not None
    assert out.equals(df)


def test_ttl_expiry(tmp_path):
    c = ParquetCache(tmp_path)
    df = pd.DataFrame({"a": [1]})
    c.set("k2", df)
    # Expire immediately
    assert c.get("k2", ttl_seconds=0) is None


def test_invalidate(tmp_path):
    c = ParquetCache(tmp_path)
    c.set("k3", pd.DataFrame({"a": [1]}))
    c.invalidate("k3")
    assert c.get("k3", 60) is None


def test_decorator_sync(tmp_path):
    c = ParquetCache(tmp_path)
    calls = {"n": 0}

    class P:
        @cached(ttl_seconds=60, cache=c)
        def foo(self, x: int) -> pd.DataFrame:
            calls["n"] += 1
            return pd.DataFrame({"x": [x, x + 1]})

    p = P()
    out1 = p.foo(5)
    out2 = p.foo(5)          # cached
    out3 = p.foo(6)          # new key
    assert out1.equals(out2)
    assert calls["n"] == 2    # only two real calls
    assert out3.iloc[0, 0] == 6


def test_decorator_rejects_non_dataframe(tmp_path):
    c = ParquetCache(tmp_path)

    class P:
        @cached(ttl_seconds=60, cache=c)
        def bad(self):
            return {"not": "dataframe"}

    with pytest.raises(TypeError):
        P().bad()


def test_decorator_thread_safety(tmp_path):
    c = ParquetCache(tmp_path)
    calls = {"n": 0}

    class P:
        @cached(ttl_seconds=60, cache=c)
        def slow(self, x: int) -> pd.DataFrame:
            time.sleep(0.05)
            calls["n"] += 1
            return pd.DataFrame({"x": [x]})

    p = P()
    results = [None] * 8
    threads = [
        threading.Thread(target=lambda i=i: results.__setitem__(i, p.slow(42)))
        for i in range(8)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    # All 8 should see the same dataframe; only one real call should happen
    assert calls["n"] == 1
    for r in results:
        assert r is not None and r.iloc[0, 0] == 42
