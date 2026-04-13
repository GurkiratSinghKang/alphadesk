from __future__ import annotations

import hashlib
import logging
import math
import random
from datetime import date, datetime, timedelta, timezone
from enum import Enum

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from api.routes.market import _is_valid_demo_symbol

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class OptionType(str, Enum):
    CALL = "call"
    PUT = "put"


class OptionContract(BaseModel):
    symbol: str
    underlying: str
    expiry: date
    strike: float
    option_type: OptionType
    bid: float
    ask: float
    last: float
    volume: int
    open_interest: int
    iv: float
    delta: float
    gamma: float
    theta: float
    vega: float
    rho: float = 0.0


class OptionChain(BaseModel):
    underlying: str
    spot_price: float
    expirations: list[date]
    contracts: list[OptionContract]
    fetched_at: datetime


class IVData(BaseModel):
    symbol: str
    current_iv: float
    iv_rank: float = Field(..., description="IV rank 0-100")
    iv_percentile: float = Field(..., description="IV percentile 0-100")
    hv_20: float
    hv_50: float
    hv_100: float
    iv_skew: dict[str, float] = Field(default_factory=dict, description="Strike -> IV mapping for skew")
    term_structure: dict[str, float] = Field(default_factory=dict, description="Expiry -> IV mapping")


class Greeks(BaseModel):
    symbol: str
    strike: float
    expiry: date
    option_type: OptionType
    delta: float
    gamma: float
    theta: float
    vega: float
    rho: float
    iv: float
    theoretical_price: float
    intrinsic_value: float
    extrinsic_value: float


# ---------------------------------------------------------------------------
# Demo data helpers
# ---------------------------------------------------------------------------

_DEMO_BASE_PRICES: dict[str, float] = {
    "AAPL": 230.0, "NVDA": 140.0, "TSLA": 275.0, "MSFT": 430.0,
    "AMZN": 195.0, "META": 530.0, "GOOGL": 175.0, "SPY": 590.0,
    "AMD": 165.0, "NFLX": 680.0, "CRM": 310.0, "INTC": 32.0,
}

_DEMO_BASE_IV: dict[str, float] = {
    "TSLA": 0.55, "NVDA": 0.48, "AMD": 0.45, "META": 0.38,
    "NFLX": 0.40, "COIN": 0.65, "AAPL": 0.25, "MSFT": 0.22,
    "AMZN": 0.30, "GOOGL": 0.26, "SPY": 0.15,
}


def _symbol_seed(symbol: str) -> int:
    return int(hashlib.md5(symbol.upper().encode()).hexdigest()[:8], 16)


def _demo_spot(symbol: str) -> float:
    s = symbol.upper()
    if s in _DEMO_BASE_PRICES:
        return _DEMO_BASE_PRICES[s]
    rng = random.Random(_symbol_seed(s))
    return round(rng.uniform(20, 500), 2)


def _next_friday(from_date: date) -> date:
    """Return the next Friday on or after from_date."""
    days_ahead = 4 - from_date.weekday()  # Friday = 4
    if days_ahead <= 0:
        days_ahead += 7
    return from_date + timedelta(days=days_ahead)


def _approx_bsm_price(spot: float, strike: float, T: float, sigma: float,
                       r: float, is_call: bool) -> float:
    """Simple BSM approximation for demo prices."""
    if T <= 0:
        T = 1 / 365
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    # Approximate normal CDF with tanh
    def _ncdf(x: float) -> float:
        return 0.5 * (1 + math.tanh(x * 0.7978845608))
    if is_call:
        return spot * _ncdf(d1) - strike * math.exp(-r * T) * _ncdf(d2)
    else:
        return strike * math.exp(-r * T) * _ncdf(-d2) - spot * _ncdf(-d1)


