from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from core.auth import require_auth
from api.routes import auth as auth_routes

from core.config import settings
from core.database import init_db, close_db
from core.logging import REQUEST_ID, configure_logging
from core.redis import get_redis, close_redis
from api.routes import market, screener, analysis, options, trades, portfolio, agents, webhooks
from api.routes import symbols, strategies, market_overview, risk, pipeline, news
from api.middleware.skip_db_init_warning import SkipDbInitWarningMiddleware
from api.websocket.handler import websocket_endpoint
from data.ingestion.alpaca_stream import start_alpaca_stream, stop_alpaca_stream
from data.ingestion.fill_reconciler import start_fill_reconciler, stop_fill_reconciler
from data.ingestion.pipeline_runner import start_pipeline_scheduler, stop_pipeline_scheduler
from data.ingestion.continuous_monitor import start_continuous_monitor, stop_continuous_monitor
from data.ingestion.realtime_scanner import start_realtime_scanner, stop_realtime_scanner

# Install the JSON formatter + request-id filter for the whole process. This
# replaces the ad-hoc logging.basicConfig block that lived here previously and
# makes every log record carry ``request_id`` automatically. See
# audit-reports/observability-audit-r4.md P0 #3 and #4.
configure_logging()

logger = logging.getLogger("alphadesk")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Starting AlphaDesk backend (%s)", settings.ENVIRONMENT.value)

    # Skip DB init if explicitly configured (BUG-003)
    if not settings.SKIP_DB_INIT:
        try:
            await init_db()
            logger.info("Database connected")
        except Exception:
            logger.warning("Database unavailable", exc_info=True)
    else:
        # Oncall visibility: this is a degraded mode — every DB-backed route
        # will return empty results. The SkipDbInitWarningMiddleware will also
        # tag every HTTP response with X-Alphadesk-Warning.
        logger.warning(
            "SKIP_DB_INIT=True — database is not initialised; "
            "DB-backed routes will return empty results and every response "
            "will carry the X-Alphadesk-Warning header."
        )

    try:
        await get_redis()
        logger.info("Redis connected")
    except Exception:
        logger.warning("Redis unavailable (run docker compose up redis)", exc_info=True)

    # Start Alpaca WebSocket stream for real-time quotes
    try:
        await start_alpaca_stream()
    except Exception:
        logger.warning("Alpaca stream failed to start", exc_info=True)

    # Wave B / persona-72 P0: subscribe the DB consumer to Alpaca's
    # trade_updates pub/sub channel so every fill / partial_fill /
    # canceled / rejected / expired event transitions the Trade row out
    # of ``status="submitted"`` and stamps broker_order_id, filled_at,
    # filled_avg_price, account_env. MUST be started AFTER
    # ``start_alpaca_stream`` so the publisher is up first — otherwise
    # the first few events could land on an empty channel with no
    # subscribers (Redis pub/sub has no replay).
    try:
        await start_fill_reconciler()
    except Exception:
        logger.warning("Fill reconciler failed to start", exc_info=True)

    # Start automated trading pipeline scheduler
    try:
        await start_pipeline_scheduler()
        logger.info("Pipeline scheduler started")
    except Exception:
        logger.warning("Pipeline scheduler failed to start", exc_info=True)

    # Start real-time signal scanner (pattern-based strategies)
    try:
        await start_realtime_scanner()
        logger.info("Real-time signal scanner started")
    except Exception:
        logger.warning("Real-time scanner failed to start", exc_info=True)

    # Start continuous market monitor (news + price alerts)
    try:
        await start_continuous_monitor()
        logger.info("Continuous market monitor started")
    except Exception:
        logger.warning("Continuous monitor failed to start", exc_info=True)

    # Wave 41: reconcile any trades submitted to Alpaca that didn't make it
    # into the local ledger (power-loss mid-POST, container kill mid-submit).
    # Backfills missing Trade rows and flags orphaned local pending rows.
    try:
        from api.routes.trades import reconcile_on_boot
        await reconcile_on_boot()
    except Exception:
        logger.warning("Boot reconcile raised", exc_info=True)

    # Replay any bracket orders that got queued to the outbox when Alpaca
    # rejected (or timed out) the bracket leg during the last run. Without
    # this a crash between entry-fill and bracket-submit leaves an open
    # position with no stop / target until the next scheduled pipeline
    # window. daily_pipeline.replay_pending_brackets() is idempotent and
    # drains Redis-persisted state.
    try:
        from data.ingestion.daily_pipeline import replay_pending_brackets
        await replay_pending_brackets()
    except Exception:
        logger.warning("Boot bracket-outbox replay raised", exc_info=True)

    yield

    # Stop real-time scanner
    try:
        await stop_realtime_scanner()
    except Exception:
        logger.warning("shutdown: stop_realtime_scanner raised", exc_info=True)

    # Stop continuous monitor
    try:
        await stop_continuous_monitor()
    except Exception:
        logger.warning("shutdown: stop_continuous_monitor raised", exc_info=True)

    # Stop pipeline scheduler
    try:
        await stop_pipeline_scheduler()
    except Exception:
        logger.warning("shutdown: stop_pipeline_scheduler raised", exc_info=True)

    # Stop the fill reconciler before the Alpaca stream so we don't try
    # to consume a channel the publisher has already closed.
    try:
        await stop_fill_reconciler()
    except Exception:
        logger.warning("shutdown: stop_fill_reconciler raised", exc_info=True)

    # Stop Alpaca stream
    try:
        await stop_alpaca_stream()
    except Exception:
        logger.warning("shutdown: stop_alpaca_stream raised", exc_info=True)
    try:
        await close_redis()
    except Exception:
        logger.warning("shutdown: close_redis raised", exc_info=True)
    try:
        await close_db()
    except Exception:
        logger.warning("shutdown: close_db raised", exc_info=True)
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
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Idempotency-Key"],
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

