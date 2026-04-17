"""Parameter-search primitives built on Optuna.

Strategies declare their search space as a dict of :class:`SearchSpec`
objects (``IntRange``, ``FloatRange``, ``Categorical``). :class:`ParameterSearch`
feeds those into an Optuna study and hands the resulting ``params`` dict to an
objective function.

Two samplers are supported:

- ``"random"`` -- :class:`optuna.samplers.RandomSampler`; used as a baseline.
- ``"tpe"``    -- :class:`optuna.samplers.TPESampler`; default. Bayesian, fast
                  convergence on low-to-medium dimensional spaces.

The sampler is always seed-able for reproducibility. The study is persisted to
SQLite by default; see :meth:`ParameterSearch.run`.
"""

from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

try:
    import optuna
    from optuna.samplers import RandomSampler, TPESampler
    from optuna.pruners import NopPruner
except ImportError:  # pragma: no cover
    optuna = None  # type: ignore[assignment]
    RandomSampler = None  # type: ignore[assignment]
    TPESampler = None  # type: ignore[assignment]
    NopPruner = None  # type: ignore[assignment]

log = logging.getLogger("alphadesk.tuner.search")


# --------------------------------------------------------------------------- #
# Search-space primitives                                                     #
# --------------------------------------------------------------------------- #
class SearchSpec:
    """Marker base class for search-space primitives.

    A ``SearchSpec`` knows how to ask a :class:`optuna.trial.Trial` for a
    suggested value for a named parameter.
    """

    def suggest(self, trial: "optuna.trial.Trial", name: str) -> Any:
        raise NotImplementedError


@dataclass(frozen=True)
class IntRange(SearchSpec):
    """Integer search range ``[low, high]`` inclusive.

    Examples
    --------
    >>> IntRange(2, 5).suggest(trial, "rsi_period")
    """

    low: int
    high: int
    step: int = 1

    def suggest(self, trial: "optuna.trial.Trial", name: str) -> int:
        return trial.suggest_int(name, self.low, self.high, step=self.step)


@dataclass(frozen=True)
class FloatRange(SearchSpec):
    """Float search range ``[low, high]``.

    Parameters
    ----------
    log:
        If True, sample on a log scale (useful for rates, thresholds spanning
        orders of magnitude).
    step:
        Optional discretisation step. Cannot be combined with ``log=True``.
    """

    low: float
    high: float
    log: bool = False
    step: float | None = None

    def suggest(self, trial: "optuna.trial.Trial", name: str) -> float:
        if self.log and self.step is not None:
            # Optuna disallows this combination; fall back to non-log to avoid
            # a confusing exception deep in the sampler.
            log.warning(
                "FloatRange(%r): log=True and step=%s are incompatible; using log only.",
                name,
                self.step,
            )
            return trial.suggest_float(name, self.low, self.high, log=True)
        return trial.suggest_float(
            name, self.low, self.high, log=self.log, step=self.step
        )


@dataclass(frozen=True)
class Categorical(SearchSpec):
    """Pick one of a fixed list of choices.

    Optuna requires hashable, JSON-serialisable choices (strings, ints,
    floats, bools).
    """

    choices: tuple[Any, ...]

    def __init__(self, choices: Sequence[Any]) -> None:
        # Freeze the sequence as a tuple to match the @dataclass(frozen=True)
        # contract while still accepting plain lists at the call site.
        object.__setattr__(self, "choices", tuple(choices))

    def suggest(self, trial: "optuna.trial.Trial", name: str) -> Any:
        return trial.suggest_categorical(name, list(self.choices))


