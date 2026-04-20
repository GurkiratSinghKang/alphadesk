"""Unit tests for the Alpaca ``trade_updates`` DB consumer (Wave B).

The reconciler in ``data.ingestion.fill_reconciler`` subscribes to Redis
channel ``trade_updates`` and applies every fill / partial_fill /
canceled / rejected / expired event onto the authoritative Trade row.
Previously the channel had no DB consumer at all, so a fill message
fanned out to WebSocket clients but the Trade row stayed at
``status="submitted"`` forever (persona-72 P0).

These tests exercise the pure-Python apply path (``_apply_event``)
against a hand-rolled session + query stub so we don't need a live
Postgres and don't need SQLAlchemy's real ORM entity machinery — the
only contract we care about is ``_apply_event`` mutating the Trade row
it gets from ``db.execute(...).scalar_one_or_none()``.

The payload shapes used below match the exact wire format
``data.ingestion.alpaca_stream`` publishes onto Redis channel
``trade_updates``.
"""
from __future__ import annotations

import asyncio
import sys
import types
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest

# Ensure ``backend/`` is importable (matches the rest of the backend test suite).
BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


# ---------------------------------------------------------------------------
# Fixture — replaces the reconciler's DB layer with an in-memory stub.
#
# ``_apply_event`` performs:
#     select(Trade).where(...)
#     await db.execute(q)
#     result.scalar_one_or_none()
#
# We patch ``sqlalchemy.select``, ``sqlalchemy.or_``, the session
# factory, and the lazy ``data.storage.models.Trade`` so the test
# doesn't need a live SQLAlchemy registry.
# ---------------------------------------------------------------------------


def _make_trade_row(
    *,
    client_order_id: str = "manual_alice_abcdef123456",
    status: str = "submitted",
) -> types.SimpleNamespace:
    return types.SimpleNamespace(
        id=42,
        symbol="AAPL",
        status=status,
        entry_price=None,
        broker_order_id=None,
        client_order_id=client_order_id,
        filled_at=None,
        filled_avg_price=None,
        account_env="paper",
        legs=[{"client_order_id": client_order_id, "symbol": "AAPL", "qty": 10}],
    )


