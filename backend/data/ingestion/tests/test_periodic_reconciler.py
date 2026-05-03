"""Unit tests for the Wave 6β periodic broker-vs-ledger reconciler.

Exercises the per-cycle path (``_run_one_cycle``) directly so we don't
have to wait on the 3-hour sleep loop.  The Redis lock machinery is
stubbed via fakeredis so the multi-worker "second worker sees lock
held" case can be tested deterministically.

Scope:

* Single-worker cycle acquires the lock, runs the reconcile, releases
  the lock, and also invokes the pending_flatten_drain helper.
* A second worker that races for the lock gets ``None`` from
  ``_acquire_lock`` and skips the reconcile (but still runs the drain).
* A reconcile exception is caught and logged — the loop must survive.
* The pending_flatten_drain helper is always called regardless of whether
  the reconcile lock was held (by a different worker).
"""
from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any

import pytest

# Ensure ``backend/`` is importable (matches the rest of the backend test suite).
BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Install a fakeredis instance in place of the real Redis client."""
    import fakeredis.aioredis
    import core.redis as redis_mod

    instance = fakeredis.aioredis.FakeRedis(decode_responses=True)

    async def _fake_get_redis() -> Any:
        return instance

    monkeypatch.setattr(redis_mod, "get_redis", _fake_get_redis)
    return instance


@pytest.fixture
def stub_reconcile(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Stub ``_reconcile_last_24h`` + ``check_and_drain_pending_flatten``.

    Returns a probes dict so assertions can confirm each helper was (or
    wasn't) called with the expected shape.
    """
    probes: dict[str, Any] = {
        "reconcile_calls": [],
        "drain_calls": 0,
        "reconcile_should_raise": False,
        "drain_should_raise": False,
    }

    async def _fake_reconcile(since: Any = None) -> dict[str, int]:
        probes["reconcile_calls"].append({"since": since})
        if probes["reconcile_should_raise"]:
            raise RuntimeError("simulated broker outage")
        return {"backfilled": 1, "orphaned": 0, "matched": 5}

    async def _fake_drain() -> dict | None:
        probes["drain_calls"] += 1
        if probes["drain_should_raise"]:
            raise RuntimeError("simulated drain failure")
        return None

    # Swap the route-level reconciler helper AND the drain helper to
    # no-op stubs.  The production code imports these lazily inside
    # ``_run_one_cycle`` to avoid the circular ``trades -> master_agent
    # -> daily_pipeline`` import loop, so we plant the stubs directly on
    # the target modules.
    _trades_mod = types.ModuleType("api.routes.trades")
    _trades_mod._reconcile_last_24h = _fake_reconcile  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "api.routes.trades", _trades_mod)

    _drain_mod = types.ModuleType("data.ingestion.pending_flatten_drain")
    _drain_mod.check_and_drain_pending_flatten = _fake_drain  # type: ignore[attr-defined]
    monkeypatch.setitem(
        sys.modules, "data.ingestion.pending_flatten_drain", _drain_mod,
    )

    return probes


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_single_worker_runs_reconcile_and_drain(
    fake_redis: Any, stub_reconcile: dict,
) -> None:
    """A single worker with no lock contention reconciles + drains."""
    from data.ingestion import periodic_reconciler as pr

    counts = await pr._run_one_cycle()

    assert counts == {"backfilled": 1, "orphaned": 0, "matched": 5}
    assert len(stub_reconcile["reconcile_calls"]) == 1
    # The ``since`` arg should be roughly "now - 3h" (we don't freeze
    # time but just confirm it's not None).
    assert stub_reconcile["reconcile_calls"][0]["since"] is not None
    assert stub_reconcile["drain_calls"] == 1


@pytest.mark.asyncio
async def test_second_worker_skips_reconcile_but_still_drains(
    fake_redis: Any, stub_reconcile: dict,
) -> None:
    """Another worker holding the lock prevents double-reconcile.

    The drain helper carries its OWN lock (see pending_flatten_drain),
    so it's safe to call on every worker at every tick.  The contract
    here is: even if we can't run the reconcile, we MUST still call the
    drain so a queued flatten isn't stuck waiting for the specific
    worker that holds the reconcile lock.
    """
    from data.ingestion import periodic_reconciler as pr

    # Pre-plant the lock under a different token so our tick sees it as held.
    await fake_redis.set(pr._LOCK_KEY, "other-worker-token", ex=pr._LOCK_TTL_SECONDS)

    counts = await pr._run_one_cycle()

    # Reconcile was skipped (empty defaults).
    assert counts == {"backfilled": 0, "orphaned": 0, "matched": 0}
    assert stub_reconcile["reconcile_calls"] == []
    # Drain STILL ran — critical invariant.
    assert stub_reconcile["drain_calls"] == 1


@pytest.mark.asyncio
async def test_reconcile_exception_is_swallowed_lock_released(
    fake_redis: Any, stub_reconcile: dict,
) -> None:
    """A reconcile exception must NOT kill the loop and MUST release the lock."""
    from data.ingestion import periodic_reconciler as pr

    stub_reconcile["reconcile_should_raise"] = True

    # Should NOT raise despite the simulated reconcile failure.
    counts = await pr._run_one_cycle()

    # Default-zero counts because reconcile blew up before returning.
    assert counts == {"backfilled": 0, "orphaned": 0, "matched": 0}
    assert len(stub_reconcile["reconcile_calls"]) == 1
    # Drain still runs regardless.
    assert stub_reconcile["drain_calls"] == 1
    # Lock was released so the NEXT tick can re-acquire it.
    remaining = await fake_redis.get(pr._LOCK_KEY)
    assert remaining is None


@pytest.mark.asyncio
async def test_drain_exception_does_not_kill_tick(
    fake_redis: Any, stub_reconcile: dict,
) -> None:
    """A drain exception must not prevent the reconcile counts from being returned."""
    from data.ingestion import periodic_reconciler as pr

    stub_reconcile["drain_should_raise"] = True

    # Should NOT raise despite drain failure.
    counts = await pr._run_one_cycle()

    # Reconcile still ran and returned its counts.
    assert counts == {"backfilled": 1, "orphaned": 0, "matched": 5}
    assert len(stub_reconcile["reconcile_calls"]) == 1
    assert stub_reconcile["drain_calls"] == 1


@pytest.mark.asyncio
async def test_start_stop_idempotent() -> None:
    """``start_periodic_reconciler`` must be idempotent (double-start safe)."""
    from data.ingestion import periodic_reconciler as pr

    await pr.start_periodic_reconciler()
    first_task = pr._task
    assert first_task is not None

    # Second start must NOT spawn a second task.
    await pr.start_periodic_reconciler()
    assert pr._task is first_task

    await pr.stop_periodic_reconciler()
    assert pr._task is None

    # Stop-while-idle is a no-op.
    await pr.stop_periodic_reconciler()
    assert pr._task is None
