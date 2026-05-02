"""Run the winning tuner params through a final walk-forward OOS eval.

Reads the best params from ``audit-reports/phase1-pairs_trading-tune.json``
(or a path passed on argv) and replays 2023-01-01 → 2024-12-31 with those
params against real Alpaca bars (in-memory). Writes the result to
``audit-reports/phase1-pairs_trading-oos.json``.

Usage::

    .venv/bin/python scripts/pairs_trading_oos_eval.py [tune_json_path]
"""

from __future__ import annotations

import json
import logging
import sys
import types
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any


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
import backend.strategies.pairs_trading  # noqa: F401 - registers

from backend.backtest.engine import BacktestEngine, EngineConfig
from backend.data.providers.alpaca import AlpacaBarProvider
from backend.strategies.pairs_trading.config import UNIVERSE
from backend.strategies.registry import get_strategy
from scripts.oos_bootstrap import attach_bootstrap_ci, bootstrap_ci_from_equity_frame

log = logging.getLogger("pairs_oos_eval")


class InMemoryBarProvider:
    def __init__(self, df: pd.DataFrame) -> None:
        self._df = df.sort_values(["symbol", "ts"], ignore_index=True)
        self._by_sym: dict[str, pd.DataFrame] = {
            s: g.reset_index(drop=True)
            for s, g in self._df.groupby("symbol", sort=False)
        }

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = [s.upper() for s in (symbols if not isinstance(symbols, str) else [symbols])]
        start_ts = pd.Timestamp(start).tz_localize("UTC") if pd.Timestamp(start).tzinfo is None else pd.Timestamp(start)
        end_ts = pd.Timestamp(end).tz_localize("UTC") if pd.Timestamp(end).tzinfo is None else pd.Timestamp(end)
        end_ts = end_ts.normalize() + pd.Timedelta(hours=23, minutes=59, seconds=59)
        start_ts = start_ts.normalize()

        frames: list[pd.DataFrame] = []
        for sym in syms:
            sub = self._by_sym.get(sym)
            if sub is None or sub.empty:
                continue
            m = (sub["ts"] >= start_ts) & (sub["ts"] <= end_ts)
            sel = sub.loc[m]
            if not sel.empty:
                frames.append(sel)
        if not frames:
            return pd.DataFrame(
                columns=["symbol", "ts", "open", "high", "low", "close", "volume"]
            )
        return pd.concat(frames, ignore_index=True)


def _pair_contribution(fills, trades) -> list[dict]:
    """Per-pair P&L contribution from closed trades."""

    fill_pid: dict[tuple, str] = {}
    for f in fills:
        t = getattr(f, "tag", "") or ""
        if t.startswith("pairs-entry"):
            parts = t.split("-")
            if len(parts) >= 6:
                pid = f"{parts[2]}-{parts[3]}"
                fill_pid[(f.symbol, f.ts)] = pid

    by_pair: dict[str, dict[str, Any]] = {}
    for tr in trades:
        if not tr.is_closed:
            continue
        pid = fill_pid.get((tr.symbol, tr.entry_ts), "unknown")
        rec = by_pair.setdefault(
            pid, {"pair_id": pid, "trades": 0, "pnl": 0.0, "wins": 0, "losses": 0}
        )
        rec["trades"] += 1
        rec["pnl"] += float(tr.pnl)
        if tr.pnl > 0:
            rec["wins"] += 1
        else:
            rec["losses"] += 1

    contribs = sorted(
        by_pair.values(), key=lambda r: r["pnl"], reverse=True
    )
    return contribs


def main() -> int:
    logging.basicConfig(
        level="INFO",
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    tune_json_path = (
        Path(sys.argv[1]) if len(sys.argv) > 1
        else _ROOT / "audit-reports" / "phase1-pairs_trading-tune.json"
    )
    with tune_json_path.open() as f:
        tune_result = json.load(f)

    best_params = tune_result.get("tuner", {}).get("best_params") or {}
    if not best_params:
        raise SystemExit(
            f"No best_params found in {tune_json_path} — run the tuner first."
        )
    log.info("best_params = %s", best_params)

    # Prefetch
    t0 = datetime.utcnow()
    with AlpacaBarProvider() as p:
        df = p.bars(
            sorted(set(UNIVERSE)),
            date(2022, 1, 1),
            date(2025, 1, 31),
            tf="1D",
        )
    log.info(
        "prefetched %d rows in %.1fs", len(df),
        (datetime.utcnow() - t0).total_seconds(),
    )
    provider = InMemoryBarProvider(df)

    # OOS run
    cls = get_strategy("pairs_trading")
    strat = cls()
    engine = BacktestEngine(
        strategy=strat,
        bar_provider=provider,
        config=EngineConfig(
            start=date(2023, 1, 1),
            end=date(2024, 12, 31),
            starting_cash=Decimal("100000"),
        ),
        strategy_params=best_params,
    )
    t0 = datetime.utcnow()
    result = engine.run()
    log.info(
        "OOS run complete in %.1fs",
        (datetime.utcnow() - t0).total_seconds(),
    )

    # Two-leg invariant verification.
    from collections import defaultdict
    entries_by_key: dict[tuple, list] = defaultdict(list)
    exits_by_key: dict[tuple, list] = defaultdict(list)
    for f in result.fills:
        t = getattr(f, "tag", "") or ""
        if t.startswith("pairs-entry"):
            parts = t.split("-")
            if len(parts) >= 6:
                pid = f"{parts[2]}-{parts[3]}"
                entries_by_key[(pid, f.ts.date())].append(f)
        elif t.startswith("pairs-exit"):
            parts = t.split("-")
            if len(parts) >= 5:
                pid = f"{parts[-3]}-{parts[-2]}"
                exits_by_key[(pid, f.ts.date())].append(f)

    entry_ok = sum(1 for fills in entries_by_key.values() if len(fills) == 2)
    entry_total = len(entries_by_key)
    exit_ok = sum(1 for fills in exits_by_key.values() if len(fills) == 2)
    exit_total = len(exits_by_key)

    out: dict[str, Any] = {
        "best_params": best_params,
        "period": {
            "start": str(result.start),
            "end": str(result.end),
        },
        "metrics": {k: (float(v) if isinstance(v, (int, float)) else v)
                     for k, v in result.metrics.items()},
        "fills": len(result.fills),
        "trades": sum(1 for t in result.trades if t.is_closed),
        "two_leg_invariant": {
            "entry_ok": entry_ok, "entry_total": entry_total,
            "exit_ok": exit_ok, "exit_total": exit_total,
        },
        "pair_contrib": _pair_contribution(result.fills, result.trades),
    }
    if not result.equity_curve.empty:
        curve = result.equity_curve["equity"]
        out["equity"] = {
            "start": float(curve.iloc[0]),
            "end": float(curve.iloc[-1]),
            "total_return": float(curve.iloc[-1]) / float(curve.iloc[0]) - 1.0,
        }
    attach_bootstrap_ci(out, bootstrap_ci_from_equity_frame(result.equity_curve))

    report_dir = _ROOT / "audit-reports"
    report_dir.mkdir(exist_ok=True)
    out_path = report_dir / "phase1-pairs_trading-oos.json"
    with out_path.open("w") as f:
        json.dump(out, f, indent=2, default=str)

    print(json.dumps(out, indent=2, default=str))
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
