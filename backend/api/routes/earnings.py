"""/api/v1/earnings/* routes — thin wrappers over services.earnings_screener."""
from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request

from api.routes._rate_limit import (
    check_analysis_rate,
    check_detail_rate,
    check_full_research_rate,
)
from api.schemas.earnings import (
    CalendarResponse,
    ClaudeFullResearch,
    EarningsAnalysis,
    EarningsBacktestRequest,
    EarningsBacktestResponse,
    EarningsDetail,
    NewsArticle,
)
from core.auth import require_auth
from core.http import client_ip
from services import earnings_screener
from services.earnings_backtest import run_event_backtest
from services.earnings_screener import _in_curated_universe

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/earnings", tags=["earnings"])

# Symbol must be 1-6 uppercase letters, optionally followed by a
# dot-letter suffix (BRK.B, BF.B, RDS.A). Anything with slashes, control
# chars, URL-encoded traversal sequences, lowercase, digits, or unusual
# punctuation fails the pattern with a 422 — before the string ever
# touches Redis cache keys or Claude prompts (B-51).
_SYMBOL_PATTERN = r"^[A-Z]{1,6}(\.[A-Z])?$"


def _parse_watchlist_query(raw: str | None) -> tuple[str, ...] | None:
    """Parse the optional comma-separated watchlist query param."""
    if raw is None:
        return None
    symbols: list[str] = []
    seen: set[str] = set()
    for part in raw.split(","):
        symbol = part.strip().upper()
        if not symbol:
            continue
        if not re.fullmatch(_SYMBOL_PATTERN, symbol):
            raise HTTPException(
                status_code=422,
                detail=f"invalid watchlist symbol {symbol!r}",
            )
        if symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    return tuple(symbols)


@router.get("/calendar", response_model=CalendarResponse)
async def get_calendar(
    request: Request,
    window: str = Query("both", pattern="^(current|next|both)$"),
    # Round-7 / BE-4: ``allow_inf_nan=False`` rejects NaN explicitly.
    # Pydantic v2's ``ge``/``le`` constraints on ``float`` accept NaN
    # silently because ``NaN >= 0`` and ``NaN <= 100`` both evaluate
    # to False (the comparison short-circuits to "validator passes" in
    # the absence of an explicit NaN guard). NaN then flowed into the
    # downstream filter ``metrics.iv_rank < min_iv_rank`` where
    # ``< NaN`` is always False, silently disabling the filter —
    # i.e. an attacker (or a bug) could pass ``min_iv_rank=NaN`` to
    # bypass the IV-rank gate. The flag is the canonical Pydantic v2
    # remedy.
    min_iv_rank: float = Query(0, ge=0, le=100, allow_inf_nan=False),
    bmo_amc: str = Query("both", pattern="^(bmo|amc|both)$"),
    watchlist_only: bool = False,
    watchlist: str | None = Query(None, max_length=1024),
    sort: str = Query("date", pattern="^(date|iv_rank|yield|claude_confidence|edge_score)$"),
) -> CalendarResponse:
    # B-33: propagate the real client IP (XFF-aware, so per-IP rate limiters
    # downstream see the caller — not Caddy's address).
    # B-66: `market_cap` query param removed — curated-universe filter is
    # always applied now. Frontend callers need to drop the param too.
    # B-68: emit structured request-boundary logs so Loki / CloudWatch can
    # compute p50/p95 latency, rows-returned distribution, and partial rate
    # without a full metrics library. ``request_id`` short-form so it's
    # greppable in oneliners. The request-id middleware in main.py sets a
    # proper X-Request-ID ContextVar that JsonFormatter picks up
    # automatically; this local id is the structured-log correlation key
    # in case the call is invoked outside a request (tests, bg tasks).
    client_host = client_ip(request)
    request_id = uuid.uuid4().hex[:8]
    t0 = time.perf_counter()
    logger.info(
        "calendar.request.start",
        extra={
            "event": "calendar",
            "stage": "start",
            "request_id": request_id,
            "window": window,
            "bmo_amc": bmo_amc,
            "sort": sort,
            "min_iv_rank": min_iv_rank,
        },
    )
    watchlist_symbols = _parse_watchlist_query(watchlist)
    r = await earnings_screener.list_upcoming(
        window=window, min_iv_rank=min_iv_rank,
        bmo_amc=bmo_amc, watchlist_only=watchlist_only,
        watchlist_symbols=watchlist_symbols, sort=sort,
        client_host=client_host,
    )
    logger.info(
        "calendar.request.end",
        extra={
            "event": "calendar",
            "stage": "end",
            "request_id": request_id,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "rows_returned": len(r.earnings),
            "partial": r.partial,
        },
    )
    return r