@pytest.fixture
def db_patches(monkeypatch: pytest.MonkeyPatch):
    """Stub the reconciler's DB + SQLAlchemy imports.

    Returns a ``probes`` dict the test can mutate:
      * ``probes["trade_row"]`` = the row that ``db.execute().scalar_one_or_none()``
        will return (set to ``None`` for the unmatched-event test).
      * ``probes["commits"]`` = count of ``await db.commit()`` calls.
    """
    probes: dict = {"trade_row": None, "commits": 0, "rollbacks": 0}

    class _FakeResult:
        def __init__(self, row):
            self._row = row

        def scalar_one_or_none(self):
            return self._row

        def scalars(self):
            class _S:
                def __init__(self, values):
                    self._values = values

                def all(self):
                    return self._values

            return _S([self._row] if self._row is not None else [])

    class _FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def execute(self, *_args, **_kwargs):
            return _FakeResult(probes["trade_row"])

        async def commit(self):
            probes["commits"] += 1

        async def rollback(self):
            probes["rollbacks"] += 1

    def _factory():
        return _FakeSession()

    # Wire the stub onto core.database._get_session_factory. The
    # reconciler does ``from core.database import _get_session_factory``
    # lazily inside _apply_event, so patching the module-level attribute
    # is what gets picked up.
    import core.database as _db_mod
    monkeypatch.setattr(_db_mod, "_get_session_factory", lambda: _factory)

    import core.config as _cfg_mod
    monkeypatch.setattr(_cfg_mod.settings, "SKIP_DB_INIT", False)

    # Force account_env resolution to a deterministic value so the
    # assertion doesn't depend on ALPACA_BASE_URL.
    monkeypatch.setattr(_cfg_mod.settings, "ALPACA_BASE_URL",
                        "https://paper-api.alpaca.markets")

    # Stub the lazy Trade import. The reconciler only uses the class as
    # a target for ``select(Trade).where(Trade.client_order_id == ...)``
    # + ``Trade.entry_time >= cutoff`` + ``Trade.status.in_(...)``. Since
    # we also stub ``select`` + ``or_`` to no-ops, the only contract we
    # need to honour is that every comparison returns something truthy
    # and doesn't raise. _AnyCol does exactly that.
    class _AnyCol:
        def __eq__(self, _other): return True
        def __ne__(self, _other): return True
        def __ge__(self, _other): return True
        def __gt__(self, _other): return True
        def __le__(self, _other): return True
        def __lt__(self, _other): return True
        def in_(self, _iterable): return True
        def desc(self): return self

    class _TradeStub:
        client_order_id = _AnyCol()
        broker_order_id = _AnyCol()
        entry_time = _AnyCol()
        status = _AnyCol()
        legs = _AnyCol()

    import data.storage.models as _models_mod
    _models_mod._models_cache["Trade"] = _TradeStub  # type: ignore[assignment]

    # Replace the SQLAlchemy ``select`` + ``or_`` imports the reconciler
    # resolves at runtime. Both are imported inside _apply_event with
    # ``from sqlalchemy import select, or_`` — we shadow the module
    # attributes so the imports resolve to our stubs.
    import sqlalchemy as _sa_mod

    def _fake_select(*_args, **_kwargs):
        return _FakeQuery()

    def _fake_or(*_args, **_kwargs):
        return True

    class _FakeQuery:
        def where(self, *_a, **_k):
            return self

        def order_by(self, *_a, **_k):
            return self

        def limit(self, *_a, **_k):
            return self

    monkeypatch.setattr(_sa_mod, "select", _fake_select, raising=False)
    monkeypatch.setattr(_sa_mod, "or_", _fake_or, raising=False)

    return probes


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fill_event_transitions_trade_to_filled(db_patches) -> None:
    """A ``fill`` event updates status='filled' + stamps the fill columns."""
    from data.ingestion import fill_reconciler as fr

    trade_row = _make_trade_row(status="submitted")
    db_patches["trade_row"] = trade_row

    # Payload shape identical to what ``alpaca_stream._run_trade_updates_stream``
    # publishes onto Redis channel ``trade_updates``.
    event = {
        "event": "fill",
        "symbol": "AAPL",
        "side": "buy",
        "qty": 10,
        "filled_qty": 10,
        "fill_price": 182.3425,
        "order_id": "alp_abc_123",
        "status": "filled",
        "timestamp": "2026-04-19T13:30:00.125Z",
        "raw": {
            "event": "fill",
            "order": {
                "id": "alp_abc_123",
                "client_order_id": trade_row.client_order_id,
                "symbol": "AAPL",
                "filled_avg_price": "182.3425",
                "filled_at": "2026-04-19T13:30:00.125Z",
            },
        },
    }

    await fr._apply_event(event)

    assert trade_row.status == "filled"
    assert trade_row.broker_order_id == "alp_abc_123"
    # Decimal comparison — scale-preserving equality.
    assert trade_row.filled_avg_price == Decimal("182.3425")
    assert isinstance(trade_row.filled_at, datetime)
    assert trade_row.filled_at.tzinfo is not None
    assert trade_row.filled_at.astimezone(timezone.utc) == datetime(
        2026, 4, 19, 13, 30, 0, 125000, tzinfo=timezone.utc
    )
    # entry_price back-fill for legacy P&L code.
    assert trade_row.entry_price == pytest.approx(182.3425)
    # account_env should be a valid enum value; we forced the paper URL.
    assert trade_row.account_env == "paper"
    assert db_patches["commits"] == 1, "expected exactly one commit"


@pytest.mark.asyncio
async def test_partial_fill_event_transitions_to_partial(db_patches) -> None:
    """A ``partial_fill`` event sets status='partial' (not 'filled')."""
    from data.ingestion import fill_reconciler as fr

    trade_row = _make_trade_row(status="submitted")
    db_patches["trade_row"] = trade_row

    event = {
        "event": "partial_fill",
        "order_id": "alp_xyz",
        "fill_price": 50.0,
        "timestamp": "2026-04-19T13:31:00Z",
        "raw": {
            "order": {
                "id": "alp_xyz",
                "client_order_id": trade_row.client_order_id,
                "filled_avg_price": "50.0",
            },
        },
    }
    await fr._apply_event(event)

    assert trade_row.status == "partial"
    assert trade_row.filled_avg_price == Decimal("50.0")
    assert db_patches["commits"] == 1


