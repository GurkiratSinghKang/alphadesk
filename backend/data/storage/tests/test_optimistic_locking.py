"""Optimistic-locking test for the Trade model (Wave 2G / persona-79 Race 2).

The fill_reconciler and ``reconcile_on_boot`` can both race to update the
same Trade row when boot fires while the live pub/sub channel is already
draining queued events. Without optimistic locking the second writer
silently overwrites the first — the timestamps and fill price columns
flap, and the audit trail loses fidelity.

Adding ``__mapper_args__ = {"version_id_col": Trade.version}`` to the
ORM model causes SQLAlchemy to:

  * Auto-bump ``version`` on every UPDATE.
  * Append ``WHERE version = :old_version`` to the UPDATE.
  * Raise ``StaleDataError`` when 0 rows are matched (i.e. someone else
    won the race and bumped the version first).

This test exercises that contract end-to-end against an in-memory
SQLite database so we don't need Postgres in CI. We use the synchronous
SQLAlchemy engine (``sqlite:///:memory:``) because the contract under
test — the ORM's version-id-col machinery — is dialect-agnostic and
synchronous-engine code keeps the test free of an extra ``aiosqlite``
dependency. Production runs on async Postgres but the mapper config is
the same.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make ``backend/`` importable, mirroring the rest of the suite.
BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def test_concurrent_trade_update_raises_stale_data_error() -> None:
    """Two concurrent updates to the same Trade row → second raises StaleDataError.

    Driver:
      1. Insert a Trade row.
      2. Open two independent sessions and read the same row in each
         (so each session has version=N in its identity map).
      3. Commit the first session's update — version goes 0 -> 1.
      4. Commit the second session's update — SQLAlchemy emits
         ``UPDATE ... WHERE id=? AND version=0``, finds 0 rows, raises
         ``StaleDataError``.

    The Postgres production engine behaves identically; SQLite is fine
    here because the version-id column logic is engine-agnostic.
    """
    # ----- Lazy imports so the conftest env defaults apply first -----
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from sqlalchemy.orm.exc import StaleDataError

    # The fill_reconciler test fixture stubs ``_models_cache["Trade"]``
    # with a non-mapped ``_TradeStub`` namespace. If pytest happens to
    # collect that test before ours (sibling test directories sort
    # alphabetically — ingestion runs FIRST), the cache is poisoned
    # with the stub and ``_define_models`` short-circuits because the
    # cache is non-empty.
    #
    # Recovery strategy: detect the stub and find the real mapped Trade
    # via ``Base.registry.mappers``. The real class always has a
    # ``__table__`` attribute (set by SQLAlchemy when the class is
    # mapped); the stub does not. If the registry doesn't have it
    # either (no real ``_define_models`` call has happened yet this
    # process), we clear the cache + invoke ``_define_models`` so the
    # real classes get created cleanly.
    from core.database import get_base
    base = get_base()

    import data.storage.models as _models_mod

    def _resolve_real_trade():
        cached = _models_mod._models_cache.get("Trade")
        if cached is not None and hasattr(cached, "__table__"):
            return cached
        # Walk the mapper registry — survives any cache poisoning.
        for mapper in base.registry.mappers:
            cls = mapper.class_
            if getattr(cls, "__name__", "") == "Trade":
                # Restore the real class to the cache so future imports
                # in this process see it.
                _models_mod._models_cache["Trade"] = cls
                return cls
        return None

    Trade = _resolve_real_trade()
    if Trade is None:
        # First-time setup: cache is poisoned but no real mapping exists
        # yet. Wipe the cache and force a fresh ``_define_models`` pass.
        _models_mod._models_cache.clear()
        from data.storage.models import _define_models
        _define_models()
        Trade = _models_mod._models_cache["Trade"]
    assert hasattr(Trade, "__table__"), (
        f"Trade resolved to non-mapped class {type(Trade).__name__}; "
        f"mro={[c.__name__ for c in type(Trade).__mro__]}"
    )

    # The Trade table has a Postgres-specific JSONB column (``legs``).
    # SQLite has no JSONB type, so register a compiler hook that emits
    # plain JSON / TEXT for JSONB on the SQLite dialect during this
    # in-memory test only. Production runs against Postgres natively
    # and this hook never fires there.
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy.ext.compiler import compiles

    @compiles(JSONB, "sqlite")
    def _compile_jsonb_for_sqlite(type_, compiler, **kw):
        # SQLite stores JSON as TEXT — good enough for this test which
        # never reads or writes ``legs``.
        return "TEXT"

    engine = create_engine("sqlite:///:memory:")
    try:
        base.metadata.create_all(engine, tables=[Trade.__table__])

        # ----- 1. Seed a Trade row -----
        with Session(engine, expire_on_commit=False) as s:
            row = Trade(
                symbol="AAPL",
                strategy="test",
                status="submitted",
                client_order_id="manual_test_optimistic_lock",
                account_env="paper",
            )
            s.add(row)
            s.commit()
            row_id = row.id
            seed_version = row.version
        # SQLAlchemy's ``version_id_col`` may emit the initial value as
        # part of the INSERT; the exact starting value isn't part of the
        # contract — only that subsequent UPDATEs bump it monotonically.
        # We capture it here and assert the bump-by-1 behaviour below.
        assert isinstance(seed_version, int)

        # ----- 2. Open two sessions; both read the same row -----
        session_a = Session(engine, expire_on_commit=False)
        session_b = Session(engine, expire_on_commit=False)
        try:
            row_a = session_a.execute(
                select(Trade).where(Trade.id == row_id)
            ).scalar_one()
            row_b = session_b.execute(
                select(Trade).where(Trade.id == row_id)
            ).scalar_one()

            assert row_a.version == seed_version
            assert row_b.version == seed_version

            # ----- 3. First writer wins -----
            row_a.status = "filled"
            row_a.broker_order_id = "alp_winner"
            session_a.commit()
            assert row_a.version == seed_version + 1, (
                "first commit must bump version by 1"
            )

            # ----- 4. Second writer races and loses -----
            row_b.status = "rejected"
            row_b.broker_order_id = "alp_loser"
            with pytest.raises(StaleDataError):
                session_b.commit()
        finally:
            session_a.close()
            session_b.close()

        # ----- 5. Re-read: row reflects the winner only. -----
        with Session(engine, expire_on_commit=False) as s:
            final = s.execute(
                select(Trade).where(Trade.id == row_id)
            ).scalar_one()
            assert final.status == "filled"
            assert final.broker_order_id == "alp_winner"
            assert final.version == seed_version + 1
    finally:
        engine.dispose()
