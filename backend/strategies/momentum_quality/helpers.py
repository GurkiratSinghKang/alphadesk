"""Data and ranking helpers for ``momentum_quality``.

Kept separate from ``strategy.py`` so the main module stays under the
500-line cap and so the pure numerical utilities (_rank_01, the
close-panel fetch, the fscore cache bucket) can be tested in isolation.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Iterable, Optional

import numpy as np
import pandas as pd

from backend.strategies.base import Context, cache_of


log = logging.getLogger("alphadesk.strategies.momentum_quality.helpers")


# --------------------------------------------------------------------------- #
# Rebalance calendar                                                          #
# --------------------------------------------------------------------------- #
def is_last_trading_day_of_month(asof: date, ctx: Context) -> bool:
    """True iff ``asof`` is the last trading session of its month."""

    cal = getattr(ctx, "calendar_provider", None)
    try:
        if cal is not None and hasattr(cal, "next_session"):
            nxt = cal.next_session(asof)
            nxt_d = nxt if isinstance(nxt, date) else pd.Timestamp(nxt).date()
            return nxt_d.month != asof.month
    except Exception:
        pass

    probe = asof + timedelta(days=1)
    for _ in range(7):
        if probe.month != asof.month:
            break
        if probe.weekday() < 5:
            return False
        probe += timedelta(days=1)
    return asof.weekday() < 5


# --------------------------------------------------------------------------- #
# Close panel                                                                 #
# --------------------------------------------------------------------------- #
def fetch_close_panel(
    ctx: Context,
    symbols: list[str],
    start: date,
    end: date,
) -> Optional[pd.DataFrame]:
    """Return a wide DataFrame of close prices, index = UTC session ts."""

    provider = getattr(ctx, "bar_provider", None)
    if provider is None:
        return None

    try:
        df = provider.bars(symbols, start, end, tf="1D")
    except Exception as exc:
        log.warning("mq: bar_provider.bars failed: %s", exc)
        return None
    if df is None:
        return None
    df = pd.DataFrame(df)
    if df.empty:
        return None

    cols = {c.lower(): c for c in df.columns}
    sym_c = cols.get("symbol") or cols.get("ticker")
    ts_c = cols.get("ts") or cols.get("timestamp") or cols.get("date")
    close_c = cols.get("close")
    if not (sym_c and ts_c and close_c):
        return None

    long = df[[sym_c, ts_c, close_c]].copy()
    long.columns = ["symbol", "ts", "close"]
    long["ts"] = (
        pd.to_datetime(long["ts"], utc=True)
        .dt.tz_convert("UTC")
        .dt.normalize()
    )
    long = long.dropna(subset=["close"])
    wide = (
        long.pivot_table(index="ts", columns="symbol", values="close", aggfunc="last")
        .sort_index()
    )
    return wide.ffill()


# --------------------------------------------------------------------------- #
# F-score fetch / cache                                                       #
# --------------------------------------------------------------------------- #
def fscore_bucket(asof: date) -> int:
    """Coarse cache-bucket key: year*12 + month — refresh at most 12x/yr."""

    return asof.year * 12 + asof.month


def get_fscores(
    ctx: Context,
    symbols: list[str],
    asof: date,
    ns: str,
) -> dict[str, Optional[int]]:
    """Fetch / cache Piotroski F-scores on ``ctx.state[ns + ".fscores"]``."""

    cache = cache_of(ctx)
    key = f"{ns}.fscores"
    meta = cache.get(key)
    bucket = fscore_bucket(asof)

    need = (meta is None or meta.get("bucket") != bucket)

    if need:
        provider = getattr(ctx, "fundamentals_provider", None)
        scores: dict[str, Optional[int]] = {}
        if provider is None or not hasattr(provider, "piotroski_f"):
            log.warning(
                "mq: no fundamentals_provider; skipping F-score filter (F=9 default)"
            )
            for s in symbols:
                scores[s] = 9
        else:
            for sym in symbols:
                try:
                    v = provider.piotroski_f(sym, asof)
                    scores[sym] = int(v) if v is not None else None
                except Exception as exc:
                    log.debug("mq: piotroski_f(%s, %s) → %s", sym, asof, exc)
                    scores[sym] = None
        cache[key] = {"bucket": bucket, "data": scores}
        meta = cache[key]

    existing = dict(meta.get("data", {}))
    missing = [s for s in symbols if s not in existing]
    if missing:
        provider = getattr(ctx, "fundamentals_provider", None)
        for sym in missing:
            try:
                if provider is not None:
                    v = provider.piotroski_f(sym, asof)
                    existing[sym] = int(v) if v is not None else None
                else:
                    existing[sym] = 9
            except Exception:
                existing[sym] = None
        cache[key] = {"bucket": bucket, "data": existing}
    return existing


# --------------------------------------------------------------------------- #
# Earnings filter                                                             #
# --------------------------------------------------------------------------- #
def earnings_blocked(
    ctx: Context,
    symbols: list[str],
    asof: date,
    skip_days: int,
) -> set[str]:
    """Return symbols whose earnings fall within [asof, asof + skip_days]."""

    provider = getattr(ctx, "earnings_provider", None)
    if provider is None or not hasattr(provider, "calendar"):
        return set()

    start = asof
    end = asof + timedelta(days=skip_days)
    try:
        df = provider.calendar(start, end, symbols=symbols)
    except Exception as exc:
        log.debug("mq: earnings.calendar failed: %s", exc)
        return set()
    if df is None or getattr(df, "empty", True):
        return set()
    try:
        return set(df["symbol"].astype(str).str.upper().tolist())
    except Exception:
        return set()


# --------------------------------------------------------------------------- #
# Ranking                                                                     #
# --------------------------------------------------------------------------- #
def rank_01(values: np.ndarray) -> np.ndarray:
    """Cross-sectional percentile rank in [0, 1]. Ties share average rank."""

    n = len(values)
    if n == 0:
        return values
    if n == 1:
        return np.array([1.0], dtype=float)
    order = values.argsort(kind="stable")
    ranks = np.empty(n, dtype=float)
    ranks[order] = np.arange(1, n + 1, dtype=float)
    sorted_vals = values[order]
    i = 0
    while i < n:
        j = i
        while j + 1 < n and sorted_vals[j + 1] == sorted_vals[i]:
            j += 1
        if j > i:
            avg = (i + j) / 2.0 + 1.0
            for k in range(i, j + 1):
                ranks[order[k]] = avg
        i = j + 1
    return (ranks - 1.0) / (n - 1)


__all__ = [
    "is_last_trading_day_of_month",
    "fetch_close_panel",
    "fscore_bucket",
    "get_fscores",
    "earnings_blocked",
    "rank_01",
]
