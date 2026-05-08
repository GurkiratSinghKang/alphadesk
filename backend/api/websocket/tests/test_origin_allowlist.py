"""Round-6 L-4 — WebSocket Origin allowlist tests.

The WebSocket handshake doesn't go through CORS preflight, so a
malicious page on https://attacker.example can otherwise open a
``new WebSocket("wss://tradingalpha.net/ws")`` from the user's browser
and ride their HttpOnly auth cookies into the auth handshake (CSWSH).
The fix checks ``ws.headers.get("origin")`` against an allowlist
BEFORE ``ws.accept()`` runs.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture(autouse=True)
def _settings_env(monkeypatch):
    os.environ.setdefault("JWT_SECRET", "test-secret-for-l4-" + "x" * 32)
    os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    os.environ.setdefault("SKIP_DB_INIT", "true")


def _make_ws(origin: str | None) -> MagicMock:
    """A minimal WebSocket-shaped mock with the given Origin header."""
    headers = {} if origin is None else {"origin": origin}
    ws = MagicMock()
    ws.headers = headers
    ws.accept = AsyncMock()
    ws.close = AsyncMock()
    ws.cookies = {}
    return ws


def test_allowed_origins_includes_localhost_in_dev(monkeypatch):
    """Non-prod includes localhost dev origins."""
    from api.websocket.handler import _allowed_ws_origins
    from core.config import settings
    import core.config as cfg_mod

    s = settings.model_copy(update={"ENVIRONMENT": settings.ENVIRONMENT})
    # Force non-prod by clearing PRODUCTION_ORIGIN
    s.PRODUCTION_ORIGIN = ""
    monkeypatch.setattr(cfg_mod, "settings", s)
    # Need to also patch the alias bound in the module under test
    import api.websocket.handler as ws_mod
    monkeypatch.setattr(ws_mod, "_allowed_ws_origins", _allowed_ws_origins)

    origins = _allowed_ws_origins()
    if not s.is_production:
        assert "http://localhost:3000" in origins
        assert "http://127.0.0.1:3000" in origins


@pytest.mark.asyncio
async def test_websocket_accepts_allowlisted_origin(monkeypatch):
    """A request with Origin in the allowlist is accepted."""
    from api.websocket import handler as ws_mod

    async def _allowed():
        return {"http://localhost:3000"}

    monkeypatch.setattr(
        ws_mod, "_allowed_ws_origins",
        lambda: {"http://localhost:3000"},
    )

    ws = _make_ws("http://localhost:3000")
    # Stop after auth path — we just care that accept() was called.
    ws.receive_text = AsyncMock(side_effect=Exception("stop after accept"))
    try:
        await ws_mod.websocket_endpoint(ws)
    except Exception:
        pass

    ws.accept.assert_called_once()
    # close() may be called during teardown but NOT with code=1008
    # (origin reject) before accept().
    if ws.close.called:
        for call in ws.close.call_args_list:
            if call.kwargs.get("code") == 1008:
                raise AssertionError("websocket closed with 1008 despite allowlisted origin")


@pytest.mark.asyncio
async def test_websocket_rejects_disallowed_origin(monkeypatch):
    """A cross-origin handshake is closed with code 1008 BEFORE accept()."""
    from api.websocket import handler as ws_mod

    monkeypatch.setattr(
        ws_mod, "_allowed_ws_origins",
        lambda: {"http://localhost:3000"},
    )

    ws = _make_ws("https://attacker.example")
    await ws_mod.websocket_endpoint(ws)

    # ws.accept() was NEVER called — origin check fired first.
    ws.accept.assert_not_called()
    # ws.close() was called with code=1008.
    assert ws.close.called
    close_call = ws.close.call_args_list[0]
    assert close_call.kwargs.get("code") == 1008


@pytest.mark.asyncio
async def test_websocket_rejects_browser_origin_when_prod_allowlist_empty(monkeypatch):
    """Production with no configured allowlist rejects browser origins."""
    from api.websocket import handler as ws_mod
    import core.config as cfg_mod

    monkeypatch.setattr(ws_mod, "_allowed_ws_origins", lambda: set())
    monkeypatch.setattr(
        cfg_mod,
        "settings",
        cfg_mod.settings.model_copy(update={"ENVIRONMENT": "prod", "PRODUCTION_ORIGIN": ""}),
    )

    ws = _make_ws("https://anything.example")
    await ws_mod.websocket_endpoint(ws)

    ws.accept.assert_not_called()
    assert ws.close.called
    close_call = ws.close.call_args_list[0]
    assert close_call.kwargs.get("code") == 1008


@pytest.mark.asyncio
async def test_websocket_allows_no_origin_header(monkeypatch):
    """A non-browser client (no Origin header) is allowed.

    These clients (CLI ws probes, internal smoke tests) don't carry
    ambient browser cookies, so CSWSH doesn't apply.
    """
    from api.websocket import handler as ws_mod

    monkeypatch.setattr(
        ws_mod, "_allowed_ws_origins",
        lambda: {"http://localhost:3000"},
    )

    ws = _make_ws(None)
    ws.receive_text = AsyncMock(side_effect=Exception("stop after accept"))
    try:
        await ws_mod.websocket_endpoint(ws)
    except Exception:
        pass

    ws.accept.assert_called_once()
