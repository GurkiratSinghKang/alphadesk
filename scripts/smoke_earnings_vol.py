"""Smoke-test the earnings_vol strategy against real Polygon + FMP + Alpaca data.

Runs a short backtest (default: 2024-04-01 -> 2024-06-30 — Q1 earnings
season) and prints the equity curve summary, trade count, and the top-level
metrics. If everything is wired correctly we expect on the order of ~20-40
candidate earnings events in the 30-name universe over a quarter, and
~10-20 actually traded after the richness + timing filters.

Usage::

    .venv/bin/python scripts/smoke_earnings_vol.py [start] [end]
    # defaults to 2024-04-01 2024-06-30

Requires ``.env`` with ALPACA + POLYGON + FMP keys set.
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


import backend.strategies.earnings_vol  # noqa: F401 - registers the strategy

from backend.backtest.engine import BacktestEngine, EngineConfig
from backend.data.providers.alpaca import AlpacaBarProvider
from backend.data.providers.fmp_earnings import FMPEarningsProvider
from backend.data.providers.polygon_options import PolygonOptionsProvider
from backend.strategies.earnings_vol.polygon_helpers import (
    SyntheticBarProvider,
    clear_synthetic_ledger,
)
from backend.strategies.registry import get_strategy


def main() -> int:
    cls = get_strategy("earnings_vol")
    strat = cls()

    start_arg = sys.argv[1] if len(sys.argv) > 1 else "2024-04-01"
    end_arg = sys.argv[2] if len(sys.argv) > 2 else "2024-06-30"
    y, m, d = start_arg.split("-")
    start_d = date(int(y), int(m), int(d))
    y, m, d = end_arg.split("-")
    end_d = date(int(y), int(m), int(d))

    print(f"Running earnings_vol smoke {start_d} -> {end_d} ...")
    clear_synthetic_ledger()
    with (
        AlpacaBarProvider() as alp,
        PolygonOptionsProvider() as opts,
        FMPEarningsProvider() as earnings,
    ):
        bars = SyntheticBarProvider(alp)
        engine = BacktestEngine(
            strategy=strat,
            bar_provider=bars,
            options_provider=opts,
            earnings_provider=earnings,
            config=EngineConfig(
                start=start_d,
                end=end_d,
                starting_cash=Decimal("100000"),
            ),
        )
        result = engine.run()

    print("=" * 70)
    print("Earnings Volatility Short Iron Butterfly — Smoke Test")
    print("=" * 70)
    print(f"Period:          {result.start} -> {result.end}")
    print(f"Bars evaluated:  {len(result.equity_curve)}")
    print(f"Fills:           {len(result.fills)}")
    print(f"Round-trip trades: "
          f"{sum(1 for t in result.trades if t.is_closed)}")
    if not result.equity_curve.empty:
        start_eq = float(result.equity_curve["equity"].iloc[0])
        end_eq = float(result.equity_curve["equity"].iloc[-1])
        pct = (end_eq / start_eq - 1.0) * 100.0
        print(f"Equity start:    {start_eq:,.2f}")
        print(f"Equity end:      {end_eq:,.2f}  ({pct:+.2f}%)")
    print()
    print("Metrics:")
    width = max(len(k) for k in result.metrics) if result.metrics else 0
    for k in sorted(result.metrics):
        v = result.metrics[k]
        if isinstance(v, float):
            print(f"  {k.ljust(width)} = {v:.4f}")
        else:
            print(f"  {k.ljust(width)} = {v}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
