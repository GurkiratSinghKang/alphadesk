"""Options-data service layer — Alpaca OPRA → legacy Redis IV → demo
waterfall for options chains and IV analytics. Pure data fetching: no
FastAPI-routing dependency, safe to import from any other service.

Extracted from ``api.routes.options`` (B-62) so the earnings screener and
other service-layer callers can pull chains / IV without a FastAPI
Request context. The Pydantic models (``OptionChain``, ``OptionContract``,
``IVData``, ``Greeks``, ``OptionType``), the provider waterfall helpers
(``_fetch_real_chain``, ``_fetch_real_iv``, ``_demo_chain``, ``_demo_iv``,
``_demo_spot``), and the TTL+LRU caches (``_chain_cache``, ``_iv_cache``,
``_real_spot_cache`` — B-47/B-48) all live here. The route module
``api.routes.options`` re-imports these names so the route shapes stay
stable.

Caching policy
--------------
The TTL+LRU caches live next to the helpers that own them — moving them
to a separate ``core.cache`` module would force every future consumer
(snapshot, greeks, live stream) to take a dep on a module whose only
reason to exist is holding three dictionaries. Keep cache locality with
the reader.
"""
from __future__ import annotations

import hashlib
import logging
import math
import random
import re
import time
from datetime import date, datetime, timedelta, timezone
from enum import Enum

import httpx
from pydantic import BaseModel, Field

from core.time import market_today

log = logging.getLogger(__name__)


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
    # Round-4 CLUSTER 3 #12: silent demo fallback was a data-correctness
    # lie. The frontend now gets a flag so it can label demo chains.
    is_demo: bool = False


class IVData(BaseModel):
    symbol: str
    current_iv: float | None
    # Round-4 CLUSTER 3 #10/#11: IV rank, IV percentile, and HV figures
    # were synthetic (within-chain smile / multipliers of current IV).
    # All nullable so real-data responses can honestly say None when the
    # historical-vol pipeline isn't wired. Demo data still populates them
    # but the is_demo flag tells callers/UI to render accordingly.
    iv_rank: float | None = Field(default=None, description="IV rank 0-100")
    iv_percentile: float | None = Field(default=None, description="IV percentile 0-100")
    hv_20: float | None = None
    hv_50: float | None = None
    hv_100: float | None = None
    iv_skew: dict[str, float] = Field(default_factory=dict, description="Strike -> IV mapping for skew")
    term_structure: dict[str, float] = Field(default_factory=dict, description="Expiry -> IV mapping")
    # Round-4 CLUSTER 3 #10: synthetic IV data is flagged so the UI can
    # render a "demo" badge rather than passing it off as live.
    is_demo: bool = False
    # Round-4 contract: actual upstream-fetch wall-clock UTC. Defaults to
    # now() so existing callers that don't pass it stay valid; new code
    # paths populate it explicitly.
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


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
# Demo seed tables live in ``backend/data/symbol_lists.py`` (Batch V). The
# options service uses its own price/IV tables (kept separate from the
# market service tables because the existing values diverge — see the
# module docstring there for the consolidation plan).

from data.symbol_lists import (
    DEMO_BASE_PRICES_OPTIONS as _DEMO_BASE_PRICES,
)

# B-47/B-48: bounded TTL+LRU caches for the three options-data hot paths.
# OrderedDict + a single helper keeps memory predictable: under the worst case
# (many distinct symbols polled at once), the cache evicts the oldest entry
# instead of growing without bound.
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


# Cache for real spot prices fetched from Alpaca
_real_spot_cache: "_OrderedDict[str, tuple[float, float]]" = _OrderedDict()
_SPOT_CACHE_TTL = 60  # seconds

# See ``backend/data/symbol_lists.py`` for the canonical definition.
from data.symbol_lists import DEMO_BASE_IV as _DEMO_BASE_IV  # noqa: E402


def _symbol_seed(symbol: str) -> int:
    return int(hashlib.md5(symbol.upper().encode()).hexdigest()[:8], 16)


