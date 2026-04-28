"""Pure numerical helpers for momentum_quality — SOTA shell.

All data now flows through ``StrategyInput`` DataFrames (``input.bars``,
``input.fundamentals``, ``input.earnings``); no provider access. These
helpers work on those frames directly.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd


log = logging.getLogger("alphadesk.strategies.momentum_quality.helpers")


HALT_THRESHOLD_BARS = 5


# --------------------------------------------------------------------------- #
# Rebalance calendar                                                          #
# --------------------------------------------------------------------------- #
def is_last_trading_day_of_month(asof: date) -> bool:
    """True iff ``asof`` is the last TRADING day in its calendar month.

    Round-21 / persona-C P0: defers to the real US market calendar so
    holidays / half-days are correctly handled (was Mon-Fri only, which
    silently dropped any month whose final weekday was a holiday — MLK
    Monday, Christmas Day, etc.). Falls back to Mon-Fri if the
    calendar import fails (test environments).
    """
    try:
        from data.calendar import is_trading_day
    except Exception:
        is_trading_day = lambda d: getattr(d, "weekday", lambda: 5)() < 5  # noqa: E731
    if not is_trading_day(asof):
        return False
    probe = asof + timedelta(days=1)
    for _ in range(10):
        if is_trading_day(probe):
            return probe.month != asof.month
        probe += timedelta(days=1)
    return True


def is_rebalance_day(asof: date, freq: str) -> bool:
    if not is_last_trading_day_of_month(asof):
        return False
    if freq == "monthly":
        return True
    if freq == "bimonthly":
        return asof.month % 2 == 1
    if freq == "quarterly":
        return asof.month in (3, 6, 9, 12)
    raise AssertionError(f"unexpected rebalance_freq {freq!r}")


# --------------------------------------------------------------------------- #
# Close panel                                                                 #
# --------------------------------------------------------------------------- #
def close_panel_from_bars(
    bars: pd.DataFrame,
    asof: date,
) -> Optional[pd.DataFrame]:
    """Pivot ``input.bars`` into a wide (date × symbol) close panel."""
    if bars is None or getattr(bars, "empty", True):
        return None

    idx_names = tuple(bars.index.names or ())
    if "symbol" in idx_names and "date" in idx_names:
        frame = bars.reset_index().rename(columns={"date": "ts"})
    else:
        frame = bars.copy()
        if "ts" not in frame.columns and "ts_date" in frame.columns:
            frame = frame.rename(columns={"ts_date": "ts"})

    if "symbol" not in frame.columns or "close" not in frame.columns or "ts" not in frame.columns:
        return None

    frame["ts"] = (
        pd.to_datetime(frame["ts"], utc=True, errors="coerce")
        .dt.tz_convert("UTC").dt.normalize()
    )
    frame = frame.dropna(subset=["ts", "close"])
    if frame.empty:
        return None

    # Round-6 / I-20: truncate to ``asof`` BEFORE forward-filling. Filling
    # first would have leaked future closes back into earlier bars on
    # any halted name, biasing the cross-sectional momentum scoring at
    # the right edge of every backtest.
    wide = (
        frame.pivot_table(index="ts", columns="symbol", values="close", aggfunc="last")
        .sort_index()
    )
    cutoff = pd.Timestamp(asof, tz="UTC")
    wide = wide[wide.index <= cutoff]
    if wide is None or wide.empty:
        return None
    wide = wide.ffill()
    wide = _drop_halted_symbols(wide, asof=asof)
    if wide is None or wide.empty:
        return None
    return wide


def _drop_halted_symbols(
    wide: pd.DataFrame,
    asof: Optional[date] = None,
) -> pd.DataFrame:
    """Drop symbols whose trailing closes are flat for ≥ HALT_THRESHOLD_BARS."""
    if wide is None or wide.empty:
        return wide

    if asof is not None:
        key = pd.Timestamp(asof)
        idx_tz = getattr(wide.index, "tz", None)
        if idx_tz is not None:
            if key.tzinfo is None:
                key = key.tz_localize(idx_tz)
            else:
                key = key.tz_convert(idx_tz)
        else:
            if key.tzinfo is not None:
                key = key.tz_convert("UTC").tz_localize(None)
        scan = wide.loc[:key]
    else:
        scan = wide

    if len(scan.index) < HALT_THRESHOLD_BARS + 1:
        return wide
    tail = scan.tail(HALT_THRESHOLD_BARS + 1)
    flat: list[str] = []
    for col in wide.columns:
        vals = tail[col].dropna().values
        if len(vals) < HALT_THRESHOLD_BARS + 1:
            continue
        if np.all(vals == vals[0]):
            flat.append(str(col))
    if flat:
        log.warning(
            "mq: dropping %d halted symbols (>=%d identical trailing closes): %s",
            len(flat), HALT_THRESHOLD_BARS, ",".join(sorted(flat)),
        )
        wide = wide.drop(columns=flat)
    return wide


# --------------------------------------------------------------------------- #
# Momentum                                                                    #
# --------------------------------------------------------------------------- #
def compute_momentum(
    panel: pd.DataFrame,
    symbols: list[str],
    lookback_days: int,
    skip_days: int,
) -> dict[str, float]:
    """Compute the 12-1 (or equivalent) momentum return per symbol."""
    mom: dict[str, float] = {}
    for sym in symbols:
        if sym not in panel.columns:
            continue
        series = panel[sym].dropna()
        min_bars = lookback_days + skip_days + 2
        if len(series) < min_bars:
            continue
        end_val = (
            float(series.iloc[-(skip_days + 1)])
            if skip_days > 0 else float(series.iloc[-1])
        )
        start_idx = -(lookback_days + skip_days + 1)
        if -start_idx > len(series):
            continue
        start_val = float(series.iloc[start_idx])
        if start_val <= 0:
            continue
        mom[sym] = end_val / start_val - 1.0
    return mom


# --------------------------------------------------------------------------- #
# F-scores                                                                    #
# --------------------------------------------------------------------------- #
def get_fscores(
    fundamentals: Optional[pd.DataFrame],
    symbols: list[str],
    asof: date,
) -> dict[str, Optional[int]]:
    """Return per-symbol Piotroski F-score from input.fundamentals.

    Expected columns: ``symbol``, ``date`` or ``asof``, ``f_score``. Picks the
    latest row with ``date <= asof``. If the frame is missing or has no
    ``f_score`` column, assumes F=9 for every symbol so the filter is a no-op
    (matches the legacy provider-missing fallback).
    """
    if fundamentals is None or getattr(fundamentals, "empty", True):
        return {s: 9 for s in symbols}
    if "f_score" not in fundamentals.columns or "symbol" not in fundamentals.columns:
        return {s: 9 for s in symbols}

    frame = fundamentals
    date_col = next(
        (c for c in ("date", "asof", "ts", "report_date") if c in frame.columns),
        None,
    )
    if date_col is not None:
        cutoff = pd.to_datetime(asof)
        frame_dates = pd.to_datetime(frame[date_col], errors="coerce")
        frame = frame[frame_dates <= cutoff]

    if frame.empty:
        return {s: None for s in symbols}

    out: dict[str, Optional[int]] = {}
    for sym in symbols:
        sub = frame[frame["symbol"].astype(str).str.upper() == sym.upper()]
        if sub.empty:
            out[sym] = None
            continue
        val = sub["f_score"].iloc[-1]
        try:
            out[sym] = int(val) if pd.notna(val) else None
        except (TypeError, ValueError):
            out[sym] = None
    return out


# --------------------------------------------------------------------------- #
# Earnings filter                                                             #
# --------------------------------------------------------------------------- #
def earnings_blocked(
    earnings: Optional[pd.DataFrame],
    symbols: list[str],
    asof: date,
    skip_days: int,
) -> set[str]:
    """Return symbols with earnings in ``[asof, asof+skip_days]``."""
    if earnings is None or getattr(earnings, "empty", True):
        return set()
    if "symbol" not in earnings.columns:
        return set()

    date_col = next(
        (c for c in ("date", "report_date", "ts") if c in earnings.columns),
        None,
    )
    if date_col is None:
        return set()

    end = asof + timedelta(days=skip_days)
    frame_dates = pd.to_datetime(earnings[date_col], errors="coerce").dt.date
    mask = (frame_dates >= asof) & (frame_dates <= end)
    sub = earnings[mask]
    if sub.empty:
        return set()
    return set(sub["symbol"].astype(str).str.upper().tolist())


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
    "HALT_THRESHOLD_BARS",
    "is_last_trading_day_of_month", "is_rebalance_day",
    "close_panel_from_bars", "_drop_halted_symbols",
    "compute_momentum",
    "get_fscores", "earnings_blocked",
    "rank_01",
]
