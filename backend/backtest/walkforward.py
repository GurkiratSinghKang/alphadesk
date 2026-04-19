"""Walk-forward runner.

Two modes:

1. **Train/test split.** Fit / calibrate on ``[start, train_end]``, evaluate
   out-of-sample on ``(train_end, end]``. Our strategies don't do parametric
   fitting at the engine level, but the runner still provides the clean
   partition so the caller (or tuner) can perform its own fit and hand a
   configured strategy back to the runner for the OOS evaluation.

2. **K-fold purged walk-forward.** Cut the sample into K contiguous folds and
   run one OOS backtest per fold, with a configurable purge window that
   excludes ``purge_days`` days on either side of each test fold from the
   training region. Metrics are aggregated across folds.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta

logger = logging.getLogger("alphadesk.backtest.walkforward")
from decimal import Decimal
from typing import Any, Callable, Mapping, Optional

import numpy as np
import pandas as pd

from backtest.engine import BacktestEngine, EngineConfig
from backtest.metrics import summary_dict
from backtest.types import BacktestResult


@dataclass
class WalkForwardConfig:
    start: date
    end: date
    train_end: Optional[date] = None
    k_folds: int = 0
    purge_days: int = 60
    starting_cash: Decimal = Decimal("100000")
    timeframe: str = "1D"
    benchmark: Optional[str] = None
    rf: float = 0.0
    seed: int = 42


@dataclass
class FoldResult:
    fold: int
    train_start: date
    train_end: date
    test_start: date
    test_end: date
    result: BacktestResult


@dataclass
class WalkForwardResult:
    folds: list[FoldResult] = field(default_factory=list)
    aggregated_metrics: dict[str, float] = field(default_factory=dict)
    in_sample_result: Optional[BacktestResult] = None
    out_of_sample_result: Optional[BacktestResult] = None


class WalkForwardRunner:
    """Execute the engine across walk-forward folds."""

    def __init__(
        self,
        strategy_factory: Callable[[], Any],
        bar_provider: Any,
        config: WalkForwardConfig,
        *,
        cost_model: Any = None,
        options_provider: Any = None,
        earnings_provider: Any = None,
        fundamentals_provider: Any = None,
        calendar_provider: Any = None,
        strategy_params: Optional[Mapping[str, Any]] = None,
    ) -> None:
        self.strategy_factory = strategy_factory
        self.bar_provider = bar_provider
        self.config = config
        self.cost_model = cost_model
        self.options_provider = options_provider
        self.earnings_provider = earnings_provider
        self.fundamentals_provider = fundamentals_provider
        self.calendar_provider = calendar_provider
        self.strategy_params = dict(strategy_params or {})

    # ------------------------------------------------------------------
    # Train/test
    # ------------------------------------------------------------------

    def run_train_test(self) -> WalkForwardResult:
        cfg = self.config
        if cfg.train_end is None:
            raise ValueError("train_end must be set for train_test run")

        out = WalkForwardResult()

        out.in_sample_result = self._run_single(cfg.start, cfg.train_end)
        oos_start = cfg.train_end + timedelta(days=1)
        if oos_start > cfg.end:
            raise ValueError("train_end must be before end")
        out.out_of_sample_result = self._run_single(oos_start, cfg.end)

        # Aggregated metrics are simply the OOS metrics for the train/test
        # protocol, per the design spec.
        out.aggregated_metrics = dict(out.out_of_sample_result.metrics)
        return out

    # ------------------------------------------------------------------
    # K-fold purged
    # ------------------------------------------------------------------

    def run_k_fold(self) -> WalkForwardResult:
        cfg = self.config
        if cfg.k_folds < 2:
            raise ValueError("k_folds must be >= 2")

        out = WalkForwardResult()
        sessions = self._sessions(cfg.start, cfg.end)
        if len(sessions) < cfg.k_folds:
            raise ValueError("not enough sessions for requested k_folds")

        n = len(sessions)
        fold_edges = np.linspace(0, n, cfg.k_folds + 1, dtype=int)

        for i in range(cfg.k_folds):
            test_start_idx = fold_edges[i]
            test_end_idx = fold_edges[i + 1] - 1
            test_start = sessions[test_start_idx]
            test_end = sessions[test_end_idx]

            # Train region = everything outside the test fold with a purge.
            purge = cfg.purge_days
            purge_left = max(0, test_start_idx - purge)
            purge_right = min(n - 1, test_end_idx + purge)
            train_start = sessions[0]
            # For our engine we don't actually re-fit — we still report the
            # test-region OOS result. The purge matters for tuners; here we
            # just run the engine over the test window.
            train_end = (
                sessions[purge_left - 1] if purge_left > 0 else sessions[0]
            )

            result = self._run_single(test_start, test_end)
            out.folds.append(
                FoldResult(
                    fold=i,
                    train_start=train_start,
                    train_end=train_end,
                    test_start=test_start,
                    test_end=test_end,
                    result=result,
                )
            )

        out.aggregated_metrics = self._aggregate(out.folds)
        return out

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _run_single(self, start: date, end: date) -> BacktestResult:
        cfg = self.config
        engine = BacktestEngine(
            strategy=self.strategy_factory(),
            bar_provider=self.bar_provider,
            config=EngineConfig(
                start=start,
                end=end,
                starting_cash=cfg.starting_cash,
                timeframe=cfg.timeframe,
                benchmark=cfg.benchmark,
                rf=cfg.rf,
                seed=cfg.seed,
            ),
            options_provider=self.options_provider,
            earnings_provider=self.earnings_provider,
            fundamentals_provider=self.fundamentals_provider,
            calendar_provider=self.calendar_provider,
            cost_model=self.cost_model,
            strategy_params=self.strategy_params,
        )
        return engine.run()

    def _sessions(self, start: date, end: date) -> list[date]:
        if self.calendar_provider is not None:
            try:
                return list(self.calendar_provider.sessions(start, end))
            except Exception:
                logger.debug(
                    "walkforward: calendar_provider.sessions raised — falling back to bdate_range",
                    exc_info=True,
                )
        return [d.date() for d in pd.bdate_range(start=start, end=end)]

    @staticmethod
    def _aggregate(folds: list[FoldResult]) -> dict[str, float]:
        if not folds:
            return {}
        keys = set()
        for f in folds:
            keys.update(f.result.metrics.keys())
        agg: dict[str, float] = {}
        for k in keys:
            vals = [
                float(f.result.metrics.get(k, 0.0))
                for f in folds
            ]
            vals = [v for v in vals if not (isinstance(v, float) and np.isnan(v))]
            if not vals:
                agg[k] = 0.0
                continue
            agg[f"{k}_mean"] = float(np.mean(vals))
            agg[f"{k}_std"] = float(np.std(vals))
        # Also stitch equity curves for a single OOS Sharpe across folds.
        all_returns: list[pd.Series] = []
        all_equity: list[pd.DataFrame] = []
        for f in folds:
            all_returns.append(f.result.daily_returns)
            all_equity.append(f.result.equity_curve)
        if all_returns:
            combined = pd.concat(all_returns).sort_index()
            combined = combined[~combined.index.duplicated(keep="last")]
            if not combined.empty:
                stitched_equity = (1 + combined).cumprod()
                stitched = summary_dict(stitched_equity, combined)
                for k, v in stitched.items():
                    agg[f"{k}_stitched"] = float(v)
        return agg


__all__ = ["WalkForwardRunner", "WalkForwardConfig", "WalkForwardResult", "FoldResult"]
