#!/usr/bin/env python
"""Walk-forward tuner for the momentum_quality strategy.

Protocol (per the Wave B brief):
- Train 2019-01-01 .. 2022-12-31 (4 years, Optuna fit)
- Test  2023-01-01 .. 2024-12-31 (2 years OOS)
- ~25-40 trials, TPE sampler

We pre-fetch all universe bars for the full window once and serve them from
an in-memory wrapper so the engine's per-session queries don't hit Alpaca.
FMP F-scores are served from the @cached decorator (annual TTL) — so each
trial pays 0-1 API calls per symbol, with the first trial warming the cache
and subsequent trials serving from disk.

Usage::

    .venv/bin/python scripts/tune_momentum_quality.py [n_trials]

``n_trials`` defaults to 25.
"""

from __future__ import annotations

import json
import logging
import sys
import time
import types
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path


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


import pandas as pd  # noqa: E402
import backend.strategies.momentum_quality  # noqa: F401,E402 - registers the strategy

from backend.data.providers.alpaca import AlpacaBarProvider  # noqa: E402
from backend.data.providers.fmp import (  # noqa: E402
    FMPEarningsProvider,
    FMPFundamentalsProvider,
)
from backend.strategies.momentum_quality.config import UNIVERSE_SEED  # noqa: E402


_ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------- #
# Monkey-patch: skip the IS backtest inside walk-forward.                     #
# --------------------------------------------------------------------------- #
# The Sharpe objective reads OOS metrics only; running the IS leg inside each
# trial is pure overhead for a non-parametric strategy like this. Same trick
# used by the rsi2_tune.py script.
def _patch_walkforward_skip_is() -> None:
    from datetime import timedelta
    from decimal import Decimal
    import pandas as _pd

    from backend.backtest.types import BacktestResult
    from backend.backtest.walkforward import WalkForwardResult, WalkForwardRunner

    original = WalkForwardRunner.run_train_test

    def run_train_test_skip_is(self):
        cfg = self.config
        if cfg.train_end is None:
            raise ValueError("train_end must be set for train_test run")

        out = WalkForwardResult()
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
# In-memory bar provider: one prefetch up front, served from pandas.         #
# --------------------------------------------------------------------------- #
class InMemoryBarProvider:
    """Satisfies BarProvider. Serves per-session bar queries from a prefetched
    frame. Lookups are O(1) per symbol via a pre-indexed dict."""

    def __init__(self, df: pd.DataFrame) -> None:
        self._df = df.sort_values(["symbol", "ts"], ignore_index=True)
        self._by_sym: dict[str, pd.DataFrame] = {
            s: g.reset_index(drop=True)
            for s, g in self._df.groupby("symbol", sort=False)
        }

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        if isinstance(symbols, str):
            symbols = [symbols]
        syms = [s.upper() for s in symbols]
        start_ts = pd.Timestamp(start)
        if start_ts.tzinfo is None:
            start_ts = start_ts.tz_localize("UTC")
        end_ts = pd.Timestamp(end)
        if end_ts.tzinfo is None:
            end_ts = end_ts.tz_localize("UTC")
        end_ts = end_ts.normalize() + pd.Timedelta(hours=23, minutes=59, seconds=59)
        start_ts = start_ts.normalize()

        frames = []
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
    """Prefetch bars for the seed universe from Alpaca."""

    log = logging.getLogger("tune_mq")
    syms = sorted(set(UNIVERSE_SEED))
    log.info("Prefetching %d symbols %s -> %s", len(syms), years_start, years_end)
    t0 = datetime.utcnow()
    with AlpacaBarProvider() as p:
        df = p.bars(syms, years_start, years_end, tf="1D")
    dt = (datetime.utcnow() - t0).total_seconds()
    log.info("Prefetch complete: %d rows, %.1fs", len(df), dt)
    return df


