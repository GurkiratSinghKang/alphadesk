"""Smoke-test the vwap strategy against real Alpaca data.

Runs a ~2-week backtest (default 2024-06-03 to 2024-06-14) on the 10-name
universe using real Alpaca 5-min bars and prints top-level metrics.

Usage::

    .venv/bin/python scripts/smoke_vwap.py [start YYYY-MM-DD] [end YYYY-MM-DD]

Requires ``.env`` with ``ALPACA_API_KEY`` + ``ALPACA_SECRET_KEY`` set.
"""

from __future__ import annotations

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

# Stub backend.strategies to bypass the broken legacy __init__.py.
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


import backend.strategies.vwap  # noqa: F401 - registers the strategy

from backend.backtest.engine import BacktestEngine, EngineConfig
from backend.data.providers.alpaca import AlpacaBarProvider
from backend.strategies.registry import get_strategy


def main() -> int:
    cls = get_strategy("vwap")
    strat = cls()

    start_arg = sys.argv[1] if len(sys.argv) > 1 else "2024-06-03"
    end_arg = sys.argv[2] if len(sys.argv) > 2 else "2024-06-14"
    y, m, d = start_arg.split("-")
    start_d = date(int(y), int(m), int(d))
    y, m, d = end_arg.split("-")
    end_d = date(int(y), int(m), int(d))

    print(f"Running vwap smoke {start_d} -> {end_d} ...")
    with AlpacaBarProvider() as bar_provider:
        engine = BacktestEngine(
            strategy=strat,
            bar_provider=bar_provider,
            config=EngineConfig(
                start=start_d,
                end=end_d,
                starting_cash=Decimal("100000"),
            ),
        )
        result = engine.run()

    print("=" * 70)
    print("VWAP Session Pullback — Smoke Test")
    print("=" * 70)
    print(f"Period:            {result.start} -> {result.end}")
    print(f"Bars evaluated:    {len(result.equity_curve)}")
    print(f"Fills:             {len(result.fills)}")
    print(
        f"Round-trip trades: "
        f"{sum(1 for t in result.trades if t.is_closed)}"
    )
    if not result.equity_curve.empty:
        start_eq = float(result.equity_curve["equity"].iloc[0])
        end_eq = float(result.equity_curve["equity"].iloc[-1])
        pct = (end_eq / start_eq - 1.0) * 100.0
        print(f"Equity start:      {start_eq:,.2f}")
        print(f"Equity end:        {end_eq:,.2f}  ({pct:+.2f}%)")
    print()
    print("Metrics:")
    if result.metrics:
        width = max(len(k) for k in result.metrics)
        for k in sorted(result.metrics):
            v = result.metrics[k]
            if isinstance(v, float):
                print(f"  {k.ljust(width)} = {v:.4f}")
            else:
                print(f"  {k.ljust(width)} = {v}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
