"""Earnings Options Play aggregator — pulls FMP earnings, Alpaca options
chain + IV, Newsdata news, and Claude structured/full analysis into one
response shape. Routes in `api/routes/earnings.py` are thin wrappers.

This module contains:
  • pure-function helpers (expected move, historical stats) — Task 5
  • the main aggregators `list_upcoming`, `get_detail`, `run_full_research`
    — Task 8
  • Claude prompt assembly delegated to `services.earnings_prompts` — Task 6
"""
from __future__ import annotations

import asyncio
import logging
import math
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping, Sequence

log = logging.getLogger(__name__)


# ─── Pure helpers ────────────────────────────────────────────

def compute_expected_move_from_straddle(
    *, underlying: float, call_mid: float, put_mid: float
) -> float | None:
    """Expected move % = ATM straddle mid / underlying price.

    Returns None if underlying is zero (guard against bad quote data).
    Returns 0.0 (not None) when both legs are zero — legit low-IV state.
    """
    if underlying <= 0:
        return None
    return (call_mid + put_mid) / underlying


def compute_historical_stats(quarters: Sequence[Mapping]) -> dict:
    """Roll up per-quarter earnings history into screener summary stats.

    `quarters` is a list of dicts with keys: report_date, surprise_pct,
    next_day_move_pct, five_day_move_pct. Any subset is tolerated — missing
    keys contribute 0 where applicable.
    """
    if not quarters:
        return {
            "avg_abs_move_pct": 0.0,
            "wins": 0,
            "losses": 0,
            "surprise_beat_rate": 0.0,
        }
    moves = [q.get("next_day_move_pct", 0.0) for q in quarters]
    abs_moves = [abs(m) for m in moves]
    wins = sum(1 for m in moves if m > 0)
    losses = sum(1 for m in moves if m < 0)
    surprises = [q.get("surprise_pct") for q in quarters]
    beats = sum(1 for s in surprises if s is not None and s > 0)
    total_with_surprise = sum(1 for s in surprises if s is not None)
    beat_rate = beats / total_with_surprise if total_with_surprise else 0.0
    # Use half-up rounding for avg_abs_move_pct so display-level assertions
    # on round(x, 4) behave predictably (Python's built-in round() uses
    # half-even / banker's rounding, which produces surprising results on
    # exact midpoints like 0.06175).
    raw_avg = sum(abs_moves) / len(abs_moves)
    avg = math.floor(raw_avg * 10_000 + 0.5) / 10_000
    return {
        "avg_abs_move_pct": avg,
        "wins": wins,
        "losses": losses,
        "surprise_beat_rate": beat_rate,
    }


# ─── Schemas (local imports kept at call sites for lighter boot) ──

from api.schemas.earnings import (  # noqa: E402 — after helpers by design
    CalendarResponse,
    CalendarRow,
    ClaudeFullResearch,
    ClaudeStructured,
    EarningsDetail,
    IVTermPoint,
    MetricsBlock,
    NewsArticle,
    QuoteBlock,
    SkewBlock,
    StrikeLadder,
)


# Map FMP's announcement_when field (lowercase amc/bmo/unknown) → our
# ReportTime literal (BMO/AMC/DMT). "DMT" ("during market trading") is the
# schema's neutral bucket for anything we can't confidently classify.
_REPORT_TIME_MAP = {"amc": "AMC", "bmo": "BMO", "unknown": "DMT"}