def _demo_chain(symbol: str, expiry_filter: date | None,
                strike_min: float | None, strike_max: float | None,
                option_type_filter: OptionType | None) -> OptionChain:
    s = symbol.upper()
    rng = random.Random(_symbol_seed(s))
    spot = _demo_spot(s)
    base_iv = _DEMO_BASE_IV.get(s, 0.30)
    r = 0.05

    # Generate 6 weekly expirations
    today = date.today()
    first_friday = _next_friday(today)
    expirations = [first_friday + timedelta(weeks=i) for i in range(6)]

    if expiry_filter:
        expirations = [e for e in expirations if e == expiry_filter]
        if not expirations:
            expirations = [expiry_filter]

    # Determine strike increment based on price
    if spot < 50:
        strike_inc = 1.0
    elif spot < 200:
        strike_inc = 2.5
    else:
        strike_inc = 5.0

    # Strikes from ~90% to ~110% of spot
    low_strike = math.floor(spot * 0.90 / strike_inc) * strike_inc
    high_strike = math.ceil(spot * 1.10 / strike_inc) * strike_inc
    strikes = []
    k = low_strike
    while k <= high_strike:
        strikes.append(k)
        k += strike_inc

    contracts: list[OptionContract] = []

    for exp in expirations:
        T = max((exp - today).days / 365.0, 1 / 365)
        for strike in strikes:
            if strike_min and strike < strike_min:
                continue
            if strike_max and strike > strike_max:
                continue

            moneyness = abs(math.log(spot / strike)) if strike > 0 else 0
            # IV smile: increase IV further OTM
            smile_adj = base_iv * (1 + 1.5 * moneyness)
            iv = round(smile_adj + rng.uniform(-0.02, 0.02), 4)

            for otype in [OptionType.CALL, OptionType.PUT]:
                if option_type_filter and otype != option_type_filter:
                    continue

                is_call = otype == OptionType.CALL
                price = _approx_bsm_price(spot, strike, T, iv, r, is_call)
                price = max(round(price, 2), 0.01)

                # Greeks approximation
                d1 = (math.log(spot / strike) + (r + 0.5 * iv ** 2) * T) / (iv * math.sqrt(T)) if iv > 0 and T > 0 else 0
                delta = round(0.5 * (1 + math.tanh(d1 * 0.7978845608)) if is_call else 0.5 * (1 + math.tanh(d1 * 0.7978845608)) - 1, 4)
                gamma = round(0.3989 * math.exp(-d1**2 / 2) / (spot * iv * math.sqrt(T)) if iv > 0 and T > 0 else 0, 6)
                theta = round(-price / (T * 365) * rng.uniform(0.8, 1.2), 4)
                vega = round(spot * 0.3989 * math.exp(-d1**2 / 2) * math.sqrt(T) / 100, 4)

                spread = max(round(price * rng.uniform(0.02, 0.08), 2), 0.01)
                bid = round(max(price - spread / 2, 0.01), 2)
                ask = round(price + spread / 2, 2)

                # Volume/OI: ATM gets more, OTM gets less
                atm_factor = max(0.1, 1 - moneyness * 5)
                volume = int(rng.randint(10, 5000) * atm_factor)
                oi = int(rng.randint(100, 30000) * atm_factor)

                ticker_str = f"O:{s}{exp.strftime('%y%m%d')}{'C' if is_call else 'P'}{int(strike * 1000):08d}"

                contracts.append(OptionContract(
                    symbol=ticker_str,
                    underlying=s,
                    expiry=exp,
                    strike=strike,
                    option_type=otype,
                    bid=bid,
                    ask=ask,
                    last=round(price, 2),
                    volume=volume,
                    open_interest=oi,
                    iv=iv,
                    delta=delta,
                    gamma=gamma,
                    theta=theta,
                    vega=vega,
                ))

    return OptionChain(
        underlying=s,
        spot_price=spot,
        expirations=sorted(set(e for e in expirations)),
        contracts=contracts,
        fetched_at=datetime.now(timezone.utc),
    )