@router.post("/backtest", response_model=EarningsBacktestResponse)
async def post_backtest(payload: EarningsBacktestRequest) -> EarningsBacktestResponse:
    result = run_event_backtest(
        [event.model_dump(mode="json") for event in payload.events],
        min_edge_score=payload.min_edge_score,
        max_events=payload.max_events,
        risk_fraction=payload.risk_fraction,
    )
    return EarningsBacktestResponse(**result)


@router.get("/{symbol}/detail", response_model=EarningsDetail)
async def get_detail(
    symbol: Annotated[str, Path(pattern=_SYMBOL_PATTERN)],
    request: Request,
) -> EarningsDetail:
    # Round-4 CLUSTER 2 #6: gate on the curated universe BEFORE we touch
    # any provider. A user crafting a `/api/v1/earnings/ZZZZZ/detail`
    # request would otherwise spend FMP + Alpaca + Claude budget on a
    # symbol we'd never trade.
    sym = symbol.upper()
    if not _in_curated_universe(sym):
        raise HTTPException(
            status_code=404,
            detail=f"symbol {sym!r} not in curated earnings universe",
        )
    # Round-4 CLUSTER 2 #8: per-IP rate limit on /detail. Cheaper than
    # /full-research but still backed by a Claude call on cold cache, so
    # we cap at 30 / 10min per IP. XFF-aware via core.http.client_ip.
    await check_detail_rate(client_ip(request))
    try:
        return await earnings_screener.get_detail(sym)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{symbol}/full-research", response_model=ClaudeFullResearch)
async def post_full_research(
    symbol: Annotated[str, Path(pattern=_SYMBOL_PATTERN)],
    request: Request,
    username: str = Depends(require_auth),
) -> ClaudeFullResearch:
    # Round-4 CLUSTER 2 #6: same curated-universe gate as /detail. The
    # check fires before the rate-limiter so a request for a non-curated
    # symbol doesn't burn a slot in the user's full-research bucket.
    sym = symbol.upper()
    if not _in_curated_universe(sym):
        raise HTTPException(
            status_code=404,
            detail=f"symbol {sym!r} not in curated earnings universe",
        )
    # Validate that the symbol is actually on the current earnings surface
    # before charging the expensive Claude rate bucket. Pre-fix, a provider
    # calendar gap could make AAPL look off-calendar; repeated failed clicks
    # burned the 5-call full-research allowance and then showed a confusing
    # rate-limit popup.
    meta = await earnings_screener._load_earnings_meta(sym)
    if not meta:
        raise HTTPException(
            status_code=404,
            detail=f"symbol {sym!r} has no current earnings candidate",
        )
    cached_full = await earnings_screener.load_cached_full_research(sym, meta=meta)
    if cached_full is not None:
        return cached_full

    # Per-IP rate limit (B-50) — /full-research invokes Opus and costs
    # real money; 5 calls per 10 min is the cap. XFF-aware client IP
    # matters — otherwise Caddy's address buckets every user together
    # and the cap is useless in production.
    await check_full_research_rate(client_ip(request))
    # Round-13 / RD-10 (P1): per-USER rate limit on top of per-IP. A
    # corporate-NAT user can otherwise share the per-IP bucket with all
    # coworkers; a malicious user can spin up multiple IPs (mobile
    # tether, VPN, ipv6 prefix rotation) and burn the daily Claude
    # budget. Hard cap each authenticated user at 10 calls / 10 min,
    # tracked in Redis as ``fullres_user:{username}``. Best-effort: if
    # Redis is unreachable we fall back to per-IP only (preserves UX
    # during a Redis flap rather than locking everyone out).
    try:
        from core.redis import get_redis

        redis = await get_redis()
        if redis:
            user_key = f"fullres_user:{username}:{int(time.time() // 600)}"
            count = await redis.incr(user_key)
            await redis.expire(user_key, 600)
            if int(count) > 10:
                retry_after = max(1, 600 - (int(time.time()) % 600))
                raise HTTPException(
                    status_code=429,
                    detail=(
                        "Per-user rate limit (10 / 10 min) exceeded for "
                        "Claude full-research. Cool down ~10 min — Opus "
                        "calls are billed against the shared daily budget."
                    ),
                    headers={"Retry-After": str(retry_after)},
                )
    except HTTPException:
        raise
    except Exception:
        logger.debug("per-user rate-limit Redis probe failed; allowing", exc_info=True)
    # Round-12 / CL-1 (P1): expand error mapping. Pre-fix, only ValueError
    # was caught — Claude timeouts (``ClaudeTimeoutError`` ≥ 60s),
    # daily-budget kills (``ClaudeBudgetExceeded``), and JSON parse
    # failures all bubbled out as opaque 500s the frontend rendered as
    # a generic spinner-stuck state. Now each maps to a structured
    # response the FE can show as a useful error string.
    from agents.claude_client import ClaudeBudgetExceeded, ClaudeTimeoutError

    try:
        return await earnings_screener.run_full_research(sym, meta=meta)
    except ValueError as e:
        # Curated-universe miss / pre-condition violation.
        raise HTTPException(status_code=404, detail=str(e))
    except ClaudeTimeoutError as e:
        # Exceeded the per-request Claude budget — common on Opus tail.
        raise HTTPException(
            status_code=504,
            detail=(
                "Claude analysis timed out. The model usually returns within "
                "60s; tail latency can stretch past 90s. Retry in ~30s."
            ),
        ) from e
    except ClaudeBudgetExceeded as e:
        # Daily $ cap hit — operator-tunable.
        raise HTTPException(
            status_code=503,
            detail=(
                "Claude analysis is temporarily unavailable: daily cost cap "
                "reached. The cap resets at 00:00 ET."
            ),
        ) from e
    except Exception as e:  # noqa: BLE001
        # Defensive: any other failure mode (Anthropic 5xx, network blip,
        # JSON parse) — log + return a useful 502 instead of generic 500.
        import logging
        logging.getLogger(__name__).error(
            "claude full-research failed for %s",
            sym,
            exc_info=True,
            extra={"event": "claude_full_research_failed", "symbol": sym},
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "Claude analysis failed unexpectedly. Try again — if the "
                "issue persists, check /api/v1/health for upstream status."
            ),
        ) from e


