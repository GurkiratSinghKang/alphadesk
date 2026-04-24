from __future__ import annotations

import hashlib
import logging
import math
import random
import re
import time
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from api.routes.market import _is_valid_demo_symbol
from core.config import settings

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
    "AAPL": 265.0, "NVDA": 197.0, "TSLA": 390.0, "MSFT": 418.0,
    "AMZN": 249.0, "META": 672.0, "GOOGL": 339.0, "SPY": 700.0,
    "AMD": 155.0, "NFLX": 1050.0, "CRM": 310.0, "INTC": 25.0,
    "QQQ": 639.0,
}

# B-47/B-48: in-process caches are TTL+LRU bounded rather than plain dicts.
# Plain dicts accumulate stale keys forever (values expire per-TTL-on-read
# but keys are never removed); a long-running process screens thousands of
# symbols and leaks ~100 B/entry, O(session length) memory growth. Wrap
# every write through ``_ttl_lru_set`` which evicts expired entries AND
# enforces a max-size cap (LRU).
from collections import OrderedDict as _OrderedDict

_CACHE_MAX_ENTRIES = 500  # per cache; bounds total memory at ~50 KB per cache

def _ttl_lru_set(
    cache: "_OrderedDict[str, tuple[object, float]]",
    key: str,
    value: object,
    now: float,
    ttl: float,
    maxsize: int = _CACHE_MAX_ENTRIES,
) -> None:
    """TTL+LRU set: evict expired entries, then cap at ``maxsize``."""
    # Purge expired entries from the head (OrderedDict is insertion-ordered).
    while cache:
        oldest_k = next(iter(cache))
        _, ts = cache[oldest_k]
        if now - ts > ttl:
            cache.pop(oldest_k)
        else:
            break
    # Re-insert this key at the tail (so it becomes the newest).
    if key in cache:
        cache.move_to_end(key)
    cache[key] = (value, now)
    # Enforce max-size by evicting from head (LRU).
    while len(cache) > maxsize:
        cache.popitem(last=False)


# Cache for real spot prices fetched from Alpaca.
_real_spot_cache: "_OrderedDict[str, tuple[float, float]]" = _OrderedDict()
_SPOT_CACHE_TTL = 60  # seconds

_DEMO_BASE_IV: dict[str, float] = {
    "TSLA": 0.55, "NVDA": 0.48, "AMD": 0.45, "META": 0.38,
    "NFLX": 0.40, "COIN": 0.65, "AAPL": 0.25, "MSFT": 0.22,
    "AMZN": 0.30, "GOOGL": 0.26, "SPY": 0.15,
}


def _symbol_seed(symbol: str) -> int:
    return int(hashlib.md5(symbol.upper().encode()).hexdigest()[:8], 16)


async def _demo_spot(symbol: str) -> float:
    """Get spot price -- tries real Alpaca price first, falls back to demo.

    Async: uses httpx.AsyncClient so callers in async routes don't block the
    event loop on a slow Alpaca response.
    """
    s = symbol.upper()

    # Check cache first
    now = time.time()
    cached = _real_spot_cache.get(s)
    if cached and (now - cached[1]) < _SPOT_CACHE_TTL:
        return cached[0]

    # Try to fetch real price from Alpaca (non-blocking)
    try:
        headers = _alpaca_headers()
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"https://data.alpaca.markets/v2/stocks/{s}/trades/latest",
                headers=headers,
            )
        if resp.status_code == 200:
            price = resp.json().get("trade", {}).get("p", 0)
            if price > 0:
                _ttl_lru_set(_real_spot_cache, s, price, now, _SPOT_CACHE_TTL)
                return price
    except httpx.TimeoutException:
        logger.warning("Alpaca spot-price request timed out for %s", s)
    except Exception:
        logger.debug("Alpaca spot-price fetch failed for %s", s, exc_info=True)

    # Fallback to demo prices
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


async def _demo_chain(symbol: str, expiry_filter: date | None,
                strike_min: float | None, strike_max: float | None,
                option_type_filter: OptionType | None) -> OptionChain:
    s = symbol.upper()
    rng = random.Random(_symbol_seed(s))
    spot = await _demo_spot(s)
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


async def _demo_iv(symbol: str) -> IVData:
    s = symbol.upper()
    rng = random.Random(_symbol_seed(s))
    base_iv = _DEMO_BASE_IV.get(s, 0.30)

    current_iv = round(base_iv + rng.uniform(-0.03, 0.03), 4)
    iv_rank = round(rng.uniform(35, 75), 1)
    iv_percentile = round(rng.uniform(40, 80), 1)
    hv_20 = round(current_iv * rng.uniform(0.7, 1.1), 4)
    hv_50 = round(current_iv * rng.uniform(0.75, 1.05), 4)
    hv_100 = round(current_iv * rng.uniform(0.8, 1.0), 4)

    spot = await _demo_spot(s)
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
    return not settings.POLYGON_API_KEY.get_secret_value()


