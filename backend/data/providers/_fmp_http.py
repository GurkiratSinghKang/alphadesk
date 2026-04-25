"""Shared HTTP client for FMP ``/stable/`` endpoints.

FMP returns bare JSON lists/dicts with no pagination envelope, so this is
simpler than the Polygon client — just a GET with retry.

Round-6 K-9 — async migration
=============================
The historical client is a sync ``httpx.Client`` that callers wrap in
``asyncio.to_thread``. That works but burns a thread-pool worker per
in-flight FMP call and pays the kernel context-switch cost twice.

This module now also exposes ``AsyncFMPHTTP`` — a module-singleton
``httpx.AsyncClient`` that the routes / services SHOULD migrate to
incrementally. The lifespan teardown in ``main.py`` calls
``await close_async_client()`` on shutdown so the pool drains cleanly
instead of being abandoned mid-flight.
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
        # Round-6 K-10: bumped pool from (10, 20) to (50, 100) so a
        # burst of earnings hydration / strategy backtests doesn't
        # starve on connection waits.
        self._client = httpx.Client(
            base_url=BASE,
            timeout=timeout,
            limits=httpx.Limits(max_keepalive_connections=50, max_connections=100),
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


# ---------------------------------------------------------------------------
# Round-6 K-9 — async client + module singleton
# ---------------------------------------------------------------------------
# A long-lived ``httpx.AsyncClient`` that the routes / services should
# migrate to so we don't burn a thread-pool worker per FMP call. Created
# lazily on first use so test suites that don't need it pay zero cost.
# ``close_async_client()`` is called from ``main.py``'s lifespan
# teardown so the pool drains cleanly on shutdown.

_ASYNC_CLIENT: httpx.AsyncClient | None = None
_ASYNC_CLIENT_LOCK = asyncio.Lock()


async def get_async_client() -> httpx.AsyncClient:
    """Return the shared :class:`httpx.AsyncClient` (lazy init).

    Round-6 K-9: replaces the per-call ``asyncio.to_thread(provider.get,
    …)`` pattern. Module-singleton so HTTP/2 connection reuse works
    across calls, with the same (50, 100) pool sizing as the sync
    client (K-10).

    Concurrent first-call protection: ``_ASYNC_CLIENT_LOCK`` serialises
    the (rare) race between two tasks both seeing ``_ASYNC_CLIENT is
    None``, so we don't end up with two clients (only one of which the
    teardown closes).
    """
    global _ASYNC_CLIENT
    if _ASYNC_CLIENT is None:
        async with _ASYNC_CLIENT_LOCK:
            if _ASYNC_CLIENT is None:  # double-checked under lock
                _ASYNC_CLIENT = httpx.AsyncClient(
                    base_url=BASE,
                    timeout=30.0,
                    limits=httpx.Limits(
                        max_keepalive_connections=50,
                        max_connections=100,
                    ),
                )
    return _ASYNC_CLIENT


async def close_async_client() -> None:
    """Drain + close the module-singleton client.

    Called from ``main.py``'s lifespan teardown so we don't leak
    connections at shutdown. Idempotent — repeated calls are no-ops.
    """
    global _ASYNC_CLIENT
    if _ASYNC_CLIENT is not None:
        try:
            await _ASYNC_CLIENT.aclose()
        finally:
            _ASYNC_CLIENT = None


async def afetch(path: str, params: dict | None = None) -> Any:
    """Async GET against the FMP base URL with retry + secret-injection.

    Mirrors the semantics of :meth:`FMPHTTP.get`:
      - Adds ``apikey=...`` param.
      - Retries on transport errors, 429, and 5xx with exponential
        backoff that respects ``Retry-After``.
      - Detects ``{"Error Message": "..."}`` 200 bodies as failures.
    """
    client = await get_async_client()
    api_key = settings.FMP_API_KEY.get_secret_value() if settings.FMP_API_KEY else ""
    if not api_key:
        raise RuntimeError("FMP_API_KEY missing — set it in .env")
    qs = dict(params or {})
    qs["apikey"] = api_key
    delay = BACKOFF_BASE
    for attempt in range(MAX_RETRIES):
        try:
            r = await client.get(path, params=qs)
        except httpx.TransportError as exc:
            if attempt == MAX_RETRIES - 1:
                raise
            logger.warning("fmp(async) transport error %s; retrying in %.1fs", exc, delay)
            await _asleep(delay)
            delay *= 2
            continue
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, dict) and "Error Message" in data:
                raise RuntimeError(f"FMP error: {data['Error Message']}")
            return data
        if r.status_code == 429 or 500 <= r.status_code < 600:
            if attempt == MAX_RETRIES - 1:
                r.raise_for_status()
            retry_after = float(r.headers.get("Retry-After", delay))
            logger.warning("fmp(async) %s on %s; sleep %.1fs", r.status_code, path, retry_after)
            await _asleep(retry_after)
            delay *= 2
            continue
        r.raise_for_status()
    raise RuntimeError("unreachable")
