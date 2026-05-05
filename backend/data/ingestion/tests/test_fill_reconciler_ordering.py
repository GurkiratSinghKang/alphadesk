"""Tests for the monotonic ``filled_qty`` guard in ``fill_reconciler._apply_event``.

Audit 2026-05-05 (Bug C-1): Alpaca's ``trade_updates`` WebSocket can deliver
``partial_fill`` events out of order — most commonly during a network blip
when the broker buffers and replays. The reconciler previously did
``trade.filled_qty = event.filled_qty`` unconditionally, so a fill of 5
followed by a delayed partial_fill of 3 would land filled_qty=3 (backward).

The guard added in commit 9e188f1a only ADVANCES the column: a backward
event is logged at WARNING and dropped. These tests assert the guard
holds against forward, reverse, and duplicate replay sequences.

Mirrors the testing pattern used by the existing
``backend/data/ingestion/tests/test_fill_reconciler.py`` — patches the
DB session + SQLAlchemy stubs so we don't need a live Postgres.
"""
from __future__ import annotations

import sys
import types
from decimal import Decimal
from pathlib import Path

import pytest

# Ensure ``backend/`` is importable (matches the rest of the backend test suite).
BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _make_trade_row(
    *,
    client_order_id: str = "manual_alice_abcdef123456",
    status: str = "submitted",
    filled_qty: Decimal | None = None,
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
        execution_venue=None,
        nbbo_bid_at_fill=None,
        nbbo_ask_at_fill=None,
        price_improvement_cents=None,
        version=0,
        # The contract under test: filled_qty must only advance.
        filled_qty=filled_qty,
        trade_kind=None,
        legs=[{"client_order_id": client_order_id, "symbol": "AAPL", "qty": 5}],
    )


@pytest.fixture
def db_patches(monkeypatch: pytest.MonkeyPatch):
    """Stub the reconciler's DB + SQLAlchemy imports.

    Returns a ``probes`` dict the test mutates with the row to return
    from the session's SELECT.
    """
    probes: dict = {"trade_row": None, "commits": 0}

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
            pass

    def _factory():
        return _FakeSession()

    import core.database as _db_mod
    monkeypatch.setattr(_db_mod, "_get_session_factory", lambda: _factory)

    import core.config as _cfg_mod
    monkeypatch.setattr(_cfg_mod.settings, "SKIP_DB_INIT", False)
    monkeypatch.setattr(_cfg_mod.settings, "ALPACA_BASE_URL",
                        "https://paper-api.alpaca.markets")

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
    missing = object()
    previous_trade_model = _models_mod._models_cache.get("Trade", missing)
    _models_mod._models_cache["Trade"] = _TradeStub  # type: ignore[assignment]

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

    try:
        yield probes
    finally:
        if previous_trade_model is missing:
            _models_mod._models_cache.pop("Trade", None)
        else:
            _models_mod._models_cache["Trade"] = previous_trade_model


def _partial_fill_event(client_order_id: str, filled_qty: float) -> dict:
    """Build a ``partial_fill`` payload matching Alpaca's wire format."""
    return {
        "event": "partial_fill",
        "symbol": "AAPL",
        "side": "buy",
        "qty": 5,
        "filled_qty": filled_qty,
        "fill_price": 100.0,
        "order_id": "alp_ordering_test",
        "status": "partial_filled",
        "timestamp": "2026-05-05T13:30:00.125Z",
        "raw": {
            "event": "partial_fill",
            "order": {
                "id": "alp_ordering_test",
                "client_order_id": client_order_id,
                "symbol": "AAPL",
                "filled_qty": str(filled_qty),
                "filled_avg_price": "100.0",
                "filled_at": "2026-05-05T13:30:00.125Z",
            },
        },
    }


