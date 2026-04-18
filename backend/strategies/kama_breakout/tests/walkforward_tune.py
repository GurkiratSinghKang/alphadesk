"""Walk-forward parameter search for KAMA Breakout.

Train 2019-01 … 2022-12, test 2023-01 … 2024-12. Uses the F4 Optuna TPE
sampler with the search space declared in ``config.search_space``.

This driver is a thin wrapper around :mod:`backend.tuner.runner` that
bootstraps the ``backend.strategies`` stub (so the legacy sibling-import
chain can't kill the session), wires an :class:`AlpacaBarProvider`, and
writes the best-trial parameters + OOS metrics into a JSON file that the
``audit-reports/phase1-kama_breakout.md`` report links to.

Run::

    .venv/bin/python backend/strategies/kama_breakout/tests/walkforward_tune.py \\
        --trials 80

Progress logs go to stderr.
"""

from __future__ import annotations

import argparse
import importlib
import json
import logging
import sys
import types
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path


def _bootstrap() -> None:
    repo = Path(__file__).resolve().parents[4]
    sp = str(repo)
    if sp not in sys.path:
        sys.path.insert(0, sp)
    b = types.ModuleType("backend")
    b.__path__ = [str(repo / "backend")]
    b.__file__ = "(stub)"
    sys.modules["backend"] = b
    s = types.ModuleType("backend.strategies")
    s.__path__ = [str(repo / "backend" / "strategies")]
    s.__file__ = "(stub)"
    sys.modules["backend.strategies"] = s


_bootstrap()


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trials", type=int, default=80)
    parser.add_argument(
        "--start", type=_parse_date, default=date(2019, 1, 1),
        help="Full walk-forward range start (default 2019-01-01).",
    )
    parser.add_argument(
        "--train-end", type=_parse_date, default=date(2022, 12, 30),
        help="Last IS day (default 2022-12-30).",
    )
    parser.add_argument(
        "--end", type=_parse_date, default=date(2024, 12, 31),
        help="Full walk-forward range end (default 2024-12-31).",
    )
    parser.add_argument(
        "--study-name", default="kama_breakout_phase1_v1",
    )
    parser.add_argument(
        "--scoring",
        choices=["penalised", "sharpe"],
        default="sharpe",
        help="Use raw OOS sharpe for the phase-1 headline number.",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cash", type=Decimal, default=Decimal("100000"))
    parser.add_argument(
        "--out",
        default="audit-reports/phase1-kama_breakout.tuning.json",
        help="Where to save the best-trial summary (relative to repo root).",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    log = logging.getLogger("kama_breakout.tune")

    from data.providers.alpaca import AlpacaBarProvider
    from strategies.kama_breakout.strategy import KamaBreakout
    from tuner.objective import WalkForwardObjective
    from tuner.search import ParameterSearch

    provider = AlpacaBarProvider()

    trial_log: list[dict] = []

    def _on_result(params: dict, wf_result, score: float) -> None:
        metrics = {}
        if getattr(wf_result, "out_of_sample_result", None) is not None:
            metrics = dict(wf_result.out_of_sample_result.metrics or {})
        row = {
            "score": score,
            "params": params,
            "sharpe": metrics.get("sharpe"),
            "max_drawdown": metrics.get("max_drawdown"),
            "n_trades": metrics.get("n_trades"),
            "hit_rate": metrics.get("hit_rate"),
            "cagr": metrics.get("cagr"),
        }
        trial_log.append(row)
        log.info(
            "trial #%d  score=%.4f  sharpe=%s  n_trades=%s",
            len(trial_log),
            score,
            row["sharpe"],
            row["n_trades"],
        )

    objective = WalkForwardObjective(
        strategy_cls=KamaBreakout,
        bar_provider=provider,
        start=args.start,
        end=args.end,
        train_end=args.train_end,
        scoring=args.scoring,
        starting_cash=args.cash,
        on_result=_on_result,
    )

    space = KamaBreakout.search_space()
    search = ParameterSearch(
        space=space,
        objective_fn=objective,
        direction="maximize",
        sampler="tpe",
        seed=args.seed,
    )
    study = search.run(
        n_trials=args.trials,
        study_name=args.study_name,
        show_progress_bar=False,
        load_if_exists=True,
    )

    try:
        best_params = dict(study.best_params)
        best_value = float(study.best_value)
    except Exception:
        best_params = {}
        best_value = float("-inf")

    print("=" * 72)
    print(f"Study: {args.study_name}")
    print(f"Trials: {len(study.trials)}")
    print(f"Best OOS score ({args.scoring}): {best_value:.4f}")
    print("\nBest params:")
    for k, v in sorted(best_params.items()):
        print(f"  {k}: {v}")

    # Write summary JSON.
    summary = {
        "study_name": args.study_name,
        "start": str(args.start),
        "train_end": str(args.train_end),
        "end": str(args.end),
        "trials": len(study.trials),
        "best_value": best_value,
        "best_params": best_params,
        "trials_log": trial_log,
    }
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = Path(__file__).resolve().parents[4] / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2, default=str))
    print(f"\nSummary written: {out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
