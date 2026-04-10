"""Persistent trade ledger stored as JSON files.

Tracks all entries and exits from the automated pipeline, calculates
performance metrics, and provides open-position queries.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

LEDGER_PATH = Path(__file__).resolve().parent.parent / "pipeline_logs" / "ledger.json"

# File-level lock to prevent concurrent read/write corruption
_ledger_lock = threading.Lock()


def _ensure_dir() -> None:
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)


def _load() -> dict[str, Any]:
    _ensure_dir()
    if LEDGER_PATH.exists():
        try:
            return json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("Corrupt ledger file, starting fresh")
    return {"trades": [], "version": 1}


def _save(data: dict[str, Any]) -> None:
    _ensure_dir()
    tmp = LEDGER_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    tmp.replace(LEDGER_PATH)


class TradeLedger:
    """Persistent trade ledger stored as JSON files."""

    def __init__(self) -> None:
        self._data = _load()

    def _persist(self) -> None:
        with _ledger_lock:
            _save(self._data)

    # -----------------------------------------------------------------
    # Record keeping
    # -----------------------------------------------------------------

    def record_entry(
        self,
        symbol: str,
        shares: int,
        price: float,
        signal: dict[str, Any],
        rationale: str,
        strategy: str = "claude_alpha",
    ) -> dict[str, Any]:
        """Record a new position entry."""
        trade = {
            "id": len(self._data["trades"]) + 1,
            "symbol": symbol,
            "shares": shares,
            "entry_price": price,
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
        self._data["trades"].append(trade)
        self._persist()
        logger.info("Ledger: recorded ENTRY %s %d @ %.2f", symbol, shares, price)
        return trade

    def update_entry_price(self, symbol: str, new_price: float) -> bool:
        """Update entry_price for the most recent open trade of *symbol*.

        Called after an order fill to replace the pre-trade estimate with
        the actual fill price from the broker.  Returns True if a trade
        was updated, False otherwise.
        """
        # Walk backwards so we update the most recent open trade first
        for trade in reversed(self._data["trades"]):
            if trade["symbol"] == symbol and trade["status"] == "open":
                old = trade["entry_price"]
                trade["entry_price"] = new_price
                self._persist()
                logger.info(
                    "Ledger: updated entry price for %s: %.2f -> %.2f",
                    symbol, old, new_price,
                )
                return True
        logger.warning("Ledger: no open trade found for %s to update entry price", symbol)
        return False

    def record_exit(
        self,
        symbol: str,
        shares: int,
        price: float,
        reason: str,
    ) -> dict[str, Any] | None:
        """Record a position exit. Closes the oldest open trade for the symbol."""
        for trade in self._data["trades"]:
            if trade["symbol"] == symbol and trade["status"] == "open":
                trade["exit_price"] = price
                trade["exit_time"] = datetime.now(timezone.utc).isoformat()
                trade["exit_reason"] = reason
                trade["pnl"] = round((price - trade["entry_price"]) * trade["shares"], 2)
                trade["pnl_pct"] = round(
                    ((price - trade["entry_price"]) / trade["entry_price"]) * 100, 2
                )
                trade["status"] = "closed"
                self._persist()
                logger.info(
                    "Ledger: recorded EXIT %s %d @ %.2f  P&L=%.2f (%.1f%%)",
                    symbol, shares, price, trade["pnl"], trade["pnl_pct"],
                )
                return trade
        logger.warning("Ledger: no open trade found for %s to exit", symbol)
        return None

    # -----------------------------------------------------------------
    # Queries
    # -----------------------------------------------------------------

    def get_open_positions(self) -> list[dict[str, Any]]:
        """Return all currently open positions."""
        return [t for t in self._data["trades"] if t["status"] == "open"]

    def get_closed_trades(
        self,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> list[dict[str, Any]]:
        """Return closed trades, optionally filtered by date range."""
        closed = [t for t in self._data["trades"] if t["status"] == "closed"]
        if start_date:
            closed = [t for t in closed if t["exit_time"] and t["exit_time"] >= start_date]
        if end_date:
            closed = [t for t in closed if t["exit_time"] and t["exit_time"] <= end_date]
        return closed

    def get_performance_summary(self) -> dict[str, Any]:
        """Calculate total P&L, win rate, avg hold time, etc."""
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
        total_pnl = sum(t.get("pnl", 0) for t in closed)
        pnl_pcts = [t.get("pnl_pct", 0) for t in closed]

        best = max(closed, key=lambda t: t.get("pnl", 0))
        worst = min(closed, key=lambda t: t.get("pnl", 0))

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
        """Return set of symbols with open positions."""
        return {t["symbol"] for t in self.get_open_positions()}

    def get_position_strategy_map(self) -> dict[str, dict[str, Any]]:
        """Return ``{symbol: {strategy, notional, shares, ...}}`` for open positions."""
        result: dict[str, dict[str, Any]] = {}
        for t in self.get_open_positions():
            sym = t["symbol"]
            price = t.get("entry_price", 0)
            shares = t.get("shares", 0)
            result[sym] = {
                "strategy": t.get("strategy", "claude_alpha"),
                "notional": round(price * shares, 2) if price and shares else 0,
                "shares": shares,
                "entry_price": price,
            }
        return result

    def count_today_trades(self) -> int:
        """Count trades opened today (UTC)."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return sum(
            1
            for t in self._data["trades"]
            if t.get("entry_time", "").startswith(today)
        )