# ---------------------------------------------------------------------------
# The three required ordering scenarios.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_in_order_partial_fills_advance_to_highest(db_patches) -> None:
    """[1, 3, 5] in order → final filled_qty=5."""
    from data.ingestion import fill_reconciler as fr

    trade_row = _make_trade_row(filled_qty=Decimal("0"))
    db_patches["trade_row"] = trade_row

    coid = trade_row.client_order_id
    for q in (1, 3, 5):
        await fr._apply_event(_partial_fill_event(coid, q))

    assert trade_row.filled_qty == Decimal("5"), (
        f"in-order [1,3,5] should land at 5, got {trade_row.filled_qty}"
    )


@pytest.mark.asyncio
async def test_reverse_order_partial_fills_keep_highest(
    db_patches,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """[5, 3, 1] in reverse → final filled_qty=5 (highest seen wins).

    The two backward events (3 after 5, 1 after 5) must be logged at
    WARNING and silently dropped — never overwrite the column.
    """
    from data.ingestion import fill_reconciler as fr

    trade_row = _make_trade_row(filled_qty=Decimal("0"))
    db_patches["trade_row"] = trade_row

    caplog.set_level("WARNING", logger="data.ingestion.fill_reconciler")
    coid = trade_row.client_order_id
    for q in (5, 3, 1):
        await fr._apply_event(_partial_fill_event(coid, q))

    assert trade_row.filled_qty == Decimal("5"), (
        f"reverse [5,3,1] should land at 5, got {trade_row.filled_qty}"
    )
    backward_warnings = [
        r for r in caplog.records
        if "filled_qty backward event ignored" in r.getMessage()
    ]
    assert len(backward_warnings) == 2, (
        f"expected 2 backward-event warnings, got {len(backward_warnings)}"
    )


@pytest.mark.asyncio
async def test_duplicate_partial_fill_does_not_thrash_qty(db_patches) -> None:
    """[3, 3] → filled_qty=3 after first; second is a no-op (equal, not less).

    Duplicate replay is common during broker WS reconnect — the buffered
    events are pushed again. The guard treats equal as a no-op (no
    advance, no warning) so duplicate-vs-out-of-order is distinguishable
    in the logs.
    """
    from data.ingestion import fill_reconciler as fr

    trade_row = _make_trade_row(filled_qty=Decimal("0"))
    db_patches["trade_row"] = trade_row

    coid = trade_row.client_order_id
    await fr._apply_event(_partial_fill_event(coid, 3))
    assert trade_row.filled_qty == Decimal("3")

    # Replay — same qty. The column must not change (which is trivially
    # true since we'd write the same value, but more importantly the
    # equality branch shouldn't trip the WARNING log either).
    await fr._apply_event(_partial_fill_event(coid, 3))
    assert trade_row.filled_qty == Decimal("3"), (
        f"duplicate [3,3] should stay at 3, got {trade_row.filled_qty}"
    )


@pytest.mark.asyncio
async def test_partial_fill_then_terminal_fill_lands_total_qty(db_patches) -> None:
    """A ``fill`` event after a ``partial_fill`` must advance to the total.

    The terminal ``fill`` event's filled_qty equals the order's full size
    (5 in our fixture). The partial filled_qty=3 stamped first must NOT
    block the advance.
    """
    from data.ingestion import fill_reconciler as fr

    trade_row = _make_trade_row(filled_qty=Decimal("0"))
    db_patches["trade_row"] = trade_row

    coid = trade_row.client_order_id
    await fr._apply_event(_partial_fill_event(coid, 3))
    assert trade_row.filled_qty == Decimal("3")

    # Terminal fill — same payload shape, ``event="fill"`` instead.
    fill_event = _partial_fill_event(coid, 5)
    fill_event["event"] = "fill"
    fill_event["raw"]["event"] = "fill"
    await fr._apply_event(fill_event)

    assert trade_row.filled_qty == Decimal("5"), (
        f"partial->fill should advance to 5, got {trade_row.filled_qty}"
    )
    assert trade_row.status == "filled"
