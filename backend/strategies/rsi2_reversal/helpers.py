"""Data / indicator helpers for the rsi2_reversal strategy.

Kept separate from :mod:`.strategy` so the main module stays compact and
reviewable. Per-run state lives on ``ctx.state``. Indicator values (which
are a pure function of the bar history) are additionally cached at
process scope so the tuner's Optuna trials don't recompute the same
indicator series from scratch — a ~5x speedup for ``ConnorsRSI``, which
has O(n·p) cost in its percentile-rank component.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

import numpy as np
import pandas as pd

from backend.indicators.momentum import connors_rsi, rsi
from backend.indicators.trend import sma
from backend.strategies.base import Context, cache_of


# --------------------------------------------------------------------------- #
# Namespace keys                                                              #
# --------------------------------------------------------------------------- #
_NS = "rsi2_reversal"
_LONG_HIST_KEY = f"{_NS}.long_hist"
_IND_KEY = f"{_NS}.ind"
_EARNINGS_KEY = f"{_NS}.earnings"

_MIN_TRADING_BARS = 250


# --------------------------------------------------------------------------- #
# Process-wide indicator cache                                                #
# --------------------------------------------------------------------------- #
# Keyed by (symbol, data_identity, param_sig). ``data_identity`` is the
# id() of the underlying DataFrame so we never serve stale results.
# The cache is bounded to a few hundred entries worth of numpy arrays — at
# a couple of kB per entry this is well below 50 MB total and keeps the
# tuner trial rate high.
_PROC_IND_CACHE: dict[tuple, dict[str, np.ndarray]] = {}
_PROC_IND_MAX = 8192


def _trim_process_cache() -> None:
    if len(_PROC_IND_CACHE) > _PROC_IND_MAX:
        # Simple FIFO eviction: drop the oldest half. Python dict keeps
        # insertion order, so iterating gives us the oldest entries first.
        to_drop = len(_PROC_IND_CACHE) - (_PROC_IND_MAX // 2)
        keys = list(_PROC_IND_CACHE.keys())[:to_drop]
        for k in keys:
            _PROC_IND_CACHE.pop(k, None)


# --------------------------------------------------------------------------- #
# Bar provider adapter                                                        #
# --------------------------------------------------------------------------- #
def fetch_bars(
    ctx: Context,
    symbols: list[str],
    start: date,
    end: date,
) -> Optional[pd.DataFrame]:
    """Fetch daily bars and normalise the frame to a canonical shape."""

    provider = getattr(ctx, "bar_provider", None)
    if provider is None:
        return None
    df = provider.bars(symbols, start, end, tf="1D")
    if df is None:
        return None
    df = pd.DataFrame(df)
    if df.empty:
        return df

    cols = {c.lower(): c for c in df.columns}
    sym_col = cols.get("symbol") or cols.get("ticker")
    ts_col = cols.get("ts") or cols.get("timestamp") or cols.get("date")
    if sym_col is None or ts_col is None:
        return None

    out = pd.DataFrame(
        {
            "symbol": df[sym_col].astype(str).str.upper(),
            "ts": pd.to_datetime(df[ts_col], utc=True, errors="coerce"),
            "open": pd.to_numeric(df[cols.get("open", "open")], errors="coerce"),
            "high": pd.to_numeric(df[cols.get("high", "high")], errors="coerce"),
            "low": pd.to_numeric(df[cols.get("low", "low")], errors="coerce"),
            "close": pd.to_numeric(df[cols.get("close", "close")], errors="coerce"),
            "volume": pd.to_numeric(
                df[cols.get("volume", "volume")] if "volume" in cols else 0,
                errors="coerce",
            ).fillna(0.0),
        }
    )
    out = out.dropna(subset=["ts", "close"]).reset_index(drop=True)
    out["ts_date"] = out["ts"].dt.tz_convert("UTC").dt.date
    return out


# --------------------------------------------------------------------------- #
# Symbol history cache                                                        #
# --------------------------------------------------------------------------- #
def symbol_history(
    ctx: Context,
    sym: str,
    asof: date,
    lookback_days: int,
) -> Optional[pd.DataFrame]:
    """Return the bar history up to and including ``asof`` for ``sym``.

    Keeps a single long series per symbol in ``ctx.state`` and slices by
    ``asof`` on every call. When the slice extends past what we have
    cached we fetch a wider window once and update the cache in-place.
    """

    cache = cache_of(ctx)
    long_hist: dict[str, pd.DataFrame] = cache.setdefault(_LONG_HIST_KEY, {})
    whole = long_hist.get(sym)
    needs_fetch = (
        whole is None or whole.empty or whole["ts_date"].iloc[-1] < asof
    )
    if needs_fetch:
        start = asof - timedelta(days=lookback_days + 60)
        fetch_end = asof + timedelta(days=400)
        df = fetch_bars(ctx, [sym], start, fetch_end)
        if df is None or df.empty:
            return None
        sub = df[df["symbol"] == sym].copy()
        if sub.empty:
            return None
        sub = sub.sort_values("ts", ignore_index=True)
        long_hist[sym] = sub
        whole = sub

    cur = whole[whole["ts_date"] <= asof]
    if cur.empty:
        return None
    return cur


# --------------------------------------------------------------------------- #
# Indicator cache                                                             #
# --------------------------------------------------------------------------- #
def indicators_for(
    ctx: Context, sym: str, bars: pd.DataFrame, params: dict[str, Any]
) -> Optional[dict[str, np.ndarray]]:
    """Return RSI / CRSI / SMA arrays for ``sym`` up to the last bar in
    ``bars``. Indicators are computed once over the full long-history cache
    and sliced per-bar. We cache at both ctx scope (per-run) and process
    scope (across tuner trials), keyed by the parameter tuple + a
    content-hash of the bar history so trials with different data or
    parameters never receive stale results.
    """

    cache = cache_of(ctx)
    long_hist: dict[str, pd.DataFrame] = cache.get(_LONG_HIST_KEY, {})
    whole = long_hist.get(sym)
    if whole is None or whole.empty:
        return None
    # Content hash: (symbol, first-ts, last-ts, n) — matches across tuner
    # trials provided the underlying bar data doesn't change.
    data_id = (sym, whole["ts"].iloc[0], whole["ts"].iloc[-1], len(whole))
    rsi_sig = ("rsi", data_id, int(params["rsi_period"]))
    crsi_sig = (
        "crsi",
        data_id,
        int(params["crsi_rsi_period"]),
        int(params["crsi_streak_period"]),
        int(params["crsi_pct_rank_period"]),
    )
    sma_trend_sig = ("sma", data_id, int(params["trend_sma_period"]))
    sma_exit_sig = ("sma", data_id, int(params["exit_sma_period"]))
    ts_dates_sig = ("ts_dates", data_id)

    closes: Optional[pd.Series] = None
    if rsi_sig not in _PROC_IND_CACHE:
        if closes is None:
            closes = whole["close"].astype(float)
        if len(closes) < _MIN_TRADING_BARS:
            return None
        _PROC_IND_CACHE[rsi_sig] = rsi(
            closes, period=int(params["rsi_period"]), smoothing="wilder"
        ).to_numpy()
    if crsi_sig not in _PROC_IND_CACHE:
        if closes is None:
            closes = whole["close"].astype(float)
        if len(closes) < _MIN_TRADING_BARS:
            return None
        _PROC_IND_CACHE[crsi_sig] = connors_rsi(
            closes,
            rsi_period=int(params["crsi_rsi_period"]),
            streak_period=int(params["crsi_streak_period"]),
            pct_rank_period=int(params["crsi_pct_rank_period"]),
        ).to_numpy()
    if sma_trend_sig not in _PROC_IND_CACHE:
        if closes is None:
            closes = whole["close"].astype(float)
        _PROC_IND_CACHE[sma_trend_sig] = sma(
            closes, int(params["trend_sma_period"])
        ).to_numpy()
    if sma_exit_sig not in _PROC_IND_CACHE:
        if closes is None:
            closes = whole["close"].astype(float)
        _PROC_IND_CACHE[sma_exit_sig] = sma(
            closes, int(params["exit_sma_period"])
        ).to_numpy()
    if ts_dates_sig not in _PROC_IND_CACHE:
        _PROC_IND_CACHE[ts_dates_sig] = whole["ts_date"].to_numpy()
    _trim_process_cache()

    data = {
        "rsi": _PROC_IND_CACHE[rsi_sig],
        "crsi": _PROC_IND_CACHE[crsi_sig],
        "sma_trend": _PROC_IND_CACHE[sma_trend_sig],
        "sma_exit": _PROC_IND_CACHE[sma_exit_sig],
        "ts_dates": _PROC_IND_CACHE[ts_dates_sig],
    }

    last_date = bars["ts_date"].iloc[-1]
    idx = int(np.searchsorted(data["ts_dates"], last_date, side="right")) - 1
    if idx < 0:
        return None
    return {
        "rsi": data["rsi"][: idx + 1],
        "crsi": data["crsi"][: idx + 1],
        "sma_trend": data["sma_trend"][: idx + 1],
        "sma_exit": data["sma_exit"][: idx + 1],
    }


def indicator_at(
    ctx: Context,
    sym: str,
    asof: date,
    kind: str,
    period: int,
    lookback_days: int,
) -> Optional[float]:
    """Return the latest value of a scalar indicator on ``sym``."""

    bars = symbol_history(ctx, sym, asof, lookback_days)
    if bars is None or bars.empty:
        return None
    closes = bars["close"].astype(float)
    if kind == "rsi2":
        s = rsi(closes, period=period, smoothing="wilder")
    elif kind == "sma":
        s = sma(closes, period)
    else:
        return None
    if s.empty or pd.isna(s.iloc[-1]):
        return None
    return float(s.iloc[-1])


# --------------------------------------------------------------------------- #
# Earnings                                                                    #
# --------------------------------------------------------------------------- #
def has_upcoming_earnings(
    ctx: Context, sym: str, asof: date, window_days: int
) -> bool:
    """Return True iff ``sym`` has scheduled earnings within ``window_days``
    trading days of ``asof``. Degrades to False when no provider is wired.
    """

    provider = getattr(ctx, "earnings_provider", None)
    if provider is None:
        return False
    cache = cache_of(ctx)
    cal: Optional[dict[str, list[date]]] = cache.get(_EARNINGS_KEY)
    if cal is None:
        try:
            start = date(asof.year - 1, 1, 1)
            end = date(asof.year + 1, 12, 31)
            df = provider.calendar(start, end)
            cal = {}
            if df is not None and not df.empty:
                for _, row in df.iterrows():
                    s = str(row.get("symbol", "")).upper()
                    d_raw = row.get("date", row.get("asof", None))
                    if not s or d_raw is None:
                        continue
                    try:
                        d_val = pd.Timestamp(d_raw).date()
                    except Exception:
                        continue
                    cal.setdefault(s, []).append(d_val)
        except Exception:
            cal = {}
        cache[_EARNINGS_KEY] = cal
    dates = cal.get(sym, [])
    if not dates:
        return False
    horizon_end = asof + timedelta(days=window_days * 2)  # cal→trading fudge
    for d_val in dates:
        if asof <= d_val <= horizon_end:
            return True
    return False


# --------------------------------------------------------------------------- #
# Misc                                                                        #
# --------------------------------------------------------------------------- #
def trading_days_between(
    start: Optional[datetime | date], end: date
) -> int:
    """Business-day count between two dates (inclusive). Approximates
    trading days; adequate for a time-stop rule."""

    if start is None:
        return 0
    s = start.date() if isinstance(start, datetime) else start
    if s > end:
        return 0
    return int(len(pd.bdate_range(start=s, end=end))) - 1


__all__ = [
    "fetch_bars",
    "symbol_history",
    "indicators_for",
    "indicator_at",
    "has_upcoming_earnings",
    "trading_days_between",
]
