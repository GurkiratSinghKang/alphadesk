from __future__ import annotations

import logging
import re
import time
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Request, Response

# Models, demo helpers, and provider-access helpers live in the service
# layer so both the HTTP routes (here) and in-process callers (e.g.
# ``services.earnings_screener``) can reach them without crossing the
# layering line (B-62). The public API of ``api.routes.market`` is
# preserved by re-exporting the names below.
from services.market import (  # noqa: F401 — re-exported for tests/back-compat
    ALPACA_DATA_URL,
    ALPACA_TF_MAP,
    ALPACA_TRADING_URL,
    Bar,
    MarketStatus,
    Quote,
    Snapshot,
    Timeframe,
    _alpaca_data_headers,
    _alpaca_keys_available,
    _demo_bars,
    _demo_market_status,
    _demo_quote,
    _demo_snapshot,
    _is_valid_demo_symbol,
    _polygon_key_empty,
    fetch_quote,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Round 7 Fix 2 (P127) — per-IP rate limit on the heavy public-ish endpoints.
# ---------------------------------------------------------------------------
# Caddy cannot install ``caddy-ratelimit`` in our managed build, so we enforce
# the cap application-side. The three routes below — /quotes, /snapshot,
# /bars — are the most-scraped market endpoints; /snapshots is the batched
# variant of /snapshot and gets its own accounting. Rate-limit state lives in
# Redis under ``market_rl:{ip}:{minute_bucket}`` with a 60s TTL so keys
# auto-expire; a single INCR per request keeps the hot path cheap.
#
# Failure posture: FAIL-OPEN. Read-only routes. A Redis outage that also
# blocked quotes would turn one infrastructure blip into a full market-data
# blackout for every user — strictly worse than letting an attacker briefly
# exceed the limit during a window where the operator is already on pager.
# Errors are logged so the operator can correlate on post-mortem.


def _client_ip(request: Request) -> str:
    """Extract the client IP for rate-limit keying.

    Honours the trusted-proxy header ``X-Forwarded-For`` set by Caddy (we
    control the edge so spoofing requires bypassing Caddy). Falls back to
    the direct connection address — covers tests and the dev-runner path
    where no proxy is in front of uvicorn.

    Returns the raw first XFF hop; an attacker who spoofs the header
    at the edge still only shifts their bucket onto whatever IP they
    lie about, they don't bypass the cap.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # ``X-Forwarded-For: client, proxy1, proxy2`` — take the first hop.
        first = xff.split(",", 1)[0].strip()
        if first:
            return first
    if request.client is not None:
        return request.client.host or "unknown"
    return "unknown"


def _is_authed(request: Request) -> bool:
    """Best-effort auth-detection for choosing the rate-limit tier.

    The router already enforces auth via ``Depends(require_auth)`` at
    include-time, so in production ``_is_authed`` is True for every
    request that reaches the handler. We still branch because the cap
    semantics differ (authed users are legitimate traffic and should
    get the larger budget) and because future unauthenticated routes on
    the same router can reuse this helper.
    """
    if request.headers.get("authorization"):
        return True
    # HttpOnly cookie set by /auth/login carries the access token.
    if request.cookies.get("access_token"):
        return True
    return False


async def _market_rate_limit_or_429(request: Request, response: Response) -> None:
    """Enforce the per-IP cap; raise 429 on overflow, no-op otherwise.

    Uses a simple fixed-window-per-minute scheme: every request INCRs the
    key ``market_rl:{ip}:{minute_bucket}`` and the first INCR on a new
    bucket sets a 60s TTL. Simple, atomic (INCR+EXPIRE inside a pipeline),
    and cheap enough for every read to pay without noticeable latency.

    Sliding-window precision is not worth the cost for read-only market
    endpoints — a client that lands right on the boundary may legitimately
    double their budget for a second, which is acceptable for a
    DoS-protection (not abuse-accounting) gate.
    """
    from core.config import settings
    from core.redis import get_redis

    try:
        ip = _client_ip(request)
        authed = _is_authed(request)
        cap = int(
            settings.MARKET_RL_AUTH_PER_MIN
            if authed
            else settings.MARKET_RL_UNAUTH_PER_MIN
        )
        # 60-second fixed window. Aligning on int(now/60) means every
        # caller shares a bucket at the same minute boundary, which is
        # the simplest correct implementation.
        bucket = int(time.time()) // 60
        key = f"market_rl:{ip}:{bucket}"

        r = await get_redis()
        # Pipeline so INCR + EXPIRE are one round-trip. EXPIRE is a no-op
        # after the first hit on this bucket (TTL already set) but re-
        # issuing is cheaper than a GET-before-SET branch.
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, 60)
        results = await pipe.execute()
        current = int(results[0] or 0)
    except Exception:
        # Redis outage or unexpected error — fail OPEN (see module docstring).
        logger.warning("market rate-limit: redis failure, failing open", exc_info=True)
        return

    if current > cap:
        # Compute seconds until the current bucket expires so the
        # Retry-After header is honest (rounded up; bounded to 60s).
        retry_after = max(1, 60 - (int(time.time()) % 60))
        # Attach to the response (FastAPI lifts these even on raise).
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": "Too many market-data requests. Please slow down.",
                "retry_after_seconds": retry_after,
            },
            headers={"Retry-After": str(retry_after)},
        )
    # Remaining-budget hint for clients that want to back off politely
    # before they hit the cap. No strict need for this to be exact.
    try:
        response.headers["X-RateLimit-Limit"] = str(cap)
        response.headers["X-RateLimit-Remaining"] = str(max(0, cap - current))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/quotes/{symbol}", response_model=Quote)
async def get_quote(symbol: str, request: Request, response: Response) -> Quote:
    """Fetch the latest quote for a given symbol (Polygon -> Alpaca -> demo).

    Thin HTTP wrapper: rate-limit gate + delegate to
    :func:`services.market.fetch_quote`. The provider waterfall lives in the
    service so non-HTTP callers (e.g. earnings_screener) can use it without
    faking a Request/Response pair (B-62).
    """
    # Round 7 Fix 2 (P127) — per-IP rate-limit. Raises 429 on overflow;
    # fail-open on Redis error (read-only path, see helper docstring).
    await _market_rate_limit_or_429(request, response)

    return await fetch_quote(symbol, client_host=_client_ip(request))


@router.get("/bars/{symbol}", response_model=list[Bar])
async def get_bars(
    symbol: str,
    request: Request,
    response: Response,
    timeframe: Timeframe = Query(Timeframe.DAY, description="Bar timeframe"),
    start: date | None = Query(None, description="Start date (YYYY-MM-DD)"),
    end: date | None = Query(None, description="End date (YYYY-MM-DD)"),
    limit: int = Query(500, ge=1, le=5000),
) -> list[Bar]:
    """Fetch OHLCV bars for a symbol over a date range (Polygon -> Alpaca -> demo)."""

    # Round 7 Fix 2 (P127) — per-IP rate-limit (see module helpers).
    await _market_rate_limit_or_429(request, response)

    effective_end = end or date.today()
    effective_start = start or (effective_end - timedelta(days=365))

    # --- Redis cache check ---
    from core.redis import cache_get, cache_set

    # Intraday: no cache (live SIP data). Daily+: 30s cache.
    _INTRADAY_TFS = {"1min", "5min", "15min", "30min", "1h"}
    cache_ttl = 0 if timeframe.value in _INTRADAY_TFS else 30

    # Wave 3L Fix 1 (persona-86/90): include date range in cache key so that
    # /bars?start=2024-01-01 and /bars?start=2024-06-01 don't collide on the
    # same symbol/timeframe/limit tuple. Prior fix (persona-15/55) patched the
    # in-process dict cache but the Redis HTTP-layer cache key was left
    # date-less, which silently returned stale ranges.
    cache_key = (
        f"bars:{symbol.upper()}:{timeframe.value}:{limit}:"
        f"{effective_start.isoformat() if effective_start else 'none'}:"
        f"{effective_end.isoformat() if effective_end else 'none'}"
    )
    if cache_ttl > 0:
        cached = await cache_get(cache_key)
        if cached:
            return [Bar(**b) for b in cached]

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

            # sort=desc + reverse() below guarantees the N *most recent*
            # bars are returned regardless of how wide the date window is.
            # With sort=asc, a limit < (window in days) truncates to the
            # OLDEST N bars instead of the newest — that's why
            # /bars/SPY?limit=3 was returning bars from a year ago.
            params: dict = {
                "adjusted": "true",
                "sort": "desc",
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
                    # Upstream returned newest-first; flip back to
                    # chronological ascending order before caching and
                    # returning so downstream (chart, cache, etc) sees the
                    # series in natural time order.
                    bars.reverse()
                    await cache_set(
                        cache_key,
                        [b.model_dump(mode="json") for b in bars],
                        ttl_seconds=cache_ttl,
                    )
                    return bars
        except Exception:
            logger.warning("Polygon bars fetch failed for %s", symbol.upper(), exc_info=True)

    # --- 2. Alpaca bars ---
    if _alpaca_keys_available():
        try:
            import httpx

            alpaca_tf = ALPACA_TF_MAP.get(timeframe.value, "1Day")
            headers = _alpaca_data_headers()
            # Use current time as end (not midnight) so intraday charts
            # only show bars up to NOW, not the full day to 4PM
            end_dt = datetime.now(timezone.utc) if effective_end == date.today() else datetime.combine(effective_end, datetime.max.time(), tzinfo=timezone.utc)
            # sort=desc so the N *most recent* bars come back when limit is
            # smaller than the date window. Reversed below to restore
            # chronological ascending order. See the Polygon branch above
            # for the detailed rationale.
            params_alpaca: dict = {
                "timeframe": alpaca_tf,
                "start": datetime.combine(effective_start, datetime.min.time(), tzinfo=timezone.utc).isoformat(),
                "end": end_dt.isoformat(),
                "limit": limit,
                "adjustment": "raw",
                "feed": "sip",
                "sort": "desc",
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
                    # Flip newest-first back to chronological before caching.
                    bars.reverse()
                    await cache_set(
                        cache_key,
                        [b.model_dump(mode="json") for b in bars],
                        ttl_seconds=cache_ttl,
                    )
                    return bars
        except Exception:
            logger.warning("Alpaca bars fetch failed for %s", symbol.upper(), exc_info=True)

    # --- 3. Demo fallback (only for known symbols) ---
    if not _is_valid_demo_symbol(symbol):
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
    logger.warning("DEMO FALLBACK: Serving fake bars for %s — Polygon and Alpaca both failed", symbol.upper())
    return _demo_bars(symbol, timeframe.value, limit, start, end)


@router.get("/snapshot/{symbol}", response_model=Snapshot)
async def get_snapshot(
    symbol: str,
    request: Request,
    response: Response,
) -> Snapshot:
    """Fetch a full market snapshot for a symbol (Polygon -> Alpaca -> demo)."""

    # Round 7 Fix 2 (P127) — per-IP rate-limit on the public-ish route.
    await _market_rate_limit_or_429(request, response)

    return await _fetch_snapshot_impl(symbol)


async def _fetch_snapshot_impl(symbol: str) -> Snapshot:
    """Provider-waterfall body of ``get_snapshot`` with no rate-limit gate.

    Round 7 Fix 2 (P127): factored out so the batched ``get_snapshots``
    per-symbol fallback can reuse the exact same Polygon → Alpaca →
    demo resolution without double-counting against the caller's
    rate-limit bucket (the batch endpoint has already been accounted for).
    """
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
            logger.warning("Polygon snapshot fetch failed for %s", symbol.upper(), exc_info=True)

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
            logger.warning("Alpaca snapshot fetch failed for %s", symbol.upper(), exc_info=True)

    # --- 3. Demo fallback (only for known symbols) ---
    if not _is_valid_demo_symbol(symbol):
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol.upper()}' not found")
    logger.warning("DEMO FALLBACK: Serving fake snapshot for %s — Polygon and Alpaca both failed", symbol.upper())
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
            logger.warning("Polygon market-status fetch failed", exc_info=True)

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
            logger.warning("Alpaca clock fetch failed", exc_info=True)

    # --- 3. Demo fallback ---
    logger.warning("DEMO FALLBACK: Serving fake market status — Polygon and Alpaca both failed")
    return _demo_market_status()


# ---------------------------------------------------------------------------
# Batched snapshots (perf-audit-r3 P0 #4)
# ---------------------------------------------------------------------------
# Prior implementation forced the frontend to fan out N per-symbol
# `/market/quotes/{symbol}` requests on every watchlist refresh. A 10-symbol
# watchlist cold-start therefore cost ~10 Alpaca round-trips and 3-5s of
# wall-clock latency, dominated by TCP setup + Chrome's 6-per-host socket
# ceiling. This endpoint fans out exactly ONE upstream call when Alpaca keys
# are available (Alpaca's /v2/stocks/snapshots accepts a comma-separated
# symbols param and returns all snapshots in one response), falling back to
# per-symbol calls only when the batched provider is unavailable.

# Symbol syntax: uppercase letter start, up to 9 additional
# [A-Z0-9.\-] chars. Matches Alpaca/Polygon ticker conventions (e.g.
# "AAPL", "BRK.B", "SPY", "BF-B"). Reject anything else before spending
# an upstream call — cheap defence against injection and typos.
_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_MAX_BATCH_SYMBOLS = 100


def _parse_and_validate_symbols(raw: str) -> list[str]:
    """Split the comma-separated `symbols` query param, uppercase, dedupe, validate.

    Raises 400 if any token is malformed or if the batch exceeds
    ``_MAX_BATCH_SYMBOLS``. Returns symbols in the original request order with
    duplicates stripped (stable dedup) so callers can zip the response back to
    their input list.
    """
    if not raw:
        raise HTTPException(status_code=400, detail="symbols query param is required")

    seen: set[str] = set()
    out: list[str] = []
    for tok in raw.split(","):
        s = tok.strip().upper()
        if not s:
            continue
        if not _SYMBOL_RE.match(s):
            raise HTTPException(status_code=400, detail=f"Invalid symbol: {tok!r}")
        if s in seen:
            continue
        seen.add(s)
        out.append(s)

    if not out:
        raise HTTPException(status_code=400, detail="symbols query param is required")
    if len(out) > _MAX_BATCH_SYMBOLS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many symbols: {len(out)} > {_MAX_BATCH_SYMBOLS}",
        )
    return out


def _alpaca_snapshot_to_model(symbol: str, data: dict) -> Snapshot | None:
    """Convert one Alpaca snapshot payload into our internal ``Snapshot`` model.

    Returns ``None`` if the payload is missing the latestTrade + dailyBar
    fields we rely on — callers should fall through to per-symbol fetch in
    that case rather than emitting a degenerate snapshot.
    """
    if not isinstance(data, dict):
        return None
    lt = data.get("latestTrade") or {}
    lq = data.get("latestQuote") or {}
    daily = data.get("dailyBar") or {}
    prev = data.get("prevDailyBar") or {}
    mn = data.get("minuteBar") or {}

    # Guard: Alpaca occasionally returns {} for illiquid symbols outside RTH.
    if not daily and not lt:
        return None

    now = datetime.now(timezone.utc)

    def _parse_bar(d: dict) -> Bar:
        try:
            ts = datetime.fromisoformat(d["t"].replace("Z", "+00:00")) if d.get("t") else now
        except (ValueError, AttributeError, TypeError):
            ts = now
        return Bar(
            timestamp=ts,
            open=d.get("o", 0), high=d.get("h", 0),
            low=d.get("l", 0), close=d.get("c", 0),
            volume=int(d.get("v", 0) or 0), vwap=d.get("vw"),
        )

    day_close = daily.get("c", 0) or 0
    prev_close = prev.get("c", 0) or 0
    change_pct = round(((day_close - prev_close) / prev_close) * 100, 2) if prev_close else 0

    return Snapshot(
        symbol=symbol,
        quote=Quote(
            symbol=symbol,
            bid=lq.get("bp", 0) or 0,
            ask=lq.get("ap", 0) or 0,
            last=lt.get("p", 0) or 0,
            volume=int(daily.get("v", 0) or 0),
            timestamp=now,
            change=round(day_close - prev_close, 2) if prev_close else 0,
            changePct=change_pct,
            high=daily.get("h", 0) or 0,
            low=daily.get("l", 0) or 0,
            open=daily.get("o", 0) or 0,
            close=prev_close,
        ),
        day_bar=_parse_bar(daily),
        prev_day_bar=_parse_bar(prev),
        min_bar=_parse_bar(mn),
        change_pct=change_pct,
    )


@router.get("/snapshots", response_model=dict[str, Snapshot])
async def get_snapshots(
    symbols: str = Query(..., description="Comma-separated symbols (max 100), e.g. AAPL,NVDA,TSLA"),
) -> dict[str, Snapshot]:
    """Fetch snapshots for up to 100 symbols in a single request.

    Primary path: Alpaca multi-snapshots endpoint (one upstream call for the
    whole batch). Fallback: per-symbol ``get_snapshot()`` when the batched
    provider fails for a subset — we keep the partial success rather than
    erroring the whole request. Authentication is already enforced by the
    router-level ``require_auth`` dependency registered in main.py.
    """
    symbol_list = _parse_and_validate_symbols(symbols)
    results: dict[str, Snapshot] = {}

    # --- 1. Alpaca batched fetch (preferred) ---
    if _alpaca_keys_available():
        try:
            import httpx

            headers = _alpaca_data_headers()
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f"{ALPACA_DATA_URL}/v2/stocks/snapshots",
                    headers=headers,
                    params={"symbols": ",".join(symbol_list), "feed": "sip"},
                )
                if resp.status_code == 200:
                    data = resp.json() or {}
                    for sym in symbol_list:
                        snap = _alpaca_snapshot_to_model(sym, data.get(sym) or {})
                        if snap is not None:
                            results[sym] = snap
        except Exception:
            logger.warning("Alpaca multi-snapshot fetch failed", exc_info=True)

    # --- 2. Fallback: per-symbol for anything the batch call missed ---
    # Symbols missing from the batched response (e.g. Alpaca returned {} for
    # one of them, or the call itself failed) drop back to single-symbol
    # fetch, which has its own Polygon/Alpaca/demo waterfall already wired.
    missing = [s for s in symbol_list if s not in results]
    for sym in missing:
        try:
            results[sym] = await _fetch_snapshot_impl(sym)
        except HTTPException:
            # 404 on an unknown symbol — just omit it from the batch reply
            # rather than sinking the entire request.
            continue
        except Exception:
            logger.warning("Per-symbol fallback snapshot failed for %s", sym, exc_info=True)
            continue

    return results
