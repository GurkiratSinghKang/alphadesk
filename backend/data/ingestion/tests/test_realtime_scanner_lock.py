"""Tests for the asyncio-lock contract on ``realtime_scanner.register_setup``.

Audit 2026-05-05 (Bug C-2): ``register_setup`` was previously a sync ``def``
that never acquired ``_setups_lock``. The lock was only used inside
``_evaluate_tick``'s snapshot → process → rebuild cycle. A concurrent
``register_setup(symbol='AAPL', ...)`` could land its addition mid-rebuild
and have it silently overwritten when the rebuild atomically rebound
``_pending_setups``.

The fix converts ``register_setup`` to ``async def`` and wraps the
mutation in ``async with _setups_lock``. ``_evaluate_tick`` was also
hardened to merge any concurrently-registered setups for the same
symbol back in (id-based diff) so a brand-new addition during a tick
eval is preserved.

These tests verify the lock contract holds under concurrent execution.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

# Ensure ``backend/`` is importable.
BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture(autouse=True)
def _reset_scanner_state():
    """Wipe module-level scanner state between tests.

    Required because ``_pending_setups`` and ``_pairs_setups`` are
    module globals — without a reset, test order would leak state and
    produce flaky failures.
    """
    from data.ingestion import realtime_scanner as rs

    # Snapshot the prior state and replace with empty.
    prev_pending = rs._pending_setups
    prev_pairs = rs._pairs_setups
    rs._pending_setups = {}
    rs._pairs_setups = []
    try:
        yield
    finally:
        rs._pending_setups = prev_pending
        rs._pairs_setups = prev_pairs


def _setup_payload(symbol: str = "AAPL", trigger: float = 100.0) -> dict:
    """Minimal setup payload — symbol + trigger + ORB type."""
    return {
        "strategy": "orb",
        "symbol": symbol,
        "type": "orb_breakout",
        "trigger_price": trigger,
        "direction": "long",
        "stop_loss": trigger * 0.95,
        "take_profit": trigger * 1.05,
        "conviction": 70,
        "rationale": "test setup",
        "expires": "9999-12-31T23:59:59",
    }


# ---------------------------------------------------------------------------
# register_setup is async + acquires the lock.
# ---------------------------------------------------------------------------


def test_register_setup_is_async_def() -> None:
    """Audit C-2: register_setup must be a coroutine, not a sync function."""
    from data.ingestion import realtime_scanner as rs

    assert asyncio.iscoroutinefunction(rs.register_setup), (
        "register_setup must be async so it can acquire _setups_lock; "
        "if it's sync, the daily pipeline pushing a setup mid-tick can "
        "race the scanner's rebuild and lose the registration."
    )


@pytest.mark.asyncio
async def test_register_setup_basic_round_trip() -> None:
    """A registered setup is visible in _pending_setups under its symbol."""
    from data.ingestion import realtime_scanner as rs

    await rs.register_setup(_setup_payload(symbol="AAPL", trigger=150.0))
    assert "AAPL" in rs._pending_setups, "AAPL setup must be registered"
    assert len(rs._pending_setups["AAPL"]) == 1
    assert rs._pending_setups["AAPL"][0]["trigger_price"] == 150.0


# ---------------------------------------------------------------------------
# Concurrent register_setup vs _evaluate_tick — the audit's headline race.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_register_during_evaluate_tick_survives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A register_setup landing mid-tick must not be lost.

    Scenario: a TSLA setup whose trigger does NOT fire at $1.00 is in
    ``_pending_setups``. ``_evaluate_tick("TSLA", 1.00, ...)`` is invoked
    (snapshot → no triggers → write back). Concurrently, the daily
    pipeline calls ``register_setup`` to push a brand-new AAPL setup.

    Pre-fix: register_setup didn't take the lock, so its dict-rebind
    could be clobbered by _evaluate_tick's atomic rebind that captured
    a stale snapshot.

    Post-fix: both writers serialise on _setups_lock; AAPL must survive.
    """
    from data.ingestion import realtime_scanner as rs

    # Stub the ORM execution path so we don't try to place a real trade.
    # Use monkeypatch so the original is restored at teardown — otherwise
    # other tests in the suite that call _execute_triggered_setup directly
    # (e.g. test_scanner_live_gate.py) would observe a no-op stub.
    async def _no_execute(_setup):
        return None

    monkeypatch.setattr(rs, "_execute_triggered_setup", _no_execute)

    # Pre-load TSLA with a trigger of $1000 so a $1.00 tick won't fire it.
    await rs.register_setup(_setup_payload(symbol="TSLA", trigger=1000.0))
    assert "TSLA" in rs._pending_setups

    # Run both tasks concurrently. The order of execution is governed by
    # the asyncio event loop; both must complete and the AAPL addition
    # must be visible in _pending_setups afterward.
    eval_task = asyncio.create_task(
        rs._evaluate_tick("TSLA", 1.00, 1000, 1.00, 1.01)
    )
    register_task = asyncio.create_task(
        rs.register_setup(_setup_payload(symbol="AAPL", trigger=180.0))
    )

    await asyncio.gather(eval_task, register_task)

    # Assertions — both setups must be present.
    assert "AAPL" in rs._pending_setups, (
        "register_setup landed during _evaluate_tick was lost — "
        "the asyncio lock contract on register_setup is broken."
    )
    assert "TSLA" in rs._pending_setups, (
        "TSLA setup that didn't trigger should still be in _pending_setups"
    )
    assert rs._pending_setups["AAPL"][0]["trigger_price"] == 180.0