# ---------------------------------------------------------------------------
# Alpaca OPRA options helpers
# ---------------------------------------------------------------------------

_ALPACA_OPTIONS_BASE = "https://data.alpaca.markets/v1beta1/options"

# Cache: symbol -> (OptionChain, timestamp). B-48: bounded via _ttl_lru_set.
_chain_cache: "_OrderedDict[str, tuple[OptionChain, float]]" = _OrderedDict()
_CHAIN_CACHE_TTL = 30  # seconds

# Cache: symbol -> (IVData, timestamp). B-48: bounded via _ttl_lru_set.
_iv_cache: "_OrderedDict[str, tuple[IVData, float]]" = _OrderedDict()
_IV_CACHE_TTL = 30


def _alpaca_keys_empty() -> bool:
    return (
        not settings.ALPACA_API_KEY.get_secret_value()
        or not settings.ALPACA_SECRET_KEY.get_secret_value()
    )


def _alpaca_headers() -> dict[str, str]:
    return {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }


# Regex for Alpaca-style OCC option symbols, e.g. AAPL250418C00250000
_OCC_RE = re.compile(
    r"^(?P<underlying>[A-Z]{1,6})"
    r"(?P<yy>\d{2})(?P<mm>\d{2})(?P<dd>\d{2})"
    r"(?P<cp>[CP])"
    r"(?P<strike>\d{8})$"
)


def _parse_alpaca_option_symbol(sym: str) -> dict | None:
    """Parse an OCC option symbol into components.

    Example: AAPL250418C00250000
      -> underlying=AAPL, expiry=2025-04-18, type=call, strike=250.0
    """
    m = _OCC_RE.match(sym)
    if not m:
        return None
    return {
        "underlying": m.group("underlying"),
        "expiry": date(2000 + int(m.group("yy")), int(m.group("mm")), int(m.group("dd"))),
        "option_type": OptionType.CALL if m.group("cp") == "C" else OptionType.PUT,
        "strike": int(m.group("strike")) / 1000.0,
    }


def _chain_cache_key(
    symbol: str,
    expiry: date | None,
    strike_min: float | None,
    strike_max: float | None,
    option_type: OptionType | None,
) -> str:
    parts = [symbol.upper()]
    if expiry:
        parts.append(expiry.isoformat())
    if strike_min is not None:
        parts.append(f"smin{strike_min}")
    if strike_max is not None:
        parts.append(f"smax{strike_max}")
    if option_type is not None:
        parts.append(option_type.value)
    return "|".join(parts)


