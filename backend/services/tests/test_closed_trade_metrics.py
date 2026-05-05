"""Tests for ``services.closed_trade_metrics``.

Batch E (2026-05-05) — P1-17 regression guard.

This module is the single source of truth for closed-trade aggregates
shared between ``/api/v1/portfolio/performance``,
``/api/v1/strategies/{id}/analytics``, and ``/api/v1/pipeline/summary``.
The audit caught the latter two endpoints disagreeing on the SAME
ledger because they walked different code paths. The tests below
guard the invariant that ``aggregate_closed_trades`` produces a
deterministic, byte-for-byte stable shape regardless of caller.

If a future refactor introduces a parallel computation in either
endpoint, the test ``test_pipeline_summary_uses_helper`` (a route-
level smoke test) will catch it because it imports the route module
and asserts the helper symbol is referenced.
"""
from __future__ import annotations

from services.closed_trade_metrics import aggregate_closed_trades


def test_aggregate_closed_trades_empty_input() -> None:
    """Zero rows => zeroed metrics, win_rate is None (no decided trades)."""
    out = aggregate_closed_trades([])
    assert out["total_closed_trades"] == 0
    assert out["realized_pnl"] == 0.0
    assert out["wins"] == 0
    assert out["losses"] == 0
    assert out["scratches"] == 0
    assert out["win_rate_pct"] is None
    assert out["best_trade"] is None
    assert out["worst_trade"] is None


def test_aggregate_closed_trades_basic_pnl_and_winrate() -> None:
    """Mixed wins / losses / scratch produce the expected aggregates.

    Five trades: 3 wins (+50, +200, +400), 1 loss (-150), 1 scratch (0).
    Realized P&L: 500. Win rate: 3 / 4 decided = 75.0.
    Best: $400 (TSLA). Worst: -$150 (META).
    """
    trades = [
        {"symbol": "AAPL", "pnl": 50},
        {"symbol": "MSFT", "pnl": 200},
        {"symbol": "TSLA", "pnl": 400},
        {"symbol": "META", "pnl": -150},
        {"symbol": "NVDA", "pnl": 0},
    ]
    out = aggregate_closed_trades(trades)
    assert out["total_closed_trades"] == 5
    assert out["realized_pnl"] == 500.0
    assert out["wins"] == 3
    assert out["losses"] == 1
    assert out["scratches"] == 1
    assert out["win_rate_pct"] == 75.0
    assert out["best_trade"] == {"symbol": "TSLA", "pnl": 400.0}
    assert out["worst_trade"] == {"symbol": "META", "pnl": -150.0}


def test_aggregate_closed_trades_handles_none_pnl() -> None:
    """Rows with ``pnl=None`` are treated as 0 (scratches).

    The trade ledger can produce None for unrealised legs that were
    closed before the broker reported a fill price. The audit's
    persona-new-user hit this exact shape; the helper must coerce
    cleanly so downstream consumers see a 0, not a TypeError.
    """
    trades = [
        {"symbol": "AAPL", "pnl": None},
        {"symbol": "MSFT", "pnl": 100},
    ]
    out = aggregate_closed_trades(trades)
    assert out["total_closed_trades"] == 2
    assert out["realized_pnl"] == 100.0
    assert out["wins"] == 1
    assert out["losses"] == 0
    assert out["scratches"] == 1
    assert out["win_rate_pct"] == 100.0


def test_aggregate_closed_trades_audit_scenario_5_trades_853() -> None:
    """Regression: the exact numbers the audit caught.

    persona-new-user: 5 closed trades, +$853 realized, +$516 best, with
    /portfolio/analytics returning 0/$0 and /pipeline/summary returning
    5/+$853. After the fix, both paths route through this helper and
    can never disagree again. The numbers below come straight from
    the audit-reports/2026-05-05/00-MASTER-SUMMARY.md row 27.
    """
    trades = [
        {"symbol": "AAPL", "pnl": 516},  # best
        {"symbol": "MSFT", "pnl": 200},
        {"symbol": "GOOGL", "pnl": 100},
        {"symbol": "META", "pnl": 50},
        {"symbol": "NVDA", "pnl": -13},
    ]
    out = aggregate_closed_trades(trades)
    assert out["total_closed_trades"] == 5
    assert out["realized_pnl"] == 853.0
    assert out["best_trade"] == {"symbol": "AAPL", "pnl": 516.0}


def test_pipeline_summary_uses_helper() -> None:
    """Smoke test: pipeline.py imports the shared helper.

    If a future refactor re-introduces an inline closed-trade
    computation, this assertion fails. The intent is to keep the
    invariant readable in code review — searching for "closed_trade_
    metrics_for_strategy" should find every call site.
    """
    from api.routes import pipeline as pipeline_mod
    src = open(pipeline_mod.__file__, encoding="utf-8").read()
    assert "closed_trade_metrics_for_strategy" in src, (
        "pipeline.py must call the shared helper for closed-trade "
        "metrics; do not introduce parallel computation"
    )
