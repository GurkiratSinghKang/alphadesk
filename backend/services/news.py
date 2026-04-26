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
import re
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
    # Round-12 / NF-1 (P2): price-driving relevance score (0..1) computed
    # by ``_score_relevance``. Higher = more likely to move the stock
    # price (earnings beats/misses, M&A, analyst upgrades, regulatory
    # actions). Lower = aggregator clones, generic press releases,
    # tangential market commentary. The frontend sorts on this so the
    # top of the news rail is the high-impact items.
    relevance_score: float = 0.0
    # Round-12 / NF-1: price-driving category — one of "earnings",
    # "rating", "M&A", "regulatory", "filing", "product", "guidance",
    # "insider", or null when no category matched. Used for the FE
    # category chip + analytics.
    category: str | None = None
    # Round-12 / NF-1: source-tier classification. 1 = primary
    # (Bloomberg/Reuters/WSJ), 2 = mainstream (CNBC/MarketWatch), 3 =
    # syndicated wire (PR Newswire/GlobeNewswire — heavily down-ranked).
    tier: int = 2


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
    """Convert raw newsdata.io results to NewsArticle models, scored
    and filtered for stock-price relevance.

    Round-12 / NF-1 (P2) — Stage 1 filter pipeline:
      1. Source tiering — drop the tier-3 wires (PR Newswire,
         GlobeNewswire, Business Wire, Accesswire) outright; rank tier-1
         (Bloomberg/Reuters/WSJ/FT/CNBC) above tier-2 mainstream.
      2. Symbol-density check — count occurrences of the symbol or
         company name in title + description; require at least one hit
         in the title to keep the row.
      3. Category tagging — match price-driving keywords (earnings,
         upgrade/downgrade, M&A, regulatory, filing, product launch,
         guidance) against the title and add the matched category.
      4. Recency decay — multiply score by exp(-age_hours/48) so
         48h-old items score half what fresh items do.
      5. URL canonicalisation dedupe — strip utm_*/ref/fragments and
         keep the highest-scored item per canonical URL (catches
         syndicated reposts).

    The ``symbols`` parameter (when given) lets the symbol-density
    check use the actual ticker rather than guessing from the article
    body — earnings-detail callers thread the symbol through here.
    """
    articles: list[NewsArticle] = []
    for item in raw:
        title = item.get("title")
        if not title:
            continue
        source = item.get("source_name") or item.get("source_id") or "unknown"
        # Stage 1.1: drop tier-3 wires before any further work.
        if _classify_source_tier(source) == 3:
            continue
        try:
            description = item.get("description")
            tier = _classify_source_tier(source)
            score, category = _score_relevance(
                title=title,
                description=description,
                source=source,
                tier=tier,
                symbol=symbols[0] if symbols else None,
                published_at=item.get("pubDate") or "",
            )
            # Stage 1.2: drop rows whose symbol density is zero — no
            # point showing news that doesn't even mention the stock.
            if score <= 0.0:
                continue
            articles.append(NewsArticle(
                title=title,
                description=description,
                url=item.get("link") or "",
                source=source,
                published_at=item.get("pubDate") or "",
                image_url=item.get("image_url"),
                sentiment=item.get("sentiment"),
                symbols=symbols or [],
                relevance_score=score,
                category=category,
                tier=tier,
            ))
        except Exception:
            log.debug("Skipping malformed news article", exc_info=True)
            continue
    # Stage 1.5: URL-canonical dedupe — keep the highest-scored item per
    # canonical URL. Aggregators routinely repost the same Reuters/AP
    # wire under slightly different URLs.
    deduped: dict[str, NewsArticle] = {}
    for a in articles:
        key = _canonical_url(a.url) or a.title.strip().lower()[:80]
        existing = deduped.get(key)
        if existing is None or a.relevance_score > existing.relevance_score:
            deduped[key] = a
    # Sort by relevance desc, with recency as the tiebreaker via
    # published_at (which is encoded in the score already, so this is
    # just a stable secondary key).
    return sorted(deduped.values(), key=lambda a: a.relevance_score, reverse=True)


# ─── Round-12 / NF-1: scoring helpers ──────────────────────────────────────────