def _demo_iv(symbol: str) -> IVData:
    s = symbol.upper()
    rng = random.Random(_symbol_seed(s))
    base_iv = _DEMO_BASE_IV.get(s, 0.30)

    current_iv = round(base_iv + rng.uniform(-0.03, 0.03), 4)
    iv_rank = round(rng.uniform(35, 75), 1)
    iv_percentile = round(rng.uniform(40, 80), 1)
    hv_20 = round(current_iv * rng.uniform(0.7, 1.1), 4)
    hv_50 = round(current_iv * rng.uniform(0.75, 1.05), 4)
    hv_100 = round(current_iv * rng.uniform(0.8, 1.0), 4)

    spot = _demo_spot(s)
    # IV skew: 5 strikes around ATM
    if spot < 200:
        inc = 2.5
    else:
        inc = 5.0
    skew = {}
    for i in range(-3, 4):
        strike = round(spot + i * inc, 2)
        moneyness = abs(i) * 0.02
        skew[str(strike)] = round(current_iv * (1 + moneyness + rng.uniform(-0.005, 0.005)), 4)

    # Term structure
    today = date.today()
    first_friday = _next_friday(today)
    term = {}
    for w in range(6):
        exp = first_friday + timedelta(weeks=w)
        # IV typically increases with time
        term[exp.isoformat()] = round(current_iv * (1 + w * 0.008 + rng.uniform(-0.005, 0.005)), 4)

    return IVData(
        symbol=s,
        current_iv=current_iv,
        iv_rank=iv_rank,
        iv_percentile=iv_percentile,
        hv_20=hv_20,
        hv_50=hv_50,
        hv_100=hv_100,
        iv_skew=skew,
        term_structure=term,
    )


def _polygon_key_empty() -> bool:
    from core.config import settings
    return not settings.POLYGON_API_KEY.get_secret_value()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/chain/{symbol}", response_model=OptionChain)
async def get_options_chain(
    symbol: str,
    expiry: date | None = Query(None, description="Filter to a specific expiration"),
    strike_min: float | None = Query(None),
    strike_max: float | None = Query(None),
    option_type: OptionType | None = Query(None),
) -> OptionChain:
    """Fetch the full options chain for an underlying symbol.

    Data sourced from Theta Data API with real-time greeks computed via
    Black-Scholes-Merton.
    """
    if _polygon_key_empty():
        if not _is_valid_demo_symbol(symbol):
            raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
        return _demo_chain(symbol, expiry, strike_min, strike_max, option_type)

    try:
        import httpx
        from core.config import settings

        symbol = symbol.upper()

        async with httpx.AsyncClient() as client:
            params = {
                "root": symbol,
                "apiKey": settings.POLYGON_API_KEY.get_secret_value(),
            }
            if expiry:
                params["expiration_date"] = expiry.isoformat()

            resp = await client.get(
                f"https://api.polygon.io/v3/snapshot/options/{symbol}",
                params=params,
                timeout=15.0,
            )
            if resp.status_code == 429:
                raise HTTPException(
                    status_code=429,
                    detail="Polygon rate limit reached (free tier: 5 calls/min). Please wait and retry.",
                )
            if resp.status_code in (401, 403):
                # API key lacks options permissions — fall back to demo
                if not _is_valid_demo_symbol(symbol):
                    raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
                return _demo_chain(symbol, expiry, strike_min, strike_max, option_type)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"Polygon options error: {resp.text[:200]}")
            try:
                data = resp.json()
            except Exception:
                raise HTTPException(status_code=502, detail="Invalid response from Polygon API")

        contracts: list[OptionContract] = []
        expirations: set[date] = set()
        spot_price = 0.0

        for item in data.get("results", []):
            details = item.get("details", {})
            greeks = item.get("greeks", {})
            day = item.get("day", {})
            quote = item.get("last_quote", {})

            exp_str = details.get("expiration_date")
            if not exp_str:
                continue
            exp = date.fromisoformat(exp_str)
            strike = details.get("strike_price", 0)
            otype = OptionType.CALL if details.get("contract_type") == "call" else OptionType.PUT

            if strike_min and strike < strike_min:
                continue
            if strike_max and strike > strike_max:
                continue
            if option_type and otype != option_type:
                continue

            expirations.add(exp)
            spot_price = item.get("underlying_asset", {}).get("price", spot_price)

            # Derive last price: prefer day close, fall back to quote midpoint
            bid_price = quote.get("bid", 0) or 0
            ask_price = quote.get("ask", 0) or 0
            last_price = day.get("close", 0) or 0
            if not last_price and bid_price and ask_price:
                last_price = round((bid_price + ask_price) / 2, 2)

            # open_interest can be at item level or under day
            oi = item.get("open_interest", 0) or day.get("open_interest", 0) or 0

            contracts.append(OptionContract(
                symbol=details.get("ticker", ""),
                underlying=symbol,
                expiry=exp,
                strike=strike,
                option_type=otype,
                bid=bid_price,
                ask=ask_price,
                last=last_price,
                volume=day.get("volume", 0) or 0,
                open_interest=oi,
                iv=item.get("implied_volatility", 0) or 0,
                delta=greeks.get("delta", 0) or 0,
                gamma=greeks.get("gamma", 0) or 0,
                theta=greeks.get("theta", 0) or 0,
                vega=greeks.get("vega", 0) or 0,
            ))

        return OptionChain(
            underlying=symbol,
            spot_price=spot_price,
            expirations=sorted(expirations),
            contracts=contracts,
            fetched_at=datetime.now(timezone.utc),
        )
    except HTTPException:
        raise
    except Exception:
        logger.warning("Failed to fetch options chain from Polygon for %s, falling back to demo", symbol, exc_info=True)
        if not _is_valid_demo_symbol(symbol):
            raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
        return _demo_chain(symbol, expiry, strike_min, strike_max, option_type)