# Curated universe of liquid, Claude-analyzable, options-heavy US names.
# Philosophy: the user glances over a short list and decides whether to
# sell a call or a put. That workflow needs names with (a) deep options
# chains so the strike ladder / yield / POP numbers are meaningful, (b)
# enough news + analyst coverage that Claude's thesis has real substance,
# and (c) a recognizable single-business story (not obscure micro-caps or
# weird conglomerates where "direction" is noise).
#
# Roughly tiered:
#   • S&P 100-equivalent mega caps — always tradeable
#   • Liquid large caps outside SP100 — semis, cloud, consumer, banks
#   • High-beta momentum names — tradeable when reporting because IV is rich
#
# Anything NOT in this set gets filtered out of the earnings screener even
# if FMP lists it — an upcoming earning for an illiquid Russell-2000 name
# rarely offers a tradeable options setup. Users who want the full list
# can pass ?market_cap=all to bypass this filter.
CURATED_OPTIONABLE_UNIVERSE: frozenset[str] = frozenset({
    # Mega caps / SP100
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA",
    "BRK.B", "AVGO", "LLY", "WMT", "JPM", "V", "XOM", "MA", "ORCL",
    "COST", "HD", "PG", "JNJ", "NFLX", "BAC", "CRM", "ABBV", "CVX",
    "KO", "MRK", "AMD", "ADBE", "PEP", "TMO", "ACN", "LIN", "CSCO",
    "MCD", "ABT", "TXN", "GE", "DHR", "WFC", "NOW", "INTU", "IBM",
    "CAT", "AMGN", "NEE", "ISRG", "PFE", "PM", "QCOM", "GS", "UNP",
    "VZ", "T", "RTX", "COP", "SPGI", "LOW", "ETN", "BLK", "HON",
    "SYK", "AXP", "BKNG", "VRTX", "C", "ELV", "DE", "TJX", "ADP",
    "GILD", "PLD", "PANW", "SCHW", "MMC", "LMT", "CB", "REGN", "MDT",
    "UBER", "BSX", "MU", "SBUX", "FI", "BX", "AMT", "KLAC", "MDLZ",
    "ADI", "CVS", "SO", "GEV", "ZTS", "CI", "MO", "CL", "DUK",
    "BMY", "WM", "ICE", "SNPS", "APH", "SHW", "PYPL", "CME",
    # High-flyers / retail favorites — rich IV into earnings
    "PLTR", "SMCI", "SNOW", "COIN", "SHOP", "ABNB", "CVNA", "RBLX",
    "HOOD", "DKNG", "MARA", "RIOT", "ROKU", "U", "NET", "CRWD",
    "ZS", "OKTA", "MDB", "DDOG", "SQ", "SOFI", "PINS", "SNAP",
    "DASH", "AFRM", "RIVN", "LCID", "NIO", "XPEV", "BYND", "PTON",
    "GME", "BB", "BBIG", "AMC",
    # Other well-known optionable large caps
    "BA", "F", "GM", "DIS", "NKE", "SPOT", "ZM", "DOCU", "FSLY",
    "TWLO", "TEAM", "ANET", "MRVL", "LRCX", "WDAY", "FTNT", "CDNS",
    "ASML", "TSM", "BABA", "JD", "PDD", "NTES", "BIDU",
})


def _in_curated_universe(symbol: str) -> bool:
    """Case-insensitive membership check for the curated universe."""
    return symbol.upper() in CURATED_OPTIONABLE_UNIVERSE


# ─── Upstream adapters (thin wrappers; fan-outs call these) ──

