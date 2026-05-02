#!/usr/bin/env python
"""Final OOS eval for VRP Harvest using the tuner-chosen parameters.

Reads the best_params from ``audit-reports/phase1-vrp_harvest-tune.json``
(or `--params` JSON file) and runs the strategy over the test window
(default 2023-01-03 → 2024-12-30) on real data. Writes a detailed
per-month P&L breakdown and drawdown event list plus a final metrics
summary to ``audit-reports/phase1-vrp_harvest-oos.json``.

Run from repo root::

    PYTHONPATH=. .venv/bin/python scripts/vrp_harvest_oos_eval.py
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import types
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pandas as pd


def _install_stubs() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    backend = repo_root / "backend"
    sp = str(repo_root)
    if sp not in sys.path:
        sys.path.insert(0, sp)
    if "backend" not in sys.modules:
        b = types.ModuleType("backend")
        b.__path__ = [str(backend)]
        b.__file__ = "(stub)"
        sys.modules["backend"] = b
    if "backend.strategies" not in sys.modules:
        s = types.ModuleType("backend.strategies")
        s.__path__ = [str(backend / "strategies")]
        s.__file__ = "(stub)"
        sys.modules["backend.strategies"] = s
        sys.modules["backend"].strategies = s


_install_stubs()

from backend.data.providers.alpaca import AlpacaBarProvider  # noqa: E402
from backend.strategies.vrp_harvest.provider import (  # noqa: E402
    BoundedPolygonOptionsProvider,
)
from backend.strategies.vrp_harvest.strategy import (  # noqa: E402
    VRPHarvestStrategy,
    _positions_map,
    _synth_trades,
    summary_from_equity,
    synthetic_equity_curve,
)
from scripts.oos_bootstrap import attach_bootstrap_ci, bootstrap_ci_from_equity_frame  # noqa: E402


def _monthly_pnl(curve: pd.DataFrame) -> list[dict[str, float]]:
    if curve.empty:
        return []
    eq = curve["equity"].astype(float)
    monthly_last = eq.resample("ME").last()
    rets = monthly_last.pct_change().dropna()
    rows = []
    for idx, r in rets.items():
        rows.append({"month": idx.strftime("%Y-%m"), "return_pct": float(r)})
    return rows


def _drawdown_events(curve: pd.DataFrame, min_drawdown: float = 0.02) -> list[dict[str, Any]]:
    if curve.empty:
        return []
    eq = curve["equity"].astype(float)
    peak = eq.cummax()
    dd = eq / peak - 1.0
    events: list[dict[str, Any]] = []
    in_dd = False
    start_idx = None
    trough = 0.0
    trough_idx = None
    for idx, v in dd.items():
        if v < 0 and not in_dd:
            in_dd = True
            start_idx = idx
            trough = float(v)
            trough_idx = idx
        elif in_dd:
            if float(v) < trough:
                trough = float(v)
                trough_idx = idx
            if v >= 0:
                if abs(trough) >= min_drawdown:
                    events.append(
                        {
                            "peak": start_idx.strftime("%Y-%m-%d"),
                            "trough": trough_idx.strftime("%Y-%m-%d") if trough_idx is not None else None,
                            "recovered": idx.strftime("%Y-%m-%d"),
                            "drawdown_pct": float(trough),
                        }
                    )
                in_dd = False
                trough = 0.0
    if in_dd and abs(trough) >= min_drawdown:
        events.append(
            {
                "peak": start_idx.strftime("%Y-%m-%d") if start_idx is not None else None,
                "trough": trough_idx.strftime("%Y-%m-%d") if trough_idx is not None else None,
                "recovered": None,
                "drawdown_pct": float(trough),
            }
        )
    return events


def main() -> int:
    parser = argparse.ArgumentParser(description="VRP Harvest OOS eval")
    parser.add_argument("--params-json", type=str, default="audit-reports/phase1-vrp_harvest-tune.json")
    parser.add_argument("--start", type=str, default="2023-07-03")
    parser.add_argument("--end", type=str, default="2024-12-30")
    parser.add_argument("--starting-cash", type=float, default=100_000.0)
    parser.add_argument("--out", type=str, default="audit-reports/phase1-vrp_harvest-oos.json")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()
    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    # Load params. Gracefully handle missing / unparseable files (we fall
    # back to defaults so the OOS eval always runs).
    params: dict[str, Any] = {}
    params_path = Path(args.params_json)
    if params_path.is_file():
        try:
            with open(params_path) as f:
                tune = json.load(f)
            params = dict(tune.get("best_params") or {})
            print(f"Loaded tuner best_params from {params_path}")
        except (json.JSONDecodeError, OSError):
            print(f"(params file {params_path} unreadable — falling back to defaults)")
    else:
        print(f"(params file {params_path} missing — falling back to defaults)")

    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)

    with AlpacaBarProvider() as bp, BoundedPolygonOptionsProvider() as op:
        strat = VRPHarvestStrategy()
        strat.configure(params)
        ctx = SimpleNamespace(
            asof=start,
            cash=Decimal(str(args.starting_cash)),
            equity=Decimal(str(args.starting_cash)),
            positions=[],
            bar_provider=bp,
            options_provider=op,
            earnings_provider=None,
            fundamentals_provider=None,
            calendar_provider=None,
            params={},
            state={},
        )
        sessions = [d.date() for d in pd.bdate_range(start=start, end=end)]
        for s in sessions:
            ctx.asof = s
            curve_tmp = synthetic_equity_curve(strat, ctx, [s], args.starting_cash)
            if not curve_tmp.empty:
                ctx.equity = Decimal(str(float(curve_tmp["equity"].iloc[-1])))
                ctx.cash = ctx.equity
            list(strat.manage(s, ctx))
            list(strat.generate_signals(s, ctx))
        curve = synthetic_equity_curve(strat, ctx, sessions, args.starting_cash)

    summary = summary_from_equity(curve, args.starting_cash)

    # Per-month P&L and drawdowns.
    monthly = _monthly_pnl(curve)
    dd_events = _drawdown_events(curve)

    # Trades / exit reason breakdown.
    positions = list(_positions_map(ctx.state).values())
    reasons: dict[str, int] = {}
    for p in positions:
        if p.exit_reason:
            reasons[p.exit_reason] = reasons.get(p.exit_reason, 0) + 1
    n_strangles = sum(1 for p in positions if "strangle" in p.tag)
    n_hedges = sum(1 for p in positions if "hedge" in p.tag)

    out = {
        "window": [args.start, args.end],
        "starting_cash": float(args.starting_cash),
        "params": params,
        "summary": summary,
        "n_sessions": len(curve),
        "n_strangles": n_strangles,
        "n_hedges": n_hedges,
        "exit_reasons": reasons,
        "monthly_pnl": monthly,
        "drawdown_events": dd_events,
        "n_synth_trades": len(_synth_trades(ctx.state)),
    }
    attach_bootstrap_ci(out, bootstrap_ci_from_equity_frame(curve))

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"Wrote {out_path}")
    print(f"OOS Sharpe       : {summary['sharpe']:.3f}")
    print(f"OOS Max DD       : {summary['max_drawdown'] * 100:.2f}%")
    print(f"OOS CAGR         : {summary['cagr'] * 100:.2f}%")
    print(f"OOS total return : {summary['total_return_pct'] * 100:+.2f}%")
    print(f"Final equity     : ${summary['final_equity']:,.2f}")
    print(f"Strangles opened : {n_strangles}")
    print(f"Hedges opened    : {n_hedges}")
    for r, c in sorted(reasons.items()):
        print(f"  {r:25s} : {c}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
