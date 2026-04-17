"""Parquet-backed local cache for provider method results.

Every call is keyed by ``(provider_class, method_name, args, kwargs)``, hashed
into a stable filename under ``~/.alphadesk/cache/<hash>.parquet``. Repeated
calls within the TTL window return the cached DataFrame without hitting the
vendor API.

Use via the :func:`cached` decorator on provider methods::

    class MyProvider:
        @cached(ttl_seconds=86_400)          # 24h
        def bars(self, symbols, start, end, tf="1D"):
            ...

The cache is thread-safe (one ``threading.Lock`` per hash) and process-safe
via filesystem atomicity (write-then-rename). Async methods are supported: the
decorator detects coroutines automatically.
"""

from __future__ import annotations

import asyncio
import functools
import hashlib
import json
import logging
import os
import tempfile
import threading
import time
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

_CACHE_ROOT = Path(os.environ.get("ALPHADESK_CACHE_DIR", Path.home() / ".alphadesk" / "cache"))
_CACHE_ROOT.mkdir(parents=True, exist_ok=True)

# One lock per cache key. Shared across threads; the outer lock protects the
# dict of per-key locks.
_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()

# Default TTLs (seconds)
TTL_INTRADAY = 60 * 60 * 24           # 1 day
TTL_DAILY = 60 * 60 * 24 * 7          # 1 week
TTL_ANNUAL = 60 * 60 * 24 * 30        # 30 days
TTL_SNAPSHOT = 60 * 15                # 15 minutes (live chains)


def _json_default(o: Any) -> Any:
    """Coerce non-JSON types into hashable representations for the key."""
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, (set, frozenset)):
        return sorted(list(o))
    if hasattr(o, "__dict__"):
        return repr(o)
    return str(o)


def _make_key(provider: str, method: str, args: tuple, kwargs: dict) -> str:
    """Deterministic hash of the call. ``self`` is intentionally dropped — the
    provider *class* identifies the data source; two instances of the same
    provider share cache entries."""
    payload = {
        "provider": provider,
        "method": method,
        "args": args,
        "kwargs": {k: kwargs[k] for k in sorted(kwargs)},
    }
    blob = json.dumps(payload, default=_json_default, sort_keys=True).encode()
    return hashlib.sha256(blob).hexdigest()[:24]


def _lock_for(key: str) -> threading.Lock:
    with _LOCKS_GUARD:
        if key not in _LOCKS:
            _LOCKS[key] = threading.Lock()
        return _LOCKS[key]


def _cache_path(key: str) -> Path:
    return _CACHE_ROOT / f"{key}.parquet"


def _meta_path(key: str) -> Path:
    return _CACHE_ROOT / f"{key}.meta.json"


class ParquetCache:
    """Low-level cache API. Normally you use :func:`cached` instead."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root) if root else _CACHE_ROOT
        self.root.mkdir(parents=True, exist_ok=True)

    def get(self, key: str, ttl_seconds: int) -> pd.DataFrame | None:
        path = self.root / f"{key}.parquet"
        meta = self.root / f"{key}.meta.json"
        if not path.exists() or not meta.exists():
            return None
        try:
            with meta.open("r") as f:
                m = json.load(f)
            if time.time() - m["ts"] > ttl_seconds:
                return None
            return pd.read_parquet(path)
        except Exception as exc:              # pragma: no cover - corruption path
            logger.warning("cache read failed for %s: %s", key, exc)
            return None

    def set(self, key: str, df: pd.DataFrame) -> None:
        path = self.root / f"{key}.parquet"
        meta = self.root / f"{key}.meta.json"
        # Write to a temp file in the same directory then rename — atomic on
        # POSIX so concurrent readers never see a torn parquet.
        with tempfile.NamedTemporaryFile(
            "wb", delete=False, dir=str(self.root), suffix=".parquet.tmp"
        ) as tmp:
            tmp_path = Path(tmp.name)
        try:
            df.to_parquet(tmp_path, compression="snappy", index=False)
            os.replace(tmp_path, path)
            with meta.open("w") as f:
                json.dump({"ts": time.time(), "rows": len(df)}, f)
        except Exception:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            raise

    def invalidate(self, key: str) -> None:
        for p in (self.root / f"{key}.parquet", self.root / f"{key}.meta.json"):
            if p.exists():
                p.unlink()

    def clear_all(self) -> int:
        """Nuke the cache. Returns number of files removed."""
        n = 0
        for p in self.root.iterdir():
            if p.suffix in (".parquet", ".json") and not p.name.startswith("."):
                p.unlink()
                n += 1
        return n


_DEFAULT_CACHE = ParquetCache()


def cached(
    ttl_seconds: int = TTL_DAILY,
    *,
    cache: ParquetCache | None = None,
) -> Callable:
    """Decorator that memoises a provider method to parquet.

    Works on both sync and async methods; the wrapper type is selected by
    inspecting the wrapped function. The decorator ignores ``self`` when
    building the key (two instances of the same provider class share cache).

    Args:
        ttl_seconds: Entry expires after this many seconds. Use one of the
            ``TTL_*`` constants at module top.
        cache: Override the default ``~/.alphadesk/cache`` location
            (mainly for tests).
    """
    store = cache or _DEFAULT_CACHE

    def decorate(fn: Callable) -> Callable:
        provider_name = fn.__qualname__.split(".")[0]
        method_name = fn.__name__
        is_async = asyncio.iscoroutinefunction(fn)

        if is_async:
            @functools.wraps(fn)
            async def async_wrapper(self, *args: Any, **kwargs: Any) -> pd.DataFrame:
                key = _make_key(provider_name, method_name, args, kwargs)
                hit = store.get(key, ttl_seconds)
                if hit is not None:
                    return hit
                # Async call: lock is still thread-level, but async tasks on a
                # single event loop don't need real mutual exclusion; we only
                # protect against two sync threads racing.
                lock = _lock_for(key)
                with lock:
                    hit = store.get(key, ttl_seconds)
                    if hit is not None:
                        return hit
                    result: pd.DataFrame = await fn(self, *args, **kwargs)
                    if not isinstance(result, pd.DataFrame):
                        raise TypeError(
                            f"@cached method {provider_name}.{method_name} must "
                            f"return DataFrame, got {type(result).__name__}"
                        )
                    store.set(key, result)
                    return result
            return async_wrapper

        @functools.wraps(fn)
        def sync_wrapper(self, *args: Any, **kwargs: Any) -> pd.DataFrame:
            key = _make_key(provider_name, method_name, args, kwargs)
            hit = store.get(key, ttl_seconds)
            if hit is not None:
                return hit
            lock = _lock_for(key)
            with lock:
                hit = store.get(key, ttl_seconds)
                if hit is not None:
                    return hit
                result = fn(self, *args, **kwargs)
                if not isinstance(result, pd.DataFrame):
                    raise TypeError(
                        f"@cached method {provider_name}.{method_name} must "
                        f"return DataFrame, got {type(result).__name__}"
                    )
                store.set(key, result)
                return result
        return sync_wrapper

    return decorate


if __name__ == "__main__":
    # Smoke test.
    import numpy as np

    c = ParquetCache()
    df = pd.DataFrame({"a": np.arange(5), "b": ["x"] * 5})
    key = "smoke-test-key"
    c.set(key, df)
    out = c.get(key, ttl_seconds=60)
    assert out is not None and len(out) == 5, "cache roundtrip failed"
    c.invalidate(key)
    assert c.get(key, 60) is None, "invalidate failed"
    print("cache OK ->", _CACHE_ROOT)
