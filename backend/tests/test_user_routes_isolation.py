"""Multi-tenant isolation tests for the GDPR user-rights routes.

Audit 2026-05-05 P0 finding (``backend/api/routes/user.py``):

* ``POST /api/v1/user/erase`` issued unfiltered ``delete(Trade|Position|
  Watchlist|ScreenerPreset|Alert|StrategySignal)`` — when ANY user called
  it, EVERY user's rows were wiped.
* ``_collect_export_bundle`` issued unfiltered ``select(...)`` against the
  same six tables — every user's rows landed in the requesting user's
  export bundle.

Both endpoints are gated by ``require_admin`` today, but ``POST
/admin/users`` mints non-admin tenants that legitimately need GDPR
self-service. This module pins the per-user filtering invariants:

1. ``user_b`` calling /erase MUST NOT delete ``user_a``'s Trade rows.
2. ``user_b`` calling /export MUST NOT see ``user_a``'s Trade rows in
   the returned bundle.
3. The five tables that carry NO ``username`` column today (Position,
   Watchlist, ScreenerPreset, Alert, StrategySignal) must NOT be wiped
   on a user-scoped erase — the previous unfiltered DELETE was the leak.
   They are also omitted from the per-user export bundle (empty lists)
   for the same reason.

The tests exercise the helpers directly with an in-memory session spy
rather than spinning up Postgres — JSONB / INET column types preclude
sqlite for the live ORM, and a real DB integration test would belong
in a separate harness. The spy is faithful enough to catch a regression:
it inspects the actual SQLAlchemy statements the helpers emit and
records which model classes appear in DELETE statements.
"""
from __future__ import annotations

import os

# Settle env BEFORE the first ``from core.config import settings`` lands
# (transitively pulled by api/routes/user.py via core/auth).
os.environ.setdefault("JWT_SECRET", "test-secret-for-isolation-" + "x" * 32)
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SKIP_DB_INIT", "false")  # we want the DB-touching path
os.environ.setdefault("ADMIN_USERNAME", "user_a")

from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlalchemy.sql import Delete, Select


# ---------------------------------------------------------------------------
# In-memory store + session spy
# ---------------------------------------------------------------------------


class _FakeRow:
    """Minimal stand-in for a SQLAlchemy ORM row.

    Carries the table reference (for ``_row_to_dict`` column iteration)
    and the column values as attributes. We only populate the columns
    the production helper actually reads.
    """

    def __init__(self, table: Any, **values: Any) -> None:
        self.__table__ = table
        for k, v in values.items():
            setattr(self, k, v)


class _Result:
    """Mimic ``CursorResult`` / ``ScalarResult`` for the spy."""

    def __init__(self, rows: list[Any] | None = None, rowcount: int = 0) -> None:
        self._rows = rows or []
        self.rowcount = rowcount

    def scalars(self) -> _Result:
        return self

    def all(self) -> list[Any]:
        return list(self._rows)


class _SpySession:
    """Async-context-manager session spy.

    Records every statement passed to ``execute()`` so the test can
    assert WHICH model classes were targeted by DELETE statements (the
    P0 leak was an unfiltered DELETE against five extra tables).

    Performs in-memory filtering for SELECT and DELETE so the export
    helper returns realistic, isolated row lists.
    """

    def __init__(self, store: dict[str, list[_FakeRow]]) -> None:
        self.store = store
        self.executed: list[Any] = []
        self.deleted_models: list[str] = []
        self.committed = False

    async def __aenter__(self) -> _SpySession:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def execute(self, stmt: Any) -> _Result:
        self.executed.append(stmt)

        # Statement type dispatch ------------------------------------------------
        if isinstance(stmt, Select):
            target = stmt.get_final_froms()[0]
            tname = target.name
            rows = self._select_with_where(stmt, tname)
            return _Result(rows=rows)

        if isinstance(stmt, Delete):
            tname = stmt.table.name
            self.deleted_models.append(tname)
            kept, removed = self._delete_with_where(stmt, tname)
            self.store[tname] = kept
            return _Result(rowcount=len(removed))

        # Update — used for the AuditLog retention flag flip. Treat as a
        # no-op: we don't emit AuditLog rows in this test, so there's
        # nothing to flip.
        return _Result()

    async def commit(self) -> None:
        self.committed = True

    # -- helpers -----------------------------------------------------------------

    def _select_with_where(self, stmt: Select, tname: str) -> list[_FakeRow]:
        """Filter the in-memory rows by the statement's WHERE clause.

        We support the two clause shapes the helpers emit today:
          - ``Trade.username == :username``
          - ``AuditLog.username == :username | retained_for_compliance.is_(True)``

        For anything more complex we fall back to "no rows" rather than
        risk a false positive.
        """
        rows = self.store.get(tname, [])
        where = stmt.whereclause
        if where is None:
            return list(rows)
        # Compile to a string so we can extract literal binds without
        # needing a dialect-bound execute.
        try:
            compiled = where.compile(compile_kwargs={"literal_binds": True})
            text = str(compiled)
        except Exception:
            text = ""

        out: list[_FakeRow] = []
        for r in rows:
            uname = getattr(r, "username", None)
            if "username" in text and uname is not None:
                # Match by literal username token in the compiled WHERE.
                if f"'{uname}'" in text:
                    out.append(r)
                    continue
            # AuditLog OR-branch: include rows flagged for compliance.
            if "retained_for_compliance" in text and getattr(
                r, "retained_for_compliance", False
            ):
                out.append(r)
        return out

    def _delete_with_where(
        self, stmt: Delete, tname: str
    ) -> tuple[list[_FakeRow], list[_FakeRow]]:
        """Apply the WHERE clause to the in-memory rows for a DELETE."""
        rows = self.store.get(tname, [])
        where = stmt.whereclause
        if where is None:
            # Unfiltered DELETE — the exact leak this test exists to catch.
            # Return ([], rows) so a regression visibly drops every row.
            return [], list(rows)
        try:
            compiled = where.compile(compile_kwargs={"literal_binds": True})
            text = str(compiled)
        except Exception:
            text = ""

        kept: list[_FakeRow] = []
        removed: list[_FakeRow] = []
        for r in rows:
            uname = getattr(r, "username", None)
            if "username" in text and uname is not None and f"'{uname}'" in text:
                removed.append(r)
            else:
                kept.append(r)
        return kept, removed


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def trade_table() -> Any:
    """Resolve the live ``Trade`` ORM class so spy rows carry the right table."""
    from data.storage.models import Trade

    return Trade


