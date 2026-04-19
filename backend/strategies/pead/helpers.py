"""Data + SUE-computation helpers for the PEAD strategy.

Kept separate from :mod:`.strategy` so the main module stays under the
500-line cap and so the pure numerical utilities (SUE computation, the
overlap filter, the surprise-cache bucket) can be tested in isolation.
"""

from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional

import numpy as np
import pandas as pd

from strategies.base import Context, cache_of


log = logging.getLogger("alphadesk.strategies.pead.helpers")


# --------------------------------------------------------------------------- #
# Namespace keys                                                              #
# --------------------------------------------------------------------------- #
_NS = "pead"
_CAL_KEY = f"{_NS}.calendar"
_SURPRISES_KEY = f"{_NS}.surprises"
_BARS_KEY = f"{_NS}.bars"


# --------------------------------------------------------------------------- #
# Bar panel                                                                   #
# --------------------------------------------------------------------------- #
def fetch_bars(
    ctx: Context,
    symbols: list[str],
    start: date,
    end: date,
) -> Optional[pd.DataFrame]:
    """Fetch daily OHLCV bars and normalise column names."""

    provider = getattr(ctx, "bar_provider", None)
    if provider is None:
        return None
    try:
        df = provider.bars(symbols, start, end, tf="1D")
    except Exception as exc:
        log.warning("pead: bar_provider.bars failed: %s", exc)
        return None
    if df is None:
        return None
    df = pd.DataFrame(df)
    if df.empty:
        return df

    cols = {c.lower(): c for c in df.columns}
    sym_c = cols.get("symbol") or cols.get("ticker")
    ts_c = cols.get("ts") or cols.get("timestamp") or cols.get("date")
    if not (sym_c and ts_c):
        return None

    out = pd.DataFrame(
        {
            "symbol": df[sym_c].astype(str).str.upper(),
            "ts": pd.to_datetime(df[ts_c], utc=True, errors="coerce"),
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
# Earnings calendar                                                           #
# --------------------------------------------------------------------------- #
def get_calendar(
    ctx: Context,
    start: date,
    end: date,
    universe: Iterable[str],
) -> pd.DataFrame:
    """Return the earnings calendar for ``[start, end]`` restricted to
    ``universe``. Cached once per strategy run on ``ctx.state``.

    Fetching strategy:
    FMP's /earnings-calendar endpoint caps results at 4000 rows/call and
    disallows ranges older than 5 years. We chunk the request into quarterly
    windows so a multi-year backtest completes without loss. Inside a given
    run the frame is cached on ctx.state for O(log n) per-day lookups.
    """

    cache = cache_of(ctx)
    meta = cache.get(_CAL_KEY)
    universe_set = {s.upper() for s in universe}

    need = (
        meta is None
        or meta.get("universe") != universe_set
        or meta.get("start") is None
        or meta.get("start") > start
        or meta.get("end") is None
        or meta.get("end") < end
    )
    if need:
        empty_cols = [
            "symbol", "date", "eps_actual", "eps_estimated",
            "revenue_actual", "revenue_estimated",
        ]
        provider = getattr(ctx, "earnings_provider", None)
        if provider is None:
            empty = pd.DataFrame(columns=empty_cols)
            cache[_CAL_KEY] = {
                "universe": universe_set,
                "start": start,
                "end": end,
                "data": empty,
            }
            return empty

        frames: list[pd.DataFrame] = []
        for chunk_start, chunk_end in _monthly_chunks(start, end):
            try:
                df = provider.calendar(chunk_start, chunk_end)
            except Exception as exc:
                log.warning(
                    "pead: calendar fetch failed %s→%s: %s",
                    chunk_start, chunk_end, exc,
                )
                continue
            if df is None or getattr(df, "empty", True):
                continue
            df = pd.DataFrame(df).copy()
            df["symbol"] = df["symbol"].astype(str).str.upper()
            frames.append(df[df["symbol"].isin(universe_set)])

        if not frames:
            filtered = pd.DataFrame(columns=empty_cols)
        else:
            filtered = pd.concat(frames, ignore_index=True)
            filtered["date"] = filtered["date"].apply(_coerce_date)
            filtered = filtered.drop_duplicates(subset=["symbol", "date"])
            filtered = filtered.sort_values(["date", "symbol"], ignore_index=True)

        cache[_CAL_KEY] = {
            "universe": universe_set,
            "start": start,
            "end": end,
            "data": filtered,
        }
        meta = cache[_CAL_KEY]

    return meta["data"]


def _monthly_chunks(start: date, end: date) -> list[tuple[date, date]]:
    """Split ``[start, end]`` into calendar-month-sized chunks.

    FMP /earnings-calendar caps each call at 4000 rows. Peak earnings weeks
    can return 1,000+ rows on their own, and a full quarter can saturate the
    cap and silently drop observations. Monthly chunks (~500-2,500 rows
    each) stay well under the limit for every month in 2019-2024.
    """

    import calendar as _cal
    chunks: list[tuple[date, date]] = []
    cur = start
    while cur <= end:
        year = cur.year
        month = cur.month
        last_day = _cal.monthrange(year, month)[1]
        chunk_end = date(year, month, last_day)
        if chunk_end > end:
            chunk_end = end
        chunks.append((cur, chunk_end))
        cur = chunk_end + timedelta(days=1)
    return chunks


# --------------------------------------------------------------------------- #
# Surprises + SUE computation                                                 #
# --------------------------------------------------------------------------- #
def get_surprises(
    ctx: Context,
    symbol: str,
    start: date,
    end: date,
) -> Optional[pd.DataFrame]:
    """Return the historical surprise series for one symbol.

    Cached per-symbol in ``ctx.state``; the per-backtest cost is at most
    one FMP call per symbol. The FMP /earnings endpoint returns up to 160
    quarters by symbol, so we intentionally pull a very wide window
    (``start - 10y``) to capture enough history for the trailing-σ
    computation regardless of the caller's backtest range.
    """

    cache = cache_of(ctx)
    bucket = cache.setdefault(_SURPRISES_KEY, {})
    existing = bucket.get(symbol)
    if existing is not None:
        return existing

    provider = getattr(ctx, "earnings_provider", None)
    if provider is None:
        bucket[symbol] = None
        return None

    # Pull a wide window so we get all the historical surprises the FMP
    # endpoint has, not just the backtest range. The FMP adapter filters
    # by date on the output, so narrowing the input window actively starves
    # the σ denominator.
    wide_start = start - timedelta(days=3650)  # 10y back
    wide_end = end + timedelta(days=30)

    try:
        df = provider.surprises(symbol, wide_start, wide_end)
    except Exception as exc:
        log.debug("pead: surprises(%s) failed: %s", symbol, exc)
        df = None

    if df is None or getattr(df, "empty", True):
        bucket[symbol] = None
        return None

    df = pd.DataFrame(df).copy()
    if "date" in df.columns:
        df["date"] = df["date"].apply(_coerce_date)
    df = df.sort_values("date", ignore_index=True)
    bucket[symbol] = df
    return df


def compute_sue(
    actual: Optional[float],
    estimated: Optional[float],
    history: Optional[pd.DataFrame],
    asof: date,
    lookback_quarters: int,
    min_quarters: int,
) -> Optional[float]:
    """Compute the SUE for a single announcement.

    ``history`` is the trailing surprise DataFrame from :func:`get_surprises`
    — we use rows strictly before ``asof`` to compute the denominator σ.
    """

    if actual is None or estimated is None:
        return None
    try:
        actual_f = float(actual)
        estimated_f = float(estimated)
    except (TypeError, ValueError):
        return None
    if math.isnan(actual_f) or math.isnan(estimated_f):
        return None

    surprise = actual_f - estimated_f

    if history is None or history.empty:
        return None

    # Past surprises strictly before asof.
    past = history[history["date"] < asof]
    if "surprise" in past.columns:
        past_surp = past["surprise"].dropna()
    else:
        past_surp = (past["eps_actual"] - past["eps_estimated"]).dropna()
    past_surp = past_surp.tail(int(lookback_quarters))

    if len(past_surp) < int(min_quarters):
        return None

    sigma = float(past_surp.std(ddof=1))
    if not math.isfinite(sigma) or sigma <= 1e-9:
        return None

    return surprise / sigma


# --------------------------------------------------------------------------- #
# Liquidity / universe filters                                                #
# --------------------------------------------------------------------------- #
def passes_liquidity(
    bars: Optional[pd.DataFrame],
    asof: date,
    adv_usd_min: float,
    price_min: float,
) -> bool:
    """True iff the name meets the liquidity floors as of ``asof``.

    Needs ~90 sessions of bar history; returns False on insufficient data
    (fail-closed).
    """

    if bars is None or bars.empty:
        return False
    hist = bars[bars["ts_date"] <= asof].tail(90)
    if len(hist) < 30:
        return False
    close = float(hist["close"].iloc[-1])
    if not math.isfinite(close) or close < price_min:
        return False
    dollar_vol = (hist["close"].astype(float) * hist["volume"].astype(float)).tail(90)
    if dollar_vol.empty:
        return False
    adv = float(dollar_vol.mean())
    if not math.isfinite(adv) or adv < adv_usd_min:
        return False
    return True


def has_overlapping_earnings(
    calendar: pd.DataFrame,
    symbol: str,
    entry_day: date,
    horizon_days: int,
    calendar_provider: Any = None,
) -> bool:
    """True iff ``symbol`` has another earnings announcement in the
    ``horizon_days`` trading sessions strictly after ``entry_day``.

    When ``calendar_provider`` is supplied and exposes ``sessions(start,
    end)``, the exclusion window uses exact session math (NYSE holidays
    respected). Otherwise we fall back to a business-day cushion that
    overshoots slightly — preserved for callers that don't have a
    calendar provider wired.
    """

    if calendar is None or calendar.empty:
        return False
    sym = symbol.upper()
    sub = calendar[calendar["symbol"] == sym]
    if sub.empty:
        return False

    upper = _session_offset(
        entry_day, int(horizon_days), calendar_provider
    )
    if upper is None:
        # Conservative fallback (overshoots by ~2 sessions on a holiday-
        # heavy horizon, but always closes the overlap gap).
        cushion = int(round(horizon_days * 7.0 / 5.0)) + 2
        upper = entry_day + timedelta(days=cushion)

    for d in sub["date"]:
        d_val = _coerce_date(d)
        if d_val is None:
            continue
        if entry_day < d_val <= upper:
            return True
    return False


def trading_days_between(
    start: Optional[date | datetime],
    end: date,
    calendar_provider: Any = None,
) -> int:
    """Session count between ``start`` and ``end`` (exclusive of the start).

    Uses ``calendar_provider.sessions(start, end)`` when available so
    NYSE holidays (MLK, Presidents' Day, Good Friday, Juneteenth, …) are
    honoured. Falls back to :func:`pandas.bdate_range` when no provider
    is supplied.
    """

    if start is None:
        return 0
    s = start.date() if isinstance(start, datetime) else start
    if s > end:
        return 0

    if calendar_provider is not None and hasattr(calendar_provider, "sessions"):
        try:
            sess = list(calendar_provider.sessions(s, end))
        except Exception:
            sess = None
        if sess is not None:
            parsed = sorted(
                {
                    (d if isinstance(d, date) else pd.Timestamp(d).date())
                    for d in sess
                }
            )
            if parsed:
                # Exclude the start session, matching the prior contract.
                return max(0, len([d for d in parsed if d > s]))

    return int(len(pd.bdate_range(start=s, end=end))) - 1


def _session_offset(
    entry_day: date,
    horizon_sessions: int,
    calendar_provider: Any,
) -> Optional[date]:
    """Return the session that is ``horizon_sessions`` trading days after
    ``entry_day`` per ``calendar_provider``. ``None`` if no provider."""

    if calendar_provider is None or not hasattr(calendar_provider, "sessions"):
        return None
    try:
        # Pull ~double the horizon in calendar days to absorb weekends +
        # holidays without running off the end of the provider's window.
        end_cal = entry_day + timedelta(days=max(7, horizon_sessions * 2 + 14))
        sess = list(calendar_provider.sessions(entry_day, end_cal))
    except Exception:
        return None
    parsed = sorted(
        {
            (d if isinstance(d, date) else pd.Timestamp(d).date())
            for d in sess
            if d is not None
        }
    )
    after = [d for d in parsed if d > entry_day]
    if not after:
        return None
    if horizon_sessions <= 0:
        return entry_day
    idx = min(horizon_sessions, len(after)) - 1
    return after[idx]


# --------------------------------------------------------------------------- #
# Small utilities                                                             #
# --------------------------------------------------------------------------- #
def _coerce_date(v: Any) -> Optional[date]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return pd.Timestamp(v).date()
    except Exception:
        return None


__all__ = [
    "fetch_bars",
    "get_calendar",
    "get_surprises",
    "compute_sue",
    "passes_liquidity",
    "has_overlapping_earnings",
    "trading_days_between",
]
