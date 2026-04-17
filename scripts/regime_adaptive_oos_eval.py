#!/usr/bin/env python
"""OOS evaluation for the Regime-Adaptive strategy.

Runs the **tuner's best parameters** on 2023-01 → 2024-12 and dumps the
full OOS metric dict + the regime timeline (per rebalance day) to
``audit-reports/phase1-regime_adaptive-oos.json``.

Also runs the **default (untuned) parameters** for a side-by-side
comparison — useful for the report.

Run from repo root:

    PYTHONPATH=. .venv/bin/python scripts/regime_adaptive_oos_eval.py
"""

from __future__ import annotations

import json
import sys
import types
from datetime import date
from decimal import Decimal
from pathlib import Path


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


def _run_one(
    strategy_cls, params: dict, bar_provider, label: str
) -> dict:
    from backend.backtest.engine import BacktestEngine, EngineConfig

    strat = strategy_cls()
    strat.configure(params)
    cfg = EngineConfig(
        start=date(2023, 1, 2),
        end=date(2024, 12, 30),
        starting_cash=Decimal("100000"),
        benchmark="SPY",
    )
    engine = BacktestEngine(strategy=strat, bar_provider=bar_provider, config=cfg)
    result = engine.run()
    m = result.metrics or {}
    final_equity = (
        float(result.equity_curve["equity"].iloc[-1])
        if not result.equity_curve.empty
        else 0.0
    )
    regime_timeline: dict[str, str] = {}
    for f in result.fills:
        if f.tag and f.tag.startswith("ra-entry-"):
            regime = f.tag.split("ra-entry-")[1]
            d = f.ts.date().isoformat()
            regime_timeline.setdefault(d, regime)

    out = {
        "label": label,
        "params": {
            k: (v if isinstance(v, (int, float, str, bool, type(None))) else str(v))
            for k, v in params.items()
        },
        "bars": len(result.equity_curve),
        "fills": len(result.fills),
        "final_equity": final_equity,
        "metrics": {
            k: float(v) for k, v in m.items() if isinstance(v, (int, float))
        },
        "regime_timeline": regime_timeline,
    }
    print(f"=== {label} ===")
    for k in (
        "sharpe",
        "sortino",
        "cagr",
        "max_drawdown",
        "volatility",
        "alpha",
        "beta",
        "turnover",
    ):
        if k in m:
            print(f"  {k:14}= {float(m[k]):.4f}")
    print(f"  fills         = {len(result.fills)}")
    print(f"  final equity  = ${final_equity:,.2f}")
    print("  regime timeline:")
    for d, regime in sorted(regime_timeline.items()):
        print(f"    {d}  →  {regime}")
    print()
    return out


def main() -> int:
    from backend.data.providers.alpaca import AlpacaBarProvider
    from backend.strategies.regime_adaptive.config import DEFAULT_PARAMS
    from backend.strategies.regime_adaptive.strategy import (
        RegimeAdaptiveStrategy,
    )

    print("Regime-Adaptive — OOS evaluation (2023-01 → 2024-12)")
    print("=" * 60)

    # Load best params from the tuner output.
    tune_path = Path("audit-reports") / "phase1-regime_adaptive-tune.json"
    if tune_path.exists():
        best_params = json.loads(tune_path.read_text()).get("best_params", {})
    else:
        best_params = {}
        print(f"WARN: {tune_path} not found; running defaults only.")

    bar_provider = AlpacaBarProvider()

    default_result = _run_one(
        RegimeAdaptiveStrategy, dict(DEFAULT_PARAMS), bar_provider,
        "defaults (textbook)",
    )
    tuned_result = _run_one(
        RegimeAdaptiveStrategy, dict(best_params) if best_params else dict(DEFAULT_PARAMS),
        bar_provider,
        "tuned (best Optuna params)" if best_params else "defaults (no tune data)",
    )

    out = {
        "strategy": "regime_adaptive",
        "window": {"start": "2023-01-02", "end": "2024-12-30"},
        "target_sharpe": 0.60,
        "defaults": default_result,
        "tuned": tuned_result,
    }
    out_path = Path("audit-reports") / "phase1-regime_adaptive-oos.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2))
    print(f"Dumped summary to {out_path}")

    sharpe = tuned_result["metrics"].get("sharpe", float("nan"))
    print(f"\nTuned OOS Sharpe : {sharpe:.3f}")
    target = 0.60
    if sharpe >= target:
        print(f"SUCCESS: {sharpe:.3f} >= target {target:.2f}")
        return 0
    print(f"BELOW TARGET: {sharpe:.3f} < target {target:.2f}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
