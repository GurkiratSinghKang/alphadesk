"""CLI entry point for the tuner.

Usage::

    python -m backend.tuner \
        --strategy=buy_and_hold_spy \
        --trials=100 \
        --study-name=bhs_v1 \
        --start=2019-01-01 \
        --end=2024-12-31

The study is persisted to SQLite at ``~/.alphadesk/tuner/{study-name}.db`` so
long runs are resumable. At completion the CLI prints a table of the best
parameters and the corresponding OOS Sharpe.

This module intentionally leaves the bar provider configuration to the
caller. In a real run, wire ``AlpacaBarProvider`` or similar into
:class:`WalkForwardObjective` before calling :func:`main` programmatically.
For ad-hoc CLI use, the module will try ``backend.data.providers.cache``
first and fall back to raising a descriptive error if no provider is
available.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from backend.strategies.registry import get_strategy, list_names, load_all
from backend.tuner.objective import WalkForwardObjective
from backend.tuner.search import ParameterSearch

log = logging.getLogger("alphadesk.tuner.runner")


# --------------------------------------------------------------------------- #
# Argument parsing                                                            #
# --------------------------------------------------------------------------- #
def _parse_date(s: str) -> date:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"Date must be in YYYY-MM-DD format, got {s!r}."
        ) from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m backend.tuner",
        description="Walk-forward parameter search for an AlphaDesk strategy.",
    )
    parser.add_argument(
        "--strategy",
        required=True,
        help="Registered strategy name (see `list_strategies`).",
    )
    parser.add_argument(
        "--trials",
        type=int,
        default=100,
        help="Number of Optuna trials (default: 100).",
    )
    parser.add_argument(
        "--study-name",
        required=True,
        help="Study name; also used as the SQLite filename.",
    )
    parser.add_argument(
        "--start",
        required=True,
        type=_parse_date,
        help="Walk-forward start date (YYYY-MM-DD).",
    )
    parser.add_argument(
        "--end",
        required=True,
        type=_parse_date,
        help="Walk-forward end date (YYYY-MM-DD).",
    )
    parser.add_argument(
        "--train-end",
        type=_parse_date,
        default=None,
        help=(
            "Last day of the training window. If set, train/test protocol is "
            "used; otherwise 5-fold purged walk-forward."
        ),
    )
    parser.add_argument(
        "--k-folds",
        type=int,
        default=5,
        help="Number of folds when --train-end is not set (default: 5).",
    )
    parser.add_argument(
        "--purge-days",
        type=int,
        default=60,
        help="Purge window between folds (default: 60 calendar days).",
    )
    parser.add_argument(
        "--sampler",
        choices=["tpe", "random"],
        default="tpe",
        help="Optuna sampler (default: tpe).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42).",
    )
    parser.add_argument(
        "--scoring",
        choices=["penalised", "sharpe"],
        default="penalised",
        help="Objective scoring mode (default: penalised).",
    )
    parser.add_argument(
        "--starting-cash",
        type=str,
        default="100000",
        help="Starting cash, Decimal-compatible string (default: 100000).",
    )
    parser.add_argument(
        "--storage",
        default=None,
        help="Optuna storage URL. Default: sqlite:///~/.alphadesk/tuner/<study>.db",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        help="Python logging level (default: INFO).",
    )
    return parser


# --------------------------------------------------------------------------- #
# Main                                                                        #
# --------------------------------------------------------------------------- #
def _resolve_strategy(name: str) -> type:
    load_all()
    try:
        return get_strategy(name)
    except KeyError as exc:
        raise SystemExit(
            f"Unknown strategy {name!r}. Registered: {list_names()}\n{exc}"
        ) from None


def _resolve_bar_provider() -> Any:
    """Best-effort bar-provider factory for CLI use.

    Production pipelines should call :func:`run` directly with a wired
    provider. This helper keeps the CLI usable from a dev shell.
    """

    try:
        # Preferred: the parquet-backed cache reading from the shared data lake.
        from backend.data.providers.cache import CachedBarProvider  # type: ignore
    except Exception:
        CachedBarProvider = None  # type: ignore[assignment]

    if CachedBarProvider is not None:
        try:
            return CachedBarProvider()
        except Exception:
            log.exception("CachedBarProvider() failed; falling back.")

    raise SystemExit(
        "No bar provider available. Wire one into WalkForwardObjective and "
        "call backend.tuner.runner.run() programmatically, or finish the F2 "
        "cache adapter before using the CLI."
    )


def run(
    strategy_name: str,
    trials: int,
    study_name: str,
    start: date,
    end: date,
    train_end: date | None = None,
    *,
    k_folds: int = 5,
    purge_days: int = 60,
    sampler: str = "tpe",
    seed: int = 42,
    scoring: str = "penalised",
    starting_cash: Decimal = Decimal("100000"),
    storage: str | None = None,
    bar_provider: Any = None,
    options_provider: Any = None,
    earnings_provider: Any = None,
    fundamentals_provider: Any = None,
    calendar_provider: Any = None,
    cost_model: Any = None,
) -> dict[str, Any]:
    """Programmatic entry point (the CLI is a thin wrapper over this).

    Returns a result dict with ``best_params``, ``best_value``, ``n_trials``
    and ``study_name``. The study itself is persisted to ``storage``.
    """

    strategy_cls = _resolve_strategy(strategy_name)

    space_fn = getattr(strategy_cls, "search_space", None)
    if space_fn is None:
        raise SystemExit(
            f"Strategy {strategy_name!r} does not declare search_space(); "
            "nothing to tune."
        )
    space = space_fn()
    if not space:
        raise SystemExit(
            f"Strategy {strategy_name!r}.search_space() is empty; nothing to tune."
        )

    if bar_provider is None:
        bar_provider = _resolve_bar_provider()

    def _on_result(params: dict, wf_result: Any, score: float) -> None:
        log.info("trial score=%.4f params=%s", score, params)

    objective = WalkForwardObjective(
        strategy_cls=strategy_cls,
        bar_provider=bar_provider,
        start=start,
        end=end,
        train_end=train_end,
        k_folds=k_folds,
        purge_days=purge_days,
        scoring=scoring,
        starting_cash=starting_cash,
        options_provider=options_provider,
        earnings_provider=earnings_provider,
        fundamentals_provider=fundamentals_provider,
        calendar_provider=calendar_provider,
        cost_model=cost_model,
        on_result=_on_result,
    )

    search = ParameterSearch(
        space=space,
        objective_fn=objective,
        direction="maximize",
        sampler=sampler,
        seed=seed,
    )
    study = search.run(
        n_trials=trials,
        study_name=study_name,
        storage=storage,
        show_progress_bar=False,
        load_if_exists=True,
    )

    try:
        best_params = search.best_params(study)
        best_value = float(study.best_value)
    except Exception:
        log.exception("No successful trials in study.")
        best_params = {}
        best_value = float("-inf")

    _print_best(study_name, best_params, best_value, len(study.trials))
    return {
        "study_name": study_name,
        "best_params": best_params,
        "best_value": best_value,
        "n_trials": len(study.trials),
    }


def _print_best(
    study_name: str, params: dict[str, Any], value: float, n_trials: int
) -> None:
    """Pretty-print the winning parameters to stdout."""

    print(f"\n=== Tuner results: {study_name} ===")
    print(f"Trials completed: {n_trials}")
    print(f"Best OOS score:   {value:.4f}")
    if not params:
        print("(no successful trial)")
        return
    width = max(len(k) for k in params)
    print("\nBest parameters:")
    for k, v in sorted(params.items()):
        print(f"  {k.ljust(width)} = {_format_value(v)}")


def _format_value(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:.6g}"
    return json.dumps(v, default=str)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    try:
        run(
            strategy_name=args.strategy,
            trials=args.trials,
            study_name=args.study_name,
            start=args.start,
            end=args.end,
            train_end=args.train_end,
            k_folds=args.k_folds,
            purge_days=args.purge_days,
            sampler=args.sampler,
            seed=args.seed,
            scoring=args.scoring,
            starting_cash=Decimal(args.starting_cash),
            storage=args.storage,
        )
    except SystemExit:
        raise
    except Exception:
        log.exception("tuner run failed")
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
