"""Trend indicators: SMA, EMA, KAMA, Donchian channels, Ichimoku Kinko Hyo.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# -----------------------------------------------------------------------------
# SMA / EMA
# -----------------------------------------------------------------------------
def sma(series: pd.Series, period: int) -> pd.Series:
    """Simple moving average. Warmup: `period` bars."""
    if period <= 0:
        raise ValueError(f"period must be positive, got {period}")
    return (
        series.astype("float64")
        .rolling(window=period, min_periods=period)
        .mean()
        .astype("float64")
    )


def ema(series: pd.Series, period: int, adjust: bool = False) -> pd.Series:
    """Exponential moving average.

    When ``adjust=False`` (the default), this is the recursive EMA:
        y_t = alpha * x_t + (1 - alpha) * y_{t-1}, with alpha = 2/(period+1)
    which is the form quantitative TA libraries use.

    When ``adjust=True``, pandas uses the bias-corrected formula that
    converges to the equilibrium distribution faster for short windows.

    No leading NaNs are emitted; pandas ewm starts at bar 0. Callers that
    need a clean warmup should mask the first `period` outputs themselves.
    """
    if period <= 0:
        raise ValueError(f"period must be positive, got {period}")
    return (
        series.astype("float64")
        .ewm(span=period, adjust=adjust)
        .mean()
        .astype("float64")
    )


# -----------------------------------------------------------------------------
# KAMA — Kaufman's Adaptive Moving Average
# Reference: Perry Kaufman, "Smarter Trading" (1995), ch. 6.
# -----------------------------------------------------------------------------
def kama(
    series: pd.Series,
    er_period: int = 10,
    fast: int = 2,
    slow: int = 30,
) -> pd.Series:
    """Kaufman Adaptive Moving Average.

    ER (efficiency ratio) = |price_t - price_{t-er_period}| / sum(|diff_1|)_N
    fastest_sc = 2 / (fast + 1)
    slowest_sc = 2 / (slow + 1)
    SC = (ER * (fastest_sc - slowest_sc) + slowest_sc)^2
    KAMA_t = KAMA_{t-1} + SC * (price_t - KAMA_{t-1})

    Seeding convention: KAMA at index (er_period) is set to the simple
    average of the first `er_period` prices (matches Kaufman's original
    worked example and virtually all public references).

    Warmup: `er_period` bars of leading NaN.

    Complexity: O(n) — a single Python loop is required because KAMA is
    recursive in its own prior value.

    Returns
    -------
    pd.Series[float64]
    """
    if er_period <= 0 or fast <= 0 or slow <= 0:
        raise ValueError("er_period, fast, slow must all be positive")
    if fast >= slow:
        raise ValueError(f"fast ({fast}) must be < slow ({slow})")

    s = series.astype("float64")
    n = len(s)
    values = s.to_numpy()

    if n <= er_period:
        return pd.Series(np.nan, index=s.index, dtype="float64")

    # Efficiency ratio components
    change = np.abs(values[er_period:] - values[:-er_period])  # |x_t - x_{t-N}|
    abs_diff = np.abs(np.diff(values))  # |Δ1| length n-1
    volatility = np.array(
        [abs_diff[i - er_period : i].sum() for i in range(er_period, n)],
        dtype="float64",
    )
    with np.errstate(divide="ignore", invalid="ignore"):
        er = np.where(volatility > 0, change / volatility, 0.0)

    fastest_sc = 2.0 / (fast + 1.0)
    slowest_sc = 2.0 / (slow + 1.0)
    sc = (er * (fastest_sc - slowest_sc) + slowest_sc) ** 2

    kama_out = np.full(n, np.nan, dtype="float64")
    # Seed: simple mean of first er_period prices, positioned at index er_period
    seed_idx = er_period
    kama_out[seed_idx] = values[:er_period].mean()

    for i in range(seed_idx + 1, n):
        sc_i = sc[i - seed_idx]  # sc array is length n - er_period starting at er_period
        kama_out[i] = kama_out[i - 1] + sc_i * (values[i] - kama_out[i - 1])

    return pd.Series(kama_out, index=s.index, dtype="float64")


# -----------------------------------------------------------------------------
# Donchian channels (Richard Donchian, 1960s)
# -----------------------------------------------------------------------------
def donchian(
    high: pd.Series,
    low: pd.Series,
    period: int = 20,
) -> pd.DataFrame:
    """Donchian channels.

    upper_t  = max(high over past `period` bars including t)
    lower_t  = min(low  over past `period` bars including t)
    middle_t = (upper + lower) / 2

    Warmup: `period` bars of leading NaN.

    Returns
    -------
    pd.DataFrame with columns ["upper", "middle", "lower"], float64.
    """
    if period <= 0:
        raise ValueError(f"period must be positive, got {period}")
    h = high.astype("float64")
    lo = low.astype("float64")
    upper = h.rolling(window=period, min_periods=period).max()
    lower = lo.rolling(window=period, min_periods=period).min()
    middle = (upper + lower) / 2.0
    return pd.DataFrame(
        {"upper": upper, "middle": middle, "lower": lower},
        index=h.index,
        dtype="float64",
    )


# -----------------------------------------------------------------------------
# Ichimoku Kinko Hyo (Ichimoku, 1930s, published 1969)
# -----------------------------------------------------------------------------
def ichimoku(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    tenkan_period: int = 9,
    kijun_period: int = 26,
    senkou_b_period: int = 52,
    displacement: int = 26,
) -> pd.DataFrame:
    """Ichimoku Cloud — full five-line system.

        Tenkan-sen  = (max(high, 9)  + min(low, 9))  / 2
        Kijun-sen   = (max(high, 26) + min(low, 26)) / 2
        Senkou A    = (Tenkan + Kijun) / 2            shifted +26 forward
        Senkou B    = (max(high, 52) + min(low, 52)) / 2   shifted +26 forward
        Chikou      = close shifted -26 backward

    The leading spans (Senkou A/B) are plotted 26 bars in the future —
    here we return them aligned to the bar they project from so callers
    can shift as needed. The standard convention is that `senkou_a` at
    index t is the leading span A value plotted at index t+26; we follow
    that convention by applying the +26 shift inside this function so the
    returned Series is already aligned to "the chart time".

    Warmup: 52 bars for Senkou B; plus the 26-bar forward shift is applied
    (so the first 52+26 = 78 bars of senkou_a/senkou_b are NaN). The
    chikou (lagging) span is the close shifted -26, so it is non-NaN from
    bar 0 up to the last 26 bars.

    Returns
    -------
    pd.DataFrame with columns ["tenkan", "kijun", "senkou_a",
    "senkou_b", "chikou"], float64.
    """
    h = high.astype("float64")
    lo = low.astype("float64")
    c = close.astype("float64")

    tenkan = (
        h.rolling(tenkan_period, min_periods=tenkan_period).max()
        + lo.rolling(tenkan_period, min_periods=tenkan_period).min()
    ) / 2.0
    kijun = (
        h.rolling(kijun_period, min_periods=kijun_period).max()
        + lo.rolling(kijun_period, min_periods=kijun_period).min()
    ) / 2.0
    senkou_a = ((tenkan + kijun) / 2.0).shift(displacement)
    senkou_b = (
        (
            h.rolling(senkou_b_period, min_periods=senkou_b_period).max()
            + lo.rolling(senkou_b_period, min_periods=senkou_b_period).min()
        )
        / 2.0
    ).shift(displacement)
    chikou = c.shift(-displacement)

    return pd.DataFrame(
        {
            "tenkan": tenkan,
            "kijun": kijun,
            "senkou_a": senkou_a,
            "senkou_b": senkou_b,
            "chikou": chikou,
        },
        index=h.index,
        dtype="float64",
    )
