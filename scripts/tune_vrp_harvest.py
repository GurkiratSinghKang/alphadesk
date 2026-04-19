#!/usr/bin/env python
"""Walk-forward tuner for VRP Harvest.

The strategy bypasses the BacktestEngine for P&L (engine multi-leg
plumbing is incomplete — see the strategy module docstring). This
script therefore implements its own walk-forward driver using the
strategy's synthetic P&L ledger.

Train window: 2022-01-01 to 2022-12-31.
Test window : 2023-01-01 to 2024-12-31.

The objective maximised is:

    score = train_sharpe
          - 0.5  * max(0, train_mdd - 0.30)
          - 0.25 * max(0, -train_return_pct)

Sharpe, drawdown and profitability are all computed on the TRAIN leg
(2022 / early-2023) so that Optuna never sees the 2023-07 -> 2024-12
test window as a fitness signal. The test window is still backtested
each trial and its metrics are recorded as trial ``user_attrs`` for
post-hoc inspection, but they do not influence the score. An
authoritative single OOS evaluation against the winning parameters is
the caller's responsibility.

Runtime note: each trial loads cached Polygon chain data per session.
We cache the options provider across trials via a module-level provider
so repeated calls hit Polygon's LRU + the on-disk cache.

Run from repo root::

    PYTHONPATH=. .venv/bin/python scripts/tune_vrp_harvest.py --trials 25
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sys
import types
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import optuna
import pandas as pd


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

from backend.data.providers.alpaca import AlpacaBarProvider  # noqa: E402
from backend.strategies.vrp_harvest.config import DEFAULTS  # noqa: E402
from backend.strategies.vrp_harvest.provider import (  # noqa: E402
    BoundedPolygonOptionsProvider,
)
from backend.strategies.vrp_harvest.strategy import (  # noqa: E402
    VRPHarvestStrategy,
    synthetic_equity_curve,
    summary_from_equity,
)


# --------------------------------------------------------------------------- #
# Shared providers (avoid re-opening httpx clients per trial)                 #
# --------------------------------------------------------------------------- #
_BAR_PROVIDER: AlpacaBarProvider | None = None
_OPT_PROVIDER: BoundedPolygonOptionsProvider | None = None


def _get_providers() -> tuple[AlpacaBarProvider, BoundedPolygonOptionsProvider]:
    global _BAR_PROVIDER, _OPT_PROVIDER
    if _BAR_PROVIDER is None:
        _BAR_PROVIDER = AlpacaBarProvider()
    if _OPT_PROVIDER is None:
        _OPT_PROVIDER = BoundedPolygonOptionsProvider()
    return _BAR_PROVIDER, _OPT_PROVIDER


# --------------------------------------------------------------------------- #
# Run one strategy window                                                      #
# --------------------------------------------------------------------------- #
def _run_window(
    params: dict[str, Any],
    start: date,
    end: date,
    starting_cash: float = 100_000.0,
) -> tuple[pd.DataFrame, dict[str, float]]:
    bp, op = _get_providers()
    strat = VRPHarvestStrategy()
    strat.configure(params)

    ctx = SimpleNamespace(
        asof=start,
        cash=Decimal(str(starting_cash)),
        equity=Decimal(str(starting_cash)),
        positions=[],
        bar_provider=bp,
        options_provider=op,
        earnings_provider=None,
        fundamentals_provider=None,
        calendar_provider=None,
        params={},
        state={},
    )

    sessions = [d.date() for d in pd.bdate_range(start=start, end=end)]
    for s in sessions:
        ctx.asof = s
        # Update equity from synthetic state so sizing uses real cash.
        curve = synthetic_equity_curve(strat, ctx, [s], starting_cash)
        if not curve.empty:
            ctx.equity = Decimal(str(float(curve["equity"].iloc[-1])))
            ctx.cash = ctx.equity
        list(strat.manage(s, ctx))
        list(strat.generate_signals(s, ctx))

    curve = synthetic_equity_curve(strat, ctx, sessions, starting_cash)
    summary = summary_from_equity(curve, starting_cash)
    return curve, summary


# --------------------------------------------------------------------------- #
# Tuner                                                                       #
# --------------------------------------------------------------------------- #
def _suggest_params(trial: optuna.trial.Trial) -> dict[str, Any]:
    return {
        "vrp_entry_threshold": trial.suggest_float("vrp_entry_threshold", 0.005, 0.05),
        "strangle_delta": trial.suggest_categorical("strangle_delta", [0.10, 0.16, 0.25]),
        "target_dte": trial.suggest_categorical("target_dte", [30, 45, 60]),
        "theta_target_pct": trial.suggest_float("theta_target_pct", 0.001, 0.01),
        "tp_pct": trial.suggest_float("tp_pct", 0.30, 0.70),
        "sl_pct": trial.suggest_float("sl_pct", 1.5, 3.0),
        "exit_dte": trial.suggest_categorical("exit_dte", [14, 21, 30]),
        "vix_kill_switch": trial.suggest_float("vix_kill_switch", 0.25, 0.40),
        "tail_hedge_ratio": trial.suggest_categorical("tail_hedge_ratio", [0, 5, 10]),
        "tail_hedge_delta": trial.suggest_categorical("tail_hedge_delta", [0.03, 0.05, 0.10]),
        "term_structure_gate": trial.suggest_categorical("term_structure_gate", [True, False]),
    }


def _objective_factory(
    train_start: date,
    train_end: date,
    test_start: date,
    test_end: date,
    starting_cash: float,
):
    def _obj(trial: optuna.trial.Trial) -> float:
        # SELECTION-ON-TEST FIX: the prior implementation read
        # ``test_sum["sharpe"]`` as the fitness signal, which ran the
        # 2023-07 -> 2024-12 OOS leg every trial and handed Optuna OOS
        # Sharpe as the objective. That is structural
        # selection-on-test; the reported OOS Sharpe becomes a max-of-N
        # order statistic on the window that's supposed to be held out.
        #
        # We now score trials on TRAIN Sharpe only. The OOS window is
        # still evaluated once per trial so the per-trial artefact can
        # report the honest out-of-sample number (separately from the
        # fitness), but it does NOT influence the score. A single
        # authoritative OOS re-run against the winning params remains
        # the responsibility of a downstream evaluator.
        params = _suggest_params(trial)
        try:
            _, train_sum = _run_window(params, train_start, train_end, starting_cash)
            _, test_sum = _run_window(params, test_start, test_end, starting_cash)
        except Exception:
            logging.exception("trial failed; returning -inf")
            return -math.inf

        train_sharpe = float(train_sum["sharpe"])
        oos_sharpe = float(test_sum["sharpe"])
        oos_mdd = abs(float(test_sum["max_drawdown"]))
        train_return = float(train_sum["total_return_pct"])
        train_mdd = abs(float(train_sum["max_drawdown"]))

        if not math.isfinite(train_sharpe):
            return -math.inf

        # Composite: TRAIN Sharpe minus penalties derived from the train
        # leg only. OOS drawdown is no longer an input to the score —
        # using it would leak OOS information into selection.
        score = train_sharpe
        score -= 0.5 * max(0.0, train_mdd - 0.30)
        score -= 0.25 * max(0.0, -train_return)

        trial.set_user_attr("train_sharpe", train_sharpe)
        trial.set_user_attr("train_mdd", train_mdd)
        trial.set_user_attr("train_return_pct", train_return)
        # Reported for post-hoc diagnostic inspection only; never fed
        # back into the objective.
        trial.set_user_attr("oos_sharpe", oos_sharpe)
        trial.set_user_attr("oos_mdd", oos_mdd)
        trial.set_user_attr("oos_return_pct", float(test_sum["total_return_pct"]))

        return score
    return _obj


# --------------------------------------------------------------------------- #
# CLI                                                                         #
# --------------------------------------------------------------------------- #
def main() -> int:
    parser = argparse.ArgumentParser(description="VRP Harvest walk-forward tuner")
    parser.add_argument("--trials", type=int, default=15)
    # Polygon Developer-tier historical aggregates are available from
    # roughly 2022-10 onwards; earlier contract bars return 403. Our
    # walk-forward window starts at 2022-10 for that reason.
    #
    # Defaults keep the tuner's data-fetch fast by running on a shorter
    # train window (6 months) and using the full test window for OOS.
    parser.add_argument("--train-start", type=str, default="2023-01-03")
    parser.add_argument("--train-end", type=str, default="2023-06-30")
    parser.add_argument("--test-start", type=str, default="2023-07-03")
    parser.add_argument("--test-end", type=str, default="2024-12-30")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--out", type=str,
        default="audit-reports/phase1-vrp_harvest-tune.json",
    )
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    def _d(s: str) -> date:
        return date.fromisoformat(s)

    train_start = _d(args.train_start)
    train_end = _d(args.train_end)
    test_start = _d(args.test_start)
    test_end = _d(args.test_end)

    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=args.seed),
    )
    obj = _objective_factory(
        train_start, train_end, test_start, test_end, starting_cash=100_000.0,
    )
    study.optimize(obj, n_trials=args.trials, show_progress_bar=False)

    # Report.
    print("\n=== VRP Harvest tuner results ===")
    print(f"Trials: {len(study.trials)}")
    print(f"Best score: {study.best_value:.4f}")
    print("\nBest params:")
    for k, v in sorted(study.best_params.items()):
        print(f"  {k:25s} = {v}")

    # Top-5 leaderboard.
    trials_sorted = sorted(
        [t for t in study.trials if t.value is not None],
        key=lambda t: (-t.value),
    )
    leaderboard = []
    for t in trials_sorted[:5]:
        leaderboard.append(
            {
                "trial": t.number,
                "score": float(t.value),
                "train_sharpe": float(t.user_attrs.get("train_sharpe", 0.0)),
                "train_mdd": float(t.user_attrs.get("train_mdd", 0.0)),
                "train_return_pct": float(t.user_attrs.get("train_return_pct", 0.0)),
                "oos_sharpe": float(t.user_attrs.get("oos_sharpe", 0.0)),
                "oos_mdd": float(t.user_attrs.get("oos_mdd", 0.0)),
                "oos_return_pct": float(t.user_attrs.get("oos_return_pct", 0.0)),
                "params": t.params,
            }
        )

    out = {
        "study_name": "vrp_harvest_phase1",
        "train": [train_start.isoformat(), train_end.isoformat()],
        "test": [test_start.isoformat(), test_end.isoformat()],
        "trials_run": len(study.trials),
        "best_score": float(study.best_value),
        "best_params": study.best_params,
        "best_train_sharpe": float(
            study.best_trial.user_attrs.get("train_sharpe", 0.0)
        ),
        "best_train_mdd": float(
            study.best_trial.user_attrs.get("train_mdd", 0.0)
        ),
        # Reported for diagnostic inspection; NOT the fitness signal.
        "best_oos_sharpe": float(study.best_trial.user_attrs.get("oos_sharpe", 0.0)),
        "best_oos_mdd": float(study.best_trial.user_attrs.get("oos_mdd", 0.0)),
        "leaderboard": leaderboard,
    }
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
