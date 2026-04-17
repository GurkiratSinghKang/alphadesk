"""Walk-forward objective function for parameter search.

:class:`WalkForwardObjective` wraps F1's :class:`WalkForwardRunner` and
returns a single scalar that the Optuna study maximises. Two scoring modes:

- ``"penalised"`` (default) -- the composite score defined in the design
  spec section 8::

      score = sharpe
              - 0.05 * max(0, turnover_yr - 5.0)
              - 0.5  * max(0, max_drawdown - 0.30)

  This penalises strategies that churn more than 500% per year (turnover is
  expressed as dollars traded divided by average equity, annualised) and
  those that suffer drawdowns deeper than 30%.

- ``"sharpe"`` -- returns raw OOS Sharpe, no penalties. Useful for sanity
  checks and baseline comparisons.

The objective never raises; a failed backtest (data missing, strategy crash,
engine error) returns ``-math.inf`` so Optuna can move on to the next trial.

Coordinating with F1 (walk-forward harness)
-------------------------------------------

Train/test leakage is the walk-forward harness's job, not ours. We simply
call :meth:`WalkForwardRunner.run_train_test` (primary protocol: train
2019-01 ... 2022-12, test 2023-01 ... 2024-12) or ``run_k_fold`` as the
caller requested. The returned :class:`WalkForwardResult` already contains
only OOS metrics for scoring.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Callable, Mapping, Optional

from backend.backtest.types import BacktestResult

log = logging.getLogger("alphadesk.tuner.objective")

# Trading days used to annualise cumulative turnover. Matches the F1 metrics
# module (``TRADING_DAYS = 252``).
TRADING_DAYS = 252


@dataclass
class WalkForwardObjective:
    """Callable Optuna objective that drives a walk-forward backtest.

    Parameters
    ----------
    strategy_cls:
        The strategy class registered via :func:`register_strategy`.
    bar_provider:
        Concrete :class:`BarProvider`. Required.
    start, end:
        Full date range for the walk-forward study.
    train_end:
        For the train/test protocol, the last calendar day in the training
        window. If omitted, a 5-fold purged walk-forward is used instead
        (``k_folds=5`` by default, override via ``k_folds``).
    k_folds, purge_days:
        Forwarded to :class:`WalkForwardConfig` when ``train_end`` is None.
    scoring:
        ``"penalised"`` (default) or ``"sharpe"``.
    turnover_threshold_annual:
        Annualised turnover above this triggers the linear penalty.
        Default 5.0 (i.e. 500%).
    turnover_penalty_coef:
        Multiplier on ``max(0, turnover_yr - threshold)``. Default 0.05.
    drawdown_threshold:
        Absolute max drawdown above this triggers the linear penalty.
        Default 0.30 (30%).
    drawdown_penalty_coef:
        Multiplier on ``max(0, mdd - threshold)``. Default 0.5.
    starting_cash:
        Engine starting cash. Defaults to ``Decimal("100000")``.
    options_provider, earnings_provider, fundamentals_provider,
    calendar_provider, cost_model:
        Optional engine wiring; forwarded to :class:`WalkForwardRunner`.
    base_params:
        Parameter dict merged below the trial-suggested params. Lets the
        caller pin non-search knobs (e.g. risk-free rate) without threading
        them through the search space.
    on_result:
        Optional callback ``(params, wf_result, score)`` invoked after each
        trial. Used by the runner CLI to log progress.
    """

    strategy_cls: type
    bar_provider: Any
    start: date
    end: date
    train_end: Optional[date] = None
    k_folds: int = 5
    purge_days: int = 60
    scoring: str = "penalised"
    turnover_threshold_annual: float = 5.0
    turnover_penalty_coef: float = 0.05
    drawdown_threshold: float = 0.30
    drawdown_penalty_coef: float = 0.5
    starting_cash: Decimal = Decimal("100000")
    options_provider: Any = None
    earnings_provider: Any = None
    fundamentals_provider: Any = None
    calendar_provider: Any = None
    cost_model: Any = None
    base_params: Mapping[str, Any] | None = None
    on_result: Optional[Callable[[dict, Any, float], None]] = None

    # Validation ----------------------------------------------------------- #
    def __post_init__(self) -> None:
        if self.scoring not in {"penalised", "sharpe"}:
            raise ValueError(
                f"scoring={self.scoring!r}; expected 'penalised' or 'sharpe'."
            )

    # Main entry ----------------------------------------------------------- #
    def __call__(self, params: Mapping[str, Any]) -> float:
        """Run the walk-forward backtest with ``params`` and return a score.

        Never raises; failures map to ``-math.inf``.
        """

        merged = dict(self.base_params or {})
        merged.update(params)

        try:
            wf_result = self._run_walkforward(merged)
        except Exception:
            log.exception(
                "walk-forward backtest failed for params=%s; returning -inf.",
                merged,
            )
            return -math.inf

        score = self._score_from_result(wf_result)

        if self.on_result is not None:
            try:
                self.on_result(dict(merged), wf_result, score)
            except Exception:
                log.exception("on_result callback raised; continuing.")

        return score

    # Sub-tasks ------------------------------------------------------------ #
    def _run_walkforward(self, params: Mapping[str, Any]) -> Any:
        """Invoke the F1 walk-forward runner with the given parameter set."""

        # Deferred import so the objective module can still be imported (and
        # tested) in environments that haven't yet installed the engine's
        # heavy dependencies (pandas, numpy are already required but engine
        # features like cost models may pull additional packages).
        from backend.backtest.walkforward import (
            WalkForwardConfig,
            WalkForwardRunner,
        )

        cfg = WalkForwardConfig(
            start=self.start,
            end=self.end,
            train_end=self.train_end,
            k_folds=self.k_folds if self.train_end is None else 0,
            purge_days=self.purge_days,
            starting_cash=self.starting_cash,
        )
        runner = WalkForwardRunner(
            strategy_factory=self.strategy_cls,
            bar_provider=self.bar_provider,
            config=cfg,
            cost_model=self.cost_model,
            options_provider=self.options_provider,
            earnings_provider=self.earnings_provider,
            fundamentals_provider=self.fundamentals_provider,
            calendar_provider=self.calendar_provider,
            strategy_params=dict(params),
        )
        if self.train_end is not None:
            return runner.run_train_test()
        return runner.run_k_fold()

    def _score_from_result(self, wf_result: Any) -> float:
        """Pull the relevant metrics out of a walk-forward result."""

        metrics = self._extract_oos_metrics(wf_result)
        if not metrics:
            log.warning("walk-forward result had no metrics; returning -inf.")
            return -math.inf

        sharpe_val = float(metrics.get("sharpe", metrics.get("sharpe_mean", 0.0)))
        if math.isnan(sharpe_val) or math.isinf(sharpe_val):
            return -math.inf

        if self.scoring == "sharpe":
            return sharpe_val

        # Penalised composite
        mdd = float(metrics.get("max_drawdown", metrics.get("max_drawdown_mean", 0.0)))
        turnover_annual = self._annualised_turnover(wf_result, metrics)

        turnover_pen = self.turnover_penalty_coef * max(
            0.0, turnover_annual - self.turnover_threshold_annual
        )
        dd_pen = self.drawdown_penalty_coef * max(0.0, mdd - self.drawdown_threshold)
        score = sharpe_val - turnover_pen - dd_pen
        log.debug(
            "score=%.4f sharpe=%.4f turnover_yr=%.3f mdd=%.3f penalties=(%.4f, %.4f)",
            score,
            sharpe_val,
            turnover_annual,
            mdd,
            turnover_pen,
            dd_pen,
        )
        return score

    # Helpers -------------------------------------------------------------- #
    @staticmethod
    def _extract_oos_metrics(wf_result: Any) -> dict[str, float]:
        """Pull the OOS metrics dict from a :class:`WalkForwardResult`.

        The F1 runner exposes two shapes:

        * train/test -> ``wf_result.out_of_sample_result.metrics``
        * k-fold    -> ``wf_result.aggregated_metrics``

        We return the richer dict -- aggregated for k-fold, OOS for
        train/test -- and let the caller look up keys.
        """

        oos: BacktestResult | None = getattr(wf_result, "out_of_sample_result", None)
        aggregated = dict(getattr(wf_result, "aggregated_metrics", {}) or {})
        if oos is not None and oos.metrics:
            merged = dict(oos.metrics)
            merged.update(aggregated)
            return merged
        return aggregated

    def _annualised_turnover(self, wf_result: Any, metrics: dict[str, float]) -> float:
        """Annualise cumulative turnover.

        ``backend.backtest.metrics.turnover`` returns cumulative
        ``sum(|notional|) / mean(equity)`` over the backtest window. We
        annualise by scaling with ``252 / n_trading_days``. This matches the
        design-spec phrasing "turnover_yr".
        """

        cum_turnover = float(
            metrics.get("turnover", metrics.get("turnover_mean", 0.0))
        )
        if cum_turnover <= 0:
            return 0.0

        n_days = self._count_days(wf_result)
        if n_days <= 0:
            return cum_turnover
        return cum_turnover * (TRADING_DAYS / n_days)

    @staticmethod
    def _count_days(wf_result: Any) -> int:
        """Number of bars in the OOS window (used to annualise ratios)."""

        oos: BacktestResult | None = getattr(wf_result, "out_of_sample_result", None)
        if oos is not None and getattr(oos, "daily_returns", None) is not None:
            return int(len(oos.daily_returns))
        folds = getattr(wf_result, "folds", None) or []
        total = 0
        for f in folds:
            if getattr(f, "result", None) is not None:
                total += int(len(f.result.daily_returns))
        return total


__all__ = ["WalkForwardObjective", "TRADING_DAYS"]
