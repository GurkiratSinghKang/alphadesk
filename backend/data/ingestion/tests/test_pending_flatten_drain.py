"""Unit tests for Wave 6β Fix 2 — pending_flatten drain on market open.

The drain helper reads ``halt_state.pending_flatten`` from Postgres,
checks the market-open flag, takes a Redis lock, and fires
``_flatten_all_positions`` if (and only if) pending_flatten is True
AND the market is currently open.

These tests stub the halt_state read + market-open helper + the
flatten helper so we don't need a live broker or DB.  fakeredis gives
us an exact replica of the SET NX EX lock contract.

Scope:

* pending_flatten=False → no-op, flatten never fires.
* pending_flatten=True + market CLOSED → no-op, flatten never fires.
* pending_flatten=True + market OPEN → flatten fires, audit written,
  flag cleared.
* Another worker holds the drain lock → skip (don't double-fire).
* flatten_all_positions raises → flag stays set (next-tick retry),
  lock is released.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> Any:
    import fakeredis.aioredis
    import core.redis as redis_mod

    instance = fakeredis.aioredis.FakeRedis(decode_responses=True)

    async def _fake_get_redis() -> Any:
        return instance

    monkeypatch.setattr(redis_mod, "get_redis", _fake_get_redis)
    return instance


@pytest.fixture
def stub_env(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Stub the DB helpers + market-open helper + flatten helper."""
    state: dict[str, Any] = {
        "pending_flatten": False,
        "market_open": True,
        "flatten_should_raise": False,
        "flatten_calls": 0,
        "clear_calls": 0,
        "audit_calls": [],
    }

    # Stub halt_state read + clear by patching the module-level
    # functions inside pending_flatten_drain itself.  That module
    # imports the DB helpers lazily inside the functions so we can't
    # intercept them at module load; patching the wrappers directly is
    # the cleanest option.
    from data.ingestion import pending_flatten_drain as pfd

    async def _fake_read_pending() -> bool:
        return bool(state["pending_flatten"])

    async def _fake_clear_pending() -> None:
        state["clear_calls"] += 1
        state["pending_flatten"] = False

    monkeypatch.setattr(pfd, "_read_pending_flatten", _fake_read_pending)
    monkeypatch.setattr(pfd, "_clear_pending_flatten", _fake_clear_pending)

    # Stub the market-open helper + the flatten helper by replacing the
    # lazy import target module inside sys.modules.
    _trades_mod = types.ModuleType("api.routes.trades")

    async def _fake_is_market_open() -> bool:
        return bool(state["market_open"])

    async def _fake_flatten_all() -> dict[str, Any]:
        state["flatten_calls"] += 1
        if state["flatten_should_raise"]:
            raise RuntimeError("simulated flatten failure")
        return {
            "cancelled_orders": True,
            "flatten_attempts": 2,
            "flatten_successes": 2,
            "flatten_failures": 0,
            "residual_positions": [],
            "details": [],
        }

    _trades_mod._is_market_open_now = _fake_is_market_open  # type: ignore[attr-defined]
    _trades_mod._flatten_all_positions = _fake_flatten_all  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "api.routes.trades", _trades_mod)

    # Stub core.audit.write_audit so the test doesn't need a real DB.
    _audit_mod = types.ModuleType("core.audit")

    async def _fake_write_audit(event: str, **kwargs: Any) -> None:
        state["audit_calls"].append({"event": event, **kwargs})

    _audit_mod.write_audit = _fake_write_audit  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "core.audit", _audit_mod)

    return state


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_op_when_pending_flatten_false(
    fake_redis: Any, stub_env: dict,
) -> None:
    """pending_flatten=False → immediate no-op, nothing fires."""
    from data.ingestion.pending_flatten_drain import check_and_drain_pending_flatten

    stub_env["pending_flatten"] = False
    result = await check_and_drain_pending_flatten()

    assert result is None
    assert stub_env["flatten_calls"] == 0
    assert stub_env["clear_calls"] == 0
    assert stub_env["audit_calls"] == []


@pytest.mark.asyncio
async def test_no_op_when_market_closed(
    fake_redis: Any, stub_env: dict,
) -> None:
    """pending_flatten=True but market closed → wait for next tick."""
    from data.ingestion.pending_flatten_drain import check_and_drain_pending_flatten

    stub_env["pending_flatten"] = True
    stub_env["market_open"] = False
    result = await check_and_drain_pending_flatten()

    assert result is None
    assert stub_env["flatten_calls"] == 0
    # Flag must remain set so the next tick (when market opens) can
    # drain it.
    assert stub_env["pending_flatten"] is True
    assert stub_env["clear_calls"] == 0


@pytest.mark.asyncio
async def test_drain_fires_at_market_open(
    fake_redis: Any, stub_env: dict,
) -> None:
    """pending_flatten=True + market open → flatten + audit + flag cleared."""
    from data.ingestion.pending_flatten_drain import check_and_drain_pending_flatten

    stub_env["pending_flatten"] = True
    stub_env["market_open"] = True
    result = await check_and_drain_pending_flatten()

    assert result is not None
    assert result["flatten_attempts"] == 2
    assert stub_env["flatten_calls"] == 1
    assert stub_env["clear_calls"] == 1
    # Flag must be cleared — otherwise we'd drain twice on the next tick.
    assert stub_env["pending_flatten"] is False
    # Audit trail written.
    assert len(stub_env["audit_calls"]) == 1
    assert stub_env["audit_calls"][0]["event"] == "pending_flatten_drained"


@pytest.mark.asyncio
async def test_another_worker_holds_lock_skip(
    fake_redis: Any, stub_env: dict,
) -> None:
    """If another worker holds the drain lock, we skip without firing flatten."""
    from data.ingestion import pending_flatten_drain as pfd

    stub_env["pending_flatten"] = True
    stub_env["market_open"] = True

    # Pre-plant the lock so the drain's SET NX returns False.
    await fake_redis.set(
        pfd._DRAIN_LOCK_KEY, "other-worker", ex=pfd._DRAIN_LOCK_TTL_SECONDS,
    )

    result = await pfd.check_and_drain_pending_flatten()

    assert result is None
    assert stub_env["flatten_calls"] == 0
    assert stub_env["clear_calls"] == 0
    # Flag must remain set so the worker that DOES own the lock can drain.
    assert stub_env["pending_flatten"] is True


@pytest.mark.asyncio
async def test_flatten_exception_leaves_flag_set_releases_lock(
    fake_redis: Any, stub_env: dict,
) -> None:
    """flatten raising → flag stays set for retry, lock released."""
    from data.ingestion import pending_flatten_drain as pfd

    stub_env["pending_flatten"] = True
    stub_env["market_open"] = True
    stub_env["flatten_should_raise"] = True

    result = await pfd.check_and_drain_pending_flatten()

    assert result is None
    assert stub_env["flatten_calls"] == 1
    # CRITICAL: flag still set so the next tick retries.
    assert stub_env["pending_flatten"] is True
    # Clear was NOT called (since flatten raised before we got there).
    assert stub_env["clear_calls"] == 0
    # Lock must be released so the NEXT tick can try again.
    remaining = await fake_redis.get(pfd._DRAIN_LOCK_KEY)
    assert remaining is None
