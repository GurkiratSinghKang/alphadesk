"""Walk-forward tuner for the kama_breakout strategy.

Train 2019-01-03 ... 2022-12-30, test 2023-01-03 ... 2024-12-30. Modeled on
``scripts/rsi2_tune.py``: we prefetch the full universe once and serve
per-session queries from an in-memory frame so the tuner doesn't hit
Alpaca thousands of times. IS is skipped (our objective only reads OOS).

Usage::

    .venv/bin/python scripts/tune_kama.py [n_trials]

``n_trials`` defaults to 50. Study is persisted to
``~/.alphadesk/tuner/kama_breakout_v1.db`` and can be resumed.
"""

from __future__ import annotations

import json
import logging
import sys
import types
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path


_ROOT = Path(__file__).resolve().parent.parent
for _p in (_ROOT, _ROOT / "backend"):
    ps = str(_p)
    if ps not in sys.path:
        sys.path.insert(0, ps)

# Install stubs *before* importing strategy package so
# backend/strategies/__init__.py isn't forced to run.
if "backend" not in sys.modules:
    b = types.ModuleType("backend")
    b.__path__ = [str(_ROOT / "backend")]
    b.__file__ = "(stub)"
    sys.modules["backend"] = b
if "backend.strategies" not in sys.modules:
    stub = types.ModuleType("backend.strategies")
    stub.__path__ = [str(_ROOT / "backend" / "strategies")]
    stub.__file__ = "(stub)"
    sys.modules["backend.strategies"] = stub


import pandas as pd  # noqa: E402
import backend.strategies.kama_breakout  # noqa: F401,E402 - registers strategy

from backend.data.providers.alpaca import AlpacaBarProvider  # noqa: E402
from backend.strategies.kama_breakout.config import DEFAULT_UNIVERSE  # noqa: E402
from scripts.oos_bootstrap import attach_bootstrap_ci, bootstrap_ci_from_equity_frame  # noqa: E402

log = logging.getLogger("kama_tune")


# --------------------------------------------------------------------------- #
# Monkey-patch the walk-forward runner to skip the IS backtest.              #
# --------------------------------------------------------------------------- #
# IS is not used by the Sharpe objective. Skipping it halves tuning wall-clock.
def _patch_walkforward_skip_is() -> None:
    from backend.backtest.types import BacktestResult
    from backend.backtest.walkforward import WalkForwardRunner
    from datetime import timedelta
    import pandas as _pd

    original = WalkForwardRunner.run_train_test

    def run_train_test_skip_is(self):
        cfg = self.config
        if cfg.train_end is None:
            raise ValueError("train_end must be set for train_test run")

        from backend.backtest.walkforward import WalkForwardResult
        out = WalkForwardResult()
        # Empty-equity placeholder for IS so aggregation math doesn't choke.
        out.in_sample_result = BacktestResult(
            equity_curve=_pd.DataFrame(
                {"equity": [float(cfg.starting_cash)]},
                index=_pd.to_datetime([cfg.start]),
            ),
            trades=[],
            fills=[],
            daily_returns=_pd.Series(dtype=float),
            metrics={"sharpe": 0.0, "max_drawdown": 0.0, "cagr": 0.0},
            start=cfg.start,
            end=cfg.train_end,
        )

        oos_start = cfg.train_end + timedelta(days=1)
        if oos_start > cfg.end:
            raise ValueError("train_end must be before end")
        out.out_of_sample_result = self._run_single(oos_start, cfg.end)
        out.aggregated_metrics = dict(out.out_of_sample_result.metrics)
        return out

    WalkForwardRunner.run_train_test = run_train_test_skip_is
    WalkForwardRunner._original_run_train_test = original


_patch_walkforward_skip_is()