async def _fetch_alpaca_spot(symbol: str) -> float | None:
    """Return the latest real Alpaca trade price, or None when unavailable."""
    s = symbol.upper()

    # Check cache first
    now = time.time()
    cached = _real_spot_cache.get(s)
    if cached and (now - cached[1]) < _SPOT_CACHE_TTL:
        return cached[0]

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
        log.warning("Alpaca spot-price request timed out for %s", s)
    except Exception:
        log.debug("Alpaca spot-price fetch failed for %s", s, exc_info=True)
    return None


async def _demo_spot(symbol: str) -> float:
    """Get spot price -- tries real Alpaca price first, falls back to demo.

    Async: uses httpx.AsyncClient so callers in async routes don't block the
    event loop on a slow Alpaca response.
    """
    s = symbol.upper()

    real_spot = await _fetch_alpaca_spot(s)
    if real_spot is not None:
        return real_spot

    # Round-11 / BB-11 (P0): the demo fallback used to log at DEBUG
    # only. Downstream callers (chain valuation, Greek sizing) received
    # the synthetic price as truth and could fund-size against a wholly
    # fictional spot. Now WARNs + increments a counter so an alerting
    # probe can detect a provider outage burst, mirrors the BB-12 fix
    # for ``services/market.py``.
    log.warning(
        "DEMO FALLBACK: serving synthetic spot price for %s — Alpaca latest-trade unavailable",
        s,
        extra={"event": "provider_outage", "provider": "alpaca", "symbol": s, "surface": "options_spot"},
    )
    try:
        # Fire-and-forget atomic counter; best-effort.
        import asyncio as _asyncio
        from core.redis import cache_incr

        async def _bump() -> None:
            await cache_incr("metrics:provider_outage:options_spot_demo_total")
        try:
            _asyncio.get_running_loop().create_task(_bump())
        except RuntimeError:
            pass  # not in an async context — skip
    except Exception:
        pass
    if s in _DEMO_BASE_PRICES:
        return _DEMO_BASE_PRICES[s]
    rng = random.Random(_symbol_seed(s))
    return round(rng.uniform(20, 500), 2)


def _next_friday(from_date: date | None = None) -> date:
    """Return the next Friday on or after ``from_date``.

    Round-4 CLUSTER 1: ``from_date`` defaults to NY market today so the
    helper picks the right Friday even when invoked from a UTC-clocked
    server late on a US Friday evening (UTC has crossed midnight, but
    the NY market still considers today Friday — and the next chain
    expiry is today, not next week).
    """
    if from_date is None:
        from_date = market_today()
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
    today = market_today()
    first_friday = _next_friday(today)
    expirations = [first_friday + timedelta(weeks=i) for i in range(6)]

    if expiry_filter:
        expirations = [e for e in expirations if e == expiry_filter]
        if not expirations:
            expirations = [expiry_filter]

    # Determine strike increment based on price
    # CBOE-standard strike spacing: <$50: $1, $50-$200: $2.50, >=$200: $5. Matches real-market structure.
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
            # Demo-only IV smile slope; 1.5x per moneyness unit ~ realistic put-skew shape.
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
        # Round-4 CLUSTER 3 #12: silent demo fallback was a data-correctness
        # lie. Tag synthetic chains so the UI can label them.
        is_demo=True,
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
    today = market_today()
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
        # Round-4 CLUSTER 3 #10/#11: synthetic IV is flagged so the UI
        # surfaces a "demo" badge instead of presenting the value as live.
        is_demo=True,
        fetched_at=datetime.now(timezone.utc),
    )


def _polygon_key_empty() -> bool:
    from core.config import settings
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
    from core.config import settings
    return (
        not settings.ALPACA_API_KEY.get_secret_value()
        or not settings.ALPACA_SECRET_KEY.get_secret_value()
    )


def _alpaca_headers() -> dict[str, str]:
    from core.config import settings
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
    limit: int | None = None,
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
    if limit is not None:
        parts.append(f"lim{limit}")
    return "|".join(parts)


