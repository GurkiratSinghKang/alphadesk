from __future__ import annotations

import hashlib
import logging
import random
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from core.config import settings
from core.redis import cache_get, cache_set

logger = logging.getLogger(__name__)

router = APIRouter()

ANALYSIS_CACHE_TTL = 600  # 10 minutes


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class AnalysisRequest(BaseModel):
    agents: list[str] = Field(
        default=["technical", "fundamental", "sentiment", "options"],
        description="List of agent types to run",
    )
    timeframe: str = Field("swing", description="Analysis timeframe: scalp, day, swing, position")
    depth: str = Field("standard", description="Analysis depth: quick, standard, deep")


class AgentResult(BaseModel):
    agent: str
    score: float = Field(..., ge=-100, le=100)
    conviction: str = Field(..., description="low, medium, high")
    summary: str
    details: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime


class AnalysisResponse(BaseModel):
    symbol: str
    composite_score: float
    composite_conviction: str
    recommendation: str = Field(..., description="strong_buy, buy, hold, sell, strong_sell")
    agent_results: list[AgentResult]
    trade_ideas: list[dict[str, Any]] = Field(default_factory=list)
    analyzed_at: datetime
    is_demo: bool = False


# ---------------------------------------------------------------------------
# Real data fetchers
# ---------------------------------------------------------------------------

async def _fetch_alpaca_bars(symbol: str, limit: int = 60) -> list[dict]:
    """Fetch daily bars from Alpaca for technical analysis."""
    api_key = settings.ALPACA_API_KEY.get_secret_value()
    secret_key = settings.ALPACA_SECRET_KEY.get_secret_value()
    if not api_key or not secret_key:
        return []
    headers = {
        "APCA-API-KEY-ID": api_key,
        "APCA-API-SECRET-KEY": secret_key,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://data.alpaca.markets/v2/stocks/{symbol}/bars",
                headers=headers,
                params={"timeframe": "1Day", "limit": limit, "feed": "sip"},
            )
            if resp.status_code != 200:
                logger.warning("Alpaca bars API returned %d for %s", resp.status_code, symbol)
                return []
            return resp.json().get("bars", [])
    except Exception as e:
        logger.warning("Alpaca bars fetch failed for %s: %s", symbol, e)
        return []


async def _fetch_polygon_ticker(symbol: str) -> dict:
    """Fetch ticker details from Polygon for fundamental data."""
    api_key = settings.POLYGON_API_KEY.get_secret_value()
    if not api_key:
        return {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.polygon.io/v3/reference/tickers/{symbol}",
                params={"apiKey": api_key},
            )
            if resp.status_code != 200:
                logger.warning("Polygon ticker API returned %d for %s", resp.status_code, symbol)
                return {}
            return resp.json().get("results", {})
    except Exception as e:
        logger.warning("Polygon ticker fetch failed for %s: %s", symbol, e)
        return {}