# --------------------------------------------------------------------------- #
# In-memory bar provider served from one wide prefetch.                      #
# --------------------------------------------------------------------------- #
class InMemoryBarProvider:
    """Serve per-session bar queries from a single prefetched frame.

    Satisfies :class:`backend.data.providers.base.BarProvider`. The strategy
    makes one call with the full needed range per symbol, so this is
    lookup-table cheap.
    """

    def __init__(self, df: pd.DataFrame) -> None:
        self._df = df.sort_values(["symbol", "ts"], ignore_index=True)
        self._by_sym: dict[str, pd.DataFrame] = {
            s: g.reset_index(drop=True)
            for s, g in self._df.groupby("symbol", sort=False)
        }

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = [s.upper() for s in (symbols if not isinstance(symbols, str) else [symbols])]
        start_ts = (
            pd.Timestamp(start).tz_localize("UTC")
            if pd.Timestamp(start).tzinfo is None
            else pd.Timestamp(start)
        )
        end_ts = (
            pd.Timestamp(end).tz_localize("UTC")
            if pd.Timestamp(end).tzinfo is None
            else pd.Timestamp(end)
        )
        end_ts = end_ts.normalize() + pd.Timedelta(hours=23, minutes=59, seconds=59)
        start_ts = start_ts.normalize()

        frames: list[pd.DataFrame] = []
        for sym in syms:
            sub = self._by_sym.get(sym)
            if sub is None or sub.empty:
                continue
            m = (sub["ts"] >= start_ts) & (sub["ts"] <= end_ts)
            sel = sub.loc[m]
            if not sel.empty:
                frames.append(sel)
        if not frames:
            return pd.DataFrame(
                columns=["symbol", "ts", "open", "high", "low", "close", "volume"]
            )
        return pd.concat(frames, ignore_index=True)


def _prefetch_universe(years_start: date, years_end: date) -> pd.DataFrame:
    syms = sorted(set(DEFAULT_UNIVERSE))
    log.info("Prefetching %d symbols %s -> %s", len(syms), years_start, years_end)
    t0 = datetime.utcnow()
    with AlpacaBarProvider() as p:
        df = p.bars(syms, years_start, years_end, tf="1D")
    dt = (datetime.utcnow() - t0).total_seconds()
    log.info("Prefetch complete: %d rows, %.1fs", len(df), dt)
    return df


# --------------------------------------------------------------------------- #
# Progress logging callback (print every 10 trials)                           #
# --------------------------------------------------------------------------- #
class _Progress:
    def __init__(self, total: int, every: int = 10) -> None:
        self.total = total
        self.every = every
        self.count = 0
        self.best = float("-inf")

    def __call__(self, params: dict, wf_result, score: float) -> None:
        self.count += 1
        if score > self.best:
            self.best = score
        if self.count % self.every == 0 or self.count == self.total:
            print(
                f"[{self.count:>3}/{self.total}] "
                f"trial_score={score:.4f}  best_so_far={self.best:.4f}",
                flush=True,
            )


# --------------------------------------------------------------------------- #
# Final OOS eval                                                              #
# --------------------------------------------------------------------------- #
def _final_oos_run(best_params: dict, bar_provider) -> dict:
    """Clean walk-forward OOS run with best params for the report."""

    from backend.backtest.walkforward import WalkForwardConfig, WalkForwardRunner
    from backend.strategies.registry import get_strategy

    cls = get_strategy("kama_breakout")
    cfg = WalkForwardConfig(
        start=date(2019, 1, 3),
        end=date(2024, 12, 30),
        train_end=date(2022, 12, 30),
        starting_cash=Decimal("100000"),
    )
    runner = WalkForwardRunner(
        strategy_factory=cls,
        bar_provider=bar_provider,
        config=cfg,
        strategy_params=best_params,
    )
    wf = runner.run_train_test()
    metrics: dict = {}
    if wf.out_of_sample_result is not None:
        metrics["oos"] = dict(wf.out_of_sample_result.metrics)
        metrics["oos_trades"] = sum(
            1 for t in wf.out_of_sample_result.trades if t.is_closed
        )
        metrics["oos_fills"] = len(wf.out_of_sample_result.fills)
        if not wf.out_of_sample_result.equity_curve.empty:
            curve = wf.out_of_sample_result.equity_curve["equity"]
            metrics["oos_start_equity"] = float(curve.iloc[0])
            metrics["oos_end_equity"] = float(curve.iloc[-1])
            metrics["oos_total_return"] = (
                float(curve.iloc[-1]) / float(curve.iloc[0]) - 1.0
            )
        attach_bootstrap_ci(
            metrics,
            bootstrap_ci_from_equity_frame(wf.out_of_sample_result.equity_curve),
        )
    return metrics