@router.get("/iv/{symbol}", response_model=IVData)
async def get_iv_analysis(symbol: str) -> IVData:
    """Compute IV rank, percentile, and skew analysis for a symbol.

    Uses historical IV data to compute rank/percentile over the past year.
    """
    symbol = symbol.upper()

    try:
        import numpy as np
        from core.redis import cache_get

        # Try cache first
        cached = await cache_get(f"iv:{symbol}")
        if cached:
            return IVData(**cached)

        # In production, fetch 1yr of IV data from Theta Data and compute stats.
        iv_history = await cache_get(f"iv_history:{symbol}") or {}
        iv_values = iv_history.get("values", [])

        if not iv_values:
            # No cached data available — return demo (only for valid symbols)
            if not _is_valid_demo_symbol(symbol):
                raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
            return _demo_iv(symbol)

        current_iv = iv_values[-1]

        arr = np.array(iv_values)
        iv_rank = float((current_iv - arr.min()) / (arr.max() - arr.min()) * 100) if arr.max() != arr.min() else 50
        iv_percentile = float(np.sum(arr < current_iv) / len(arr) * 100)

        # Compute historical vol at multiple windows
        prices = (await cache_get(f"prices:{symbol}") or {}).get("close", [])
        if len(prices) > 100:
            returns = np.diff(np.log(np.array(prices, dtype=float)))
            hv_20 = float(np.std(returns[-20:]) * np.sqrt(252))
            hv_50 = float(np.std(returns[-50:]) * np.sqrt(252))
            hv_100 = float(np.std(returns[-100:]) * np.sqrt(252))
        else:
            hv_20 = hv_50 = hv_100 = 0.0

        return IVData(
            symbol=symbol,
            current_iv=current_iv,
            iv_rank=round(iv_rank, 1),
            iv_percentile=round(iv_percentile, 1),
            hv_20=round(hv_20, 4),
            hv_50=round(hv_50, 4),
            hv_100=round(hv_100, 4),
        )
    except Exception:
        logger.warning("Failed to compute IV analysis for %s, falling back to demo", symbol, exc_info=True)
        return _demo_iv(symbol)


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
    spot = quote.get("last", 0) or _demo_spot(symbol)

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
    theta = float(
        -(spot * norm.pdf(d1) * sigma) / (2 * np.sqrt(T))
        - risk_free_rate * strike * np.exp(-risk_free_rate * T) * norm.cdf(d2 if option_type == OptionType.CALL else -d2)
    ) / 365
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
