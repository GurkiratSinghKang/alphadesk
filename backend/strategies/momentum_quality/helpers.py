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

from strategies.base import Context, cache_of


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
    asof: Optional[date] = None,
) -> Optional[pd.DataFrame]:
    """Return a wide DataFrame of close prices, index = UTC session ts.

    ``asof`` — if supplied, the halt-detection slice uses only bars on or
    before ``asof``. The returned panel itself is NOT truncated (callers
    still do their own ``panel.index <= asof`` slice for signal math); we
    only need ``asof`` to prevent halt classification from peeking at
    bars past the rebalance date. See :func:`_drop_halted_symbols`.
    """

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
    wide = wide.ffill()
    return _drop_halted_symbols(wide, asof=asof)


# --------------------------------------------------------------------------- #
# Halt detection (cross-cutting fix #10)                                      #
# --------------------------------------------------------------------------- #
# Number of identical trailing closes that flag a symbol as halted. Five
# is a deliberately conservative threshold: legitimate flat-tape sessions
# (e.g. holiday-eve early closes for a single ticker) rarely exceed 3-4
# zero-return days in a row.
HALT_THRESHOLD_BARS = 5


def _drop_halted_symbols(
    wide: pd.DataFrame,
    asof: Optional[date] = None,
) -> pd.DataFrame:
    """Drop symbols whose trailing closes are flat for >= HALT_THRESHOLD_BARS.

    After ``ffill()`` a halted symbol presents as a long run of identical
    closes. Strategies that consume this panel (momentum, vol, RSI) treat
    such names as tradable with zero-vol / zero-return readings, which
    sizing formulas can blow up on. Audit P0 #10 (cross-cutting):
    explicitly drop halted symbols from the panel and warn so operators
    notice. Halts that resolve will reappear once real prints arrive.

    Look-ahead fix (P0-8): ``fetch_close_panel`` extends ~400 calendar
    days past ``asof`` so the cached panel can serve later rebalances
    without a re-fetch. If we take the tail of the FULL panel, halt
    classification for a 2023-01-31 rebalance uses bars near 2024-03-06
    -- a silent look-ahead. When ``asof`` is supplied, the halt scan
    uses only bars on or before ``asof``; the returned panel itself
    still spans the full fetched window so the cache can serve later
    rebalances. The panel index is tz-aware UTC (normalised in
    :func:`fetch_close_panel`); we promote ``asof`` to a tz-aware
    Timestamp and, if the index is tz-naive (e.g. a synthetic test
    provider), strip tz from the key before slicing.
    """

    if wide is None or wide.empty:
        return wide

    # Build the window used for halt classification. When ``asof`` is
    # supplied, bound it so we cannot peek at bars beyond the rebalance
    # date. We return the original (wider) panel so the cache keeps its
    # forward-looking bars for subsequent rebalances -- the only effect
    # is narrowing the halt-detection window.
    if asof is not None:
        key = pd.Timestamp(asof)
        idx_tz = getattr(wide.index, "tz", None)
        if idx_tz is not None:
            # Panel index is tz-aware (normal path). Promote ``asof`` to
            # that tz; guard against already-tz-aware Timestamps.
            if key.tzinfo is None:
                key = key.tz_localize(idx_tz)
            else:
                key = key.tz_convert(idx_tz)
        else:
            # Panel index is tz-naive (tests / non-UTC providers). Drop
            # tz from ``asof`` so the comparison doesn't raise.
            if key.tzinfo is not None:
                key = key.tz_convert("UTC").tz_localize(None)
        scan = wide.loc[:key]
    else:
        scan = wide

    n = len(scan.index)
    if n < HALT_THRESHOLD_BARS + 1:
        return wide
    tail = scan.tail(HALT_THRESHOLD_BARS + 1)
    flat: list[str] = []
    for col in wide.columns:
        vals = tail[col].dropna().values
        if len(vals) < HALT_THRESHOLD_BARS + 1:
            continue
        # All bars in the tail equal? Treat as halted.
        if np.all(vals == vals[0]):
            flat.append(str(col))
    if flat:
        log.warning(
            "mq: dropping %d halted symbols (>=%d identical trailing closes): %s",
            len(flat),
            HALT_THRESHOLD_BARS,
            ",".join(sorted(flat)),
        )
        wide = wide.drop(columns=flat)
    return wide


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
