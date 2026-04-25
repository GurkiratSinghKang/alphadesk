"""Round-6 K-9 — FMP AsyncClient module singleton."""
from __future__ import annotations

import os

os.environ.setdefault("JWT_SECRET", "test-secret-for-k9-" + "x" * 32)
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SKIP_DB_INIT", "true")
os.environ.setdefault("FMP_API_KEY", "fake-key-for-test")

import httpx
import pytest


@pytest.mark.asyncio
async def test_get_async_client_returns_singleton():
    """Two calls to get_async_client() return the same instance."""
    from data.providers import _fmp_http

    # Force a clean slate.
    if _fmp_http._ASYNC_CLIENT is not None:
        await _fmp_http.close_async_client()

    a = await _fmp_http.get_async_client()
    b = await _fmp_http.get_async_client()
    assert a is b
    assert isinstance(a, httpx.AsyncClient)
    # Pool sizing is K-10's (50, 100). httpx exposes the configured
    # transport via _transport on the AsyncClient; rather than peek at
    # private internals across httpx versions we just assert the
    # client was actually constructed (concrete pool checks live in
    # the underlying httpx-pool tests).
    assert not a.is_closed


@pytest.mark.asyncio
async def test_close_async_client_idempotent():
    """Repeated close() calls don't raise."""
    from data.providers import _fmp_http

    await _fmp_http.get_async_client()
    await _fmp_http.close_async_client()
    await _fmp_http.close_async_client()  # second call is a no-op


@pytest.mark.asyncio
async def test_afetch_injects_apikey_and_returns_json(monkeypatch):
    """afetch() must add ``apikey`` and parse JSON."""
    from data.providers import _fmp_http

    # Reset client state for a clean transport mock.
    if _fmp_http._ASYNC_CLIENT is not None:
        await _fmp_http.close_async_client()

    captured: dict = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json=[{"symbol": "AAPL"}])

    transport = httpx.MockTransport(_handler)

    def _client_factory():
        return httpx.AsyncClient(
            base_url=_fmp_http.BASE,
            timeout=30.0,
            transport=transport,
            limits=httpx.Limits(max_keepalive_connections=50, max_connections=100),
        )

    # Replace the singleton with a transport-mocked client.
    _fmp_http._ASYNC_CLIENT = _client_factory()

    out = await _fmp_http.afetch("/quote/AAPL")
    assert out == [{"symbol": "AAPL"}]
    assert "apikey=fake-key-for-test" in captured["url"]


@pytest.mark.asyncio
async def test_afetch_raises_on_error_message_body(monkeypatch):
    """A 200 with ``{"Error Message": "..."}`` body must raise."""
    from data.providers import _fmp_http

    if _fmp_http._ASYNC_CLIENT is not None:
        await _fmp_http.close_async_client()

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"Error Message": "Invalid API KEY"})

    transport = httpx.MockTransport(_handler)
    _fmp_http._ASYNC_CLIENT = httpx.AsyncClient(
        base_url=_fmp_http.BASE,
        timeout=30.0,
        transport=transport,
    )

    with pytest.raises(RuntimeError, match="FMP error"):
        await _fmp_http.afetch("/quote/AAPL")