# Batch T T-2: explicit cap on chain payload size. The Alpaca OPRA
# snapshots endpoint defaults to 100 contracts per page, which produced
# silent truncation in the old fetcher. We now request `_ALPACA_PAGE_SIZE`
# contracts per page and walk Alpaca's ``next_page_token`` until we've
# collected `chain_limit` rows. The hard ceiling protects worker memory
# and serialisation time on liquid tickers (SPY has thousands of strikes
# across LEAPS).
_ALPACA_PAGE_SIZE = 200
_DEFAULT_CHAIN_LIMIT = 200
_MAX_CHAIN_LIMIT = 500


async def _fetch_real_chain(
    symbol: str,
    expiry_filter: date | None,
    strike_min: float | None,
    strike_max: float | None,
    option_type_filter: OptionType | None,
    chain_limit: int = _DEFAULT_CHAIN_LIMIT,
) -> OptionChain | None:
    """Fetch a real options chain from the Alpaca OPRA API.

    Returns None on any failure so the caller can fall back to demo data.

    Batch T T-2: explicit ``chain_limit`` (default 200, ceiling 500) lifts
    the silent 100-row cap. We page through Alpaca's snapshot endpoint via
    ``next_page_token`` until either the limit or the upstream end-of-data
    is reached.
    """
    if _alpaca_keys_empty():
        return None

    s = symbol.upper()
    chain_limit = max(1, min(int(chain_limit), _MAX_CHAIN_LIMIT))

    # Check cache (limit is part of the key so the 200-cap chain isn't
    # served from a 50-cap cache entry).
    ckey = _chain_cache_key(s, expiry_filter, strike_min, strike_max, option_type_filter, chain_limit)
    cached = _chain_cache.get(ckey)
    if cached:
        chain, ts = cached
        if time.time() - ts < _CHAIN_CACHE_TTL:
            return chain

    try:
        spot_price = await _fetch_alpaca_spot(s)
        if spot_price is None:
            log.warning("Alpaca options spot unavailable for %s — falling back", s)
            return None

        headers = _alpaca_headers()
        base_params: dict[str, str] = {
            "feed": "opra",
            "limit": str(min(_ALPACA_PAGE_SIZE, chain_limit)),
        }
        if expiry_filter:
            base_params["expiration_date"] = expiry_filter.isoformat()
        if strike_min is not None:
            base_params["strike_price_gte"] = str(strike_min)
        if strike_max is not None:
            base_params["strike_price_lte"] = str(strike_max)
        if option_type_filter:
            base_params["type"] = option_type_filter.value

        contracts: list[OptionContract] = []
        expirations: set[date] = set()
        page_token: str | None = None
        # Hard pagination cap — also defensive against an Alpaca contract
        # change that returns infinite tokens.
        max_pages = max(1, (chain_limit + _ALPACA_PAGE_SIZE - 1) // _ALPACA_PAGE_SIZE) + 2

        async with httpx.AsyncClient(timeout=15) as client:
            for _page in range(max_pages):
                params = dict(base_params)
                if page_token:
                    params["page_token"] = page_token

                resp = await client.get(
                    f"{_ALPACA_OPTIONS_BASE}/snapshots/{s}",
                    headers=headers,
                    params=params,
                )

                if resp.status_code in (401, 403):
                    log.warning("Alpaca options auth failed (%s) for %s — falling back", resp.status_code, s)
                    return None
                if resp.status_code == 429:
                    log.warning("Alpaca options rate-limited for %s", s)
                    return None
                if resp.status_code != 200:
                    log.warning("Alpaca options HTTP %s for %s: %s", resp.status_code, s, resp.text[:200])
                    return None

                data = resp.json()
                if not data or not isinstance(data, dict):
                    log.warning("Alpaca options returned empty/unexpected payload for %s", s)
                    return None

                snapshots = data.get("snapshots") or {}
                if not isinstance(snapshots, dict):
                    snapshots = {}

                # The snapshots endpoint returns: { "AAPL250418C00250000": { ... }, ... }
                for occ_sym, snap in snapshots.items():
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

                    # Extract quote / trade / day-bar / greeks from snapshot.
                    quote = snap.get("latestQuote", {}) or {}
                    trade = snap.get("latestTrade", {}) or {}
                    greeks_data = snap.get("greeks", {}) or {}
                    # Batch T T-4: Alpaca's snapshot carries ``dailyBar`` /
                    # ``minuteBar`` / ``prevDailyBar``. ``dailyBar.v`` is the
                    # cumulative session volume; ``prevDailyBar.v`` is the
                    # previous session's total. The old code read
                    # ``trade.s`` (latest-tick size = often 1) which is why
                    # callers saw ``volume=1`` universally.
                    daily_bar = snap.get("dailyBar", {}) or {}
                    prev_daily_bar = snap.get("prevDailyBar", {}) or {}

                    bid_price = quote.get("bp", 0) or 0
                    ask_price = quote.get("ap", 0) or 0
                    # Round-4 CLUSTER 5 #20: drop contracts with no real two-sided
                    # market. A zero-bid AND zero-ask contract is either an
                    # illiquid OTM strike that nobody quotes or a stale snapshot —
                    # rendering it in the strike ladder produces fake "yield" rows
                    # that aren't tradeable and pollute mid-price computations.
                    if bid_price == 0 and ask_price == 0:
                        continue
                    last_price = trade.get("p", 0) or 0
                    if not last_price and bid_price and ask_price:
                        last_price = round((bid_price + ask_price) / 2, 2)

                    # Volume: prefer cumulative session bar, fall back to
                    # prior-session bar (when the chain is requested before
                    # market open), then to latest-tick size as a last resort.
                    volume = (
                        daily_bar.get("v", 0)
                        or prev_daily_bar.get("v", 0)
                        or trade.get("s", 0)
                        or 0
                    )
                    # Open interest: snapshot's top-level ``openInterest``
                    # is the previous session's settlement OI (Alpaca only
                    # publishes EOD OI). Some payloads nest it under
                    # ``open_interest`` (rare) — accept either spelling.
                    oi = (
                        snap.get("openInterest", 0)
                        or snap.get("open_interest", 0)
                        or 0
                    )
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
                    expirations.add(expiry_date)

                # Stop conditions: limit reached or no more pages.
                if len(contracts) >= chain_limit:
                    contracts = contracts[:chain_limit]
                    break
                page_token = data.get("next_page_token")
                if not page_token:
                    break

        if not contracts:
            # Symbol may not be optionable or no data returned
            log.info("Alpaca returned 0 contracts for %s — falling back to demo", s)
            return None

        # Batch T T-3: pre-compute greeks for any contract whose IV is
        # known but whose greeks came back as zero (the upstream snapshot
        # frequently returns empty greeks dicts). Saves callers the N+1
        # /greeks/... round-trip.
        _fill_missing_greeks(contracts, spot_price)

        chain = OptionChain(
            underlying=s,
            spot_price=spot_price,
            expirations=sorted(expirations),
            contracts=contracts,
            fetched_at=datetime.now(timezone.utc),
            # Round-4 CLUSTER 3 #12: explicit so callers can rely on this
            # being a real-data chain.
            is_demo=False,
        )
        _ttl_lru_set(_chain_cache, ckey, chain, time.time(), _CHAIN_CACHE_TTL)
        return chain

    except httpx.TimeoutException:
        log.warning("Alpaca options request timed out for %s", s)
        return None
    except Exception:
        log.warning("Alpaca options fetch failed for %s", s, exc_info=True)
        return None


def _fill_missing_greeks(
    contracts: list[OptionContract],
    spot: float,
    risk_free_rate: float = 0.05,
    today: date | None = None,
) -> None:
    """Batch T T-3: populate zero-valued greeks in-place using BSM.

    Greeks are computed only when ``iv > 0`` and ``delta == gamma == theta
    == vega == rho == 0`` (the canonical "missing greeks" signature on the
    Alpaca snapshot). Contracts that already carry real greeks are left
    untouched. Failures on a single contract are logged but never abort
    the batch — partial enrichment is better than dropping the whole chain.

    Performance: ~200 contracts compute in single-digit ms (scipy.norm
    overhead dominates). Runs synchronously inside the async fetcher with
    no measurable wait.
    """
    if not contracts or spot <= 0:
        return
    today = today or date.today()
    try:
        from indicators.options import bs_greeks
    except Exception:
        log.debug("indicators.options unavailable — skipping greeks fill", exc_info=True)
        return

    for c in contracts:
        # Only fill when IV is real AND every greek is zero (the canonical
        # "Alpaca didn't compute greeks for this contract" signature).
        if c.iv <= 0:
            continue
        if c.delta or c.gamma or c.theta or c.vega or c.rho:
            continue
        try:
            days = (c.expiry - today).days
            tau = max(days / 365.0, 1.0 / 365.0)
            g = bs_greeks(
                spot=spot,
                strike=c.strike,
                tau=tau,
                r=risk_free_rate,
                q=0.0,
                sigma=c.iv,
                call_put=c.option_type.value,
            )
            c.delta = round(float(g["delta"]), 4)
            c.gamma = round(float(g["gamma"]), 6)
            # bs_greeks returns theta per year — match the per-day
            # convention used by the standalone /greeks endpoint.
            c.theta = round(float(g["theta"]) / 365.0, 4)
            # vega per 1.0 vol; the /greeks endpoint reports per 1% (vega/100).
            c.vega = round(float(g["vega"]) / 100.0, 4)
            # rho per 1.0 rate; report per 1% to match /greeks endpoint.
            c.rho = round(float(g["rho"]) / 100.0, 4)
        except Exception:
            log.debug("greeks fill failed for %s", c.symbol, exc_info=True)
            continue


# ---------------------------------------------------------------------------
# IV history (Batch P / P-1)
# ---------------------------------------------------------------------------
#
# A real ``iv_rank`` / ``iv_percentile`` requires a per-symbol time series of
# ATM IV. The historical-vol pipeline used to be aspirational ("once we wire
# the time series the values will fill in"); Batch P actually wires it.
#
# Storage shape: a single Redis hash per symbol, keyed by ISO-8601 date,
# value = ATM IV (rounded to 4 dp). The hash can hold ~365 entries cheaply
# (each entry is a ~14 byte ASCII pair). Rolling 252-trading-day window is
# computed by sorting hash keys lexicographically and slicing the last 252.
#
# Why not Postgres / TimescaleDB? Adding a hypertable + alembic migration is
# heavier than the scope warrants and Redis already has the required shape
# (small, single-key history with cheap append). If the dataset grows beyond
# ~6 months the storage backend can be upgraded — none of the consumer-side
# code below assumes a Redis-specific API beyond ``cache_get`` / ``cache_set``.

_IV_HISTORY_KEY_PREFIX = "iv_history_daily"
_IV_HISTORY_RETENTION_DAYS = 365  # keep a buffer over the rolling 252 window
_IV_HISTORY_MIN_DAYS_FOR_RANK = 30  # below this, return None — too few obs


async def _persist_iv_history(symbol: str, atm_iv: float) -> None:
    """Append today's ATM IV to the per-symbol daily history.

    Idempotent w.r.t. the day: re-writing the same date overwrites the
    prior value, which is fine — the last value of the day before close
    is the most representative sample we'll have for the day.

    Best-effort: a Redis outage is logged at DEBUG and silently ignored.
    The IV-rank / percentile computation gracefully treats missing
    history as "warming up — return None".
    """
    if atm_iv is None or not (atm_iv > 0):
        return
    s = symbol.upper()
    try:
        from core.redis import cache_get, cache_set

        key = f"{_IV_HISTORY_KEY_PREFIX}:{s}"
        existing = await cache_get(key) or {}
        if not isinstance(existing, dict):
            existing = {}
        today_iso = market_today().isoformat()
        existing[today_iso] = round(float(atm_iv), 4)

        # Trim oldest entries beyond the retention window. Lexicographic
        # sort is correct for ISO-8601 date strings.
        if len(existing) > _IV_HISTORY_RETENTION_DAYS:
            keep_keys = sorted(existing.keys())[-_IV_HISTORY_RETENTION_DAYS:]
            existing = {k: existing[k] for k in keep_keys}

        # 7-day TTL so a multi-week outage doesn't leave a stale read
        # path forever — but normal usage refreshes it every weekday.
        await cache_set(key, existing, ttl_seconds=7 * 24 * 3600)
    except Exception:
        log.debug("IV history persist failed for %s", s, exc_info=True)


async def _read_iv_history_series(symbol: str) -> list[float]:
    """Return the daily ATM-IV series for ``symbol`` in chronological order.

    Returns at most the last 252 trading-day samples (we don't filter for
    market days — daily writes naturally skip weekends/holidays so the
    raw-date series is a 252-trading-day window after retention trimming).
    Returns ``[]`` on missing history or any read error.
    """
    s = symbol.upper()
    try:
        from core.redis import cache_get

        raw = await cache_get(f"{_IV_HISTORY_KEY_PREFIX}:{s}")
        if not isinstance(raw, dict) or not raw:
            return []
        # Lexicographic sort is chronological for ISO dates.
        ordered_keys = sorted(raw.keys())[-252:]
        return [float(raw[k]) for k in ordered_keys if raw.get(k) is not None]
    except Exception:
        log.debug("IV history read failed for %s", s, exc_info=True)
        return []


def _compute_iv_rank_percentile(
    current_iv: float, history: list[float]
) -> tuple[float | None, float | None]:
    """Return (iv_rank, iv_percentile) over ``history``.

    ``iv_rank``       = (current - min) / (max - min) * 100, clamped [0, 100]
    ``iv_percentile`` = fraction of historical samples with IV <= current * 100

    Returns (None, None) until the history reaches
    ``_IV_HISTORY_MIN_DAYS_FOR_RANK`` samples (warm-up window so an
    early reading doesn't masquerade as a 100% IV rank). The current
    sample itself is included in ``history`` (the caller persists
    before reading) — the calculation tolerates that.
    """
    if current_iv is None or not (current_iv > 0):
        return (None, None)
    if not history or len(history) < _IV_HISTORY_MIN_DAYS_FOR_RANK:
        return (None, None)

    lo = min(history)
    hi = max(history)
    if hi <= lo:
        # Flat series — degenerate. Report 50 (mid) for percentile, None
        # for rank since there's no spread to normalize against.
        return (None, 50.0)
    rank = (current_iv - lo) / (hi - lo) * 100.0
    rank = max(0.0, min(100.0, rank))
    pct = sum(1 for v in history if v <= current_iv) / len(history) * 100.0
    return (round(rank, 1), round(pct, 1))


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

    # Fetch chain across all expirations — no filters. Use the higher
    # ceiling (Batch T T-2) so the IV-rank computation sees the full
    # term-structure, not just the nearest expiry's worth of contracts.
    chain = await _fetch_real_chain(s, None, None, None, None, chain_limit=_MAX_CHAIN_LIMIT)
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

        # Phase-2 / EP-1 (2026 design brief): compute REAL HV from the
        # Alpaca daily-bar history we already fetch in services/market.
        # Pre-fix: hv_20/50/100 were hardcoded None and the FE rendered
        # "Historical volatility unavailable" on every detail card,
        # tripping the partial-data warning even when chain + Greeks
        # were fine. This wires HV inline using log-returns × sqrt(252).
        #
        # Batch P / P-1: IV rank + IV percentile are now wired off the
        # rolling daily-IV history persisted under
        # ``_IV_HISTORY_KEY_PREFIX``. Each call to ``_fetch_real_iv``
        # appends today's ATM IV; the rank/percentile pair is computed
        # over the last ≤252 daily samples once history exceeds the
        # warm-up threshold (``_IV_HISTORY_MIN_DAYS_FOR_RANK``).
        iv_rank: float | None = None
        iv_percentile: float | None = None
        hv_20: float | None = None
        hv_50: float | None = None
        hv_100: float | None = None
        try:
            import asyncio as _asyncio_local
            import numpy as np
            from datetime import date as _date_local, timedelta as _td_local
            from data.providers.alpaca import AlpacaBarProvider

            today = _date_local.today()
            start_d = today - _td_local(days=180)  # ~120 trading days

            def _fetch_bars_sync() -> "pd.DataFrame":  # noqa: F821
                with AlpacaBarProvider() as p:
                    return p.bars(symbols=[s], start=start_d, end=today, tf="1D")

            df = await _asyncio_local.to_thread(_fetch_bars_sync)
            closes = (
                [float(c) for c in df["close"].tolist() if c and c > 0]
                if not df.empty and "close" in df
                else []
            )
            if len(closes) >= 21:
                arr = np.array(closes, dtype=float)
                returns = np.diff(np.log(arr))
                if len(returns) >= 20:
                    hv_20 = round(float(np.std(returns[-20:]) * np.sqrt(252)), 4)
                if len(returns) >= 50:
                    hv_50 = round(float(np.std(returns[-50:]) * np.sqrt(252)), 4)
                if len(returns) >= 100:
                    hv_100 = round(float(np.std(returns[-100:]) * np.sqrt(252)), 4)
        except Exception:
            log.debug("HV/IV-rank inline computation failed for %s", s, exc_info=True)

        # Batch P / P-1: persist today's ATM IV and compute rank/percentile
        # over the rolling history. The persistence step is best-effort —
        # a Redis blip just keeps the rank null for one day.
        try:
            await _persist_iv_history(s, current_iv)
            history = await _read_iv_history_series(s)
            iv_rank, iv_percentile = _compute_iv_rank_percentile(current_iv, history)
        except Exception:
            log.debug("IV rank/percentile pipeline failed for %s", s, exc_info=True)

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
            # Round-4: real IV is honest — is_demo stays False but the
            # iv_rank/HV fields above are None until backed by real history.
            is_demo=False,
            fetched_at=datetime.now(timezone.utc),
        )
        _ttl_lru_set(_iv_cache, s, result, time.time(), _IV_CACHE_TTL)
        return result
    except Exception:
        log.warning("Failed to compute real IV data for %s", s, exc_info=True)
        return None


