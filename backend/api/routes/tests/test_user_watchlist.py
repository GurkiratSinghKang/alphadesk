"""Tests for the per-user watchlist endpoints (iter 17).

Coverage:

1. ``GET  /api/v1/user/watchlist``                      — empty for new user
2. ``POST /api/v1/user/watchlist/{symbol}``             — adds + returns full list
3. POST same symbol twice                                — idempotent (no 500)
4. POST invalid symbol                                   — 422
5. ``DELETE /api/v1/user/watchlist/{symbol}``            — removes + returns full list
6. DELETE absent symbol                                  — idempotent (200 not 404)
7. GET sorted alphabetically                             — stable wire order
8. Cross-user isolation                                  — alice's rows invisible to bob

Uses the same in-memory session-spy pattern as
``backend/tests/test_user_routes_isolation.py`` so the test stays light
and doesn't require Postgres. The spy is faithful enough to detect the
shapes of the SELECT/INSERT/DELETE statements the handlers emit, which
is the contract these tests need to lock in.
"""
from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlalchemy.sql import Delete, Select


# Root conftest seeds JWT_SECRET / DATABASE_URL / SKIP_DB_INIT but the
# spy fixture flips SKIP_DB_INIT off below so the live-DB code path is
# exercised.
os.environ.setdefault("ADMIN_USERNAME", "alice")


# ---------------------------------------------------------------------------
# In-memory store + session spy (mirrors test_user_routes_isolation patterns)
# ---------------------------------------------------------------------------


class _FakeRow:
    """ORM-like row used by the in-memory store.

    Production code path inserts ``UserWatchlist(username=..., symbol=...)``
    directly via ``session.add(row)`` and reads via
    ``select(UserWatchlist.symbol).where(...)``. We mimic the attribute
    surface so both shapes work.
    """

    def __init__(self, table: Any, **values: Any) -> None:
        self.__table__ = table
        for col in table.columns:
            setattr(self, col.name, None)
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
    """Async-context-manager session spy with username-aware filtering.

    Tracks adds for INSERT-via-ORM (``session.add(...)``); applies
    in-memory filtering for SELECT and DELETE statements; and raises
    ``IntegrityError`` on duplicate (username, symbol) inserts so the
    handler's idempotent-POST path is exercised.
    """

    def __init__(self, store: dict[str, list[_FakeRow]]) -> None:
        self.store = store
        self.executed: list[Any] = []
        self.committed = False
        # ``_pending_inserts`` collects ORM-add rows until commit, mirroring
        # SQLAlchemy unit-of-work semantics in just enough fidelity.
        self._pending_inserts: list[Any] = []

    async def __aenter__(self) -> _SpySession:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    def add(self, instance: Any) -> None:
        self._pending_inserts.append(instance)

    async def execute(self, stmt: Any) -> _Result:
        self.executed.append(stmt)

        if isinstance(stmt, Select):
            # Resolve target table/column from the projection.
            target = stmt.get_final_froms()[0]
            tname = target.name
            return _Result(rows=self._select_rows(stmt, tname))

        if isinstance(stmt, Delete):
            tname = stmt.table.name
            kept, removed = self._delete_rows(stmt, tname)
            self.store[tname] = kept
            return _Result(rowcount=len(removed))

        return _Result()

    async def commit(self) -> None:
        # Flush pending ORM inserts. Enforce the (username, symbol)
        # UNIQUE constraint so the duplicate-POST path raises the same
        # IntegrityError SQLAlchemy would raise on Postgres.
        from sqlalchemy.exc import IntegrityError

        for row in self._pending_inserts:
            tname = row.__tablename__
            existing = self.store.setdefault(tname, [])
            uname = getattr(row, "username", None)
            sym = getattr(row, "symbol", None)
            if any(
                getattr(r, "username", None) == uname
                and getattr(r, "symbol", None) == sym
                for r in existing
            ):
                self._pending_inserts = []
                raise IntegrityError("duplicate", None, Exception("uq violation"))
            # Wrap in _FakeRow so attribute reads use __table__ defaults.
            existing.append(row)
        self._pending_inserts = []
        self.committed = True

    async def rollback(self) -> None:
        self._pending_inserts = []

    # -- helpers ------------------------------------------------------------

    def _select_rows(self, stmt: Select, tname: str) -> list[Any]:
        """Filter rows by literal-bound WHERE.

        Supports ``UserWatchlist.username == :username``. The spy returns
        the ``symbol`` column for each match so the handler's
        ``.scalars().all()`` resolves to a list of strings, just like
        the real Postgres path.
        """
        rows = self.store.get(tname, [])
        where = stmt.whereclause
        if where is None:
            return [getattr(r, "symbol", None) for r in rows]
        try:
            text = str(where.compile(compile_kwargs={"literal_binds": True}))
        except Exception:
            text = ""
        out = []
        for r in rows:
            uname = getattr(r, "username", None)
            if uname is not None and f"'{uname}'" in text:
                out.append(getattr(r, "symbol", None))
        return out

    def _delete_rows(
        self, stmt: Delete, tname: str
    ) -> tuple[list[Any], list[Any]]:
        rows = self.store.get(tname, [])
        where = stmt.whereclause
        if where is None:
            return [], list(rows)
        try:
            text = str(where.compile(compile_kwargs={"literal_binds": True}))
        except Exception:
            text = ""
        kept: list[Any] = []
        removed: list[Any] = []
        for r in rows:
            uname = getattr(r, "username", None)
            sym = getattr(r, "symbol", None)
            uname_match = uname is not None and f"'{uname}'" in text
            sym_match = sym is not None and f"'{sym}'" in text
            if uname_match and sym_match:
                removed.append(r)
            else:
                kept.append(r)
        return kept, removed


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def watchlist_store() -> dict[str, list[_FakeRow]]:
    """Empty in-memory store for the user_watchlist table."""
    return {"user_watchlist": []}


