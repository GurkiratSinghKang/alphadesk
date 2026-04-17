"""Options math: Black-Scholes price, Greeks, implied vol, IV rank /
percentile, term-structure slope.

All math follows the Black-Scholes-Merton model with continuous dividend
yield ``q``. References:
  - Black, Fischer & Scholes, Myron (1973)
  - Merton, Robert C. (1973) — the dividend-yield generalization
  - Hull, "Options, Futures and Other Derivatives" ch. 17 for the BSM
    pricing formula and the standard Greek closed forms.
"""
from __future__ import annotations

from typing import Literal

import numpy as np
import pandas as pd
from scipy.stats import norm
from scipy.optimize import brentq

CallPut = Literal["call", "put", "C", "P"]


def _norm_cp(call_put: CallPut) -> int:
    """Return +1 for calls, -1 for puts."""
    cp = call_put.lower() if isinstance(call_put, str) else call_put
    if cp in ("call", "c"):
        return 1
    if cp in ("put", "p"):
        return -1
    raise ValueError(f"call_put must be 'call' or 'put', got {call_put!r}")


def _d1(spot, strike, tau, r, q, sigma):
    return (
        np.log(spot / strike) + (r - q + 0.5 * sigma * sigma) * tau
    ) / (sigma * np.sqrt(tau))


# -----------------------------------------------------------------------------
# Black-Scholes price
# -----------------------------------------------------------------------------
def bs_price(
    spot: float,
    strike: float,
    tau: float,
    r: float,
    q: float,
    sigma: float,
    call_put: CallPut,
) -> float:
    """Black-Scholes-Merton option price with continuous dividend yield.

    Parameters
    ----------
    spot : float       Underlying price (S).
    strike : float     Strike price (K).
    tau : float        Time to expiry in years (T - t).
    r : float          Risk-free rate (continuously compounded, annualized).
    q : float          Continuous dividend yield (annualized).
    sigma : float      Volatility (annualized, e.g. 0.20 for 20%).
    call_put : str     "call" or "put" (also accepts "C"/"P").

    Handles the tau=0 and sigma=0 edge cases via intrinsic value.
    """
    cp = _norm_cp(call_put)
    if tau <= 0 or sigma <= 0:
        # Intrinsic value
        if cp == 1:
            return float(max(spot - strike, 0.0))
        return float(max(strike - spot, 0.0))
    d1 = _d1(spot, strike, tau, r, q, sigma)
    d2 = d1 - sigma * np.sqrt(tau)
    disc_r = np.exp(-r * tau)
    disc_q = np.exp(-q * tau)
    if cp == 1:
        price = spot * disc_q * norm.cdf(d1) - strike * disc_r * norm.cdf(d2)
    else:
        price = strike * disc_r * norm.cdf(-d2) - spot * disc_q * norm.cdf(-d1)
    return float(price)


# -----------------------------------------------------------------------------
# Greeks — closed-form BSM (Hull, 9e, tables 17.1–17.2)
# -----------------------------------------------------------------------------
def bs_greeks(
    spot: float,
    strike: float,
    tau: float,
    r: float,
    q: float,
    sigma: float,
    call_put: CallPut,
) -> dict:
    """Black-Scholes-Merton Greeks.

    Returns dict with:
      - delta : dC/dS     (calls in [0, e^-q*tau], puts in [-e^-q*tau, 0])
      - gamma : d^2C/dS^2 (same for calls and puts)
      - vega  : dC/dsigma, per 1.0 change in sigma (i.e. per 100 vol pts)
      - theta : dC/dt,    per 1.0 calendar year; callers typically /365 for daily
      - rho   : dC/dr,    per 1.0 change in r (i.e. per 100 rate pts)

    Matches the standard Hull (9e) formulas. Delta & rho follow the
    continuous-yield sign conventions used by most professional libraries
    (py_vollib / QuantLib).
    """
    cp = _norm_cp(call_put)
    if tau <= 0 or sigma <= 0:
        return {
            "delta": float(cp) if (cp == 1 and spot > strike) or (cp == -1 and spot < strike) else 0.0,
            "gamma": 0.0,
            "vega": 0.0,
            "theta": 0.0,
            "rho": 0.0,
        }
    d1 = _d1(spot, strike, tau, r, q, sigma)
    d2 = d1 - sigma * np.sqrt(tau)
    pdf_d1 = float(norm.pdf(d1))
    disc_r = float(np.exp(-r * tau))
    disc_q = float(np.exp(-q * tau))
    sqrt_tau = float(np.sqrt(tau))

    if cp == 1:
        delta = disc_q * float(norm.cdf(d1))
    else:
        delta = disc_q * (float(norm.cdf(d1)) - 1.0)

    gamma = disc_q * pdf_d1 / (spot * sigma * sqrt_tau)
    vega = spot * disc_q * pdf_d1 * sqrt_tau

    # Theta (per year). Sign: negative for long calls/puts on flat markets.
    if cp == 1:
        theta = (
            -spot * disc_q * pdf_d1 * sigma / (2.0 * sqrt_tau)
            + q * spot * disc_q * float(norm.cdf(d1))
            - r * strike * disc_r * float(norm.cdf(d2))
        )
    else:
        theta = (
            -spot * disc_q * pdf_d1 * sigma / (2.0 * sqrt_tau)
            - q * spot * disc_q * float(norm.cdf(-d1))
            + r * strike * disc_r * float(norm.cdf(-d2))
        )

    if cp == 1:
        rho = strike * tau * disc_r * float(norm.cdf(d2))
    else:
        rho = -strike * tau * disc_r * float(norm.cdf(-d2))

    return {
        "delta": float(delta),
        "gamma": float(gamma),
        "vega": float(vega),
        "theta": float(theta),
        "rho": float(rho),
    }