# ---------------------------------------------------------------------------
# Data-fetching entry points (formerly in api.routes.options)
# ---------------------------------------------------------------------------


async def fetch_chain(
    symbol: str,
    expiry: date | None = None,
    strike_min: float | None = None,
    strike_max: float | None = None,
    option_type: OptionType | None = None,
    client_host: str | None = None,
    chain_limit: int = _DEFAULT_CHAIN_LIMIT,
) -> OptionChain:
    """Fetch the full options chain for ``symbol`` via Alpaca OPRA → demo.

    Mirrors the body of the old ``api.routes.options.get_options_chain``.
    ``client_host`` is accepted for parity with the B-33 service contract
    but not consulted — the Alpaca OPRA endpoint is not client-IP aware.

    Batch T T-2: ``chain_limit`` (default ``_DEFAULT_CHAIN_LIMIT``=200,
    ceiling ``_MAX_CHAIN_LIMIT``=500) lifts the silent 100-row cap that
    confused downstream callers. The same limit applies to demo and real
    chains so the response shape is identical regardless of which
    provider answered.

    Batch T T-3: greeks are pre-computed for any contract whose IV is
    known but whose greeks came back as zero (covered inside
    ``_fetch_real_chain`` via ``_fill_missing_greeks``).

    Response shape (Batch T T-2 contract):
      * ``underlying``: input symbol (uppercased).
      * ``spot_price``: float, latest underlying price.
      * ``expirations``: ALL available expiries the provider knows about
        (sorted, ISO date list). Use this to iterate per-expiry.
      * ``contracts``: filtered list of contracts. When ``expiry`` is None
        the response is restricted to the nearest expiry only — the
        ``expirations`` field tells callers which others exist.
      * ``fetched_at``: UTC fetch time.
      * ``is_demo``: True iff the chain came from the demo fallback.

    Raises ``fastapi.HTTPException(404)`` when no provider has data and
    the symbol is not in the demo allowlist.
    """
    from fastapi import HTTPException
    from services.market import _is_valid_demo_symbol

    symbol = symbol.upper()

    # 1. Try Alpaca OPRA (real data).
    real_chain = await _fetch_real_chain(
        symbol, expiry, strike_min, strike_max, option_type, chain_limit=chain_limit,
    )
    if real_chain is not None:
        return _normalise_chain_shape(real_chain, expiry_filter=expiry)

    # 2. Fallback to demo data.
    if not _is_valid_demo_symbol(symbol):
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
    log.info("Using demo options chain for %s (Alpaca OPRA unavailable)", symbol)
    demo = await _demo_chain(symbol, expiry, strike_min, strike_max, option_type)
    # Trim demo to chain_limit for shape parity with real chains.
    if len(demo.contracts) > chain_limit:
        demo = OptionChain(
            underlying=demo.underlying,
            spot_price=demo.spot_price,
            expirations=demo.expirations,
            contracts=demo.contracts[:chain_limit],
            fetched_at=demo.fetched_at,
            is_demo=demo.is_demo,
        )
    return _normalise_chain_shape(demo, expiry_filter=expiry)


