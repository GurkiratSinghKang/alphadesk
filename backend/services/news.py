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
from typing import Literal, Sequence

import httpx
from pydantic import BaseModel, field_validator

log = logging.getLogger("alphadesk.news")

# Batch W (HARDCODING-SWEEP): host lives on
# ``settings.NEWSDATA_BASE_URL``; the ``/news`` segment is appended
# here so other Newsdata routes can reuse the same base if added later.
from core.config import settings as _settings_w_news  # noqa: E402

NEWSDATA_BASE = f"{_settings_w_news.NEWSDATA_BASE_URL}/news"
del _settings_w_news
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
    # B2.1: directional sentiment from a keyword heuristic on the
    # headline. Always one of "bullish" / "bearish" / "neutral" — the
    # raw upstream sentiment string (or "ONLY AVAILABLE IN
    # PROFESSIONAL AND CORPORATE PLANS" tier-gated upsell text from
    # newsdata.io) is filtered out via ``_clean_upstream_sentiment``
    # before the heuristic runs.
    sentiment: Literal["bullish", "bearish", "neutral"] = "neutral"
    # B2.1: estimated magnitude of move the headline suggests. "large"
    # for shock-language ("blockbuster", "plunge"), "medium" for
    # softer signals ("concerns", "drops"), "small" otherwise.
    magnitude: Literal["small", "medium", "large"] = "small"
    # B2.1: confidence (0..1) for the sentiment classification. Stays
    # near 0.5 unless multiple positive/negative signals stack in the
    # same direction.
    confidence: float = 0.5
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
    # B2.6: source priority pass-through (newsdata.io ``source_priority``).
    # Lower number = higher tier; FE renders a star icon for tier-1
    # priority < 100 (Reuters/Bloomberg/WSJ).
    source_priority: int | None = None
    # B2.4: dedupe collapse — when this article is the canonical
    # representative of a cluster, ``duplicate_count`` is the number of
    # other near-duplicate articles that were rolled up. ``0`` means the
    # article stands alone.
    duplicate_count: int = 0

    @field_validator("sentiment", mode="before")
    @classmethod
    def _coerce_sentiment(cls, v: object) -> str:
        """B2.25 / B2.1: tolerate legacy vocabulary ("positive" /
        "negative") and tier-gated upsell strings. Map them to the
        canonical bullish / bearish / neutral set; default unknowns to
        "neutral" so the Literal validator passes."""
        if v is None:
            return "neutral"
        if isinstance(v, str):
            sl = v.strip().lower()
            if not sl or _is_upsell_string(sl):
                return "neutral"
            if sl in ("bullish", "positive", "pos", "+"):
                return "bullish"
            if sl in ("bearish", "negative", "neg", "-"):
                return "bearish"
            if sl in ("neutral", "neu", "n"):
                return "neutral"
            return "neutral"
        return "neutral"

    @field_validator("magnitude", mode="before")
    @classmethod
    def _coerce_magnitude(cls, v: object) -> str:
        if v is None:
            return "small"
        if isinstance(v, str):
            sl = v.strip().lower()
            if sl in ("small", "medium", "large"):
                return sl
            return "small"
        return "small"

    @field_validator("confidence", mode="before")
    @classmethod
    def _coerce_confidence(cls, v: object) -> float:
        if v is None:
            return 0.5
        try:
            return max(0.0, min(1.0, float(v)))
        except (TypeError, ValueError):
            return 0.5


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
    "GOOG": "Google Alphabet",
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