# --------------------------------------------------------------------------- #
# ParameterSearch                                                             #
# --------------------------------------------------------------------------- #
@dataclass
class ParameterSearch:
    """Wrap an Optuna study around a strategy's search space + objective.

    Parameters
    ----------
    space:
        Mapping ``{name: SearchSpec}``. Typically obtained from
        ``StrategyClass.search_space()``.
    objective_fn:
        Callable ``(params: dict) -> float``. The search *maximises* this
        scalar. A failed run should return ``-math.inf`` (never raise from
        inside the objective). See :class:`backend.tuner.objective.WalkForwardObjective`.
    direction:
        ``"maximize"`` (default) or ``"minimize"``.
    sampler:
        ``"tpe"`` (Bayesian, default) or ``"random"``.
    seed:
        RNG seed for reproducibility. ``None`` uses the sampler default.
    """

    space: Mapping[str, SearchSpec]
    objective_fn: Callable[[dict[str, Any]], float]
    direction: str = "maximize"
    sampler: str = "tpe"
    seed: int | None = None

    # -------------------------- construction -------------------------------- #
    def _build_sampler(self) -> Any:
        if optuna is None:
            raise RuntimeError(
                "optuna is not installed. `pip install optuna` (or install "
                "backend/requirements.txt) to use the tuner."
            )
        if self.sampler == "tpe":
            return TPESampler(seed=self.seed)
        if self.sampler == "random":
            return RandomSampler(seed=self.seed)
        raise ValueError(
            f"Unknown sampler {self.sampler!r}; expected 'tpe' or 'random'."
        )

    @staticmethod
    def _default_storage_path(study_name: str) -> str:
        root = Path(os.path.expanduser("~")) / ".alphadesk" / "tuner"
        root.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{root}/{study_name}.db"

    # -------------------------- core search --------------------------------- #
    def _optuna_objective(self, trial: "optuna.trial.Trial") -> float:
        params: dict[str, Any] = {}
        for name, spec in self.space.items():
            params[name] = spec.suggest(trial, name)
        try:
            value = self.objective_fn(params)
        except Exception:
            log.exception("objective_fn raised for params=%s; returning -inf.", params)
            return -math.inf
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return -math.inf
        return float(value)

    def run(
        self,
        n_trials: int,
        study_name: str,
        storage: str | None = None,
        show_progress_bar: bool = False,
        load_if_exists: bool = True,
    ) -> "optuna.Study":
        """Create or resume the study and run ``n_trials`` trials.

        Parameters
        ----------
        n_trials:
            How many new trials to execute (on top of any pre-existing ones
            when resuming).
        study_name:
            Study name; also used to derive the default SQLite filename.
        storage:
            Optuna storage URL. ``None`` -> ``sqlite:///~/.alphadesk/tuner/<study>.db``.
            Pass ``""`` for in-memory storage (useful in tests).
        show_progress_bar:
            Forwarded to Optuna. Off by default for cleaner CLI logs.
        load_if_exists:
            If True, resume an existing study with the same name; if False,
            raise when the study already exists.
        """

        if optuna is None:
            raise RuntimeError(
                "optuna is not installed. `pip install optuna` to run searches."
            )

        if storage is None:
            storage = self._default_storage_path(study_name)
        elif storage == "":
            storage = None  # in-memory

        study = optuna.create_study(
            study_name=study_name,
            storage=storage,
            sampler=self._build_sampler(),
            pruner=NopPruner(),
            direction=self.direction,
            load_if_exists=load_if_exists,
        )
        study.optimize(
            self._optuna_objective,
            n_trials=n_trials,
            show_progress_bar=show_progress_bar,
        )
        return study

    def best_params(self, study: "optuna.Study") -> dict[str, Any]:
        """Return the best parameter dict from an Optuna study.

        Wraps :attr:`optuna.Study.best_params` with a friendlier error when
        no trial completed successfully.
        """

        try:
            return dict(study.best_params)
        except ValueError as exc:
            raise RuntimeError(
                "No completed trials; the objective returned -inf for every "
                "candidate. Check the objective function and data availability."
            ) from exc


__all__ = [
    "ParameterSearch",
    "SearchSpec",
    "IntRange",
    "FloatRange",
    "Categorical",
]
