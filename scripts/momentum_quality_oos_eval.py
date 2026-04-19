#!/usr/bin/env python
"""Evaluate winning momentum_quality parameters on OOS 2023-2024.

Writes a machine-readable JSON summary to
``audit-reports/phase1-momentum_quality-oos.json`` with the full metric
sweep. Uses the in-memory bar provider for speed — OOS metrics identical
to a live Alpaca run because both pull from the same @cached parquet cache
after the first call.
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


import backend.strategies.momentum_quality  # noqa: F401,E402

from backend.backtest.engine import BacktestEngine, EngineConfig  # noqa: E402
from backend.data.providers.alpaca import AlpacaBarProvider  # noqa: E402
from backend.data.providers.fmp import (  # noqa: E402
    FMPEarningsProvider,
    FMPFundamentalsProvider,
)
from backend.strategies.momentum_quality.config import UNIVERSE_SEED  # noqa: E402
from backend.strategies.registry import get_strategy  # noqa: E402
from scripts.tune_momentum_quality import InMemoryBarProvider  # noqa: E402


# Winning parameters from the 25-trial Optuna TPE study (trial 8,
# OOS Sharpe 2.1854 on train 2019-2022 / test 2023-2024).
BEST_PARAMS = {
    "momentum_lookback_m": 12,
    "momentum_skip_m": 0,
    "quality_weight": 0.31590058116550723,
    "top_n": 15,
    "rebalance_freq": "monthly",
    "min_f_score": 7,
    "momentum_filter_min": 0.05393422419156507,
}


def main() -> int:
    # P1 fix: prefetch SPY alongside the universe so the benchmark series
    # is available when EngineConfig(benchmark="SPY") tries to compute
    # alpha/beta. Without SPY in the InMemoryBarProvider, metrics.summary_dict
    # silently writes alpha=0.0 beta=0.0 (see expert-momentum-quality.md §P1).
    syms = sorted(set(UNIVERSE_SEED) | {"SPY"})
    print(f"Prefetching {len(syms)} symbols (incl. SPY benchmark) 2018-01-02 → 2024-12-31 ...")
    with AlpacaBarProvider() as p:
        df = p.bars(syms, date(2018, 1, 2), date(2024, 12, 31), tf="1D")
    print(f"Got {len(df)} rows")
    bar_provider = InMemoryBarProvider(df)

    fundamentals = FMPFundamentalsProvider()
    earnings = FMPEarningsProvider()

    cls = get_strategy("momentum_quality")
    strat = cls()

    engine = BacktestEngine(
        strategy=strat,
        bar_provider=bar_provider,
        fundamentals_provider=fundamentals,
        earnings_provider=earnings,
        config=EngineConfig(
            start=date(2023, 1, 2),
            end=date(2024, 12, 30),
            starting_cash=Decimal("100000"),
            # P1 fix: pass benchmark so alpha/beta are computed. Previously
            # omitted, so the OOS artefact reported alpha=0, beta=0 silently.
            benchmark="SPY",
        ),
        strategy_params=BEST_PARAMS,
    )
    result = engine.run()

    print("=" * 70)
    print("Momentum + Quality — OOS Evaluation (2023-01-02 → 2024-12-30)")
    print("=" * 70)
    if not result.equity_curve.empty:
        start_eq = float(result.equity_curve["equity"].iloc[0])
        end_eq = float(result.equity_curve["equity"].iloc[-1])
        pct = (end_eq / start_eq - 1.0) * 100.0
        print(f"Equity: {start_eq:,.2f} -> {end_eq:,.2f}  ({pct:+.2f}%)")
    print(f"Fills: {len(result.fills)}")
    print(f"Round-trip trades: {sum(1 for t in result.trades if t.is_closed)}")
    print()
    print("Metrics:")
    for k in sorted(result.metrics):
        v = result.metrics[k]
        if isinstance(v, float):
            print(f"  {k:22s} = {v:.4f}")
        else:
            print(f"  {k:22s} = {v}")

    out = {
        "params": BEST_PARAMS,
        "start": "2023-01-02",
        "end": "2024-12-30",
        "metrics": result.metrics,
        "round_trip_trades": sum(1 for t in result.trades if t.is_closed),
        "fills": len(result.fills),
    }
    if not result.equity_curve.empty:
        out["equity_start"] = float(result.equity_curve["equity"].iloc[0])
        out["equity_end"] = float(result.equity_curve["equity"].iloc[-1])
        out["total_return"] = (
            float(result.equity_curve["equity"].iloc[-1])
            / float(result.equity_curve["equity"].iloc[0])
            - 1.0
        )
    out_path = _ROOT / "audit-reports" / "phase1-momentum_quality-oos.json"
    with out_path.open("w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
