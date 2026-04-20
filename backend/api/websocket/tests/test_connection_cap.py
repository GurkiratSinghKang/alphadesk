"""Tests for Round 7 Fix 1 (P127) — WebSocket connection caps.

Prior behaviour: ``ConnectionManager.register()`` accepted every socket
unconditionally. 10k clients in a reconnect storm would exhaust the
kernel's per-process FD budget and the process would start EMFILE-ing on
every syscall (including Redis and the response path for the request
that caused the storm). The fix introduces two ceilings:

  * Global cap (``settings.WS_MAX_TOTAL``, default 500): no more than N
    concurrent sockets across the whole manager.
  * Per-user cap (``settings.WS_MAX_PER_USER``, default 5): no more than
    N concurrent sockets for any single ``user_id``.

On rejection the socket is closed with RFC 6455 code 4008 ("policy
violation") and register() returns False so the endpoint can bail.

These tests drive the manager directly through a fake WebSocket stub —
the full ASGI / FastAPI handshake isn't necessary to exercise the cap
logic and the manager is the only unit that enforces it.
"""

from __future__ import annotations

from typing import Any

import pytest

from api.websocket.handler import ConnectionManager


class _FakeWebSocket:
    """Minimal stand-in for ``fastapi.WebSocket`` used in the cap tests.

    The manager only reaches for ``ws.close(code=..., reason=...)`` on
    the rejection path. We capture those so the test can assert the
    right close code / reason was used.
    """

    def __init__(self) -> None:
        self.closed = False
        self.close_code: int | None = None
        self.close_reason: str | None = None

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = True
        self.close_code = code
        self.close_reason = reason


@pytest.fixture
def low_caps(monkeypatch: pytest.MonkeyPatch) -> tuple[int, int]:
    """Shrink caps via settings so tests don't need to open 500 sockets."""
    from core.config import settings

    monkeypatch.setattr(settings, "WS_MAX_TOTAL", 3, raising=False)
    monkeypatch.setattr(settings, "WS_MAX_PER_USER", 2, raising=False)
    return (3, 2)


@pytest.mark.asyncio
async def test_total_cap_rejects_with_4008(low_caps: tuple[int, int]) -> None:
    """Once ``WS_MAX_TOTAL`` sockets are registered, the next register()
    must close the new socket with code 4008 and return False.

    This is the "server is full" path — kernel-FD protection from a
    reconnect storm. The previously-registered sockets stay open.
    """
    max_total, _ = low_caps
    manager = ConnectionManager()

    # Fill to the cap — all three should succeed. Different users so the
    # per-user cap doesn't short-circuit before we reach the total cap.
    accepted: list[_FakeWebSocket] = []
    for i in range(max_total):
        ws: Any = _FakeWebSocket()
        ok = await manager.register(ws, user_id=f"user-{i}")
        assert ok is True
        assert ws.closed is False
        accepted.append(ws)

    # The next register — still a brand-new user — must be rejected.
    overflow: Any = _FakeWebSocket()
    ok = await manager.register(overflow, user_id="user-overflow")

    assert ok is False, "register() must return False when at total cap"
    assert overflow.closed is True, "rejected socket must be closed"
    assert overflow.close_code == 4008, (
        f"expected RFC 6455 policy-violation code 4008, got {overflow.close_code}"
    )
    assert "cap" in (overflow.close_reason or "").lower(), (
        "close reason must explain the rejection (contains 'cap')"
    )

    # The previously-registered sockets are untouched.
    assert manager.active_count == max_total
    for ws in accepted:
        assert ws.closed is False


@pytest.mark.asyncio
async def test_per_user_cap_rejects_with_4008(low_caps: tuple[int, int]) -> None:
    """A single user opening more than ``WS_MAX_PER_USER`` sockets must be
    rejected on the N+1th even when the global total cap is not hit.

    Protects against a hostile client that can authenticate (has a valid
    token) from hogging the entire budget. With max_per_user=2 we open
    two sockets for ``alice``, then try a third; the third is rejected.
    A fresh user ``bob`` can still connect — the cap is per-user, not
    a global kick.
    """
    _, max_per_user = low_caps
    manager = ConnectionManager()

    # Alice fills her per-user budget.
    alice_sockets: list[_FakeWebSocket] = []
    for _ in range(max_per_user):
        ws: Any = _FakeWebSocket()
        ok = await manager.register(ws, user_id="alice")
        assert ok is True
        alice_sockets.append(ws)

    # The third Alice socket must be rejected with 4008.
    alice_overflow: Any = _FakeWebSocket()
    ok = await manager.register(alice_overflow, user_id="alice")
    assert ok is False
    assert alice_overflow.closed is True
    assert alice_overflow.close_code == 4008

    # But Bob, a different user, can still connect (global cap not hit).
    bob: Any = _FakeWebSocket()
    ok = await manager.register(bob, user_id="bob")
    assert ok is True
    assert bob.closed is False

    # Sanity: Alice's previously-accepted sockets are still live.
    assert manager.active_count == max_per_user + 1  # alice*2 + bob
    for ws in alice_sockets:
        assert ws.closed is False
