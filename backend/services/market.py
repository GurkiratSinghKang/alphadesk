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
import re
from datetime import date, datetime, timedelta, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

log = logging.getLogger(__name__)


# OCC option symbol shape: ROOT(1-6) + YYMMDD(6) + [CP](1) + STRIKE(8 digits × 1000)
# Mirrors `_OCC_SYMBOL_PATTERN` in backend.api.routes.trades.
_OCC_OPTION_PATTERN = re.compile(r"^[A-Z0-9]{1,6}[0-9]{6}[CP][0-9]{8}$")


def _parse_occ_underlying(symbol: str) -> str | None:
    """Return the underlying root for an OCC option symbol, or None if not OCC."""
    s = symbol.upper().strip()
    if not _OCC_OPTION_PATTERN.match(s):
        return None
    # Root is everything before the YYMMDD block (6 digits + CP + 8 digits = 15 trailing chars)
    return s[:-15]


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class Quote(BaseModel):
    symbol: str
    bid: float
    ask: float
    bidSize: int = 0
    askSize: int = 0
    bidExchange: str | None = None
    askExchange: str | None = None
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
    # Batch EH-1 (2026-05-05): extended-hours pricing.
    # ---------------------------------------------------------------
    # AMD reported earnings, gapped to ~$403 post-market, but the
    # dashboard kept showing the regular-session $356 close. The new
    # fields below let the frontend surface pre/post-market prints
    # alongside (not in place of) the regular-session figures.
    #
    # Contract:
    #   * ``regular_close_price`` — the most recent regular-session
    #     close. Falls back to the previous day's close before 16:00 ET.
    #   * ``extended_price`` — last trade printed in pre or post hours.
    #     ``None`` outside extended hours OR when no extended trade has
    #     printed (illiquid options especially).
    #   * ``extended_change`` / ``extended_change_pct`` — diff vs.
    #     ``regular_close_price``. Both ``None`` when ``extended_price``
    #     is ``None`` so the frontend doesn't render fake zeros.
    #   * ``extended_session`` — "pre" or "post"; ``None`` during
    #     regular hours / when no extended trade is available.
    #   * ``extended_volume`` — cumulative extended-hours volume from
    #     the upstream snapshot when published; otherwise ``None``.
    #   * ``last_trade_time`` — wall-clock UTC of the most recent trade
    #     across all sessions (regular OR extended). Frontend uses
    #     this to detect stale data (>5min from now == "stale" badge).
    #   * ``session`` — quick classifier for the *current* market
    #     state, not the trade's session. UI uses this to switch
    #     between "Live" / "Pre-market" / "After hours" / "Closed".
    regular_close_price: float | None = None
    extended_price: float | None = None
    extended_change: float | None = None
    extended_change_pct: float | None = None
    extended_session: Literal["pre", "post"] | None = None
    extended_volume: int | None = None
    last_trade_time: datetime | None = None
    session: Literal["pre", "regular", "post", "closed"] = "regular"
    # Wave V V1-1 (2026-05-05): volume signals.
    # ---------------------------------------------------------------
    # ``avg_daily_volume_20d`` is the trailing 20-trading-day mean of
    # daily session volume (Polygon /v2/aggs daily bars). Cached per
    # symbol for 1h — ADV moves slowly relative to the quote, so a
    # one-hour TTL collapses ~3,600 quote calls into a single ADV
    # roundtrip without staleness affecting screening decisions.
    #
    # ``relative_volume`` = ``volume`` / ``avg_daily_volume_20d`` and is
    # the strategy-relevant signal: > 1.5 means today is meaningfully
    # busier than usual ("a-day"); < 0.5 means it's a quiet tape.
    #
    # Edge cases:
    #   * Newly listed symbol with < 20 day history -> ``avg_daily_volume_20d``
    #     is ``None`` and ``relative_volume`` is also ``None``. Don't
    #     fabricate; consumers must handle the missing case explicitly.
    #   * Demo / Alpaca-only paths leave both fields ``None`` because
    #     ADV requires Polygon's daily aggs endpoint. Frontend renders
    #     em-dash for ``None``.
    avg_daily_volume_20d: int | None = None
    relative_volume: float | None = None


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


class MarketDepthLevel(BaseModel):
    price: float
    size: int = 0
    venue: str | None = None