async def _fmp_upcoming(window: str) -> list[dict]:
    """Return FMP earnings calendar rows for the requested window.

    `window`: 'current' = this week, 'next' = next week, 'both' = union.
    Wraps the existing :class:`data.providers.fmp_earnings.FMPEarningsProvider`.

    The provider is synchronous (returns a pandas DataFrame) so we offload
    the call to a worker thread with :func:`asyncio.to_thread`. Rows are
    flattened to the shape the aggregator expects
    (``symbol``, ``company``, ``sector``, ``report_date``, ``report_time``).

    ``company`` and ``sector`` are NOT part of FMP's calendar payload — we
    pass ``symbol`` as a placeholder for ``company`` and an empty string
    for ``sector``. Task 25 (smoke-test) will cross-reference these with
    a dedicated profile endpoint if needed; the aggregator already
    tolerates empty/placeholder values.
    """
    from data.providers.fmp_earnings import FMPEarningsProvider

    today = date.today()
    if window == "current":
        start, end = today, today + timedelta(days=7)
    elif window == "next":
        start, end = today + timedelta(days=7), today + timedelta(days=14)
    else:  # both
        start, end = today, today + timedelta(days=14)

    def _load() -> list[dict]:
        with FMPEarningsProvider() as provider:
            df = provider.calendar(start=start, end=end)
        if df is None or df.empty:
            return []
        out: list[dict] = []
        for _, item in df.iterrows():
            symbol = item.get("symbol")
            if not symbol:
                continue
            symbol_str = str(symbol)
            # FMP returns GLOBAL earnings — foreign exchanges (.L, .TO, .V,
            # .CN, .PA, etc.) and OTC pink sheets that Alpaca can't quote.
            # Filter to plain US-listed tickers: 1-5 uppercase letters,
            # allowing a single-letter share-class suffix after a dot
            # (e.g. BRK.B, BRK.A, RDS.A). Anything longer than 5 chars
            # (typically 5-letter pinks like XTRRF) gets dropped —
            # saves ~400 pointless 404s per calendar fetch. We permit `.`
            # and strip it before checking isalpha() so legit share-class
            # tickers aren't filtered out alongside foreign suffixes, which
            # are caught separately via the curated universe filter.
            if len(symbol_str) > 5 or not symbol_str.replace(".", "").isalpha():
                continue
            report_date_val = item.get("date")
            if report_date_val is None:
                continue
            report_time_raw = (item.get("announcement_when") or "unknown").lower()
            out.append({
                "symbol": symbol_str,
                "company": symbol_str,  # FMP /earnings-calendar has no name
                "sector": "",
                "report_date": (
                    report_date_val.isoformat()
                    if hasattr(report_date_val, "isoformat")
                    else str(report_date_val)
                ),
                "report_time": _REPORT_TIME_MAP.get(report_time_raw, "DMT"),
            })
        # B-45: FMP occasionally returns duplicate rows for the same
        # (symbol, report_date) — once as the preliminary listing and
        # again after an update. Dedup preserving first-seen order so
        # downstream hydration doesn't do redundant Alpaca calls.
        seen: set[tuple[str, str]] = set()
        deduped: list[dict] = []
        for r in out:
            k = (r["symbol"], r["report_date"])
            if k in seen:
                continue
            seen.add(k)
            deduped.append(r)
        return deduped

    try:
        # B-80: cap the worker-thread wait so a stalled FMP call can't
        # starve the asyncio thread pool. 5s is generous vs. the typical
        # <1s response; on timeout we re-raise so the outer catch marks
        # the response partial with an empty calendar.
        return await asyncio.wait_for(asyncio.to_thread(_load), timeout=5.0)
    except asyncio.TimeoutError:
        log.warning("FMP upcoming fetch timed out for window=%s", window)
        raise
    except Exception as e:
        log.warning("FMP upcoming fetch failed for window=%s: %s", window, e)
        raise


class _StubRequest:
    """Minimal Request-shaped object so we can call `api.routes.market.get_quote`
    without a real FastAPI request context. The rate-limiter only reads
    ``request.client.host`` and ``request.headers``.

    B-33: Accept a ``client_host`` kwarg so hydration paths can propagate
    the real user's IP instead of always spoofing ``127.0.0.1`` (which
    bypassed the per-IP rate limiter). Default ``None`` falls back to
    loopback for callers without a request (internal jobs, tests).
    """

    class _Client:
        def __init__(self, host: str = "127.0.0.1") -> None:
            self.host = host

    def __init__(self, client_host: str | None = None) -> None:
        self.client = self._Client(host=client_host or "127.0.0.1")
        self.headers: dict[str, str] = {}


class _StubResponse:
    headers: dict[str, str] = {}


async def _load_quote(symbol: str, client_host: str | None = None) -> dict | None:
    from api.routes.market import get_quote  # existing helper

    try:
        q = await get_quote(
            symbol, _StubRequest(client_host=client_host), _StubResponse(),
        )  # type: ignore[arg-type]
        return {
            "last": float(q.last),
            "change": float(q.change),
            "change_pct": float(q.changePct),
        }
    except Exception as e:
        log.warning("quote load failed for %s: %s", symbol, e)
        return None


def _filter_chain(chain: Any, option_type: str) -> list:
    """Split `OptionChain.contracts` by option_type since the plan
    references ``chain.calls`` / ``chain.puts`` which do not exist on the
    actual :class:`api.routes.options.OptionChain` model.
    """
    return [c for c in chain.contracts if getattr(c.option_type, "value", c.option_type) == option_type]


