from __future__ import annotations

import logging
from datetime import date

from typing import Annotated

from fastapi import APIRouter, Query

# Models, demo helpers, Alpaca-OPRA helpers, and TTL caches live in the
# service layer so non-HTTP callers (e.g. ``services.earnings_screener``)
# can reach them without crossing the layering line (B-62). The public
# API of ``api.routes.options`` is preserved by re-exporting the names
# below.
from services.options import (  # noqa: F401 — re-exported for tests/back-compat
    Greeks,
    IVData,
    OptionChain,
    OptionContract,
    OptionType,
    _DEMO_BASE_IV,
    _chain_cache,
    _demo_spot,
    _iv_cache,
    _real_spot_cache,
    _ttl_lru_set,
    fetch_chain,
    fetch_iv_analysis,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/chain/{symbol}", response_model=OptionChain)
async def get_options_chain(
    symbol: str,
    expiry: Annotated[date | None, Query(description="Filter to a specific expiration")] = None,
    strike_min: Annotated[float | None, Query()] = None,
    strike_max: Annotated[float | None, Query()] = None,
    option_type: Annotated[OptionType | None, Query()] = None,
) -> OptionChain:
    """Fetch the full options chain for an underlying symbol.

    Thin HTTP wrapper: delegates to :func:`services.options.fetch_chain`,
    which owns the Alpaca OPRA → demo waterfall (B-62).
    """
    return await fetch_chain(symbol, expiry, strike_min, strike_max, option_type)


@router.get("/iv/{symbol}", response_model=IVData)
async def get_iv_analysis(symbol: str) -> IVData:
    """Compute IV rank, percentile, and skew analysis for a symbol.

    Thin HTTP wrapper: delegates to
    :func:`services.options.fetch_iv_analysis` (B-62).
    """
    return await fetch_iv_analysis(symbol)


@router.get("/greeks/{symbol}/{strike}/{expiry}", response_model=Greeks)
async def get_greeks(
    symbol: str,
    strike: float,
    expiry: date,
    option_type: OptionType = Query(OptionType.CALL),
    risk_free_rate: float = Query(0.05, description="Annualised risk-free rate"),
) -> Greeks:
    """Compute option greeks using Black-Scholes-Merton.

    Accepts spot price from cache/market data and computes theoretical
    values for the specified contract.
    """
    from scipy.stats import norm
    import numpy as np
    from core.redis import cache_get

    symbol = symbol.upper()

    # Get spot price
    quote = await cache_get(f"quote:{symbol}") or {}
    spot = quote.get("last", 0) or await _demo_spot(symbol)

    # Get IV
    iv_data = await cache_get(f"iv:{symbol}") or {}
    sigma = iv_data.get("current_iv", 0) or _DEMO_BASE_IV.get(symbol, 0.30)

    # Time to expiry in years
    days = (expiry - date.today()).days
    T = max(days / 365.0, 1 / 365.0)

    # BSM calculations
    d1 = (np.log(spot / strike) + (risk_free_rate + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)

    if option_type == OptionType.CALL:
        delta = float(norm.cdf(d1))
        price = float(spot * norm.cdf(d1) - strike * np.exp(-risk_free_rate * T) * norm.cdf(d2))
        rho = float(strike * T * np.exp(-risk_free_rate * T) * norm.cdf(d2) / 100)
        intrinsic = max(spot - strike, 0)
    else:
        delta = float(norm.cdf(d1) - 1)
        price = float(strike * np.exp(-risk_free_rate * T) * norm.cdf(-d2) - spot * norm.cdf(-d1))
        rho = float(-strike * T * np.exp(-risk_free_rate * T) * norm.cdf(-d2) / 100)
        intrinsic = max(strike - spot, 0)

    gamma = float(norm.pdf(d1) / (spot * sigma * np.sqrt(T)))
    # Black-Scholes-Merton theta. The r*K*e^(-rT) term is subtracted for a
    # call (dividend of time value as T→0 reduces the call) and ADDED for
    # a put (the discounted strike component is a credit on the put side).
    # The prior code used the same minus sign for both by flipping the
    # norm.cdf argument, which produced the wrong magnitude and a wrong
    # sign on puts.
    common_theta = -(spot * norm.pdf(d1) * sigma) / (2 * np.sqrt(T))
    discount_term = risk_free_rate * strike * np.exp(-risk_free_rate * T)
    if option_type == OptionType.CALL:
        theta = float(common_theta - discount_term * norm.cdf(d2)) / 365
    else:
        theta = float(common_theta + discount_term * norm.cdf(-d2)) / 365
    vega = float(spot * norm.pdf(d1) * np.sqrt(T) / 100)

    return Greeks(
        symbol=symbol,
        strike=strike,
        expiry=expiry,
        option_type=option_type,
        delta=round(delta, 4),
        gamma=round(gamma, 6),
        theta=round(theta, 4),
        vega=round(vega, 4),
        rho=round(rho, 4),
        iv=round(sigma, 4),
        theoretical_price=round(price, 2),
        intrinsic_value=round(intrinsic, 2),
        extrinsic_value=round(max(price - intrinsic, 0), 2),
    )
