"""Evaluate the winning vwap params on an OOS window.

Reads ``audit-reports/phase1-vwap-tune.json`` for best_params, then re-runs
the engine on train (2023) + OOS (2024-H1) and writes the OOS metrics to
``audit-reports/phase1-vwap-oos.json``.

Usage::

    .venv/bin/python scripts/vwap_oos_eval.py
"""

from __future__ import annotations

import json
import logging
import sys
import types
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path


_ROOT = Path(__file__).resolve().parent.parent
for _p in (_ROOT, _ROOT / "backend"):
    ps = str(_p)
    if ps not in sys.path:
        sys.path.insert(0, ps)

if "backend.strategies" not in sys.modules:
    stub = types.ModuleType("backend.strategies")
    stub.__path__ = [str(_ROOT / "backend" / "strategies")]
    stub.__file__ = "(stub)"
    sys.modules["backend.strategies"] = stub
if "backend" not in sys.modules:
    b = types.ModuleType("backend")
    b.__path__ = [str(_ROOT / "backend")]
    b.__file__ = "(stub)"
    sys.modules["backend"] = b


import pandas as pd
import backend.strategies.vwap  # noqa: F401

from backend.backtest.engine import BacktestEngine, EngineConfig
from backend.data.providers.alpaca import AlpacaBarProvider
from backend.strategies.registry import get_strategy

log = logging.getLogger("vwap_oos")


def main() -> int:
    logging.basicConfig(
        level="INFO", format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    tune_path = _ROOT / "audit-reports" / "phase1-vwap-tune.json"
    if not tune_path.exists():
        log.error("tune file not found: %s", tune_path)
        return 1
    with tune_path.open() as f:
        tune = json.load(f)
    best_params = tune.get("tuner", {}).get("best_params") or tune.get("best_params")
    if not best_params:
        log.error("best_params missing in tune file")
        return 1

    # Coerce boolean stored as "false"/"true" string back to bool if needed.
    if isinstance(best_params.get("allow_shorts"), str):
        best_params["allow_shorts"] = (
            best_params["allow_shorts"].lower() == "true"
        )

    log.info("Running OOS eval with best_params=%s", best_params)

    cls = get_strategy("vwap")
    strat = cls()

    oos_start = date(2024, 1, 1)
    oos_end = date(2024, 6, 30)

    with AlpacaBarProvider() as bar_provider:
        engine = BacktestEngine(
            strategy=strat,
            bar_provider=bar_provider,
            config=EngineConfig(
                start=oos_start,
                end=oos_end,
                starting_cash=Decimal("100000"),
            ),
            strategy_params=best_params,
        )
        result = engine.run()

    metrics = dict(result.metrics)
    trades_closed = sum(1 for t in result.trades if t.is_closed)
    out = {
        "best_params": best_params,
        "start": str(oos_start),
        "end": str(oos_end),
        "metrics": metrics,
        "trades": trades_closed,
        "fills": len(result.fills),
    }
    if not result.equity_curve.empty:
        curve = result.equity_curve["equity"]
        out["start_equity"] = float(curve.iloc[0])
        out["end_equity"] = float(curve.iloc[-1])
        out["total_return"] = float(curve.iloc[-1]) / float(curve.iloc[0]) - 1.0

    report_dir = _ROOT / "audit-reports"
    report_dir.mkdir(exist_ok=True)
    out_path = report_dir / "phase1-vwap-oos.json"
    with out_path.open("w") as f:
        json.dump(out, f, indent=2, default=str)
    print(json.dumps(out, indent=2, default=str))
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
