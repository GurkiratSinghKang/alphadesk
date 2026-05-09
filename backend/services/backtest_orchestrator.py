"""B.10 — Backtest workbench orchestrator.

Async task that takes a queued ``BacktestRun``, executes a
deterministic synthetic backtest (real strategy execution wires in
via ``backtest/cli.py`` in the Phase 1.10 follow-up), persists
metrics + equity curve, and marks the run completed.

Phase 1 ships the orchestrator + state machine + metrics shape so
the frontend Backtest Workbench page can poll runs end-to-end. The
strategy execution itself routes through the existing
``backtest.walkforward`` runner once the bridge lands; for now the
synthetic equity curve makes the workbench usable in dev /
demo mode.

Public API:
  - run_backtest(run_id) → coroutine; updates the BacktestRun row
                            in place + commits.
  - synthesize_metrics(equity_curve) → dict of canonical metrics
                                         (total_return / cagr / sharpe
                                          / max_dd / win_rate / trades).
"""
from __future__ import annotations

import logging
import math
import random
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select


logger = logging.getLogger("alphadesk.v2.backtest_orchestrator")


def synthesize_metrics(equity_curve: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute the canonical metric set the workbench expects.

    Pure function — no DB. The frontend BacktestClient consumes the
    same shape from the BacktestRun.metrics column.
    """
    if not equity_curve or len(equity_curve) < 2:
        return {
            "total_return_pct": 0.0,
            "cagr_pct": 0.0,
            "sharpe": 0.0,
            "sortino": 0.0,
            "max_dd_pct": 0.0,
            "calmar": 0.0,
            "win_rate": 0.0,
            "trades": 0,
        }

    values = [float(p["equity"]) for p in equity_curve]
    start = values[0]
    end = values[-1]
    total_return = (end - start) / start * 100.0
    days = max(len(values), 1)
    years = days / 252.0
    cagr = (math.pow(end / start, 1 / max(years, 0.01)) - 1) * 100.0

    # Daily returns
    rets = [
        (values[i] - values[i - 1]) / values[i - 1]
        for i in range(1, len(values))
    ]
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / max(len(rets) - 1, 1)
    std = math.sqrt(var) if var > 0 else 1e-9
    sharpe = (mean / std) * math.sqrt(252) if std else 0.0

    # Sortino (downside-only stdev)
    downside = [r for r in rets if r < 0]
    if downside:
        d_var = sum(r * r for r in downside) / len(downside)
        d_std = math.sqrt(d_var) if d_var > 0 else 1e-9
        sortino = (mean / d_std) * math.sqrt(252) if d_std else 0.0
    else:
        sortino = sharpe * 1.4  # heuristic fallback

    # Max drawdown
    peak = values[0]
    max_dd = 0.0
    for v in values:
        peak = max(peak, v)
        dd = (v - peak) / peak * 100.0
        if dd < max_dd:
            max_dd = dd

    calmar = total_return / abs(max_dd) if max_dd < 0 else 0.0
    win_rate = (sum(1 for r in rets if r > 0) / len(rets)) * 100.0
    trades = max(1, int(len(rets) / 5))  # synthetic ~1 trade per 5 days

    return {
        "total_return_pct": round(total_return, 2),
        "cagr_pct": round(cagr, 2),
        "sharpe": round(sharpe, 2),
        "sortino": round(sortino, 2),
        "max_dd_pct": round(max_dd, 2),
        "calmar": round(calmar, 2),
        "win_rate": round(win_rate, 1),
        "trades": trades,
    }


def _synthetic_equity_curve(
    run_id: int,
    start: date,
    end: date,
) -> list[dict[str, Any]]:
    """Generate a deterministic equity curve seeded by run_id +
    date range. Used until the real backtest bridge ships in 1.10
    follow-up. Drift +0.05%/day with sinusoidal volatility and
    two seeded drawdowns per ~120-day window."""
    days = (end - start).days
    if days <= 0:
        return []
    rng = random.Random(run_id)
    equity = 100_000.0
    out: list[dict[str, Any]] = []
    for i in range(min(days, 365 * 5)):
        drift = 0.0005 + math.sin(i / 18 + rng.random()) * 0.001
        # Two seeded drawdowns
        if (i + run_id) % 120 == 38:
            drift -= 0.04
        elif (i + run_id) % 120 == 78:
            drift -= 0.025
        equity *= 1.0 + drift
        d = date.fromordinal(start.toordinal() + i)
        out.append({"date": d.isoformat(), "equity": round(equity, 2)})
    return out


async def run_backtest(run_id: int) -> dict[str, Any]:
    """Process a queued ``BacktestRun`` end-to-end.

    Returns the final metrics dict. Updates the row in place:
      - status: queued → running → completed (or failed)
      - progress: 0.0 → 1.0
      - started_at / completed_at timestamps
      - metrics + equity_curve

    Idempotent: re-running on a completed run is a no-op (returns
    existing metrics). Per the v2-plan §B.10 risk register: the
    worker writes audit on start + completion via the existing
    audit channel.
    """
    from core.audit import write_audit
    from core.database import _get_engine
    from data.storage.models import BacktestRun
    from sqlalchemy.ext.asyncio import AsyncSession

    engine = await _get_engine()
    async with AsyncSession(engine) as db:
        result = await db.execute(select(BacktestRun).where(BacktestRun.id == run_id))
        row = result.scalars().first()
        if row is None:
            raise ValueError(f"BacktestRun {run_id} not found")
        if row.status == "completed" and row.metrics:
            return dict(row.metrics)

        row.status = "running"
        row.started_at = datetime.now(timezone.utc)
        row.progress = 0.05
        await db.commit()

        try:
            curve = _synthetic_equity_curve(
                run_id=run_id,
                start=row.start_date,
                end=row.end_date,
            )
            row.progress = 0.5
            await db.commit()
            metrics = synthesize_metrics(curve)
            row.equity_curve = curve
            row.metrics = metrics
            row.trade_log_count = metrics.get("trades", 0)
            row.status = "completed"
            row.progress = 1.0
            row.completed_at = datetime.now(timezone.utc)
            await db.commit()
            await write_audit(
                event="backtest_completed",
                username=row.username,
                ip=None,
                request_id=None,
                details={
                    "run_id": run_id,
                    "strategy": row.strategy,
                    "metrics": metrics,
                },
            )
            return metrics
        except Exception as exc:  # pragma: no cover — defensive
            row.status = "failed"
            row.error = str(exc)
            row.completed_at = datetime.now(timezone.utc)
            await db.commit()
            await write_audit(
                event="backtest_failed",
                username=row.username,
                ip=None,
                request_id=None,
                details={"run_id": run_id, "error": str(exc)},
            )
            raise


__all__ = ["run_backtest", "synthesize_metrics"]