# ─── Batch S: single-round-trip analysis endpoint ────────────
# Earlier the earnings-options-play UI made 9 round-trips per symbol
# (calendar + detail + chain + iv + news + per-expiry chain). This
# endpoint orchestrates the same six upstreams in parallel and returns
# everything the FE needs in one response. Caches 60s per symbol so
# multiple analysts on the same name share the cost.

# 60s in-process per-symbol cache. Keyed on (symbol, setups, news_limit)
# so different param combos don't collide. Single dict with timestamps.
_ANALYSIS_CACHE: dict[str, tuple[float, EarningsAnalysis]] = {}
_ANALYSIS_CACHE_TTL_S: float = 60.0
_ANALYSIS_CACHE_MAX = 256
_ANALYSIS_CACHE_LOCK = asyncio.Lock()


def _analysis_cache_key(symbol: str, setups: int, news_limit: int) -> str:
    return f"{symbol}:{setups}:{news_limit}"


async def _get_cached_analysis(key: str) -> EarningsAnalysis | None:
    async with _ANALYSIS_CACHE_LOCK:
        entry = _ANALYSIS_CACHE.get(key)
        if entry is None:
            return None
        ts, value = entry
        if time.monotonic() - ts > _ANALYSIS_CACHE_TTL_S:
            _ANALYSIS_CACHE.pop(key, None)
            return None
        return value


async def _set_cached_analysis(key: str, value: EarningsAnalysis) -> None:
    async with _ANALYSIS_CACHE_LOCK:
        # Evict expired entries opportunistically before bounding size.
        now = time.monotonic()
        expired = [
            k for k, (ts, _v) in _ANALYSIS_CACHE.items()
            if now - ts > _ANALYSIS_CACHE_TTL_S
        ]
        for k in expired:
            _ANALYSIS_CACHE.pop(k, None)
        # Bound at _ANALYSIS_CACHE_MAX. Drop the oldest entry on overflow.
        while len(_ANALYSIS_CACHE) >= _ANALYSIS_CACHE_MAX:
            oldest = min(_ANALYSIS_CACHE.items(), key=lambda kv: kv[1][0])[0]
            _ANALYSIS_CACHE.pop(oldest, None)
        _ANALYSIS_CACHE[key] = (now, value)