def _compute_technicals(bars: list[dict]) -> dict[str, Any]:
    """Compute RSI, EMAs, ATR, support/resistance from Alpaca bar data."""
    if len(bars) < 15:
        return {}

    closes = [b["c"] for b in bars]
    highs = [b["h"] for b in bars]
    lows = [b["l"] for b in bars]
    volumes = [b["v"] for b in bars]
    current = closes[-1]
    high_period = max(closes)
    low_period = min(closes)

    # 20-day EMA
    ema20 = current
    if len(closes) >= 20:
        ema20 = sum(closes[:20]) / 20
        mult = 2 / 21
        for c in closes[20:]:
            ema20 = c * mult + ema20 * (1 - mult)

    # 50-day EMA
    ema50 = None
    if len(closes) >= 50:
        ema50 = sum(closes[:50]) / 50
        mult50 = 2 / 51
        for c in closes[50:]:
            ema50 = c * mult50 + ema50 * (1 - mult50)

    # RSI(14)
    rsi = 50.0
    if len(closes) >= 15:
        gains, losses_vals = [], []
        for i in range(-14, 0):
            change = closes[i] - closes[i - 1]
            gains.append(max(change, 0))
            losses_vals.append(max(-change, 0))
        avg_gain = sum(gains) / 14
        avg_loss = sum(losses_vals) / 14
        if avg_loss == 0:
            rsi = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))

    # ATR(14)
    atr = 0.0
    if len(closes) >= 15:
        true_ranges = []
        for i in range(-14, 0):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
            true_ranges.append(tr)
        atr = sum(true_ranges) / 14

    # Volume analysis
    avg_vol = sum(volumes[-20:]) / min(20, len(volumes))
    latest_vol = volumes[-1]
    vol_ratio = latest_vol / avg_vol if avg_vol > 0 else 1.0

    # Simple support/resistance from recent lows/highs
    recent_lows = lows[-20:] if len(lows) >= 20 else lows
    recent_highs = highs[-20:] if len(highs) >= 20 else highs
    support = min(recent_lows)
    resistance = max(recent_highs)

    # Trend determination
    above_ema20 = current > ema20
    above_ema50 = ema50 is not None and current > ema50
    if above_ema20 and above_ema50:
        trend = "bullish"
    elif not above_ema20 and (ema50 is None or not above_ema50):
        trend = "bearish"
    else:
        trend = "neutral"

    # MACD (12/26/9)
    macd_signal = "neutral"
    if len(closes) >= 26:
        ema12 = sum(closes[:12]) / 12
        m12 = 2 / 13
        for c in closes[12:]:
            ema12 = c * m12 + ema12 * (1 - m12)
        ema26 = sum(closes[:26]) / 26
        m26 = 2 / 27
        for c in closes[26:]:
            ema26 = c * m26 + ema26 * (1 - m26)
        macd_line = ema12 - ema26
        macd_signal = "bullish" if macd_line > 0 else "bearish"

    return {
        "current_price": round(current, 2),
        "rsi_14": round(rsi, 1),
        "ema_20": round(ema20, 2),
        "ema_50": round(ema50, 2) if ema50 else None,
        "atr_14": round(atr, 2),
        "support": round(support, 2),
        "resistance": round(resistance, 2),
        "trend": trend,
        "macd_signal": macd_signal,
        "volume_ratio": round(vol_ratio, 2),
        "volume_trend": "above_average" if vol_ratio > 1.1 else "below_average" if vol_ratio < 0.9 else "average",
        "high_period": round(high_period, 2),
        "low_period": round(low_period, 2),
        "dist_from_high_pct": round((current - high_period) / high_period * 100, 2),
    }


def _technical_score(tech: dict) -> tuple[float, str]:
    """Derive a score (-100 to 100) and conviction from technicals."""
    score = 0.0
    # RSI contribution: overbought penalty, oversold bonus, middle neutral
    rsi = tech.get("rsi_14", 50)
    if rsi < 30:
        score += 25  # oversold = bullish
    elif rsi < 45:
        score += 10
    elif rsi > 70:
        score -= 25  # overbought = bearish
    elif rsi > 55:
        score -= 5

    # Trend contribution
    trend = tech.get("trend", "neutral")
    if trend == "bullish":
        score += 30
    elif trend == "bearish":
        score -= 30

    # MACD
    macd = tech.get("macd_signal", "neutral")
    if macd == "bullish":
        score += 15
    elif macd == "bearish":
        score -= 15

    # Volume confirmation
    vol_ratio = tech.get("volume_ratio", 1.0)
    if vol_ratio > 1.3 and score > 0:
        score += 10  # volume confirms bullish
    elif vol_ratio > 1.3 and score < 0:
        score -= 10  # volume confirms bearish

    # Distance from high
    dist = tech.get("dist_from_high_pct", 0)
    if dist > -3:
        score += 5  # near highs
    elif dist < -15:
        score -= 5  # well off highs

    score = max(-100, min(100, score))
    conviction = "high" if abs(score) > 50 else "medium" if abs(score) > 20 else "low"
    return round(score, 2), conviction


