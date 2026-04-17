"""Smoke-test the ORB strategy against real Alpaca 1-minute bars.

Runs a 1-month backtest of the in-strategy intraday simulator over a
``['QQQ', 'TQQQ']`` universe. The engine is NOT used — ORB runs as a
custom harness driven by :meth:`ORBStrategy.simulate_day`. See
``backend/strategies/orb/spec.md`` §4 for why.

Usage::

    .venv/bin/python scripts/smoke_orb.py [start] [end]

Defaults to 2024-06-01 → 2024-06-30. Requires ``.env`` with
``ALPACA_API_KEY`` + ``ALPACA_SECRET_KEY`` set.
"""

from __future__ import annotations

import sys
import types
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable


_ROOT = Path(__file__).resolve().parent.parent
for _p in (_ROOT, _ROOT / "backend"):
    ps = str(_p)
    if ps not in sys.path:
        sys.path.insert(0, ps)

# Stub backend.strategies to bypass the broken legacy __init__.py (other
# strategies use this same trick; see scripts/rsi2_smoke.py).
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


import numpy as np
import pandas as pd

import backend.strategies.orb  # noqa: F401 - registers the strategy

from backend.data.providers.alpaca import AlpacaBarProvider
from backend.strategies.orb.config import UNIVERSE_PROFILES
from backend.strategies.orb.strategy import ORBStrategy, OrbDayResult


# --------------------------------------------------------------------------- #
# In-memory intraday provider                                                 #
# --------------------------------------------------------------------------- #
class InMemoryIntradayProvider:
    """Serve 1-min bar queries from a single prefetched frame.

    Satisfies the ``BarProvider`` contract just for the ``tf='1Min'``
    requests the ORB simulator makes.
    """

    def __init__(self, df: pd.DataFrame) -> None:
        df = df.copy()
        df["ts"] = pd.to_datetime(df["ts"], utc=True)
        self._df = df.sort_values(["symbol", "ts"], ignore_index=True)
        self._by_sym: dict[str, pd.DataFrame] = {
            s: g.reset_index(drop=True)
            for s, g in self._df.groupby("symbol", sort=False)
        }

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = [s.upper() for s in symbols]
        start_ts = pd.Timestamp(start)
        if start_ts.tzinfo is None:
            start_ts = start_ts.tz_localize("UTC")
        end_ts = pd.Timestamp(end)
        if end_ts.tzinfo is None:
            end_ts = end_ts.tz_localize("UTC")
        # Make the end inclusive to end-of-day.
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


def prefetch_intraday(
    symbols: Iterable[str], start: date, end: date
) -> pd.DataFrame:
    syms = sorted({s.upper() for s in symbols})
    print(f"Prefetching 1Min bars for {syms} {start} -> {end}")
    with AlpacaBarProvider() as p:
        df = p.bars(syms, start, end, tf="1Min")
    print(f"Got {len(df)} intraday rows")
    return df


# --------------------------------------------------------------------------- #
# Custom backtest harness                                                     #
# --------------------------------------------------------------------------- #
def run_orb_backtest(
    strat: ORBStrategy,
    bar_provider,
    *,
    start: date,
    end: date,
    starting_cash: float = 100_000.0,
) -> dict:
    """Iterate trading sessions, call ``simulate_day``, compound equity."""

    from types import SimpleNamespace

    # US trading days (Mon-Fri, no holiday calendar). Good enough for
    # post-2019 data; missing days just return empty bar frames.
    all_days = pd.bdate_range(start=start, end=end, freq="C")
    sessions = [d.date() for d in all_days]

    ctx = SimpleNamespace(
        asof=None,
        cash=starting_cash,
        equity=starting_cash,
        positions=[],
        bar_provider=bar_provider,
        options_provider=None,
        earnings_provider=None,
        fundamentals_provider=None,
        calendar_provider=None,
        params={},
        state={},
    )

    equity = starting_cash
    rows: list[dict] = []
    trades: list[OrbDayResult] = []

    for session in sessions:
        ctx.asof = session
        day_results = strat.simulate_day(session, ctx, equity=equity)
        # simulate_day returns pnl_pct_of_equity where "equity" is the
        # TOTAL portfolio equity (each symbol's risk is of total equity).
        day_pnl_dollars = 0.0
        for r in day_results:
            if r.direction is None:
                continue
            day_pnl_dollars += r.pnl_pct_of_equity * equity
            trades.append(r)

        day_return = day_pnl_dollars / equity if equity > 0 else 0.0
        equity += day_pnl_dollars
        rows.append(
            {
                "date": session,
                "equity": equity,
                "day_return": day_return,
                "trades": sum(1 for r in day_results if r.direction is not None),
            }
        )

    eq_df = pd.DataFrame(rows)
    if eq_df.empty:
        return {"equity_curve": eq_df, "trades": trades, "metrics": {}}

    eq_df["date"] = pd.to_datetime(eq_df["date"])
    eq_df = eq_df.set_index("date")
    returns = eq_df["day_return"].astype(float)
    metrics = compute_metrics(returns, eq_df["equity"].astype(float))
    return {
        "equity_curve": eq_df,
        "trades": trades,
        "metrics": metrics,
        "returns": returns,
    }