def _match_terms_for_symbol(symbol: str | None) -> list[str]:
    """Return ticker + company aliases used to decide if a story is about a symbol.

    Newsdata queries include both ticker and company name (for example
    ``"AAPL Apple"``), but many publisher headlines use only the company
    name. The old relevance filter only looked for the ticker itself, so a
    perfectly relevant "Apple reports earnings" headline was dropped before
    it reached the earnings-options Claude prompt.
    """
    if not symbol:
        return []
    sym = symbol.upper().strip()
    terms: list[str] = [sym]
    company_query = _company_query(sym)
    for part in company_query.split():
        cleaned = part.strip()
        if cleaned and cleaned.upper() != sym:
            terms.append(cleaned)
    # Stable de-dupe while preserving ticker-first priority.
    seen: set[str] = set()
    out: list[str] = []
    for term in terms:
        key = term.lower()
        if key not in seen:
            seen.add(key)
            out.append(term)
    return out


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

    The ``symbols`` parameter (when given) lets the relevance check use
    the actual ticker plus known company aliases. This keeps company-name
    headlines, while still dropping generic market stories that do not
    mention the ticker or company anywhere meaningful.
    """
    articles: list[NewsArticle] = []
    primary_symbol = symbols[0] if symbols else None
    company_name = _TICKER_NAMES.get((primary_symbol or "").upper()) if primary_symbol else None
    for item in raw:
        title = item.get("title")
        if not title:
            continue
        # B2.26: prefer source_name → source_id (capitalized) → URL host.
        source = _resolve_source(item)
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
                symbol=primary_symbol,
                match_terms=_match_terms_for_symbol(primary_symbol),
                published_at=item.get("pubDate") or "",
            )
            # Stage 1.2: drop rows whose symbol density is zero — no
            # point showing news that doesn't even mention the stock.
            if score <= 0.0:
                continue
            # B2.27: when upstream relevance is plan-gated, fall back to
            # a basic compute. We keep ``relevance_score`` as the
            # internal ranking signal and let _compute_relevance feed the
            # FE's article.relevance display.
            upstream_relevance = _clean_upstream_relevance(item.get("relevance"))
            if upstream_relevance is None:
                computed_relevance = compute_relevance(
                    title=title,
                    description=description,
                    symbol=primary_symbol,
                    company=company_name,
                )
            else:
                computed_relevance = upstream_relevance
            # B2.3: tighten the earnings category so geopolitical
            # / macro headlines don't get mis-tagged.
            category = _tighten_earnings_category(
                category=category,
                title=title,
                description=description,
                symbol=primary_symbol,
                company=company_name,
            )
            # B2.25: strip plan-tier upsell text from upstream sentiment.
            _ = _clean_upstream_sentiment(item.get("sentiment"))
            # B2.1: classify sentiment + magnitude + confidence from
            # title keywords (cheap, deterministic).
            sentiment_label, confidence = _classify_sentiment(title, description)
            magnitude = _classify_magnitude(title, description)
            articles.append(NewsArticle(
                title=title,
                description=description,
                url=item.get("link") or "",
                source=source,
                published_at=item.get("pubDate") or "",
                image_url=item.get("image_url"),
                sentiment=sentiment_label,
                magnitude=magnitude,
                confidence=confidence,
                symbols=symbols or [],
                relevance_score=max(score, computed_relevance),
                category=category,
                tier=tier,
                source_priority=_resolve_source_priority(item),
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
    sorted_articles = sorted(deduped.values(), key=lambda a: a.relevance_score, reverse=True)
    # B2.4: collapse near-duplicate articles (Jaccard > 0.5 on title
    # tokens AND within 24h of each other) into a single canonical with
    # a duplicate_count tag.
    return _dedupe_similar_articles(sorted_articles)


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
# Round-13 / RD-6 (P1): the previous regex consumed the leading ``?`` along
# with the first ``utm_*=…`` param. ``foo?utm_source=a&id=42`` became
# ``foo&id=42`` (with ``&`` where ``?`` should be), so the canonical key
# for ``foo?id=42`` and ``foo?utm_source=a&id=42`` diverged and dedupe
# missed the syndicated repost. Now we match either ``?p=v`` (first
# param) or ``&p=v`` (subsequent) and rebuild the param list cleanly.
_UTM_PARAM_NAMES = ("utm_source", "utm_medium", "utm_campaign", "utm_term",
                    "utm_content", "ref", "fbclid", "gclid")


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
    match_terms: Sequence[str] | None = None,
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
    terms = [t.lower() for t in (match_terms or ([symbol] if symbol else [])) if t]
    if terms:
        # Title hit is highest signal — a story about the stock often leads
        # with either the ticker ("AAPL") or company name ("Apple").
        title_hits = 0
        desc_hits = 0
        for term in terms:
            if len(term) <= 2:
                pat = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE)
                if pat.search(title):
                    title_hits += 1
                desc_hits += len(pat.findall(description or ""))
            else:
                if term in title_l:
                    title_hits += 1
                desc_hits += desc_l.count(term)
        if title_hits:
            sym_density += min(3, title_hits * 2)
        sym_density += min(2, desc_hits)
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


# ---------------------------------------------------------------------------
# B2.25 / B2.26 / B2.27 / B2.1 / B2.3 / B2.4 — Newsdata sanitization helpers
# ---------------------------------------------------------------------------

# B2.25: newsdata.io free / starter tiers return a literal upsell string
# in the ``sentiment`` and ``relevance`` fields rather than ``null`` when
# the feature isn't included on our plan. Strip these so we never leak
# them into the FE.
_UPSELL_TOKENS = ("ONLY AVAILABLE", "PROFESSIONAL", "CORPORATE", " PLAN")


def _is_upsell_string(value: object) -> bool:
    """True if ``value`` looks like a Newsdata plan-tier upsell string."""
    if not isinstance(value, str):
        return False
    upper = value.upper()
    return any(tok in upper for tok in _UPSELL_TOKENS)


def _clean_upstream_sentiment(raw: object) -> str | None:
    """Return the upstream sentiment string only if it is real data.

    Newsdata returns a hard-coded plan-tier upsell string when sentiment
    is gated. We strip those before the data ever reaches the FE.
    """
    if _is_upsell_string(raw):
        return None
    if isinstance(raw, str) and raw.strip():
        return raw.strip().lower()
    return None


def _clean_upstream_relevance(raw: object) -> float | None:
    """Drop tier-gated relevance strings; pass through real numbers."""
    if _is_upsell_string(raw):
        return None
    if isinstance(raw, (int, float)):
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None
    if isinstance(raw, str):
        try:
            return float(raw)
        except ValueError:
            return None
    return None


def _resolve_source(item: dict) -> str:
    """B2.26: derive the display source name from an item.

    Newsdata returns ``source_name`` (which may be null) and
    ``source_id`` (a slug like ``"benzinga"``). When both are missing we
    fall back to parsing the article URL hostname.
    """
    source_name = item.get("source_name")
    if isinstance(source_name, str) and source_name.strip():
        return source_name.strip()
    source_id = item.get("source_id")
    if isinstance(source_id, str) and source_id.strip():
        slug = source_id.strip()
        # Capitalize tokens — "yahoo finance" → "Yahoo Finance",
        # "benzinga" → "Benzinga", "the-wall-street-journal" → "The
        # Wall Street Journal".
        normalized = re.sub(r"[-_]+", " ", slug)
        return " ".join(part.capitalize() for part in normalized.split() if part)
    url = item.get("link") or ""
    if isinstance(url, str) and url:
        try:
            from urllib.parse import urlparse

            host = urlparse(url).hostname or ""
            host = host.removeprefix("www.")
            if host:
                core = host.split(".")[0]
                return core.capitalize() if core else host
        except Exception:
            pass
    return "unknown"


def _resolve_source_priority(item: dict) -> int | None:
    """Pull Newsdata's source_priority field if it's a real integer."""
    raw = item.get("source_priority")
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float):
        return int(raw)
    if isinstance(raw, str):
        try:
            return int(raw)
        except ValueError:
            return None
    return None


# B2.1: keyword-based sentiment classifier on the headline. Fast, cheap,
# and "good enough" for at-a-glance — we deliberately avoid an ML
# pipeline here because (a) the news rail re-renders frequently, (b)
# upstream Newsdata sentiment is plan-gated, and (c) headlines are
# short enough that bag-of-words stays accurate.
_BULLISH_TERMS = (
    "tops estimates", "tops expectations", "beats estimates", "beats expectations",
    "beats", "tops", "rally", "rallies", "rallying", "surge", "surges", "surging",
    "soars", "soar", "soaring", "jump", "jumps", "jumping", "climbs",
    "raises guidance", "raises forecast", "raises outlook", "upgrade", "upgraded",
    "outperform", "buyback", "record", "all-time high", "blockbuster",
    "strong", "robust", "exceeds", "boost",
)
_BEARISH_TERMS = (
    "misses estimates", "misses expectations", "miss", "missed", "tumble",
    "tumbles", "plunge", "plunges", "plunged", "warns", "warning", "downgrade",
    "downgraded", "underperform", "lowers guidance", "lowers forecast",
    "cuts outlook", "guidance cut", "lawsuit", "investigation", "probe",
    "fraud", "recall", "bankruptcy", "delays", "concerns", "questions",
    "drops", "slump", "slumps", "weak", "weakness", "decline", "declines",
    "loss", "shortfall", "halt", "halted",
)
_LARGE_MAGNITUDE_TERMS = (
    "blockbuster", "surge", "surges", "surged", "plunge", "plunges", "plunged",
    "explosive", "soar", "soars", "tumble", "tumbles", "tumbled", "rally",
    "skyrockets", "crash", "crashes", "all-time high", "record high",
)
_MEDIUM_MAGNITUDE_TERMS = (
    "concerns", "questions", "drops", "slump", "slumps", "decline", "declines",
    "delays", "warns", "warning", "cuts", "raises",
)


def _classify_sentiment(
    title: str,
    description: str | None = None,
) -> tuple[Literal["bullish", "bearish", "neutral"], float]:
    """Return (label, confidence) using a simple keyword heuristic.

    Confidence stays near 0.5 unless multiple signals stack in the same
    direction (then 0.7+). Mixed signals fall back to neutral with low
    confidence.
    """
    haystack = f"{title} {description or ''}".lower()
    bullish_hits = sum(1 for term in _BULLISH_TERMS if term in haystack)
    bearish_hits = sum(1 for term in _BEARISH_TERMS if term in haystack)
    if bullish_hits == 0 and bearish_hits == 0:
        return "neutral", 0.5
    if bullish_hits > bearish_hits:
        # 1 hit -> 0.6, 2 -> 0.75, 3+ -> 0.85 (cap)
        confidence = min(0.85, 0.5 + 0.1 * bullish_hits + 0.05 * max(0, bullish_hits - bearish_hits - 1))
        return "bullish", round(confidence, 2)
    if bearish_hits > bullish_hits:
        confidence = min(0.85, 0.5 + 0.1 * bearish_hits + 0.05 * max(0, bearish_hits - bullish_hits - 1))
        return "bearish", round(confidence, 2)
    # Equal hits — conflicting signals.
    return "neutral", 0.4


def _classify_magnitude(title: str, description: str | None = None) -> Literal["small", "medium", "large"]:
    """Return small / medium / large from a keyword scan."""
    haystack = f"{title} {description or ''}".lower()
    if any(term in haystack for term in _LARGE_MAGNITUDE_TERMS):
        return "large"
    if any(term in haystack for term in _MEDIUM_MAGNITUDE_TERMS):
        return "medium"
    return "small"


# B2.27: Compute a basic relevance score client-side from symbol +
# company name presence. Returns a value in [0.0, 1.0] suitable as a
# fallback when Newsdata's ``relevance`` is unavailable.
def compute_relevance(
    *,
    title: str,
    description: str | None,
    symbol: str | None,
    company: str | None = None,
) -> float:
    """Lightweight relevance: 1.0 if symbol/company appears in title,
    0.5 if only in description, 0.0 otherwise."""
    if not symbol and not company:
        return 0.0
    title_l = (title or "").lower()
    desc_l = (description or "").lower()
    needles: list[str] = []
    if symbol:
        needles.append(symbol.lower())
    if company:
        # Match individual company tokens too — "Advanced Micro Devices"
        # often appears as "AMD" or partial names in headlines.
        needles.append(company.lower())
        for token in company.split():
            tok = token.strip().lower()
            if tok and len(tok) >= 3 and tok != (symbol or "").lower():
                needles.append(tok)
    # Title hit takes precedence.
    for needle in needles:
        if needle and needle in title_l:
            return 1.0
    for needle in needles:
        if needle and needle in desc_l:
            return 0.5
    return 0.0


# B2.3: Tighten the EARNINGS category — only tag earnings if the title
# mentions the symbol or company AND an earnings-related keyword. This
# keeps geopolitical or macro headlines from being mis-tagged as
# EARNINGS just because they contain the word "earnings" in passing.
_EARNINGS_KEYWORDS = re.compile(
    r"\b(earnings|beat|miss|beats|misses|q[1-4]\b|revenue|eps|profit|loss|"
    r"results|reports|reported|outlook|guidance)\b",
    re.IGNORECASE,
)


def _tighten_earnings_category(
    *,
    category: str | None,
    title: str,
    description: str | None,
    symbol: str | None,
    company: str | None,
) -> str | None:
    """Demote a "earnings" tag to ``None`` (then later relabeled GENERAL
    in the FE) when the title doesn't actually mention the company."""
    if category != "earnings":
        return category
    if not _EARNINGS_KEYWORDS.search(title or ""):
        return None
    needles: list[str] = []
    if symbol:
        needles.append(symbol.lower())
    if company:
        needles.append(company.lower())
        for token in company.split():
            tok = token.strip().lower()
            if tok and len(tok) >= 3 and tok != (symbol or "").lower():
                needles.append(tok)
    title_l = (title or "").lower()
    desc_l = (description or "").lower()
    if any(n and (n in title_l or n in desc_l) for n in needles):
        return "earnings"
    return None