def _fundamental_score(poly: dict) -> tuple[float, str, dict]:
    """Derive a score from Polygon ticker details."""
    details: dict[str, Any] = {}
    score = 0.0

    name = poly.get("name", "")
    market_cap = poly.get("market_cap", 0)
    sic_desc = poly.get("sic_description", "")
    locale = poly.get("locale", "")
    primary_exchange = poly.get("primary_exchange", "")
    total_employees = poly.get("total_employees", 0)
    list_date = poly.get("list_date", "")
    share_class_shares = poly.get("share_class_shares_outstanding", 0)
    weighted_shares = poly.get("weighted_shares_outstanding", 0)

    details["name"] = name
    details["market_cap"] = market_cap
    details["sector"] = sic_desc
    details["primary_exchange"] = primary_exchange
    details["total_employees"] = total_employees
    details["list_date"] = list_date
    details["shares_outstanding"] = share_class_shares or weighted_shares

    # Score based on available data
    if market_cap:
        if market_cap > 200_000_000_000:  # mega cap
            score += 20
        elif market_cap > 10_000_000_000:  # large cap
            score += 15
        elif market_cap > 2_000_000_000:  # mid cap
            score += 5
        else:
            score -= 5  # small cap = more risk

    if total_employees and total_employees > 1000:
        score += 5  # established company

    # Maturity bonus for companies listed > 5 years
    if list_date:
        try:
            ld = datetime.strptime(list_date, "%Y-%m-%d")
            years_listed = (datetime.now() - ld).days / 365
            if years_listed > 10:
                score += 10
            elif years_listed > 5:
                score += 5
        except Exception:
            pass

    score = max(-100, min(100, score))
    conviction = "medium" if abs(score) > 15 else "low"
    return round(score, 2), conviction, details


# ---------------------------------------------------------------------------
# Real analysis builder
# ---------------------------------------------------------------------------

