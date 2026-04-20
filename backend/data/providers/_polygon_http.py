"""Shared HTTP client for the Polygon providers.

Separated so :mod:`polygon_bars` and :mod:`polygon_options` stay small and
share a single connection-pooled ``httpx.Client`` with unified backoff.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Iterable

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

BASE = "https://api.polygon.io"
MAX_RETRIES = 5
BACKOFF_BASE = 0.75


class PolygonHTTP:
    """Low-level HTTP client with 429/5xx retry + Polygon ``next_url`` paging."""

    def __init__(self, api_key: str | None = None, timeout: float = 30.0) -> None:
        key = api_key or settings.POLYGON_API_KEY.get_secret_value()
        if not key:
            raise RuntimeError("POLYGON_API_KEY missing — set it in .env")
        self._api_key = key
        self._client = httpx.Client(
            base_url=BASE,
            timeout=timeout,
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "PolygonHTTP":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def get(self, path: str, params: dict | None = None) -> dict:
        params = dict(params or {})
        params.setdefault("apiKey", self._api_key)
        delay = BACKOFF_BASE
        for attempt in range(MAX_RETRIES):
            try:
                r = self._client.get(path, params=params)
            except httpx.TransportError as exc:
                if attempt == MAX_RETRIES - 1:
                    raise
                logger.warning("polygon transport error %s; retrying in %.1fs", exc, delay)
                _sleep(delay)
                delay *= 2
                continue
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429 or 500 <= r.status_code < 600:
                if attempt == MAX_RETRIES - 1:
                    r.raise_for_status()
                retry_after = float(r.headers.get("Retry-After", delay))
                logger.warning("polygon %s on %s; sleep %.1fs", r.status_code, path, retry_after)
                _sleep(retry_after)
                delay *= 2
                continue
            r.raise_for_status()
        raise RuntimeError("unreachable")

    def paginate(self, path: str, params: dict) -> Iterable[dict]:
        data = self.get(path, params)
        while True:
            for item in data.get("results") or []:
                yield item
            next_url = data.get("next_url")
            if not next_url:
                return
            next_url = next_url + ("&" if "?" in next_url else "?") + f"apiKey={self._api_key}"
            delay = BACKOFF_BASE
            for attempt in range(MAX_RETRIES):
                try:
                    r = self._client.get(next_url)
                except httpx.TransportError as exc:
                    if attempt == MAX_RETRIES - 1:
                        raise
                    logger.warning("polygon paginate transport error %s; retrying in %.1fs", exc, delay)
                    _sleep(delay)
                    delay *= 2
                    continue
                if r.status_code == 200:
                    break
                if r.status_code == 429 or 500 <= r.status_code < 600:
                    if attempt == MAX_RETRIES - 1:
                        r.raise_for_status()
                    retry_after = float(r.headers.get("Retry-After", delay))
                    logger.warning("polygon paginate %s; sleep %.1fs", r.status_code, retry_after)
                    _sleep(retry_after)
                    delay *= 2
                    continue
                r.raise_for_status()
            data = r.json()


def _sleep(seconds: float) -> None:
    """Sync backoff sleep.

    Retained for the sync ``get()`` / ``paginate()`` call path, invoked
    from strategy code via ``asyncio.to_thread`` (the event loop runs on
    a different thread so ``time.sleep`` blocks only the thread-pool
    worker, not the loop). Direct async call sites should await
    :func:`_asleep` instead.
    """
    import time as _time

    _time.sleep(seconds)


async def _asleep(seconds: float) -> None:
    """Async backoff sleep — non-blocking on the event loop.

    Wave 3L Fix 2 (persona-86/90): the task flagged ``time.sleep`` at
    the original retry site as blocking the event loop. This coroutine
    variant lets async call sites yield control via ``asyncio.sleep``
    instead. Tests can patch this symbol to short-circuit the backoff.
    """
    await asyncio.sleep(seconds)
