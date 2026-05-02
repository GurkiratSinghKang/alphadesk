#!/usr/bin/env python
"""Replay the PEAD best-params on the OOS window and emit the final report.

Reads ``audit-reports/phase1-pead-tune.json`` for the winning parameter set,
re-runs the engine on 2023-01-02 → 2024-12-30 with the same in-memory
bar provider, and writes ``audit-reports/phase1-pead-oos.json`` plus a
distribution summary of observed SUE scores for the report.
"""

from __future__ import annotations

import json
import sys
import types
from datetime import date
from decimal import Decimal
from pathlib import Path


def _install_stubs() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    backend = repo_root / "backend"
    for _p in (repo_root, backend):
        ps = str(_p)
        if ps not in sys.path:
            sys.path.insert(0, ps)
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


import math  # noqa: E402
from datetime import timedelta  # noqa: E402
import pandas as pd  # noqa: E402
import backend.strategies.pead  # noqa: F401,E402

from backend.backtest.engine import BacktestEngine, EngineConfig  # noqa: E402
from backend.data.providers.alpaca import AlpacaBarProvider  # noqa: E402
from backend.data.providers.fmp import FMPEarningsProvider  # noqa: E402
from backend.strategies.pead import config as _pead_cfg  # noqa: E402
from backend.strategies.pead.config import UNIVERSE_SEED  # noqa: E402
from backend.strategies.pead.strategy import PEADStrategy  # noqa: E402
from scripts.oos_bootstrap import attach_bootstrap_ci, bootstrap_ci_from_equity_frame  # noqa: E402


_ROOT = Path(__file__).resolve().parent.parent


class _InMemoryBarProvider:
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


def _parse_sue_from_tag(tag: str) -> float | None:
    """Fill tags are 'pead-entry-long-sue+2.34[-evspread0.0005]' etc."""

    if "sue" not in tag:
        return None
    try:
        after = tag.split("sue")[-1]
        # Trim any trailing signal-tag suffixes that the engine appends
        # (e.g. ``-evspread0.0005`` added by Wave 1 event-conditional slippage).
        for sep in ("-evspread", "-"):
            if sep in after[1:]:  # keep leading sign
                # Find first occurrence after the sign char.
                idx = after.find(sep, 1)
                if idx > 0:
                    after = after[:idx]
                    break
        return float(after)
    except Exception:
        return None


def _sue_bucket(sue: float) -> str:
    a = abs(sue)
    if a < 1.5:
        return "[0, 1.5)"
    if a < 2.0:
        return "[1.5, 2.0)"
    if a < 3.0:
        return "[2.0, 3.0)"
    return "[3.0, inf)"


