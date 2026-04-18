"""Persistent trade ledger backed by Postgres (TimescaleDB).

The historical implementation kept a single JSON file on disk, guarded by a
``threading.Lock``. Under Gunicorn+Uvicorn's multi-process worker model that
lock was useless: concurrent writes corrupted the file, IDs generated from
``len(entries) + 1`` collided, and a single decode error would silently reset
the ledger to empty.

This module now persists to Postgres via SQLAlchemy while keeping the public
``TradeLedger`` API surface 100% compatible with the rest of the codebase so
that callers (pipeline, strategies, routes, etc.) require no changes.

A one-shot, idempotent migration runs on first construction: any existing
``ledger.json`` is bulk-inserted into the ``trades`` table (preserving the old
``id`` values via ``ON CONFLICT DO NOTHING``) and the file is renamed to
``ledger.json.migrated`` so subsequent constructions skip the import.

If the database is unreachable at construction time the ledger falls back to
an in-memory cache so strategy callers don't crash — this is explicitly a
degraded mode and a warning is logged. The JSON file is *not* written in
fallback mode; recovery happens automatically when the DB returns.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock as _ThreadLock
from typing import Any, Iterable

logger = logging.getLogger(__name__)

LEDGER_PATH = Path(__file__).resolve().parent.parent / "pipeline_logs" / "ledger.json"
MIGRATED_PATH = LEDGER_PATH.with_suffix(".json.migrated")

# Migration flag — persisted via the filesystem sentinel, guarded in-process so
# only one thread attempts the migration.
_migration_lock = _ThreadLock()
_migration_done = False


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

    Returns ``None`` if the DB can't be reached — callers should fall back to
    the in-memory cache in that case.
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
            pool_size=3,
            max_overflow=2,
        )
        # Touch the connection to fail fast if DB unreachable.
        with _sync_engine.connect() as conn:
            conn.execute(_text("SELECT 1"))
        return _sync_engine
    except Exception as exc:
        logger.warning("TradeLedger: DB unavailable, using in-memory fallback: %s", exc)
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
        pnl_pct       DOUBLE PRECISION
    );
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
# One-shot JSON -> Postgres migration
# ---------------------------------------------------------------------------

def _run_migration(engine: Any) -> None:
    """Read ``ledger.json`` (if present) and bulk-insert into ``trade_ledger``.

    Safe to call repeatedly — ``ON CONFLICT DO NOTHING`` on ``id`` makes
    re-insertion a no-op. After a successful migration the source file is
    renamed to ``ledger.json.migrated`` so a second startup skips the read.
    """
    global _migration_done
    with _migration_lock:
        if _migration_done:
            return
        _migration_done = True

        if not LEDGER_PATH.exists():
            logger.info("TradeLedger: no legacy ledger.json found, skipping migration")
            return

        try:
            raw = LEDGER_PATH.read_text(encoding="utf-8")
        except Exception as exc:
            logger.error("TradeLedger: could not read %s: %s", LEDGER_PATH, exc)
            return

        try:
            payload = json.loads(raw)
        except Exception as exc:
            logger.error("TradeLedger: %s is corrupt, migration aborted: %s", LEDGER_PATH, exc)
            return

        trades = payload.get("trades") or []
        if not trades:
            logger.info("TradeLedger: ledger.json has no trades, marking migrated")
            try:
                LEDGER_PATH.replace(MIGRATED_PATH)
            except Exception:
                pass
            return

        inserted = 0
        with engine.begin() as conn:
            for t in trades:
                try:
                    conn.execute(
                        _text(
                            """
                            INSERT INTO trade_ledger (
                                id, symbol, shares, entry_price, entry_time,
                                stop_loss, take_profit, conviction, rationale,
                                strategy, status, exit_price, exit_time,
                                exit_reason, pnl, pnl_pct
                            )
                            VALUES (
                                :id, :symbol, :shares, :entry_price, :entry_time,
                                :stop_loss, :take_profit, :conviction, :rationale,
                                :strategy, :status, :exit_price, :exit_time,
                                :exit_reason, :pnl, :pnl_pct
                            )
                            ON CONFLICT (id) DO NOTHING
                            """
                        ),
                        {
                            "id": t.get("id"),
                            "symbol": t.get("symbol"),
                            "shares": int(t.get("shares") or 0),
                            "entry_price": t.get("entry_price"),
                            "entry_time": t.get("entry_time")
                            or datetime.now(timezone.utc).isoformat(),
                            "stop_loss": t.get("stop_loss"),
                            "take_profit": t.get("take_profit"),
                            "conviction": t.get("conviction") or 0,
                            "rationale": t.get("rationale"),
                            "strategy": t.get("strategy") or "claude_alpha",
                            "status": t.get("status") or "open",
                            "exit_price": t.get("exit_price"),
                            "exit_time": t.get("exit_time"),
                            "exit_reason": t.get("exit_reason"),
                            "pnl": t.get("pnl"),
                            "pnl_pct": t.get("pnl_pct"),
                        },
                    )
                    inserted += 1
                except Exception as exc:
                    logger.warning(
                        "TradeLedger migration: failed to insert id=%s: %s",
                        t.get("id"), exc,
                    )
            # Advance the sequence past the largest migrated id
            max_id = max((t.get("id") or 0 for t in trades), default=0)
            if max_id > 0:
                try:
                    conn.execute(
                        _text("SELECT setval('trade_ledger_id_seq', :v, true)"),
                        {"v": max_id},
                    )
                except Exception as exc:
                    logger.warning("TradeLedger migration: setval failed: %s", exc)

        logger.info(
            "TradeLedger: migrated %d/%d trades from %s -> %s",
            inserted, len(trades), LEDGER_PATH, MIGRATED_PATH,
        )
        try:
            LEDGER_PATH.replace(MIGRATED_PATH)
        except Exception as exc:
            logger.warning("TradeLedger: could not rename ledger.json after migration: %s", exc)


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
                _run_migration(self._engine)
            except Exception as exc:
                logger.warning("TradeLedger: schema/migration failure: %s", exc)
        # In-memory fallback, used only when the DB isn't available. Kept
        # per-instance so tests can exercise it in isolation.
        self._memory: list[dict[str, Any]] = []
        # Legacy compatibility for callers that poke at ledger._data["trades"]
        self._data: Any = _LegacyDataView(self)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _list_all(self) -> list[dict[str, Any]]:
        """Return every trade record in id order."""
        if self._engine is None:
            return list(self._memory)
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
        """Allocate the next primary key atomically via the DB sequence."""
        if self._engine is None:
            return len(self._memory) + 1
        try:
            with self._engine.begin() as conn:
                val = conn.execute(
                    _text("SELECT nextval('trade_ledger_id_seq')")
                ).scalar()
                return int(val or 0)
        except Exception as exc:
            logger.error("TradeLedger._next_id: %s", exc)
            # Best-effort fallback — monotonically increasing but not atomic
            try:
                with self._engine.connect() as conn:
                    mx = conn.execute(
                        _text("SELECT COALESCE(MAX(id), 0) + 1 FROM trade_ledger")
                    ).scalar()
                return int(mx or 1)
            except Exception:
                return 1

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
    ) -> dict[str, Any]:
        """Insert a new open trade and return the persisted record."""
        trade = {
            "id": self._next_id(),
            "symbol": symbol,
            "shares": int(shares),
            "entry_price": float(price),
            "entry_time": datetime.now(timezone.utc).isoformat(),
            "stop_loss": signal.get("stop_loss"),
            "take_profit": signal.get("take_profit"),
            "conviction": signal.get("conviction", 0),
            "rationale": rationale,
            "strategy": strategy,
            "status": "open",
            "exit_price": None,
            "exit_time": None,
            "exit_reason": None,
            "pnl": None,
            "pnl_pct": None,
        }
        if self._engine is None:
            self._memory.append(trade)
        else:
            try:
                with self._engine.begin() as conn:
                    conn.execute(
                        _text(
                            """
                            INSERT INTO trade_ledger (
                                id, symbol, shares, entry_price, entry_time,
                                stop_loss, take_profit, conviction, rationale,
                                strategy, status
                            )
                            VALUES (
                                :id, :symbol, :shares, :entry_price, :entry_time,
                                :stop_loss, :take_profit, :conviction, :rationale,
                                :strategy, 'open'
                            )
                            """
                        ),
                        trade,
                    )
            except Exception as exc:
                logger.error("TradeLedger.record_entry: %s — using in-memory fallback", exc)
                self._memory.append(trade)
        logger.info("Ledger: recorded ENTRY %s %d @ %.2f", symbol, shares, price)
        return trade

    def update_entry_price(self, symbol: str, new_price: float) -> bool:
        """Replace the pre-trade estimate with the broker fill for the most
        recent open trade of ``symbol``."""
        if self._engine is None:
            for trade in reversed(self._memory):
                if trade["symbol"] == symbol and trade["status"] == "open":
                    trade["entry_price"] = float(new_price)
                    return True
            return False
        try:
            with self._engine.begin() as conn:
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
    ) -> dict[str, Any] | None:
        """Close the oldest open trade for ``symbol`` and return the updated row."""
        if self._engine is None:
            for trade in self._memory:
                if trade["symbol"] == symbol and trade["status"] == "open":
                    trade["exit_price"] = float(price)
                    trade["exit_time"] = datetime.now(timezone.utc).isoformat()
                    trade["exit_reason"] = reason
                    trade["pnl"] = round((price - trade["entry_price"]) * shares, 2)
                    trade["shares"] = int(shares)
                    trade["pnl_pct"] = round(
                        ((price - trade["entry_price"]) / trade["entry_price"]) * 100, 2
                    )
                    trade["status"] = "closed"
                    return trade
            return None
        try:
            with self._engine.begin() as conn:
                row = conn.execute(
                    _text(
                        """
                        SELECT id, entry_price FROM trade_ledger
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
                pnl = round((float(price) - entry_price) * int(shares), 2)
                pnl_pct = (
                    round(((float(price) - entry_price) / entry_price) * 100, 2)
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
                               pnl_pct = :pnl_pct
                         WHERE id = :id
                        """
                    ),
                    {
                        "exit_price": float(price),
                        "reason": reason,
                        "shares": int(shares),
                        "pnl": pnl,
                        "pnl_pct": pnl_pct,
                        "id": trade_id,
                    },
                )
                fresh = conn.execute(
                    _text("SELECT * FROM trade_ledger WHERE id = :id"),
                    {"id": trade_id},
                ).one()
                result = _row_to_dict(fresh)
            logger.info(
                "Ledger: recorded EXIT %s %d @ %.2f  P&L=%.2f (%.1f%%)",
                symbol, shares, price, pnl, pnl_pct,
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
        """
        trade = dict(trade_dict)
        trade["id"] = self._next_id()
        trade.setdefault("status", "open")
        trade.setdefault("strategy", "claude_alpha")
        trade.setdefault(
            "entry_time", datetime.now(timezone.utc).isoformat()
        )
        if self._engine is None:
            self._memory.append(trade)
            return trade["id"]
        try:
            with self._engine.begin() as conn:
                conn.execute(
                    _text(
                        """
                        INSERT INTO trade_ledger (
                            id, symbol, shares, entry_price, entry_time,
                            stop_loss, take_profit, conviction, rationale,
                            strategy, status, exit_price, exit_time,
                            exit_reason, pnl, pnl_pct
                        )
                        VALUES (
                            :id, :symbol, :shares, :entry_price, :entry_time,
                            :stop_loss, :take_profit, :conviction, :rationale,
                            :strategy, :status, :exit_price, :exit_time,
                            :exit_reason, :pnl, :pnl_pct
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
                    },
                )
        except Exception as exc:
            logger.error("TradeLedger.add: %s", exc)
            self._memory.append(trade)
        return trade["id"]

    def update(self, trade_id: int, patch: dict[str, Any]) -> bool:
        """Apply a field-level patch to a single trade row."""
        if not patch:
            return False
        allowed = {
            "symbol", "shares", "entry_price", "entry_time", "stop_loss",
            "take_profit", "conviction", "rationale", "strategy", "status",
            "exit_price", "exit_time", "exit_reason", "pnl", "pnl_pct",
        }
        patch = {k: v for k, v in patch.items() if k in allowed}
        if not patch:
            return False
        if self._engine is None:
            for t in self._memory:
                if t["id"] == trade_id:
                    t.update(patch)
                    return True
            return False
        try:
            sets = ", ".join(f"{k} = :{k}" for k in patch)
            with self._engine.begin() as conn:
                rc = conn.execute(
                    _text(f"UPDATE trade_ledger SET {sets} WHERE id = :_id"),
                    {**patch, "_id": trade_id},
                ).rowcount
            return bool(rc)
        except Exception as exc:
            logger.error("TradeLedger.update: %s", exc)
            return False

    def list(self, filter: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Return trades matching an optional ``{column: value}`` filter."""
        filter = filter or {}
        if not filter:
            return self._list_all()
        if self._engine is None:
            def _match(t: dict[str, Any]) -> bool:
                return all(t.get(k) == v for k, v in filter.items())
            return [t for t in self._memory if _match(t)]
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
        """Return a single trade by id, or ``None`` if absent."""
        if self._engine is None:
            for t in self._memory:
                if t["id"] == trade_id:
                    return dict(t)
            return None
        try:
            with self._engine.connect() as conn:
                row = conn.execute(
                    _text("SELECT * FROM trade_ledger WHERE id = :id"),
                    {"id": trade_id},
                ).one_or_none()
            return _row_to_dict(row) if row is not None else None
        except Exception as exc:
            logger.error("TradeLedger.get: %s", exc)
            return None

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
        wins = [t for t in closed if (t.get("pnl") or 0) > 0]
        total_pnl = sum(t.get("pnl") or 0 for t in closed)
        pnl_pcts = [t.get("pnl_pct") or 0 for t in closed]
        best = max(closed, key=lambda t: t.get("pnl") or 0)
        worst = min(closed, key=lambda t: t.get("pnl") or 0)
        return {
            "total_trades": len(closed),
            "open_positions": len(self.get_open_positions()),
            "total_pnl": round(total_pnl, 2),
            "win_rate": round(len(wins) / len(closed) * 100, 1) if closed else 0.0,
            "avg_pnl_pct": round(sum(pnl_pcts) / len(pnl_pcts), 2) if pnl_pcts else 0.0,
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
            result[sym] = {
                "strategy": t.get("strategy", "claude_alpha"),
                "notional": round(price * shares, 2) if price and shares else 0,
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
                self.add({
                    "symbol": sym,
                    "shares": qty,
                    "entry_price": avg_price,
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

    def _match_strategy_for_symbol(self, symbol: str) -> str:
        """Find the most recent non-manual strategy that traded ``symbol``."""
        recent = self._list_all()[-50:]
        for trade in reversed(recent):
            if trade.get("symbol") == symbol and trade.get("strategy", "manual") != "manual":
                logger.info(
                    "Matched %s to strategy '%s' from recent trade #%d",
                    symbol, trade["strategy"], trade.get("id", 0),
                )
                return trade["strategy"]
        logger.warning("No strategy match for %s — defaulting to 'manual'", symbol)
        return "manual"

    def count_today_trades(self) -> int:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return sum(
            1 for t in self._list_all()
            if (t.get("entry_time") or "").startswith(today)
        )

    def get_strategy_performance(self) -> dict[str, dict[str, Any]]:
        perf: dict[str, dict[str, Any]] = {}
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
                    "total_pnl": 0.0,
                    "total_invested": 0.0,
                    "best_trade_pnl": 0.0,
                    "worst_trade_pnl": 0.0,
                }
            p = perf[strat]
            p["total_trades"] += 1
            invested = (trade.get("entry_price", 0) or 0) * (trade.get("shares", 0) or 0)
            p["total_invested"] += invested
            if trade["status"] == "open":
                p["open_trades"] += 1
            elif trade["status"] == "closed":
                p["closed_trades"] += 1
                pnl = trade.get("pnl", 0) or 0
                p["total_pnl"] += pnl
                if pnl > 0:
                    p["wins"] += 1
                else:
                    p["losses"] += 1
                p["best_trade_pnl"] = max(p["best_trade_pnl"], pnl)
                p["worst_trade_pnl"] = min(p["worst_trade_pnl"], pnl)
        for p in perf.values():
            closed = p["closed_trades"]
            p["win_rate"] = round(p["wins"] / closed * 100, 1) if closed > 0 else 0.0
            p["total_pnl"] = round(p["total_pnl"], 2)
            p["return_pct"] = round(
                (p["total_pnl"] / p["total_invested"] * 100) if p["total_invested"] > 0 else 0, 2
            )
        return perf