def _reset_analysis_cache_for_tests() -> None:
    """Test-only helper — wipe the in-process analysis cache between cases."""
    _ANALYSIS_CACHE.clear()


def _front_month_chain_summary(chain: Any) -> dict | None:
    """Compact summary of the front-month chain — ATM mids, OTM-30d mids.

    Designed to give the FE just enough to render a "current premium"
    price tile without forcing a full chain fetch.
    """
    if chain is None:
        return None
    contracts = list(getattr(chain, "contracts", []) or [])
    if not contracts:
        return None
    spot = getattr(chain, "spot_price", 0.0) or 0.0
    if spot <= 0:
        return None
    expirations = list(getattr(chain, "expirations", []) or [])
    if not expirations:
        return None
    front = expirations[0]
    if isinstance(front, str):
        try:
            front = date.fromisoformat(front)
        except ValueError:
            return None
    front_contracts = [
        c for c in contracts
        if getattr(c, "expiry", front) == front
    ]
    if not front_contracts:
        # Fall back to all contracts when the chain is shape-normalised
        # to a single expiry without an explicit per-contract expiry.
        front_contracts = contracts

    def _ctype(c: Any) -> str:
        t = getattr(c, "option_type", None)
        return getattr(t, "value", t) or ""

    def _mid(c: Any) -> float:
        bid = float(getattr(c, "bid", 0) or 0)
        ask = float(getattr(c, "ask", 0) or 0)
        last = float(getattr(c, "last", 0) or 0)
        if bid > 0 and ask > 0:
            return (bid + ask) / 2.0
        if bid > 0:
            return bid
        if ask > 0:
            return ask
        return last if last > 0 else 0.0

    calls = [c for c in front_contracts if _ctype(c) == "call"]
    puts = [c for c in front_contracts if _ctype(c) == "put"]
    atm_call = min(calls, key=lambda c: abs(c.strike - spot), default=None)
    atm_put = min(puts, key=lambda c: abs(c.strike - spot), default=None)

    def _by_delta(seq: list[Any], target: float) -> Any | None:
        if not seq:
            return None
        return min(
            seq,
            key=lambda c: abs(abs(float(getattr(c, "delta", 0) or 0)) - abs(target)),
        )

    otm_call_30d = _by_delta(calls, 0.30)
    otm_put_30d = _by_delta(puts, -0.30)
    summary: dict[str, Any] = {
        "expiry": front.isoformat() if isinstance(front, date) else str(front),
        "spot": spot,
    }
    if atm_call is not None:
        summary["atm_call_mid"] = round(_mid(atm_call), 4)
        summary["atm_call_strike"] = float(atm_call.strike)
    if atm_put is not None:
        summary["atm_put_mid"] = round(_mid(atm_put), 4)
        summary["atm_put_strike"] = float(atm_put.strike)
    if otm_call_30d is not None:
        summary["otm_call_30d_mid"] = round(_mid(otm_call_30d), 4)
        summary["otm_call_30d_strike"] = float(otm_call_30d.strike)
    if otm_put_30d is not None:
        summary["otm_put_30d_mid"] = round(_mid(otm_put_30d), 4)
        summary["otm_put_30d_strike"] = float(otm_put_30d.strike)
    return summary


def _quote_payload(quote: Any | None) -> dict[str, Any]:
    """Pull spot, change_pct, and bar fields from a Quote (or dict) safely."""
    if quote is None:
        return {}
    # market.fetch_quote returns a Quote pydantic model. Guard for dicts too.
    if hasattr(quote, "model_dump"):
        d = quote.model_dump()
    elif isinstance(quote, dict):
        d = quote
    else:
        return {}
    return {
        "spot": d.get("last"),
        "spot_change_pct": d.get("changePct", d.get("change_pct")),
        "day_volume": d.get("volume"),
        "day_high": d.get("high"),
        "day_low": d.get("low"),
        "is_demo": bool(d.get("is_demo", False)),
    }


def _iv_term_dict(iv: Any) -> dict[str, float] | None:
    """Term structure as {expiry_iso: atm_iv}. None when no data."""
    if iv is None:
        return None
    raw = getattr(iv, "term_structure", None)
    if not raw:
        return None
    out: dict[str, float] = {}
    for k, v in raw.items():
        try:
            out[str(k)] = float(v)
        except (TypeError, ValueError):
            continue
    return out or None


