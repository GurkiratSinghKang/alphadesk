"""Regression tests for ``TradeLedger.sync_with_alpaca`` (C2 fix).

These tests run against a SQLite in-memory engine standing in for the
production Postgres — no external DB is required. The ledger's hard
constraint ("no in-memory ghost data") is respected because SQLite backs
every call with a real, transactional store; the substitution is purely
for test isolation.

The sync path tested here (``record_entry`` / ``add`` / ``update`` /
``get_open_positions`` / ``sync_with_alpaca``) does not invoke any
Postgres-only SQL (``NOW()``, ``ON CONFLICT``, ``CREATE SEQUENCE``), so
the SQLite backend is sufficient to exercise the C2 regression.
"""
from __future__ import annotations

import itertools
import sys
import types
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text as sa_text

# Ensure ``backend/`` is importable (matches the rest of the backend test suite).
BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS trade_ledger (
    id            INTEGER PRIMARY KEY,
    symbol        VARCHAR(20)  NOT NULL,
    shares        INTEGER      NOT NULL,
    entry_price   REAL,
    entry_time    TEXT         NOT NULL,
    stop_loss     REAL,
    take_profit   REAL,
    conviction    INTEGER      DEFAULT 0,
    rationale     TEXT,
    strategy      VARCHAR(60)  NOT NULL DEFAULT 'claude_alpha',
    status        VARCHAR(16)  NOT NULL DEFAULT 'open',
    exit_price    REAL,
    exit_time     TEXT,
    exit_reason   VARCHAR(60),
    pnl           REAL,
    pnl_pct       REAL,
    side          VARCHAR(8)   DEFAULT 'long'
)
"""


@pytest.fixture
def memory_ledger(monkeypatch):
    """Instantiate a TradeLedger backed by a SQLite ``:memory:`` engine.

    The Postgres production path is untouched — we just swap in a local
    engine and an integer-counter stand-in for the ``trade_ledger_id_seq``
    sequence. Every call still goes through real SQL; no in-memory ghost
    store is used.
    """
    from data.ingestion import trade_ledger as tl_module

    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(sa_text(_SQLITE_DDL))

    # Short-circuit the module engine lookup so ``TradeLedger.__init__``
    # picks up our SQLite engine and skips migration / Postgres DDL.
    monkeypatch.setattr(tl_module, "_get_sync_engine", lambda: engine)
    monkeypatch.setattr(tl_module, "_ensure_schema", lambda _e: None)
    monkeypatch.setattr(tl_module, "_run_migration", lambda _e: None)

    ledger = tl_module.TradeLedger()
    # Replace the Postgres-sequence id allocator with a monotonic counter.
    id_counter = itertools.count(1)
    monkeypatch.setattr(ledger, "_next_id", lambda: next(id_counter))
    return ledger


def _seed_open_trade(ledger, symbol: str = "AAPL", shares: int = 10, price: float = 150.0):
    return ledger.record_entry(
        symbol=symbol,
        shares=shares,
        price=price,
        signal={"stop_loss": 140.0, "take_profit": 160.0, "conviction": 70},
        rationale=f"seed trade for {symbol}",
        strategy="pead",
    )


def test_empty_alpaca_response_does_not_close_open_trades(memory_ledger):
    """C2 repro: Alpaca returns [] but the ledger has open positions → do NOT close them."""
    _seed_open_trade(memory_ledger, "AAPL")
    _seed_open_trade(memory_ledger, "MRK")

    # Sanity check before sync
    assert len(memory_ledger.get_open_positions()) == 2

    summary = memory_ledger.sync_with_alpaca([])

    # The critical assertion — no open trades were closed.
    assert summary["closed"] == []
    open_after = memory_ledger.get_open_positions()
    assert len(open_after) == 2
    for t in open_after:
        assert t["status"] == "open"
        # pnl / exit_price must stay None (pre-fix regression kept null pnl)
        assert t["exit_price"] is None
        assert t["pnl"] is None
        assert t["exit_reason"] is None


def test_explicit_zero_qty_does_close_trade(memory_ledger):
    """When Alpaca reports qty=0 for a symbol, that IS a real signal to close."""
    _seed_open_trade(memory_ledger, "AAPL")
    alpaca_resp = [{"symbol": "AAPL", "qty": "0", "avg_entry_price": "150"}]

    summary = memory_ledger.sync_with_alpaca(alpaca_resp)

    assert "AAPL" in summary["closed"]
    open_after = memory_ledger.get_open_positions()
    assert open_after == []


def test_missing_symbol_with_other_positions_closes_trade(memory_ledger):
    """Alpaca returned a non-empty list that omits a symbol we hold — that's
    a signal to close (only the empty-response case is protected)."""
    _seed_open_trade(memory_ledger, "AAPL")
    _seed_open_trade(memory_ledger, "MRK")
    alpaca_resp = [{"symbol": "AAPL", "qty": "10", "avg_entry_price": "150"}]

    summary = memory_ledger.sync_with_alpaca(alpaca_resp)

    assert "MRK" in summary["closed"]
    assert "AAPL" not in summary["closed"]


def test_share_mismatch_updates_shares(memory_ledger):
    _seed_open_trade(memory_ledger, "AAPL", shares=10, price=150.0)
    alpaca_resp = [{"symbol": "AAPL", "qty": "15", "avg_entry_price": "150"}]

    summary = memory_ledger.sync_with_alpaca(alpaca_resp)

    assert "AAPL" in summary["updated"]
    open_after = memory_ledger.get_open_positions()
    assert len(open_after) == 1
    assert open_after[0]["shares"] == 15


def test_untracked_alpaca_position_creates_ledger_entry(memory_ledger):
    alpaca_resp = [{"symbol": "NVDA", "qty": "5", "avg_entry_price": "500"}]

    summary = memory_ledger.sync_with_alpaca(alpaca_resp)

    assert "NVDA" in summary["created"]
    open_after = memory_ledger.get_open_positions()
    assert len(open_after) == 1
    assert open_after[0]["symbol"] == "NVDA"
    assert open_after[0]["shares"] == 5


def test_api_surface_add_update_get_list(memory_ledger):
    """Exercise the modern ``add/update/list/get`` wrappers (C1 spec)."""
    new_id = memory_ledger.add({
        "symbol": "TSLA",
        "shares": 3,
        "entry_price": 200.0,
        "strategy": "pead",
        "rationale": "smoke",
    })
    assert isinstance(new_id, int)

    fetched = memory_ledger.get(new_id)
    assert fetched is not None
    assert fetched["symbol"] == "TSLA"

    assert memory_ledger.update(new_id, {"shares": 4}) is True
    assert memory_ledger.get(new_id)["shares"] == 4

    tsla = memory_ledger.list({"symbol": "TSLA"})
    assert len(tsla) == 1
    assert tsla[0]["id"] == new_id
