"""
News integration for AlphaDesk via newsdata.io API.

Endpoints:
  GET /api/v1/news/latest?q=AAPL&limit=10
  GET /api/v1/news/market
  GET /api/v1/news/symbol/{symbol}
"""
from __future__ import annotations

import hashlib
import logging
import random
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Query
from pydantic import BaseModel

from core.config import settings
from core.redis import cache_get, cache_set

logger = logging.getLogger("alphadesk.news")

router = APIRouter()

NEWSDATA_BASE = "https://newsdata.io/api/1/latest"
NEWS_CACHE_TTL = 300  # 5 minutes


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


class NewsResponse(BaseModel):
    articles: list[NewsArticle]
    query: str
    count: int


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

async def _fetch_newsdata(query: str, limit: int = 10) -> list[dict]:
    """Fetch articles from newsdata.io. Returns raw article dicts."""
    api_key = settings.NEWSDATA_API_KEY
    if not api_key:
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
                logger.warning("newsdata.io rate limit hit")
                return []
            resp.raise_for_status()
            data = resp.json()
            return data.get("results") or []
    except httpx.ReadTimeout:
        logger.warning("newsdata.io read timeout for query=%r (30s)", query)
        return []
    except httpx.HTTPStatusError as e:
        logger.error("newsdata.io fetch failed (HTTP %d): %s", e.response.status_code, e.response.text[:200])
        return []
    except Exception as e:
        logger.error("newsdata.io fetch failed: %s: %s", type(e).__name__, e)
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
        except Exception as e:
            logger.debug("Skipping malformed news article: %s", e)
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
            url=f"https://example.com/news/{i}",
            source=rng.choice(_DEMO_SOURCES),
            published_at=now.strftime("%Y-%m-%d %H:%M:%S"),
            image_url=None,
            sentiment=item.get("sentiment"),
            symbols=syms,
        ))
    return articles


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _cache_key(prefix: str, query: str, limit: int) -> str:
    return f"news:{prefix}:{query.upper()}:{limit}"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/latest", response_model=NewsResponse)
async def get_latest_news(
    q: str = Query("stock market", description="Search query"),
    limit: int = Query(10, ge=1, le=50),
) -> NewsResponse:
    """Fetch latest news articles matching a query."""
    cache_k = _cache_key("latest", q, limit)
    cached = await cache_get(cache_k)
    if cached:
        return NewsResponse(**cached)

    if settings.NEWSDATA_API_KEY:
        raw = await _fetch_newsdata(q, limit)
        articles = _parse_articles(raw)
    else:
        articles = _generate_demo_articles(symbol=q if q != "stock market" else None, limit=limit)

    response = NewsResponse(articles=articles, query=q, count=len(articles))
    await cache_set(cache_k, response.model_dump(), ttl_seconds=NEWS_CACHE_TTL)
    return response


@router.get("/market", response_model=NewsResponse)
async def get_market_news() -> NewsResponse:
    """Fetch general market news."""
    cache_k = _cache_key("market", "general", 10)
    cached = await cache_get(cache_k)
    if cached:
        return NewsResponse(**cached)

    if settings.NEWSDATA_API_KEY:
        raw = await _fetch_newsdata("stock market finance", 10)
        articles = _parse_articles(raw)
    else:
        articles = _generate_demo_articles(symbol=None, limit=10)

    response = NewsResponse(articles=articles, query="market", count=len(articles))
    await cache_set(cache_k, response.model_dump(), ttl_seconds=NEWS_CACHE_TTL)
    return response


@router.get("/symbol/{symbol}", response_model=NewsResponse)
async def get_symbol_news(
    symbol: str,
    limit: int = Query(10, ge=1, le=50),
) -> NewsResponse:
    """Fetch news for a specific stock symbol."""
    symbol = symbol.upper()
    cache_k = _cache_key("symbol", symbol, limit)
    cached = await cache_get(cache_k)
    if cached:
        return NewsResponse(**cached)

    if settings.NEWSDATA_API_KEY:
        query = _company_query(symbol)
        raw = await _fetch_newsdata(query, limit)
        articles = _parse_articles(raw, symbols=[symbol])
    else:
        articles = _generate_demo_articles(symbol=symbol, limit=limit)

    response = NewsResponse(articles=articles, query=symbol, count=len(articles))
    await cache_set(cache_k, response.model_dump(), ttl_seconds=NEWS_CACHE_TTL)
    return response


# ---------------------------------------------------------------------------
# Helper used by the daily pipeline
# ---------------------------------------------------------------------------

async def fetch_news_for_symbol(symbol: str, limit: int = 5) -> list[str]:
    """Return a list of headline strings for a symbol (for pipeline use).

    Uses cache and falls back to demo headlines when API key is missing.
    """
    cache_k = _cache_key("pipeline", symbol, limit)
    cached = await cache_get(cache_k)
    if cached:
        return cached  # type: ignore[return-value]

    if settings.NEWSDATA_API_KEY:
        query = _company_query(symbol)
        raw = await _fetch_newsdata(query, limit)
        headlines = [r["title"] for r in raw if r.get("title")][:limit]
    else:
        articles = _generate_demo_articles(symbol=symbol, limit=limit)
        headlines = [a.title for a in articles]

    await cache_set(cache_k, headlines, ttl_seconds=NEWS_CACHE_TTL)
    return headlines