async def _load_metrics(
    symbol: str,
    report_date: date | None = None,
    expiry: date | None = None,
    client_host: str | None = None,  # B-33 — accepted for API parity; unused today
) -> dict | None:
    from api.routes.options import get_iv_analysis, get_options_chain

    try:
        iv = await get_iv_analysis(symbol)
        chain = await get_options_chain(symbol, expiry=expiry)
        underlying = chain.spot_price
        calls = _filter_chain(chain, "call")
        puts = _filter_chain(chain, "put")
        atm_call = min(calls, key=lambda c: abs(c.strike - underlying), default=None)
        atm_put = min(puts, key=lambda p: abs(p.strike - underlying), default=None)
        em_pct = None
        if atm_call and atm_put and underlying > 0:
            em_pct = compute_expected_move_from_straddle(
                underlying=underlying,
                call_mid=(atm_call.bid + atm_call.ask) / 2,
                put_mid=(atm_put.bid + atm_put.ask) / 2,
            )
        days_to_earnings = (report_date - date.today()).days if report_date else None
        days_to_expiry = (expiry - date.today()).days if expiry else None
        hv_iv_ratio = (iv.hv_20 / iv.current_iv) if iv.current_iv else None
        return {
            "iv_rank": iv.iv_rank,
            "iv_percentile": iv.iv_percentile,
            "current_iv": iv.current_iv,
            "hv_20": iv.hv_20,
            "hv_50": iv.hv_50,
            "hv_100": iv.hv_100,
            "hv_iv_ratio": hv_iv_ratio,
            "expected_move_pct": em_pct,
            "expected_move_dollars": em_pct * underlying if em_pct is not None else None,
            "hist_avg_abs_move_pct": None,  # filled later from _load_historical
            "beat_rate": None,
            "days_to_earnings": days_to_earnings,
            "days_to_expiry": days_to_expiry,
        }
    except Exception as e:
        log.warning("metrics load failed for %s: %s", symbol, e)
        return None


async def _load_strike_ladder(symbol: str, expiry: date | None) -> dict | None:
    """Pull ATM / 30Δ / 15Δ rows (both sides) from the OPRA chain."""
    from api.routes.options import get_options_chain

    try:
        chain = await get_options_chain(symbol, expiry=expiry)
        underlying = chain.spot_price
        calls = _filter_chain(chain, "call")
        puts = _filter_chain(chain, "put")
        rows: list[dict] = []
        for bucket, target_delta in [("ATM", 0.5), ("30Δ", 0.3), ("15Δ", 0.15)]:
            call_match = min(
                calls,
                key=lambda c: abs(abs(c.delta or 0.5) - target_delta),
                default=None,
            )
            put_match = min(
                puts,
                key=lambda p: abs(abs(p.delta or 0.5) - target_delta),
                default=None,
            )
            for side, contract in [("call", call_match), ("put", put_match)]:
                if contract is None:
                    continue
                mid = (
                    (contract.bid + contract.ask) / 2
                    if (contract.bid and contract.ask)
                    else (contract.last or 0)
                )
                yield_pct = mid / underlying if underlying > 0 else 0.0
                pop = max(0.0, min(1.0, 1 - abs(contract.delta or 0.5)))
                rows.append({
                    "strike": contract.strike,
                    "side": side,
                    "bucket": bucket,
                    "delta": contract.delta or 0,
                    "bid": contract.bid or 0,
                    "ask": contract.ask or 0,
                    "mid": mid,
                    "iv": contract.iv or 0,
                    "yield_pct": yield_pct,
                    "pop": pop,
                    "theta": contract.theta or 0,
                    "gamma": contract.gamma or 0,
                    "vega": contract.vega or 0,
                    "oi": contract.open_interest or 0,
                    "volume": contract.volume or 0,
                })
        resolved_expiry = (
            expiry
            or (chain.expirations[0] if chain.expirations else date.today())
        )
        return {
            "expiry": resolved_expiry,
            "underlying_price": underlying,
            "rows": rows,
        }
    except Exception as e:
        log.warning("strike ladder load failed for %s: %s", symbol, e)
        return None


