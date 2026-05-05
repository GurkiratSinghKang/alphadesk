"""Closed-trade metrics — single source of truth.

Batch E (2026-05-05) — P1-17.

Before this module existed, two endpoints disagreed about the same
closed-trade reality:

* ``GET /api/v1/portfolio/performance`` — read the TradeLedger via
  ``ledger.get_closed_trades(...)`` and produced rich return / Sharpe /
  drawdown analytics on top of it.

* ``GET /api/v1/pipeline/summary`` — walked the ``data/pipeline_logs``
  JSON files (orders_placed counters and master_agent rejections) and
  produced an aggregate that had nothing to do with the trade ledger.

When the user-facing audit (persona-new-user, persona-day-trader) hit
both endpoints with five real closed trades sitting in the ledger, the
portfolio analytics page reported ``0 trades / $0 P&L`` while the
pipeline summary reported ``5 trades / +$853``. Same data, two paths,
two answers — the trust-killer the audit flagged as P1-17.

This helper consolidates closed-trade metrics into a single function
both endpoints call. The pipeline-log totals are still useful (they
describe the *pipeline run* — runs scheduled, decisions made by the
master agent, rejections by reason) so we don't tear them out; we just
make sure the closed-trade numbers in the response are computed from
the TradeLedger, not from log files.

Both endpoints MUST go through this helper for closed-trade aggregates
so the user can never see ``5/+$853`` on one screen and ``0/$0`` on
another. The unit test ``test_pipeline.py::test_closed_trade_metrics_*``
guards this invariant.
"""
from __future__ import annotations

import logging
from typing import Any, Iterable

logger = logging.getLogger(__name__)


def aggregate_closed_trades(closed_trades: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Reduce an iterable of closed trade dicts to a metrics summary.

    Pure function — no DB, no I/O. Both ``/portfolio/performance`` and
    ``/pipeline/summary`` pass the SAME ``TradeLedger.list({"status":
    "closed", ...})`` (or equivalent) result through this so the numbers
    they emit are byte-for-byte identical.

    The shape mirrors the fields each endpoint already exposes; if you
    add a new field here, both endpoints get it for free on the next
    deploy.
    """
    total = 0
    realized_pnl = 0.0
    wins = 0
    losses = 0
    scratches = 0
    best_pnl: float | None = None
    worst_pnl: float | None = None
    best_symbol: str | None = None
    worst_symbol: str | None = None

    for t in closed_trades:
        total += 1
        pnl = float(t.get("pnl") or 0)
        realized_pnl += pnl
        if pnl > 0:
            wins += 1
        elif pnl < 0:
            losses += 1
        else:
            scratches += 1
        if best_pnl is None or pnl > best_pnl:
            best_pnl = pnl
            best_symbol = t.get("symbol")
        if worst_pnl is None or pnl < worst_pnl:
            worst_pnl = pnl
            worst_symbol = t.get("symbol")

    decided = wins + losses
    win_rate = round(wins / decided * 100, 1) if decided else None

    return {
        "total_closed_trades": total,
        "realized_pnl": round(realized_pnl, 2),
        "wins": wins,
        "losses": losses,
        "scratches": scratches,
        "win_rate_pct": win_rate,
        "best_trade": (
            {"symbol": best_symbol, "pnl": round(best_pnl, 2)}
            if best_pnl is not None and best_symbol
            else None
        ),
        "worst_trade": (
            {"symbol": worst_symbol, "pnl": round(worst_pnl, 2)}
            if worst_pnl is not None and worst_symbol
            else None
        ),
    }


def closed_trade_metrics_for_strategy(
    strategy: str | None = None,
) -> dict[str, Any]:
    """Read closed trades from the ledger and return aggregated metrics.

    ``strategy`` — when provided, scopes the ledger query to that
    strategy (matches ``trade_ledger.strategy``). When ``None``, sums
    across every strategy (the desk-wide view used by ``/pipeline/
    summary``).

    On any TradeLedger failure we return zeroed metrics rather than
    raising — both consumers are read-only summary endpoints and the
    UI degrades gracefully on zero rows. We log at WARNING so a quiet
    DB outage still surfaces in observability.
    """
    try:
        from data.ingestion.trade_ledger import TradeLedger

        ledger = TradeLedger()
        filter_dict: dict[str, Any] = {"status": "closed"}
        if strategy:
            filter_dict["strategy"] = strategy
        closed = ledger.list(filter_dict)
    except Exception:
        logger.warning(
            "closed_trade_metrics_for_strategy: TradeLedger query failed; "
            "returning zeroed metrics so consumers degrade gracefully",
            exc_info=True,
        )
        closed = []

    return aggregate_closed_trades(closed)
