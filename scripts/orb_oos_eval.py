"""Evaluate the winning ORB parameters on the OOS window (2023-2024).

Pulls the best params from ``audit-reports/phase1-orb-tune.json``, runs the
full OOS backtest via the custom ORB harness, and writes both a JSON
summary and a print-friendly breakdown.
"""

from __future__ import annotations

import json
import sys
import types
from datetime import date
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


import backend.strategies.orb  # noqa: F401

from backend.data.providers.alpaca import AlpacaBarProvider
from backend.strategies.orb.strategy import ORBStrategy
from backend.strategies.orb.config import UNIVERSE_PROFILES
from scripts.oos_bootstrap import attach_bootstrap_ci, bootstrap_ci_from_equity_frame
from scripts.smoke_orb import InMemoryIntradayProvider, run_orb_backtest


TUNE_PATH = _ROOT / "audit-reports" / "phase1-orb-tune.json"


def main() -> int:
    if not TUNE_PATH.exists():
        print(f"missing {TUNE_PATH}. run scripts/tune_orb.py first.")
        return 1
    with TUNE_PATH.open() as f:
        tune = json.load(f)
    best = tune["best_params"]
    print("Best params:", json.dumps(best, indent=2))

    # Prefetch OOS data only (2023-2024). Use the *biggest* universe we might
    # touch so the cache is shared regardless of the profile in best_params.
    syms = sorted({*UNIVERSE_PROFILES["all_leveraged"]})
    print(f"Prefetching {syms} 1Min bars 2023-01-01 -> 2024-12-31")
    with AlpacaBarProvider() as p:
        df = p.bars(syms, "2023-01-01", "2024-12-31", tf="1Min")
    print(f"Got {len(df)} rows")
    provider = InMemoryIntradayProvider(df)

    strat = ORBStrategy()
    strat.configure(best)
    result = run_orb_backtest(
        strat,
        provider,
        start=date(2023, 1, 1),
        end=date(2024, 12, 31),
        starting_cash=100_000.0,
    )
    metrics = result["metrics"]
    trades = [t for t in result["trades"] if t.direction is not None]

    # Breakdown by year
    eq = result["equity_curve"].copy()
    eq["year"] = eq.index.year
    by_year = (
        eq.groupby("year")
        .agg(
            equity_end=("equity", "last"),
            equity_start=("equity", "first"),
            trading_days=("day_return", "count"),
            active_days=("day_return", lambda s: (s != 0).sum()),
            year_return=(
                "day_return",
                lambda s: (1 + s).prod() - 1,
            ),
        )
        .reset_index()
    )

    print("=" * 70)
    print("ORB — Final OOS Evaluation (2023-01-01 -> 2024-12-31)")
    print("=" * 70)
    print(f"Entries:        {len(trades)}")
    print(
        f"Equity:         {eq['equity'].iloc[0]:,.2f} -> "
        f"{eq['equity'].iloc[-1]:,.2f} "
        f"({(eq['equity'].iloc[-1] / eq['equity'].iloc[0] - 1) * 100:+.2f}%)"
    )
    print()
    print("Metrics:")
    w = max(len(k) for k in metrics) if metrics else 1
    for k in sorted(metrics):
        v = metrics[k]
        if isinstance(v, float):
            print(f"  {k.ljust(w)} = {v:.4f}")
        else:
            print(f"  {k.ljust(w)} = {v}")
    print()
    print("By year:")
    print(by_year.to_string(index=False))

    # Direction & exit-reason breakdown
    dir_counts: dict[str, int] = {}
    reason_counts: dict[str, int] = {}
    for t in trades:
        dir_counts[t.direction or "none"] = dir_counts.get(t.direction or "none", 0) + 1
        reason_counts[t.exit_reason] = reason_counts.get(t.exit_reason, 0) + 1
    print()
    print("Direction breakdown:", dir_counts)
    print("Exit-reason breakdown:", reason_counts)

    # Write the JSON summary the spec asks for.
    payload = {
        "params": best,
        "start": "2023-01-01",
        "end": "2024-12-31",
        "metrics": metrics,
        "entries": len(trades),
        "equity_start": float(eq["equity"].iloc[0]) if not eq.empty else 0.0,
        "equity_end": float(eq["equity"].iloc[-1]) if not eq.empty else 0.0,
        "direction_counts": dir_counts,
        "exit_reason_counts": reason_counts,
        "by_year": by_year.to_dict(orient="records"),
    }
    attach_bootstrap_ci(
        payload,
        bootstrap_ci_from_equity_frame(eq, return_col="day_return"),
    )
    out = _ROOT / "audit-reports" / "phase1-orb-oos.json"
    with out.open("w") as f:
        json.dump(payload, f, indent=2, default=str)
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