def main() -> int:
    tune_path = _ROOT / "audit-reports" / "phase1-pead-tune.json"
    if not tune_path.exists():
        print(f"No tune summary at {tune_path}. Run scripts/tune_pead.py first.")
        return 1
    tune = json.loads(tune_path.read_text())
    best_params = tune.get("best_params", {})
    print("Using best_params:", best_params)

    # Prefetch bars.
    syms = sorted(set(UNIVERSE_SEED))
    print(f"Prefetching {len(syms)} symbols 2019-01 → 2024-12 ...")
    with AlpacaBarProvider() as p:
        df = p.bars(syms, date(2019, 1, 2), date(2024, 12, 31), tf="1D")
    bar_provider = _InMemoryBarProvider(df)
    earnings = FMPEarningsProvider()

    strat = PEADStrategy()
    cfg = EngineConfig(
        start=date(2023, 1, 2),
        end=date(2024, 12, 30),
        starting_cash=Decimal("100000"),
        benchmark="SPY",
    )
    engine = BacktestEngine(
        strategy=strat,
        bar_provider=bar_provider,
        earnings_provider=earnings,
        config=cfg,
        strategy_params=best_params,
    )
    res = engine.run()

    metrics = res.metrics or {}
    long_fills = sum(1 for f in res.fills if f.side.value == "buy")
    short_fills = sum(1 for f in res.fills if f.side.value == "sell")
    round_trips = sum(1 for t in res.trades if t.is_closed)

    # SUE histogram from entry fills.
    entry_fills = [
        f for f in res.fills if "pead-entry" in (f.tag or "")
    ]
    sues: list[float] = []
    for f in entry_fills:
        sue = _parse_sue_from_tag(f.tag or "")
        if sue is not None and math.isfinite(sue):
            sues.append(sue)

    # Hit-rate by |SUE| bucket. Round-trip hit = pnl > 0.
    bucket_stats: dict[str, dict[str, int]] = {
        "[1.5, 2.0)": {"n": 0, "wins": 0},
        "[2.0, 3.0)": {"n": 0, "wins": 0},
        "[3.0, inf)": {"n": 0, "wins": 0},
    }
    # Round-trips carry no direct SUE metadata in the Trade dataclass, so
    # we approximate by mapping exit symbol+entry-time to an entry fill's SUE.
    closed_trades = [t for t in res.trades if t.is_closed]
    for trade in closed_trades:
        # Find entry fill for this trade (symbol, entry_ts).
        entry_f = None
        for f in entry_fills:
            if f.symbol == trade.symbol and f.ts == trade.entry_ts:
                entry_f = f
                break
        if entry_f is None:
            continue
        sue = _parse_sue_from_tag(entry_f.tag or "")
        if sue is None:
            continue
        bucket = _sue_bucket(sue)
        if bucket not in bucket_stats:
            continue
        bucket_stats[bucket]["n"] += 1
        if float(trade.pnl) > 0:
            bucket_stats[bucket]["wins"] += 1

    # SUE histogram bins.
    sue_hist: dict[str, int] = {}
    bins = [-float("inf"), -3.0, -2.0, -1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 2.0, 3.0, float("inf")]
    for i in range(len(bins) - 1):
        sue_hist[f"[{bins[i]:g}, {bins[i+1]:g})"] = 0
    for s in sues:
        for i in range(len(bins) - 1):
            if bins[i] <= s < bins[i + 1]:
                sue_hist[f"[{bins[i]:g}, {bins[i+1]:g})"] += 1
                break

    hit_rates = {
        k: (v["wins"] / v["n"] if v["n"] > 0 else None)
        for k, v in bucket_stats.items()
    }

    print("=" * 70)
    print("PEAD OOS evaluation — 2023-01-02 → 2024-12-30")
    print("=" * 70)
    print(f"Fills:           {len(res.fills)}  (long {long_fills}, short {short_fills})")
    print(f"Round-trips:     {round_trips}")
    if not res.equity_curve.empty:
        print(
            f"Equity: {float(res.equity_curve['equity'].iloc[0]):,.2f} → "
            f"{float(res.equity_curve['equity'].iloc[-1]):,.2f}"
        )
    print("Metrics:")
    for k in sorted(metrics):
        v = metrics[k]
        if isinstance(v, float):
            print(f"  {k:>15s} = {v:.4f}")
    print()
    print("SUE bucket hit rate (round-trip P&L > 0):")
    for k, v in bucket_stats.items():
        pct = (
            f"{v['wins']}/{v['n']} = {v['wins'] / v['n']:.1%}"
            if v["n"] > 0
            else "no trades"
        )
        print(f"  {k:>12s}  {pct}")
    print()
    print("SUE histogram (entry fills):")
    for k, v in sue_hist.items():
        bar = "#" * min(v, 50)
        print(f"  {k:>20s}  {v:3d}  {bar}")

    # -----------------------------------------------------------------
    # AMC vs BMO entry-fill classification (to prove P0-1 engaged).
    # For each entry fill at session D on symbol S, look up the earnings
    # calendar: an AMC announcement on D-1 or a BMO announcement on D.
    # Matches the two-anchor mask in PEADStrategy._yesterday_announcements.
    # -----------------------------------------------------------------
    cal_start = cfg.start - timedelta(days=5)
    cal_end = cfg.end + timedelta(days=2)
    # FMP /stable/earnings-calendar silently returns empty for wide windows,
    # so fetch in ~10-day chunks and concatenate. This preserves the
    # ``announcement_when`` column the Wave 1 fix populates.
    chunks: list[pd.DataFrame] = []
    chunk_span = timedelta(days=10)
    cur = cal_start
    while cur <= cal_end:
        nxt = min(cur + chunk_span, cal_end)
        try:
            piece = earnings.calendar(cur, nxt, symbols=syms)
        except Exception as exc:
            print(f"WARN: calendar chunk {cur}→{nxt} failed: {exc}")
            piece = pd.DataFrame()
        if piece is not None and not piece.empty:
            chunks.append(piece)
        cur = nxt + timedelta(days=1)
    if chunks:
        full_cal = pd.concat(chunks, ignore_index=True).drop_duplicates(
            subset=["symbol", "date"], keep="last"
        )
    else:
        full_cal = pd.DataFrame(columns=["symbol", "date", "announcement_when"])
    print(f"Calendar rows fetched: {len(full_cal)}")
    if not full_cal.empty and "announcement_when" in full_cal.columns:
        print(f"  when-value counts: {full_cal['announcement_when'].value_counts(dropna=False).to_dict()}")

    amc_fills = 0
    bmo_fills = 0
    unknown_when_fills = 0
    nomatch_fills = 0
    if not full_cal.empty and "announcement_when" in full_cal.columns:
        cal_idx: dict[tuple[str, date], str] = {}
        for row in full_cal[["symbol", "date", "announcement_when"]].itertuples(index=False):
            sym_r = str(row.symbol).upper()
            d_r = row.date
            if isinstance(d_r, pd.Timestamp):
                d_r = d_r.date()
            when_r = str(row.announcement_when).lower() if row.announcement_when is not None else ""
            cal_idx[(sym_r, d_r)] = when_r

        for f in entry_fills:
            sym_f = str(f.symbol).upper()
            ts_f = f.ts
            if isinstance(ts_f, pd.Timestamp):
                d_fill = ts_f.date()
            else:
                d_fill = getattr(ts_f, "date", lambda: ts_f)()
            d_prev = d_fill - timedelta(days=1)
            # Walk back weekdays up to 4 days to find a trading-day candidate.
            prev_candidates = []
            probe = d_prev
            for _ in range(5):
                if probe.weekday() < 5:
                    prev_candidates.append(probe)
                probe -= timedelta(days=1)
            # BMO match: same-day announcement.
            when_bmo = cal_idx.get((sym_f, d_fill))
            when_amc = None
            for cand in prev_candidates:
                w = cal_idx.get((sym_f, cand))
                if w is not None:
                    when_amc = w
                    break
            if when_bmo == "bmo":
                bmo_fills += 1
            elif when_amc == "amc":
                amc_fills += 1
            elif when_bmo or when_amc:
                unknown_when_fills += 1
            else:
                nomatch_fills += 1

    print()
    print("Entry-fill AMC/BMO classification:")
    print(f"  AMC fills:          {amc_fills}")
    print(f"  BMO fills:          {bmo_fills}")
    print(f"  Unknown/when empty: {unknown_when_fills}")
    print(f"  No calendar match:  {nomatch_fills}")

    out = {
        "strategy": "pead",
        "start": str(cfg.start),
        "end": str(cfg.end),
        "best_params": best_params,
        "oos_metrics": {
            k: float(v) for k, v in metrics.items() if isinstance(v, (int, float))
        },
        "oos_fills": len(res.fills),
        "oos_long_fills": long_fills,
        "oos_short_fills": short_fills,
        "oos_round_trips": round_trips,
        "oos_final_equity": (
            float(res.equity_curve["equity"].iloc[-1])
            if not res.equity_curve.empty else None
        ),
        "oos_entry_fill_classification": {
            "amc": amc_fills,
            "bmo": bmo_fills,
            "unknown_when": unknown_when_fills,
            "no_calendar_match": nomatch_fills,
            "total_entry_fills": len(entry_fills),
        },
        "sue_histogram": sue_hist,
        "hit_rate_by_sue_bucket": hit_rates,
        "n_round_trips_by_sue_bucket": {k: v["n"] for k, v in bucket_stats.items()},
        "target_sharpe": 0.50,
        "achieved_sharpe": float(metrics.get("sharpe", 0.0)),
        "universe_has_survivorship_bias": bool(
            getattr(_pead_cfg, "UNIVERSE_HAS_SURVIVORSHIP_BIAS", False)
        ),
    }
    attach_bootstrap_ci(out, bootstrap_ci_from_equity_frame(res.equity_curve))
    out_path = _ROOT / "audit-reports" / "phase1-pead-oos.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2, default=str))
    print(f"\nDumped OOS eval to {out_path}")

    # Mirror to the canonical backend/data/oos/ artefact path.
    mirror_path = _ROOT / "backend" / "data" / "oos" / "phase1-pead-oos.json"
    mirror_path.parent.mkdir(parents=True, exist_ok=True)
    mirror_path.write_text(json.dumps(out, indent=2, default=str))
    print(f"Mirrored to {mirror_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
