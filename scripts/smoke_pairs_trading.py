"""Smoke-test the pairs_trading strategy against real Alpaca data.

Runs a 6-month backtest ending 2024-06 and prints the equity curve summary,
trade count, and top-level metrics. Verifies the audit's non-negotiable
invariant: every pair entry must fire TWO coincident fills (one long, one
short) on the same bar.

Usage::

    .venv/bin/python scripts/smoke_pairs_trading.py [start] [end]

Default window: 2023-12-01 -> 2024-06-30 (6 months + warmup).

Requires ``.env`` with ``ALPACA_API_KEY`` + ``ALPACA_SECRET_KEY`` set.
"""

from __future__ import annotations

import sys
import types
from collections import defaultdict
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


import backend.strategies.pairs_trading  # noqa: F401 - registers the strategy

from backend.backtest.engine import BacktestEngine, EngineConfig
from backend.data.providers.alpaca import AlpacaBarProvider
from backend.strategies.registry import get_strategy


def main() -> int:
    cls = get_strategy("pairs_trading")
    strat = cls()

    start_arg = sys.argv[1] if len(sys.argv) > 1 else "2023-12-01"
    end_arg = sys.argv[2] if len(sys.argv) > 2 else "2024-06-30"
    y, m, d = start_arg.split("-")
    start_d = date(int(y), int(m), int(d))
    y, m, d = end_arg.split("-")
    end_d = date(int(y), int(m), int(d))

    print(f"Running pairs_trading smoke test {start_d} -> {end_d} ...")
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

    print("=" * 72)
    print("Pairs Trading — Smoke Test")
    print("=" * 72)
    print(f"Period:          {result.start} -> {result.end}")
    print(f"Bars evaluated:  {len(result.equity_curve)}")
    print(f"Fills:           {len(result.fills)}")
    print(f"Round-trip trades: "
          f"{sum(1 for t in result.trades if t.is_closed)}")
    if not result.equity_curve.empty:
        start_eq = float(result.equity_curve['equity'].iloc[0])
        end_eq = float(result.equity_curve['equity'].iloc[-1])
        pct = (end_eq / start_eq - 1.0) * 100.0
        print(f"Equity start:    {start_eq:,.2f}")
        print(f"Equity end:      {end_eq:,.2f}  ({pct:+.2f}%)")
    print()
    print("Metrics:")
    width = max(len(k) for k in result.metrics) if result.metrics else 12
    for k in sorted(result.metrics):
        v = result.metrics[k]
        if isinstance(v, float):
            print(f"  {k.ljust(width)} = {v:.4f}")
        else:
            print(f"  {k.ljust(width)} = {v}")

    # ---- Two-leg invariant check ----
    # Group fills by tag-prefix (each pair entry carries tag like
    # "pairs-entry-AAPL-MSFT-dir+1-y"); verify that every entry emits two
    # coincident fills on the same bar.
    entries_by_tag_date: dict[tuple, list] = defaultdict(list)
    exits_by_tag_date: dict[tuple, list] = defaultdict(list)
    for f in result.fills:
        t = getattr(f, "tag", "") or ""
        if t.startswith("pairs-entry"):
            # tag format: pairs-entry-<pair>-dir±1-(y|x)
            parts = t.split("-")
            if len(parts) >= 6:
                pid = f"{parts[2]}-{parts[3]}"
                dir_ = parts[4]
                key = (pid, dir_, f.ts.date())
                entries_by_tag_date[key].append(f)
        elif t.startswith("pairs-exit"):
            parts = t.split("-")
            if len(parts) >= 5:
                pid = f"{parts[-3]}-{parts[-2]}"
                key = (pid, f.ts.date())
                exits_by_tag_date[key].append(f)

    print()
    print("Two-leg invariant audit:")
    entry_ok = 0
    entry_bad = 0
    for key, fills in entries_by_tag_date.items():
        if len(fills) == 2:
            sides = {f.side.value for f in fills}
            if sides == {"buy", "sell"}:
                entry_ok += 1
            else:
                entry_bad += 1
                print(f"  ENTRY {key}: both fills on same side {sides}!")
        else:
            entry_bad += 1
            print(f"  ENTRY {key}: {len(fills)} legs (expected 2)")
    exit_ok = 0
    exit_bad = 0
    for key, fills in exits_by_tag_date.items():
        if len(fills) == 2:
            exit_ok += 1
        else:
            exit_bad += 1
    print(f"  entries with both legs: {entry_ok} / {entry_ok + entry_bad}")
    print(f"  exits   with both legs: {exit_ok}   / {exit_ok + exit_bad}")
    if entry_ok == 0 and entry_bad == 0:
        print("  (no pair activity in this window)")

    # Summarise active pairs seen.
    print()
    pair_ids = sorted({
        pid for (pid, _dir, _d) in entries_by_tag_date
    })
    print(f"Unique pairs entered: {len(pair_ids)}")
    for pid in pair_ids[:10]:
        print(f"  {pid}")
    if len(pair_ids) > 10:
        print(f"  ... and {len(pair_ids) - 10} more")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
