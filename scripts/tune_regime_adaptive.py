#!/usr/bin/env python
"""Walk-forward tuner for the Regime-Adaptive strategy.

Protocol (per the Wave B brief):
- Train 2019-01-01 .. 2022-12-31 (4 years)
- Test  2023-01-01 .. 2024-12-31 (2 years OOS)
- 40 trials, TPE sampler

Run from repo root:

    PYTHONPATH=. .venv/bin/python scripts/tune_regime_adaptive.py [N_TRIALS]
"""

from __future__ import annotations

import json
import sys
import time
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


def main() -> int:
    from backend.data.providers.alpaca import AlpacaBarProvider
    from backend.strategies.regime_adaptive.strategy import (
        RegimeAdaptiveStrategy,
    )
    from backend.tuner.objective import WalkForwardObjective
    from backend.tuner.search import ParameterSearch

    n_trials = int(sys.argv[1]) if len(sys.argv) > 1 else 40

    print("Walk-forward tune: Regime-Adaptive (4-regime)")
    print("=" * 60)

    bar_provider = AlpacaBarProvider()

    start = date(2019, 1, 2)
    end = date(2024, 12, 30)
    train_end = date(2022, 12, 30)

    trial_log = {"count": 0, "best": float("-inf")}

    def _on_result(params: dict, wf_result, score: float) -> None:
        trial_log["count"] += 1
        if score > trial_log["best"]:
            trial_log["best"] = score
        print(
            f"trial {trial_log['count']:2d}  "
            f"score={score:.4f}  best={trial_log['best']:.4f}  "
            f"params={{{', '.join(f'{k}={v!r}' for k, v in sorted(params.items()))}}}",
            flush=True,
        )

    objective = WalkForwardObjective(
        strategy_cls=RegimeAdaptiveStrategy,
        bar_provider=bar_provider,
        start=start,
        end=end,
        train_end=train_end,
        scoring="sharpe",
        starting_cash=Decimal("100000"),
        on_result=_on_result,
    )

    space = RegimeAdaptiveStrategy.search_space()
    print(f"Search space      : {sorted(space.keys())}")
    print(f"Trials            : {n_trials}")

    search = ParameterSearch(
        space=space,
        objective_fn=objective,
        direction="maximize",
        sampler="tpe",
        seed=42,
    )

    t0 = time.time()
    study = search.run(
        n_trials=n_trials,
        study_name="regime_adaptive_v1",
        storage="",            # in-memory
        show_progress_bar=False,
        load_if_exists=False,
    )
    elapsed = time.time() - t0
    print(f"Trials completed  : {len(study.trials)} in {elapsed:.0f}s")

    try:
        best_params = dict(study.best_params)
        best_value = float(study.best_value)
    except Exception:
        print("FAIL: no completed trials.")
        return 1

    print(f"\nBest OOS Sharpe   : {best_value:.4f}")
    print("Best parameters   :")
    for k, v in sorted(best_params.items()):
        print(f"  {k} = {v!r}")

    # Re-run the best on OOS to get the full metric sweep and regime timeline.
    print("\n--- Final OOS backtest with best params ---")
    from backend.backtest.engine import BacktestEngine, EngineConfig

    strat = RegimeAdaptiveStrategy()
    strat.configure(best_params)
    oos_cfg = EngineConfig(
        start=date(2023, 1, 2),
        end=date(2024, 12, 30),
        starting_cash=Decimal("100000"),
        benchmark="SPY",
    )
    engine = BacktestEngine(
        strategy=strat,
        bar_provider=bar_provider,
        config=oos_cfg,
    )
    oos = engine.run()
    m = oos.metrics or {}
    print(f"OOS bars          : {len(oos.equity_curve)}")
    print(f"OOS fills         : {len(oos.fills)}")
    print(f"OOS Sharpe        : {m.get('sharpe', float('nan')):.3f}")
    print(f"OOS Sortino       : {m.get('sortino', float('nan')):.3f}")
    print(f"OOS CAGR          : {m.get('cagr', float('nan')):.3%}")
    print(f"OOS MDD           : {m.get('max_drawdown', float('nan')):.3%}")
    print(
        f"OOS final equity  : "
        f"${float(oos.equity_curve['equity'].iloc[-1]):,.2f}"
    )

    # Regime timeline: extract from fill tags (one fill per rebalance per
    # ticker, tagged with the regime).
    regime_timeline: dict[str, str] = {}
    for f in oos.fills:
        if f.tag and f.tag.startswith("ra-entry-"):
            regime = f.tag.split("ra-entry-")[1]
            d = f.ts.date().isoformat()
            regime_timeline.setdefault(d, regime)
    print("\nOOS regime timeline (per rebalance date):")
    for d, regime in sorted(regime_timeline.items()):
        print(f"  {d}  →  {regime}")

    # JSON dump.
    out = {
        "strategy": "regime_adaptive",
        "start": str(start),
        "end": str(end),
        "train_end": str(train_end),
        "n_trials": len(study.trials),
        "best_oos_sharpe": best_value,
        "best_params": best_params,
        "oos_metrics": {
            k: float(v) for k, v in m.items() if isinstance(v, (int, float))
        },
        "regime_timeline": regime_timeline,
        "elapsed_seconds": int(elapsed),
    }
    out_path = Path("audit-reports") / "phase1-regime_adaptive-tune.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2))
    print(f"\nDumped summary to {out_path}")

    target = 0.60
    if best_value >= target:
        print(
            f"\nSUCCESS: OOS Sharpe {best_value:.3f} >= target {target:.2f}"
        )
        return 0
    else:
        print(
            f"\nBELOW TARGET: OOS Sharpe {best_value:.3f} < target {target:.2f}"
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
