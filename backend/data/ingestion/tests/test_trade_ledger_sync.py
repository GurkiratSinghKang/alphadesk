"""Regression tests for ``TradeLedger.sync_with_alpaca`` (C2 fix).

These tests run against the in-memory fallback path of ``TradeLedger`` — no
database is required. That is exactly the guarantee the C2 spec asks for: a
unit test reproducing the empty-Alpaca-response edge case that asserts open
trades are NOT closed when the broker API returns nothing.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

# Ensure ``backend/`` is importable (matches the rest of the backend test suite).
BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture
def memory_ledger(monkeypatch):
    """Instantiate a TradeLedger forced into its in-memory fallback mode.

    We short-circuit ``_get_sync_engine`` so no DB connection is attempted —
    the ledger falls back to the in-memory list and the migration step is
    skipped.
    """
    from data.ingestion import trade_ledger as tl_module

    monkeypatch.setattr(tl_module, "_get_sync_engine", lambda: None)
    # Also suppress the legacy ledger.json migration side effect.
    monkeypatch.setattr(tl_module, "_run_migration", lambda _engine: None)
    ledger = tl_module.TradeLedger()
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
