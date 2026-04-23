"""Optuna objective for parameter search over the unified-shell BacktestRunner.

:class:`WalkForwardObjective` wraps a single-window
:class:`~strategies._core.runners.backtest_runner.BacktestRunner` run per
trial, returning a scalar that the Optuna study maximises. Two scoring
modes, preserved byte-for-byte from the legacy F1 runner:

- ``"penalised"`` (default) -- the composite score defined in the design
  spec section 8::

      score = sharpe
              - 0.05 * max(0, turnover_yr - 5.0)
              - 0.5  * max(0, max_drawdown - 0.30)

  This penalises strategies that churn more than 500% per year (turnover
  is dollars traded / average equity, annualised) and those that suffer
  drawdowns deeper than 30%. The new BacktestRunner does not yet compute
  a turnover metric; until it does, ``turnover_yr`` falls back to 0 and
  the turnover penalty is suppressed. The drawdown penalty is active.

- ``"sharpe"`` -- returns raw Sharpe, no penalties. Useful for sanity
  checks and baseline comparisons.

The objective never raises; a failed backtest (provider error, strategy
crash, invalid parameter combo caught by Pydantic) returns ``-math.inf``
so Optuna can move on.

Walk-forward is the caller's concern
------------------------------------

The legacy F1 harness invoked :class:`WalkForwardRunner` inside the
objective and exposed a ``tune_on`` flag to select IS vs OOS metrics.
Under the new runner contract, walk-forward splitting is explicit — the
caller runs the objective over a training window, picks the best params,
then (and only then) evaluates on a held-out window. This objective does
NOT introspect train/test legs; the ``tune_on`` kwarg is kept for API
back-compat but is inert.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Callable, Literal, Mapping, Optional

from pydantic import ValidationError

from strategies._core.contracts import BacktestConfig, BacktestResult, StrategyParams
from strategies._core.runners.backtest_runner import BacktestRunner

log = logging.getLogger("alphadesk.tuner.objective")

# Trading days used to annualise cumulative turnover. Matches the F1 metrics
# module (``TRADING_DAYS = 252``).
TRADING_DAYS = 252


@dataclass
class WalkForwardObjective:
    """Callable Optuna objective that drives a single-window backtest.

    Name retained for back-compat (the old class name is imported by
    :mod:`tuner.runner`). Internally this runs one
    :class:`~strategies._core.runners.backtest_runner.BacktestRunner`
    per trial; walk-forward is the caller's concern (see module docstring).

    Parameters
    ----------
    strategy_cls:
        A :class:`~strategies._core.protocol.Strategy` subclass. Must
        declare ``PARAMS_MODEL`` (the Pydantic :class:`StrategyParams`
        subclass whose fields define the search space).
    bar_provider:
        Concrete :class:`~strategies._core.providers.BarProvider`. Required.
    start, end:
        Backtest window. The same window is used for every trial; the
        caller is responsible for later evaluating the winner on a
        held-out OOS window.
    scoring:
        ``"penalised"`` (default) or ``"sharpe"``.
    turnover_threshold_annual, turnover_penalty_coef,
    drawdown_threshold, drawdown_penalty_coef:
        Coefficients for the composite score. Defaults match the legacy
        F1 formula byte-for-byte.
    starting_cash:
        Backtest starting cash. Defaults to ``Decimal("100000")``.
    earnings_provider, fundamentals_provider:
        Optional providers forwarded to :class:`BacktestRunner`.
    params_model:
        Override the :class:`StrategyParams` subclass used to validate
        trial params. Defaults to ``strategy_cls.PARAMS_MODEL``.
    base_params:
        Param dict merged below the trial-suggested params. Lets callers
        pin non-search fields without threading them through the space.
    on_result:
        Optional callback ``(params, result, score)`` invoked after each
        trial. Used by the runner CLI to log progress.
    tune_on:
        Back-compat kwarg (legacy API accepted ``"train"``/``"test"``).
        Inert under the new runner — the objective only sees a single
        window. Validation is kept so typos fail loudly.
    """

    strategy_cls: type
    bar_provider: Any
    start: date
    end: date
    scoring: str = "penalised"
    turnover_threshold_annual: float = 5.0
    turnover_penalty_coef: float = 0.05
    drawdown_threshold: float = 0.30
    drawdown_penalty_coef: float = 0.5
    starting_cash: Decimal = Decimal("100000")
    earnings_provider: Any = None
    fundamentals_provider: Any = None
    # Legacy WF-harness knobs — retained for API compatibility with the
    # existing tuner/runner CLI but inert under the new runner path.
    train_end: Optional[date] = None
    k_folds: int = 5
    purge_days: int = 60
    options_provider: Any = None
    calendar_provider: Any = None
    cost_model: Any = None
    params_model: Optional[type[StrategyParams]] = None
    base_params: Mapping[str, Any] | None = None
    on_result: Optional[Callable[[dict, Any, float], None]] = None
    tune_on: Literal["train", "test"] = "train"

    # Validation ----------------------------------------------------------- #
    def __post_init__(self) -> None:
        if self.scoring not in {"penalised", "sharpe"}:
            raise ValueError(
                f"scoring={self.scoring!r}; expected 'penalised' or 'sharpe'."
            )
        if self.tune_on not in {"train", "test"}:
            raise ValueError(
                f"tune_on={self.tune_on!r}; expected 'train' or 'test'."
            )
        if self.params_model is None:
            pm = getattr(self.strategy_cls, "PARAMS_MODEL", None)
            if pm is None:
                raise ValueError(
                    f"{self.strategy_cls.__name__} does not declare PARAMS_MODEL; "
                    "pass params_model= explicitly."
                )
            self.params_model = pm

    # Main entry ----------------------------------------------------------- #
    def __call__(self, params: Mapping[str, Any]) -> float:
        """Run the backtest with ``params`` and return a score.

        Never raises; invalid params (ValidationError from Pydantic) and
        backtest failures both map to ``-math.inf`` so Optuna moves on.
        """

        merged = dict(self.base_params or {})
        merged.update(params)

        # Build the Pydantic params instance. Extra-forbid + frozen
        # StrategyParams means typos, out-of-range values, and unknown
        # fields all raise ValidationError here.
        try:
            validated: StrategyParams = self.params_model(**merged)
        except ValidationError as exc:
            log.warning(
                "trial params failed validation: %s — returning -inf", exc,
            )
            return -math.inf

        try:
            result = self._run_backtest(validated)
        except Exception:
            log.exception(
                "backtest failed for params=%s; returning -inf.", merged,
            )
            return -math.inf

        score = self._score_from_result(result)

        if self.on_result is not None:
            try:
                self.on_result(dict(merged), result, score)
            except Exception:
                log.exception("on_result callback raised; continuing.")

        return score

    # Sub-tasks ------------------------------------------------------------ #
    def _run_backtest(self, params: StrategyParams) -> BacktestResult:
        """Drive the unified-shell :class:`BacktestRunner` for one trial."""

        strategy = self.strategy_cls()
        cfg = BacktestConfig(
            start=self.start,
            end=self.end,
            starting_cash=self.starting_cash,
        )
        runner = BacktestRunner(
            strategy=strategy,
            config=cfg,
            bar_provider=self.bar_provider,
            earnings_provider=self.earnings_provider,
            fundamentals_provider=self.fundamentals_provider,
        )
        return runner.run(params)

    def _score_from_result(self, result: BacktestResult) -> float:
        """Pull metrics from a :class:`BacktestResult` and apply the score formula.

        Preserves the legacy penalised formula byte-for-byte:

            score = sharpe
                    - 0.05 * max(0, turnover_yr - 5.0)
                    - 0.5  * max(0, max_drawdown - 0.30)
        """

        metrics = dict(result.metrics or {})
        if not metrics:
            log.warning("backtest result had no metrics; returning -inf.")
            return -math.inf

        sharpe_val = float(metrics.get("sharpe", 0.0))
        if math.isnan(sharpe_val) or math.isinf(sharpe_val):
            return -math.inf

        if self.scoring == "sharpe":
            return sharpe_val

        # Penalised composite. ``max_drawdown`` from the new runner is
        # signed (negative number); legacy code used ``abs(...)``.
        mdd_raw = float(metrics.get("max_drawdown", 0.0))
        mdd = abs(mdd_raw)
        turnover_annual = self._annualised_turnover(result, metrics)

        turnover_pen = self.turnover_penalty_coef * max(
            0.0, turnover_annual - self.turnover_threshold_annual
        )
        dd_pen = self.drawdown_penalty_coef * max(0.0, mdd - self.drawdown_threshold)
        score = sharpe_val - turnover_pen - dd_pen
        log.debug(
            "score=%.4f sharpe=%.4f turnover_yr=%.3f mdd=%.3f penalties=(%.4f, %.4f)",
            score, sharpe_val, turnover_annual, mdd, turnover_pen, dd_pen,
        )
        return score

    # Helpers -------------------------------------------------------------- #
    def _annualised_turnover(
        self, result: BacktestResult, metrics: dict[str, float],
    ) -> float:
        """Annualise cumulative turnover when the runner exposes it.

        The new :class:`BacktestRunner._compute_metrics` does not yet
        compute turnover — the metric is a Phase-3 TODO. Falling back to
        0 disables the turnover penalty but keeps the drawdown penalty
        active, which is the minimum the legacy formula needs.
        """

        cum_turnover = float(metrics.get("turnover", 0.0))
        if cum_turnover <= 0:
            return 0.0

        n_days = self._count_days(result)
        if n_days <= 0:
            return cum_turnover
        return cum_turnover * (TRADING_DAYS / n_days)

    @staticmethod
    def _count_days(result: BacktestResult) -> int:
        """Trading-day count used for turnover annualisation."""
        returns = getattr(result, "daily_returns", None)
        if returns is None:
            return 0
        try:
            return int(len(returns))
        except TypeError:
            return 0


# --------------------------------------------------------------------------- #
# tune_space() -> SearchSpec translation                                      #
# --------------------------------------------------------------------------- #
def search_space_from_params_model(
    params_model: type[StrategyParams],
) -> dict[str, Any]:
    """Translate a ``StrategyParams.tune_space()`` dict into :mod:`tuner.search`.

    Returns ``dict[str, SearchSpec]`` suitable for
    :class:`~tuner.search.ParameterSearch.space`.
    """

    from tuner.search import Categorical, FloatRange, IntRange

    raw = params_model.tune_space()
    space: dict[str, Any] = {}
    for name, cfg in raw.items():
        t = cfg.get("type")
        if t == "float":
            space[name] = FloatRange(
                low=float(cfg["low"]),
                high=float(cfg["high"]),
                log=bool(cfg.get("log", False)),
                step=cfg.get("step"),
            )
        elif t == "int":
            space[name] = IntRange(
                low=int(cfg["low"]),
                high=int(cfg["high"]),
                step=int(cfg.get("step", 1)),
            )
        elif t == "categorical":
            space[name] = Categorical(cfg["choices"])
        else:
            raise ValueError(
                f"Unknown tune-space entry type {t!r} on param {name!r}; "
                "expected 'float', 'int', or 'categorical'."
            )
    return space


__all__ = [
    "WalkForwardObjective",
    "TRADING_DAYS",
    "search_space_from_params_model",
]
