"""Pure helpers for the PEAD strategy.

Kept separate from :mod:`.strategy` so the main module stays under the
500-line cap and so the pure numerical utilities (SUE computation, the
overlap filter, liquidity filter, trading-day math) can be tested in
isolation.

Task 19 note: the ``ctx``-based helpers (``fetch_bars``, ``get_calendar``,
``get_surprises``) that used to live here were dropped along with
``strategies/base.py`` — the new :class:`PEADStrategy.run` receives all its
data through :class:`StrategyInput` and never touches a ``Context`` object.
"""

from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional

import numpy as np
import pandas as pd


log = logging.getLogger("alphadesk.strategies.pead.helpers")


def compute_sue(
    actual: Optional[float],
    estimated: Optional[float],
    history: Optional[pd.DataFrame],
    asof: date,
    lookback_quarters: int,
    min_quarters: int,
) -> Optional[float]:
    """Compute the SUE for a single announcement.

    ``history`` is the trailing surprise DataFrame (rows strictly before
    ``asof``) used to compute the denominator σ.
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

    Round-6 / I-25 (no behaviour change): the fallback cushion is
    ``round(horizon_days * 7/5) + 2``. That is intentionally
    **conservative** — it can overshoot by ~2 sessions on a
    holiday-dense horizon (e.g. a 5-session holding period that
    straddles MLK + Presidents' Day will mark 9 calendar days as
    ineligible instead of 7). The audit explicitly preferred a
    false-positive on overlap (skip a marginal trade) over a
    false-negative (enter into an unannounced re-report). When the
    NYSE-aware ``calendar_provider`` is wired the math is exact and
    the cushion is unused.
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
        # Round-6 / I-25: conservative fallback (overshoots by ~2 sessions
        # on a holiday-heavy horizon — see docstring). Trades a marginal
        # entry-skip for a guarantee that the overlap gap stays closed.
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
    "compute_sue",
    "passes_liquidity",
    "has_overlapping_earnings",
    "trading_days_between",
]