def compute_metrics(returns: pd.Series, equity: pd.Series) -> dict:
    """Compute Sharpe / Sortino / MaxDD / CAGR / hit-rate / profit-factor."""

    rets = returns.dropna()
    if rets.empty:
        return {
            "sharpe": 0.0,
            "sortino": 0.0,
            "max_drawdown": 0.0,
            "cagr": 0.0,
            "hit_rate": 0.0,
            "profit_factor": 0.0,
            "n_days": 0,
            "n_active_days": 0,
            "total_return": 0.0,
        }

    n = len(rets)
    mu = rets.mean()
    sigma = rets.std(ddof=1) if n > 1 else 0.0
    sharpe = (mu / sigma * np.sqrt(252)) if sigma > 1e-12 else 0.0

    downside = rets[rets < 0]
    sigma_down = downside.std(ddof=1) if len(downside) > 1 else 0.0
    sortino = (mu / sigma_down * np.sqrt(252)) if sigma_down > 1e-12 else 0.0

    # Max drawdown from equity curve
    peaks = equity.cummax()
    dd = (equity / peaks) - 1.0
    max_dd = float(dd.min()) if not dd.empty else 0.0

    start_equity = float(equity.iloc[0]) if len(equity) else 1.0
    end_equity = float(equity.iloc[-1]) if len(equity) else 1.0
    total_return = end_equity / start_equity - 1.0
    years = max(n / 252.0, 1 / 252.0)
    cagr = (end_equity / start_equity) ** (1 / years) - 1.0 if start_equity > 0 else 0.0

    active = rets[rets != 0]
    hit_rate = float((active > 0).mean()) if len(active) > 0 else 0.0
    wins = rets[rets > 0].sum()
    losses = -rets[rets < 0].sum()
    profit_factor = float(wins / losses) if losses > 1e-12 else float("inf")

    return {
        "sharpe": float(sharpe),
        "sortino": float(sortino),
        "max_drawdown": float(max_dd),
        "cagr": float(cagr),
        "hit_rate": float(hit_rate),
        "profit_factor": (
            float(profit_factor) if profit_factor != float("inf") else 0.0
        ),
        "n_days": int(n),
        "n_active_days": int((rets != 0).sum()),
        "total_return": float(total_return),
    }


def main() -> int:
    start_arg = sys.argv[1] if len(sys.argv) > 1 else "2024-06-01"
    end_arg = sys.argv[2] if len(sys.argv) > 2 else "2024-06-30"

    def parse(s: str) -> date:
        y, m, d = s.split("-")
        return date(int(y), int(m), int(d))

    start_d = parse(start_arg)
    end_d = parse(end_arg)

    # Prefetch intraday data.
    strat = ORBStrategy()
    strat.configure({})  # defaults
    universe = strat.params.get("universe_profile", "qqq_tqqq")
    syms = UNIVERSE_PROFILES[universe]
    df = prefetch_intraday(syms, start_d, end_d)
    if df.empty:
        print("No bars returned; aborting.")
        return 1
    bar_provider = InMemoryIntradayProvider(df)

    result = run_orb_backtest(
        strat,
        bar_provider,
        start=start_d,
        end=end_d,
        starting_cash=100_000.0,
    )
    eq = result["equity_curve"]
    trades = result["trades"]
    metrics = result["metrics"]

    print("=" * 70)
    print("ORB — Smoke Test")
    print("=" * 70)
    print(f"Period:           {start_d} -> {end_d}")
    print(f"Universe:         {syms}")
    print(f"Sessions:         {len(eq)}")
    print(f"Entries:          {sum(1 for t in trades if t.direction is not None)}")
    if not eq.empty:
        print(
            f"Equity:           {eq['equity'].iloc[0]:,.2f} "
            f"-> {eq['equity'].iloc[-1]:,.2f} "
            f"({(eq['equity'].iloc[-1] / eq['equity'].iloc[0] - 1) * 100:+.2f}%)"
        )
    print()
    print("Metrics:")
    w = max(len(k) for k in metrics) if metrics else 0
    for k in sorted(metrics):
        v = metrics[k]
        if isinstance(v, float):
            print(f"  {k.ljust(w)} = {v:.4f}")
        else:
            print(f"  {k.ljust(w)} = {v}")

    print()
    print("Entry breakdown (first 15):")
    for t in trades[:15]:
        if t.direction is None:
            continue
        print(
            f"  {t.asof} {t.symbol:6s} {t.direction:5s} "
            f"entry={t.entry_price:.2f} shares={t.shares:4d} "
            f"exit={t.exit_price:.2f} ({t.exit_reason}, tp={t.tp_hits}) "
            f"pnl%={t.pnl_pct_of_equity * 100:+.3f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
