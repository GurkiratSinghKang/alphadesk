"""Shared HTTP client for FMP ``/stable/`` endpoints.

FMP returns bare JSON lists/dicts with no pagination envelope, so this is
simpler than the Polygon client — just a GET with retry.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

BASE = "https://financialmodelingprep.com/stable"
MAX_RETRIES = 5
BACKOFF_BASE = 0.75


class FMPHTTP:
    def __init__(self, api_key: str | None = None, timeout: float = 30.0) -> None:
        key = api_key or settings.FMP_API_KEY.get_secret_value()
        if not key:
            raise RuntimeError("FMP_API_KEY missing — set it in .env")
        self._api_key = key
        self._client = httpx.Client(
            base_url=BASE,
            timeout=timeout,
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "FMPHTTP":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def get(self, path: str, params: dict | None = None) -> Any:
        params = dict(params or {})
        params["apikey"] = self._api_key
        delay = BACKOFF_BASE
        for attempt in range(MAX_RETRIES):
            try:
                r = self._client.get(path, params=params)
            except httpx.TransportError as exc:
                if attempt == MAX_RETRIES - 1:
                    raise
                logger.warning("fmp transport error %s; retrying in %.1fs", exc, delay)
                _sleep(delay)
                delay *= 2
                continue
            if r.status_code == 200:
                data = r.json()
                # FMP sometimes returns 200 with {"Error Message": "..."}
                if isinstance(data, dict) and "Error Message" in data:
                    raise RuntimeError(f"FMP error: {data['Error Message']}")
                return data
            if r.status_code == 429 or 500 <= r.status_code < 600:
                if attempt == MAX_RETRIES - 1:
                    r.raise_for_status()
                retry_after = float(r.headers.get("Retry-After", delay))
                logger.warning("fmp %s on %s; sleep %.1fs", r.status_code, path, retry_after)
                _sleep(retry_after)
                delay *= 2
                continue
            r.raise_for_status()
        raise RuntimeError("unreachable")


def _sleep(seconds: float) -> None:
    """Sync backoff sleep.

    Retained for the sync ``get()`` call path, which is invoked from
    strategies via ``asyncio.to_thread`` — in that case the event loop
    runs on a different thread so ``time.sleep`` blocks only the
    thread-pool worker, not the loop. Direct async call sites should
    await :func:`_asleep` instead.
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
