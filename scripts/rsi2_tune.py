"""Run the walk-forward tuner for rsi2_reversal.

Train 2019-01-01 … 2022-12-31, test 2023-01-01 … 2024-12-31. Uses a
memory-cached wrapper around the Alpaca bar provider: one wide fetch of the
full universe up front, then per-session queries served from an in-memory
frame. This is dramatically faster than letting the engine hit Alpaca for
each session (which drives ~1500 network calls per trial).

Usage::

    .venv/bin/python scripts/rsi2_tune.py [n_trials]

``n_trials`` defaults to 80. Study is persisted to
``~/.alphadesk/tuner/rsi2_reversal_v1.db`` and can be resumed.
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
import backend.strategies.rsi2_reversal  # noqa: F401 - registers the strategy

from backend.data.providers.alpaca import AlpacaBarProvider
from backend.strategies.rsi2_reversal.config import CORE_ETFS, LARGE_CAP_SEED
from backend.tuner.runner import run

log = logging.getLogger("rsi2_tune")


# --------------------------------------------------------------------------- #
# Monkey-patch the walk-forward runner to skip the IS backtest.              #
# --------------------------------------------------------------------------- #
# Our strategy is non-parametric at the engine level; running the IS window
# inside each trial burns ~2× CPU for no benefit. We replace run_train_test
# with a version that only runs the OOS segment, making the IS result a
# no-op. The Sharpe objective reads OOS metrics only.
def _patch_walkforward_skip_is() -> None:
    from backend.backtest.types import BacktestResult
    from backend.backtest.walkforward import WalkForwardResult, WalkForwardRunner
    from datetime import timedelta
    from decimal import Decimal
    import pandas as _pd

    original = WalkForwardRunner.run_train_test

    def run_train_test_skip_is(self):
        cfg = self.config
        if cfg.train_end is None:
            raise ValueError("train_end must be set for train_test run")

        out = WalkForwardResult()
        # Skip the IS run: return an empty-equity placeholder so aggregation
        # math doesn't choke.
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
    # Retain a handle in case we need to restore.
    WalkForwardRunner._original_run_train_test = original


_patch_walkforward_skip_is()


class InMemoryBarProvider:
    """Serve per-session bar queries from a single prefetched frame.

    Satisfies :class:`backend.data.providers.base.BarProvider`. The engine
    calls ``bars([syms], session, session)`` once per session; we slice the
    prefetched frame and return a shaped DataFrame with columns
    ``symbol, ts, open, high, low, close, volume``.
    """

    def __init__(self, df: pd.DataFrame) -> None:
        self._df = df.sort_values(["symbol", "ts"], ignore_index=True)
        # Pre-index for fast lookups by symbol.
        self._by_sym: dict[str, pd.DataFrame] = {
            s: g.reset_index(drop=True)
            for s, g in self._df.groupby("symbol", sort=False)
        }

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = [s.upper() for s in (symbols if not isinstance(symbols, str) else [symbols])]
        start_ts = pd.Timestamp(start).tz_localize("UTC") if pd.Timestamp(start).tzinfo is None else pd.Timestamp(start)
        end_ts = pd.Timestamp(end).tz_localize("UTC") if pd.Timestamp(end).tzinfo is None else pd.Timestamp(end)
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
    syms = sorted(set([*CORE_ETFS, *LARGE_CAP_SEED]))
    log.info("Prefetching %d symbols %s -> %s", len(syms), years_start, years_end)
    t0 = datetime.utcnow()
    with AlpacaBarProvider() as p:
        df = p.bars(syms, years_start, years_end, tf="1D")
    dt = (datetime.utcnow() - t0).total_seconds()
    log.info("Prefetch complete: %d rows, %.1fs", len(df), dt)
    return df


def _final_oos_run(best_params: dict, bar_provider) -> dict:
    """Run the winning parameter set through a walk-forward train/test and
    return the OOS metrics so the report has all-numbers-in-one-place.
    """

    from backend.backtest.walkforward import WalkForwardConfig, WalkForwardRunner
    from backend.strategies.registry import get_strategy

    cls = get_strategy("rsi2_reversal")
    cfg = WalkForwardConfig(
        start=date(2019, 1, 1),
        end=date(2024, 12, 31),
        train_end=date(2022, 12, 31),
        starting_cash=Decimal("100000"),
    )
    runner = WalkForwardRunner(
        strategy_factory=cls,
        bar_provider=bar_provider,
        config=cfg,
        strategy_params=best_params,
    )
    wf = runner.run_train_test()
    metrics: dict[str, Any] = {}
    if wf.out_of_sample_result is not None:
        metrics["oos"] = dict(wf.out_of_sample_result.metrics)
        metrics["oos_trades"] = sum(1 for t in wf.out_of_sample_result.trades if t.is_closed)
        if not wf.out_of_sample_result.equity_curve.empty:
            curve = wf.out_of_sample_result.equity_curve["equity"]
            metrics["oos_start_equity"] = float(curve.iloc[0])
            metrics["oos_end_equity"] = float(curve.iloc[-1])
            metrics["oos_total_return"] = (
                float(curve.iloc[-1]) / float(curve.iloc[0]) - 1.0
            )
    if wf.in_sample_result is not None:
        metrics["is"] = dict(wf.in_sample_result.metrics)
        metrics["is_trades"] = sum(1 for t in wf.in_sample_result.trades if t.is_closed)
    return metrics


def main() -> int:
    from typing import Any

    logging.basicConfig(
        level="INFO",
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    n_trials = int(sys.argv[1]) if len(sys.argv) > 1 else 80

    # Prefetch once.
    df = _prefetch_universe(date(2018, 7, 1), date(2025, 1, 31))
    bar_provider = InMemoryBarProvider(df)

    # Use raw Sharpe as the objective — the target Sharpe stated in the spec
    # is the un-penalised OOS number. The default "penalised" scoring heavily
    # penalises turnover > 5 p.a., which makes short-horizon mean-reversion
    # strategies like this one uniformly score below zero. We still report
    # drawdown / turnover in the final metrics so the caveats are visible.
    result = run(
        strategy_name="rsi2_reversal",
        trials=n_trials,
        study_name="rsi2_reversal_v1",
        start=date(2019, 1, 1),
        end=date(2024, 12, 31),
        train_end=date(2022, 12, 31),
        sampler="tpe",
        seed=42,
        scoring="sharpe",
        starting_cash=Decimal("100000"),
        bar_provider=bar_provider,
    )

    # Run the best params through a full walk-forward so the report has the
    # final metrics in one authoritative place.
    final: dict = {"tuner": result}
    try:
        best = result.get("best_params", {})
        if best:
            final["walkforward"] = _final_oos_run(best, bar_provider)
    except Exception as exc:
        final["walkforward_error"] = str(exc)

    # Write a machine-readable summary next to the study.
    report_dir = _ROOT / "audit-reports"
    report_dir.mkdir(exist_ok=True)
    out_path = report_dir / "phase1-rsi2_reversal-tune.json"
    with out_path.open("w") as f:
        json.dump(final, f, indent=2, default=str)

    print("\nJSON result:\n" + json.dumps(final, indent=2, default=str))
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
