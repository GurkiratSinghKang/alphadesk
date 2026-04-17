"""Volatility estimators: ATR, Parkinson, Garman-Klass, realized vol, HV."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .momentum import _wilder_smooth

# Annualization factor. We use 252 trading days/year by convention.
_TRADING_DAYS = 252


# -----------------------------------------------------------------------------
# ATR — Average True Range (Wilder 1978)
# -----------------------------------------------------------------------------
def atr(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 14,
) -> pd.Series:
    """Wilder's Average True Range.

    TR_t = max(high-low, |high-close_{t-1}|, |close_{t-1}-low|)
    ATR_t = Wilder-smoothed TR over `period`

    Warmup: `period` bars. Wilder smoothing seeds with the SMA of the
    first `period` TR values.

    Returns
    -------
    pd.Series[float64]
    """
    if period <= 0:
        raise ValueError(f"period must be positive, got {period}")
    h = high.astype("float64")
    lo = low.astype("float64")
    c = close.astype("float64")
    prev_close = c.shift(1)
    tr = pd.concat(
        [
            (h - lo),
            (h - prev_close).abs(),
            (lo - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return _wilder_smooth(tr, period).astype("float64")


# -----------------------------------------------------------------------------
# Parkinson (1980) realized volatility
# Reference: Parkinson, "The Extreme Value Method for Estimating the
# Variance of the Rate of Return", J. Business 53 (1980) 61-65.
# -----------------------------------------------------------------------------
def parkinson(
    high: pd.Series,
    low: pd.Series,
    period: int,
    annualize: bool = True,
) -> pd.Series:
    """Parkinson realized-volatility estimator.

    sigma^2_PK (single bar) = (1 / (4 ln 2)) * [ln(H/L)]^2

    The rolling estimator averages the per-bar variance over `period` bars
    and takes the square root. If ``annualize`` is True the result is
    multiplied by sqrt(252).

    Warmup: `period` bars.

    Returns
    -------
    pd.Series[float64]   (annualized) volatility expressed as a decimal (0.25 = 25%).
    """
    if period <= 0:
        raise ValueError(f"period must be positive, got {period}")
    h = high.astype("float64")
    lo = low.astype("float64")
    bar_var = (np.log(h / lo) ** 2) / (4.0 * np.log(2.0))
    rolling_var = bar_var.rolling(window=period, min_periods=period).mean()
    sigma = np.sqrt(rolling_var)
    if annualize:
        sigma = sigma * np.sqrt(_TRADING_DAYS)
    return sigma.astype("float64")


# -----------------------------------------------------------------------------
# Garman-Klass (1980) realized volatility
# Reference: Garman & Klass, "On the Estimation of Security Price
# Volatilities from Historical Data", J. Business 53 (1980) 67-78.
# -----------------------------------------------------------------------------
def garman_klass(
    open: pd.Series,
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int,
    annualize: bool = True,
) -> pd.Series:
    """Garman-Klass realized-volatility estimator.

    sigma^2_GK (single bar) = 0.5 * [ln(H/L)]^2
                            - (2 ln 2 - 1) * [ln(C/O)]^2

    Warmup: `period` bars.

    Returns
    -------
    pd.Series[float64]   (annualized) volatility expressed as a decimal.
    """
    if period <= 0:
        raise ValueError(f"period must be positive, got {period}")
    o = open.astype("float64")
    h = high.astype("float64")
    lo = low.astype("float64")
    c = close.astype("float64")
    log_hl = np.log(h / lo) ** 2
    log_co = np.log(c / o) ** 2
    bar_var = 0.5 * log_hl - (2.0 * np.log(2.0) - 1.0) * log_co
    # Guard against negative variance (numerical noise on flat bars)
    bar_var = bar_var.clip(lower=0.0)
    rolling_var = bar_var.rolling(window=period, min_periods=period).mean()
    sigma = np.sqrt(rolling_var)
    if annualize:
        sigma = sigma * np.sqrt(_TRADING_DAYS)
    return sigma.astype("float64")


# -----------------------------------------------------------------------------
# Plain realized volatility (close-to-close)
# -----------------------------------------------------------------------------
def realized_vol(
    returns: pd.Series,
    period: int,
    annualize: bool = True,
) -> pd.Series:
    """Standard close-to-close realized volatility.

    Computed as the rolling sample standard deviation (ddof=1) of the
    supplied `returns` series over `period` observations.

    Warmup: `period` observations.

    Returns
    -------
    pd.Series[float64]  (annualized) volatility.
    """
    if period <= 1:
        raise ValueError(f"period must be >=2, got {period}")
    r = returns.astype("float64")
    sigma = r.rolling(window=period, min_periods=period).std(ddof=1)
    if annualize:
        sigma = sigma * np.sqrt(_TRADING_DAYS)
    return sigma.astype("float64")


# -----------------------------------------------------------------------------
# Historical vol of log returns
# -----------------------------------------------------------------------------
def hv(
    series: pd.Series,
    period: int = 20,
    annualize: bool = True,
) -> pd.Series:
    """Historical volatility: rolling std of log returns of a price series.

    Computes log(close_t / close_{t-1}) then the `period`-bar rolling
    sample std (ddof=1). Annualized by sqrt(252) when ``annualize=True``.

    Warmup: `period + 1` bars (one for the log return, `period` for the std).

    Returns
    -------
    pd.Series[float64]
    """
    if period <= 1:
        raise ValueError(f"period must be >=2, got {period}")
    s = series.astype("float64")
    log_ret = np.log(s / s.shift(1))
    return realized_vol(log_ret, period=period, annualize=annualize)
