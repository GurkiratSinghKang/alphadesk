"""News service layer — pure Newsdata.io fetch + cache for per-symbol
and market-wide headlines. HTTP concerns (FastAPI routes, query
validation) live in ``api.routes.news``; this module is import-safe from
any other service.

Extracted from ``api.routes.news`` (B-62) so the earnings screener,
pipeline jobs, and other service-layer callers can pull news without a
FastAPI Request context. The Pydantic models (``NewsArticle``,
``NewsResponse``), the Newsdata.io client (``_fetch_newsdata``), the
article-parser, rate-limit state, and demo fallbacks all live here;
``api.routes.news`` re-imports the names so the route shapes stay
stable.
"""
from __future__ import annotations

import hashlib
import logging
import random
from datetime import datetime, timezone

import httpx
from pydantic import BaseModel

log = logging.getLogger("alphadesk.news")

NEWSDATA_BASE = "https://newsdata.io/api/1/news"
NEWS_CACHE_TTL = 900  # 15 minutes (avoid newsdata.io rate limits)
NEWSDATA_RATE_LIMIT_COOLDOWN = 900  # 15 minutes, matches NEWS_CACHE_TTL
NEWSDATA_RATE_KEY = "rate:news:newsdata"


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class NewsArticle(BaseModel):
    title: str
    description: str | None = None
    url: str
    source: str
    published_at: str
    image_url: str | None = None
    sentiment: str | None = None  # positive/negative/neutral
    symbols: list[str] = []
    is_demo: bool = False


class NewsResponse(BaseModel):
    articles: list[NewsArticle]
    query: str
    count: int
    is_demo: bool = False


# ---------------------------------------------------------------------------
# Ticker -> company name mapping (for better search queries)
# ---------------------------------------------------------------------------

_TICKER_NAMES: dict[str, str] = {
    "AAPL": "Apple",
    "MSFT": "Microsoft",
    "GOOGL": "Google Alphabet",
    "AMZN": "Amazon",
    "TSLA": "Tesla",
    "NVDA": "NVIDIA",
    "META": "Meta Facebook",
    "NFLX": "Netflix",
    "AMD": "AMD Advanced Micro Devices",
    "JPM": "JPMorgan Chase",
    "BAC": "Bank of America",
    "V": "Visa",
    "WMT": "Walmart",
    "DIS": "Disney",
    "INTC": "Intel",
    "CRM": "Salesforce",
    "PYPL": "PayPal",
    "UBER": "Uber",
    "SQ": "Block Square",
    "COIN": "Coinbase",
}


def _company_query(symbol: str) -> str:
    """Build a search query from ticker + company name."""
    name = _TICKER_NAMES.get(symbol.upper(), "")
    if name:
        return f"{symbol} {name}"
    return symbol


# ---------------------------------------------------------------------------
# newsdata.io fetcher
# ---------------------------------------------------------------------------

# Rate-limit cooldown is shared across workers via Redis key
# ``rate:news:newsdata`` (see NEWSDATA_RATE_KEY). The key is TTL'd to the
# cooldown window — while it exists, no worker will hit the provider. Local
# module-level fallback (_local_rate_limited_until) is only used when Redis is
# unavailable; in that degraded mode each worker backs off independently.
_local_rate_limited_until: float = 0


async def _is_rate_limited() -> bool:
    """True if the cross-worker cooldown is active. Falls back to per-worker state."""
    import time

    from core.redis import get_redis

    try:
        r = await get_redis()
        # ``EXISTS`` returns 1 if the cooldown key is still alive.
        if await r.exists(NEWSDATA_RATE_KEY):
            return True
    except Exception:
        log.debug("Redis unavailable for news rate-limit check, using local state")

    return time.time() < _local_rate_limited_until