async def _fetch_real_chain(
    symbol: str,
    expiry_filter: date | None,
    strike_min: float | None,
    strike_max: float | None,
    option_type_filter: OptionType | None,
) -> OptionChain | None:
    """Fetch a real options chain from the Alpaca OPRA API.

    Returns None on any failure so the caller can fall back to demo data.
    """
    if _alpaca_keys_empty():
        return None

    s = symbol.upper()

    # Check cache
    ckey = _chain_cache_key(s, expiry_filter, strike_min, strike_max, option_type_filter)
    cached = _chain_cache.get(ckey)
    if cached:
        chain, ts = cached
        if time.time() - ts < _CHAIN_CACHE_TTL:
            return chain

    try:
        headers = _alpaca_headers()
        params: dict[str, str] = {"feed": "opra"}
        if expiry_filter:
            params["expiration_date"] = expiry_filter.isoformat()
        if strike_min is not None:
            params["strike_price_gte"] = str(strike_min)
        if strike_max is not None:
            params["strike_price_lte"] = str(strike_max)
        if option_type_filter:
            params["type"] = option_type_filter.value

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{_ALPACA_OPTIONS_BASE}/snapshots/{s}",
                headers=headers,
                params=params,
            )

        if resp.status_code in (401, 403):
            logger.warning("Alpaca options auth failed (%s) for %s — falling back", resp.status_code, s)
            return None
        if resp.status_code == 429:
            logger.warning("Alpaca options rate-limited for %s", s)
            return None
        if resp.status_code != 200:
            logger.warning("Alpaca options HTTP %s for %s: %s", resp.status_code, s, resp.text[:200])
            return None

        data = resp.json()
        if not data or not isinstance(data, dict):
            logger.warning("Alpaca options returned empty/unexpected payload for %s", s)
            return None

        # Also fetch current spot price
        spot_price = await _demo_spot(s)  # async fallback
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                spot_resp = await client.get(
                    f"https://data.alpaca.markets/v2/stocks/{s}/trades/latest",
                    headers=headers,
                )
            if spot_resp.status_code == 200:
                trade_price = spot_resp.json().get("trade", {}).get("p", 0)
                if trade_price > 0:
                    spot_price = trade_price
        except Exception:
            # Keep the demo spot as fallback; log at DEBUG so it's visible
            # when something is actually broken rather than silent.
            logger.debug("options: spot-price fetch failed", exc_info=True)

        contracts: list[OptionContract] = []
        expirations: set[date] = set()

        # The snapshots endpoint returns: { "AAPL250418C00250000": { ... }, ... }
        for occ_sym, snap in data.get("snapshots", data).items():
            parsed = _parse_alpaca_option_symbol(occ_sym)
            if not parsed:
                continue

            expiry_date = parsed["expiry"]
            strike = parsed["strike"]
            otype = parsed["option_type"]

            # Apply filters that the API might not have fully enforced
            if expiry_filter and expiry_date != expiry_filter:
                continue
            if strike_min is not None and strike < strike_min:
                continue
            if strike_max is not None and strike > strike_max:
                continue
            if option_type_filter and otype != option_type_filter:
                continue

            expirations.add(expiry_date)

            # Extract quote / trade / greeks from snapshot
            quote = snap.get("latestQuote", {})
            trade = snap.get("latestTrade", {})
            greeks_data = snap.get("greeks", {})

            bid_price = quote.get("bp", 0) or 0
            ask_price = quote.get("ap", 0) or 0
            last_price = trade.get("p", 0) or 0
            if not last_price and bid_price and ask_price:
                last_price = round((bid_price + ask_price) / 2, 2)

            volume = trade.get("s", 0) or snap.get("dailyBar", {}).get("v", 0) or 0
            oi = snap.get("openInterest", 0) or 0
            iv = snap.get("impliedVolatility", 0) or greeks_data.get("iv", 0) or 0

            contracts.append(OptionContract(
                symbol=occ_sym,
                underlying=parsed["underlying"],
                expiry=expiry_date,
                strike=strike,
                option_type=otype,
                bid=round(bid_price, 2),
                ask=round(ask_price, 2),
                last=round(last_price, 2),
                volume=int(volume),
                open_interest=int(oi),
                iv=round(iv, 4),
                delta=round(greeks_data.get("delta", 0) or 0, 4),
                gamma=round(greeks_data.get("gamma", 0) or 0, 6),
                theta=round(greeks_data.get("theta", 0) or 0, 4),
                vega=round(greeks_data.get("vega", 0) or 0, 4),
                rho=round(greeks_data.get("rho", 0) or 0, 4),
            ))

        if not contracts:
            # Symbol may not be optionable or no data returned
            logger.info("Alpaca returned 0 contracts for %s — falling back to demo", s)
            return None

        chain = OptionChain(
            underlying=s,
            spot_price=spot_price,
            expirations=sorted(expirations),
            contracts=contracts,
            fetched_at=datetime.now(timezone.utc),
        )
        _ttl_lru_set(_chain_cache, ckey, chain, time.time(), _CHAIN_CACHE_TTL)
        return chain

    except httpx.TimeoutException:
        logger.warning("Alpaca options request timed out for %s", s)
        return None
    except Exception:
        logger.warning("Alpaca options fetch failed for %s", s, exc_info=True)
        return None