def _normalise_chain_shape(chain: OptionChain, expiry_filter: date | None) -> OptionChain:
    """Batch T T-2: enforce stable response shape across providers.

    Behaviour:
      * If ``expiry_filter`` is set, the contracts list is already pinned
        to that expiry. Pass through but ensure ``expirations`` reflects
        the requested filter rather than the full provider list (so
        callers iterating ``expirations`` don't try to fetch contracts we
        haven't returned).
      * If ``expiry_filter`` is None, restrict ``contracts`` to the
        NEAREST expiry while preserving ALL expiries in ``expirations``.
        This gives callers a deterministic top-of-chain view plus the
        full expiry ladder so they can fetch follow-up months without
        the silent default-expiry surprise.
    """
    if not chain.contracts:
        return chain
    if expiry_filter is not None:
        # Trust the filter — provider already pinned the expiry. Keep the
        # ``expirations`` field at the requested expiry to match the
        # narrowed view of contracts.
        return OptionChain(
            underlying=chain.underlying,
            spot_price=chain.spot_price,
            expirations=[expiry_filter],
            contracts=chain.contracts,
            fetched_at=chain.fetched_at,
            is_demo=chain.is_demo,
        )

    # No expiry filter — pin contracts to the nearest expiry and keep
    # the full expirations ladder so callers know what else is available.
    nearest = min((c.expiry for c in chain.contracts), default=None)
    if nearest is None:
        return chain
    pinned = [c for c in chain.contracts if c.expiry == nearest]
    # Always include the nearest expiry in the ladder, even if the
    # provider's expirations list was empty.
    expirations = sorted(set(chain.expirations) | {nearest})
    return OptionChain(
        underlying=chain.underlying,
        spot_price=chain.spot_price,
        expirations=expirations,
        contracts=pinned,
        fetched_at=chain.fetched_at,
        is_demo=chain.is_demo,
    )


