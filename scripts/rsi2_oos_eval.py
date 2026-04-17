"""Evaluate the winning rsi2_reversal parameters on the OOS window
(2023-2024) with the full suite of engine metrics.

Uses the in-memory bar provider for speed.
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


import pandas as pd
import backend.strategies.rsi2_reversal  # noqa: F401

from backend.backtest.engine import BacktestEngine, EngineConfig
from backend.data.providers.alpaca import AlpacaBarProvider
from backend.strategies.registry import get_strategy
from backend.strategies.rsi2_reversal.config import CORE_ETFS, LARGE_CAP_SEED

# Import the in-memory provider from the tuner script.
from scripts.rsi2_tune import InMemoryBarProvider


# Best parameters from trial 32 of the 80-trial TPE study.
BEST_PARAMS = {
    "rsi_period": 3,
    "rsi_entry_max": 6.5455937584805355,
    "connors_entry_max": 20.669660780676914,
    "trend_sma_period": 200,
    "stop_lookback_bars": 6,
    "time_stop_days": 10,
    "exit_sma_period": 3,
    "rsi_exit_min": 59.80019737917527,
    "max_positions": 8,
    "allocation_per_trade": 0.10929658241168426,
    "volume_surge_min": 1.7282241946483636,
    "spy_rsi_regime_floor": 15.795284945718572,
}


def main() -> int:
    # Prefetch wide bar frame.
    syms = sorted(set([*CORE_ETFS, *LARGE_CAP_SEED]))
    print(f"Prefetching {len(syms)} symbols")
    with AlpacaBarProvider() as p:
        df = p.bars(syms, date(2018, 7, 1), date(2025, 1, 31), tf="1D")
    print(f"Got {len(df)} rows")
    bar_provider = InMemoryBarProvider(df)

    cls = get_strategy("rsi2_reversal")
    strat = cls()

    engine = BacktestEngine(
        strategy=strat,
        bar_provider=bar_provider,
        config=EngineConfig(
            start=date(2023, 1, 1),
            end=date(2024, 12, 31),
            starting_cash=Decimal("100000"),
        ),
        strategy_params=BEST_PARAMS,
    )
    result = engine.run()

    print("=" * 70)
    print("RSI(2) Reversal — Final OOS Evaluation (2023-01-01 to 2024-12-31)")
    print("=" * 70)

    if not result.equity_curve.empty:
        start_eq = float(result.equity_curve["equity"].iloc[0])
        end_eq = float(result.equity_curve["equity"].iloc[-1])
        pct = (end_eq / start_eq - 1.0) * 100.0
        print(f"Equity: {start_eq:,.2f} -> {end_eq:,.2f}  ({pct:+.2f}%)")
    print(f"Round-trip trades: {sum(1 for t in result.trades if t.is_closed)}")
    print(f"Fills: {len(result.fills)}")
    print()
    print("Metrics:")
    for k in sorted(result.metrics):
        v = result.metrics[k]
        if isinstance(v, float):
            print(f"  {k:25s} = {v:.4f}")
        else:
            print(f"  {k:25s} = {v}")

    out_path = _ROOT / "audit-reports" / "phase1-rsi2_reversal-oos.json"
    payload = {
        "params": BEST_PARAMS,
        "start": "2023-01-01",
        "end": "2024-12-31",
        "metrics": result.metrics,
        "round_trip_trades": sum(1 for t in result.trades if t.is_closed),
        "fills": len(result.fills),
    }
    if not result.equity_curve.empty:
        payload["equity_start"] = float(result.equity_curve["equity"].iloc[0])
        payload["equity_end"] = float(result.equity_curve["equity"].iloc[-1])
    with out_path.open("w") as f:
        json.dump(payload, f, indent=2, default=str)
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
