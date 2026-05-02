"""Evaluate the winning kama_breakout parameters on the OOS window
(2023-01-03 to 2024-12-30) with the full suite of engine metrics.

Reads the best params written by ``scripts/tune_kama.py`` from
``audit-reports/phase1-kama_breakout-tune.json``. Writes a
machine-readable summary to ``audit-reports/phase1-kama_breakout-oos.json``.
"""

from __future__ import annotations

import json
import sys
import types
from datetime import date
from decimal import Decimal
from pathlib import Path


_ROOT = Path(__file__).resolve().parent.parent
for _p in (_ROOT, _ROOT / "backend"):
    ps = str(_p)
    if ps not in sys.path:
        sys.path.insert(0, ps)

if "backend" not in sys.modules:
    b = types.ModuleType("backend")
    b.__path__ = [str(_ROOT / "backend")]
    b.__file__ = "(stub)"
    sys.modules["backend"] = b
if "backend.strategies" not in sys.modules:
    stub = types.ModuleType("backend.strategies")
    stub.__path__ = [str(_ROOT / "backend" / "strategies")]
    stub.__file__ = "(stub)"
    sys.modules["backend.strategies"] = stub


import pandas as pd  # noqa: E402
import backend.strategies.kama_breakout  # noqa: F401,E402

from backend.backtest.engine import BacktestEngine, EngineConfig  # noqa: E402
from backend.data.providers.alpaca import AlpacaBarProvider  # noqa: E402
from backend.strategies.kama_breakout.config import DEFAULT_UNIVERSE  # noqa: E402
from backend.strategies.registry import get_strategy  # noqa: E402
from scripts.oos_bootstrap import attach_bootstrap_ci, bootstrap_ci_from_equity_frame  # noqa: E402

# Reuse the in-memory bar provider from the tuner script.
from scripts.tune_kama import InMemoryBarProvider  # noqa: E402


def _load_best_params() -> dict:
    """Read best params from the tuner output JSON."""

    tune_path = _ROOT / "audit-reports" / "phase1-kama_breakout-tune.json"
    if not tune_path.exists():
        raise SystemExit(
            f"Tuner output not found at {tune_path}. Run scripts/tune_kama.py first."
        )
    with tune_path.open() as f:
        doc = json.load(f)
    best = doc.get("tuner", {}).get("best_params")
    if not best:
        raise SystemExit("No best_params found in tuner JSON.")
    return dict(best)


def main() -> int:
    best = _load_best_params()
    print("Loaded best params:")
    for k, v in sorted(best.items()):
        print(f"  {k:25s} = {v}")
    print()

    syms = sorted(set(DEFAULT_UNIVERSE))
    print(f"Prefetching {len(syms)} symbols for OOS eval")
    with AlpacaBarProvider() as p:
        df = p.bars(syms, date(2018, 4, 1), date(2025, 1, 31), tf="1D")
    print(f"Got {len(df)} rows")
    bar_provider = InMemoryBarProvider(df)

    cls = get_strategy("kama_breakout")
    strat = cls()

    engine = BacktestEngine(
        strategy=strat,
        bar_provider=bar_provider,
        config=EngineConfig(
            start=date(2023, 1, 3),
            end=date(2024, 12, 30),
            starting_cash=Decimal("100000"),
        ),
        strategy_params=best,
    )
    result = engine.run()

    print("=" * 72)
    print("KAMA Breakout — Final OOS Evaluation (2023-01-03 to 2024-12-30)")
    print("=" * 72)

    if not result.equity_curve.empty:
        start_eq = float(result.equity_curve["equity"].iloc[0])
        end_eq = float(result.equity_curve["equity"].iloc[-1])
        pct = (end_eq / start_eq - 1.0) * 100.0
        print(f"Equity: {start_eq:,.2f} -> {end_eq:,.2f}  ({pct:+.2f}%)")
    n_trades = sum(1 for t in result.trades if t.is_closed)
    print(f"Round-trip trades: {n_trades}")
    print(f"Fills: {len(result.fills)}")
    print()
    print("Metrics:")
    for k in sorted(result.metrics):
        v = result.metrics[k]
        if isinstance(v, float):
            print(f"  {k:25s} = {v:.4f}")
        else:
            print(f"  {k:25s} = {v}")

    # Fill breakdown by tag
    tag_counts: dict[str, int] = {}
    for f in result.fills:
        tag = f.tag or "<none>"
        # Simplify entry tags that carry ER
        if tag.startswith("entry"):
            tag = "entry"
        tag_counts[tag] = tag_counts.get(tag, 0) + 1
    print("\nFill tag breakdown:")
    for tag, n in sorted(tag_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {tag:25s} = {n}")

    out_path = _ROOT / "audit-reports" / "phase1-kama_breakout-oos.json"
    payload = {
        "params": best,
        "start": "2023-01-03",
        "end": "2024-12-30",
        "metrics": result.metrics,
        "round_trip_trades": n_trades,
        "fills": len(result.fills),
        "fill_tag_counts": tag_counts,
    }
    if not result.equity_curve.empty:
        payload["equity_start"] = float(result.equity_curve["equity"].iloc[0])
        payload["equity_end"] = float(result.equity_curve["equity"].iloc[-1])
        payload["total_return"] = (
            payload["equity_end"] / payload["equity_start"] - 1.0
        )
    attach_bootstrap_ci(payload, bootstrap_ci_from_equity_frame(result.equity_curve))
    with out_path.open("w") as f:
        json.dump(payload, f, indent=2, default=str)
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