class MarketDepthSnapshot(BaseModel):
    symbol: str
    kind: Literal["top_of_book", "level_2"] = "top_of_book"
    provider: str
    bids: list[MarketDepthLevel] = Field(default_factory=list)
    asks: list[MarketDepthLevel] = Field(default_factory=list)
    timestamp: datetime
    is_l2: bool = False
    is_demo: bool = False
    notes: list[str] = Field(default_factory=list)


class MarketDepthProviderCapability(BaseModel):
    provider: str
    configured: bool
    equities: Literal["none", "top_of_book", "level_2"]
    notes: str


class MarketDepthCapabilities(BaseModel):
    active_kind: Literal["top_of_book", "level_2"]
    true_l2_available: bool
    providers: list[MarketDepthProviderCapability]
    notes: list[str] = Field(default_factory=list)


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
# Demo seed tables live in ``backend/data/symbol_lists.py`` (Batch V). The
# market service re-exports them under the previous module-private names so
# call sites and tests don't have to change. ``_VALID_DEMO_SYMBOLS`` gates
# demo-data generation to known tickers (S&P 500 + major ETFs / indices);
# unknown symbols return "no data" rather than fabricated quotes.

from data.symbol_lists import (
    DEMO_BASE_PRICES_MARKET as _DEMO_BASE_PRICES,
    DEMO_DEFAULT_VOLATILITY as _DEFAULT_VOLATILITY,
    DEMO_TRADEABLE_SYMBOLS as _VALID_DEMO_SYMBOLS,
    DEMO_VOLATILITY as _DEMO_VOLATILITY,
)


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
    bid_size = rng.randint(1, 20)
    ask_size = rng.randint(1, 20)
    volume = rng.randint(5_000_000, 50_000_000)
    # Compute realistic change data from base price
    prev_close = round(base * (1 + rng.uniform(-0.01, 0.005)), 2)
    change = round(last - prev_close, 2)
    change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
    day_open = round(prev_close * (1 + rng.uniform(-0.003, 0.003)), 2)
    day_high = round(max(last, day_open) * (1 + abs(rng.gauss(0, 0.005))), 2)
    day_low = round(min(last, day_open) * (1 - abs(rng.gauss(0, 0.005))), 2)
    # EH-1: demo quotes are deliberately simple — no extended-hours
    # fabrication. Frontend treats demo data as "regular hours close"
    # and shows the demo badge.
    return Quote(
        symbol=s, bid=bid, ask=ask,
        bidSize=bid_size, askSize=ask_size,
        bidExchange="DEMO", askExchange="DEMO",
        last=last,
        volume=volume, timestamp=datetime.now(timezone.utc),
        change=change, changePct=change_pct,
        high=day_high, low=day_low, open=day_open, close=prev_close,
        is_demo=True,
        regular_close_price=prev_close,
        last_trade_time=datetime.now(timezone.utc),
        session=_classify_session(),
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

# Batch W (audit-reports/2026-05-05/HARDCODING-SWEEP.md C-1):
# centralised in :mod:`core.config`. Read at import so a ``.env``
# override propagates without touching code.
from core.config import settings as _settings_w_market  # noqa: E402

ALPACA_DATA_URL = _settings_w_market.ALPACA_DATA_BASE_URL
ALPACA_TRADING_URL = _settings_w_market.ALPACA_PAPER_BASE_URL
del _settings_w_market

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
# Batch EH-1 (2026-05-05): extended-hours derivation helpers
# ---------------------------------------------------------------------------

def _classify_session(now: datetime | None = None) -> Literal["pre", "regular", "post", "closed"]:
    """Wrapper around ``core.time.current_session`` so callers don't
    re-import it everywhere. Lazy import keeps the market service
    free of cycles when ``core.time`` is patched in tests."""
    from core.time import current_session

    return current_session(now)


def _classify_trade_session(trade_dt: datetime | None) -> Literal["pre", "regular", "post"] | None:
    """Classify a single trade's session from its UTC timestamp.

    Returns ``None`` for regular-hour trades or when the timestamp is
    missing — callers only emit ``extended_session`` when the trade
    actually printed in pre/post hours, so a regular-session trade
    contributes ``None`` here (not "regular").
    """
    if trade_dt is None:
        return None
    from core.time import classify_trade_session

    s = classify_trade_session(trade_dt)
    if s in ("pre", "post"):
        return s  # type: ignore[return-value]
    return None


def _compute_extended_fields(
    *,
    last_trade_price: float | None,
    last_trade_dt: datetime | None,
    regular_close: float | None,
    extended_volume: int | None = None,
) -> dict:
    """Build the EH-1 quote-payload extension from raw snapshot inputs.

    Returns a dict with the new ``extended_*`` and ``last_trade_time``
    keys plus the ``session`` classifier. Designed so callers can
    ``**spread`` it into the ``Quote(...)`` constructor without
    branching at the call site.

    Rules:
      * If ``last_trade_dt`` is missing OR the trade was in regular
        hours, ``extended_price`` and friends are all ``None``.
      * Extended change/pct only emit when both ``extended_price``
        and ``regular_close`` are non-zero — otherwise we'd render a
        spurious -100% during the first post-market tick.
    """
    extended_session = _classify_trade_session(last_trade_dt)
    extended_price: float | None = None
    extended_change: float | None = None
    extended_change_pct: float | None = None

    if extended_session is not None and last_trade_price not in (None, 0):
        extended_price = float(last_trade_price)
        if regular_close not in (None, 0):
            extended_change = round(extended_price - float(regular_close), 4)
            extended_change_pct = round(
                (extended_change / float(regular_close)) * 100, 2
            )

    # ``extended_volume`` may be ``None`` when the upstream snapshot
    # doesn't separate it. Don't fabricate; pass through.
    return {
        "regular_close_price": regular_close,
        "extended_price": extended_price,
        "extended_change": extended_change,
        "extended_change_pct": extended_change_pct,
        "extended_session": extended_session,
        "extended_volume": extended_volume,
        "last_trade_time": last_trade_dt,
        "session": _classify_session(),
    }


# ---------------------------------------------------------------------------
# Wave V V1-1: trailing 20-day average daily volume (ADV)
# ---------------------------------------------------------------------------
# Polygon's ``/v2/aggs/ticker/{symbol}/range/1/day/{from}/{to}`` endpoint
# returns up to ~30 daily bars; we sum the most recent 20 trading-day bars
# and divide by 20. Cached for 1h per symbol because ADV changes slowly
# relative to a 5s-cached quote — without the cache, every quote roundtrip
# would also pay an aggs-history roundtrip.
#
# Returns ``None`` when:
#   * Polygon key is missing.
#   * Polygon returns < 20 daily bars (newly listed symbols).
#   * The aggs endpoint errors. Callers translate ``None`` into
#     ``avg_daily_volume_20d=None`` on the Quote.

_ADV_CACHE_TTL_SECONDS = 3600  # 1 hour
_ADV_LOOKBACK_DAYS = 20  # trailing trading days


async def _fetch_avg_daily_volume_20d(symbol: str) -> int | None:
    """Return the trailing 20-trading-day average daily volume.

    Returns ``None`` when Polygon is unavailable, the symbol has < 20
    daily bars (newly listed), or any parse / network error fires. The
    caller (``fetch_quote``) translates a missing ADV into
    ``avg_daily_volume_20d=None`` and ``relative_volume=None`` rather
    than fabricating a ratio against a guessed denominator.
    """
    s = symbol.upper().strip()
    if _polygon_key_empty():
        return None

    cache_key = f"adv20:{s}"
    try:
        from core.redis import cache_get

        cached = await cache_get(cache_key)
        if isinstance(cached, dict) and "value" in cached:
            v = cached["value"]
            return int(v) if isinstance(v, (int, float)) and v > 0 else None
        if isinstance(cached, (int, float)) and cached > 0:
            return int(cached)
    except Exception:
        pass

    try:
        import httpx
        from core.config import settings

        # Pull a 45-calendar-day window so we comfortably collect 20
        # trading days even across weekends / holidays.
        end_date = date.today()
        start_date = end_date - timedelta(days=45)
        url = (
            f"{settings.POLYGON_BASE_URL}/v2/aggs/ticker/{s}/range/1/day"
            f"/{start_date.isoformat()}/{end_date.isoformat()}"
        )
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                url,
                params={
                    "apiKey": settings.POLYGON_API_KEY.get_secret_value(),
                    "adjusted": "true",
                    "sort": "desc",
                    "limit": 50,
                },
            )
            if resp.status_code != 200:
                log.debug(
                    "Polygon ADV20 fetch HTTP %s for %s",
                    resp.status_code, s,
                )
                return None
            data = resp.json() or {}
        results = data.get("results") or []
        if not isinstance(results, list):
            return None
        # Take the most recent 20 daily bars. ``v`` is the day's volume.
        volumes = [
            int(r.get("v") or 0)
            for r in results[:_ADV_LOOKBACK_DAYS]
            if isinstance(r, dict) and (r.get("v") or 0) > 0
        ]
        if len(volumes) < _ADV_LOOKBACK_DAYS:
            # Newly listed symbol or sparse history — return None rather
            # than averaging over fewer days (would inflate the ratio).
            return None
        adv = int(round(sum(volumes) / _ADV_LOOKBACK_DAYS))
        try:
            from core.redis import cache_set

            await cache_set(cache_key, {"value": adv}, ttl_seconds=_ADV_CACHE_TTL_SECONDS)
        except Exception:
            pass
        return adv
    except Exception:
        log.debug("ADV20 fetch failed for %s", s, exc_info=True)
        return None


