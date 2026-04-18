"""Walk-forward tuner for earnings_vol.

Train 2022-01-01 ... 2022-12-31, test 2023-01-01 ... 2024-12-31.

v2 (2026-04): re-tuning against the engine's real-options fill path after
we removed the synthetic 0.55 IV-crush-retention ledger. The v1 study
(``earnings_vol_v1.db``) scored trials against a synthetic BS pricing
model that ignored half-spread slippage, inflating OOS Sharpe to 6.10;
real Polygon contract_bars + half-spread slippage tell a different story.
We run under a new study name (``earnings_vol_v2``) so the old trials
don't contaminate the TPE posterior.

Data cost considerations: options chains + contract bars are heavy, so
we (a) constrain the universe to the 29 liquid names in the config, (b)
prefetch the underlying bars in one batch into an in-memory provider,
and (c) use a deterministic sampler with a modest trial count (20 by
default).

Usage::

    .venv/bin/python scripts/tune_earnings_vol.py [n_trials]

``n_trials`` defaults to 20. Study is persisted to
``~/.alphadesk/tuner/earnings_vol_v2.db`` and can be resumed.
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
import backend.strategies.earnings_vol  # noqa: F401 - registers strategy

from backend.data.providers.alpaca import AlpacaBarProvider
from backend.data.providers.fmp_earnings import FMPEarningsProvider
from backend.data.providers.polygon_options import PolygonOptionsProvider
from backend.strategies.earnings_vol.config import UNIVERSE
from backend.strategies.earnings_vol.polygon_helpers import (
    SyntheticBarProvider,
    clear_synthetic_ledger,
)
from backend.tuner.runner import run


# --------------------------------------------------------------------------- #
# Short-circuit the engine's historical ``chain_snapshot`` so per-fill        #
# slippage lookups don't paginate through every historical expiration.        #
# ---------------------------------------------------------------------------#
# The engine's ``ExecutionSimulator._leg_spread_pct`` calls                   #
# ``options_provider.chain_snapshot(underlying, asof)`` for each leg on each  #
# fill date to derive a per-leg half-spread from live bid/ask. On Polygon's  #
# Developer tier, that endpoint strips bid/ask on historical ``as_of`` calls #
# but still paginates through every contract ever listed on the underlying —#
# for BAC (listed 2007) that's 10k+ pages per fill and ~2 min of API burn.  #
# We never get bid/ask data back anyway, so the simulator always falls back #
# to ``default_options_spread_pct``. Short-circuiting here returns an empty  #
# DataFrame so the fallback triggers immediately without the pagination.     #
def _patch_chain_snapshot_for_historical() -> None:
    import pandas as _pd
    _orig = PolygonOptionsProvider.chain_snapshot

    def chain_snapshot_fast(self, underlying, asof=None):  # type: ignore[override]
        # For historical dates (the only path the tuner exercises), return
        # an empty chain so the engine's ``_leg_spread_pct`` falls back to
        # ``default_options_spread_pct``. Live-paper / live-prod call paths
        # still go through the original method.
        if asof is None:
            return _orig(self, underlying, asof)
        try:
            asof_d = (
                asof if isinstance(asof, date)
                else _pd.Timestamp(asof).date()
            )
        except Exception:
            return _orig(self, underlying, asof)
        # If asof is today or in the future, keep original behaviour.
        if asof_d >= date.today():
            return _orig(self, underlying, asof)
        # Historical: skip the expensive pagination.
        return _pd.DataFrame(
            columns=[
                "contract_ticker", "underlying", "expiration", "strike",
                "option_type", "bid", "ask", "last", "volume",
                "open_interest", "iv", "delta", "gamma", "theta",
                "vega", "rho", "asof",
            ]
        )

    PolygonOptionsProvider.chain_snapshot = chain_snapshot_fast


_patch_chain_snapshot_for_historical()


# --------------------------------------------------------------------------- #
# Force bar/staged_on timestamps to tz-aware UTC so the executor's            #
# ``bar.ts < order.staged_on`` comparison does not mix naive vs aware dts.   #
# --------------------------------------------------------------------------- #
# Alpaca returns tz-aware UTC timestamps; but when the engine emits a         #
# signal for a symbol whose bar is missing on that session (rare but happens  #
# around earnings candidates that fall on the session boundary), it falls    #
# back to ``datetime.combine(session, datetime.min.time())`` which is naive.  #
# The executor then fails ``bar.ts < order.staged_on`` with                   #
# ``TypeError: can't compare offset-naive and offset-aware datetimes``. The   #
# fix lives in the engine but we cannot touch it here; we monkey-patch the    #
# engine's ``_coerce_ts`` and ``_queue_signal`` helpers to always emit        #
# tz-aware UTC datetimes.                                                     #
def _patch_engine_tz_aware() -> None:
    """Force bar/staged_on timestamps to tz-aware UTC.

    The executor compares ``bar.ts < order.staged_on``. Alpaca bars are
    tz-aware UTC, but two engine paths produce naive datetimes:

    1. ``_coerce_ts`` returns ``datetime.combine(..., min.time())`` when the
       row is missing a timestamp column — used when a bar is present but
       has no ``ts`` field.
    2. ``_queue_signal`` falls back to ``datetime.combine(session, min.time())``
       when ``bars_by_symbol[signal.symbol]`` is ``None`` — used when a
       strategy emits a signal for a symbol that has no bar on that session.

    Both fallbacks produce naive datetimes that then fail the executor's
    comparison with a tz-aware UTC bar.ts. We wrap the executor's ``queue``
    method to coerce incoming ``staged_on`` to UTC, and wrap ``_coerce_ts``
    to do the same for bar ts values. This is belt-and-braces.
    """

    from datetime import datetime, timezone
    from backend.backtest.engine import BacktestEngine
    from backend.backtest.execution import ExecutionSimulator

    _orig_coerce_ts = BacktestEngine._coerce_ts

    def _coerce_ts_tz(row, ts_col, fallback):
        v = _orig_coerce_ts(row, ts_col, fallback)
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v

    BacktestEngine._coerce_ts = staticmethod(_coerce_ts_tz)

    _orig_queue = ExecutionSimulator.queue

    def _queue_tz(self, signal, staged_on, side, quantity):
        if staged_on is not None and getattr(staged_on, "tzinfo", None) is None:
            staged_on = staged_on.replace(tzinfo=timezone.utc)
        return _orig_queue(self, signal, staged_on, side, quantity)

    ExecutionSimulator.queue = _queue_tz


_patch_engine_tz_aware()


log = logging.getLogger("earnings_vol_tune")


# --------------------------------------------------------------------------- #
# Monkey-patch the walk-forward runner to skip the IS backtest.              #
# --------------------------------------------------------------------------- #
def _patch_walkforward_skip_is() -> None:
    from backend.backtest.types import BacktestResult
    from backend.backtest.walkforward import WalkForwardResult, WalkForwardRunner
    import pandas as _pd

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


_patch_walkforward_skip_is()


# --------------------------------------------------------------------------- #
# In-memory underlying-bar provider to avoid N sequential Alpaca calls.       #
# --------------------------------------------------------------------------- #
class InMemoryBarProvider:
    """Serve per-session bar queries from a prefetched frame of underlyings.

    The synthetic-bar wrapping is layered ABOVE this provider so the engine
    can still pull ``EVOL:*`` symbols.
    """

    def __init__(self, df: pd.DataFrame) -> None:
        self._df = df.sort_values(["symbol", "ts"], ignore_index=True)
        self._by_sym: dict[str, pd.DataFrame] = {
            s: g.reset_index(drop=True)
            for s, g in self._df.groupby("symbol", sort=False)
        }

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = [s.upper() for s in (symbols if not isinstance(symbols, str) else [symbols])]
        start_ts = pd.Timestamp(start)
        end_ts = pd.Timestamp(end)
        if start_ts.tzinfo is None:
            start_ts = start_ts.tz_localize("UTC")
        if end_ts.tzinfo is None:
            end_ts = end_ts.tz_localize("UTC")
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


def _prefetch_underlying(years_start: date, years_end: date) -> pd.DataFrame:
    syms = sorted(set(UNIVERSE))
    log.info("Prefetching %d symbols %s -> %s", len(syms), years_start, years_end)
    t0 = datetime.utcnow()
    with AlpacaBarProvider() as p:
        df = p.bars(syms, years_start, years_end, tf="1D")
    dt = (datetime.utcnow() - t0).total_seconds()
    log.info("Underlying prefetch complete: %d rows, %.1fs", len(df), dt)
    return df


# --------------------------------------------------------------------------- #
# Final OOS walk-forward for the report                                       #
# --------------------------------------------------------------------------- #
def _final_oos_run(best_params: dict, bar_provider, options_provider, earnings_provider) -> dict:
    from backend.backtest.walkforward import WalkForwardConfig, WalkForwardRunner
    from backend.strategies.registry import get_strategy

    cls = get_strategy("earnings_vol")
    cfg = WalkForwardConfig(
        start=date(2022, 1, 1),
        end=date(2024, 12, 31),
        train_end=date(2022, 12, 31),
        starting_cash=Decimal("100000"),
    )
    runner = WalkForwardRunner(
        strategy_factory=cls,
        bar_provider=bar_provider,
        options_provider=options_provider,
        earnings_provider=earnings_provider,
        config=cfg,
        strategy_params=best_params,
    )
    clear_synthetic_ledger()
    wf = runner.run_train_test()

    metrics: dict[str, Any] = {}
    if wf.out_of_sample_result is not None:
        oos = wf.out_of_sample_result
        metrics["oos"] = dict(oos.metrics)
        closed = [t for t in oos.trades if t.is_closed]
        metrics["oos_trades"] = len(closed)

        # P&L breakdown by name (strip the EVOL: prefix).
        by_name: dict[str, dict[str, float]] = {}
        for t in closed:
            sym = t.symbol
            if sym.startswith("EVOL:"):
                sym = sym.split(":", 2)[1]
            rec = by_name.setdefault(
                sym, {"n": 0, "pnl": 0.0, "wins": 0, "losses": 0}
            )
            rec["n"] += 1
            pnl = float(t.pnl)
            rec["pnl"] += pnl
            if pnl > 0:
                rec["wins"] += 1
            elif pnl < 0:
                rec["losses"] += 1
        metrics["oos_pnl_by_name"] = by_name

        # Trade PnL distribution.
        pnls = [float(t.pnl) for t in closed]
        if pnls:
            metrics["oos_pnl_stats"] = {
                "count": len(pnls),
                "sum": sum(pnls),
                "mean": sum(pnls) / len(pnls),
                "min": min(pnls),
                "max": max(pnls),
                "win_rate": sum(1 for x in pnls if x > 0) / len(pnls),
            }

        if not oos.equity_curve.empty:
            curve = oos.equity_curve["equity"]
            metrics["oos_start_equity"] = float(curve.iloc[0])
            metrics["oos_end_equity"] = float(curve.iloc[-1])
            metrics["oos_total_return"] = (
                float(curve.iloc[-1]) / float(curve.iloc[0]) - 1.0
            )
    return metrics


# --------------------------------------------------------------------------- #
# Main                                                                        #
# --------------------------------------------------------------------------- #
def main() -> int:
    logging.basicConfig(
        level="INFO",
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    n_trials = int(sys.argv[1]) if len(sys.argv) > 1 else 20

    # Prefetch underlying bars once.
    df = _prefetch_underlying(date(2019, 1, 1), date(2025, 1, 31))
    in_mem = InMemoryBarProvider(df)
    bar_provider = SyntheticBarProvider(in_mem)

    with (
        PolygonOptionsProvider() as opts,
        FMPEarningsProvider() as earn,
    ):
        result = run(
            strategy_name="earnings_vol",
            trials=n_trials,
            study_name="earnings_vol_v2",
            start=date(2022, 1, 1),
            end=date(2024, 12, 31),
            train_end=date(2022, 12, 31),
            sampler="tpe",
            seed=42,
            scoring="sharpe",
            starting_cash=Decimal("100000"),
            bar_provider=bar_provider,
            options_provider=opts,
            earnings_provider=earn,
        )

        final: dict = {"tuner": result}
        try:
            best = result.get("best_params", {})
            if best:
                final["walkforward"] = _final_oos_run(
                    best, bar_provider, opts, earn
                )
        except Exception as exc:
            final["walkforward_error"] = str(exc)

    report_dir = _ROOT / "audit-reports"
    report_dir.mkdir(exist_ok=True)
    out_path = report_dir / "phase1-earnings_vol-oos.json"
    with out_path.open("w") as f:
        json.dump(final, f, indent=2, default=str)

    print("\nJSON result:\n" + json.dumps(final, indent=2, default=str))
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