# B2.4: dedupe near-duplicate articles via Jaccard word similarity on
# titles, gated by a 24-hour publish window.
_TITLE_TOKEN_STOPWORDS = {
    "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "vs",
    "with", "as", "at", "by", "from", "that", "this", "is", "are",
}


def _title_tokens(title: str) -> set[str]:
    if not title:
        return set()
    tokens = re.findall(r"[a-z0-9]+", title.lower())
    return {t for t in tokens if t and t not in _TITLE_TOKEN_STOPWORDS and len(t) > 1}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def _parse_publish_dt(raw: str) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.strptime(raw.strip(), "%Y-%m-%d %H:%M:%S")
        return dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, TypeError):
            return None


def _dedupe_similar_articles(articles: list[NewsArticle]) -> list[NewsArticle]:
    """Cluster articles whose titles are >50% Jaccard-similar AND
    publish within 24h of each other; keep the canonical (highest
    relevance, then newest) and stamp duplicate_count on it.
    """
    if len(articles) <= 1:
        return list(articles)
    # Cache token sets + parsed datetimes once per article.
    enriched = [
        (a, _title_tokens(a.title), _parse_publish_dt(a.published_at))
        for a in articles
    ]
    n = len(enriched)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: int, y: int) -> None:
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[rx] = ry

    for i in range(n):
        for j in range(i + 1, n):
            ai, ti, di = enriched[i]
            aj, tj, dj = enriched[j]
            if _jaccard(ti, tj) <= 0.5:
                continue
            if di and dj:
                if abs((di - dj).total_seconds()) > 24 * 3600:
                    continue
            union(i, j)

    clusters: dict[int, list[int]] = {}
    for idx in range(n):
        clusters.setdefault(find(idx), []).append(idx)

    canonical: list[NewsArticle] = []
    for members in clusters.values():
        if len(members) == 1:
            canonical.append(enriched[members[0]][0])
            continue
        # Pick: highest relevance_score; tie-break on newest publish.
        best_idx = members[0]
        for cand in members[1:]:
            a_best = enriched[best_idx][0]
            a_cand = enriched[cand][0]
            if a_cand.relevance_score > a_best.relevance_score:
                best_idx = cand
            elif a_cand.relevance_score == a_best.relevance_score:
                d_best = enriched[best_idx][2]
                d_cand = enriched[cand][2]
                if d_best is None and d_cand is not None:
                    best_idx = cand
                elif d_cand and d_best and d_cand > d_best:
                    best_idx = cand
        winner = enriched[best_idx][0].model_copy()
        winner.duplicate_count = len(members) - 1
        canonical.append(winner)
    # Preserve the relevance-desc ordering the caller produced.
    canonical.sort(key=lambda a: a.relevance_score, reverse=True)
    return canonical