@pytest.fixture
def store_with_two_users(trade_table: Any) -> dict[str, list[_FakeRow]]:
    """Seed the spy store with one trade owned by user_a and one by user_b.

    The five no-per-user-key tables (Position/Watchlist/ScreenerPreset/
    Alert/StrategySignal) are pre-seeded with one row each so that the
    test can detect a regression: pre-fix, the unfiltered SELECT/DELETE
    would touch every row in those tables; post-fix the helper must NOT
    enumerate them at all.
    """
    from data.storage.models import (
        Alert,
        Position,
        ScreenerPreset,
        StrategySignal,
        Watchlist,
    )

    def _empty_row(table: Any) -> _FakeRow:
        # Populate every column with a benign default so ``_row_to_dict``
        # (which iterates ``row.__table__.columns``) doesn't trip on
        # a missing attribute. The values are irrelevant — the test
        # asserts these rows are NEVER touched by the helpers.
        kwargs = {col.name: None for col in table.__table__.columns}
        return _FakeRow(table.__table__, **kwargs)

    return {
        trade_table.__tablename__: [
            _FakeRow(
                trade_table.__table__,
                id=1,
                username="user_a",
                symbol="AAPL",
                strategy="manual",
                legs=[],
                entry_time=None,
                exit_time=None,
                entry_price=100.0,
                exit_price=None,
                pnl=None,
                status="open",
                notes="",
                side="long",
                broker_order_id=None,
                client_order_id=None,
                filled_at=None,
                filled_avg_price=None,
                account_env="paper",
                execution_venue=None,
                nbbo_bid_at_fill=None,
                nbbo_ask_at_fill=None,
                price_improvement_cents=None,
                version=0,
                trade_kind="long_open",
                filled_qty=None,
            ),
            _FakeRow(
                trade_table.__table__,
                id=2,
                username="user_b",
                symbol="TSLA",
                strategy="manual",
                legs=[],
                entry_time=None,
                exit_time=None,
                entry_price=200.0,
                exit_price=None,
                pnl=None,
                status="open",
                notes="",
                side="long",
                broker_order_id=None,
                client_order_id=None,
                filled_at=None,
                filled_avg_price=None,
                account_env="paper",
                execution_venue=None,
                nbbo_bid_at_fill=None,
                nbbo_ask_at_fill=None,
                price_improvement_cents=None,
                version=0,
                trade_kind="long_open",
                filled_qty=None,
            ),
        ],
        # The five no-key tables. Pre-fill so the test would FAIL loudly
        # if a regression re-introduces an unfiltered SELECT/DELETE: a
        # missing WHERE clause would empty these lists or leak the rows
        # into the export bundle, and we assert later that neither happens.
        Position.__tablename__: [_empty_row(Position)],
        Watchlist.__tablename__: [_empty_row(Watchlist)],
        ScreenerPreset.__tablename__: [_empty_row(ScreenerPreset)],
        Alert.__tablename__: [_empty_row(Alert)],
        StrategySignal.__tablename__: [_empty_row(StrategySignal)],
        "audit_log": [],
    }


