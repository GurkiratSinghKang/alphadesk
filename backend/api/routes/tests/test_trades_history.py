"""Tests for /api/v1/trades/history (Wave 6α Fix 2, persona-124 P0).

The refactor replaces ``ledger._data.get("trades", [])`` + Python sort +
slice with a call to ``TradeLedger.list_paginated(limit=..., offset=...,
order_by="entry_time", descending=True, **filters)``.

Assertions:

1. The handler source contains the new ``list_paginated`` call and no
   longer references ``_data.get("trades")`` or a Python-side
   ``sorted(all_trades, ...)[offset:offset+limit]``.

2. ``TradeLedger.list_paginated`` exists on the class, validates its
   arguments against the column allowlist, and composes the SQL with
   LIMIT / OFFSET / ORDER BY pushed into the statement.

3. The route still filters by symbol + strategy — but via the
   ``filters`` kwarg rather than Python list comprehension.
"""

from __future__ import annotations

import inspect

import pytest

from api.routes import trades as trades_mod
from data.ingestion import trade_ledger as tl_mod
from data.ingestion.trade_ledger import TradeLedger


def _executable_code_only(src: str) -> str:
    """Return only executable statements of ``src`` — strip comments AND
    any leading docstring of functions/classes/modules.

    Uses the AST to locate docstrings (``ast.get_docstring`` returns the
    first expression-statement string), then removes those exact ranges
    while keeping every other string literal (especially SQL text
    embedded via ``text(\\\"\\\"\\\"...\\\"\\\"\\\")``).
    """
    import ast
    import io
    import tokenize

    # 1. Identify docstring line-ranges from the AST.
    docstring_ranges: set[tuple[int, int]] = set()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        tree = None

    def _collect(node: ast.AST) -> None:
        if not isinstance(node, (ast.Module, ast.FunctionDef,
                                 ast.AsyncFunctionDef, ast.ClassDef)):
            return
        body = getattr(node, "body", None) or []
        if not body:
            return
        first = body[0]
        if (isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)):
            # This string is the docstring.
            docstring_ranges.add(
                (first.lineno, getattr(first, "end_lineno", first.lineno))
            )

    if tree is not None:
        for node in ast.walk(tree):
            _collect(node)

    # 2. Re-emit tokens, skipping comments and any STRING token whose
    #    start-line falls in a docstring range.
    out: list[str] = []
    last_col = 0
    last_lineno = -1
    buf = io.StringIO(src)
    for tok in tokenize.generate_tokens(buf.readline):
        tok_type, tok_str, (sline, scol), (_eline, ecol), _line = tok
        if sline > last_lineno:
            last_col = 0
        if scol > last_col:
            out.append(" " * (scol - last_col))
        if tok_type == tokenize.COMMENT:
            pass
        elif (tok_type == tokenize.STRING
              and any(
                  lo <= sline <= hi for lo, hi in docstring_ranges
              )):
            pass  # a docstring — drop it
        else:
            out.append(tok_str)
        last_col = ecol
        last_lineno = _eline
    return "".join(out)


# Back-compat alias — older tests call the previous name.
_strip_comments_and_docstrings = _executable_code_only


# --------------------------------------------------------------------------- #
# Route source regression tests                                               #
# --------------------------------------------------------------------------- #


class TestRouteUsesPaginatedSql:
    """Guard against a regression back to the full-scan path."""

    def _handler_source(self) -> str:
        # ``get_trade_history`` is the FastAPI handler on the /history route.
        # Strip comments + docstrings so we assert against executable code.
        return _strip_comments_and_docstrings(
            inspect.getsource(trades_mod.get_trade_history)
        )

    def test_calls_list_paginated(self) -> None:
        src = self._handler_source()
        assert "list_paginated(" in src, (
            "/trades/history must call TradeLedger.list_paginated — the "
            "Wave 6α fix pushed LIMIT/OFFSET/ORDER BY into SQL."
        )

    def test_no_python_side_full_scan(self) -> None:
        src = self._handler_source()
        assert "_data.get(\"trades\"" not in src, (
            "Wave 6α regression: /trades/history re-introduced the "
            "full-ledger Python scan via ledger._data."
        )
        assert "_data.get('trades'" not in src
        # And no Python-side sort + slice either.
        assert "sorted(all_trades" not in src

    def test_passes_limit_and_offset(self) -> None:
        src = self._handler_source()
        # Both must appear as kwargs to list_paginated, not be applied
        # after-the-fact to a Python list.
        assert "limit=limit" in src
        assert "offset=offset" in src

    def test_descending_order(self) -> None:
        src = self._handler_source()
        assert "descending=True" in src, (
            "Newest-first ordering must be requested by the route; "
            "without it the frontend's history tab silently flips order."
        )
        assert "order_by=\"entry_time\"" in src or "order_by='entry_time'" in src