def _canonical_url(url: str) -> str:
    """Strip utm_*/ref/fbclid query params and fragments to a canonical key.

    Round-13 / RD-6 (P1): rebuild the param list rather than substituting
    in-place — the previous in-place ``re.sub`` mangled the URL when a
    tracker was the FIRST query param (``?utm_source=…&id=42`` →
    ``&id=42``). Now: parse, drop tracker keys, re-emit with a clean
    leading ``?``.
    """
    if not url:
        return ""
    try:
        from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

        parsed = urlparse(url)
        # Drop fragment + filter tracker params (case-insensitive).
        params = [
            (k, v)
            for (k, v) in parse_qsl(parsed.query, keep_blank_values=False)
            if k.lower() not in _UTM_PARAM_NAMES
        ]
        rebuilt = parsed._replace(query=urlencode(params), fragment="")
        return urlunparse(rebuilt).lower()
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
        # B2.1: derive the new sentiment / magnitude / confidence fields
        # via the same heuristic the live pipeline uses so demo cards
        # render with chips.
        description = "Demo article for development. Configure NEWSDATA_API_KEY for live news."
        sentiment_label, confidence = _classify_sentiment(title, description)
        magnitude = _classify_magnitude(title, description)
        articles.append(NewsArticle(
            title=title,
            description=description,
            url="",
            source=rng.choice(_DEMO_SOURCES),
            published_at=now.strftime("%Y-%m-%d %H:%M:%S"),
            image_url=None,
            sentiment=sentiment_label,
            magnitude=magnitude,
            confidence=confidence,
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

    # Always try real API first; fall back to demo only on failure.
    # V1.1 — demo articles must never leak when an API key is configured.
    # Production was rendering "Wall Street consensus: TSLA is top pick"
    # style headlines with url="" whenever Newsdata rate-limited the
    # request; users couldn't tell those from real news. Demo is now a
    # local-dev affordance only.
    from core.config import settings as _settings

    is_demo = False
    query = _company_query(symbol)
    raw = await _fetch_newsdata(query, limit)
    articles = _parse_articles(raw, symbols=[symbol])
    has_api_key = bool(_settings.NEWSDATA_API_KEY.get_secret_value())
    if raw and not articles:
        # The provider answered, but none of the rows survived the
        # relevance filter. Treat that as a clean empty result so callers
        # don't show a provider-unavailable warning or feed demo headlines
        # into the earnings thesis.
        log.info("No relevant real news for symbol=%s after filtering", symbol)
    elif not articles and not has_api_key:
        # True dev mode: no key configured, so the empty `raw` is from
        # the early-return in `_fetch_newsdata`. Serve demo headlines so
        # the page is not blank during local development.
        log.info("No NEWSDATA_API_KEY configured for symbol=%s, serving demo headlines", symbol)
        articles = _generate_demo_articles(symbol=symbol, limit=limit)
        is_demo = True
    elif not articles:
        # Production / staging: key IS configured, but the provider
        # errored, timed out, rate-limited, or returned []. Surface as a
        # clean empty result rather than fake headlines.
        log.info(
            "No real news for symbol=%s with key configured (provider transient empty); returning []",
            symbol,
        )
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
