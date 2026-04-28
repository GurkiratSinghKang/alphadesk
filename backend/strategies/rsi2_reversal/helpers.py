"""Data / indicator helpers for the rsi2_reversal strategy — SOTA shell.

Bars flow through ``input.bars``; earnings through ``input.earnings``.
Indicator computations are kept pure so they can be shared with tests.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from indicators.momentum import connors_rsi, rsi
from indicators.trend import sma


# --------------------------------------------------------------------------- #
# Bar-panel slicing                                                           #
# --------------------------------------------------------------------------- #
def flat_bars(bars: pd.DataFrame) -> Optional[pd.DataFrame]:
    """Normalise ``input.bars`` to a flat DataFrame with symbol + ts columns."""
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

    ts = pd.to_datetime(frame["ts"], utc=True, errors="coerce")
    # Accept either tz-aware or tz-naive; normalize to UTC date.
    try:
        ts = ts.dt.tz_convert("UTC")
    except (TypeError, AttributeError):
        pass
    frame["ts"] = ts
    frame["ts_date"] = ts.dt.date
    frame["symbol"] = frame["symbol"].astype(str).str.upper()
    return frame.dropna(subset=["ts", "close"]).sort_values(["symbol", "ts"], ignore_index=True)


def symbol_history(
    flat: Optional[pd.DataFrame],
    sym: str,
    asof: date,
) -> Optional[pd.DataFrame]:
    """Return the per-symbol bar history up to and including ``asof``."""
    if flat is None or flat.empty:
        return None
    sub = flat[flat["symbol"] == sym.upper()]
    sub = sub[sub["ts_date"] <= asof]
    return sub.reset_index(drop=True) if not sub.empty else None


# --------------------------------------------------------------------------- #
# Indicators                                                                  #
# --------------------------------------------------------------------------- #
def indicators_for(bars: pd.DataFrame, params) -> Optional[dict[str, np.ndarray]]:
    """Compute RSI / CRSI / SMA arrays for the given per-symbol ``bars``."""
    if bars is None or bars.empty:
        return None
    closes = bars["close"].astype(float)
    if len(closes) < max(
        params.trend_sma_period,
        params.exit_sma_period,
        params.rsi_period + 1,
        params.crsi_pct_rank_period,
    ):
        return None

    rsi_arr = rsi(closes, period=int(params.rsi_period), smoothing="wilder").to_numpy()
    crsi_arr = connors_rsi(
        closes,
        rsi_period=int(params.crsi_rsi_period),
        streak_period=int(params.crsi_streak_period),
        pct_rank_period=int(params.crsi_pct_rank_period),
    ).to_numpy()
    sma_trend_arr = sma(closes, int(params.trend_sma_period)).to_numpy()
    sma_exit_arr = sma(closes, int(params.exit_sma_period)).to_numpy()
    return {
        "rsi": rsi_arr,
        "crsi": crsi_arr,
        "sma_trend": sma_trend_arr,
        "sma_exit": sma_exit_arr,
    }


def rsi_of_series(closes: pd.Series, period: int) -> Optional[float]:
    """Return the latest RSI value for the series, or None if not computable."""
    if closes.empty or len(closes) < period + 1:
        return None
    s = rsi(closes.astype(float), period=period, smoothing="wilder")
    if s.empty or pd.isna(s.iloc[-1]):
        return None
    return float(s.iloc[-1])


# --------------------------------------------------------------------------- #
# Earnings                                                                    #
# --------------------------------------------------------------------------- #
def has_upcoming_earnings(
    earnings: Optional[pd.DataFrame],
    sym: str,
    asof: date,
    window_days: int,
) -> bool:
    """True iff ``sym`` has scheduled earnings within ``window_days`` of ``asof``."""
    if earnings is None or getattr(earnings, "empty", True):
        return False
    if "symbol" not in earnings.columns:
        return False
    date_col = next(
        (c for c in ("date", "report_date", "ts") if c in earnings.columns),
        None,
    )
    if date_col is None:
        return False
    # Round-6 / I-7: previously ``window_days * 2`` overshot the actual
    # exclusion window the caller asks for, so e.g. a 5-day pre-earnings
    # quarantine effectively became 10 calendar days. We trust the
    # caller's intent and use ``window_days`` directly.
    horizon = asof + timedelta(days=window_days)
    frame_dates = pd.to_datetime(earnings[date_col], errors="coerce").dt.date
    mask = (
        (earnings["symbol"].astype(str).str.upper() == sym.upper())
        & (frame_dates >= asof)
        & (frame_dates <= horizon)
    )
    return bool(mask.any())


# --------------------------------------------------------------------------- #
# Misc                                                                        #
# --------------------------------------------------------------------------- #
def trading_days_between(start: Optional[date], end: date) -> int:
    """Trading-session count between two dates (inclusive of ``end``).

    Round-21 / persona-C P2: pre-fix used ``pd.bdate_range`` which is
    Mon-Fri minus 1 — ignored NYSE holidays. A 5-day holding window
    straddling Thanksgiving week ended 1 session early. Now defers to
    the real US market calendar.
    """
    if start is None:
        return 0
    if start > end:
        return 0
    try:
        from data.calendar import _default
        sessions = list(_default().sessions(start, end))
        return max(0, len(sessions) - 1)
    except Exception:
        # Calendar unavailable — Mon-Fri fallback (legacy behaviour).
        return int(len(pd.bdate_range(start=start, end=end))) - 1


def adv_dollar_mean(bars: pd.DataFrame, lookback_bars: int = 90) -> Optional[float]:
    """90-day dollar ADV for a per-symbol bar history."""
    if bars is None or bars.empty:
        return None
    tail = bars.tail(lookback_bars)
    if tail.empty:
        return None
    dollar_vol = tail["close"].astype(float) * tail["volume"].astype(float)
    return float(dollar_vol.mean()) if len(dollar_vol) else None


__all__ = [
    "flat_bars",
    "symbol_history",
    "indicators_for",
    "rsi_of_series",
    "has_upcoming_earnings",
    "trading_days_between",
    "adv_dollar_mean",
]