# Tag every response with X-Alphadesk-Warning when SKIP_DB_INIT is True so
# clients can detect the degraded mode rather than interpreting empty
# responses as genuinely empty datasets.
app.add_middleware(SkipDbInitWarningMiddleware)

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
    # Honour an inbound X-Request-ID if the edge (Caddy) sends one, otherwise
    # mint a fresh uuid4. Either way we pin it on request.state AND on the
    # REQUEST_ID ContextVar so every log record emitted during this request —
    # including those from middleware, handlers, DB helpers, and the Alpaca
    # client — carries the same id.
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    token = REQUEST_ID.set(request_id)
    try:
        response = await call_next(request)
    finally:
        REQUEST_ID.reset(token)
    response.headers["X-Request-ID"] = request_id
    return response


# --- Health ---
@app.get("/livez", tags=["Health"])
async def livez() -> dict:
    """Liveness probe — process is up and accepting requests.

    Used by docker/Kubernetes to decide whether to restart the container.
    No dependency checks: any failure here means the Python process itself
    is wedged, and a restart is the correct recovery.
    """
    return {"status": "ok"}


@app.get("/health", tags=["Health"])
async def health_check() -> dict:
    """Backward-compat alias for /livez.

    docker-compose.prod.yml has a healthcheck pointed at /health; keep it
    working until every deployment switches to /livez.
    """
    return {"status": "ok"}


@app.get("/readyz", tags=["Health"])
async def readyz() -> JSONResponse:
    """Readiness probe — dependencies we can't serve traffic without.

    Pings Postgres (SELECT 1) and Redis (PING). On failure, returns 503 +
    a JSON body indicating which dependency is down, so oncall can triage
    without shelling into each container. Kept fast (<1s combined) by
    short-circuiting on first failure and using ``asyncio.wait_for`` timeouts.
    """
    result: dict[str, str] = {"db": "unknown", "redis": "unknown"}
    overall_ok = True

    # DB check — SELECT 1 is cheap and proves the connection pool is live.
    try:
        from sqlalchemy import text
        from core.database import _get_engine

        engine = _get_engine()

        async def _db_ping() -> None:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))

        await asyncio.wait_for(_db_ping(), timeout=0.8)
        result["db"] = "ok"
    except Exception as e:
        overall_ok = False
        result["db"] = f"down: {type(e).__name__}"

    # Redis check — PING over the async client.
    try:
        redis = await get_redis()
        await asyncio.wait_for(redis.ping(), timeout=0.5)
        result["redis"] = "ok"
    except Exception as e:
        overall_ok = False
        result["redis"] = f"down: {type(e).__name__}"

    status_code = 200 if overall_ok else 503
    result["status"] = "ok" if overall_ok else "degraded"
    return JSONResponse(status_code=status_code, content=result)