# --------------------------------------------------------------------------- #
# TradeLedger.list_paginated contract                                         #
# --------------------------------------------------------------------------- #


class TestListPaginatedContract:
    """Validate the method signature + input validation."""

    def test_method_exists(self) -> None:
        assert hasattr(TradeLedger, "list_paginated"), (
            "TradeLedger.list_paginated must exist — the route depends on it."
        )

    def test_rejects_unknown_order_by(self) -> None:
        # Without a DB this method bails early when the DB is unavailable;
        # but the order_by allowlist check runs BEFORE any DB access, so
        # we can exercise it on a fresh instance regardless of DB state.
        ledger = TradeLedger()
        with pytest.raises(ValueError, match="order_by"):
            ledger.list_paginated(order_by="DROP TABLE trade_ledger")

    def test_rejects_unknown_filter_column(self) -> None:
        ledger = TradeLedger()
        with pytest.raises(ValueError, match="filter column"):
            ledger.list_paginated(bogus_col="whatever")

    def test_accepts_allowed_columns(self) -> None:
        """``order_by`` against a real column must pass validation."""
        ledger = TradeLedger()
        # The method may return [] when DB is unavailable in tests — that
        # is the documented fallback and is fine for this assertion: we
        # only need the validation branch to PASS.
        try:
            result = ledger.list_paginated(
                limit=5, offset=0, order_by="entry_time",
                descending=True, strategy="pead",
            )
        except ValueError:
            pytest.fail(
                "list_paginated rejected a valid column combination."
            )
        assert isinstance(result, list)

    def test_bounds_invalid_limit_offset(self) -> None:
        ledger = TradeLedger()
        # Non-integer limit raises a clear error.
        with pytest.raises(ValueError):
            ledger.list_paginated(limit="ten")  # type: ignore[arg-type]


class TestListPaginatedSqlShape:
    """Source-level regression on the SQL composition."""

    def test_source_contains_limit_offset_order_by(self) -> None:
        src = inspect.getsource(TradeLedger.list_paginated)
        assert "LIMIT :_limit" in src
        assert "OFFSET :_offset" in src
        assert "ORDER BY" in src
        # The query must NULL-last so rows with no entry_time don't
        # poison the head of the DESC page.
        assert "NULLS LAST" in src

    def test_source_applies_allowlist(self) -> None:
        src = inspect.getsource(TradeLedger.list_paginated)
        # Validation must happen before the SQL text is assembled.
        assert "if order_by not in allowed" in src
        # And filter columns must be guarded the same way.
        assert "bad = [k for k in filters if k not in allowed]" in src


class TestAsyncWrapperExists:
    """Wave 6α Fix 5 — the async wrapper must not block the event loop."""

    def test_async_list_paginated_is_coroutine_function(self) -> None:
        import asyncio

        assert hasattr(TradeLedger, "async_list_paginated")
        assert asyncio.iscoroutinefunction(TradeLedger.async_list_paginated)

    def test_async_wrapper_routes_through_to_thread(self) -> None:
        src = inspect.getsource(TradeLedger.async_list_paginated)
        assert "asyncio.to_thread" in src, (
            "async_list_paginated must dispatch the sync call onto a "
            "worker thread so the asyncio loop isn't blocked."
        )
        assert "self.list_paginated" in src


# --------------------------------------------------------------------------- #
# Engine pool sizing (Fix 5)                                                  #
# --------------------------------------------------------------------------- #


class TestSyncEnginePoolSizing:
    """The trade-ledger sync engine must mirror the async engine's pool."""

    def test_pool_size_is_not_starvation_prone(self) -> None:
        raw = inspect.getsource(tl_mod._get_sync_engine)
        src = _strip_comments_and_docstrings(raw)
        assert "pool_size=20" in src, (
            "trade_ledger sync engine still uses a starvation-prone "
            "pool; bump to match core.database async pool (20 + 10)."
        )
        assert "max_overflow=10" in src
        # The old 3+2 cap must not reappear as executable code.
        assert "pool_size=3" not in src
        assert "max_overflow=2" not in src
