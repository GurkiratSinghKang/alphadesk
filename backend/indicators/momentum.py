"""Momentum indicators: RSI (Wilder), ConnorsRSI, MACD, ADX, ROC.

All functions return float64 pandas Series/DataFrames preserving the input
index. Warmup periods emit NaN.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _wilder_smooth(x: pd.Series, period: int) -> pd.Series:
    """Wilder's smoothing (a.k.a. Wilder RMA): first value is an SMA of the
    first `period` observations, then recursively

        y_t = y_{t-1} + (x_t - y_{t-1}) / period

    which is mathematically equivalent to an EMA with alpha = 1/period.

    Complexity: O(n), one Python loop (pandas' ewm with alpha=1/period is
    equivalent and vectorized, so we use that for speed).
    """
    arr = x.astype("float64")
    # Use pandas ewm: alpha = 1/period. We seed with SMA(period) to match
    # Wilder's original definition exactly by suppressing the pre-warmup
    # partial-window output.
    sma_seed = arr.rolling(window=period, min_periods=period).mean()
    # Start ewm from the first full SMA window
    idx_first = sma_seed.first_valid_index()
    if idx_first is None:
        return pd.Series(np.nan, index=arr.index, dtype="float64")

    pos_first = arr.index.get_loc(idx_first)
    out_values = np.full(len(arr), np.nan, dtype="float64")
    out_values[pos_first] = float(sma_seed.iloc[pos_first])
    # Recursive Wilder smoothing after seed
    alpha = 1.0 / period
    prev = out_values[pos_first]
    values = arr.to_numpy()
    for i in range(pos_first + 1, len(arr)):
        prev = prev + alpha * (values[i] - prev)
        out_values[i] = prev
    return pd.Series(out_values, index=arr.index, dtype="float64")


# -----------------------------------------------------------------------------
# RSI (Wilder 1978, "New Concepts in Technical Trading Systems")
# -----------------------------------------------------------------------------
def rsi(
    series: pd.Series,
    period: int = 14,
    smoothing: str = "wilder",
) -> pd.Series:
    """Relative Strength Index.

    Classical Wilder formula (Wilder 1978):
        gain_t = max(close_t - close_{t-1}, 0)
        loss_t = max(close_{t-1} - close_t, 0)
        avg_gain = Wilder-smoothed gain over `period`
        avg_loss = Wilder-smoothed loss over `period`
        RS = avg_gain / avg_loss
        RSI = 100 - 100 / (1 + RS)

    Parameters
    ----------
    series : pd.Series
        Price series (typically closes).
    period : int, default 14
        Lookback period.
    smoothing : {"wilder", "sma"}
        "wilder" (default) -> original Wilder RMA smoothing.
        "sma"              -> simple moving average of gains/losses
                              (the Cutler variant, a.k.a. "Cutler's RSI").

    Warmup: first `period` outputs are NaN (needs `period` diffs).

    Returns
    -------
    pd.Series[float64]
    """
    if smoothing not in {"wilder", "sma"}:
        raise ValueError(f"smoothing must be 'wilder' or 'sma', got {smoothing!r}")

    s = series.astype("float64")
    delta = s.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)

    if smoothing == "wilder":
        avg_gain = _wilder_smooth(gain, period)
        avg_loss = _wilder_smooth(loss, period)
    else:  # sma
        avg_gain = gain.rolling(window=period, min_periods=period).mean()
        avg_loss = loss.rolling(window=period, min_periods=period).mean()

    # Avoid division by zero: if avg_loss == 0, RSI = 100 (infinite RS).
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi_val = 100.0 - 100.0 / (1.0 + rs)
    # When avg_loss was 0 but avg_gain > 0 -> RSI = 100
    # When both are 0 -> RSI is defined as 50 by convention (flat market)
    all_zero = (avg_gain == 0.0) & (avg_loss == 0.0)
    only_loss_zero = (avg_loss == 0.0) & (avg_gain > 0.0)
    rsi_val = rsi_val.where(~only_loss_zero, 100.0)
    rsi_val = rsi_val.where(~all_zero, 50.0)
    return rsi_val.astype("float64")


# -----------------------------------------------------------------------------
# Connors RSI (Connors & Alvarez, "Short Term Trading Strategies that Work")
# -----------------------------------------------------------------------------
def _streak(series: pd.Series) -> pd.Series:
    """Consecutive up/down streak of daily closes.

    +k if close has been up for k consecutive days, -k if down, 0 if flat.
    """
    s = series.astype("float64")
    diff = s.diff()
    # +1 up, -1 down, 0 flat
    sign = np.sign(diff.to_numpy())
    out = np.full(len(s), np.nan, dtype="float64")
    # First value is NaN (no prior day); second onward: build streak
    streak = 0.0
    for i, v in enumerate(sign):
        if np.isnan(v):
            out[i] = np.nan
            streak = 0.0
            continue
        if v > 0:
            streak = streak + 1 if streak >= 0 else 1
        elif v < 0:
            streak = streak - 1 if streak <= 0 else -1
        else:
            streak = 0
        out[i] = streak
    return pd.Series(out, index=s.index, dtype="float64")


def _rolling_pct_rank(series: pd.Series, period: int) -> pd.Series:
    """Rolling percentile rank of the last value in the window, scaled 0..100.

    Matches the ConnorsRSI formulation: count(prior < current) / (N-1) * 100
    where N = period, using the most recent `period` 1-day returns (including
    today).
    """
    s = series.astype("float64")
    # For each position, rank of latest vs the prior period-1 observations.
    # Use rolling apply: O(n*period). For period=100 this is plenty fast.
    def rank_last(window: np.ndarray) -> float:
        if np.any(np.isnan(window)):
            return np.nan
        today = window[-1]
        prior = window[:-1]
        if len(prior) == 0:
            return np.nan
        return float(np.sum(prior < today)) / len(prior) * 100.0

    return s.rolling(window=period, min_periods=period).apply(rank_last, raw=True)


def connors_rsi(
    series: pd.Series,
    rsi_period: int = 3,
    streak_period: int = 2,
    pct_rank_period: int = 100,
) -> pd.Series:
    """Connors RSI = (RSI(close, rsi_period) + RSI(streak, streak_period)
                      + pct_rank(1d_return, pct_rank_period)) / 3

    Reference: Laurence Connors & Cesar Alvarez, "An Introduction to
    ConnorsRSI" (2012). The three components each emit 0-100, so the
    composite is 0-100.

    Warmup: max(rsi_period, streak_period, pct_rank_period) + 1.

    Returns
    -------
    pd.Series[float64]
    """
    s = series.astype("float64")
    rsi_close = rsi(s, period=rsi_period, smoothing="wilder")
    streak = _streak(s)
    rsi_streak = rsi(streak, period=streak_period, smoothing="wilder")
    ret_1d = s.pct_change()
    pr = _rolling_pct_rank(ret_1d, pct_rank_period)
    crsi = (rsi_close + rsi_streak + pr) / 3.0
    return crsi.astype("float64")


# -----------------------------------------------------------------------------
# MACD (Appel 1979)
# -----------------------------------------------------------------------------
def macd(
    series: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> pd.DataFrame:
    """Moving Average Convergence Divergence.

    macd_line     = EMA(close, fast) - EMA(close, slow)
    signal_line   = EMA(macd_line, signal)
    histogram     = macd_line - signal_line

    EMAs use standard pandas ewm with adjust=False.

    Reference: Gerald Appel, "Technical Analysis: Power Tools for Active
    Investors" (2005).

    Warmup: ~ slow + signal bars for histogram to stabilize; strictly
    non-NaN from bar 0 because pandas ewm fills from start.

    Returns
    -------
    pd.DataFrame with columns ["macd", "signal", "histogram"], float64.
    """
    if fast >= slow:
        raise ValueError(f"fast ({fast}) must be < slow ({slow})")
    s = series.astype("float64")
    ema_fast = s.ewm(span=fast, adjust=False).mean()
    ema_slow = s.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    return pd.DataFrame(
        {
            "macd": macd_line,
            "signal": signal_line,
            "histogram": hist,
        },
        index=s.index,
        dtype="float64",
    )


# -----------------------------------------------------------------------------
# ADX (Wilder 1978)
# -----------------------------------------------------------------------------
def adx(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 14,
) -> pd.Series:
    """Average Directional Index (Wilder 1978).

    +DM_t = high_t - high_{t-1}  if > (low_{t-1} - low_t) and > 0, else 0
    -DM_t = low_{t-1} - low_t    if > (high_t - high_{t-1}) and > 0, else 0
    TR    = max(high-low, |high-close_{t-1}|, |close_{t-1}-low|)

    Wilder-smoothed sums over `period`:
        +DI = 100 * smoothed(+DM) / smoothed(TR)
        -DI = 100 * smoothed(-DM) / smoothed(TR)
        DX  = 100 * |+DI - -DI| / (+DI + -DI)
        ADX = Wilder-smoothed DX over `period`

    Warmup: 2*period bars.

    Returns
    -------
    pd.Series[float64]  (ADX only. For +DI/-DI callers can recompute.)
    """
    h = high.astype("float64")
    lo = low.astype("float64")
    c = close.astype("float64")

    up_move = h.diff()
    down_move = -lo.diff()
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    plus_dm = pd.Series(plus_dm, index=h.index, dtype="float64")
    minus_dm = pd.Series(minus_dm, index=h.index, dtype="float64")

    prev_close = c.shift(1)
    tr = pd.concat(
        [
            (h - lo),
            (h - prev_close).abs(),
            (lo - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)

    tr_s = _wilder_smooth(tr, period)
    plus_s = _wilder_smooth(plus_dm, period)
    minus_s = _wilder_smooth(minus_dm, period)
    plus_di = 100.0 * plus_s / tr_s
    minus_di = 100.0 * minus_s / tr_s
    dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan)
    adx_val = _wilder_smooth(dx, period)
    return adx_val.astype("float64")


# -----------------------------------------------------------------------------
# ROC — rate of change
# -----------------------------------------------------------------------------
def roc(series: pd.Series, period: int) -> pd.Series:
    """Rate of change: (x_t / x_{t-period}) - 1.

    Warmup: `period` bars of leading NaN.
    """
    if period <= 0:
        raise ValueError(f"period must be positive, got {period}")
    s = series.astype("float64")
    return (s / s.shift(period) - 1.0).astype("float64")