@pytest.mark.asyncio
async def test_rejected_event_sets_status(db_patches) -> None:
    from data.ingestion import fill_reconciler as fr

    trade_row = _make_trade_row(status="submitted")
    db_patches["trade_row"] = trade_row

    await fr._apply_event({
        "event": "rejected",
        "order_id": "alp_rej",
        "raw": {"order": {"id": "alp_rej", "client_order_id": trade_row.client_order_id}},
    })
    assert trade_row.status == "rejected"
    assert db_patches["commits"] == 1


@pytest.mark.asyncio
async def test_canceled_and_expired_events_persist(db_patches) -> None:
    from data.ingestion import fill_reconciler as fr

    for event_name, expected_status in (("canceled", "canceled"), ("expired", "expired")):
        trade_row = _make_trade_row(status="submitted")
        db_patches["trade_row"] = trade_row
        db_patches["commits"] = 0
        await fr._apply_event({
            "event": event_name,
            "order_id": f"alp_{event_name}",
            "raw": {"order": {
                "id": f"alp_{event_name}",
                "client_order_id": trade_row.client_order_id,
            }},
        })
        assert trade_row.status == expected_status, (event_name, expected_status)
        assert db_patches["commits"] == 1, event_name


@pytest.mark.asyncio
async def test_unmatched_event_is_dropped_with_warning(
    db_patches,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """An event whose correlation id doesn't match any row logs WARN."""
    from data.ingestion import fill_reconciler as fr

    # No row returned from the session.
    db_patches["trade_row"] = None

    caplog.set_level("WARNING", logger="data.ingestion.fill_reconciler")
    await fr._apply_event({
        "event": "fill",
        "order_id": "alp_nonexistent",
        "raw": {"order": {
            "id": "alp_nonexistent",
            "client_order_id": "stranger_order_id",
        }},
    })
    assert any("no ledger row" in r.getMessage() for r in caplog.records), caplog.records
    # Importantly: no commit happened — we didn't thrash any row.
    assert db_patches["commits"] == 0


@pytest.mark.asyncio
async def test_non_terminal_events_are_ignored(db_patches) -> None:
    """``new``, ``accepted``, ``pending_new`` etc. are intentionally dropped."""
    from data.ingestion import fill_reconciler as fr

    trade_row = _make_trade_row(status="submitted")
    db_patches["trade_row"] = trade_row

    for ignored_event in ("new", "accepted", "pending_new", "stopped", "replaced"):
        await fr._apply_event({
            "event": ignored_event,
            "order_id": "alp_x",
            "raw": {"order": {"id": "alp_x", "client_order_id": trade_row.client_order_id}},
        })
    # Status must NOT have been thrashed by the ignored events.
    assert trade_row.status == "submitted"
    assert db_patches["commits"] == 0


@pytest.mark.asyncio
async def test_start_stop_lifecycle(monkeypatch: pytest.MonkeyPatch) -> None:
    """``start`` is idempotent; ``stop`` cancels the task cleanly."""
    from data.ingestion import fill_reconciler as fr

    # Replace the loop body with a fast-exit no-op so start/stop completes
    # without actually connecting to Redis.
    called = {"n": 0}

    async def _fake_loop():
        called["n"] += 1
        try:
            # Sleep long enough that stop() gets a chance to cancel us.
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            raise

    monkeypatch.setattr(fr, "_reconciler_loop", _fake_loop)
    # Reset module state between tests.
    fr._reconciler_task = None
    fr._should_stop = False

    await fr.start_fill_reconciler()
    # Yield control so the newly-created task actually starts executing
    # before we assert on the call counter. ``create_task`` schedules
    # the coroutine but doesn't run it until the event loop gets a tick.
    await asyncio.sleep(0)
    assert fr._reconciler_task is not None
    assert not fr._reconciler_task.done()
    assert called["n"] == 1, "first start should have launched the loop"

    # Second call is idempotent — no new task spawned.
    await fr.start_fill_reconciler()
    await asyncio.sleep(0)
    assert called["n"] == 1, "start should be idempotent — no second task"

    await fr.stop_fill_reconciler()
    assert fr._reconciler_task is None

    # Stop is also idempotent — calling it a second time must not raise.
    await fr.stop_fill_reconciler()
