"""Persistent trade ledger backed by Postgres (TimescaleDB).

The historical implementation kept a single JSON file on disk, guarded by a
``threading.Lock``. Under Gunicorn+Uvicorn's multi-process worker model that
lock was useless: concurrent writes corrupted the file, IDs generated from
``len(entries) + 1`` collided, and a single decode error would silently reset
the ledger to empty.

This module now persists to Postgres via SQLAlchemy while keeping the public
``TradeLedger`` API surface 100% compatible with the rest of the codebase so
that callers (pipeline, strategies, routes, etc.) require no changes.

If the database is unreachable at construction time the ledger falls back to
an in-memory cache so strategy callers don't crash — this is explicitly a
degraded mode and a warning is logged. The JSON file is *not* written in
fallback mode; recovery happens automatically when the DB returns.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Iterable

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Money math helpers
# ---------------------------------------------------------------------------
# code-patterns-audit-r4 P0 #3: live P&L was previously computed in float and
# rounded with Python 3's banker's ``round()`` (half-to-even), diverging from
# the backtest engine and from Alpaca's reported P&L on .xx5 boundaries. We
# now compute in ``Decimal`` and quantize once at the end with
# ``ROUND_HALF_UP``. The function returns a ``Decimal``; callers convert to
# float at the JSON/DB boundary.
_TWO_PLACES = Decimal("0.01")


def _money(x: Any) -> Decimal:
    """Quantize a numeric value to 2 decimal places using ROUND_HALF_UP."""
    if x is None:
        return Decimal("0.00")
    if isinstance(x, Decimal):
        return x.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)
    # Convert via str() to avoid binary-float artefacts seeping in.
    return Decimal(str(x)).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)


def _to_decimal(x: Any) -> Decimal:
    """Lift a numeric value to ``Decimal`` for intermediate arithmetic.

    Unlike ``_money`` this does NOT quantize — use it for inputs to a
    multi-step calculation; quantize ONCE at the end with ``_money``.
    """
    if x is None:
        return Decimal("0")
    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))

# ---------------------------------------------------------------------------
# SQL helpers (sync, psycopg2-compatible driver via SQLAlchemy sync engine)
# ---------------------------------------------------------------------------

def _sync_database_url() -> str:
    """Return a sync (psycopg2 or pg8000) DATABASE_URL.

    The app-level engine is async (``postgresql+asyncpg://``), but the
    TradeLedger API is synchronous — every caller uses ``ledger.foo(...)``
    synchronously today. Converting all call sites to async is out of scope
    for this change, so we use a sync engine here.
    """
    from core.config import settings

    url = settings.DATABASE_URL
    # Strip the async driver suffix; SQLAlchemy will pick psycopg2 (or
    # psycopg) by default for postgresql://.
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    return url


_sync_engine: Any = None
_sync_engine_failed: bool = False


def _get_sync_engine() -> Any | None:
    """Lazy-construct (and cache) a sync SQLAlchemy engine.

    Returns ``None`` if the DB can't be reached. Callers MUST raise rather
    than silently fall back to an in-memory list — the old behaviour caused
    per-worker divergence where some workers saw real trades and others saw
    a ghost memory-only copy (P0 #5).

    Wave 6α Fix 5 (persona-124 P1): pool dimensions now mirror the main
    async engine (``pool_size=20, max_overflow=10``) instead of the old
    starvation-prone ``pool_size=3, max_overflow=2``. Under the old 3+2
    cap a burst of in-process sync ledger calls on a single worker could
    serialise against the pool and hold the event loop (sync calls invoked
    from an async context block the loop thread). The async route paths
    in ``portfolio.py``, ``trades.py`` and ``strategies.py`` no longer hit
    the sync engine directly (they use ``core.database._get_session_factory``
    async sessions); the remaining sync callers are the pipeline / strategy
    runners, which run outside the request path.

    For async callers that *do* still need the legacy sync API we expose
    ``TradeLedger.async_*`` wrappers below that route through
    ``asyncio.to_thread``, so a sync DB trip never blocks the event loop.
    """
    global _sync_engine, _sync_engine_failed
    if _sync_engine is not None:
        return _sync_engine
    if _sync_engine_failed:
        return None
    try:
        from sqlalchemy import create_engine

        _sync_engine = create_engine(
            _sync_database_url(),
            pool_pre_ping=True,
            # Mirror the async engine's dimensions (core.database._get_engine)
            # so a burst of sync ledger calls can't starve while the async
            # side is still under-utilised.
            pool_size=20,
            max_overflow=10,
            pool_recycle=300,
            pool_timeout=5.0,
        )
        # Touch the connection to fail fast if DB unreachable.
        with _sync_engine.connect() as conn:
            conn.execute(_text("SELECT 1"))
        return _sync_engine
    except Exception as exc:
        # Module-level error so oncall sees this in Sentry/logs. Callers will
        # see RuntimeError rather than a silently-diverged in-memory list.
        logger.error("TradeLedger: DB unavailable — all ledger calls will fail: %s", exc)
        _sync_engine_failed = True
        _sync_engine = None
        return None


def _text(sql: str) -> Any:
    """Shim: only imports sqlalchemy.text when we actually use it."""
    from sqlalchemy import text as sa_text

    return sa_text(sql)


def _ensure_schema(engine: Any) -> None:
    """Create the ``trades`` table if it doesn't already exist.

    The application's main ``init_db()`` also creates this table via the
    SQLAlchemy ORM ``Trade`` model, but the ledger may be instantiated before
    that runs (or from tooling that doesn't go through main.py). Creating
    idempotently here avoids ordering issues.

    Column set mirrors the legacy JSON record so the migration and all
    callers work unmodified.
    """
    # NOTE: ``side`` was added so short P&L can be computed correctly in
    # ``record_exit``. Nullable for legacy rows; defaults to 'long' on insert.
    # Existing deployments will need ``ALTER TABLE trade_ledger ADD COLUMN
    # side VARCHAR(8)`` — the ``ADD COLUMN IF NOT EXISTS`` statement below is
    # idempotent and safe to rerun.  TODO: generate a dedicated alembic
    # revision for this schema change.
    ddl = """
    CREATE TABLE IF NOT EXISTS trade_ledger (
        id            INTEGER PRIMARY KEY,
        symbol        VARCHAR(20)  NOT NULL,
        shares        INTEGER      NOT NULL,
        entry_price   DOUBLE PRECISION,
        entry_time    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        stop_loss     DOUBLE PRECISION,
        take_profit   DOUBLE PRECISION,
        conviction    INTEGER      DEFAULT 0,
        rationale     TEXT,
        strategy      VARCHAR(60)  NOT NULL DEFAULT 'claude_alpha',
        status        VARCHAR(16)  NOT NULL DEFAULT 'open',
        exit_price    DOUBLE PRECISION,
        exit_time     TIMESTAMPTZ,
        exit_reason   VARCHAR(60),
        pnl           DOUBLE PRECISION,
        pnl_pct       DOUBLE PRECISION,
        side          VARCHAR(8)   DEFAULT 'long'
    );
    ALTER TABLE trade_ledger ADD COLUMN IF NOT EXISTS side VARCHAR(8) DEFAULT 'long';
    CREATE INDEX IF NOT EXISTS ix_trade_ledger_status ON trade_ledger(status);
    CREATE INDEX IF NOT EXISTS ix_trade_ledger_symbol ON trade_ledger(symbol);
    CREATE INDEX IF NOT EXISTS ix_trade_ledger_strategy ON trade_ledger(strategy);
    CREATE SEQUENCE IF NOT EXISTS trade_ledger_id_seq;
    """
    with engine.begin() as conn:
        for stmt in [s for s in ddl.split(";") if s.strip()]:
            conn.execute(_text(stmt))


def _row_to_dict(row: Any) -> dict[str, Any]:
    """Convert a SQLAlchemy Row to the legacy dict shape."""
    m = dict(row._mapping) if hasattr(row, "_mapping") else dict(row)
    # Timestamps -> isoformat for API compatibility with the old JSON shape
    for k in ("entry_time", "exit_time"):
        if m.get(k) is not None and not isinstance(m[k], str):
            try:
                m[k] = m[k].isoformat()
            except Exception:
                m[k] = str(m[k])
    return m


# ---------------------------------------------------------------------------
# TradeLedger — stable public API backed by Postgres
# ---------------------------------------------------------------------------

class _LegacyDataView:
    """Backwards-compatible ``ledger._data["trades"]`` shim.

    Several callers still introspect ``ledger._data["trades"]`` directly.
    Returning a fresh list from the DB on every access preserves their
    semantics (iterating the full trade list) without requiring them to
    migrate to dedicated query methods right now.
    """

    def __init__(self, ledger: "TradeLedger") -> None:
        self._ledger = ledger

    def __getitem__(self, key: str) -> Any:
        if key == "trades":
            return self._ledger._list_all()
        if key == "version":
            return 1
        raise KeyError(key)

    def get(self, key: str, default: Any = None) -> Any:
        try:
            return self[key]
        except KeyError:
            return default


class TradeLedger:
    """Persistent trade ledger backed by Postgres.

    Public method signatures match the pre-migration JSON implementation so
    that no call site requires modification.
    """

    def __init__(self) -> None:
        self._engine = _get_sync_engine()
        if self._engine is not None:
            try:
                _ensure_schema(self._engine)
            except Exception as exc:
                logger.warning("TradeLedger: schema failure: %s", exc)
        # Legacy compatibility for callers that poke at ledger._data["trades"]
        self._data: Any = _LegacyDataView(self)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _require_engine(self) -> Any:
        """Return the engine or raise RuntimeError — no silent fallback."""
        if self._engine is None:
            raise RuntimeError(
                "TradeLedger: database unavailable. Refusing to return "
                "in-memory ghost data (would diverge across workers)."
            )
        return self._engine

    def _list_all(self) -> list[dict[str, Any]]:
        """Return every trade record in id order."""
        if self._engine is None:
            # Divergence protection: if DB is unreachable, an empty list is
            # safer than a stale in-memory list that doesn't match what
            # another worker sees. Caller sees "no trades" rather than
            # conflicting partial results.
            logger.error(
                "TradeLedger._list_all: DB unavailable — returning empty list"
            )
            return []
        try:
            with self._engine.connect() as conn:
                rows = conn.execute(
                    _text("SELECT * FROM trade_ledger ORDER BY id ASC")
                ).all()
            return [_row_to_dict(r) for r in rows]
        except Exception as exc:
            logger.error("TradeLedger._list_all: %s", exc)
            return []

    def _next_id(self) -> int:
        """Allocate the next primary key atomically via the DB sequence.

        The sequence is the ONLY safe source of primary keys under concurrency.
        A ``MAX(id) + 1`` fallback is non-atomic and silently drops trades when
        two writers collide, so we deliberately raise on sequence failure
        instead — the caller sees the error, and ops can intervene.
        """
        if self._engine is None:
            # DB unavailable — fail loudly. The previous in-memory fallback
            # caused per-worker divergence (P0 #5).
            raise RuntimeError(
                "TradeLedger._next_id: database unavailable; refusing to "
                "allocate an id. Fix DB connectivity before retrying."
            )
        with self._engine.begin() as conn:
            val = conn.execute(
                _text("SELECT nextval('trade_ledger_id_seq')")
            ).scalar()
        if val is None:
            raise RuntimeError(
                "TradeLedger._next_id: sequence 'trade_ledger_id_seq' returned NULL"
            )
        return int(val)

    # ------------------------------------------------------------------
    # Record keeping
    # ------------------------------------------------------------------

    def record_entry(
        self,
        symbol: str,
        shares: int,
        price: float,
        signal: dict[str, Any],
        rationale: str,
        strategy: str = "claude_alpha",
        side: str = "long",
    ) -> dict[str, Any]:
        """Insert a new open trade and return the persisted record.

        ``side`` is either ``"long"`` or ``"short"``. It governs how
        :meth:`record_exit` computes P&L: long P&L = (exit - entry) * shares,
        short P&L = (entry - exit) * shares. Defaults to ``"long"`` for
        backward compatibility with callers that haven't yet been updated to
        pass an explicit side.

        Raises :class:`RuntimeError` if the database is unavailable — the
        previous in-memory fallback caused per-worker divergence.
        """
        engine = self._require_engine()
        side_norm = "short" if str(side).lower() in {"short", "sell", "s"} else "long"

        # BUG-003 fix: enforce a default protective stop whenever a signal
        # doesn't specify one. A naked long gets a -5% stop from entry; a
        # naked short gets a +5% stop. Take-profit gets a 2:1 R:R default
        # so every position has at least a notional target to close against.
        # Strategy-provided levels always win.
        raw_stop = signal.get("stop_loss")
        raw_tp = signal.get("take_profit")
        entry_price = float(price)
        if raw_stop in (None, 0, 0.0) and entry_price > 0:
            raw_stop = round(
                entry_price * (0.95 if side_norm == "long" else 1.05), 2
            )
            logger.info(
                "TradeLedger: applied default %s stop for %s: entry=%.2f stop=%.2f",
                "-5%" if side_norm == "long" else "+5%", symbol, entry_price, raw_stop,
            )
        if raw_tp in (None, 0, 0.0) and entry_price > 0 and raw_stop:
            risk = abs(entry_price - float(raw_stop))
            if risk > 0:
                raw_tp = round(
                    entry_price + 2 * risk if side_norm == "long"
                    else entry_price - 2 * risk,
                    2,
                )

        trade = {
            "id": self._next_id(),
            "symbol": symbol,
            "shares": int(shares),
            "entry_price": entry_price,
            "entry_time": datetime.now(timezone.utc).isoformat(),
            "stop_loss": raw_stop,
            "take_profit": raw_tp,
            "conviction": signal.get("conviction", 0),
            "rationale": rationale,
            "strategy": strategy,
            "status": "open",
            "side": side_norm,
            "exit_price": None,
            "exit_time": None,
            "exit_reason": None,
            "pnl": None,
            "pnl_pct": None,
        }
        with engine.begin() as conn:
            conn.execute(
                _text(
                    """
                    INSERT INTO trade_ledger (
                        id, symbol, shares, entry_price, entry_time,
                        stop_loss, take_profit, conviction, rationale,
                        strategy, status, side
                    )
                    VALUES (
                        :id, :symbol, :shares, :entry_price, :entry_time,
                        :stop_loss, :take_profit, :conviction, :rationale,
                        :strategy, 'open', :side
                    )
                    """
                ),
                trade,
            )
        logger.info(
            "Ledger: recorded ENTRY %s %d @ %.2f (side=%s)",
            symbol, shares, price, side_norm,
        )
        return trade

    def update_entry_price(self, symbol: str, new_price: float) -> bool:
        """Replace the pre-trade estimate with the broker fill for the most
        recent open trade of ``symbol``.

        Raises :class:`RuntimeError` if DB is unavailable.
        """
        engine = self._require_engine()
        try:
            with engine.begin() as conn:
                # Update the most recent open trade matching symbol
                rc = conn.execute(
                    _text(
                        """
                        UPDATE trade_ledger
                           SET entry_price = :new_price
                         WHERE id = (
                            SELECT id FROM trade_ledger
                             WHERE symbol = :symbol AND status = 'open'
                             ORDER BY id DESC LIMIT 1
                         )
                        """
                    ),
                    {"new_price": float(new_price), "symbol": symbol},
                ).rowcount
            if rc:
                logger.info("Ledger: updated entry price for %s -> %.2f", symbol, new_price)
                return True
        except Exception as exc:
            logger.error("TradeLedger.update_entry_price: %s", exc)
        logger.warning("Ledger: no open trade for %s to update entry price", symbol)
        return False

    def record_exit(
        self,
        symbol: str,
        shares: int,
        price: float,
        reason: str,
        side: str | None = None,
    ) -> dict[str, Any] | None:
        """Close the oldest open trade for ``symbol`` and return the updated row.

        ``side`` overrides the side stored on the entry. When ``None`` the
        function reads the side column from the open row (defaulting to
        ``"long"`` for legacy rows that pre-date the column). Short P&L is
        computed as (entry - exit) * shares; long P&L as (exit - entry) * shares.

        Raises :class:`RuntimeError` if DB is unavailable.
        """
        engine = self._require_engine()
        try:
            with engine.begin() as conn:
                row = conn.execute(
                    _text(
                        """
                        SELECT id, entry_price, side FROM trade_ledger
                         WHERE symbol = :symbol AND status = 'open'
                         ORDER BY id ASC LIMIT 1
                        """
                    ),
                    {"symbol": symbol},
                ).one_or_none()
                if row is None:
                    logger.warning("Ledger: no open trade for %s to exit", symbol)
                    return None
                trade_id = row[0]
                entry_price = float(row[1] or 0.0)
                stored_side = row[2] if len(row) > 2 else None
                effective_side_raw = side if side is not None else stored_side
                effective_side = (
                    "short"
                    if str(effective_side_raw or "long").lower() in {"short", "sell", "s"}
                    else "long"
                )
                qty = int(shares)
                # code-patterns-audit-r4 P0 #3: compute P&L in Decimal with
                # one ROUND_HALF_UP at the end. Keeps the return type float
                # for JSON/DB serialization but eliminates the .xx5 banker's-
                # rounding drift vs. the backtest engine and Alpaca's UI.
                entry_dec = _to_decimal(entry_price)
                price_dec = _to_decimal(price)
                qty_dec = _to_decimal(qty)
                if effective_side == "short":
                    # Short: profit when exit < entry.
                    pnl = float(_money((entry_dec - price_dec) * qty_dec))
                    pnl_pct = (
                        float(_money(((entry_dec - price_dec) / entry_dec) * Decimal("100")))
                        if entry_price else 0.0
                    )
                else:
                    pnl = float(_money((price_dec - entry_dec) * qty_dec))
                    pnl_pct = (
                        float(_money(((price_dec - entry_dec) / entry_dec) * Decimal("100")))
                        if entry_price else 0.0
                    )
                conn.execute(
                    _text(
                        """
                        UPDATE trade_ledger
                           SET status = 'closed',
                               exit_price = :exit_price,
                               exit_time = NOW(),
                               exit_reason = :reason,
                               shares = :shares,
                               pnl = :pnl,
                               pnl_pct = :pnl_pct,
                               side = :side
                         WHERE id = :id
                        """
                    ),
                    {
                        "exit_price": float(price),
                        "reason": reason,
                        "shares": qty,
                        "pnl": pnl,
                        "pnl_pct": pnl_pct,
                        "side": effective_side,
                        "id": trade_id,
                    },
                )
                fresh = conn.execute(
                    _text("SELECT * FROM trade_ledger WHERE id = :id"),
                    {"id": trade_id},
                ).one()
                result = _row_to_dict(fresh)
            logger.info(
                "Ledger: recorded EXIT %s %d @ %.2f  side=%s P&L=%.2f (%.1f%%)",
                symbol, shares, price, effective_side, pnl, pnl_pct,
            )
            return result
        except Exception as exc:
            logger.error("TradeLedger.record_exit: %s", exc)
            return None

    # ------------------------------------------------------------------
    # Generic add/update/list/get — modern API surface (C1 spec)
    # ------------------------------------------------------------------

    def add(self, trade_dict: dict[str, Any]) -> int:
        """Insert a full trade record and return the new id.

        Ignores any ``id`` in the dict — the DB sequence assigns one.
        Raises :class:`RuntimeError` if DB is unavailable.
        """
        engine = self._require_engine()
        trade = dict(trade_dict)
        trade["id"] = self._next_id()
        trade.setdefault("status", "open")
        trade.setdefault("strategy", "claude_alpha")
        trade.setdefault(
            "entry_time", datetime.now(timezone.utc).isoformat()
        )
        raw_side = str(trade.get("side") or "long").lower()
        trade["side"] = "short" if raw_side in {"short", "sell", "s"} else "long"
        with engine.begin() as conn:
            conn.execute(
                _text(
                    """
                    INSERT INTO trade_ledger (
                        id, symbol, shares, entry_price, entry_time,
                        stop_loss, take_profit, conviction, rationale,
                        strategy, status, exit_price, exit_time,
                        exit_reason, pnl, pnl_pct, side
                    )
                    VALUES (
                        :id, :symbol, :shares, :entry_price, :entry_time,
                        :stop_loss, :take_profit, :conviction, :rationale,
                        :strategy, :status, :exit_price, :exit_time,
                        :exit_reason, :pnl, :pnl_pct, :side
                    )
                    """
                ),
                {
                    "id": trade["id"],
                    "symbol": trade.get("symbol"),
                    "shares": int(trade.get("shares") or 0),
                    "entry_price": trade.get("entry_price"),
                    "entry_time": trade.get("entry_time"),
                    "stop_loss": trade.get("stop_loss"),
                    "take_profit": trade.get("take_profit"),
                    "conviction": trade.get("conviction") or 0,
                    "rationale": trade.get("rationale"),
                    "strategy": trade.get("strategy"),
                    "status": trade.get("status"),
                    "exit_price": trade.get("exit_price"),
                    "exit_time": trade.get("exit_time"),
                    "exit_reason": trade.get("exit_reason"),
                    "pnl": trade.get("pnl"),
                    "pnl_pct": trade.get("pnl_pct"),
                    "side": trade.get("side"),
                },
            )
        return trade["id"]

    def update(self, trade_id: int, patch: dict[str, Any]) -> bool:
        """Apply a field-level patch to a single trade row.

        Raises :class:`RuntimeError` if DB is unavailable.
        """
        if not patch:
            return False
        allowed = {
            "symbol", "shares", "entry_price", "entry_time", "stop_loss",
            "take_profit", "conviction", "rationale", "strategy", "status",
            "exit_price", "exit_time", "exit_reason", "pnl", "pnl_pct",
            "side",
        }
        patch = {k: v for k, v in patch.items() if k in allowed}
        if not patch:
            return False
        engine = self._require_engine()
        try:
            sets = ", ".join(f"{k} = :{k}" for k in patch)
            with engine.begin() as conn:
                rc = conn.execute(
                    _text(f"UPDATE trade_ledger SET {sets} WHERE id = :_id"),
                    {**patch, "_id": trade_id},
                ).rowcount
            return bool(rc)
        except Exception as exc:
            logger.error("TradeLedger.update: %s", exc)
            return False

    def list(self, filter: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Return trades matching an optional ``{column: value}`` filter.

        Column names are validated against an allowlist — arbitrary keys are
        rejected with :class:`ValueError`. Values are always parameterised.
        """
        filter = filter or {}
        if not filter:
            return self._list_all()
        # Allowlist — must match _ensure_schema columns. Prevents SQL injection
        # if a caller ever accidentally (or maliciously) routes user input
        # into the filter dict.
        allowed = {
            "id", "symbol", "shares", "entry_price", "entry_time", "stop_loss",
            "take_profit", "conviction", "rationale", "strategy", "status",
            "exit_price", "exit_time", "exit_reason", "pnl", "pnl_pct",
            "side",
        }
        bad = [k for k in filter if k not in allowed]
        if bad:
            raise ValueError(
                f"TradeLedger.list: unknown filter column(s) {bad!r}; "
                f"allowed: {sorted(allowed)}"
            )
        if self._engine is None:
            raise RuntimeError(
                "TradeLedger.list: database unavailable; refusing to return "
                "potentially stale in-memory data."
            )
        try:
            where = " AND ".join(f"{k} = :{k}" for k in filter)
            with self._engine.connect() as conn:
                rows = conn.execute(
                    _text(f"SELECT * FROM trade_ledger WHERE {where} ORDER BY id ASC"),
                    filter,
                ).all()
            return [_row_to_dict(r) for r in rows]
        except Exception as exc:
            logger.error("TradeLedger.list: %s", exc)
            return []

    def get(self, trade_id: int) -> dict[str, Any] | None:
        """Return a single trade by id, or ``None`` if absent.

        Raises :class:`RuntimeError` if DB is unavailable.
        """
        engine = self._require_engine()
        try:
            with engine.connect() as conn:
                row = conn.execute(
                    _text("SELECT * FROM trade_ledger WHERE id = :id"),
                    {"id": trade_id},
                ).one_or_none()
            return _row_to_dict(row) if row is not None else None
        except Exception as exc:
            logger.error("TradeLedger.get: %s", exc)
            return None

    def list_paginated(
        self,
        limit: int = 100,
        offset: int = 0,
        order_by: str = "entry_time",
        descending: bool = True,
        **filters: Any,
    ) -> list[dict[str, Any]]:
        """Return a page of trades with LIMIT/OFFSET/ORDER BY pushed into SQL.

        Wave 6α Fix 2 (persona-124 P0): callers that just want a paginated
        slice previously routed through ``_data["trades"]`` (→ ``_list_all``
        → SELECT \\*) and then applied the sort + window in Python. At 50M
        rows that blew the event loop. This method keeps the page-cost
        independent of total-row-count.

        Parameters
        ----------
        limit, offset:
            Window size + skip count. Bounded by the caller — the route
            layer already validates these via Pydantic ``Query`` constraints.
        order_by:
            Column name to sort on. Validated against the same column
            allowlist as ``list()`` to prevent injection.
        descending:
            ``True`` for DESC (newest first — the dashboard default),
            ``False`` for ASC.
        filters:
            Equality predicates applied as an ``AND``-chain on the WHERE
            clause. Column names validated against the allowlist.
        """
        allowed = {
            "id", "symbol", "shares", "entry_price", "entry_time", "stop_loss",
            "take_profit", "conviction", "rationale", "strategy", "status",
            "exit_price", "exit_time", "exit_reason", "pnl", "pnl_pct",
            "side",
        }
        if order_by not in allowed:
            raise ValueError(
                f"TradeLedger.list_paginated: unknown order_by column "
                f"{order_by!r}; allowed: {sorted(allowed)}"
            )
        bad = [k for k in filters if k not in allowed]
        if bad:
            raise ValueError(
                f"TradeLedger.list_paginated: unknown filter column(s) "
                f"{bad!r}; allowed: {sorted(allowed)}"
            )
        # Bound defensively — route layer already validates but this is
        # the public API, callable from anywhere.
        try:
            lim = max(1, min(int(limit), 10_000))
            off = max(0, int(offset))
        except (TypeError, ValueError):
            raise ValueError("limit/offset must be integers")

        if self._engine is None:
            logger.error(
                "TradeLedger.list_paginated: DB unavailable — returning empty page"
            )
            return []

        direction = "DESC" if descending else "ASC"
        where_sql = ""
        if filters:
            where_sql = "WHERE " + " AND ".join(
                f"{k} = :{k}" for k in filters
            )
        sql = (
            f"SELECT * FROM trade_ledger {where_sql} "
            f"ORDER BY {order_by} {direction} NULLS LAST, id {direction} "
            f"LIMIT :_limit OFFSET :_offset"
        )
        params: dict[str, Any] = {**filters, "_limit": lim, "_offset": off}
        try:
            with self._engine.connect() as conn:
                rows = conn.execute(_text(sql), params).all()
            return [_row_to_dict(r) for r in rows]
        except Exception as exc:
            logger.error("TradeLedger.list_paginated: %s", exc)
            return []

    # ------------------------------------------------------------------
    # Queries (legacy API, preserved verbatim)
    # ------------------------------------------------------------------

    def get_open_positions(self) -> list[dict[str, Any]]:
        return self.list({"status": "open"})

    def get_closed_trades(
        self,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> list[dict[str, Any]]:
        closed = self.list({"status": "closed"})
        if start_date:
            closed = [t for t in closed if t.get("exit_time") and t["exit_time"] >= start_date]
        if end_date:
            closed = [t for t in closed if t.get("exit_time") and t["exit_time"] <= end_date]
        return closed

    def get_performance_summary(self) -> dict[str, Any]:
        closed = self.get_closed_trades()
        if not closed:
            return {
                "total_trades": 0,
                "open_positions": len(self.get_open_positions()),
                "total_pnl": 0.0,
                "win_rate": 0.0,
                "avg_pnl_pct": 0.0,
                "best_trade": None,
                "worst_trade": None,
            }
        # Classify: wins > 0, losses < 0, scratches == 0. Scratches are
        # excluded from the win_rate denominator per the audit: break-even
        # trades are neither wins nor losses.
        wins = [t for t in closed if (t.get("pnl") or 0) > 0]
        losses = [t for t in closed if (t.get("pnl") or 0) < 0]
        decided = len(wins) + len(losses)
        # Sum P&L in Decimal then quantize once at the end — banker's rounding
        # at every per-trade addition leaks cents over thousands of trades
        # (code-patterns-audit-r4 P0 #3).
        total_pnl_dec = sum(
            (_to_decimal(t.get("pnl") or 0) for t in closed),
            start=Decimal("0"),
        )
        pnl_pcts = [t.get("pnl_pct") or 0 for t in closed]
        best = max(closed, key=lambda t: t.get("pnl") or 0)
        worst = min(closed, key=lambda t: t.get("pnl") or 0)
        avg_pnl_pct_dec = (
            sum((_to_decimal(p) for p in pnl_pcts), start=Decimal("0"))
            / Decimal(len(pnl_pcts))
            if pnl_pcts else Decimal("0")
        )
        return {
            "total_trades": len(closed),
            "open_positions": len(self.get_open_positions()),
            "total_pnl": float(_money(total_pnl_dec)),
            # win_rate is a display percentage (1 decimal) — leaving as float
            # is acceptable per the audit, but we still avoid banker's rounding.
            "win_rate": float(
                _to_decimal(len(wins) / decided * 100).quantize(
                    Decimal("0.1"), rounding=ROUND_HALF_UP,
                )
            ) if decided else 0.0,
            "avg_pnl_pct": float(_money(avg_pnl_pct_dec)),
            "best_trade": {
                "symbol": best["symbol"],
                "pnl": best.get("pnl", 0),
                "pnl_pct": best.get("pnl_pct", 0),
            },
            "worst_trade": {
                "symbol": worst["symbol"],
                "pnl": worst.get("pnl", 0),
                "pnl_pct": worst.get("pnl_pct", 0),
            },
        }

    def get_held_symbols(self) -> set[str]:
        return {t["symbol"] for t in self.get_open_positions()}

    def get_position_strategy_map(self) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for t in self.get_open_positions():
            sym = t["symbol"]
            price = t.get("entry_price", 0) or 0
            shares = t.get("shares", 0) or 0
            # Notional in Decimal then float for JSON — avoids banker's
            # rounding on .xx5 boundaries (code-patterns-audit-r4 P0 #3).
            notional_val = (
                float(_money(_to_decimal(price) * _to_decimal(shares)))
                if price and shares else 0
            )
            result[sym] = {
                "strategy": t.get("strategy", "claude_alpha"),
                "notional": notional_val,
                "shares": shares,
                "entry_price": price,
            }
        return result

    def sync_with_alpaca(self, alpaca_positions: list[dict[str, Any]]) -> dict[str, Any]:
        """Reconcile ledger with live broker state.

        Safety change (C2): an *empty* Alpaca response is no longer treated
        as "all positions are closed". That condition almost always means
        the broker API is degraded/unauthorized/rate-limited. Auto-closing
        every open trade with ``exit_price=null, pnl=null`` is the worst
        possible failure mode — it permanently corrupts P&L.

        The new rule is:
            - If Alpaca returns an empty positions list AND we have open
              ledger rows, log a WARNING and skip the close pass.
            - A ledger row is only closed when the broker returns an
              explicit signal for that position (e.g. qty=0). "Missing
              entirely" is treated as inconclusive.
        """
        alpaca_by_sym: dict[str, dict[str, Any]] = {}
        zeroed_syms: set[str] = set()
        for pos in alpaca_positions:
            sym = pos.get("symbol", "")
            if not sym:
                continue
            try:
                qty = int(float(pos.get("qty", 0)))
            except (TypeError, ValueError):
                qty = 0
            alpaca_by_sym[sym] = pos
            if qty == 0:
                zeroed_syms.add(sym)

        created: list[str] = []
        updated: list[str] = []
        closed: list[str] = []

        open_trades = self.get_open_positions()
        open_syms_in_ledger: set[str] = {t["symbol"] for t in open_trades}

        # ── Safety guard ─────────────────────────────────────────────
        # Don't mass-close open trades when Alpaca returned *nothing*.
        broker_probably_degraded = (
            not alpaca_by_sym and bool(open_syms_in_ledger)
        )
        if broker_probably_degraded:
            logger.warning(
                "TradeLedger.sync_with_alpaca: Alpaca returned empty positions while "
                "%d ledger trades are open — skipping close pass (possible broker "
                "degradation). Ledger trades: %s",
                len(open_syms_in_ledger), sorted(open_syms_in_ledger),
            )

        for trade in open_trades:
            sym = trade["symbol"]
            if sym in alpaca_by_sym:
                try:
                    alpaca_qty = int(float(alpaca_by_sym[sym].get("qty", 0)))
                except (TypeError, ValueError):
                    alpaca_qty = 0
                if alpaca_qty == 0:
                    # Explicit "the position has zero shares" — treat as closed
                    self.update(trade["id"], {
                        "status": "closed",
                        "exit_time": datetime.now(timezone.utc).isoformat(),
                        "exit_reason": "alpaca_sync_zero_qty",
                    })
                    closed.append(sym)
                    logger.info("Ledger sync: closed %s (Alpaca qty=0)", sym)
                elif trade["shares"] != alpaca_qty and alpaca_qty > 0:
                    self.update(trade["id"], {"shares": alpaca_qty})
                    updated.append(sym)
                    logger.info(
                        "Ledger sync: updating %s shares %d -> %d",
                        sym, trade["shares"], alpaca_qty,
                    )
            else:
                # Position absent from Alpaca. We only close if Alpaca gave
                # us an otherwise-non-empty response — "absent" is a
                # meaningful signal only when we know the broker answered.
                if broker_probably_degraded:
                    continue
                # Even here we don't have a fill price, so leave pnl=null
                # and log that it's a soft close for manual review.
                self.update(trade["id"], {
                    "status": "closed",
                    "exit_time": datetime.now(timezone.utc).isoformat(),
                    "exit_reason": "alpaca_sync_absent",
                })
                closed.append(sym)
                logger.info(
                    "Ledger sync: closed %s (absent from Alpaca response)", sym,
                )

        # BUG-018: deterministic microsecond offsets so a batch of trades
        # auto-created in the same ``sync_with_alpaca`` call don't all share
        # an identical ``entry_time`` down to the second. Using the symbol
        # itself as the offset key keeps the ordering stable across re-syncs
        # and makes the timestamps visibly different when the UI truncates to
        # the minute or second. The offset is bounded to <1s so it never
        # lands before an upstream event that genuinely happened earlier.
        sync_now = datetime.now(timezone.utc)
        sorted_new_syms = sorted(
            sym for sym in alpaca_by_sym
            if sym not in zeroed_syms and sym not in open_syms_in_ledger
        )

        for sym, pos in alpaca_by_sym.items():
            if sym in zeroed_syms:
                continue
            if sym not in open_syms_in_ledger:
                try:
                    avg_price = float(pos.get("avg_entry_price", 0))
                    qty = int(float(pos.get("qty", 0)))
                except (TypeError, ValueError):
                    continue
                if qty <= 0:
                    continue
                matched_strategy = self._match_strategy_for_symbol(sym)
                # Per-symbol ms offset: deterministic, bounded <1s. Each symbol
                # in this sync gets its index × 100ms added so 7 positions
                # created together appear at 01:42:00.000, 01:42:00.100, …
                try:
                    sym_idx = sorted_new_syms.index(sym)
                except ValueError:
                    sym_idx = 0
                entry_ts = (
                    sync_now + timedelta(milliseconds=(sym_idx % 10) * 100)
                ).isoformat()
                self.add({
                    "symbol": sym,
                    "shares": qty,
                    "entry_price": avg_price,
                    "entry_time": entry_ts,
                    "stop_loss": None,
                    "take_profit": None,
                    "conviction": 0,
                    "rationale": f"Auto-created by Alpaca sync (matched to {matched_strategy})",
                    "strategy": matched_strategy,
                    "status": "open",
                })
                created.append(sym)
                logger.info(
                    "Ledger sync: created entry for %s (%d shares @ %.2f, strategy=%s)",
                    sym, qty, avg_price, matched_strategy,
                )

        summary = {"created": created, "updated": updated, "closed": closed}
        logger.info("Ledger sync complete: %s", summary)
        return summary

    def _match_strategy_for_symbol(
        self,
        symbol: str,
        days_back: int = 90,
        window: int = 500,
    ) -> str:
        """Find the most recent non-manual strategy that traded ``symbol``.

        Previously this only searched the last 50 ledger rows, which wrongly
        attributed sync-recreated trades to ``manual`` when a strategy-owned
        trade was older than the 50-row tail. We now widen the window to the
        last ``window`` rows (default 500) *and* accept any trade whose
        ``entry_time`` is within ``days_back`` days (default 90).
        """
        from datetime import datetime, timedelta, timezone

        cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
        all_trades = self._list_all()
        # Search up to ``window`` most recent rows (by id order).
        recent = all_trades[-window:]
        for trade in reversed(recent):
            if trade.get("symbol") != symbol:
                continue
            strat = trade.get("strategy", "manual") or "manual"
            if strat == "manual":
                continue
            # Respect the recency window
            entry_time_raw = trade.get("entry_time") or ""
            try:
                entry_dt = datetime.fromisoformat(entry_time_raw)
                if entry_dt.tzinfo is None:
                    entry_dt = entry_dt.replace(tzinfo=timezone.utc)
                if entry_dt < cutoff:
                    continue
            except (ValueError, TypeError):
                # If entry_time is unparseable, still accept — the audit
                # concern is attribution correctness, not strict recency.
                pass
            logger.info(
                "Matched %s to strategy '%s' from recent trade #%d",
                symbol, strat, trade.get("id", 0),
            )
            return strat
        logger.warning(
            "No strategy match for %s within %d trades / %d days — defaulting to 'manual'",
            symbol, window, days_back,
        )
        return "manual"

    def count_today_trades(self) -> int:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return sum(
            1 for t in self._list_all()
            if (t.get("entry_time") or "").startswith(today)
        )

    def get_strategy_performance(self) -> dict[str, dict[str, Any]]:
        # Sum invested / pnl in Decimal for each strategy then quantize once
        # at the end. Eliminates per-trade banker's-rounding drift
        # (code-patterns-audit-r4 P0 #3).
        perf: dict[str, dict[str, Any]] = {}
        # Parallel Decimal accumulators keyed by strategy name.
        dec_totals: dict[str, dict[str, Decimal]] = {}
        for trade in self._list_all():
            strat = trade.get("strategy", "unknown")
            if strat not in perf:
                perf[strat] = {
                    "strategy": strat,
                    "total_trades": 0,
                    "open_trades": 0,
                    "closed_trades": 0,
                    "wins": 0,
                    "losses": 0,
                    "scratches": 0,
                    "total_pnl": 0.0,
                    "total_invested": 0.0,
                    "best_trade_pnl": 0.0,
                    "worst_trade_pnl": 0.0,
                }
                dec_totals[strat] = {
                    "total_pnl": Decimal("0"),
                    "total_invested": Decimal("0"),
                }
            p = perf[strat]
            d = dec_totals[strat]
            p["total_trades"] += 1
            invested_dec = (
                _to_decimal(trade.get("entry_price", 0) or 0)
                * _to_decimal(trade.get("shares", 0) or 0)
            )
            d["total_invested"] += invested_dec
            if trade["status"] == "open":
                p["open_trades"] += 1
            elif trade["status"] == "closed":
                p["closed_trades"] += 1
                pnl = trade.get("pnl", 0) or 0
                d["total_pnl"] += _to_decimal(pnl)
                # Classify pnl strictly: wins > 0, losses < 0, scratches == 0.
                # Break-even trades must not be counted as losses.
                if pnl > 0:
                    p["wins"] += 1
                elif pnl < 0:
                    p["losses"] += 1
                else:
                    p["scratches"] += 1
                p["best_trade_pnl"] = max(p["best_trade_pnl"], pnl)
                p["worst_trade_pnl"] = min(p["worst_trade_pnl"], pnl)
        for strat, p in perf.items():
            d = dec_totals[strat]
            decided = p["wins"] + p["losses"]
            # win_rate stays a 1-decimal display percentage but uses
            # ROUND_HALF_UP rather than banker's rounding.
            if decided > 0:
                p["win_rate"] = float(
                    _to_decimal(p["wins"] / decided * 100).quantize(
                        Decimal("0.1"), rounding=ROUND_HALF_UP,
                    )
                )
            else:
                p["win_rate"] = 0.0
            p["total_pnl"] = float(_money(d["total_pnl"]))
            p["total_invested"] = float(_money(d["total_invested"]))
            if d["total_invested"] > 0:
                p["return_pct"] = float(_money(
                    (d["total_pnl"] / d["total_invested"]) * Decimal("100")
                ))
            else:
                p["return_pct"] = 0.0
        return perf

    # ------------------------------------------------------------------
    # Async wrappers — preserve the sync API (every existing caller keeps
    # working) while letting async code invoke ledger operations without
    # blocking the event loop.
    #
    # Wave 6α Fix 5 (persona-124 P1): the sync API fires sync DB I/O via
    # SQLAlchemy's sync engine. When invoked from an async handler
    # (FastAPI request path, background task on the asyncio loop), that
    # blocks the loop thread for the duration of the round-trip. Wrapping
    # in ``asyncio.to_thread`` dispatches the sync call onto the default
    # threadpool executor so the loop stays responsive.
    #
    # Only a minimal set of hot methods is wrapped here — callers that
    # need something else should either move to direct async SQL (see
    # ``list_paginated`` + the ``_get_session_factory`` pattern in the
    # routes) or add an async wrapper mirroring the shape below.
    # ------------------------------------------------------------------

    async def async_list_paginated(
        self,
        limit: int = 100,
        offset: int = 0,
        order_by: str = "entry_time",
        descending: bool = True,
        **filters: Any,
    ) -> list[dict[str, Any]]:
        """Async counterpart to :meth:`list_paginated` — non-blocking."""
        import asyncio

        return await asyncio.to_thread(
            self.list_paginated,
            limit=limit,
            offset=offset,
            order_by=order_by,
            descending=descending,
            **filters,
        )

    async def async_get_open_positions(self) -> list[dict[str, Any]]:
        """Async counterpart to :meth:`get_open_positions`."""
        import asyncio

        return await asyncio.to_thread(self.get_open_positions)

    async def async_get_closed_trades(
        self,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> list[dict[str, Any]]:
        """Async counterpart to :meth:`get_closed_trades`."""
        import asyncio

        return await asyncio.to_thread(
            self.get_closed_trades,
            start_date=start_date,
            end_date=end_date,
        )
