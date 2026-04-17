"""Parameter search harness for AlphaDesk strategies.

Wraps Optuna to run walk-forward Sharpe optimisation across a strategy's
declared :meth:`search_space` with random or TPE (Bayesian) samplers. Results
are persisted to SQLite at ``~/.alphadesk/tuner/{study}.db`` so long runs can
be resumed.

Public entry points:

    from backend.tuner.search import ParameterSearch, IntRange, FloatRange, Categorical
    from backend.tuner.objective import WalkForwardObjective
    from backend.tuner.reports import write_report

Command-line:

    python -m backend.tuner --strategy=NAME --trials=100 --start=2019-01-01 --end=2024-12-31
"""

from __future__ import annotations

from backend.tuner.search import (
    ParameterSearch,
    IntRange,
    FloatRange,
    Categorical,
    SearchSpec,
)

__all__ = [
    "ParameterSearch",
    "IntRange",
    "FloatRange",
    "Categorical",
    "SearchSpec",
]