async def _real_analysis(symbol: str, request: AnalysisRequest) -> AnalysisResponse | None:
    """Build analysis from real Alpaca + Polygon data. Returns None on total failure."""
    import asyncio

    s = symbol.upper()
    now = datetime.now(timezone.utc)

    # Fetch data in parallel
    bars_task = _fetch_alpaca_bars(s, 60)
    poly_task = _fetch_polygon_ticker(s)
    bars, poly_data = await asyncio.gather(bars_task, poly_task)

    if not bars and not poly_data:
        logger.warning("No real data available for %s from Alpaca or Polygon", s)
        return None

    agent_results: list[AgentResult] = []

    for agent_name in request.agents:
        if agent_name == "technical":
            if not bars or len(bars) < 15:
                logger.info("Insufficient bars (%d) for technical analysis of %s", len(bars), s)
                continue
            tech = _compute_technicals(bars)
            score, conviction = _technical_score(tech)
            current = tech.get("current_price", 0)
            ema50_str = " / EMA50 ${}".format(tech["ema_50"]) if tech.get("ema_50") else ""
            summary = (
                f"{s} shows a {tech['trend']} technical setup on the {request.timeframe} timeframe. "
                f"Price ${current} vs EMA20 ${tech['ema_20']}{ema50_str}. "
                f"RSI(14) at {tech['rsi_14']}, MACD {tech['macd_signal']}. "
                f"Support ${tech['support']}, resistance ${tech['resistance']}. "
                f"Volume {tech['volume_trend']} (ratio {tech['volume_ratio']}x)."
            )
            agent_results.append(AgentResult(
                agent="technical", score=score, conviction=conviction,
                summary=summary, details=tech, timestamp=now,
            ))

        elif agent_name == "fundamental":
            if not poly_data:
                logger.info("No Polygon data for fundamental analysis of %s", s)
                continue
            score, conviction, details = _fundamental_score(poly_data)
            mc = details.get("market_cap", 0)
            mc_str = f"${mc / 1e9:.1f}B" if mc > 1e9 else f"${mc / 1e6:.0f}M" if mc > 1e6 else "N/A"
            emp = details.get("total_employees")
            emp_str = ", {:,} employees".format(emp) if emp else ""
            summary = (
                f"{s} ({details.get('sector', 'N/A')}): Market cap {mc_str}. "
                f"Listed on {details.get('primary_exchange', 'N/A')}{emp_str}. "
                f"Listed since {details.get('list_date', 'N/A')}."
            )
            agent_results.append(AgentResult(
                agent="fundamental", score=score, conviction=conviction,
                summary=summary, details=details, timestamp=now,
            ))

        elif agent_name == "sentiment":
            # Derive sentiment from price action (real data proxy)
            if bars and len(bars) >= 5:
                closes = [b["c"] for b in bars]
                volumes = [b["v"] for b in bars]
                recent_5 = closes[-5:]
                five_day_return = (recent_5[-1] - recent_5[0]) / recent_5[0] * 100
                avg_vol_20 = sum(volumes[-20:]) / min(20, len(volumes))
                recent_vol = sum(volumes[-5:]) / 5
                vol_surge = recent_vol / avg_vol_20 if avg_vol_20 > 0 else 1.0

                if five_day_return > 3:
                    sentiment_label = "bullish"
                    score = min(60, round(five_day_return * 8, 2))
                elif five_day_return > 0:
                    sentiment_label = "cautiously optimistic"
                    score = round(five_day_return * 10, 2)
                elif five_day_return > -3:
                    sentiment_label = "cautious"
                    score = round(five_day_return * 10, 2)
                else:
                    sentiment_label = "bearish"
                    score = max(-60, round(five_day_return * 8, 2))

                conviction = "medium" if abs(score) > 20 else "low"
                summary = (
                    f"Sentiment proxy for {s}: {sentiment_label}. "
                    f"5-day price change {five_day_return:+.1f}%. "
                    f"Volume {'surging' if vol_surge > 1.5 else 'elevated' if vol_surge > 1.1 else 'normal'} "
                    f"({vol_surge:.1f}x 20-day avg)."
                )
                details = {
                    "five_day_return_pct": round(five_day_return, 2),
                    "volume_surge_ratio": round(vol_surge, 2),
                    "sentiment_label": sentiment_label,
                    "data_source": "price_action_proxy",
                }
                agent_results.append(AgentResult(
                    agent="sentiment", score=score, conviction=conviction,
                    summary=summary, details=details, timestamp=now,
                ))

        elif agent_name == "options":
            # Options data requires specialized feed; provide what we can from
            # price data (ATR-based IV proxy)
            if bars and len(bars) >= 20:
                tech = _compute_technicals(bars)
                current = tech.get("current_price", 0)
                atr = tech.get("atr_14", 0)
                # Annualized volatility estimate from ATR
                implied_vol = (atr / current * 100 * 16) if current > 0 else 0  # sqrt(252) ~ 16
                iv_rank = min(100, max(0, implied_vol * 2))  # rough proxy

                score = 0.0
                if iv_rank > 50:
                    score = round(20 + (iv_rank - 50) * 0.4, 2)  # premium selling favored
                else:
                    score = round(10 + iv_rank * 0.3, 2)  # directional

                conviction = "medium" if iv_rank > 30 else "low"
                summary = (
                    f"Options proxy for {s}: Estimated IV {implied_vol:.1f}% (annualized from ATR). "
                    f"IV rank proxy ~{iv_rank:.0f}. "
                    f"{'Premium selling strategies favored' if iv_rank > 50 else 'Directional plays may work'}."
                )
                details = {
                    "implied_vol_est": round(implied_vol, 1),
                    "iv_rank_proxy": round(iv_rank, 1),
                    "atr_14": atr,
                    "suggested_strategy": "iron_condor" if iv_rank > 50 else "bull_call_spread",
                    "data_source": "atr_proxy",
                }
                agent_results.append(AgentResult(
                    agent="options", score=score, conviction=conviction,
                    summary=summary, details=details, timestamp=now,
                ))

    if not agent_results:
        return None

    scores = [r.score for r in agent_results]
    composite_score = round(sum(scores) / len(scores), 2)

    convictions_map = {"low": 1, "medium": 2, "high": 3}
    avg_conviction = sum(convictions_map.get(r.conviction, 1) for r in agent_results) / len(agent_results)
    composite_conviction = "high" if avg_conviction >= 2.5 else "medium" if avg_conviction >= 1.5 else "low"

    recommendation = _score_to_recommendation(composite_score)

    # Generate trade ideas from real data
    trade_ideas: list[dict[str, Any]] = []
    # Find the technical result for price data
    tech_result = next((r for r in agent_results if r.agent == "technical"), None)
    if tech_result:
        current = tech_result.details.get("current_price", 0)
        support = tech_result.details.get("support", 0)
        resistance = tech_result.details.get("resistance", 0)
        atr = tech_result.details.get("atr_14", 0)

        if composite_score > 20 and current > 0:
            stop = round(current - 2 * atr, 2) if atr else round(support, 2)
            target = round(current + 3 * atr, 2) if atr else round(resistance, 2)
            rr = round((target - current) / (current - stop), 1) if (current - stop) > 0 else 0
            trade_ideas.append({
                "strategy": "long_equity",
                "description": f"Buy {s} at ${current} with stop at ${stop}",
                "target": target,
                "stop": stop,
                "risk_reward": f"1:{rr}",
            })

    logger.info("Real analysis completed for %s: composite_score=%.2f, agents=%d",
                s, composite_score, len(agent_results))

    return AnalysisResponse(
        symbol=s,
        composite_score=composite_score,
        composite_conviction=composite_conviction,
        recommendation=recommendation,
        agent_results=agent_results,
        trade_ideas=trade_ideas,
        analyzed_at=now,
        is_demo=False,
    )