async def _fetch_real_iv(symbol: str) -> IVData | None:
    """Derive IV analytics from the real Alpaca options chain.

    Fetches the chain (or uses the cached version), then computes IV rank
    proxies, skew, and term structure from the live greeks.
    Returns None on failure so the caller can fall back to demo data.
    """
    s = symbol.upper()

    # Check IV cache
    cached = _iv_cache.get(s)
    if cached:
        iv_data, ts = cached
        if time.time() - ts < _IV_CACHE_TTL:
            return iv_data

    # Fetch chain across all expirations — no filters
    chain = await _fetch_real_chain(s, None, None, None, None)
    if chain is None or not chain.contracts:
        return None

    try:
        spot = chain.spot_price

        # Collect IVs from all contracts
        all_ivs = [c.iv for c in chain.contracts if c.iv > 0]
        if not all_ivs:
            return None

        # ATM IV: contracts closest to spot
        atm_contracts = sorted(chain.contracts, key=lambda c: abs(c.strike - spot))
        atm_ivs = [c.iv for c in atm_contracts[:10] if c.iv > 0]
        current_iv = round(sum(atm_ivs) / len(atm_ivs), 4) if atm_ivs else round(sum(all_ivs) / len(all_ivs), 4)

        # IV rank / percentile approximation from current snapshot spread
        # (True rank needs history; we use the distribution of IVs in the chain)
        sorted_ivs = sorted(all_ivs)
        iv_min = sorted_ivs[0]
        iv_max = sorted_ivs[-1]
        iv_rank = round((current_iv - iv_min) / (iv_max - iv_min) * 100, 1) if iv_max != iv_min else 50.0
        iv_percentile = round(sum(1 for v in sorted_ivs if v < current_iv) / len(sorted_ivs) * 100, 1)

        # HV approximations (without real price history, use IV as proxy)
        hv_20 = round(current_iv * 0.85, 4)
        hv_50 = round(current_iv * 0.90, 4)
        hv_100 = round(current_iv * 0.92, 4)

        # IV skew: calls closest to nearest expiry, grouped by strike
        nearest_exp = chain.expirations[0] if chain.expirations else None
        skew: dict[str, float] = {}
        if nearest_exp:
            near_contracts = sorted(
                [c for c in chain.contracts if c.expiry == nearest_exp and c.option_type == OptionType.CALL and c.iv > 0],
                key=lambda c: abs(c.strike - spot),
            )
            for c in near_contracts[:7]:
                skew[str(c.strike)] = round(c.iv, 4)

        # Term structure: ATM IV by expiration
        term_structure: dict[str, float] = {}
        for exp in chain.expirations:
            exp_atm = [
                c for c in chain.contracts
                if c.expiry == exp and c.iv > 0 and abs(c.strike - spot) / spot < 0.05
            ]
            if exp_atm:
                avg_iv = sum(c.iv for c in exp_atm) / len(exp_atm)
                term_structure[exp.isoformat()] = round(avg_iv, 4)

        result = IVData(
            symbol=s,
            current_iv=current_iv,
            iv_rank=iv_rank,
            iv_percentile=iv_percentile,
            hv_20=hv_20,
            hv_50=hv_50,
            hv_100=hv_100,
            iv_skew=skew,
            term_structure=term_structure,
        )
        _ttl_lru_set(_iv_cache, s, result, time.time(), _IV_CACHE_TTL)
        return result
    except Exception:
        logger.warning("Failed to compute real IV data for %s", s, exc_info=True)
        return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/chain/{symbol}", response_model=OptionChain)
async def get_options_chain(
    symbol: str,
    # NOTE: Use Annotated[..., Query()] so the Python default stays a real
    # None. This route is also called directly as a helper from
    # `services.earnings_screener` (and others) — with the old
    # `= Query(None)` form, unspecified kwargs leak the raw Query() sentinel
    # into downstream code, producing
    # "'Query' object has no attribute 'value'" when we do
    # `option_type_filter.value` in `_fetch_real_chain`.
    expiry: Annotated[date | None, Query(description="Filter to a specific expiration")] = None,
    strike_min: Annotated[float | None, Query()] = None,
    strike_max: Annotated[float | None, Query()] = None,
    option_type: Annotated[OptionType | None, Query()] = None,
) -> OptionChain:
    """Fetch the full options chain for an underlying symbol.

    Tries Alpaca OPRA real-time data first (requires Algo Trader Plus plan),
    then falls back to BSM-approximated demo data.
    """
    symbol = symbol.upper()

    # ── 1. Try Alpaca OPRA (real data) ────────────────────────────────
    real_chain = await _fetch_real_chain(symbol, expiry, strike_min, strike_max, option_type)
    if real_chain is not None:
        return real_chain

    # ── 2. Fallback to demo data ──────────────────────────────────────
    if not _is_valid_demo_symbol(symbol):
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
    logger.info("Using demo options chain for %s (Alpaca OPRA unavailable)", symbol)
    return await _demo_chain(symbol, expiry, strike_min, strike_max, option_type)


@router.get("/iv/{symbol}", response_model=IVData)
async def get_iv_analysis(symbol: str) -> IVData:
    """Compute IV rank, percentile, and skew analysis for a symbol.

    Tries real Alpaca OPRA options data first, then falls back to demo.
    """
    symbol = symbol.upper()

    # ── 1. Try real IV from Alpaca OPRA chain ─────────────────────────
    real_iv = await _fetch_real_iv(symbol)
    if real_iv is not None:
        return real_iv

    # ── 2. Try Redis-cached IV history (legacy path) ──────────────────
    try:
        import numpy as np
        from core.redis import cache_get

        cached = await cache_get(f"iv:{symbol}")
        if cached:
            return IVData(**cached)

        iv_history = await cache_get(f"iv_history:{symbol}") or {}
        iv_values = iv_history.get("values", [])

        if not iv_values:
            if not _is_valid_demo_symbol(symbol):
                raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
            return await _demo_iv(symbol)

        current_iv = iv_values[-1]

        arr = np.array(iv_values)
        iv_rank = float((current_iv - arr.min()) / (arr.max() - arr.min()) * 100) if arr.max() != arr.min() else 50
        iv_percentile = float(np.sum(arr < current_iv) / len(arr) * 100)

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
        return await _demo_iv(symbol)


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