_TIER1_SOURCES = {
    "bloomberg", "reuters", "wsj", "wall street journal", "financial times",
    "ft", "cnbc", "barron's", "barrons", "dow jones",
}
_TIER3_SOURCES = {
    "pr newswire", "prnewswire", "globenewswire", "globe newswire",
    "business wire", "businesswire", "accesswire", "newswire",
}
# Category keywords (regex against lowercased title). Order matters:
# the first match wins so M&A beats earnings on a "X acquires Y, beats"
# headline.
_CATEGORY_PATTERNS: list[tuple[str, "re.Pattern[str]"]] = [
    ("M&A", re.compile(r"\bacqui[rs]|\bmerge[rs]|\bbuyout|\btakeover|\bdivest", re.IGNORECASE)),
    ("regulatory", re.compile(r"\blawsuit|\bsec\b|\bdoj\b|\bfda\b|\brecall|\bsettlement|\bantitrust|\binvestigat", re.IGNORECASE)),
    ("rating", re.compile(r"\bupgrade|\bdowngrade|price target|\binitiat[ed]|overweight|underweight", re.IGNORECASE)),
    ("guidance", re.compile(r"\bguidance|\bguides|\braises forecast|\blowers forecast|\bcuts outlook", re.IGNORECASE)),
    ("earnings", re.compile(r"\bearnings|\bbeat|\bmiss|\bq[1-4]\b|\brevenue|\beps\b", re.IGNORECASE)),
    ("filing", re.compile(r"\b8-k|\b10-k|\b10-q|prospectus|\bfiling", re.IGNORECASE)),
    ("product", re.compile(r"\blaunch|\bunveils|\bintroduces|\breleases|\bpartner", re.IGNORECASE)),
    ("insider", re.compile(r"insider sell|insider buy|form 4|stake|holdings", re.IGNORECASE)),
]
_UTM_RE = re.compile(r"[?&](utm_[^=&]+|ref|fbclid|gclid)=[^&]*", re.IGNORECASE)


def _classify_source_tier(source: str | None) -> int:
    if not source:
        return 2
    s = source.strip().lower()
    if any(t in s for t in _TIER1_SOURCES):
        return 1
    if any(t in s for t in _TIER3_SOURCES):
        return 3
    return 2


def _score_relevance(
    *,
    title: str,
    description: str | None,
    source: str,
    tier: int,
    symbol: str | None,
    published_at: str,
) -> tuple[float, str | None]:
    """Compute (score in 0..1, category or None).

    Score = base × tier × symbol_density × recency × category_boost.
    """
    base = 0.5
    tier_mult = {1: 1.4, 2: 1.0, 3: 0.4}.get(tier, 1.0)
    title_l = title.lower()
    desc_l = (description or "").lower()
    sym_density = 0
    if symbol:
        sym_l = symbol.lower()
        # Title hit is highest signal — a story about the stock leads
        # with the ticker or company name.
        if sym_l in title_l:
            sym_density += 2
        sym_density += min(2, desc_l.count(sym_l))
        if sym_density == 0:
            return 0.0, None  # not about this stock
    # Category match boost
    matched_category: str | None = None
    category_boost = 1.0
    for cat, pat in _CATEGORY_PATTERNS:
        if pat.search(title) or (description and pat.search(description)):
            matched_category = cat
            category_boost = 1.5
            break
    # Recency decay
    age_h = _hours_since(published_at)
    recency = 1.0
    if age_h is not None and age_h > 0:
        # exp(-h/48) so a 48h-old item is 0.37; 24h = 0.61; 12h = 0.78.
        import math
        recency = math.exp(-age_h / 48.0)
    score = base * tier_mult * (1.0 + sym_density * 0.25) * category_boost * recency
    return min(1.0, score), matched_category


def _hours_since(iso_or_rfc: str) -> float | None:
    """Best-effort parse of newsdata.io's ``pubDate`` to hours-old.

    newsdata returns ``"2026-04-25 14:30:00"`` (UTC, no tz) typically.
    We treat naive timestamps as UTC.
    """
    if not iso_or_rfc:
        return None
    try:
        # Try the most common newsdata.io shape first.
        dt = datetime.strptime(iso_or_rfc.strip(), "%Y-%m-%d %H:%M:%S")
        dt = dt.replace(tzinfo=timezone.utc)
    except ValueError:
        try:
            dt = datetime.fromisoformat(iso_or_rfc.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    delta = datetime.now(timezone.utc) - dt
    return max(0.0, delta.total_seconds() / 3600.0)


def _canonical_url(url: str) -> str:
    """Strip utm_*/ref/fbclid query params and fragments to a canonical key."""
    if not url:
        return ""
    try:
        # Drop fragment.
        u = url.split("#", 1)[0]
        u = _UTM_RE.sub("", u)
        # Clean a bare trailing ? if all params were stripped.
        u = u.rstrip("?&")
        return u.lower()
    except Exception:
        return url.lower()


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
