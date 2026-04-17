"""Walk-forward tuner for the vwap strategy.

Prefetches all intraday + daily data once, then runs Optuna trials over
an in-memory provider to avoid per-trial network latency.

Train 2023-01-01 → 2023-12-31 / test 2024-01-01 → 2024-06-30
(shorter windows because intraday data is expensive to cache + simulate).

Usage::

    .venv/bin/python scripts/vwap_tune.py [n_trials]

Default n_trials = 15. Study persisted to
``~/.alphadesk/tuner/vwap_v1.db``.
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
import backend.strategies.vwap  # noqa: F401 - registers the strategy

from backend.data.providers.alpaca import AlpacaBarProvider
from backend.strategies.vwap.config import UNIVERSE, SPY
from backend.tuner.runner import run

log = logging.getLogger("vwap_tune")


# --------------------------------------------------------------------------- #
# Monkey-patch walk-forward runner to skip the IS backtest — match the
# pattern used by `rsi2_tune.py`.
# --------------------------------------------------------------------------- #
def _patch_walkforward_skip_is() -> None:
    from backend.backtest.types import BacktestResult
    from backend.backtest.walkforward import WalkForwardResult, WalkForwardRunner
    from datetime import timedelta
    import pandas as _pd

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


class InMemoryBarProvider:
    """Serves daily AND 5-min bars from prefetched frames."""

    def __init__(self, daily_df: pd.DataFrame, intraday_by_date: dict) -> None:
        self._daily = daily_df.sort_values(["symbol", "ts"], ignore_index=True)
        # index for fast slicing
        self._daily_by_sym: dict[str, pd.DataFrame] = {
            s: g.reset_index(drop=True)
            for s, g in self._daily.groupby("symbol", sort=False)
        }
        # intraday: dict[(symbol, date)] -> DataFrame
        self._intraday = intraday_by_date

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = [
            s.upper()
            for s in (symbols if not isinstance(symbols, str) else [symbols])
        ]
        if tf in ("1D", "1d", "1Day"):
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
            end_ts = end_ts.normalize() + pd.Timedelta(
                hours=23, minutes=59, seconds=59
            )
            start_ts = start_ts.normalize()
            frames: list[pd.DataFrame] = []
            for sym in syms:
                sub = self._daily_by_sym.get(sym)
                if sub is None or sub.empty:
                    continue
                m = (sub["ts"] >= start_ts) & (sub["ts"] <= end_ts)
                sel = sub.loc[m]
                if not sel.empty:
                    frames.append(sel)
            if not frames:
                return pd.DataFrame(
                    columns=[
                        "symbol", "ts", "open", "high", "low", "close", "volume"
                    ]
                )
            return pd.concat(frames, ignore_index=True)
        elif tf in ("5Min", "5min"):
            # Strategy always calls bars([sym], asof, asof, tf='5Min').
            if hasattr(start, "date"):
                the_date = start.date()
            else:
                the_date = start
            frames = []
            for sym in syms:
                df = self._intraday.get((sym, the_date))
                if df is not None and not df.empty:
                    frames.append(df)
            if not frames:
                return pd.DataFrame(
                    columns=[
                        "symbol", "ts", "open", "high", "low", "close", "volume"
                    ]
                )
            return pd.concat(frames, ignore_index=True)
        raise ValueError(f"unsupported tf {tf!r}")


def _prefetch_daily(years_start: date, years_end: date) -> pd.DataFrame:
    syms = sorted(set([*UNIVERSE, SPY]))
    log.info("Prefetching daily bars: %d syms %s -> %s", len(syms), years_start, years_end)
    t0 = datetime.utcnow()
    with AlpacaBarProvider() as p:
        df = p.bars(syms, years_start, years_end, tf="1D")
    dt = (datetime.utcnow() - t0).total_seconds()
    log.info("Daily prefetch: %d rows in %.1fs", len(df), dt)
    return df


def _prefetch_intraday(
    years_start: date, years_end: date
) -> dict[tuple[str, date], pd.DataFrame]:
    """Prefetch 5-min bars per symbol across the full window, then
    split by (symbol, date) for the engine's daily-session lookup.
    """

    syms = list(UNIVERSE)
    log.info(
        "Prefetching 5-min bars: %d syms %s -> %s", len(syms), years_start, years_end
    )
    t0 = datetime.utcnow()
    out: dict[tuple[str, date], pd.DataFrame] = {}
    with AlpacaBarProvider() as p:
        # Fetch per-symbol (one symbol at a time) to keep memory lower.
        # Alpaca's 5-min endpoint returns the full range, paginated.
        for sym in syms:
            df = p.bars([sym], years_start, years_end, tf="5Min")
            if df is None or df.empty:
                log.warning("No intraday bars for %s", sym)
                continue
            df = pd.DataFrame(df)
            df["ts"] = pd.to_datetime(df["ts"], utc=True)
            # Group by calendar date (UTC).
            df["date"] = df["ts"].dt.date
            for day, group in df.groupby("date"):
                out[(sym.upper(), day)] = group.drop(columns=["date"]).reset_index(
                    drop=True
                )
    dt = (datetime.utcnow() - t0).total_seconds()
    log.info("Intraday prefetch: %d (sym, day) frames in %.1fs", len(out), dt)
    return out


def _final_oos_run(best_params: dict, bar_provider) -> dict:
    from typing import Any
    from backend.backtest.walkforward import WalkForwardConfig, WalkForwardRunner
    from backend.strategies.registry import get_strategy

    cls = get_strategy("vwap")
    cfg = WalkForwardConfig(
        start=date(2023, 1, 1),
        end=date(2024, 6, 30),
        train_end=date(2023, 12, 31),
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
        metrics["oos_trades"] = sum(
            1 for t in wf.out_of_sample_result.trades if t.is_closed
        )
        if not wf.out_of_sample_result.equity_curve.empty:
            curve = wf.out_of_sample_result.equity_curve["equity"]
            metrics["oos_start_equity"] = float(curve.iloc[0])
            metrics["oos_end_equity"] = float(curve.iloc[-1])
            metrics["oos_total_return"] = (
                float(curve.iloc[-1]) / float(curve.iloc[0]) - 1.0
            )
    return metrics


def main() -> int:
    logging.basicConfig(
        level="INFO",
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    n_trials = int(sys.argv[1]) if len(sys.argv) > 1 else 15

    # Windows: 2023 train / 2024-H1 test. Shorter due to intraday cost.
    prefetch_start = date(2022, 6, 1)  # warmup
    prefetch_end = date(2024, 6, 30)

    daily_df = _prefetch_daily(prefetch_start, prefetch_end)
    intraday_map = _prefetch_intraday(prefetch_start, prefetch_end)
    bar_provider = InMemoryBarProvider(daily_df, intraday_map)

    result = run(
        strategy_name="vwap",
        trials=n_trials,
        study_name="vwap_v1",
        start=date(2023, 1, 1),
        end=date(2024, 6, 30),
        train_end=date(2023, 12, 31),
        sampler="tpe",
        seed=42,
        scoring="sharpe",
        starting_cash=Decimal("100000"),
        bar_provider=bar_provider,
    )

    final: dict = {"tuner": result}
    try:
        best = result.get("best_params", {})
        if best:
            final["walkforward"] = _final_oos_run(best, bar_provider)
    except Exception as exc:
        final["walkforward_error"] = str(exc)

    report_dir = _ROOT / "audit-reports"
    report_dir.mkdir(exist_ok=True)
    out_path = report_dir / "phase1-vwap-tune.json"
    with out_path.open("w") as f:
        json.dump(final, f, indent=2, default=str)
    print("\nJSON result:\n" + json.dumps(final, indent=2, default=str))
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