async def fetch_iv_analysis(symbol: str, client_host: str | None = None) -> IVData:
    """Compute IV rank / percentile / skew for ``symbol``.

    Waterfall mirrors ``api.routes.options.get_iv_analysis``:
      1. Derive from real Alpaca OPRA chain (``_fetch_real_iv``).
      2. Fall back to Redis-cached IV history (legacy path).
      3. Fall back to demo data.
    """
    from fastapi import HTTPException
    from services.market import _is_valid_demo_symbol

    symbol = symbol.upper()

    # 1. Try real IV from Alpaca OPRA chain.
    real_iv = await _fetch_real_iv(symbol)
    if real_iv is not None:
        return real_iv

    # 2. Try Redis-cached IV history (legacy path).
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
            hv_20 = hv_50 = hv_100 = None

        return IVData(
            symbol=symbol,
            current_iv=current_iv,
            iv_rank=round(iv_rank, 1),
            iv_percentile=round(iv_percentile, 1),
            hv_20=round(hv_20, 4) if hv_20 is not None else None,
            hv_50=round(hv_50, 4) if hv_50 is not None else None,
            hv_100=round(hv_100, 4) if hv_100 is not None else None,
            is_demo=False,
            fetched_at=datetime.now(timezone.utc),
        )
    except HTTPException:
        # 404 from the demo allowlist branch must propagate.
        raise
    except Exception:
        log.warning("Failed to compute IV analysis for %s, falling back to demo", symbol, exc_info=True)
        return await _demo_iv(symbol)