# ---------------------------------------------------------------------------
# Demo fallback (last resort)
# ---------------------------------------------------------------------------

_DEMO_BASE_PRICES: dict[str, float] = {
    "AAPL": 230.0, "NVDA": 140.0, "TSLA": 275.0, "MSFT": 430.0,
    "AMZN": 195.0, "META": 530.0, "GOOGL": 175.0, "SPY": 590.0,
    "AMD": 165.0, "NFLX": 680.0, "CRM": 310.0,
}

_DEMO_SECTORS: dict[str, str] = {
    "AAPL": "Technology", "NVDA": "Semiconductors", "TSLA": "Automotive/EV",
    "MSFT": "Technology", "AMZN": "E-Commerce/Cloud", "META": "Social Media",
    "GOOGL": "Technology/Advertising", "AMD": "Semiconductors", "NFLX": "Streaming",
    "CRM": "Enterprise Software",
}


def _symbol_seed(symbol: str) -> int:
    return int(hashlib.md5(symbol.upper().encode()).hexdigest()[:8], 16)


def _claude_unavailable() -> bool:
    from agents.base import CLAUDE_CLI
    if CLAUDE_CLI:
        return False
    return not settings.ANTHROPIC_API_KEY.get_secret_value()


def _demo_analysis(symbol: str, request: AnalysisRequest) -> AnalysisResponse:
    """Generate deterministic demo analysis for a symbol (last-resort fallback)."""
    s = symbol.upper()
    rng = random.Random(_symbol_seed(s))
    now = datetime.now(timezone.utc)

    price = _DEMO_BASE_PRICES.get(s, round(rng.uniform(30, 400), 2))
    sector = _DEMO_SECTORS.get(s, "Technology")

    agent_results: list[AgentResult] = []

    for agent_name in request.agents:
        if agent_name == "technical":
            score = round(rng.uniform(55, 82), 2)
            conviction = "high" if score > 70 else "medium"
            trend = "bullish" if score > 65 else "neutral"
            summary = (
                f"[DEMO] {s} shows a {trend} technical setup on the {request.timeframe} timeframe. "
                f"Price is trading above the 20 and 50-day EMAs with an RSI of {rng.randint(48, 72)}."
            )
            details = {
                "rsi_14": rng.randint(48, 72),
                "macd_signal": "bullish" if score > 65 else "neutral",
                "ema_20": round(price * rng.uniform(0.97, 1.01), 2),
                "ema_50": round(price * rng.uniform(0.94, 0.99), 2),
                "atr_14": round(price * rng.uniform(0.015, 0.035), 2),
                "support": round(price * 0.95, 2),
                "resistance": round(price * 1.05, 2),
                "volume_trend": "above_average",
            }
        elif agent_name == "fundamental":
            score = round(rng.uniform(45, 78), 2)
            conviction = "high" if score > 65 else "medium" if score > 50 else "low"
            summary = f"[DEMO] {s} ({sector}) fundamental overview not available — real data fetch failed."
            details = {"sector": sector}
        elif agent_name == "sentiment":
            score = round(rng.uniform(5, 45), 2)
            conviction = "medium" if score > 25 else "low"
            summary = f"[DEMO] Sentiment data for {s} unavailable — real data fetch failed."
            details = {}
        elif agent_name == "options":
            score = round(rng.uniform(40, 70), 2)
            conviction = "medium"
            summary = f"[DEMO] Options data for {s} unavailable — real data fetch failed."
            details = {}
        else:
            score = round(rng.uniform(30, 70), 2)
            conviction = "medium"
            summary = f"[DEMO] Agent '{agent_name}' analysis for {s}: score {score}."
            details = {}

        agent_results.append(AgentResult(
            agent=agent_name, score=score, conviction=conviction,
            summary=summary, details=details, timestamp=now,
        ))

    scores = [r.score for r in agent_results]
    composite_score = round(sum(scores) / len(scores), 2) if scores else 0

    convictions = {"low": 1, "medium": 2, "high": 3}
    avg_conviction = sum(convictions.get(r.conviction, 1) for r in agent_results) / max(len(agent_results), 1)
    composite_conviction = "high" if avg_conviction >= 2.5 else "medium" if avg_conviction >= 1.5 else "low"

    recommendation = _score_to_recommendation(composite_score)

    return AnalysisResponse(
        symbol=s,
        composite_score=composite_score,
        composite_conviction=composite_conviction,
        recommendation=recommendation,
        agent_results=agent_results,
        trade_ideas=[],
        analyzed_at=now,
        is_demo=True,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/analyze/{symbol}", response_model=AnalysisResponse, status_code=200)
async def trigger_analysis(
    symbol: str,
    request: AnalysisRequest,
    background_tasks: BackgroundTasks,
) -> AnalysisResponse:
    """Trigger a multi-agent analysis pipeline for a symbol.

    Tries real data from Alpaca (technicals) and Polygon (fundamentals) first.
    Falls back to Claude agent pipeline, then demo as absolute last resort.
    """
    symbol = symbol.upper()

    # 1. Try real data analysis first (Alpaca + Polygon)
    try:
        real = await _real_analysis(symbol, request)
        if real is not None:
            await cache_set(f"analysis:{symbol}", real.model_dump(mode="json"), ttl_seconds=ANALYSIS_CACHE_TTL)
            background_tasks.add_task(_persist_analysis, symbol, real.agent_results)
            return real
    except Exception:
        logger.warning("Real analysis failed for %s, trying Claude pipeline", symbol, exc_info=True)

    # 2. Try Claude agent pipeline if available
    if not _claude_unavailable() and not settings.SKIP_DB_INIT:
        try:
            agent_results = await _run_analysis_pipeline(symbol, request)
            scores = [r.score for r in agent_results]
            composite_score = sum(scores) / len(scores) if scores else 0

            convictions = {"low": 1, "medium": 2, "high": 3}
            avg_conviction = sum(convictions.get(r.conviction, 1) for r in agent_results) / max(len(agent_results), 1)
            composite_conviction = "high" if avg_conviction >= 2.5 else "medium" if avg_conviction >= 1.5 else "low"

            response = AnalysisResponse(
                symbol=symbol,
                composite_score=round(composite_score, 2),
                composite_conviction=composite_conviction,
                recommendation=_score_to_recommendation(composite_score),
                agent_results=agent_results,
                trade_ideas=[],
                analyzed_at=datetime.now(timezone.utc),
            )
            await cache_set(f"analysis:{symbol}", response.model_dump(mode="json"), ttl_seconds=ANALYSIS_CACHE_TTL)
            background_tasks.add_task(_persist_analysis, symbol, agent_results)
            return response
        except Exception:
            logger.warning("Claude pipeline failed for %s, falling back to demo", symbol, exc_info=True)

    # 3. Absolute last resort — demo
    logger.warning("All analysis methods failed for %s, returning demo data", symbol)
    response = _demo_analysis(symbol, request)
    await cache_set(f"analysis:{symbol}", response.model_dump(mode="json"), ttl_seconds=ANALYSIS_CACHE_TTL)
    return response


@router.get("/analysis/{symbol}", response_model=AnalysisResponse)
async def get_analysis(
    symbol: str,
) -> AnalysisResponse:
    """Retrieve the most recent cached analysis for a symbol."""
    symbol = symbol.upper()

    cached = await cache_get(f"analysis:{symbol}")
    if cached:
        return AnalysisResponse(**cached)

    # Try real data analysis
    try:
        real = await _real_analysis(symbol, AnalysisRequest())
        if real is not None:
            await cache_set(f"analysis:{symbol}", real.model_dump(mode="json"), ttl_seconds=ANALYSIS_CACHE_TTL)
            return real
    except Exception:
        logger.warning("Real analysis failed for %s in GET", symbol, exc_info=True)

    if not settings.SKIP_DB_INIT:
        try:
            from sqlalchemy import select
            from data.storage.models import AgentAnalysis
            from core.database import _get_session_factory

            factory = _get_session_factory()
            async with factory() as db:
                result = await db.execute(
                    select(AgentAnalysis)
                    .where(AgentAnalysis.symbol == symbol)
                    .order_by(AgentAnalysis.timestamp.desc())
                    .limit(10)
                )
                rows = result.scalars().all()
            if rows:
                agent_results = [
                    AgentResult(
                        agent=r.agent_type,
                        score=r.score or 0,
                        conviction=r.analysis.get("conviction", "medium") if r.analysis else "medium",
                        summary=r.analysis.get("summary", "") if r.analysis else "",
                        details=r.analysis or {},
                        timestamp=r.timestamp,
                    )
                    for r in rows
                ]

                scores = [r.score for r in agent_results]
                composite_score = sum(scores) / len(scores)

                return AnalysisResponse(
                    symbol=symbol,
                    composite_score=round(composite_score, 2),
                    composite_conviction="medium",
                    recommendation=_score_to_recommendation(composite_score),
                    agent_results=agent_results,
                    trade_ideas=[],
                    analyzed_at=rows[0].timestamp,
                )
        except Exception:
            logger.warning("Failed to retrieve analysis for %s from DB", symbol, exc_info=True)

    # Last resort
    logger.warning("Returning demo analysis for %s (all real sources failed)", symbol)
    return _demo_analysis(symbol, AnalysisRequest())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _run_analysis_pipeline(symbol: str, request: AnalysisRequest) -> list[AgentResult]:
    """Run requested agents and collect results."""
    import asyncio
    from agents import get_agent

    async def _run_one(agent_name: str) -> AgentResult:
        agent = get_agent(agent_name)
        if agent is None:
            return AgentResult(
                agent=agent_name, score=0, conviction="low",
                summary=f"Agent '{agent_name}' not available",
                timestamp=datetime.now(timezone.utc),
            )
        result = await agent.run(
            f"Analyze {symbol} for a {request.timeframe} timeframe trade. "
            f"Depth: {request.depth}."
        )
        return AgentResult(
            agent=agent_name,
            score=result.get("score", 0),
            conviction=result.get("conviction", "medium"),
            summary=result.get("summary", ""),
            details=result,
            timestamp=datetime.now(timezone.utc),
        )

    tasks = [_run_one(name) for name in request.agents]
    return list(await asyncio.gather(*tasks, return_exceptions=False))


async def _persist_analysis(symbol: str, results: list[AgentResult]) -> None:
    """Persist agent results to the database using a fresh session (BUG-019)."""
    from core.database import _get_session_factory
    from data.storage.models import AgentAnalysis

    factory = _get_session_factory()
    async with factory() as db:
        try:
            for r in results:
                entry = AgentAnalysis(
                    symbol=symbol,
                    agent_type=r.agent,
                    analysis=r.details,
                    score=r.score,
                    timestamp=r.timestamp,
                )
                db.add(entry)
            await db.commit()
        except Exception:
            await db.rollback()
            raise


def _score_to_recommendation(score: float) -> str:
    if score >= 60:
        return "strong_buy"
    elif score >= 25:
        return "buy"
    elif score >= -25:
        return "hold"
    elif score >= -60:
        return "sell"
    return "strong_sell"
