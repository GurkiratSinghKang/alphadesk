"""Market-data service layer — pure Polygon → Alpaca → demo waterfall for
quotes, bars, snapshots, and market status. HTTP concerns (rate-limit,
header lifting) live in ``api.routes.market``; this module is import-safe
from any other service and has no FastAPI-routing dependency.

Extracted from ``api.routes.market`` (B-62) so the earnings screener and
other service-layer callers can fetch market data without faking a
Request / Response to satisfy the route signature. Pydantic response
models, demo-data helpers, and provider-access helpers all live here;
the route module imports them back so the route shapes stay stable.
"""
from __future__ import annotations

import hashlib
import logging
import random
from datetime import date, datetime, timedelta, timezone
from enum import Enum

from pydantic import BaseModel, Field

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class Quote(BaseModel):
    symbol: str
    bid: float
    ask: float
    last: float
    volume: int
    timestamp: datetime
    change: float = 0.0
    changePct: float = 0.0
    high: float = 0.0
    low: float = 0.0
    open: float = 0.0
    close: float = 0.0
    is_demo: bool = False


class Bar(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int
    vwap: float | None = None
    is_demo: bool = False


class Snapshot(BaseModel):
    symbol: str
    quote: Quote
    day_bar: Bar
    prev_day_bar: Bar
    min_bar: Bar
    change_pct: float
    is_demo: bool = False


class MarketStatus(BaseModel):
    market: str
    server_time: datetime
    exchanges: dict[str, str] = Field(
        default_factory=dict,
        description="Exchange name -> status (open/closed/early_hours/late_hours)",
    )
    is_demo: bool = False


class Timeframe(str, Enum):
    MIN_1 = "1min"
    MIN_5 = "5min"
    MIN_15 = "15min"
    MIN_30 = "30min"
    HOUR_1 = "1h"
    HOUR_4 = "4h"
    DAY = "1d"
    WEEK = "1w"
    MONTH = "1mo"


# ---------------------------------------------------------------------------
# Demo data helpers
# ---------------------------------------------------------------------------

_DEMO_BASE_PRICES: dict[str, float] = {
    "AAPL": 230.0, "NVDA": 140.0, "TSLA": 275.0, "MSFT": 430.0,
    "AMZN": 195.0, "META": 530.0, "GOOGL": 175.0, "SPY": 590.0,
    "AMD": 165.0, "NFLX": 680.0, "CRM": 310.0, "INTC": 32.0,
    "DIS": 115.0, "BA": 195.0, "JPM": 220.0, "V": 295.0,
    "WMT": 175.0, "PG": 170.0, "KO": 62.0, "XOM": 115.0,
}

_DEMO_VOLATILITY: dict[str, float] = {
    "TSLA": 0.025, "NVDA": 0.020, "AMD": 0.020, "META": 0.018,
    "NFLX": 0.018,
}
_DEFAULT_VOLATILITY = 0.012

# ---------------------------------------------------------------------------
# Valid symbols for demo fallback — only generate fake data for known tickers.
# Includes S&P 500 / top US stocks plus major ETFs and indices.
# ---------------------------------------------------------------------------
_VALID_DEMO_SYMBOLS: set[str] = {
    # -- Mega-cap / top holdings --
    "AAPL", "ABBV", "ABT", "ACN", "ADBE", "ADI", "ADP", "ADSK", "AEP", "AIG",
    "AMAT", "AMD", "AMGN", "AMZN", "ANET", "ANSS", "AON", "APD", "APH", "AVGO",
    "AXP", "BA", "BAC", "BDX", "BKNG", "BLK", "BMY", "BRK.B", "BSX", "C",
    "CAT", "CB", "CDNS", "CEG", "CHTR", "CI", "CL", "CMCSA", "CME", "COF",
    "COP", "COST", "CRM", "CRWD", "CSCO", "CTAS", "CVS", "CVX", "D", "DASH",
    "DE", "DHR", "DIS", "DUK", "DXCM", "EA", "ECL", "EL", "EMR", "ENPH",
    "EOG", "EQR", "EW", "EXPE", "F", "FAST", "FDX", "FERG", "FI", "FICO",
    "FTNT", "GD", "GE", "GILD", "GM", "GOOG", "GOOGL", "GPN", "GS", "HCA",
    "HD", "HLT", "HON", "IBM", "ICE", "IDXX", "ILMN", "INTC", "INTU", "ISRG",
    "ITW", "JNJ", "JPM", "KDP", "KHC", "KLAC", "KO", "LIN", "LLY", "LMT",
    "LOW", "LRCX", "LULU", "MA", "MAR", "MCD", "MCHP", "MCO", "MDLZ", "MDT",
    "MET", "META", "MMC", "MMM", "MNST", "MO", "MPC", "MRVL", "MS", "MSCI",
    "MSFT", "MSI", "MU", "NEE", "NFLX", "NKE", "NOC", "NOW", "NSC", "NVDA",
    "NXPI", "ODFL", "ON", "ORCL", "ORLY", "OXY", "PANW", "PAYX", "PCAR",
    "PEP", "PFE", "PG", "PGR", "PH", "PLTR", "PM", "PNC", "PSA", "PSX",
    "PYPL", "QCOM", "REGN", "ROP", "ROST", "RTX", "SBUX", "SCHW", "SHW",
    "SLB", "SMCI", "SNPS", "SO", "SPGI", "SRE", "SYK", "SYY", "T", "TDG",
    "TGT", "TJX", "TMO", "TMUS", "TRV", "TSLA", "TT", "TXN", "UNH", "UNP",
    "UPS", "URI", "USB", "V", "VICI", "VLO", "VRSK", "VRTX", "VZ", "WBA",
    "WBD", "WDAY", "WEC", "WELL", "WFC", "WM", "WMT", "XEL", "XOM", "ZS",
    "ZTS",
    # -- Major ETFs / indices --
    "DIA", "EEM", "EFA", "GLD", "HYG", "IVV", "IWM", "LQD", "QQQ", "SLV",
    "SPY", "TLT", "VEA", "VNQ", "VOO", "VTI", "VWO", "XLB", "XLE", "XLF",
    "XLI", "XLK", "XLP", "XLU", "XLV", "XLY",
}


def _is_valid_demo_symbol(symbol: str) -> bool:
    """Return True if the symbol is in the known valid set for demo data."""
    return symbol.upper() in _VALID_DEMO_SYMBOLS


def _symbol_seed(symbol: str) -> int:
    return int(hashlib.md5(symbol.upper().encode()).hexdigest()[:8], 16)


def _demo_base_price(symbol: str) -> float:
    s = symbol.upper()
    if s in _DEMO_BASE_PRICES:
        return _DEMO_BASE_PRICES[s]
    # Generate a stable price for unknown symbols
    rng = random.Random(_symbol_seed(s))
    return round(rng.uniform(20, 500), 2)


def _demo_quote(symbol: str) -> Quote:
    s = symbol.upper()
    rng = random.Random(_symbol_seed(s))
    base = _demo_base_price(s)
    # Small deterministic jitter
    last = round(base * (1 + rng.uniform(-0.005, 0.005)), 2)
    spread = round(rng.uniform(0.01, 0.05), 2)
    bid = round(last - spread / 2, 2)
    ask = round(last + spread / 2, 2)
    volume = rng.randint(5_000_000, 50_000_000)
    # Compute realistic change data from base price
    prev_close = round(base * (1 + rng.uniform(-0.01, 0.005)), 2)
    change = round(last - prev_close, 2)
    change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
    day_open = round(prev_close * (1 + rng.uniform(-0.003, 0.003)), 2)
    day_high = round(max(last, day_open) * (1 + abs(rng.gauss(0, 0.005))), 2)
    day_low = round(min(last, day_open) * (1 - abs(rng.gauss(0, 0.005))), 2)
    return Quote(
        symbol=s, bid=bid, ask=ask, last=last,
        volume=volume, timestamp=datetime.now(timezone.utc),
        change=change, changePct=change_pct,
        high=day_high, low=day_low, open=day_open, close=prev_close,
        is_demo=True,
    )


def _demo_bars(symbol: str, timeframe: str, limit: int,
               start: date | None = None, end: date | None = None) -> list[Bar]:
    s = symbol.upper()
    rng = random.Random(_symbol_seed(s))
    base = _demo_base_price(s)
    vol = _DEMO_VOLATILITY.get(s, _DEFAULT_VOLATILITY)

    effective_end = end or date.today()
    effective_start = start or (effective_end - timedelta(days=365))

    # Determine time delta per bar
    tf_deltas = {
        "1min": timedelta(minutes=1), "5min": timedelta(minutes=5),
        "15min": timedelta(minutes=15), "30min": timedelta(minutes=30),
        "1h": timedelta(hours=1), "4h": timedelta(hours=4),
        "1d": timedelta(days=1), "1w": timedelta(weeks=1),
        "1mo": timedelta(days=30),
    }
    delta = tf_deltas.get(timeframe, timedelta(days=1))

    bars: list[Bar] = []
    price = base * (1 + rng.uniform(-0.15, 0.05))  # start lower for uptrend feel
    ts = datetime.combine(effective_start, datetime.min.time(), tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)

    for i in range(limit):
        if ts > now:
            break  # Don't generate bars in the future
        change = rng.gauss(0.0002, vol)  # slight upward drift
        o = round(price, 2)
        c = round(price * (1 + change), 2)
        intra_high = max(o, c) * (1 + abs(rng.gauss(0, vol * 0.3)))
        intra_low = min(o, c) * (1 - abs(rng.gauss(0, vol * 0.3)))
        h = round(intra_high, 2)
        l = round(intra_low, 2)
        vwap = round((h + l + c) / 3, 2)
        bar_vol = rng.randint(1_000_000, 50_000_000)

        bars.append(Bar(
            timestamp=ts, open=o, high=h, low=l, close=c,
            volume=bar_vol, vwap=vwap, is_demo=True,
        ))
        price = c
        ts += delta

    return bars


def _demo_snapshot(symbol: str) -> Snapshot:
    s = symbol.upper()
    quote = _demo_quote(s)
    rng = random.Random(_symbol_seed(s))
    base = quote.last
    change_pct = round(rng.uniform(-2.5, 3.0), 2)
    prev_close = round(base / (1 + change_pct / 100), 2)

    now = datetime.now(timezone.utc)

    def _make_bar(o: float, c: float) -> Bar:
        h = round(max(o, c) * (1 + abs(rng.gauss(0, 0.003))), 2)
        l = round(min(o, c) * (1 - abs(rng.gauss(0, 0.003))), 2)
        return Bar(
            timestamp=now, open=o, high=h, low=l, close=c,
            volume=rng.randint(2_000_000, 40_000_000),
            vwap=round((h + l + c) / 3, 2),
        )

    return Snapshot(
        symbol=s,
        quote=quote,
        day_bar=_make_bar(prev_close, base),
        prev_day_bar=_make_bar(round(prev_close * (1 + rng.uniform(-0.01, 0.01)), 2), prev_close),
        min_bar=_make_bar(round(base * (1 + rng.uniform(-0.002, 0.002)), 2), base),
        change_pct=change_pct,
        is_demo=True,
    )


def _demo_market_status() -> MarketStatus:
    return MarketStatus(
        market="closed",
        server_time=datetime.now(timezone.utc),
        exchanges={
            "nyse": "closed",
            "nasdaq": "closed",
            "otc": "closed",
        },
        is_demo=True,
    )


def _polygon_key_empty() -> bool:
    from core.config import settings
    return not settings.POLYGON_API_KEY.get_secret_value()


# ---------------------------------------------------------------------------
# Alpaca Market Data helpers
# ---------------------------------------------------------------------------

ALPACA_DATA_URL = "https://data.alpaca.markets"
ALPACA_TRADING_URL = "https://paper-api.alpaca.markets"

ALPACA_TF_MAP = {
    "1min": "1Min", "5min": "5Min", "15min": "15Min",
    "30min": "30Min", "1h": "1Hour", "4h": "4Hour",
    "1d": "1Day", "1w": "1Week", "1mo": "1Month",
}


def _alpaca_keys_available() -> bool:
    from core.config import settings
    return bool(
        settings.ALPACA_API_KEY.get_secret_value()
        and settings.ALPACA_SECRET_KEY.get_secret_value()
    )


def _alpaca_data_headers() -> dict:
    from core.config import settings
    return {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }


# ---------------------------------------------------------------------------
# Data-fetching entry points (formerly in api.routes.market)
# ---------------------------------------------------------------------------


async def fetch_quote(symbol: str, client_host: str | None = None) -> Quote:
    """Return the latest quote for ``symbol`` via Polygon → Alpaca → demo.

    ``client_host`` is accepted for parity with the route layer (rate-limit
    keying uses it upstream) but this function never consults it — caching
    and provider access are symbol-keyed only. The argument is kept so the
    signature matches the documented service contract (B-33 client_host
    threading).

    Raises ``fastapi.HTTPException(404)`` when no provider has data and the
    symbol is not in the demo allowlist — matches the pre-extraction
    behavior so the route contract stays stable.
    """
    from fastapi import HTTPException

    # --- 1. Polygon (if key configured) ---
    if not _polygon_key_empty():
        from core.redis import cache_get, cache_set

        cache_key = f"quote:{symbol.upper()}"
        cached = await cache_get(cache_key)
        if cached:
            return Quote(**cached)

        try:
            import httpx
            from core.config import settings

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/{symbol.upper()}",
                    params={"apiKey": settings.POLYGON_API_KEY.get_secret_value()},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    ticker = data.get("ticker", {})
                    lq = ticker.get("lastQuote", {})
                    lt = ticker.get("lastTrade", {})
                    day = ticker.get("day", {})
                    # Round-4 CLUSTER 5 #19: prefer the upstream trade
                    # timestamp over server-side wall-clock so cached
                    # values are honestly aged. Polygon emits ``t`` as
                    # nanoseconds since epoch on each trade tick.
                    trade_ts_ns = lt.get("t")
                    if trade_ts_ns:
                        try:
                            ts = datetime.fromtimestamp(
                                int(trade_ts_ns) / 1_000_000_000,
                                tz=timezone.utc,
                            )
                        except (ValueError, OverflowError):
                            ts = datetime.now(timezone.utc)
                    else:
                        ts = datetime.now(timezone.utc)
                    quote = Quote(
                        symbol=symbol.upper(),
                        bid=lq.get("p", 0),
                        ask=lq.get("P", 0),
                        last=lt.get("p", 0),
                        volume=day.get("v", 0),
                        timestamp=ts,
                    )
                    await cache_set(cache_key, quote.model_dump(mode="json"), ttl_seconds=5)
                    return quote
        except Exception:
            log.warning("Polygon quote fetch failed for %s", symbol.upper(), exc_info=True)

    # --- 2. Alpaca Market Data ---
    if _alpaca_keys_available():
        try:
            import httpx

            headers = _alpaca_data_headers()
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{ALPACA_DATA_URL}/v2/stocks/{symbol.upper()}/snapshot",
                    headers=headers,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    lt = data.get("latestTrade", {})
                    lq = data.get("latestQuote", {})
                    daily = data.get("dailyBar", {})
                    prev_daily = data.get("prevDailyBar", {})
                    last_price = lt.get("p", 0)
                    prev_close = prev_daily.get("c", 0)
                    change = round(last_price - prev_close, 2) if prev_close else 0
                    change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
                    # Round-4 CLUSTER 5 #19: Alpaca emits ``t`` as RFC3339
                    # on each trade. Use it so the timestamp on the wire
                    # reflects when the trade actually printed, not when
                    # we built the response.
                    trade_ts_str = lt.get("t")
                    if trade_ts_str:
                        try:
                            ts = datetime.fromisoformat(
                                str(trade_ts_str).replace("Z", "+00:00")
                            )
                        except ValueError:
                            ts = datetime.now(timezone.utc)
                    else:
                        ts = datetime.now(timezone.utc)
                    quote = Quote(
                        symbol=symbol.upper(),
                        bid=lq.get("bp", 0),
                        ask=lq.get("ap", 0),
                        last=last_price,
                        volume=int(daily.get("v", 0)),
                        timestamp=ts,
                        change=change,
                        changePct=change_pct,
                        high=daily.get("h", 0),
                        low=daily.get("l", 0),
                        open=daily.get("o", 0),
                        close=prev_close,
                    )

                    from core.redis import cache_set
                    cache_key = f"quote:{symbol.upper()}"
                    await cache_set(cache_key, quote.model_dump(mode="json"), ttl_seconds=5)
                    return quote
        except Exception:
            log.warning("Alpaca quote fetch failed for %s", symbol.upper(), exc_info=True)

    # --- 3. Demo fallback (only for known symbols) ---
    if not _is_valid_demo_symbol(symbol):
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
    log.warning("DEMO FALLBACK: Serving fake quote for %s — Polygon and Alpaca both failed", symbol.upper())
    return _demo_quote(symbol)
