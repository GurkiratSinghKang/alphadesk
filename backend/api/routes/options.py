from __future__ import annotations

import logging
import math
import re
from datetime import date

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request

from api.routes._rate_limit import check_contract_snapshot_rate
from core.http import client_ip

# Models, demo helpers, Alpaca-OPRA helpers, and TTL caches live in the
# service layer so non-HTTP callers (e.g. ``services.earnings_screener``)
# can reach them without crossing the layering line (B-62). The public
# API of ``api.routes.options`` is preserved by re-exporting the names
# below.
from services.options import (  # noqa: F401 — re-exported for tests/back-compat
    ContractSnapshot,
    Greeks,
    IVData,
    OptionChain,
    OptionContract,
    OptionType,
    _DEMO_BASE_IV,
    _OCC_SYMBOL_PATTERN,
    _chain_cache,
    _contract_snapshot_cache,
    _demo_spot,
    _iv_cache,
    _real_spot_cache,
    _ttl_lru_set,
    fetch_chain,
    fetch_contract_snapshot,
    fetch_iv_analysis,
)

logger = logging.getLogger(__name__)

router = APIRouter()
_SYMBOL_RE = re.compile(r"^[A-Z]{1,6}(?:\.[A-Z])?$")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/chain/{symbol}",
    response_model=OptionChain,
    summary="Options chain for an underlying (Batch T T-2/T-3/T-4)",
    description=(
        "Returns the options chain for ``symbol`` with a stable shape "
        "regardless of which filters are applied:\n\n"
        "* ``expirations`` always lists every expiry the provider knows "
        "about (use it to iterate per-expiry).\n"
        "* ``contracts`` is restricted to the **nearest expiry** when "
        "``expiry`` is omitted; pass ``expiry=YYYY-MM-DD`` to pin a "
        "specific date.\n"
        "* ``volume`` reflects cumulative session volume (falls back to "
        "the previous session if the request lands pre-open).\n"
        "* ``open_interest`` is the EOD-settlement OI from Alpaca.\n"
        "* Greeks (``delta``, ``gamma``, ``theta``, ``vega``, ``rho``) "
        "are pre-computed via Black-Scholes when the upstream snapshot "
        "doesn't carry them — eliminating the N+1 ``/greeks`` round-trip.\n"
        "* ``limit`` defaults to 200 (max 500). The previous silent "
        "100-row cap is gone.\n\n"
        "Response shape is identical for real and demo chains; the "
        "``is_demo`` flag tells callers which side answered."
    ),
)
async def get_options_chain(
    symbol: str,
    expiry: Annotated[date | None, Query(description="Filter to a specific expiration (YYYY-MM-DD). When omitted, the response is restricted to the nearest expiry but ``expirations`` still lists all available dates.")] = None,
    strike_min: Annotated[float | None, Query(description="Minimum strike (inclusive)")] = None,
    strike_max: Annotated[float | None, Query(description="Maximum strike (inclusive)")] = None,
    option_type: Annotated[OptionType | None, Query(description="Filter to ``call`` or ``put`` (omit to return both legs).")] = None,
    limit: Annotated[int, Query(ge=1, le=500, description="Maximum contracts to return. Default 200, hard ceiling 500. Replaces the silent 100-row cap that callers used to hit.")] = 200,
) -> OptionChain:
    """Fetch the full options chain for an underlying symbol.

    Thin HTTP wrapper: delegates to :func:`services.options.fetch_chain`,
    which owns the Alpaca OPRA → demo waterfall (B-62) and the Batch T
    chain-shape contract.
    """
    return await fetch_chain(
        symbol, expiry, strike_min, strike_max, option_type, chain_limit=limit,
    )


