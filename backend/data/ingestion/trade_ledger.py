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
                trade["pnl"] = round((price - trade["entry_price"]) * shares, 2)
                trade["shares"] = shares  # reflect actual exited quantity
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

    def sync_with_alpaca(self, alpaca_positions: list[dict[str, Any]]) -> dict[str, Any]:
        """Sync ledger state with live Alpaca positions.

        1. Untracked Alpaca positions -> create new ledger entries (manual-discretionary).
        2. Share mismatches (e.g. pipeline ran twice) -> update ledger shares.
        3. Ledger open trades whose symbol is absent from Alpaca -> mark closed.

        Returns a summary dict of what changed.
        """
        alpaca_by_sym: dict[str, dict[str, Any]] = {}
        for pos in alpaca_positions:
            sym = pos.get("symbol", "")
            if sym:
                alpaca_by_sym[sym] = pos

        created: list[str] = []
        updated: list[str] = []
        closed: list[str] = []

        open_syms_in_ledger: set[str] = set()

        for trade in self._data["trades"]:
            if trade["status"] != "open":
                continue
            sym = trade["symbol"]
            open_syms_in_ledger.add(sym)

            if sym in alpaca_by_sym:
                alpaca_qty = int(float(alpaca_by_sym[sym].get("qty", 0)))
                if trade["shares"] != alpaca_qty and alpaca_qty > 0:
                    logger.info(
                        "Ledger sync: updating %s shares %d -> %d",
                        sym, trade["shares"], alpaca_qty,
                    )
                    trade["shares"] = alpaca_qty
                    updated.append(sym)
            else:
                # Position no longer exists on Alpaca -- mark closed
                trade["status"] = "closed"
                trade["exit_time"] = datetime.now(timezone.utc).isoformat()
                trade["exit_reason"] = "alpaca_sync_closed"
                closed.append(sym)
                logger.info("Ledger sync: closed %s (not on Alpaca)", sym)

        # Create ledger entries for Alpaca positions not in the ledger
        for sym, pos in alpaca_by_sym.items():
            if sym not in open_syms_in_ledger:
                avg_price = float(pos.get("avg_entry_price", 0))
                qty = int(float(pos.get("qty", 0)))
                if qty <= 0:
                    continue

                # Try to match to a recent pipeline trade by symbol
                # instead of defaulting to "manual"
                matched_strategy = self._match_strategy_for_symbol(sym)

                trade = {
                    "id": len(self._data["trades"]) + 1,
                    "symbol": sym,
                    "shares": qty,
                    "entry_price": avg_price,
                    "entry_time": datetime.now(timezone.utc).isoformat(),
                    "stop_loss": None,
                    "take_profit": None,
                    "conviction": 0,
                    "rationale": f"Auto-created by Alpaca sync (matched to {matched_strategy})",
                    "strategy": matched_strategy,
                    "status": "open",
                    "exit_price": None,
                    "exit_time": None,
                    "exit_reason": None,
                    "pnl": None,
                    "pnl_pct": None,
                }
                self._data["trades"].append(trade)
                created.append(sym)
                logger.info(
                    "Ledger sync: created entry for %s (%d shares @ %.2f, strategy=%s)",
                    sym, qty, avg_price, matched_strategy,
                )

        if created or updated or closed:
            self._persist()

        summary = {
            "created": created,
            "updated": updated,
            "closed": closed,
        }
        logger.info("Ledger sync complete: %s", summary)
        return summary

    def _match_strategy_for_symbol(self, symbol: str) -> str:
        """Try to match an untracked Alpaca position to its originating strategy.

        Searches the last 50 trades for the same symbol to inherit the
        strategy name from a recent pipeline trade. Last resort: "manual".
        """
        # 1. Check recent trades (last 50) for same symbol
        recent = self._data["trades"][-50:]
        for trade in reversed(recent):
            if trade["symbol"] == symbol and trade.get("strategy", "manual") != "manual":
                logger.info(
                    "Matched %s to strategy '%s' from recent trade #%d",
                    symbol, trade["strategy"], trade.get("id", 0),
                )
                return trade["strategy"]

        # 2. No match found
        logger.warning(
            "No strategy match found for %s — defaulting to 'manual'",
            symbol,
        )
        return "manual"

    def count_today_trades(self) -> int:
        """Count trades opened today (UTC)."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return sum(
            1
            for t in self._data["trades"]
            if t.get("entry_time", "").startswith(today)
        )

    def get_strategy_performance(self) -> dict[str, dict[str, Any]]:
        """Get per-strategy P&L breakdown for the competition leaderboard."""
        perf: dict[str, dict[str, Any]] = {}
        for trade in self._data["trades"]:
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

        # Compute win rates
        for p in perf.values():
            closed = p["closed_trades"]
            p["win_rate"] = round(p["wins"] / closed * 100, 1) if closed > 0 else 0.0
            p["total_pnl"] = round(p["total_pnl"], 2)
            p["return_pct"] = round(
                (p["total_pnl"] / p["total_invested"] * 100) if p["total_invested"] > 0 else 0, 2
            )

        return perf
