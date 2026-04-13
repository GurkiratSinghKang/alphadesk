from __future__ import annotations

import hashlib
import random
from datetime import date, datetime, timedelta, timezone
from enum import Enum

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter()


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


class Bar(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int
    vwap: float | None = None


class Snapshot(BaseModel):
    symbol: str
    quote: Quote
    day_bar: Bar
    prev_day_bar: Bar
    min_bar: Bar
    change_pct: float


class MarketStatus(BaseModel):
    market: str
    server_time: datetime
    exchanges: dict[str, str] = Field(
        default_factory=dict,
        description="Exchange name -> status (open/closed/early_hours/late_hours)",
    )


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

    for i in range(limit):
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
            volume=bar_vol, vwap=vwap,
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
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/quotes/{symbol}", response_model=Quote)
async def get_quote(symbol: str) -> Quote:
    """Fetch the latest quote for a given symbol (Polygon -> Alpaca -> demo)."""

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
                    quote = Quote(
                        symbol=symbol.upper(),
                        bid=lq.get("p", 0),
                        ask=lq.get("P", 0),
                        last=lt.get("p", 0),
                        volume=day.get("v", 0),
                        timestamp=datetime.now(timezone.utc),
                    )
                    await cache_set(cache_key, quote.model_dump(mode="json"), ttl_seconds=5)
                    return quote
        except Exception:
            pass  # fall through to Alpaca

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
                    quote = Quote(
                        symbol=symbol.upper(),
                        bid=lq.get("bp", 0),
                        ask=lq.get("ap", 0),
                        last=last_price,
                        volume=int(daily.get("v", 0)),
                        timestamp=datetime.now(timezone.utc),
                        change=change,
                        changePct=change_pct,
                        high=daily.get("h", 0),
                        low=daily.get("l", 0),
                        open=daily.get("o", 0),
                        close=prev_close,
                    )

                    from core.redis import cache_get, cache_set
                    cache_key = f"quote:{symbol.upper()}"
                    await cache_set(cache_key, quote.model_dump(mode="json"), ttl_seconds=5)
                    return quote
        except Exception:
            pass  # fall through to demo

    # --- 3. Demo fallback (only for known symbols) ---
    if not _is_valid_demo_symbol(symbol):
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
    return _demo_quote(symbol)


@router.get("/bars/{symbol}", response_model=list[Bar])
async def get_bars(
    symbol: str,
    timeframe: Timeframe = Query(Timeframe.DAY, description="Bar timeframe"),
    start: date | None = Query(None, description="Start date (YYYY-MM-DD)"),
    end: date | None = Query(None, description="End date (YYYY-MM-DD)"),
    limit: int = Query(500, ge=1, le=5000),
) -> list[Bar]:
    """Fetch OHLCV bars for a symbol over a date range (Polygon -> Alpaca -> demo)."""

    effective_end = end or date.today()
    effective_start = start or (effective_end - timedelta(days=365))

    # --- Redis cache check ---
    from core.redis import cache_get, cache_set

    cache_key = f"bars:{symbol.upper()}:{timeframe.value}:{limit}"
    cached = await cache_get(cache_key)
    if cached:
        return [Bar(**b) for b in cached]

    # Intraday timeframes get 30s TTL; daily+ get 5min TTL
    _INTRADAY_TFS = {"1min", "5min", "15min", "30min", "1h"}
    cache_ttl = 30 if timeframe.value in _INTRADAY_TFS else 300

    # --- 1. Polygon ---
    if not _polygon_key_empty():
        try:
            import httpx
            from core.config import settings

            tf_map = {
                "1min": ("minute", 1), "5min": ("minute", 5), "15min": ("minute", 15),
                "30min": ("minute", 30), "1h": ("hour", 1), "4h": ("hour", 4),
                "1d": ("day", 1), "1w": ("week", 1), "1mo": ("month", 1),
            }
            span, mult = tf_map[timeframe.value]

            params: dict = {
                "adjusted": "true",
                "sort": "asc",
                "limit": limit,
                "apiKey": settings.POLYGON_API_KEY.get_secret_value(),
            }
            url = (
                f"https://api.polygon.io/v2/aggs/ticker/{symbol.upper()}/range/"
                f"{mult}/{span}/{effective_start.isoformat()}/{effective_end.isoformat()}"
            )

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    bars = [
                        Bar(
                            timestamp=datetime.fromtimestamp(r["t"] / 1000, tz=timezone.utc),
                            open=r["o"],
                            high=r["h"],
                            low=r["l"],
                            close=r["c"],
                            volume=r["v"],
                            vwap=r.get("vw"),
                        )
                        for r in data.get("results", [])
                    ]
                    await cache_set(
                        cache_key,
                        [b.model_dump(mode="json") for b in bars],
                        ttl_seconds=cache_ttl,
                    )
                    return bars
        except Exception:
            pass  # fall through to Alpaca

    # --- 2. Alpaca bars ---
    if _alpaca_keys_available():
        try:
            import httpx

            alpaca_tf = ALPACA_TF_MAP.get(timeframe.value, "1Day")
            headers = _alpaca_data_headers()
            params_alpaca: dict = {
                "timeframe": alpaca_tf,
                "start": datetime.combine(effective_start, datetime.min.time(), tzinfo=timezone.utc).isoformat(),
                "end": datetime.combine(effective_end, datetime.min.time(), tzinfo=timezone.utc).isoformat(),
                "limit": limit,
                "adjustment": "raw",
                "feed": "iex",
                "sort": "asc",
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{ALPACA_DATA_URL}/v2/stocks/{symbol.upper()}/bars",
                    headers=headers,
                    params=params_alpaca,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    bars = [
                        Bar(
                            timestamp=datetime.fromisoformat(r["t"].replace("Z", "+00:00")),
                            open=r["o"],
                            high=r["h"],
                            low=r["l"],
                            close=r["c"],
                            volume=r["v"],
                            vwap=r.get("vw"),
                        )
                        for r in data.get("bars", []) or []
                    ]
                    await cache_set(
                        cache_key,
                        [b.model_dump(mode="json") for b in bars],
                        ttl_seconds=cache_ttl,
                    )
                    return bars
        except Exception:
            pass  # fall through to demo

    # --- 3. Demo fallback (only for known symbols) ---
    if not _is_valid_demo_symbol(symbol):
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
    return _demo_bars(symbol, timeframe.value, limit, start, end)


@router.get("/snapshot/{symbol}", response_model=Snapshot)
async def get_snapshot(symbol: str) -> Snapshot:
    """Fetch a full market snapshot for a symbol (Polygon -> Alpaca -> demo)."""

    # --- 1. Polygon ---
    if not _polygon_key_empty():
        try:
            import httpx
            from core.config import settings

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/{symbol.upper()}",
                    params={"apiKey": settings.POLYGON_API_KEY.get_secret_value()},
                )
                if resp.status_code == 200:
                    try:
                        data = resp.json().get("ticker", {})
                    except Exception:
                        data = {}

                    def _bar(d: dict) -> Bar:
                        return Bar(
                            timestamp=datetime.now(timezone.utc),
                            open=d.get("o", 0), high=d.get("h", 0),
                            low=d.get("l", 0), close=d.get("c", 0),
                            volume=d.get("v", 0), vwap=d.get("vw"),
                        )

                    day = data.get("day", {})
                    prev = data.get("prevDay", {})
                    mn = data.get("min", {})
                    lq = data.get("lastQuote", {})

                    return Snapshot(
                        symbol=symbol.upper(),
                        quote=Quote(
                            symbol=symbol.upper(),
                            bid=lq.get("p", 0), ask=lq.get("P", 0),
                            last=data.get("lastTrade", {}).get("p", 0),
                            volume=day.get("v", 0),
                            timestamp=datetime.now(timezone.utc),
                        ),
                        day_bar=_bar(day),
                        prev_day_bar=_bar(prev),
                        min_bar=_bar(mn),
                        change_pct=data.get("todaysChangePerc", 0),
                    )
        except Exception:
            pass  # fall through to Alpaca

    # --- 2. Alpaca snapshot ---
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
                    prev = data.get("prevDailyBar", {})
                    mn = data.get("minuteBar", {})

                    now = datetime.now(timezone.utc)

                    def _alpaca_bar(d: dict) -> Bar:
                        return Bar(
                            timestamp=datetime.fromisoformat(d["t"].replace("Z", "+00:00")) if d.get("t") else now,
                            open=d.get("o", 0), high=d.get("h", 0),
                            low=d.get("l", 0), close=d.get("c", 0),
                            volume=int(d.get("v", 0)), vwap=d.get("vw"),
                        )

                    day_close = daily.get("c", 0)
                    prev_close = prev.get("c", 0)
                    change_pct = round(((day_close - prev_close) / prev_close) * 100, 2) if prev_close else 0

                    return Snapshot(
                        symbol=symbol.upper(),
                        quote=Quote(
                            symbol=symbol.upper(),
                            bid=lq.get("bp", 0),
                            ask=lq.get("ap", 0),
                            last=lt.get("p", 0),
                            volume=int(daily.get("v", 0)),
                            timestamp=now,
                        ),
                        day_bar=_alpaca_bar(daily),
                        prev_day_bar=_alpaca_bar(prev),
                        min_bar=_alpaca_bar(mn),
                        change_pct=change_pct,
                    )
        except Exception:
            pass  # fall through to demo

    # --- 3. Demo fallback (only for known symbols) ---
    if not _is_valid_demo_symbol(symbol):
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
    return _demo_snapshot(symbol)


@router.get("/market-status", response_model=MarketStatus)
async def get_market_status() -> MarketStatus:
    """Return current market open/close status for US exchanges (Polygon -> Alpaca -> demo)."""

    # --- 1. Polygon ---
    if not _polygon_key_empty():
        try:
            import httpx
            from core.config import settings

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    "https://api.polygon.io/v1/marketstatus/now",
                    params={"apiKey": settings.POLYGON_API_KEY.get_secret_value()},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return MarketStatus(
                        market=data.get("market", "unknown"),
                        server_time=datetime.now(timezone.utc),
                        exchanges=data.get("exchanges", {}),
                    )
        except Exception:
            pass  # fall through to Alpaca

    # --- 2. Alpaca clock ---
    if _alpaca_keys_available():
        try:
            import httpx

            headers = _alpaca_data_headers()
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{ALPACA_TRADING_URL}/v2/clock",
                    headers=headers,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    is_open = data.get("is_open", False)
                    return MarketStatus(
                        market="open" if is_open else "closed",
                        server_time=datetime.now(timezone.utc),
                        exchanges={
                            "nyse": "open" if is_open else "closed",
                            "nasdaq": "open" if is_open else "closed",
                        },
                    )
        except Exception:
            pass  # fall through to demo

    # --- 3. Demo fallback ---
    return _demo_market_status()
