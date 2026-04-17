"""Volume indicators: session-anchored VWAP, rolling VWAP, OBV, volume z-score."""
from __future__ import annotations

import numpy as np
import pandas as pd


def _typical_price(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
) -> pd.Series:
    """Typical price (H+L+C)/3 — the standard VWAP numerator input."""
    return (
        high.astype("float64")
        + low.astype("float64")
        + close.astype("float64")
    ) / 3.0


# -----------------------------------------------------------------------------
# Session-anchored VWAP — the canonical intraday VWAP
# -----------------------------------------------------------------------------
def vwap_session(
    df: pd.DataFrame,
    session_start_col: str = "session_start",
) -> pd.Series:
    """Session-anchored VWAP.

    VWAP_t = sum(typical_i * volume_i) / sum(volume_i),  i running from
    the first bar of the current session up through t.

    ``df`` must contain columns ``high``, ``low``, ``close``, ``volume``.
    Session grouping:
      - If ``session_start_col`` is present, rows where that column is
        truthy mark the first bar of each session.
      - Otherwise we group by the calendar date of ``df.index`` (DatetimeIndex
        required), which matches US equity sessions for 1-minute bars in
        America/New_York.

    Warmup: none (VWAP is defined from the first bar of each session).

    Returns
    -------
    pd.Series[float64] aligned with ``df``.
    """
    required = {"high", "low", "close", "volume"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"df is missing required columns: {sorted(missing)}")

    tp = _typical_price(df["high"], df["low"], df["close"])
    vol = df["volume"].astype("float64")
    pv = tp * vol

    if session_start_col in df.columns:
        # Cumulative segment ID = cumulative sum of session-start flags
        seg_id = df[session_start_col].astype(bool).cumsum()
    else:
        if not isinstance(df.index, pd.DatetimeIndex):
            raise ValueError(
                "vwap_session needs either a DatetimeIndex or a "
                f"`{session_start_col}` column to group sessions"
            )
        seg_id = pd.Series(df.index.normalize(), index=df.index)

    cum_pv = pv.groupby(seg_id).cumsum()
    cum_vol = vol.groupby(seg_id).cumsum()
    vwap = cum_pv / cum_vol.replace(0.0, np.nan)
    return vwap.astype("float64")


# -----------------------------------------------------------------------------
# Rolling N-bar VWAP — useful on daily bars
# -----------------------------------------------------------------------------
def vwap_rolling(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    volume: pd.Series,
    period: int = 20,
) -> pd.Series:
    """Rolling VWAP over `period` bars.

    VWAP_t = sum(typical_i * vol_i, i in [t-period+1, t]) /
             sum(vol_i, i in [t-period+1, t])

    Warmup: `period` bars.

    Returns
    -------
    pd.Series[float64]
    """
    if period <= 0:
        raise ValueError(f"period must be positive, got {period}")
    tp = _typical_price(high, low, close)
    vol = volume.astype("float64")
    pv = tp * vol
    num = pv.rolling(window=period, min_periods=period).sum()
    den = vol.rolling(window=period, min_periods=period).sum()
    return (num / den.replace(0.0, np.nan)).astype("float64")


# -----------------------------------------------------------------------------
# OBV — On-Balance Volume (Granville 1963)
# -----------------------------------------------------------------------------
def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    """On-Balance Volume.

    OBV_0 = 0
    OBV_t = OBV_{t-1} + volume_t            if close_t > close_{t-1}
          = OBV_{t-1} - volume_t            if close_t < close_{t-1}
          = OBV_{t-1}                        otherwise

    Reference: Joseph Granville, "Granville's New Key to Stock Market
    Profits" (1963).

    Warmup: OBV is defined from bar 0; the first bar has no prior close so
    we start OBV at 0 and begin updating from bar 1. (This matches the
    convention in pandas-ta, TA-Lib and TradingView.)

    Returns
    -------
    pd.Series[float64]
    """
    c = close.astype("float64")
    v = volume.astype("float64")
    direction = np.sign(c.diff())  # NaN for bar 0
    signed_volume = direction.fillna(0.0) * v
    return signed_volume.cumsum().astype("float64")


# -----------------------------------------------------------------------------
# Volume z-score
# -----------------------------------------------------------------------------
def volume_zscore(volume: pd.Series, period: int = 20) -> pd.Series:
    """Rolling z-score of volume: (vol_t - mean_N) / std_N.

    Warmup: `period` bars.

    Returns
    -------
    pd.Series[float64]
    """
    if period <= 1:
        raise ValueError(f"period must be >=2, got {period}")
    v = volume.astype("float64")
    mean = v.rolling(window=period, min_periods=period).mean()
    std = v.rolling(window=period, min_periods=period).std(ddof=1)
    return ((v - mean) / std.replace(0.0, np.nan)).astype("float64")