@pytest.fixture
def patch_session(
    monkeypatch: pytest.MonkeyPatch,
    watchlist_store: dict[str, list[_FakeRow]],
) -> _SpySession:
    """Replace ``_get_session_factory`` with a factory yielding the spy."""
    from core import database

    spy = _SpySession(watchlist_store)

    def _factory() -> Any:
        return lambda: spy

    monkeypatch.setattr(database, "_get_session_factory", _factory)

    # Force the route into the live (non-degraded) DB code path so the
    # session spy is actually exercised.
    from core.config import settings

    monkeypatch.setattr(settings, "SKIP_DB_INIT", False)
    return spy


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_returns_empty_list_for_new_user(patch_session: _SpySession) -> None:
    from api.routes.user import get_user_watchlist

    response = await get_user_watchlist(username="alice")

    assert response["symbols"] == []
    assert isinstance(response["as_of"], str)
    # Loose ISO-shape check; full datetime parsing is overkill here.
    assert "T" in response["as_of"]


@pytest.mark.asyncio
async def test_post_adds_symbol_and_returns_list(
    patch_session: _SpySession,
) -> None:
    from api.routes.user import add_user_watchlist

    response = await add_user_watchlist(symbol="NVDA", username="alice")

    assert response["symbols"] == ["NVDA"]
    # Subsequent GET must reflect the new state.
    rows = patch_session.store["user_watchlist"]
    assert len(rows) == 1
    assert getattr(rows[0], "username") == "alice"
    assert getattr(rows[0], "symbol") == "NVDA"


@pytest.mark.asyncio
async def test_post_duplicate_symbol_is_idempotent(
    patch_session: _SpySession,
) -> None:
    """Re-adding an existing symbol must NOT 5xx and must NOT double-insert."""
    from api.routes.user import add_user_watchlist

    first = await add_user_watchlist(symbol="NVDA", username="alice")
    second = await add_user_watchlist(symbol="NVDA", username="alice")

    assert first["symbols"] == ["NVDA"]
    assert second["symbols"] == ["NVDA"]
    # Only one row in the store after two POSTs.
    assert len(patch_session.store["user_watchlist"]) == 1