# --------------------------------------------------------------------------- #
# Main                                                                        #
# --------------------------------------------------------------------------- #
def main() -> int:
    logging.basicConfig(
        level="WARNING",  # strategy/engine logs are noisy; tuner prints progress
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # Keep the tuner logger quiet too (our progress callback prints what we need).
    logging.getLogger("alphadesk.tuner").setLevel("WARNING")

    n_trials = int(sys.argv[1]) if len(sys.argv) > 1 else 50

    # Prefetch once.
    df = _prefetch_universe(date(2018, 4, 1), date(2025, 1, 31))
    bar_provider = InMemoryBarProvider(df)

    # Build the objective directly so we control base_params / on_result.
    from backend.strategies.registry import get_strategy
    from backend.tuner.objective import WalkForwardObjective
    from backend.tuner.search import ParameterSearch

    strategy_cls = get_strategy("kama_breakout")
    space = strategy_cls.search_space()

    progress = _Progress(n_trials, every=10)

    objective = WalkForwardObjective(
        strategy_cls=strategy_cls,
        bar_provider=bar_provider,
        start=date(2019, 1, 3),
        end=date(2024, 12, 30),
        train_end=date(2022, 12, 30),
        scoring="sharpe",
        starting_cash=Decimal("100000"),
        on_result=progress,
    )

    search = ParameterSearch(
        space=space,
        objective_fn=objective,
        direction="maximize",
        sampler="tpe",
        seed=42,
    )

    study_name = "kama_breakout_v1"
    t0 = datetime.utcnow()
    print(f"Starting tuning: {n_trials} trials, study={study_name}", flush=True)
    study = search.run(
        n_trials=n_trials,
        study_name=study_name,
        storage=None,  # defaults to sqlite:///~/.alphadesk/tuner/<name>.db
        show_progress_bar=False,
        load_if_exists=True,
    )
    dt = (datetime.utcnow() - t0).total_seconds()

    try:
        best_params = search.best_params(study)
        best_value = float(study.best_value)
    except Exception:
        log.exception("No successful trials")
        best_params = {}
        best_value = float("-inf")

    print(f"\n=== Tuning complete in {dt:.1f}s ===")
    print(f"Study            : {study_name}")
    print(f"Trials           : {len(study.trials)}")
    print(f"Best TRAIN Sharpe: {best_value:.4f}")
    print("Best params:")
    width = max((len(k) for k in best_params), default=1)
    for k, v in sorted(best_params.items()):
        if isinstance(v, float):
            print(f"  {k.ljust(width)} = {v:.6g}")
        else:
            print(f"  {k.ljust(width)} = {v}")

    # Run the best params through walk-forward OOS again for report-quality metrics.
    result: dict = {
        "tuner": {
            "study_name": study_name,
            "best_params": best_params,
            "best_train_sharpe": best_value,
            "n_trials": len(study.trials),
            "wall_clock_sec": dt,
        }
    }
    try:
        if best_params:
            result["walkforward"] = _final_oos_run(best_params, bar_provider)
    except Exception as exc:
        log.exception("final OOS run failed")
        result["walkforward_error"] = str(exc)

    # Persist JSON next to the study.
    report_dir = _ROOT / "audit-reports"
    report_dir.mkdir(exist_ok=True)
    out_path = report_dir / "phase1-kama_breakout-tune.json"
    with out_path.open("w") as f:
        json.dump(result, f, indent=2, default=str)

    print("\nJSON result:\n" + json.dumps(result, indent=2, default=str))
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