@pytest.mark.asyncio
async def test_register_during_eval_same_symbol_survives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The hardest case: register_setup adds another AAPL setup while
    _evaluate_tick is processing AAPL's existing setups.

    The post-snapshot id-diff merge in _evaluate_tick must preserve the
    new setup even though the symbol is identical to the one being
    evaluated.
    """
    from data.ingestion import realtime_scanner as rs

    async def _no_execute(_setup):
        return None

    monkeypatch.setattr(rs, "_execute_triggered_setup", _no_execute)

    # Pre-load AAPL with a trigger that won't fire at $50 tick.
    await rs.register_setup(_setup_payload(symbol="AAPL", trigger=999.0))

    # Run both concurrently — same symbol.
    eval_task = asyncio.create_task(
        rs._evaluate_tick("AAPL", 50.00, 1000, 50.00, 50.01)
    )
    register_task = asyncio.create_task(
        rs.register_setup(_setup_payload(symbol="AAPL", trigger=180.0))
    )

    await asyncio.gather(eval_task, register_task)

    # Both AAPL setups must be present. (The original 999-trigger setup
    # didn't fire at $50, so it survives in `remaining`. The new
    # 180-trigger setup was registered concurrently, so it must be
    # merged in via the id-diff.)
    assert "AAPL" in rs._pending_setups
    triggers = sorted(s["trigger_price"] for s in rs._pending_setups["AAPL"])
    assert triggers == [180.0, 999.0], (
        f"both AAPL setups must survive concurrent register; got triggers={triggers}"
    )


@pytest.mark.asyncio
async def test_high_concurrency_register_storm_no_loss() -> None:
    """Register 50 setups in parallel — every one must land.

    A simpler invariant test: the lock must serialise the dict-rebind
    so we don't get "last write wins" behaviour where most of the
    parallel registrations are lost.
    """
    from data.ingestion import realtime_scanner as rs

    payloads = [
        _setup_payload(symbol=f"SYM{i:02d}", trigger=100.0 + i)
        for i in range(50)
    ]
    await asyncio.gather(*(rs.register_setup(p) for p in payloads))

    for i in range(50):
        sym = f"SYM{i:02d}"
        assert sym in rs._pending_setups, (
            f"{sym} was lost in the concurrent register storm — "
            f"got {len(rs._pending_setups)} of 50 expected"
        )

    assert len(rs._pending_setups) == 50, (
        f"expected 50 distinct symbols, got {len(rs._pending_setups)}"
    )
