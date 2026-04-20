"""Migration up/down semantics for 0009_trade_kind_backfill_correct.

The migration runs a SINGLE UPDATE to flip ``trade_kind`` from
``*_open`` to ``*_close`` on rows where ``exit_time IS NOT NULL``.  We
verify the behaviour against an in-memory sqlite DB — the SQL uses
only standard SQL (``CASE`` expression + ``WHERE ... IN (...)``) so
sqlite and Postgres agree on the result.

Test matrix:

* ``side='long'``  + ``exit_time IS NOT NULL`` + ``trade_kind='long_open'``  → flipped to ``long_close``.
* ``side='short'`` + ``exit_time IS NOT NULL`` + ``trade_kind='short_open'`` → flipped to ``short_close``.
* ``side='long'``  + ``exit_time IS NULL``      + ``trade_kind='long_open'``  → NOT flipped (still open).
* ``exit_time IS NOT NULL`` + ``trade_kind='long_close'`` (already correct) → NOT re-flipped.
* ``exit_time IS NOT NULL`` + ``trade_kind IS NULL`` → NOT touched (still NULL).

Downgrade reverses the upgrade on the same row set.
"""
from __future__ import annotations

import importlib.util
import sqlite3
import sys
import types
from pathlib import Path
from typing import Any

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _load_migration() -> Any:
    """Load the 0009 migration by path — the filename starts with a digit
    so it can't be imported via the normal ``import`` syntax.  Uses
    ``importlib.util.spec_from_file_location`` which is also the technique
    Alembic itself uses at runtime.
    """
    migration_path = (
        BACKEND_ROOT
        / "alembic"
        / "versions"
        / "0009_trade_kind_backfill_correct.py"
    )
    spec = importlib.util.spec_from_file_location(
        "migration_0009", str(migration_path),
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Fixture — boot an in-memory sqlite DB with a trades-shaped table, then
# install a fake ``alembic.op`` whose ``execute()`` routes to the
# connection.  That lets the real migration module run unmodified.
# ---------------------------------------------------------------------------


@pytest.fixture
def sqlite_trades_db(monkeypatch: pytest.MonkeyPatch) -> sqlite3.Connection:
    """Return a sqlite connection with a seeded trades table."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE trades (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol      TEXT NOT NULL,
            side        TEXT,
            exit_time   TEXT,
            trade_kind  TEXT
        )
        """
    )

    # Seeded rows — one per scenario in the module docstring.
    rows = [
        # (symbol, side, exit_time, trade_kind)
        ("A", "long",  "2026-01-01T10:00", "long_open"),   # closed long  → expect long_close
        ("B", "short", "2026-01-01T10:00", "short_open"),  # closed short → expect short_close
        ("C", "long",  None,               "long_open"),   # still open   → stays long_open
        ("D", "short", None,               "short_open"),  # still open   → stays short_open
        ("E", "long",  "2026-01-01T10:00", "long_close"),  # already correct → stays long_close
        ("F", "short", "2026-01-01T10:00", None),          # NULL trade_kind → stays NULL
        ("G", "long",  "2026-01-01T10:00", "long_open"),   # another closed long (group-agg)
    ]
    cur.executemany(
        "INSERT INTO trades (symbol, side, exit_time, trade_kind) VALUES (?, ?, ?, ?)",
        rows,
    )
    conn.commit()

    # Install a fake ``alembic.op`` so ``op.execute(sql)`` runs against
    # our connection.  The 0009 migration only calls ``op.execute`` so
    # this is sufficient.
    fake_op = types.SimpleNamespace()

    def _execute(sql: Any) -> None:
        # Alembic supports passing a raw string OR a SQLAlchemy
        # text()/update() object.  0009 only passes strings, but we
        # stringify defensively to keep the stub broad.
        stmt = sql if isinstance(sql, str) else str(sql)
        conn.executescript(stmt)
        conn.commit()

    fake_op.execute = _execute

    fake_alembic = types.ModuleType("alembic")
    fake_alembic.op = fake_op  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "alembic", fake_alembic)

    return conn