# -----------------------------------------------------------------------------
# Implied volatility via Brent root-finder
# -----------------------------------------------------------------------------
def iv_from_price(
    price: float,
    spot: float,
    strike: float,
    tau: float,
    r: float,
    q: float,
    call_put: CallPut,
) -> float:
    """Solve Black-Scholes for implied volatility given an observed price.

    Uses scipy.optimize.brentq over sigma in [1e-6, 5.0]. Returns ``np.nan``
    if the price is outside the BS no-arbitrage bounds or the bracket
    doesn't change sign (deeply ITM/OTM with stale data).
    """
    cp = _norm_cp(call_put)
    # No-arbitrage bounds
    disc_r = np.exp(-r * tau) if tau > 0 else 1.0
    disc_q = np.exp(-q * tau) if tau > 0 else 1.0
    if cp == 1:
        lower = max(spot * disc_q - strike * disc_r, 0.0)
        upper = spot * disc_q
    else:
        lower = max(strike * disc_r - spot * disc_q, 0.0)
        upper = strike * disc_r

    if not (lower - 1e-9 <= price <= upper + 1e-9):
        return float("nan")

    def objective(sigma: float) -> float:
        return bs_price(spot, strike, tau, r, q, sigma, call_put) - price

    try:
        iv = brentq(objective, 1e-6, 5.0, maxiter=200, xtol=1e-8)
    except (ValueError, RuntimeError):
        return float("nan")
    return float(iv)


# -----------------------------------------------------------------------------
# IV rank & IV percentile
# -----------------------------------------------------------------------------
def iv_rank(iv_series: pd.Series, lookback_days: int = 252) -> pd.Series:
    """IV rank: (iv_t - min) / (max - min) over the past `lookback_days`.

    Returns a float in [0, 1]. Standard definition from options literature
    (e.g. tastytrade education materials).

    Warmup: `lookback_days` observations.
    """
    if lookback_days <= 1:
        raise ValueError("lookback_days must be >=2")
    s = pd.Series(iv_series).astype("float64")
    lo = s.rolling(window=lookback_days, min_periods=lookback_days).min()
    hi = s.rolling(window=lookback_days, min_periods=lookback_days).max()
    rng = (hi - lo).replace(0.0, np.nan)
    return ((s - lo) / rng).astype("float64")


def iv_percentile(iv_series: pd.Series, lookback_days: int = 252) -> pd.Series:
    """IV percentile: fraction of past `lookback_days` on which IV was
    below today's IV. Value in [0, 1].

    This differs from iv_rank: percentile is distributional, rank is
    range-based.
    """
    if lookback_days <= 1:
        raise ValueError("lookback_days must be >=2")

    def _pct(window: np.ndarray) -> float:
        if np.any(np.isnan(window)):
            return np.nan
        today = window[-1]
        prior = window[:-1]
        if len(prior) == 0:
            return float("nan")
        return float(np.sum(prior < today)) / len(prior)

    return (
        pd.Series(iv_series)
        .astype("float64")
        .rolling(window=lookback_days, min_periods=lookback_days)
        .apply(_pct, raw=True)
        .astype("float64")
    )


# -----------------------------------------------------------------------------
# Term-structure slope
# -----------------------------------------------------------------------------
def term_structure_slope(chain_df: pd.DataFrame) -> float:
    """Term-structure slope of ATM IV.

    Given a DataFrame with at least the columns ``expiration`` (date-like)
    and ``atm_iv`` (float), return ``front_iv - back_iv`` where the front
    is the nearest expiration and back is the furthest.

    Positive slope → backwardated vol surface (front > back) — common
    around earnings or macro events. Negative → contango.

    Returns
    -------
    float
        np.nan if fewer than 2 unique expirations.
    """
    required = {"expiration", "atm_iv"}
    missing = required - set(chain_df.columns)
    if missing:
        raise ValueError(f"chain_df missing columns: {sorted(missing)}")
    df = chain_df[["expiration", "atm_iv"]].dropna()
    if df.empty:
        return float("nan")
    # Normalize expirations to datetime for ordering
    df = df.assign(expiration=pd.to_datetime(df["expiration"]))
    df = df.sort_values("expiration")
    uniq = df.drop_duplicates(subset="expiration", keep="first")
    if len(uniq) < 2:
        return float("nan")
    front = float(uniq["atm_iv"].iloc[0])
    back = float(uniq["atm_iv"].iloc[-1])
    return front - back