def _compute_relative_volume(
    today_volume: int | None, adv_20d: int | None
) -> float | None:
    """Return ``today_volume / adv_20d`` rounded to 4 dp, or None if either
    is missing / non-positive. Centralised so callers don't divide-by-zero."""
    if not today_volume or not adv_20d or adv_20d <= 0:
        return None
    try:
        return round(float(today_volume) / float(adv_20d), 4)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


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

    # Audit-r5 (B1.8): reject Polygon-namespaced inputs at the equity
    # entry point. Symbols like ``I:TQQQIV`` (Polygon indices namespace)
    # leak into the equity quote path through legacy watchlists or stale
    # localStorage; without a guard they fail downstream as a generic
    # 404 ("Symbol 'I:TQQQIV' not found"), which surfaces in the
    # DataUnavailableBanner with the unhelpful raw symbol verbatim. Reject
    # cleanly with a 422 + clear message so the FE can drop the entry
    # rather than retry on every poll.
    if ":" in symbol:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Invalid equity symbol '{symbol}': Polygon-namespaced "
                "symbols (I:* indices, O:* options) are not supported on the "
                "quote endpoint. Pass the underlying ticker instead."
            ),
        )

    # P1-13: option-symbol detection — when the input matches the OCC
    # contract shape, dispatch to the option-snapshot endpoints rather
    # than the equity ticker path (which would 404). The equity demo
    # fallback is intentionally NOT applied to OCC symbols.
    occ_underlying = _parse_occ_underlying(symbol)
    if occ_underlying is not None:
        contract = symbol.upper().strip()
        cache_key = f"quote:{contract}"
        try:
            from core.redis import cache_get, cache_set

            cached = await cache_get(cache_key)
            if cached:
                return Quote(**cached)
        except Exception:
            cache_set = None  # type: ignore[assignment]

        # --- Polygon option contract snapshot ---
        if not _polygon_key_empty():
            try:
                import httpx
                from core.config import settings

                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(
                        f"{settings.POLYGON_BASE_URL}/v3/snapshot/options/{occ_underlying}/O:{contract}",
                        params={"apiKey": settings.POLYGON_API_KEY.get_secret_value()},
                    )
                    if resp.status_code == 200:
                        data = (resp.json() or {}).get("results", {}) or {}
                        lq = data.get("last_quote", {}) or {}
                        lt = data.get("last_trade", {}) or {}
                        day = data.get("day", {}) or {}
                        bid = float(lq.get("bid", 0) or 0)
                        ask = float(lq.get("ask", 0) or 0)
                        last_price = float(lt.get("price", 0) or 0)
                        prev_close = float(day.get("previous_close", 0) or 0)
                        change = round(last_price - prev_close, 4) if prev_close else 0.0
                        change_pct = (
                            round((change / prev_close) * 100, 2) if prev_close else 0.0
                        )
                        # EH-1: option contract extended-hours block.
                        # Polygon emits ``last_trade.t`` (also ``last_trade.sip_timestamp``)
                        # in nanoseconds. Most options have ZERO trades
                        # outside RTH so ``extended_price`` will be None
                        # for the vast majority — that's the correct
                        # answer; the frontend renders "no extended trades".
                        trade_ts_ns = lt.get("sip_timestamp") or lt.get("t")
                        opt_trade_dt: datetime | None = None
                        if trade_ts_ns:
                            try:
                                opt_trade_dt = datetime.fromtimestamp(
                                    int(trade_ts_ns) / 1_000_000_000,
                                    tz=timezone.utc,
                                )
                            except (ValueError, OverflowError):
                                opt_trade_dt = None
                        eh = _compute_extended_fields(
                            last_trade_price=last_price if last_price else None,
                            last_trade_dt=opt_trade_dt,
                            regular_close=prev_close if prev_close else None,
                        )
                        quote = Quote(
                            symbol=contract,
                            bid=bid,
                            ask=ask,
                            bidSize=int(lq.get("bid_size") or 0),
                            askSize=int(lq.get("ask_size") or 0),
                            last=last_price,
                            volume=int(day.get("volume") or 0),
                            timestamp=datetime.now(timezone.utc),
                            change=change,
                            changePct=change_pct,
                            high=float(day.get("high", 0) or 0),
                            low=float(day.get("low", 0) or 0),
                            open=float(day.get("open", 0) or 0),
                            close=prev_close,
                            **eh,
                        )
                        try:
                            from core.redis import cache_set as _cs

                            await _cs(cache_key, quote.model_dump(mode="json"), ttl_seconds=5)
                        except Exception:
                            pass
                        return quote
            except Exception:
                log.warning(
                    "Polygon option-quote fetch failed for %s", contract, exc_info=True
                )

        # --- Alpaca option snapshot ---
        if _alpaca_keys_available():
            try:
                import httpx

                headers = _alpaca_data_headers()
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(
                        f"{ALPACA_DATA_URL}/v1beta1/options/snapshots/{contract}",
                        headers=headers,
                    )
                    if resp.status_code == 200:
                        data = resp.json() or {}
                        snap = (data.get("snapshots") or {}).get(contract) or data
                        lq = snap.get("latestQuote", {}) or {}
                        lt = snap.get("latestTrade", {}) or {}
                        daily = snap.get("dailyBar", {}) or {}
                        prev_daily = snap.get("prevDailyBar", {}) or {}
                        bid = float(lq.get("bp", 0) or 0)
                        ask = float(lq.get("ap", 0) or 0)
                        last_price = float(lt.get("p", 0) or 0)
                        prev_close = float(prev_daily.get("c", 0) or 0)
                        change = round(last_price - prev_close, 4) if prev_close else 0.0
                        change_pct = (
                            round((change / prev_close) * 100, 2) if prev_close else 0.0
                        )
                        # EH-1: option contract extended-hours block.
                        # Alpaca emits the trade time as RFC3339.
                        opt_trade_ts = lt.get("t")
                        opt_trade_dt: datetime | None = None
                        if opt_trade_ts:
                            try:
                                opt_trade_dt = datetime.fromisoformat(
                                    str(opt_trade_ts).replace("Z", "+00:00")
                                )
                            except ValueError:
                                opt_trade_dt = None
                        eh = _compute_extended_fields(
                            last_trade_price=last_price if last_price else None,
                            last_trade_dt=opt_trade_dt,
                            regular_close=prev_close if prev_close else None,
                        )
                        quote = Quote(
                            symbol=contract,
                            bid=bid,
                            ask=ask,
                            bidSize=int(lq.get("bs") or 0),
                            askSize=int(lq.get("as") or 0),
                            last=last_price,
                            volume=int(daily.get("v") or 0),
                            timestamp=datetime.now(timezone.utc),
                            change=change,
                            changePct=change_pct,
                            high=float(daily.get("h", 0) or 0),
                            low=float(daily.get("l", 0) or 0),
                            open=float(daily.get("o", 0) or 0),
                            close=prev_close,
                            **eh,
                        )
                        try:
                            from core.redis import cache_set as _cs

                            await _cs(cache_key, quote.model_dump(mode="json"), ttl_seconds=5)
                        except Exception:
                            pass
                        return quote
            except Exception:
                log.warning(
                    "Alpaca option-quote fetch failed for %s", contract, exc_info=True
                )

        # No demo fallback for OCC symbols — raise 404 explicitly.
        raise HTTPException(
            status_code=404, detail=f"Option contract '{contract}' not found"
        )

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
                    f"{settings.POLYGON_BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers/{symbol.upper()}",
                    params={"apiKey": settings.POLYGON_API_KEY.get_secret_value()},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    ticker = data.get("ticker", {})
                    lq = ticker.get("lastQuote", {})
                    lt = ticker.get("lastTrade", {})
                    day = ticker.get("day", {})
                    prev_day = ticker.get("prevDay", {})
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
                    # EH-1: derive extended-hours block.
                    # ``day.c`` is set after 16:00 ET; before that it's
                    # 0 / null and we fall back to ``prevDay.c`` so the
                    # change basis is always the most recent regular
                    # close. Extended trades are anything outside
                    # 09:30-16:00 ET (classified by trade timestamp).
                    last_price = lt.get("p", 0) or 0
                    day_close = day.get("c") or None
                    prev_close = prev_day.get("c") or None
                    regular_close = day_close if day_close not in (None, 0) else prev_close
                    eh = _compute_extended_fields(
                        last_trade_price=last_price,
                        last_trade_dt=ts,
                        regular_close=regular_close,
                    )
                    # Wave V V1-1: ADV20 + relative_volume.
                    today_vol = int(day.get("v") or 0)
                    adv_20d = await _fetch_avg_daily_volume_20d(symbol)
                    rel_vol = _compute_relative_volume(today_vol, adv_20d)
                    quote = Quote(
                        symbol=symbol.upper(),
                        bid=lq.get("p", 0),
                        ask=lq.get("P", 0),
                        bidSize=int(lq.get("s") or lq.get("bid_size") or 0),
                        askSize=int(lq.get("S") or lq.get("ask_size") or 0),
                        bidExchange=str(lq.get("x") or lq.get("bid_exchange") or "") or None,
                        askExchange=str(lq.get("X") or lq.get("ask_exchange") or "") or None,
                        last=last_price,
                        volume=today_vol,
                        timestamp=ts,
                        avg_daily_volume_20d=adv_20d,
                        relative_volume=rel_vol,
                        **eh,
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
                # EH-1: prefer the ``feed=sip`` snapshot. SIP includes
                # extended-hours trades (pre + post). The IEX feed only
                # carries regular-session prints, which is exactly the
                # bug we're fixing — IEX would still report AMD's $356
                # close at 6pm ET regardless of the post-print spike.
                resp = await client.get(
                    f"{ALPACA_DATA_URL}/v2/stocks/{symbol.upper()}/snapshot",
                    headers=headers,
                    params={"feed": "sip"},
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
                    # EH-1: regular_close = today's daily close after
                    # 16:00 ET, else prior session's close. Alpaca's
                    # ``dailyBar.c`` is set continuously through the
                    # session (it's the last RTH trade), but we want
                    # the *closed* daily close — so before 16:00 ET we
                    # always lean on prevDailyBar.
                    day_close = daily.get("c") or None
                    cur_session = _classify_session()
                    if cur_session == "post" and day_close not in (None, 0):
                        regular_close = day_close
                    else:
                        regular_close = prev_close if prev_close not in (None, 0) else day_close
                    eh = _compute_extended_fields(
                        last_trade_price=last_price,
                        last_trade_dt=ts,
                        regular_close=regular_close,
                    )
                    # Wave V V1-1: ADV20 + relative_volume. ADV uses
                    # Polygon's daily aggs even when the snapshot came
                    # from Alpaca — both fields stay None when the
                    # Polygon key is absent. Don't fabricate.
                    today_vol = int(daily.get("v", 0))
                    adv_20d = await _fetch_avg_daily_volume_20d(symbol)
                    rel_vol = _compute_relative_volume(today_vol, adv_20d)
                    quote = Quote(
                        symbol=symbol.upper(),
                        bid=lq.get("bp", 0),
                        ask=lq.get("ap", 0),
                        bidSize=int(lq.get("bs") or 0),
                        askSize=int(lq.get("as") or 0),
                        bidExchange=lq.get("bx"),
                        askExchange=lq.get("ax"),
                        last=last_price,
                        volume=today_vol,
                        timestamp=ts,
                        change=change,
                        changePct=change_pct,
                        high=daily.get("h", 0),
                        low=daily.get("l", 0),
                        open=daily.get("o", 0),
                        close=prev_close,
                        avg_daily_volume_20d=adv_20d,
                        relative_volume=rel_vol,
                        **eh,
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
    # Round-11 / BB-12 (P0): the demo fallback used to log at WARNING
    # only. There was no metric, no /readyz flap, no operator alert.
    # P&L, top-movers, and brief generation all consumed these synthetic
    # prices as if real. Now we additionally fire a Redis-side counter
    # so a downstream alerting probe (or /readyz-full) can detect a
    # provider-outage burst, AND emit a structured ``event="provider_outage"``
    # log line so log aggregators surface this without a free-text grep.
    try:
        from core.redis import cache_incr
        await cache_incr("metrics:provider_outage:quote_demo_total")
    except Exception:
        pass  # metrics are best-effort
    log.warning(
        "DEMO FALLBACK: Serving fake quote for %s — Polygon and Alpaca both failed",
        symbol.upper(),
        extra={"event": "provider_outage", "provider": "alpaca+polygon", "symbol": symbol.upper()},
    )
    return _demo_quote(symbol)


async def fetch_market_depth(
    symbol: str,
    *,
    levels: int = 10,
    client_host: str | None = None,
) -> MarketDepthSnapshot:
    """Return market depth for ``symbol`` behind a stable app contract.

    Current provider reality: the app has equities NBBO/top-of-book from
    Alpaca/Polygon, but no true Level II/depth feed. This endpoint therefore
    returns a one-level depth snapshot derived from ``fetch_quote`` and marks
    ``is_l2=False``. When a true depth provider is added later, the frontend can
    keep consuming this shape and receive multiple bid/ask levels.
    """
    quote = await fetch_quote(symbol, client_host=client_host)
    bids = [
        MarketDepthLevel(
            price=quote.bid,
            size=quote.bidSize,
            venue=quote.bidExchange,
        )
    ] if quote.bid > 0 else []
    asks = [
        MarketDepthLevel(
            price=quote.ask,
            size=quote.askSize,
            venue=quote.askExchange,
        )
    ] if quote.ask > 0 else []

    requested = max(1, min(int(levels or 1), 50))
    notes = [
        "Top-of-book quote fallback; not full Level II depth.",
        "Support/resistance and order blocks remain chart-derived liquidity proxies.",
    ]
    if requested > 1:
        notes.append("Requested multiple levels, but current providers expose only one equity quote level.")

    provider = "demo_quote" if quote.is_demo else "quote_fallback"
    return MarketDepthSnapshot(
        symbol=quote.symbol,
        kind="top_of_book",
        provider=provider,
        bids=bids[:1],
        asks=asks[:1],
        timestamp=quote.timestamp,
        is_l2=False,
        is_demo=quote.is_demo,
        notes=notes,
    )


def market_depth_capabilities() -> MarketDepthCapabilities:
    """Describe configured depth capability without exposing credentials."""
    alpaca_configured = _alpaca_keys_available()
    polygon_configured = not _polygon_key_empty()
    return MarketDepthCapabilities(
        active_kind="top_of_book",
        true_l2_available=False,
        providers=[
            MarketDepthProviderCapability(
                provider="alpaca",
                configured=alpaca_configured,
                equities="top_of_book" if alpaca_configured else "none",
                notes="Configured Alpaca stock data supplies quotes/trades/bars, not full equity Level II depth.",
            ),
            MarketDepthProviderCapability(
                provider="polygon",
                configured=polygon_configured,
                equities="top_of_book" if polygon_configured else "none",
                notes="Configured Polygon stock data is used for snapshots/bars where available; no true order book is wired.",
            ),
            MarketDepthProviderCapability(
                provider="databento_or_totalview",
                configured=False,
                equities="none",
                notes="Recommended future adapter slot for true equity depth/order-book levels.",
            ),
        ],
        notes=[
            "The current UI can render depth through this contract, but production data is one-level NBBO.",
            "Use Databento, Nasdaq TotalView, dxFeed, or a broker/vendor Level II feed to populate kind='level_2'.",
        ],
    )
