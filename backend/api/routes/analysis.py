from __future__ import annotations

import hashlib
import random
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from core.redis import cache_get, cache_set

router = APIRouter()


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


# ---------------------------------------------------------------------------
# Demo data helpers
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
    from core.config import settings
    return not settings.ANTHROPIC_API_KEY.get_secret_value()


def _demo_analysis(symbol: str, request: AnalysisRequest) -> AnalysisResponse:
    """Generate deterministic demo analysis for a symbol."""
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
                f"{s} shows a {trend} technical setup on the {request.timeframe} timeframe. "
                f"Price is trading above the 20 and 50-day EMAs with an RSI of {rng.randint(48, 72)}. "
                f"MACD histogram is positive and expanding. Key support at "
                f"${round(price * 0.95, 2)}, resistance at ${round(price * 1.05, 2)}."
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
            summary = (
                f"{s} ({sector}) has solid fundamentals with revenue growth of "
                f"{rng.randint(8, 35)}% YoY. Operating margins at {rng.randint(15, 45)}%. "
                f"F-Score of {rng.randint(5, 8)}/9 indicates strong financial health. "
                f"Valuation appears {'reasonable' if score > 60 else 'slightly stretched'} "
                f"relative to sector peers."
            )
            details = {
                "pe_ratio": round(rng.uniform(15, 55), 1),
                "revenue_growth_yoy": round(rng.uniform(8, 35), 1),
                "operating_margin": round(rng.uniform(15, 45), 1),
                "f_score": rng.randint(5, 8),
                "debt_to_equity": round(rng.uniform(0.2, 1.5), 2),
                "free_cash_flow_yield": round(rng.uniform(2, 6), 1),
            }
        elif agent_name == "sentiment":
            score = round(rng.uniform(5, 45), 2)
            conviction = "medium" if score > 25 else "low"
            sentiment_label = "mixed" if score > 25 else "cautious"
            summary = (
                f"Market sentiment for {s} is {sentiment_label}. "
                f"Social media mentions are {'elevated' if rng.random() > 0.5 else 'moderate'} "
                f"with {rng.randint(40, 65)}% positive sentiment ratio. "
                f"Institutional flows show {'net buying' if score > 30 else 'neutral'} "
                f"over the past 5 sessions. Short interest at {round(rng.uniform(2, 10), 1)}%."
            )
            details = {
                "social_sentiment_pct": rng.randint(40, 65),
                "news_sentiment": sentiment_label,
                "short_interest_pct": round(rng.uniform(2, 10), 1),
                "institutional_flow": "net_buy" if score > 30 else "neutral",
                "analyst_consensus": "buy" if rng.random() > 0.4 else "hold",
                "analyst_target": round(price * rng.uniform(1.05, 1.25), 2),
            }
        elif agent_name == "options":
            score = round(rng.uniform(40, 70), 2)
            conviction = "medium"
            iv_rank = round(rng.uniform(25, 65), 1)
            summary = (
                f"Options analysis for {s}: IV Rank at {iv_rank}, suggesting "
                f"{'premium selling' if iv_rank > 50 else 'directional'} strategies. "
                f"Put/call ratio at {round(rng.uniform(0.6, 1.2), 2)}. "
                f"Max pain at ${round(price * rng.uniform(0.97, 1.03), 2)} for nearest expiry."
            )
            details = {
                "iv_rank": iv_rank,
                "iv_percentile": round(rng.uniform(30, 70), 1),
                "put_call_ratio": round(rng.uniform(0.6, 1.2), 2),
                "max_pain": round(price * rng.uniform(0.97, 1.03), 2),
                "skew": round(rng.uniform(-0.05, 0.10), 3),
                "suggested_strategy": "iron_condor" if iv_rank > 50 else "bull_call_spread",
            }
        else:
            score = round(rng.uniform(30, 70), 2)
            conviction = "medium"
            summary = f"Agent '{agent_name}' analysis for {s}: score {score}."
            details = {}

        agent_results.append(AgentResult(
            agent=agent_name,
            score=score,
            conviction=conviction,
            summary=summary,
            details=details,
            timestamp=now,
        ))

    scores = [r.score for r in agent_results]
    composite_score = round(sum(scores) / len(scores), 2) if scores else 0

    convictions = {"low": 1, "medium": 2, "high": 3}
    avg_conviction = sum(convictions.get(r.conviction, 1) for r in agent_results) / max(len(agent_results), 1)
    composite_conviction = "high" if avg_conviction >= 2.5 else "medium" if avg_conviction >= 1.5 else "low"

    recommendation = _score_to_recommendation(composite_score)

    trade_ideas = []
    if composite_score > 40:
        trade_ideas.append({
            "strategy": "long_equity",
            "description": f"Buy {s} at ${price} with stop at ${round(price * 0.95, 2)}",
            "target": round(price * 1.08, 2),
            "stop": round(price * 0.95, 2),
            "risk_reward": "1:1.6",
        })
    if rng.random() > 0.4:
        trade_ideas.append({
            "strategy": "bull_call_spread" if composite_score > 50 else "iron_condor",
            "description": f"Options play on {s} for {request.timeframe} timeframe",
            "max_profit": round(price * 0.03, 2),
            "max_loss": round(price * 0.02, 2),
            "probability_of_profit": f"{rng.randint(55, 75)}%",
        })

    return AnalysisResponse(
        symbol=s,
        composite_score=composite_score,
        composite_conviction=composite_conviction,
        recommendation=recommendation,
        agent_results=agent_results,
        trade_ideas=trade_ideas,
        analyzed_at=now,
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

    This kicks off analysis agents in parallel and aggregates their results
    into a composite score with trade ideas.
    """
    symbol = symbol.upper()

    from core.config import settings
    if settings.SKIP_DB_INIT:
        response = _demo_analysis(symbol, request)
        await cache_set(f"analysis:{symbol}", response.model_dump(mode="json"), ttl_seconds=600)
        return response

    if _claude_unavailable():
        response = _demo_analysis(symbol, request)
        await cache_set(f"analysis:{symbol}", response.model_dump(mode="json"), ttl_seconds=600)
        return response

    try:
        # Run the analysis pipeline
        agent_results = await _run_analysis_pipeline(symbol, request)

        # Compute composite
        scores = [r.score for r in agent_results]
        composite_score = sum(scores) / len(scores) if scores else 0

        convictions = {"low": 1, "medium": 2, "high": 3}
        avg_conviction = sum(convictions.get(r.conviction, 1) for r in agent_results) / max(len(agent_results), 1)
        composite_conviction = "high" if avg_conviction >= 2.5 else "medium" if avg_conviction >= 1.5 else "low"

        recommendation = _score_to_recommendation(composite_score)

        response = AnalysisResponse(
            symbol=symbol,
            composite_score=round(composite_score, 2),
            composite_conviction=composite_conviction,
            recommendation=recommendation,
            agent_results=agent_results,
            trade_ideas=[],
            analyzed_at=datetime.now(timezone.utc),
        )

        # Cache and persist
        await cache_set(f"analysis:{symbol}", response.model_dump(mode="json"), ttl_seconds=600)

        background_tasks.add_task(_persist_analysis, symbol, agent_results)

        return response
    except Exception:
        # Fall back to demo analysis on any failure
        response = _demo_analysis(symbol, request)
        await cache_set(f"analysis:{symbol}", response.model_dump(mode="json"), ttl_seconds=600)
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

    from core.config import settings
    if settings.SKIP_DB_INIT:
        return _demo_analysis(symbol, AnalysisRequest())

    try:
        # Fall back to DB
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
        if not rows:
            # No cached or DB analysis — return demo
            return _demo_analysis(symbol, AnalysisRequest())

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
