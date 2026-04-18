from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from core.auth import require_auth
from api.routes import auth as auth_routes

from core.config import settings
from core.database import init_db, close_db
from core.redis import get_redis, close_redis
from api.routes import market, screener, analysis, options, trades, portfolio, agents, webhooks
from api.routes import symbols, strategies, market_overview, risk, pipeline, news
from api.websocket.handler import websocket_endpoint
from data.ingestion.alpaca_stream import start_alpaca_stream, stop_alpaca_stream
from data.ingestion.pipeline_runner import start_pipeline_scheduler, stop_pipeline_scheduler
from data.ingestion.continuous_monitor import start_continuous_monitor, stop_continuous_monitor
from data.ingestion.realtime_scanner import start_realtime_scanner, stop_realtime_scanner

logger = logging.getLogger("alphadesk")

# Force application logs to stdout even under Gunicorn
# (Gunicorn overrides the root logger, so basicConfig alone is not enough)
_log_level = getattr(logging, settings.LOG_LEVEL, logging.INFO)
logging.basicConfig(level=_log_level, format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s", force=True)
# Ensure all alphadesk loggers propagate correctly
for _name in ("alphadesk", "data.ingestion", "api.websocket", "core"):
    _lg = logging.getLogger(_name)
    _lg.setLevel(_log_level)
    if not _lg.handlers:
        _lg.addHandler(logging.StreamHandler())
    _lg.propagate = True


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

    # Start real-time signal scanner (pattern-based strategies)
    try:
        await start_realtime_scanner()
        logger.info("Real-time signal scanner started")
    except Exception as e:
        logger.warning("Real-time scanner failed to start: %s", e)

    # Start continuous market monitor (news + price alerts)
    try:
        await start_continuous_monitor()
        logger.info("Continuous market monitor started")
    except Exception as e:
        logger.warning("Continuous monitor failed to start: %s", e)

    yield

    # Stop real-time scanner
    try:
        await stop_realtime_scanner()
    except Exception:
        pass

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

cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
if settings.PRODUCTION_ORIGIN:
    cors_origins.append(settings.PRODUCTION_ORIGIN)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)

# Only trust X-Forwarded-For from Caddy and the loopback. Caddy lives in the
# ``alphadesk`` user bridge network (172.18+.0.0/16 range, depending on Docker
# assignment). ``trusted_hosts=["*"]`` let any client rotate X-Forwarded-For
# to bypass per-IP rate limits; we now restrict to the private IP ranges Caddy
# actually uses plus loopback for local dev.
_TRUSTED_PROXY_HOSTS = [
    "127.0.0.1",
    "::1",
    # Docker default bridge + user-defined bridges
    "172.16.0.0/12",
    # Compose user networks sometimes land on 10.x
    "10.0.0.0/8",
    # docker-compose default subnet range (rare but legal)
    "192.168.0.0/16",
]
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=_TRUSTED_PROXY_HOSTS)

# --- Routers ---
app.include_router(market.router, prefix="/api/v1/market", tags=["Market Data"], dependencies=[Depends(require_auth)])
app.include_router(screener.router, prefix="/api/v1/screener", tags=["Screener"], dependencies=[Depends(require_auth)])
app.include_router(analysis.router, prefix="/api/v1/analysis", tags=["Analysis"], dependencies=[Depends(require_auth)])
app.include_router(options.router, prefix="/api/v1/options", tags=["Options"], dependencies=[Depends(require_auth)])
app.include_router(trades.router, prefix="/api/v1/trades", tags=["Trades"], dependencies=[Depends(require_auth)])
app.include_router(portfolio.router, prefix="/api/v1/portfolio", tags=["Portfolio"], dependencies=[Depends(require_auth)])
app.include_router(agents.router, prefix="/api/v1/agents", tags=["Agents"], dependencies=[Depends(require_auth)])
app.include_router(webhooks.router, prefix="/api/v1/webhooks", tags=["Webhooks"])
app.include_router(symbols.router, prefix="/api/v1/symbols", tags=["Symbols"], dependencies=[Depends(require_auth)])
app.include_router(strategies.router, prefix="/api/v1/strategies", tags=["Strategies"], dependencies=[Depends(require_auth)])
app.include_router(market_overview.router, prefix="/api/v1/market-overview", tags=["Market Overview"], dependencies=[Depends(require_auth)])
app.include_router(risk.router, prefix="/api/v1/risk", tags=["Risk"], dependencies=[Depends(require_auth)])
app.include_router(pipeline.router, prefix="/api/v1/pipeline", tags=["Pipeline"], dependencies=[Depends(require_auth)])
app.include_router(news.router, prefix="/api/v1/news", tags=["News"], dependencies=[Depends(require_auth)])
app.include_router(auth_routes.router, prefix="/api/v1/auth", tags=["Auth"])

# --- WebSocket ---
app.websocket("/ws")(websocket_endpoint)


# --- Middleware (function-based) ---
@app.middleware("http")
async def remove_server_header(request: Request, call_next):
    response = await call_next(request)
    if "server" in response.headers:
        del response.headers["server"]
    return response


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# --- Health ---
@app.get("/health", tags=["Health"])
async def health_check() -> dict:
    if settings.is_production:
        return {"status": "ok"}
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT.value,
        "version": app.version,
    }