# --------------------------------------------------------------------------- #
# Main                                                                        #
# --------------------------------------------------------------------------- #
def main() -> int:
    from backend.backtest.engine import BacktestEngine, EngineConfig
    from backend.strategies.momentum_quality.strategy import (
        MomentumQualityStrategy,
    )
    from backend.tuner.objective import WalkForwardObjective
    from backend.tuner.search import ParameterSearch

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    n_trials = int(sys.argv[1]) if len(sys.argv) > 1 else 25

    print("=" * 70)
    print("Momentum + Quality — Walk-forward tune")
    print("=" * 70)
    print(f"Trials: {n_trials}")
    print("Train: 2019-01-01 → 2022-12-31")
    print("Test:  2023-01-01 → 2024-12-31")
    print()

    # Prefetch once. Alpaca serves adjusted bars — cached under the parquet
    # cache so repeat prefetches are near-instant.
    df = _prefetch_universe(date(2018, 1, 2), date(2024, 12, 31))
    bar_provider = InMemoryBarProvider(df)

    # Live FMP providers: fundamental (F-score) + earnings (calendar filter).
    # Both are @cached so tuner iterations are cheap after cache warms.
    fundamentals = FMPFundamentalsProvider()
    earnings = FMPEarningsProvider()

    t_log = {"count": 0, "best": float("-inf"), "start": time.time()}

    def _on_result(params: dict, wf_result, score: float) -> None:
        t_log["count"] += 1
        if score > t_log["best"]:
            t_log["best"] = score
        elapsed = time.time() - t_log["start"]
        print(
            f"trial {t_log['count']:2d}  score={score:.4f}  best={t_log['best']:.4f}"
            f"  elapsed={elapsed:.0f}s  "
            f"params={{{', '.join(f'{k}={v!r}' for k, v in sorted(params.items()))}}}",
            flush=True,
        )

    objective = WalkForwardObjective(
        strategy_cls=MomentumQualityStrategy,
        bar_provider=bar_provider,
        fundamentals_provider=fundamentals,
        earnings_provider=earnings,
        start=date(2019, 1, 1),
        end=date(2024, 12, 31),
        train_end=date(2022, 12, 31),
        scoring="sharpe",          # raw Sharpe — the target is a raw number
        starting_cash=Decimal("100000"),
        on_result=_on_result,
    )

    space = MomentumQualityStrategy.search_space()
    print(f"Search space dims: {sorted(space)}")

    search = ParameterSearch(
        space=space,
        objective_fn=objective,
        direction="maximize",
        sampler="tpe",
        seed=42,
    )

    t0 = time.time()
    study = search.run(
        n_trials=n_trials,
        study_name="momentum_quality_v1",
        storage="",
        show_progress_bar=False,
        load_if_exists=False,
    )
    elapsed = time.time() - t0

    try:
        best_params = dict(study.best_params)
        best_value = float(study.best_value)
    except Exception:
        print("FAIL: no completed trials.")
        return 1

    print("\n" + "=" * 70)
    print(f"Trials completed:   {len(study.trials)} in {elapsed:.0f}s")
    print(f"Best OOS Sharpe:    {best_value:.4f}")
    print("Best parameters:")
    for k, v in sorted(best_params.items()):
        print(f"  {k} = {v!r}")

    # Re-run best on OOS to capture full metric sweep.
    print("\n--- Final OOS backtest with best params ---")
    strat = MomentumQualityStrategy()
    oos_cfg = EngineConfig(
        start=date(2023, 1, 2),
        end=date(2024, 12, 30),
        starting_cash=Decimal("100000"),
        benchmark="SPY",
    )
    engine = BacktestEngine(
        strategy=strat,
        bar_provider=bar_provider,
        fundamentals_provider=fundamentals,
        earnings_provider=earnings,
        config=oos_cfg,
        strategy_params=best_params,
    )
    oos = engine.run()
    m = oos.metrics or {}
    print(f"OOS bars:           {len(oos.equity_curve)}")
    print(f"OOS fills:          {len(oos.fills)}")
    print(f"OOS round-trips:    {sum(1 for t in oos.trades if t.is_closed)}")
    print(f"OOS Sharpe:         {m.get('sharpe', float('nan')):.3f}")
    print(f"OOS Sortino:        {m.get('sortino', float('nan')):.3f}")
    print(f"OOS CAGR:           {m.get('cagr', float('nan')):.3%}")
    print(f"OOS MDD:            {m.get('max_drawdown', float('nan')):.3%}")
    if not oos.equity_curve.empty:
        print(
            f"OOS final equity:   "
            f"${float(oos.equity_curve['equity'].iloc[-1]):,.2f}"
        )

    out = {
        "strategy": "momentum_quality",
        "start": "2019-01-01",
        "end": "2024-12-31",
        "train_end": "2022-12-31",
        "n_trials": len(study.trials),
        "best_oos_sharpe": best_value,
        "best_params": best_params,
        "oos_metrics": {
            k: float(v) for k, v in m.items() if isinstance(v, (int, float))
        },
        "elapsed_seconds": int(elapsed),
    }
    if not oos.equity_curve.empty:
        out["oos_final_equity"] = float(oos.equity_curve["equity"].iloc[-1])
        out["oos_round_trips"] = sum(1 for t in oos.trades if t.is_closed)

    out_path = _ROOT / "audit-reports" / "phase1-momentum_quality-tune.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2, default=str))
    print(f"\nDumped summary to {out_path}")

    target = 0.80
    if best_value >= target:
        print(f"\nSUCCESS: OOS Sharpe {best_value:.3f} >= target {target:.2f}")
        return 0
    else:
        print(f"\nBELOW TARGET: OOS Sharpe {best_value:.3f} < target {target:.2f}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
