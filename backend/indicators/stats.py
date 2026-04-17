"""Statistical utilities used by mean-reversion and pairs strategies:
rolling z-score, percentile rank, EWMA, Ornstein-Uhlenbeck half-life,
Hurst exponent, Engle-Granger cointegration, OLS hedge ratio, dynamic
Kalman hedge ratio.
"""
from __future__ import annotations

from typing import Tuple

import numpy as np
import pandas as pd


# -----------------------------------------------------------------------------
# Rolling z-score
# -----------------------------------------------------------------------------
def zscore(series: pd.Series, period: int) -> pd.Series:
    """Rolling z-score: (x_t - rolling_mean_N) / rolling_std_N (ddof=1).

    Warmup: `period` bars.
    """
    if period <= 1:
        raise ValueError(f"period must be >=2, got {period}")
    s = series.astype("float64")
    mean = s.rolling(window=period, min_periods=period).mean()
    std = s.rolling(window=period, min_periods=period).std(ddof=1)
    return ((s - mean) / std.replace(0.0, np.nan)).astype("float64")


# -----------------------------------------------------------------------------
# Rolling percentile rank (0..1)
# -----------------------------------------------------------------------------
def pct_rank(series: pd.Series, period: int) -> pd.Series:
    """Rolling percentile rank of the most recent value in [0, 1].

    Defined as count(x_j <= x_t) / period over the trailing `period`
    observations including t. When period=100 and today is the single
    largest value, the rank is 1.0.

    Warmup: `period` bars.
    """
    if period <= 0:
        raise ValueError(f"period must be positive, got {period}")

    def _rank(window: np.ndarray) -> float:
        if np.any(np.isnan(window)):
            return np.nan
        return float(np.sum(window <= window[-1])) / len(window)

    return (
        series.astype("float64")
        .rolling(window=period, min_periods=period)
        .apply(_rank, raw=True)
        .astype("float64")
    )


# -----------------------------------------------------------------------------
# EWMA — safe wrapper around pandas .ewm().mean()
# -----------------------------------------------------------------------------
def ewma(series: pd.Series, span: int) -> pd.Series:
    """Exponentially weighted moving average with pandas defaults.

    alpha = 2 / (span + 1),  adjust=False  -> canonical EMA form.
    """
    if span <= 0:
        raise ValueError(f"span must be positive, got {span}")
    return (
        series.astype("float64")
        .ewm(span=span, adjust=False)
        .mean()
        .astype("float64")
    )


# -----------------------------------------------------------------------------
# Ornstein-Uhlenbeck half-life
# Reference: standard OU continuous-time model
#     dx_t = kappa*(mu - x_t)*dt + sigma*dW_t
# The half-life of a shock is ln(2) / kappa. We estimate kappa via OLS of
# the discrete-time equation:
#     Δx_t = alpha + beta * x_{t-1} + eps,    kappa ≈ -beta
# so half_life = -ln(2) / beta. This is the formulation used in Chan's
# "Algorithmic Trading" (2013) and the standard stat-arb literature.
# -----------------------------------------------------------------------------
def ou_half_life(series: pd.Series) -> float:
    """Half-life of mean reversion (in bars, same frequency as input).

    Returns
    -------
    float
        Positive half-life if beta < 0 (mean-reverting). ``np.nan`` if
        beta >= 0 or OLS fails.
    """
    s = pd.Series(series).astype("float64").dropna()
    if len(s) < 5:
        return float("nan")
    y = s.diff().dropna().to_numpy()
    x = s.shift(1).dropna().to_numpy()
    # Align
    n = min(len(y), len(x))
    y = y[-n:]
    x = x[-n:]
    X = np.column_stack([np.ones_like(x), x])
    # OLS
    try:
        beta_hat, *_ = np.linalg.lstsq(X, y, rcond=None)
    except np.linalg.LinAlgError:
        return float("nan")
    beta = float(beta_hat[1])
    if not np.isfinite(beta) or beta >= 0:
        return float("nan")
    return float(-np.log(2.0) / beta)


# -----------------------------------------------------------------------------
# Hurst exponent via rescaled-range (R/S) analysis
# Reference: Hurst, H. E. (1951) / Mandelbrot & Wallis (1969).
# -----------------------------------------------------------------------------
def hurst(series: pd.Series, min_lag: int = 2, max_lag: int = 100) -> float:
    """Hurst exponent estimated by the variance-of-increments method.

    Technique (standard in quant lit, same as Ernie Chan's code):
      - for each lag tau in [min_lag, max_lag], compute the std of
        (x_{t+tau} - x_t) across t,
      - log-log regress std vs tau; slope = Hurst exponent H.

    Interpretation:
      H < 0.5 — mean reverting
      H = 0.5 — geometric Brownian motion
      H > 0.5 — trending

    Returns
    -------
    float
        Hurst exponent. ``np.nan`` if the series is too short or flat.
    """
    if max_lag <= min_lag:
        raise ValueError("max_lag must be > min_lag")
    s = pd.Series(series).astype("float64").dropna().to_numpy()
    if len(s) <= max_lag + 1:
        return float("nan")
    lags = np.arange(min_lag, max_lag + 1)
    tau = []
    for lag in lags:
        diff = s[lag:] - s[:-lag]
        std = diff.std(ddof=1)
        if std <= 0 or not np.isfinite(std):
            return float("nan")
        tau.append(std)
    tau = np.asarray(tau, dtype="float64")
    try:
        slope, _ = np.polyfit(np.log(lags), np.log(tau), 1)
    except (np.linalg.LinAlgError, ValueError):
        return float("nan")
    return float(slope)