@pytest.fixture
def patch_session(
    monkeypatch: pytest.MonkeyPatch, store_with_two_users: dict[str, list[_FakeRow]]
) -> _SpySession:
    """Replace ``_get_session_factory`` with a factory that yields the spy."""
    from core import database

    spy = _SpySession(store_with_two_users)

    def _factory() -> Any:
        # Factory must itself be callable and return an async context
        # manager — production code does ``async with factory() as s:``.
        return lambda: spy

    monkeypatch.setattr(database, "_get_session_factory", _factory)

    # Force the helper into the live (non-degraded) DB path.
    from core.config import settings

    monkeypatch.setattr(settings, "SKIP_DB_INIT", False)
    return spy


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_export_bundle_excludes_other_users_trades(
    patch_session: _SpySession,
) -> None:
    """``_collect_export_bundle('user_b')`` must not include user_a's trades."""
    from api.routes.user import _collect_export_bundle

    bundle = await _collect_export_bundle("user_b")

    # Trades returned should belong only to user_b.
    trades = bundle["trades"]
    assert len(trades) == 1, f"user_b's bundle leaked other users: {trades!r}"
    assert trades[0]["username"] == "user_b"
    assert trades[0]["symbol"] == "TSLA"

    # The five no-per-user-column tables must be returned EMPTY in the
    # post-fix bundle (cannot safely scope, so omit). The keys must
    # still exist so downstream consumers don't KeyError.
    for key in (
        "positions",
        "watchlists",
        "screener_presets",
        "alerts",
        "strategy_signals",
    ):
        assert bundle[key] == [], (
            f"bundle[{key!r}] must be empty (no per-user column on this "
            f"table); got {bundle[key]!r} — possible cross-tenant leak."
        )


@pytest.mark.asyncio
async def test_erase_does_not_wipe_other_users_trades(
    patch_session: _SpySession, store_with_two_users: dict[str, list[_FakeRow]]
) -> None:
    """``erase_user_data`` for user_b must leave user_a's trades intact."""
    from api.routes.user import EraseRequest, erase_user_data
    from core.config import settings

    # Configure the password-reauth so user_b can satisfy the body check.
    # ``_verify_password_reauth`` only succeeds when the caller IS the
    # configured admin; we relax that for this test by aliasing user_b
    # to admin for the duration of the call. The auth dependency itself
    # is bypassed because we call the route function directly.
    from core.auth import hash_password

    monkey_admin = "user_b"
    monkey_hash = hash_password("p@ssword-12345")
    settings.ADMIN_USERNAME = monkey_admin
    settings.ADMIN_PASSWORD_HASH = monkey_hash

    body = EraseRequest(confirm=True, password="p@ssword-12345")

    # Build a minimal Request stand-in that satisfies _audit's reads.
    req = MagicMock()
    req.headers = {}
    req.client = None
    req.state = MagicMock()
    req.state.request_id = "test-req-1"

    # Call the route handler directly. Skip the redis / session-kill
    # steps by stubbing get_redis to None — the helpers swallow that.
    from core import redis as redis_mod

    async def _no_redis() -> Any:
        raise RuntimeError("test: redis unavailable")

    # _delete_username_keyed_redis_keys catches errors internally.
    # _verify_password_reauth doesn't touch redis.
    setattr(redis_mod, "get_redis", _no_redis)

    response = await erase_user_data(body=body, req=req, username="user_b")

    # The DELETE statements must have hit ONLY the trades table — never
    # positions / watchlists / screener_presets / alerts / strategy_signals.
    # AuditLog DELETE is allowed (it carries a username column).
    forbidden = {
        "positions",
        "watchlists",
        "screener_presets",
        "alerts",
        "strategy_signals",
    }
    leaked = forbidden.intersection(patch_session.deleted_models)
    assert not leaked, (
        f"erase issued unfiltered DELETE against {leaked!r} — every other "
        f"user's data in those tables would have been wiped."
    )

    # user_a's Trade row must survive in the spy store.
    surviving_trades = store_with_two_users["trades"]
    assert any(
        getattr(r, "username", None) == "user_a" for r in surviving_trades
    ), (
        "user_a's Trade row was wiped by user_b's /erase call — the "
        "WHERE username = caller filter is missing or wrong."
    )
    # user_b's row should be the one that disappeared.
    assert not any(
        getattr(r, "username", None) == "user_b" for r in surviving_trades
    ), "user_b's own Trade row was NOT deleted by their own /erase call."

    # The five no-key tables retained their pre-seeded rows (NOT wiped).
    for key in (
        "positions",
        "watchlists",
        "screener_presets",
        "alerts",
        "strategy_signals",
    ):
        assert store_with_two_users[key], (
            f"{key!r} was wiped by /erase — the unfiltered DELETE leak "
            f"has regressed."
        )

    # Response body should report the per-table counts the helper computed.
    body_payload = getattr(response, "body", None)
    assert body_payload is not None