async def _mark_rate_limited(cooldown_s: int = NEWSDATA_RATE_LIMIT_COOLDOWN) -> None:
    """Mark newsdata.io as rate-limited across all workers for ``cooldown_s`` seconds."""
    import time

    from core.redis import get_redis

    global _local_rate_limited_until
    _local_rate_limited_until = time.time() + cooldown_s
    try:
        r = await get_redis()
        # SET with NX so the first worker to hit 429 wins the race; others reuse
        # the same cooldown window. EX ensures auto-expiry.
        await r.set(NEWSDATA_RATE_KEY, "1", nx=True, ex=cooldown_s)
    except Exception:
        log.debug("Redis unavailable for news rate-limit set; cooldown is per-worker only")


async def _fetch_newsdata(query: str, limit: int = 10) -> list[dict]:
    """Fetch articles from newsdata.io. Returns raw article dicts."""
    from core.config import settings

    api_key = settings.NEWSDATA_API_KEY.get_secret_value()
    if not api_key:
        log.warning("NEWSDATA_API_KEY is not configured — cannot fetch real news")
        return []

    if await _is_rate_limited():
        # Round-11 / BB-16 (P2): the previous return-[] was truly
        # silent — callers couldn't tell "no news" from "we're in
        # cooldown" and operator dashboards showed an empty news rail
        # for 15 minutes with no signal. Emit a structured event +
        # bump a Redis counter so a probe can detect cooldown bursts.
        log.info(
            "newsdata.io: skipping fetch during rate-limit cooldown",
            extra={"event": "news_rate_limited_skip", "provider": "newsdata", "query": query},
        )
        try:
            from core.redis import cache_incr
            await cache_incr("metrics:provider_outage:news_rate_limited_total")
        except Exception:
            pass
        return []

    params = {
        "apikey": api_key,
        "q": query,
        "category": "business",
        "language": "en",
        "size": min(limit, 10),  # newsdata.io free tier max per request
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(NEWSDATA_BASE, params=params)
            if resp.status_code == 429:
                await _mark_rate_limited()
                log.warning("newsdata.io rate limit hit, backing off 15m (shared via Redis)")
                return []
            resp.raise_for_status()
            data = resp.json()
            return data.get("results") or []
    except httpx.ReadTimeout:
        log.warning("newsdata.io read timeout for query=%r (30s)", query)
        return []
    except httpx.HTTPStatusError as e:
        log.error("newsdata.io fetch failed (HTTP %d): %s", e.response.status_code, e.response.text[:200])
        return []
    except Exception:
        log.error("newsdata.io fetch failed", exc_info=True)
        return []


def _parse_articles(raw: list[dict], symbols: list[str] | None = None) -> list[NewsArticle]:
    """Convert raw newsdata.io results to NewsArticle models."""
    articles: list[NewsArticle] = []
    for item in raw:
        title = item.get("title")
        if not title:
            continue
        try:
            articles.append(NewsArticle(
                title=title,
                description=item.get("description"),
                url=item.get("link") or "",
                source=item.get("source_name") or item.get("source_id") or "unknown",
                published_at=item.get("pubDate") or "",
                image_url=item.get("image_url"),
                sentiment=item.get("sentiment"),
                symbols=symbols or [],
            ))
        except Exception:
            log.debug("Skipping malformed news article", exc_info=True)
            continue
    return articles


# ---------------------------------------------------------------------------
# Demo fallback (when no API key)
# ---------------------------------------------------------------------------

_DEMO_HEADLINES: list[dict[str, str]] = [
    {"title": "{sym} beats Q4 earnings estimates, stock surges 5%", "sentiment": "positive"},
    {"title": "{sym} announces $2B share buyback program", "sentiment": "positive"},
    {"title": "Analysts upgrade {sym} to Overweight with new price target", "sentiment": "positive"},
    {"title": "{sym} CEO discusses AI strategy in shareholder letter", "sentiment": "neutral"},
    {"title": "{sym} reports mixed revenue, guidance disappoints Wall Street", "sentiment": "negative"},
    {"title": "Institutional investors increase {sym} holdings by 12%", "sentiment": "positive"},
    {"title": "{sym} faces regulatory scrutiny over market practices", "sentiment": "negative"},
    {"title": "{sym} partners with major tech firm on cloud initiative", "sentiment": "positive"},
    {"title": "Options activity spikes for {sym} ahead of earnings", "sentiment": "neutral"},
    {"title": "{sym} expands into European markets, expects 15% revenue growth", "sentiment": "positive"},
    {"title": "Short interest in {sym} drops to 6-month low", "sentiment": "positive"},
    {"title": "{sym} supply chain issues may impact Q1 deliveries", "sentiment": "negative"},
    {"title": "Wall Street consensus: {sym} is top pick for swing traders", "sentiment": "positive"},
    {"title": "{sym} insider selling raises eyebrows among analysts", "sentiment": "negative"},
    {"title": "{sym} dividend increase signals management confidence", "sentiment": "positive"},
]

_DEMO_MARKET_HEADLINES: list[dict[str, str]] = [
    {"title": "S&P 500 hits new all-time high as tech rallies", "sentiment": "positive"},
    {"title": "Fed signals potential rate cut in September meeting", "sentiment": "positive"},
    {"title": "Treasury yields fall as inflation data comes in below expectations", "sentiment": "positive"},
    {"title": "Market volatility rises ahead of jobs report", "sentiment": "neutral"},
    {"title": "Oil prices surge on OPEC+ production cut extension", "sentiment": "negative"},
    {"title": "Semiconductor stocks lead market gains on AI demand", "sentiment": "positive"},
    {"title": "Consumer spending data shows resilient economy", "sentiment": "positive"},
    {"title": "Global markets mixed as China stimulus disappoints", "sentiment": "neutral"},
    {"title": "IPO market heats up with three major listings this week", "sentiment": "positive"},
    {"title": "Bond market signals recession fears easing", "sentiment": "positive"},
]

_DEMO_SOURCES = [
    "Bloomberg", "Reuters", "CNBC", "MarketWatch", "WSJ",
    "Barron's", "Financial Times", "Yahoo Finance", "Seeking Alpha", "Benzinga",
]


def _generate_demo_articles(symbol: str | None = None, limit: int = 10) -> list[NewsArticle]:
    """Generate realistic demo news when API key is not configured."""
    rng = random.Random(hashlib.md5((symbol or "market").encode()).hexdigest())
    now = datetime.now(timezone.utc)

    if symbol:
        pool = _DEMO_HEADLINES
        syms = [symbol.upper()]
    else:
        pool = _DEMO_MARKET_HEADLINES
        syms = []

    selected = rng.sample(pool, min(limit, len(pool)))
    articles: list[NewsArticle] = []
    for i, item in enumerate(selected):
        title = item["title"].replace("{sym}", symbol.upper()) if symbol else item["title"]
        articles.append(NewsArticle(
            title=title,
            description=f"Demo article for development. Configure NEWSDATA_API_KEY for live news.",
            url="",
            source=rng.choice(_DEMO_SOURCES),
            published_at=now.strftime("%Y-%m-%d %H:%M:%S"),
            image_url=None,
            sentiment=item.get("sentiment"),
            symbols=syms,
            is_demo=True,
        ))
    return articles


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _cache_key(prefix: str, query: str, limit: int) -> str:
    return f"news:{prefix}:{query.upper()}:{limit}"


# ---------------------------------------------------------------------------
# Data-fetching entry points (formerly in api.routes.news)
# ---------------------------------------------------------------------------


async def fetch_latest(q: str = "stock market", limit: int = 10) -> NewsResponse:
    """Return the Newsdata.io-backed latest articles matching ``q``.

    Mirrors ``api.routes.news.get_latest_news`` with cache + demo fallback.
    """
    from core.redis import cache_get, cache_set

    cache_k = _cache_key("latest", q, limit)
    cached = await cache_get(cache_k)
    if cached:
        return NewsResponse(**cached)

    # Always try real API first; fall back to demo only on failure
    is_demo = False
    raw = await _fetch_newsdata(q, limit)
    articles = _parse_articles(raw)
    if not articles:
        log.info("No real news returned for query=%r, serving demo headlines", q)
        articles = _generate_demo_articles(symbol=q if q != "stock market" else None, limit=limit)
        is_demo = True
    else:
        log.debug("Serving %d real news articles for query=%r", len(articles), q)

    response = NewsResponse(articles=articles, query=q, count=len(articles), is_demo=is_demo)
    await cache_set(cache_k, response.model_dump(), ttl_seconds=NEWS_CACHE_TTL)
    return response


async def fetch_market() -> NewsResponse:
    """Return general market-wide Newsdata.io headlines with demo fallback."""
    from core.redis import cache_get, cache_set

    cache_k = _cache_key("market", "general", 10)
    cached = await cache_get(cache_k)
    if cached:
        return NewsResponse(**cached)

    # Always try real API first; fall back to demo only on failure
    is_demo = False
    raw = await _fetch_newsdata("stock market finance", 10)
    articles = _parse_articles(raw)
    if not articles:
        log.info("No real market news returned, serving demo headlines")
        articles = _generate_demo_articles(symbol=None, limit=10)
        is_demo = True
    else:
        log.debug("Serving %d real market news articles", len(articles))

    response = NewsResponse(articles=articles, query="market", count=len(articles), is_demo=is_demo)
    await cache_set(cache_k, response.model_dump(), ttl_seconds=NEWS_CACHE_TTL)
    return response


async def fetch_symbol_news(
    symbol: str,
    limit: int = 10,
    client_host: str | None = None,
) -> NewsResponse:
    """Return the :class:`NewsResponse` for ``symbol``.

    Mirrors ``api.routes.news.get_symbol_news`` with cache + demo fallback.
    ``client_host`` is accepted for the B-33 service contract but unused —
    Newsdata fetches are symbol-keyed, not client-keyed.
    """
    from core.redis import cache_get, cache_set

    symbol = symbol.upper()
    cache_k = _cache_key("symbol", symbol, limit)
    cached = await cache_get(cache_k)
    if cached:
        return NewsResponse(**cached)

    # Always try real API first; fall back to demo only on failure
    is_demo = False
    query = _company_query(symbol)
    raw = await _fetch_newsdata(query, limit)
    articles = _parse_articles(raw, symbols=[symbol])
    if not articles:
        log.info("No real news for symbol=%s, serving demo headlines", symbol)
        articles = _generate_demo_articles(symbol=symbol, limit=limit)
        is_demo = True
    else:
        log.debug("Serving %d real news articles for symbol=%s", len(articles), symbol)

    response = NewsResponse(articles=articles, query=symbol, count=len(articles), is_demo=is_demo)
    await cache_set(cache_k, response.model_dump(), ttl_seconds=NEWS_CACHE_TTL)
    return response


async def fetch_news_for_symbol(symbol: str, limit: int = 5) -> list[str]:
    """Return a list of headline strings for a symbol (for pipeline use).

    Uses cache and falls back to demo headlines when API key is missing.
    Historical name — kept for backwards-compat with
    ``data.ingestion.continuous_monitor``.
    """
    from core.redis import cache_get, cache_set

    cache_k = _cache_key("pipeline", symbol, limit)
    cached = await cache_get(cache_k)
    if cached:
        return cached  # type: ignore[return-value]

    # Always try real API first; fall back to demo only on failure
    query = _company_query(symbol)
    raw = await _fetch_newsdata(query, limit)
    headlines = [r["title"] for r in raw if r.get("title")][:limit]
    if not headlines:
        log.info("No real headlines for pipeline symbol=%s, using demo", symbol)
        articles = _generate_demo_articles(symbol=symbol, limit=limit)
        headlines = [a.title for a in articles]

    await cache_set(cache_k, headlines, ttl_seconds=NEWS_CACHE_TTL)
    return headlines
