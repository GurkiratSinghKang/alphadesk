from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from core.database import init_db, close_db
from core.redis import get_redis, close_redis
from api.routes import market, screener, analysis, options, trades, portfolio, agents, webhooks
from api.routes import symbols, strategies, market_overview, risk, pipeline, news
from api.websocket.handler import websocket_endpoint
from data.ingestion.alpaca_stream import start_alpaca_stream, stop_alpaca_stream
from data.ingestion.pipeline_runner import start_pipeline_scheduler, stop_pipeline_scheduler
from data.ingestion.continuous_monitor import start_continuous_monitor, stop_continuous_monitor

logger = logging.getLogger("alphadesk")
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Starting AlphaDesk backend (%s)", settings.ENVIRONMENT.value)

    # Skip DB init if explicitly configured (BUG-003)
    if not settings.SKIP_DB_INIT:
        try:
            await init_db()
            logger.info("Database connected")
        except Exception as e:
            logger.warning("Database unavailable: %s", e)
    else:
        logger.info("Skipping DB init (SKIP_DB_INIT=True)")

    try:
        await get_redis()
        logger.info("Redis connected")
    except Exception as e:
        logger.warning("Redis unavailable (run docker compose up redis): %s", e)

    # Start Alpaca WebSocket stream for real-time quotes
    try:
        await start_alpaca_stream()
    except Exception as e:
        logger.warning("Alpaca stream failed to start: %s", e)

    # Start automated trading pipeline scheduler
    try:
        await start_pipeline_scheduler()
        logger.info("Pipeline scheduler started")
    except Exception as e:
        logger.warning("Pipeline scheduler failed to start: %s", e)

    # Start continuous market monitor (news + price alerts)
    try:
        await start_continuous_monitor()
        logger.info("Continuous market monitor started")
    except Exception as e:
        logger.warning("Continuous monitor failed to start: %s", e)

    yield

    # Stop continuous monitor
    try:
        await stop_continuous_monitor()
    except Exception:
        pass

    # Stop pipeline scheduler
    try:
        await stop_pipeline_scheduler()
    except Exception:
        pass

    # Stop Alpaca stream
    try:
        await stop_alpaca_stream()
    except Exception:
        pass
    try:
        await close_redis()
    except Exception:
        pass
    try:
        await close_db()
    except Exception:
        pass
    logger.info("Shutdown complete")


app = FastAPI(
    title="AlphaDesk API",
    description="Claude-powered trading platform API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if not settings.is_production else None,
    redoc_url="/redoc" if not settings.is_production else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Routers ---
app.include_router(market.router, prefix="/api/v1/market", tags=["Market Data"])
app.include_router(screener.router, prefix="/api/v1/screener", tags=["Screener"])
app.include_router(analysis.router, prefix="/api/v1/analysis", tags=["Analysis"])
app.include_router(options.router, prefix="/api/v1/options", tags=["Options"])
app.include_router(trades.router, prefix="/api/v1/trades", tags=["Trades"])
app.include_router(portfolio.router, prefix="/api/v1/portfolio", tags=["Portfolio"])
app.include_router(agents.router, prefix="/api/v1/agents", tags=["Agents"])
app.include_router(webhooks.router, prefix="/api/v1/webhooks", tags=["Webhooks"])
app.include_router(symbols.router, prefix="/api/v1/symbols", tags=["Symbols"])
app.include_router(strategies.router, prefix="/api/v1/strategies", tags=["Strategies"])
app.include_router(market_overview.router, prefix="/api/v1/market-overview", tags=["Market Overview"])
app.include_router(risk.router, prefix="/api/v1/risk", tags=["Risk"])
app.include_router(pipeline.router, prefix="/api/v1/pipeline", tags=["Pipeline"])
app.include_router(news.router, prefix="/api/v1/news", tags=["News"])

# --- WebSocket ---
app.websocket("/ws")(websocket_endpoint)


# --- Health ---
@app.get("/health", tags=["Health"])
async def health_check() -> dict:
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT.value,
        "version": app.version,
    }