@router.get(
    "/contract-snapshot",
    response_model=ContractSnapshot,
    summary="Per-contract NBBO snapshot (PM-C)",
    description=(
        "Returns a top-of-book snapshot for a single OCC option symbol. "
        "Polled at ~2s by the frontend NBBO display.\n\n"
        "Provider waterfall: Polygon "
        "(`/v3/snapshot/options/{underlying}/{contract}`) → Alpaca OPRA "
        "(`/v1beta1/options/snapshots/{symbol}`) → demo synthesis. "
        "Polygon is preferred because it surfaces the originating "
        "exchange ID for both top-of-book quotes; Alpaca aggregates NBBO "
        "without venue attribution. The endpoint never 503s — both "
        "upstream failures fall through to a deterministic demo snapshot "
        "with `is_demo=true`.\n\n"
        "Cached at the service layer with a 2-second TTL keyed on the "
        "OCC symbol — collapses 30 frontend calls/min to ~1-2 upstream "
        "calls/min per contract. Per-IP rate-limited at 60/min."
    ),
)
async def get_contract_snapshot(
    request: Request,
    symbol: Annotated[
        str,
        Query(
            min_length=9,
            max_length=21,
            description=(
                "OCC option symbol (e.g. ``AAPL250418C00250000``). 1-6 "
                "letter underlying, YYMMDD expiry, ``C`` or ``P``, then "
                "an 8-digit strike (×1000)."
            ),
        ),
    ],
) -> ContractSnapshot:
    """Thin HTTP wrapper: rate-limit then delegate to the service layer.

    Validation, caching, and the provider waterfall all live in
    :func:`services.options.fetch_contract_snapshot`. The route's only
    job is enforcing the per-IP rate limit and unpacking the request.
    """
    await check_contract_snapshot_rate(client_ip(request))
    return await fetch_contract_snapshot(symbol.upper())


@router.get(
    "/iv/{symbol}",
    response_model=IVData,
    summary="IV rank, percentile, skew and term structure",
    description=(
        "Computes ATM IV, IV rank/percentile (when ≥ 60 daily samples have "
        "accumulated under the ``iv_history:{symbol}`` rolling key), HV "
        "20/50/100, the per-strike IV smile around ATM, and the per-expiry "
        "term structure. Real and demo paths populate the same shape; "
        "``is_demo`` tells callers which side answered. ``iv_rank`` and "
        "``iv_percentile`` may be null on real responses while history "
        "warms up — they are NOT synthesized from the live chain."
    ),
)
async def get_iv_analysis(symbol: str) -> IVData:
    """Compute IV rank, percentile, and skew analysis for a symbol.

    Thin HTTP wrapper: delegates to
    :func:`services.options.fetch_iv_analysis` (B-62).
    """
    return await fetch_iv_analysis(symbol)


@router.get(
    "/greeks/{symbol}/{strike}/{expiry}",
    response_model=Greeks,
    summary="Black-Scholes greeks for a single contract",
    description=(
        "Computes greeks for a single contract via the Hull (9e) BSM "
        "closed forms. For batch use, prefer ``/chain/{symbol}`` — the "
        "chain response now carries pre-computed greeks per contract "
        "(Batch T T-3) so callers don't need to fan out to this endpoint."
    ),
)
async def get_greeks(
    symbol: str,
    strike: float,
    expiry: date,
    option_type: Annotated[OptionType, Query()] = OptionType.CALL,
    risk_free_rate: Annotated[float, Query(description="Annualised risk-free rate")] = 0.05,
) -> Greeks:
    """Compute option greeks using Black-Scholes-Merton.

    Accepts spot price from cache/market data and computes theoretical
    values for the specified contract.
    """
    import numpy as np
    from scipy.stats import norm
    from core.redis import cache_get

    symbol = symbol.upper()
    if not _SYMBOL_RE.fullmatch(symbol):
        raise HTTPException(status_code=422, detail="Invalid option symbol")
    if not math.isfinite(strike) or strike <= 0:
        raise HTTPException(status_code=422, detail="Strike must be greater than 0")
    if not math.isfinite(risk_free_rate):
        raise HTTPException(status_code=422, detail="Risk-free rate must be finite")

    # Get spot price
    quote = await cache_get(f"quote:{symbol}") or {}
    spot = quote.get("last", 0)
    if not spot:
        if symbol not in _DEMO_BASE_IV:
            raise HTTPException(status_code=404, detail=f"Unknown option symbol: {symbol}")
        spot = await _demo_spot(symbol)
    if not math.isfinite(float(spot)) or float(spot) <= 0:
        raise HTTPException(status_code=422, detail="Spot price must be greater than 0")

    # Get IV
    iv_data = await cache_get(f"iv:{symbol}") or {}
    sigma = iv_data.get("current_iv", 0) or _DEMO_BASE_IV.get(symbol, 0.30)
    if not math.isfinite(float(sigma)) or float(sigma) <= 0:
        raise HTTPException(status_code=422, detail="Implied volatility must be greater than 0")

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