@pytest.mark.asyncio
async def test_post_invalid_symbol_returns_422(patch_session: _SpySession) -> None:
    """Symbol regex ``^[A-Z0-9.\\-]{1,12}$`` must reject bad input."""
    from fastapi import HTTPException

    from api.routes.user import add_user_watchlist

    # Empty string fails (length 0); spaces are stripped before validation.
    with pytest.raises(HTTPException) as exc_info:
        await add_user_watchlist(symbol="", username="alice")
    assert exc_info.value.status_code == 422

    # Disallowed characters.
    with pytest.raises(HTTPException) as exc_info:
        await add_user_watchlist(symbol="NV;DA", username="alice")
    assert exc_info.value.status_code == 422

    # Too long (> 12 chars).
    with pytest.raises(HTTPException) as exc_info:
        await add_user_watchlist(symbol="A" * 13, username="alice")
    assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_delete_existing_symbol_returns_remaining_list(
    patch_session: _SpySession,
) -> None:
    from api.routes.user import add_user_watchlist, remove_user_watchlist

    await add_user_watchlist(symbol="NVDA", username="alice")
    await add_user_watchlist(symbol="AAPL", username="alice")

    response = await remove_user_watchlist(symbol="NVDA", username="alice")
    # Sorted output guaranteed by the handler.
    assert response["symbols"] == ["AAPL"]


@pytest.mark.asyncio
async def test_delete_absent_symbol_is_idempotent_returns_200(
    patch_session: _SpySession,
) -> None:
    """Deleting a symbol the user never added returns 200 + current list."""
    from api.routes.user import add_user_watchlist, remove_user_watchlist

    await add_user_watchlist(symbol="AAPL", username="alice")

    response = await remove_user_watchlist(symbol="NVDA", username="alice")
    # No exception; the existing rows survive untouched.
    assert response["symbols"] == ["AAPL"]


@pytest.mark.asyncio
async def test_get_returns_symbols_alphabetically_sorted(
    patch_session: _SpySession,
) -> None:
    """Insertion order is ZBRA, AAPL, MSFT — read order must be alphabetical."""
    from api.routes.user import add_user_watchlist, get_user_watchlist

    await add_user_watchlist(symbol="ZBRA", username="alice")
    await add_user_watchlist(symbol="AAPL", username="alice")
    await add_user_watchlist(symbol="MSFT", username="alice")

    response = await get_user_watchlist(username="alice")
    assert response["symbols"] == ["AAPL", "MSFT", "ZBRA"]


@pytest.mark.asyncio
async def test_cross_user_isolation(patch_session: _SpySession) -> None:
    """Alice's watchlist must not appear in Bob's GET."""
    from api.routes.user import add_user_watchlist, get_user_watchlist

    await add_user_watchlist(symbol="NVDA", username="alice")
    await add_user_watchlist(symbol="AAPL", username="alice")
    await add_user_watchlist(symbol="TSLA", username="bob")

    alice_response = await get_user_watchlist(username="alice")
    bob_response = await get_user_watchlist(username="bob")

    assert alice_response["symbols"] == ["AAPL", "NVDA"]
    assert bob_response["symbols"] == ["TSLA"]
    # A duplicate symbol across users is allowed: (username, symbol) is
    # the unique key, not (symbol).
    await add_user_watchlist(symbol="NVDA", username="bob")
    bob_after = await get_user_watchlist(username="bob")
    assert bob_after["symbols"] == ["NVDA", "TSLA"]
    # Alice's list unchanged.
    alice_after = await get_user_watchlist(username="alice")
    assert alice_after["symbols"] == ["AAPL", "NVDA"]


@pytest.mark.asyncio
async def test_post_normalizes_lowercase_to_upper(
    patch_session: _SpySession,
) -> None:
    """Lowercase input is normalized to upper before persisting + validating."""
    from api.routes.user import add_user_watchlist

    response = await add_user_watchlist(symbol="nvda", username="alice")
    assert response["symbols"] == ["NVDA"]
    # Underlying row carries the canonical upper-case form.
    assert getattr(patch_session.store["user_watchlist"][0], "symbol") == "NVDA"


@pytest.mark.asyncio
async def test_skip_db_init_returns_safe_defaults(monkeypatch) -> None:
    """Degraded-mode parity: every DB-backed route returns sensible defaults."""
    from core.config import settings

    monkeypatch.setattr(settings, "SKIP_DB_INIT", True)

    from api.routes.user import (
        add_user_watchlist,
        get_user_watchlist,
        remove_user_watchlist,
    )

    get_resp = await get_user_watchlist(username="alice")
    assert get_resp["symbols"] == []

    add_resp = await add_user_watchlist(symbol="NVDA", username="alice")
    # In degraded mode, the handler returns the symbol the client passed
    # without DB persistence so the wire shape stays consistent.
    assert add_resp["symbols"] == ["NVDA"]

    del_resp = await remove_user_watchlist(symbol="NVDA", username="alice")
    assert del_resp["symbols"] == []