async def _load_claude_structured(symbol: str, context: dict) -> dict | None:
    """Read from cache; on miss, fire-and-forget the Claude call so the UI
    doesn't block. Returns whatever is currently cached."""
    from core.cache import get_cache

    cache = get_cache()
    key = f"earnings:claude-structured:{symbol}:{context['report_date']}"
    cached = await cache.get(key)
    if cached:
        return cached
    # Cache miss — enqueue + return None so the row fills in on next refresh.
    asyncio.create_task(_run_structured_and_cache(symbol, context, cache, key))
    return None


async def _run_structured_and_cache(
    symbol: str, context: dict, cache: Any, key: str
) -> None:
    from agents.claude_client import ClaudeClient
    from services.earnings_prompts import (
        MODEL_STRUCTURED,
        build_structured_prompt,
        parse_structured_response,
    )

    try:
        prompt = build_structured_prompt(**context)
        client = ClaudeClient()
        raw = await client.complete(
            system=prompt["system"], user=prompt["user"], model=MODEL_STRUCTURED,
        )
        parsed = parse_structured_response(raw)
        payload = {
            **parsed,
            "model": MODEL_STRUCTURED,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        await cache.set(key, payload, ttl_seconds=4 * 3600)
    except Exception as e:
        log.warning("Claude structured failed for %s: %s", symbol, e)


async def _load_iv_term(symbol: str) -> list[dict] | None:
    from api.routes.options import get_options_chain

    try:
        today = date.today()
        first_chain = await get_options_chain(symbol)
        term: list[dict] = []
        for exp in first_chain.expirations[:6]:
            exp_date = exp if isinstance(exp, date) else date.fromisoformat(str(exp))
            exp_chain = await get_options_chain(symbol, expiry=exp_date)
            calls = _filter_chain(exp_chain, "call")
            atm = min(
                calls,
                key=lambda c: abs(c.strike - exp_chain.spot_price),
                default=None,
            )
            if atm and atm.iv:
                term.append({
                    "expiry": exp_date,
                    "dte": (exp_date - today).days,
                    "atm_iv": atm.iv,
                })
        return term or None
    except Exception as e:
        log.warning("iv term load failed for %s: %s", symbol, e)
        return None


async def _load_skew(symbol: str) -> dict | None:
    from api.routes.options import get_options_chain

    try:
        chain = await get_options_chain(symbol)
        calls = _filter_chain(chain, "call")
        puts = _filter_chain(chain, "put")
        put_25d = min(
            puts,
            key=lambda p: abs(abs(p.delta or 0.5) - 0.25),
            default=None,
        )
        call_25d = min(
            calls,
            key=lambda c: abs(abs(c.delta or 0.5) - 0.25),
            default=None,
        )
        if not (put_25d and call_25d and put_25d.iv and call_25d.iv):
            return None
        skew = (put_25d.iv - call_25d.iv) * 100
        if skew > 1.5:
            interp = "put-heavy skew"
        elif skew < -1.5:
            interp = "call-heavy skew"
        else:
            interp = "neutral"
        return {
            "put_iv_25d": put_25d.iv,
            "call_iv_25d": call_25d.iv,
            "skew_points": skew,
            "interpretation": interp,
        }
    except Exception as e:
        log.warning("skew load failed for %s: %s", symbol, e)
        return None


def _parse_news_datetime(raw: str) -> datetime:
    """Newsdata's pubDate arrives as ``"YYYY-MM-DD HH:MM:SS"`` or ISO-8601.
    The schema requires a ``datetime``; this coerces either form, falling
    back to "now" so malformed rows don't 500 the detail endpoint."""
    if not raw:
        return datetime.now(timezone.utc)
    try:
        # Try ISO-8601 first (handles ``2026-04-21T10:15:00+00:00``).
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        pass
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


async def _load_news(symbol: str) -> list[dict]:
    from api.routes.news import get_symbol_news

    try:
        resp = await get_symbol_news(symbol, limit=10)
        return [
            {
                "title": a.title,
                "source": a.source,
                "published_at": _parse_news_datetime(a.published_at),
                "url": a.url,
            }
            for a in resp.articles
            if a.url  # Schema requires a URL; drop rows with empty links
        ]
    except Exception as e:
        log.warning("news load failed for %s: %s", symbol, e)
        return []


async def _load_earnings_meta(symbol: str) -> dict | None:
    """Fetch company + sector + upcoming earnings row for this symbol."""
    rows = await _fmp_upcoming("both")
    return next((r for r in rows if r["symbol"] == symbol), None)


async def _hydrate_row(
    row: dict,
    *,
    min_iv_rank: float = 0,
    client_host: str | None = None,
) -> dict | None:
    """Enrich one FMP row with price, IV rank, expected move, and days-until.

    Returns the enriched dict or ``None`` when ``iv_rank`` is below the
    threshold filter. Raises on truly unrecoverable errors (caller catches).
    ``client_host`` is threaded through to ``_load_quote`` so per-IP rate
    limits kick in on the real user's IP instead of loopback (B-33).
    """
    symbol = row["symbol"]
    # B-35: gather with return_exceptions=True gives us clean per-task
    # exception handling and concise result-unpacking. The previous
    # wait/result sequence re-raised either task's exception without
    # distinguishing the source, and required manual Task plumbing.
    quote_result, metrics_result = await asyncio.gather(
        _load_quote(symbol, client_host=client_host),
        _load_metrics(
            symbol,
            report_date=date.fromisoformat(row["report_date"]),
            client_host=client_host,
        ),
        return_exceptions=True,
    )
    if isinstance(quote_result, Exception):
        log.warning("quote task raised for %s: %s", symbol, quote_result)
        quote = None
    else:
        quote = quote_result
    if isinstance(metrics_result, Exception):
        log.warning("metrics task raised for %s: %s", symbol, metrics_result)
        metrics = None
    else:
        metrics = metrics_result
    iv_rank = metrics.get("iv_rank") if metrics else None
    if iv_rank is not None and iv_rank < min_iv_rank:
        return None
    return {
        **row,
        "price": quote["last"] if quote else None,
        "change": quote["change"] if quote else None,
        "change_pct": quote["change_pct"] if quote else None,
        "iv_rank": iv_rank,
        "expected_move_pct": metrics.get("expected_move_pct") if metrics else None,
        "premium_yield_call_atm": None,
        "premium_yield_put_atm": None,
        "hist_avg_abs_move_pct": None,
        "claude_verdict": None,
        "claude_confidence": None,
        "top_setup": None,
        "days_until": (date.fromisoformat(row["report_date"]) - date.today()).days,
    }


# ─── Main aggregators ────────────────────────────────────────


async def list_upcoming(
    *,
    window: str = "both",
    min_iv_rank: float = 0,
    market_cap: str = "all",
    bmo_amc: str = "both",
    watchlist_only: bool = False,
    sort: str = "date",
    client_host: str | None = None,
) -> CalendarResponse:
    """Fan out over FMP + per-symbol hydrators, return one calendar response.

    ``client_host`` is the caller's IP (passed from the FastAPI route) so
    downstream per-IP rate limiters see the real user instead of loopback
    (B-33).
    """
    partial = False
    try:
        raw_rows = await _fmp_upcoming(window)
    except Exception as e:
        log.error("FMP earnings calendar unavailable: %s", e)
        return CalendarResponse(
            earnings=[],
            generated_at=datetime.now(timezone.utc),
            partial=True,
            error="earnings calendar unavailable",
        )

    # Default shortlist behavior: restrict to the curated optionable
    # universe (mega + liquid large caps + momentum names) so the screener
    # is a *decision tool* showing ~5-10 names the user can actually
    # evaluate, not a feed of ~60 Russell-2000 names with thin option
    # chains. Users who want the long list pass market_cap="all".
    if market_cap != "all":
        before_count = len(raw_rows)
        raw_rows = [r for r in raw_rows if _in_curated_universe(r.get("symbol", ""))]
        log.info(
            "earnings calendar: curated universe kept %d/%d rows (window=%s, market_cap=%s)",
            len(raw_rows), before_count, window, market_cap,
        )

    # Hard cap. At curated-universe default this is rarely binding (≤10
    # tradeable names per week typical), but protects us on weeks where
    # many mega caps report in parallel.
    raw_rows.sort(key=lambda r: (r.get("report_date", ""), r.get("symbol", "")))
    MAX_ROWS = 8
    if len(raw_rows) > MAX_ROWS:
        log.info(
            "earnings calendar: %d rows → capped to %d (window=%s)",
            len(raw_rows), MAX_ROWS, window,
        )
        raw_rows = raw_rows[:MAX_ROWS]

    # Cap concurrency so we don't open 60 parallel Alpaca+FMP+Claude flights
    # at once — Alpaca's rate limit is ~200 req/min across the whole backend
    # and other endpoints need headroom.
    hydrate_sem = asyncio.Semaphore(10)

    async def safe_hydrate(row: dict) -> dict | None:
        async with hydrate_sem:
            try:
                return await _hydrate_row(
                    row, min_iv_rank=min_iv_rank, client_host=client_host,
                )
            except Exception as e:
                log.warning("hydrate failed for %s: %s", row.get("symbol"), e)
                nonlocal partial
                partial = True
                return row  # keep symbol visible with null fields

    hydrated = await asyncio.gather(*[safe_hydrate(r) for r in raw_rows])
    rows: list[CalendarRow] = []
    # B-81: surface row-validation failures instead of silently dropping.
    validation_errors: list[dict] = []
    for h in hydrated:
        if h is None:
            continue  # filtered by min_iv_rank
        try:
            row_payload = dict(h)
            row_payload.setdefault(
                "days_until",
                (date.fromisoformat(row_payload["report_date"]) - date.today()).days
                if isinstance(row_payload.get("report_date"), str)
                else 0,
            )
            rows.append(CalendarRow(**row_payload))
        except Exception as e:
            log.warning("row validation failed: %s — %s", e, h)
            partial = True
            validation_errors.append({
                "symbol": h.get("symbol") if isinstance(h, dict) else None,
                "error": str(e),
            })

    if bmo_amc != "both":
        wanted = bmo_amc.upper()
        rows = [r for r in rows if r.report_time == wanted]

    # B-43: drop stale earnings. FMP's window query can return rows whose
    # report_date already passed (timezone races around midnight, or an
    # upstream cache bug). Rendering them in the calendar is misleading —
    # a negative `days_until` looks like a typo.
    rows = [r for r in rows if (r.days_until or 0) >= 0]

    if sort == "date":
        rows.sort(key=lambda r: (r.report_date, r.symbol))
    elif sort == "iv_rank":
        rows.sort(key=lambda r: r.iv_rank or 0, reverse=True)
    elif sort == "yield":
        rows.sort(
            key=lambda r: max(
                r.premium_yield_call_atm or 0, r.premium_yield_put_atm or 0
            ),
            reverse=True,
        )
    elif sort == "claude_confidence":
        rows.sort(key=lambda r: r.claude_confidence or 0, reverse=True)

    return CalendarResponse(
        earnings=rows,
        generated_at=datetime.now(timezone.utc),
        partial=partial,
        validation_errors=validation_errors,
    )


async def get_detail(symbol: str) -> EarningsDetail:
    """Fan out to every provider, merge into one detail response."""
    meta = await _load_earnings_meta(symbol)
    if not meta:
        raise ValueError(f"symbol {symbol!r} has no upcoming earnings")

    quote_t, metrics_t, ladder_t, news_t, iv_term_t, skew_t = (
        await asyncio.gather(
            _load_quote(symbol),
            _load_metrics(symbol, report_date=date.fromisoformat(meta["report_date"])),
            _load_strike_ladder(symbol, expiry=None),
            _load_news(symbol),
            _load_iv_term(symbol),
            _load_skew(symbol),
            return_exceptions=True,
        )
    )
    # `partial` = any critical block errored. Successful ``None`` returns
    # (upstream intentionally absent) are NOT partial — only exceptions are.
    partial = any(
        isinstance(x, Exception)
        for x in [quote_t, metrics_t, ladder_t, news_t, iv_term_t, skew_t]
    )

    quote = quote_t if isinstance(quote_t, dict) else None
    metrics = metrics_t if isinstance(metrics_t, dict) else None
    ladder = ladder_t if isinstance(ladder_t, dict) else None
    news = news_t if isinstance(news_t, list) else []
    iv_term = iv_term_t if isinstance(iv_term_t, list) else None
    skew = skew_t if isinstance(skew_t, dict) else None

    claude_ctx = {
        "symbol": symbol,
        "company": meta["company"],
        "sector": meta["sector"],
        "report_date": meta["report_date"],
        "report_time": meta["report_time"],
        "price": quote["last"] if quote else 0.0,
        "iv_rank": metrics.get("iv_rank", 0) if metrics else 0,
        "iv_percentile": metrics.get("iv_percentile", 0) if metrics else 0,
        "hv_20": metrics.get("hv_20", 0) if metrics else 0,
        "expected_move_pct": metrics.get("expected_move_pct", 0) if metrics else 0,
        # B-63: historical block was stubbed + removed from the response.
        # Pass None so the prompt omits the line rather than lying to
        # Claude that realized vol is 0%.
        "hist_avg_abs_move_pct": None,
        "recent_beats_misses": [],
        "headlines": [n["title"] for n in news],
        "market_regime": "Unknown",  # wire once regime service is exposed
    }
    try:
        claude = await _load_claude_structured(symbol, context=claude_ctx)
    except Exception as e:
        log.warning("claude structured load failed for %s: %s", symbol, e)
        claude = None

    return EarningsDetail(
        symbol=symbol,
        company=meta["company"],
        sector=meta["sector"],
        report_date=date.fromisoformat(meta["report_date"]),
        report_time=meta["report_time"],
        quote=QuoteBlock(**quote) if quote else None,
        metrics=MetricsBlock(**metrics) if metrics else None,
        strike_ladder=StrikeLadder(**ladder) if ladder else None,
        claude_structured=ClaudeStructured(**claude) if claude else None,
        claude_full_research=None,
        iv_term_structure=[IVTermPoint(**p) for p in iv_term] if iv_term else None,
        skew=SkewBlock(**skew) if skew else None,
        news=[NewsArticle(**n) for n in news],
        partial=partial,
        generated_at=datetime.now(timezone.utc),
    )


async def run_full_research(symbol: str) -> ClaudeFullResearch:
    """24h-cached full Claude research note for one symbol.

    Cache hit → return parsed payload straight. Cache miss → gather context,
    build the full prompt, call Claude Opus, persist, return.
    """
    from agents.claude_client import ClaudeClient
    from core.cache import get_cache
    from services.earnings_prompts import (
        MODEL_FULL,
        build_full_prompt,
        parse_full_response,
    )

    meta = await _load_earnings_meta(symbol)
    if not meta:
        raise ValueError(f"symbol {symbol!r} has no upcoming earnings")

    cache = get_cache()
    key = f"earnings:claude-full:{symbol}:{meta['report_date']}"
    cached = await cache.get(key)
    if cached:
        return ClaudeFullResearch(**cached)

    quote, metrics, news = await asyncio.gather(
        _load_quote(symbol),
        _load_metrics(symbol, report_date=date.fromisoformat(meta["report_date"])),
        _load_news(symbol),
        return_exceptions=True,
    )
    prompt = build_full_prompt(
        symbol=symbol,
        company=meta["company"],
        sector=meta["sector"],
        report_date=meta["report_date"],
        report_time=meta["report_time"],
        price=quote["last"] if isinstance(quote, dict) else 0.0,
        iv_rank=metrics.get("iv_rank", 0) if isinstance(metrics, dict) else 0,
        iv_percentile=metrics.get("iv_percentile", 0) if isinstance(metrics, dict) else 0,
        expected_move_pct=metrics.get("expected_move_pct", 0) if isinstance(metrics, dict) else 0,
        # B-63: historical data loader removed; quarters list is empty
        # until the FMP surprises join lands in a follow-up.
        historical_quarters=[],
        headlines=[n["title"] for n in news] if isinstance(news, list) else [],
        market_regime="Unknown",  # wire once regime service is exposed
        sector_peers_pct_change_5d={},  # wire once sector-peers helper exists
    )
    client = ClaudeClient()
    raw = await client.complete(
        system=prompt["system"], user=prompt["user"], model=MODEL_FULL
    )
    parsed = parse_full_response(raw)
    payload = {
        **parsed,
        "model": MODEL_FULL,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    await cache.set(key, payload, ttl_seconds=24 * 3600)
    return ClaudeFullResearch(**payload)
