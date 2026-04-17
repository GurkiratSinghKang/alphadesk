"""Walk-forward Optuna tuner for pairs_trading.

Train 2019-01-01 → 2022-12-31, test 2023-01-01 → 2024-12-31. Prefetches
the full universe bars once up front and serves them from an in-memory
DataFrame-backed provider — letting the engine hit Alpaca per-session
would multiply network calls by ~1500 per trial.

Usage::

    .venv/bin/python scripts/tune_pairs_trading.py [n_trials]

``n_trials`` defaults to 30. The Optuna study is persisted to
``~/.alphadesk/tuner/pairs_trading_v1.db`` and is resumable.
"""

from __future__ import annotations

import json
import logging
import sys
import types
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any


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
import backend.strategies.pairs_trading  # noqa: F401 - registers

from backend.data.providers.alpaca import AlpacaBarProvider
from backend.strategies.pairs_trading.config import UNIVERSE
from backend.tuner.runner import run

log = logging.getLogger("pairs_tune")


# --------------------------------------------------------------------------- #
# Skip IS backtest inside each trial — only OOS is used for scoring.          #
# --------------------------------------------------------------------------- #
def _patch_walkforward_skip_is() -> None:
    from backend.backtest.types import BacktestResult
    from backend.backtest.walkforward import WalkForwardResult, WalkForwardRunner
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


# --------------------------------------------------------------------------- #
# In-memory bar provider                                                      #
# --------------------------------------------------------------------------- #
class InMemoryBarProvider:
    """Serve per-session bar queries from a single prefetched frame.

    Strategy fetches the full universe in wide form; this provider flattens
    a prefetched DataFrame and returns long-form rows on demand.
    """

    def __init__(self, df: pd.DataFrame) -> None:
        self._df = df.sort_values(["symbol", "ts"], ignore_index=True)
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
    syms = sorted(set(UNIVERSE))
    log.info(
        "Prefetching %d symbols %s -> %s (pairs_trading universe)",
        len(syms), years_start, years_end,
    )
    t0 = datetime.utcnow()
    with AlpacaBarProvider() as p:
        df = p.bars(syms, years_start, years_end, tf="1D")
    dt = (datetime.utcnow() - t0).total_seconds()
    log.info("Prefetch complete: %d rows, %.1fs", len(df), dt)
    return df


def _final_oos_run(best_params: dict, bar_provider) -> dict:
    from backend.backtest.walkforward import WalkForwardConfig, WalkForwardRunner
    from backend.strategies.registry import get_strategy

    cls = get_strategy("pairs_trading")
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
    out: dict[str, Any] = {}
    if wf.out_of_sample_result is not None:
        out["oos"] = dict(wf.out_of_sample_result.metrics)
        out["oos_trades"] = sum(
            1 for t in wf.out_of_sample_result.trades if t.is_closed
        )
        if not wf.out_of_sample_result.equity_curve.empty:
            curve = wf.out_of_sample_result.equity_curve["equity"]
            out["oos_start_equity"] = float(curve.iloc[0])
            out["oos_end_equity"] = float(curve.iloc[-1])
            out["oos_total_return"] = (
                float(curve.iloc[-1]) / float(curve.iloc[0]) - 1.0
            )
        # Per-pair contribution.
        out["pair_contrib"] = _pair_contribution(
            wf.out_of_sample_result.fills, wf.out_of_sample_result.trades
        )
    if wf.in_sample_result is not None:
        out["is"] = dict(wf.in_sample_result.metrics)
        out["is_trades"] = sum(1 for t in wf.in_sample_result.trades if t.is_closed)
    return out


def _pair_contribution(fills, trades) -> list[dict]:
    """Compute per-pair realized P&L contribution from the fills + trades.

    We attach each closed trade to its pair_id via the fill tag. For every
    pair, sum the closed trade P&L. Returns a list sorted by contribution
    desc.
    """

    # Map (symbol, entry_ts, exit_ts) -> pair_id via fills with matching ts.
    fill_pid: dict[tuple, str] = {}
    for f in fills:
        t = getattr(f, "tag", "") or ""
        if t.startswith("pairs-entry"):
            parts = t.split("-")
            if len(parts) >= 6:
                pid = f"{parts[2]}-{parts[3]}"
                fill_pid[(f.symbol, f.ts)] = pid

    by_pair: dict[str, dict[str, Any]] = {}
    for tr in trades:
        if not tr.is_closed:
            continue
        pid = fill_pid.get((tr.symbol, tr.entry_ts), "unknown")
        rec = by_pair.setdefault(pid, {"pair_id": pid, "trades": 0, "pnl": 0.0})
        rec["trades"] += 1
        rec["pnl"] += float(tr.pnl)

    contribs = sorted(
        by_pair.values(), key=lambda r: r["pnl"], reverse=True
    )
    return contribs


def main() -> int:
    logging.basicConfig(
        level="INFO",
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    n_trials = int(sys.argv[1]) if len(sys.argv) > 1 else 30

    # Prefetch ~7yr of bars with a buffer at each end for warmup + test.
    df = _prefetch_universe(date(2017, 1, 1), date(2025, 1, 31))
    bar_provider = InMemoryBarProvider(df)

    # Sharpe-only objective: the default "penalised" scoring heavily
    # penalises high turnover, which would bias against pair trading.
    result = run(
        strategy_name="pairs_trading",
        trials=n_trials,
        study_name="pairs_trading_v1",
        start=date(2019, 1, 1),
        end=date(2024, 12, 31),
        train_end=date(2022, 12, 31),
        sampler="tpe",
        seed=42,
        scoring="sharpe",
        starting_cash=Decimal("100000"),
        bar_provider=bar_provider,
    )

    final: dict[str, Any] = {"tuner": result}
    try:
        best = result.get("best_params", {})
        if best:
            final["walkforward"] = _final_oos_run(best, bar_provider)
    except Exception as exc:
        log.exception("walk-forward post-run failed: %s", exc)
        final["walkforward_error"] = str(exc)

    report_dir = _ROOT / "audit-reports"
    report_dir.mkdir(exist_ok=True)
    out_path = report_dir / "phase1-pairs_trading-tune.json"
    with out_path.open("w") as f:
        json.dump(final, f, indent=2, default=str)

    print("\nJSON result:\n" + json.dumps(final, indent=2, default=str))
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