def _iv_skew_dict(iv: Any) -> dict[str, float] | None:
    if iv is None:
        return None
    raw = getattr(iv, "iv_skew", None)
    if not raw:
        return None
    out: dict[str, float] = {}
    for k, v in raw.items():
        try:
            out[str(k)] = float(v)
        except (TypeError, ValueError):
            continue
    return out or None


def _build_analysis(
    *,
    symbol: str,
    setups_n: int,
    quote_t: Any,
    iv_t: Any,
    meta_t: Any,
    chain_t: Any,
    news_t: Any,
    history_t: Any,
) -> EarningsAnalysis:
    """Pure assembler — turn the gathered upstream results into the
    final EarningsAnalysis pydantic model. No I/O happens here.
    """
    error_codes: list[str] = []

    # ── Quote ──
    quote_obj = None if isinstance(quote_t, Exception) else quote_t
    if isinstance(quote_t, Exception) or quote_obj is None:
        error_codes.append("quote_unavailable")
        quote_fields: dict[str, Any] = {}
    else:
        quote_fields = _quote_payload(quote_obj)

    # ── IV ──
    iv_obj = None if isinstance(iv_t, Exception) else iv_t
    if isinstance(iv_t, Exception) or iv_obj is None:
        error_codes.append("iv_unavailable")
        iv_data: dict[str, Any] = {}
    else:
        iv_data = {
            "current_iv": getattr(iv_obj, "current_iv", None),
            "iv_rank": getattr(iv_obj, "iv_rank", None),
            "iv_percentile": getattr(iv_obj, "iv_percentile", None),
            "hv_20": getattr(iv_obj, "hv_20", None),
            "hv_50": getattr(iv_obj, "hv_50", None),
            "is_demo": bool(getattr(iv_obj, "is_demo", False)),
        }
    iv_to_hv_ratio: float | None = None
    if iv_data.get("current_iv") and iv_data.get("hv_20"):
        try:
            ratio = float(iv_data["current_iv"]) / float(iv_data["hv_20"])
            iv_to_hv_ratio = ratio if ratio > 0 else None
        except (TypeError, ValueError, ZeroDivisionError):
            iv_to_hv_ratio = None

    # ── Calendar entry (meta) ──
    meta = None if isinstance(meta_t, Exception) else meta_t
    if isinstance(meta_t, Exception):
        error_codes.append("calendar_unavailable")
    if not meta:
        error_codes.append("no_calendar_entry")
    next_report_date: date | None = None
    when: str | None = None
    days_until: int | None = None
    sector: str | None = None
    company: str | None = None
    expected_move_pct: float | None = None
    expected_move_dollars: float | None = None
    hist_avg_abs: float | None = None
    edge_score: float | None = None
    edge_score_components: dict[str, float] | None = None
    premium_yield_call: float | None = None
    premium_yield_put: float | None = None
    claude_verdict = None
    claude_confidence = None
    claude_thesis = None
    claude_thesis_at = None
    claude_pending = True
    if isinstance(meta, dict):
        rd = meta.get("report_date")
        if isinstance(rd, str):
            try:
                next_report_date = date.fromisoformat(rd)
            except ValueError:
                next_report_date = None
        elif isinstance(rd, date):
            next_report_date = rd
        rt = meta.get("report_time")
        if rt:
            when = rt.lower() if isinstance(rt, str) else None
        sector = meta.get("sector")
        company = meta.get("company")
        # Hydrated rows include enriched fields; if upstream returned only
        # a raw FMP row these stay None.
        expected_move_pct = meta.get("expected_move_pct")
        if (
            expected_move_pct is not None
            and quote_fields.get("spot")
        ):
            try:
                expected_move_dollars = float(expected_move_pct) * float(
                    quote_fields["spot"]
                )
            except (TypeError, ValueError):
                expected_move_dollars = None
        hist_avg_abs = meta.get("hist_avg_abs_move_pct")
        edge_score = meta.get("edge_score")
        edge_score_components = meta.get("edge_score_components") or None
        premium_yield_call = meta.get("premium_yield_call_atm")
        premium_yield_put = meta.get("premium_yield_put_atm")
        claude_verdict = meta.get("claude_verdict")
        claude_confidence = meta.get("claude_confidence")
        if next_report_date:
            from services.earnings_screener import market_today
            try:
                days_until = (next_report_date - market_today()).days
            except Exception:
                days_until = None

    implied_vs_hist: float | None = None
    if expected_move_pct is not None and hist_avg_abs:
        try:
            implied_vs_hist = float(expected_move_pct) / float(hist_avg_abs)
        except (TypeError, ValueError, ZeroDivisionError):
            implied_vs_hist = None

    implied_breakevens: tuple[float, float] | None = None
    if (
        expected_move_dollars is not None
        and quote_fields.get("spot")
    ):
        try:
            spot = float(quote_fields["spot"])
            em = float(expected_move_dollars)
            implied_breakevens = (spot - em, spot + em)
        except (TypeError, ValueError):
            implied_breakevens = None

    # ── Chain ──
    chain_obj = None if isinstance(chain_t, Exception) else chain_t
    if isinstance(chain_t, Exception):
        error_codes.append("chain_unavailable")
    chain_expirations: list[date] | None = None
    front_summary: dict | None = None
    if chain_obj is not None:
        raw_exps = getattr(chain_obj, "expirations", None) or []
        parsed: list[date] = []
        for e in raw_exps:
            if isinstance(e, date):
                parsed.append(e)
            elif isinstance(e, str):
                try:
                    parsed.append(date.fromisoformat(e))
                except ValueError:
                    continue
        chain_expirations = parsed or None
        if not chain_expirations:
            error_codes.append("no_chain")
        front_summary = _front_month_chain_summary(chain_obj)
    else:
        error_codes.append("no_chain")

    # ── News ──
    news_articles: list[NewsArticle] | None = None
    if isinstance(news_t, Exception):
        error_codes.append("news_unavailable")
    elif news_t is None:
        news_articles = None
    else:
        # news_t is a list[NewsArticle]-ish or list[str] depending on the
        # call. We expect the structured payload from _news_payload.
        try:
            built: list[NewsArticle] = []
            for n in news_t or []:
                if isinstance(n, NewsArticle):
                    built.append(n)
                elif isinstance(n, dict):
                    try:
                        built.append(NewsArticle(**n))
                    except Exception:
                        continue
            news_articles = built or None
        except Exception:
            news_articles = None
            error_codes.append("news_unavailable")

    # ── Prior moves history ──
    prior_moves: list[dict] | None = None
    if isinstance(history_t, Exception):
        error_codes.append("history_unavailable")
    elif isinstance(history_t, dict):
        quarters = history_t.get("quarters") or []
        if quarters:
            mapped: list[dict] = []
            for q in quarters:
                rd = q.get("report_date")
                rd_str = (
                    rd.isoformat() if hasattr(rd, "isoformat") else str(rd)
                    if rd is not None else None
                )
                mapped.append({
                    "date": rd_str,
                    "move_pct": q.get("next_day_move_pct"),
                    "five_day_move_pct": q.get("five_day_move_pct"),
                    "surprise_pct": q.get("surprise_pct"),
                })
            prior_moves = mapped
            if hist_avg_abs is None:
                stats = history_t.get("stats") or {}
                hist_avg_abs = stats.get("avg_abs_move_pct")

    # ── Top setups (pulled from the calendar row when available) ──
    top_setups = None
    if isinstance(meta, dict):
        raw_setups = meta.get("top_setups") or []
        if raw_setups:
            from api.schemas.earnings import EarningsSetup as _ES
            built_setups: list = []
            for s in raw_setups:
                if isinstance(s, _ES):
                    built_setups.append(s)
                elif isinstance(s, dict):
                    try:
                        built_setups.append(_ES(**s))
                    except Exception:
                        continue
            if built_setups:
                top_setups = built_setups[:setups_n]

    # ── Claude thesis ──
    if claude_verdict is not None or claude_confidence is not None:
        claude_pending = False

    # ── Demo flag (any upstream is_demo flips the bit) ──
    is_demo = bool(
        quote_fields.get("is_demo")
        or iv_data.get("is_demo")
        or (chain_obj is not None and getattr(chain_obj, "is_demo", False))
    )

    return EarningsAnalysis(
        symbol=symbol,
        fetched_at=datetime.now(timezone.utc),
        is_demo=is_demo,
        spot=quote_fields.get("spot"),
        spot_change_pct=quote_fields.get("spot_change_pct"),
        day_volume=quote_fields.get("day_volume"),
        day_high=quote_fields.get("day_high"),
        day_low=quote_fields.get("day_low"),
        next_report_date=next_report_date,
        when=when,
        days_until=days_until,
        sector=sector,
        company=company,
        current_iv=iv_data.get("current_iv"),
        iv_rank=iv_data.get("iv_rank"),
        iv_percentile=iv_data.get("iv_percentile"),
        hv_20=iv_data.get("hv_20"),
        hv_50=iv_data.get("hv_50"),
        iv_to_hv_ratio=iv_to_hv_ratio,
        iv_term=_iv_term_dict(iv_obj),
        iv_skew=_iv_skew_dict(iv_obj),
        expected_move_pct=expected_move_pct,
        expected_move_dollars=expected_move_dollars,
        implied_breakevens=implied_breakevens,
        historical_avg_abs_move_pct=hist_avg_abs,
        implied_vs_historical_ratio=implied_vs_hist,
        premium_yield_call_atm=premium_yield_call,
        premium_yield_put_atm=premium_yield_put,
        prior_moves=prior_moves,
        claude_verdict=claude_verdict,
        claude_confidence=claude_confidence,
        claude_thesis=claude_thesis,
        claude_thesis_at=claude_thesis_at,
        claude_pending=claude_pending,
        edge_score=edge_score,
        edge_score_components=edge_score_components,
        top_setups=top_setups,
        news=news_articles,
        chain_expirations=chain_expirations,
        front_month_chain_summary=front_summary,
        error_codes=error_codes,
    )


