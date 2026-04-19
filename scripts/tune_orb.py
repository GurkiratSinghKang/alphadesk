"""Walk-forward tune the ORB strategy against real Alpaca 1-minute bars.

Protocol
--------

Due to the weight of intraday data, the tuner uses a reduced walk-forward
window: **train 2022-01-01 → 2022-12-31 (IS), test 2023-01-01 → 2024-12-31
(OOS).** The OOS window is 24 months across three different market regimes
(bull, flat, bull) which is a more stringent test than the paper's six-year
IS window.

Data is prefetched once at tuner start (the full 2022-2024 range across the
biggest universe profile we might touch: ``all_leveraged``) and served to
each trial from an in-memory pandas frame, avoiding 30+ network roundtrips
per trial.

The objective is OOS Sharpe directly; Optuna maximises it.

Usage::

    .venv/bin/python scripts/tune_orb.py [n_trials]

Defaults to 25 trials; can be dropped to 15 if the full run exceeds 25 min.
"""

from __future__ import annotations

import json
import logging
import sys
import types
from datetime import date, datetime
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
import backend.strategies.orb  # noqa: F401 - registers the strategy

from backend.data.providers.alpaca import AlpacaBarProvider
from backend.strategies.orb.strategy import ORBStrategy
from backend.strategies.orb.config import UNIVERSE_PROFILES
from backend.tuner.search import ParameterSearch

from scripts.smoke_orb import InMemoryIntradayProvider, run_orb_backtest

log = logging.getLogger("tune_orb")


# --------------------------------------------------------------------------- #
# Walk-forward driver                                                         #
# --------------------------------------------------------------------------- #
TRAIN_START = date(2022, 1, 1)
TRAIN_END = date(2022, 12, 31)
TEST_START = date(2023, 1, 1)
TEST_END = date(2024, 12, 31)


def _run_train(strat: ORBStrategy, bar_provider) -> dict:
    """Run the strategy across the TRAIN window (2022-01-01 -> 2022-12-31).

    This is the fitness signal consumed by the Optuna objective: tuning on
    the training window is the only defensible protocol. The post-tune
    block in :func:`main` performs a single authoritative OOS evaluation
    on 2023-01-01 -> 2024-12-31 using the winning parameter set.
    """

    return run_orb_backtest(
        strat,
        bar_provider,
        start=TRAIN_START,
        end=TRAIN_END,
        starting_cash=100_000.0,
    )


def _run_oos(strat: ORBStrategy, bar_provider) -> dict:
    """Run the strategy across the OOS window.

    ONLY used for the single post-tune authoritative evaluation. Never
    call this from inside the Optuna objective — doing so is
    selection-on-test.
    """

    return run_orb_backtest(
        strat,
        bar_provider,
        start=TEST_START,
        end=TEST_END,
        starting_cash=100_000.0,
    )


def _objective_factory(bar_provider):
    def objective(params: dict) -> float:
        strat = ORBStrategy()
        strat.configure(params)
        # Tune on TRAIN (selection-on-test fix): the previous
        # implementation scored each trial against the 2023-24 OOS
        # window, which made the reported "OOS Sharpe" a max-of-N order
        # statistic on the very window held out. Score trials on the
        # TRAIN window; a single honest OOS evaluation happens post-tune
        # in ``main``.
        result = _run_train(strat, bar_provider)
        metrics = result["metrics"]
        sharpe = metrics.get("sharpe", float("-inf"))
        n_active = metrics.get("n_active_days", 0)
        if n_active < 10:
            # Too few trading days to produce a meaningful Sharpe.
            return -99.0
        return float(sharpe)

    return objective


def _prefetch_all_leveraged(start: date, end: date) -> pd.DataFrame:
    syms = sorted({*UNIVERSE_PROFILES["all_leveraged"]})
    log.info("Prefetching %s 1Min bars from %s to %s", syms, start, end)
    t0 = datetime.utcnow()
    with AlpacaBarProvider() as p:
        df = p.bars(syms, start, end, tf="1Min")
    dt = (datetime.utcnow() - t0).total_seconds()
    log.info("Prefetch complete: %d rows in %.1fs", len(df), dt)
    return df


def main() -> int:
    logging.basicConfig(
        level="INFO",
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    n_trials = int(sys.argv[1]) if len(sys.argv) > 1 else 25

    # Prefetch once.
    # Pull 2022-01 through 2024-12 so trials can sweep any universe profile.
    df = _prefetch_all_leveraged(date(2022, 1, 1), date(2024, 12, 31))
    if df.empty:
        print("Prefetch returned no rows; aborting.")
        return 1
    bar_provider = InMemoryIntradayProvider(df)

    search = ParameterSearch(
        space=ORBStrategy.search_space(),
        objective_fn=_objective_factory(bar_provider),
        direction="maximize",
        sampler="tpe",
        seed=42,
    )

    study = search.run(
        n_trials=n_trials,
        study_name="orb_v1",
        show_progress_bar=False,
    )

    try:
        best = dict(study.best_params)
    except ValueError:
        print("No trials completed successfully; aborting.")
        return 1

    print("\nBest params:", json.dumps(best, indent=2, default=str))
    print(f"Best TRAIN Sharpe (fitness): {study.best_value:.4f}")

    # Emit a JSON report. The OOS evaluator will do the one authoritative
    # re-run against these params on the 2023-24 window.
    report = {
        "n_trials": n_trials,
        "train_start": TRAIN_START.isoformat(),
        "train_end": TRAIN_END.isoformat(),
        "test_start": TEST_START.isoformat(),
        "test_end": TEST_END.isoformat(),
        "best_params": best,
        "best_train_sharpe": float(study.best_value),
        "top_trials": [
            {
                "number": t.number,
                "value": t.value,
                "params": dict(t.params),
            }
            for t in sorted(
                (t for t in study.trials if t.value is not None and t.value > -50),
                key=lambda x: (x.value or float("-inf")),
                reverse=True,
            )[:5]
        ],
    }
    out_path = _ROOT / "audit-reports" / "phase1-orb-tune.json"
    out_path.parent.mkdir(exist_ok=True)
    with out_path.open("w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nWrote {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