def _trade_kinds_by_symbol(conn: sqlite3.Connection) -> dict[str, Any]:
    """Return a ``{symbol: trade_kind}`` map sorted by symbol."""
    cur = conn.cursor()
    rows = cur.execute("SELECT symbol, trade_kind FROM trades ORDER BY symbol").fetchall()
    return {r["symbol"]: r["trade_kind"] for r in rows}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_upgrade_flips_closed_rows_only(
    sqlite_trades_db: sqlite3.Connection,
) -> None:
    """upgrade() flips *_open → *_close ONLY for rows with exit_time IS NOT NULL."""
    # Import the migration module AFTER the op stub is installed.
    migration = _load_migration()

    migration.upgrade()

    result = _trade_kinds_by_symbol(sqlite_trades_db)
    assert result == {
        "A": "long_close",   # closed long, flipped.
        "B": "short_close",  # closed short, flipped.
        "C": "long_open",    # still-open long, untouched.
        "D": "short_open",   # still-open short, untouched.
        "E": "long_close",   # already correct, untouched.
        "F": None,           # NULL-kind closed, untouched.
        "G": "long_close",   # another closed long, flipped.
    }


def test_downgrade_restores_upgrade_flipped_rows(
    sqlite_trades_db: sqlite3.Connection,
) -> None:
    """upgrade() followed by downgrade() returns every row upgrade FLIPPED
    to its pre-upgrade state.

    A non-trivial corner: downgrade is lossy for rows that ALREADY held
    the ``*_close`` classification BEFORE 0009 ran (e.g. row E, whose
    0007 state was ``long_close``).  Those rows will be flipped to
    ``*_open`` by downgrade because the SQL can't distinguish
    "pre-existing correct close" from "flipped by 0009".  This is the
    stated semantics in the migration's docstring — rolling 0009 back
    lands on the 0007 baseline where closed rows are still classified
    as ``*_open``.

    So the invariant we actually want: downgrade() restores the original
    state for rows that upgrade() actually changed, and the remaining
    rows end up in the post-0007 baseline shape.
    """
    migration = _load_migration()

    # Snapshot the pre-upgrade state.
    original = _trade_kinds_by_symbol(sqlite_trades_db)

    migration.upgrade()
    after_upgrade = _trade_kinds_by_symbol(sqlite_trades_db)
    # Sanity check — upgrade actually changed something.
    assert after_upgrade != original

    # Rows that upgrade FLIPPED from *_open to *_close.
    flipped_by_upgrade = {
        sym for sym, kind in after_upgrade.items()
        if original.get(sym) != kind
    }
    # Row E is the known-lossy downgrade corner — exclude it from the
    # round-trip equality assertion below; it's covered by its own
    # assertion separately.
    assert "E" not in flipped_by_upgrade  # sanity: E was already *_close

    migration.downgrade()
    after_downgrade = _trade_kinds_by_symbol(sqlite_trades_db)

    # Every row that upgrade flipped is back to its original value.
    for sym in flipped_by_upgrade:
        assert after_downgrade[sym] == original[sym], (
            f"downgrade failed to revert row {sym}: "
            f"original={original[sym]} upgrade={after_upgrade[sym]} "
            f"downgrade={after_downgrade[sym]}"
        )

    # Row E (pre-existing long_close, closed exit_time) — downgrade IS
    # allowed to mutate to long_open because the SQL can't distinguish
    # it from an upgrade-flipped row.  This is the declared tradeoff.
    assert after_downgrade["E"] == "long_open"

    # Still-open rows (C, D) are never touched in either direction.
    assert after_downgrade["C"] == "long_open"
    assert after_downgrade["D"] == "short_open"

    # NULL-kind row (F) stays NULL.
    assert after_downgrade["F"] is None


def test_still_open_rows_never_touched(
    sqlite_trades_db: sqlite3.Connection,
) -> None:
    """Rows with exit_time IS NULL must never be flipped, in either direction."""
    migration = _load_migration()

    cur = sqlite_trades_db.cursor()
    before_open = cur.execute(
        "SELECT symbol, trade_kind FROM trades WHERE exit_time IS NULL ORDER BY symbol",
    ).fetchall()

    migration.upgrade()
    after_open = cur.execute(
        "SELECT symbol, trade_kind FROM trades WHERE exit_time IS NULL ORDER BY symbol",
    ).fetchall()
    assert [dict(r) for r in before_open] == [dict(r) for r in after_open]

    migration.downgrade()
    after_down = cur.execute(
        "SELECT symbol, trade_kind FROM trades WHERE exit_time IS NULL ORDER BY symbol",
    ).fetchall()
    assert [dict(r) for r in before_open] == [dict(r) for r in after_down]