_ANALYSIS_DESC = """\
Single-round-trip earnings analysis for a symbol — orchestrates quote,
IV analysis, calendar entry, full chain, recent news, and prior-quarter
historical earnings moves in parallel. Replaces 9 separate calls the
earnings-options-play UI used to make per symbol.

The response is **partially-tolerant**: any single upstream may flake
without 500ing the response. The `error_codes` list and per-block null
fields tell the caller exactly which subsystems were unavailable.

Cached for 60 seconds per (symbol, setups, news_limit) tuple.
Rate-limited to 30/min per IP and 100/min globally to protect the
shared Claude budget. Response includes recommended top-N setups via
the Batch Q recommendation engine."""


@router.get(
    "/{symbol}/analysis",
    response_model=EarningsAnalysis,
    summary="Single-round-trip earnings analysis",
    description=_ANALYSIS_DESC,
    response_model_exclude_none=False,
)
async def get_analysis(
    symbol: Annotated[str, Path(pattern=_SYMBOL_PATTERN)],
    request: Request,
    setups: int = Query(
        3, ge=1, le=5,
        description="Number of top recommended setups to return (1-5).",
    ),
    news_limit: int = Query(
        5, ge=0, le=20,
        description="How many news articles to include (0-20).",
    ),
) -> EarningsAnalysis:
    sym = symbol.upper()

    # Curated-universe gate (same as /detail and /full-research). A
    # non-curated symbol short-circuits to 404 BEFORE any upstream is
    # touched, so a hostile request for ``/api/v1/earnings/ZZZZZ/analysis``
    # cannot burn FMP/Alpaca/Newsdata budget.
    if not _in_curated_universe(sym):
        raise HTTPException(
            status_code=404,
            detail=f"symbol {sym!r} not in curated earnings universe",
        )

    # Per-IP + global rate limit. Claude calls behind the curtain are
    # $0.30 each on cache miss; the global cap protects the daily budget.
    await check_analysis_rate(client_ip(request))

    cache_key = _analysis_cache_key(sym, setups, news_limit)
    cached = await _get_cached_analysis(cache_key)
    if cached is not None:
        logger.debug(
            "analysis cache hit for %s",
            sym,
            extra={"event": "earnings_analysis", "stage": "cache_hit", "symbol": sym},
        )
        return cached

    request_id = uuid.uuid4().hex[:8]
    t0 = time.perf_counter()
    logger.info(
        "earnings_analysis.request.start",
        extra={
            "event": "earnings_analysis",
            "stage": "start",
            "request_id": request_id,
            "symbol": sym,
            "setups": setups,
            "news_limit": news_limit,
        },
    )

    # Lazy imports — keep the module import cheap and avoid circular deps.
    from services import news as news_service
    from services import options as options_service
    from services.earnings_screener import (
        _load_earnings_meta,
        _load_historical_earnings,
        _load_quote,
    )
    from services.market import fetch_quote
    from services.options import fetch_chain, fetch_iv_analysis

    async def _safe_meta() -> dict | None:
        """Pull the calendar row, hydrating quote/IV/recommender so the
        analysis response carries top_setups + edge_score + claude bits.

        Falls back to the raw FMP row when hydration fails so we still
        emit the report_date / sector / company even with degraded vol.
        """
        meta = await _load_earnings_meta(sym)
        if not meta:
            return None
        # Hydrate to enrich the row with edge_score / top_setups / claude.
        from services.earnings_screener import _hydrate_row, market_today
        try:
            hydrated = await _hydrate_row(meta, today=market_today())
            return hydrated or meta
        except Exception:
            logger.debug("analysis: hydrate_row failed for %s", sym, exc_info=True)
            return meta

    async def _safe_history() -> dict | None:
        # The historical-earnings fetch needs a report date. If we don't
        # have one, default to today so the lookback still spans 8
        # quarters — better than no history at all on stub-meta cases.
        try:
            meta_quick = await _load_earnings_meta(sym)
        except Exception:
            meta_quick = None
        report_date_obj = None
        if meta_quick and isinstance(meta_quick.get("report_date"), str):
            try:
                report_date_obj = date.fromisoformat(meta_quick["report_date"])
            except ValueError:
                report_date_obj = None
        if report_date_obj is None:
            report_date_obj = date.today()
        return await _load_historical_earnings(sym, report_date_obj)

    async def _safe_news() -> list[NewsArticle] | None:
        if news_limit <= 0:
            return []
        try:
            resp = await news_service.fetch_symbol_news(sym, limit=news_limit)
        except Exception:
            return None
        # Convert to schema-side NewsArticle (dt-typed published_at). The
        # service-side ``NewsArticle.published_at`` is a string; the
        # schema-side one is a datetime. _parse_news_datetime handles
        # the common formats; pre-parsed datetimes pass through unchanged.
        articles: list[NewsArticle] = []
        from services.earnings_screener import _parse_news_datetime
        for a in resp.articles[:news_limit]:
            if not a.url:
                continue
            raw_pub = a.published_at
            if isinstance(raw_pub, datetime):
                pub_dt = raw_pub
            elif isinstance(raw_pub, str):
                pub_dt = _parse_news_datetime(raw_pub)
            else:
                pub_dt = datetime.now(timezone.utc)
            try:
                articles.append(NewsArticle(
                    title=a.title,
                    source=a.source,
                    published_at=pub_dt,
                    url=a.url,
                    relevance_score=getattr(a, "relevance_score", 0.0) or 0.0,
                    category=getattr(a, "category", None),
                    tier=getattr(a, "tier", 2) or 2,
                    sentiment=getattr(a, "sentiment", None),
                ))
            except Exception:
                continue
        return articles

    quote_t, iv_t, meta_t, chain_t, news_t, history_t = await asyncio.gather(
        fetch_quote(sym),
        fetch_iv_analysis(sym),
        _safe_meta(),
        fetch_chain(sym),
        _safe_news(),
        _safe_history(),
        return_exceptions=True,
    )

    # Log per-task failures for observability — partial degradation
    # should not 500 the response, but oncall wants to see the trail.
    for label, result in (
        ("quote", quote_t), ("iv", iv_t), ("meta", meta_t),
        ("chain", chain_t), ("news", news_t), ("history", history_t),
    ):
        if isinstance(result, Exception):
            logger.warning(
                "earnings_analysis.upstream_failure",
                extra={
                    "event": "earnings_analysis",
                    "stage": "upstream_failure",
                    "request_id": request_id,
                    "symbol": sym,
                    "upstream": label,
                    "error": str(result),
                },
            )

    analysis = _build_analysis(
        symbol=sym,
        setups_n=setups,
        quote_t=quote_t,
        iv_t=iv_t,
        meta_t=meta_t,
        chain_t=chain_t,
        news_t=news_t,
        history_t=history_t,
    )
    await _set_cached_analysis(cache_key, analysis)

    logger.info(
        "earnings_analysis.request.end",
        extra={
            "event": "earnings_analysis",
            "stage": "end",
            "request_id": request_id,
            "symbol": sym,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "error_codes": analysis.error_codes,
            "is_demo": analysis.is_demo,
            "claude_pending": analysis.claude_pending,
            "top_setups_count": len(analysis.top_setups) if analysis.top_setups else 0,
        },
    )
    return analysis