# -----------------------------------------------------------------------------
# Engle-Granger cointegration test
# -----------------------------------------------------------------------------
def engle_granger_adf(
    y: pd.Series,
    x: pd.Series,
) -> Tuple[float, float, float, pd.Series]:
    """Engle-Granger two-step cointegration test.

    1. Regress y on x via OLS with intercept: y = alpha + beta * x + eps
    2. Run an Augmented Dickey-Fuller test on the residuals.

    If the residuals are stationary (ADF rejects unit root) the two
    series are cointegrated with hedge ratio `beta`.

    Uses ``statsmodels.tsa.stattools.adfuller`` with autolag="AIC".

    Returns
    -------
    (pvalue, adf_stat, hedge_ratio, residuals)
    """
    from statsmodels.tsa.stattools import adfuller

    y_arr = pd.Series(y).astype("float64")
    x_arr = pd.Series(x).astype("float64")
    df = pd.concat([y_arr.rename("y"), x_arr.rename("x")], axis=1).dropna()
    if len(df) < 20:
        raise ValueError(
            f"Engle-Granger needs at least 20 aligned obs, got {len(df)}"
        )
    X = np.column_stack([np.ones(len(df)), df["x"].to_numpy()])
    beta_hat, *_ = np.linalg.lstsq(X, df["y"].to_numpy(), rcond=None)
    alpha = float(beta_hat[0])
    beta = float(beta_hat[1])
    residuals = df["y"] - alpha - beta * df["x"]
    adf_stat, pvalue, *_ = adfuller(residuals.to_numpy(), autolag="AIC")
    return float(pvalue), float(adf_stat), beta, residuals


# -----------------------------------------------------------------------------
# OLS hedge ratio
# -----------------------------------------------------------------------------
def ols_hedge_ratio(y: pd.Series, x: pd.Series) -> float:
    """Static OLS hedge ratio (slope) of y regressed on x with intercept.

    Equivalent to ``cov(y, x) / var(x)`` after centering.

    Returns
    -------
    float
        The beta coefficient. Used for dollar-neutral pairs positioning.
    """
    df = (
        pd.concat([pd.Series(y).rename("y"), pd.Series(x).rename("x")], axis=1)
        .astype("float64")
        .dropna()
    )
    if len(df) < 2:
        return float("nan")
    X = np.column_stack([np.ones(len(df)), df["x"].to_numpy()])
    beta_hat, *_ = np.linalg.lstsq(X, df["y"].to_numpy(), rcond=None)
    return float(beta_hat[1])


# -----------------------------------------------------------------------------
# Dynamic Kalman hedge ratio
# -----------------------------------------------------------------------------
def kalman_hedge_ratio(
    y: pd.Series,
    x: pd.Series,
    delta: float = 1e-5,
    r: float = 1e-3,
) -> pd.Series:
    """Dynamic hedge ratio via a 1-dimensional Kalman filter on
    [intercept, slope], treating the regression y_t = alpha_t + beta_t x_t
    + eps as a random-walk state-space model.

    Model:
        state_t = [alpha_t, beta_t]^T
        state_t = state_{t-1} + w_t,  w_t ~ N(0, W)
        y_t = [1, x_t] @ state_t + v_t,  v_t ~ N(0, r)

    where W = delta/(1-delta) * I — the standard parameterization used in
    Chan's "Algorithmic Trading" (2013, eq. 3.5).

    Parameters
    ----------
    delta : float
        Controls state innovation variance. Small delta (1e-5) yields
        slow-moving hedge ratio; larger values yield snappier hedges.
    r : float
        Observation noise variance.

    Warmup: the first observation is returned as NaN (no prior state).

    Returns
    -------
    pd.Series[float64]
        The filtered slope (beta_t) at each t, indexed to match y.
    """
    df = (
        pd.concat([pd.Series(y).rename("y"), pd.Series(x).rename("x")], axis=1)
        .astype("float64")
    )
    valid = df.dropna()
    if len(valid) < 2:
        return pd.Series(np.nan, index=df.index, dtype="float64")

    # Initial state & covariance
    state = np.zeros(2)
    P = np.eye(2) * 1.0  # wide prior
    W = delta / (1.0 - delta) * np.eye(2)  # process noise

    beta_series = pd.Series(np.nan, index=df.index, dtype="float64")
    y_vals = df["y"].to_numpy()
    x_vals = df["x"].to_numpy()

    for i in range(len(df)):
        if np.isnan(y_vals[i]) or np.isnan(x_vals[i]):
            continue
        # Predict
        P = P + W
        # Observation: F_t = [1, x_t]
        F = np.array([1.0, x_vals[i]])
        # Innovation
        y_hat = float(F @ state)
        S = float(F @ P @ F.T + r)
        innov = y_vals[i] - y_hat
        K = (P @ F) / S  # Kalman gain
        state = state + K * innov
        P = P - np.outer(K, F) @ P
        beta_series.iloc[i] = state[1]

    return beta_series.astype("float64")
