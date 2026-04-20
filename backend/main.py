from __future__ import annotations

# Wave 3L Fix 5 (persona-86/90): swap the default asyncio event loop for
# uvloop. 2–4× lower overhead on high-frequency async I/O (WS fan-out,
# Redis pub/sub) at zero code cost. Must be installed BEFORE the first
# ``asyncio.get_event_loop()`` call, hence the very-top import. Gracefully
# degraded to the stdlib loop when the wheel isn't available (e.g. on
# Windows or in bare venvs used by some CI sandboxes).
try:
    import uvloop

    uvloop.install()
except ImportError:
    pass

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, ORJSONResponse
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from core.auth import require_auth
from api.routes import auth as auth_routes

from core.config import settings
from core.database import init_db, close_db
from core.logging import REQUEST_ID, configure_logging
from core.redis import get_redis, close_redis
from api.routes import market, screener, analysis, options, trades, portfolio, agents, webhooks
from api.routes import symbols, strategies, market_overview, risk, pipeline, news
from api.routes import user as user_routes
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

    # Wave 41: reconcile any trades submitted to Alpaca that didn't make it
    # into the local ledger (power-loss mid-POST, container kill mid-submit).
    # Backfills missing Trade rows and flags orphaned local pending rows.
    #
    # Wave 2G / persona-79 Race 2: this MUST run BEFORE
    # ``start_fill_reconciler()`` so the boot reconciliation sees a stable
    # snapshot of the ledger. If the live pub/sub consumer were already
    # processing fills concurrently, both code paths could materialise the
    # same Trade row and race on the status / fill-column writes. With
    # boot reconcile completed first, the live reconciler picks up only
    # the truly fresh events. Optimistic locking on the ``version`` column
    # is the second line of defence if we ever have to overlap them again.
    try:
        from api.routes.trades import reconcile_on_boot
        await reconcile_on_boot()
    except Exception:
        logger.warning("Boot reconcile raised", exc_info=True)

    # Wave B / persona-72 P0: subscribe the DB consumer to Alpaca's
    # trade_updates pub/sub channel so every fill / partial_fill /
    # canceled / rejected / expired event transitions the Trade row out
    # of ``status="submitted"`` and stamps broker_order_id, filled_at,
    # filled_avg_price, account_env. MUST be started AFTER
    # ``start_alpaca_stream`` so the publisher is up first — otherwise
    # the first few events could land on an empty channel with no
    # subscribers (Redis pub/sub has no replay) — AND after
    # ``reconcile_on_boot`` so the two paths can't race on the same row
    # (Wave 2G / persona-79 Race 2).
    try:
        await start_fill_reconciler()
    except Exception:
        logger.warning("Fill reconciler failed to start", exc_info=True)

    # Wave 4R Fix 3: reconcile the Redis halt set with the durable halt
    # record so any drift (Redis-only ghosts, Postgres-only orphans) is
    # surfaced in the boot log BEFORE the scheduler starts trading. Runs
    # pre-scheduler so the operator sees the discrepancy line first.
    try:
        from data.ingestion.master_agent import MasterAgent
        await MasterAgent.halt_expiry_boot_check()
    except Exception:
        logger.warning("halt_expiry_boot_check raised", exc_info=True)

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

    # Wave 4Q (persona-103 P1 #3): schedule the audit_log retention
    # sweeper.  Runs weekly, guarded by a Redis lock so a multi-worker
    # deployment only sweeps once.  Safe to spawn even in SKIP_DB_INIT
    # mode — sweep_once() no-ops when the DB is bypassed.
    audit_cleanup_task = None
    try:
        from scripts.audit_log_cleanup import schedule_lifespan_task
        audit_cleanup_task = await schedule_lifespan_task()
        logger.info("Audit-log retention sweeper scheduled")
    except Exception:
        logger.warning("Audit-log retention sweeper failed to schedule", exc_info=True)

    yield

    # Cancel audit cleanup task first — it's purely background, so
    # cancelling it before the DB/Redis teardown is both safe and
    # avoids spurious "engine disposed mid-sweep" log noise.
    if audit_cleanup_task is not None:
        audit_cleanup_task.cancel()
        try:
            await audit_cleanup_task
        except (asyncio.CancelledError, Exception):
            pass

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
    # Wave 3L Fix 4 (persona-86/90): orjson is 2–3× faster than the stdlib
    # ``json`` module used by the default ``JSONResponse``. Setting it as
    # the default response class flips every route (that returns a dict /
    # pydantic model without an explicit ``response_class``) onto the
    # faster serializer. ``orjson`` is already a declared dependency.
    default_response_class=ORJSONResponse,
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


# Wave 3K Fix 2 (persona-87 P1) — global unhandled-exception handler.
#
# Registered BEFORE ``app.include_router(...)`` so FastAPI picks it up
# during the route-compilation phase. Any route that raises a non-HTTP
# exception (a KeyError inside a handler, a sqlalchemy OperationalError
# that escapes a retry loop, …) lands here instead of Starlette's default
# handler which emits a generic 500 with zero structured context.
#
# Behaviour:
#   * ``logger.exception`` captures the full traceback to the JSON log
#     stream with ``event=unhandled_exception`` so it is trivially
#     filterable.
#   * The response body echoes the request_id so a user reporting a 500
#     gives the oncall something to grep for without shelling into the
#     container.
#   * ``HTTPException`` is NOT intercepted here — Starlette routes those
#     through its own exception handler, which is the correct shape
#     (carries the user-facing ``detail`` string).
@app.exception_handler(Exception)
async def _unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    logger.exception(
        "unhandled_exception",
        extra={
            "event": "unhandled_exception",
            "path": request.url.path,
            "method": request.method,
            "request_id": request_id,
        },
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "request_id": request_id},
    )


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
# Wave 4Q (persona-103): user-rights endpoints (GDPR Art. 17 + Art. 20 /
# CCPA parity).  Auth is enforced INSIDE each handler via Depends(require_auth)
# rather than router-level so the handlers can also do a password re-auth
# on the erase path — a router-level dep would fire before we can read the
# body for the password field.
app.include_router(user_routes.router, prefix="/api/v1/user", tags=["User Rights"])

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

    Wave 4R Fix 8: also checks disk usage on the data dir. When > 90 % we
    return ``status="degraded"`` (still HTTP 200 so the container stays in
    rotation — a full disk isn't a reason to drop requests, but it IS a
    reason to page the operator).  A dependency outage still short-circuits
    to 503.
    """
    result: dict[str, Any] = {"db": "unknown", "redis": "unknown", "disk": "unknown"}
    overall_ok = True
    degraded = False

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

    # Wave 4R Fix 8: disk check. Failing to read the path is NOT a reason
    # to 503 — the container can still serve traffic even if the mount is
    # gone; it just tells us something's very wrong upstream and we want
    # that in the body. > 90 % flips ``degraded`` (HTTP 200 but degraded).
    try:
        import os
        from scripts.check_disk_usage import disk_usage_pct

        data_path = os.environ.get("ALPHADESK_DATA_DIR", "/var/lib/alphadesk")
        # Fall back to "/" if the configured path doesn't exist in this
        # environment (e.g. a dev laptop without /var/lib/alphadesk).
        if not os.path.exists(data_path):
            data_path = "/"
        pct = disk_usage_pct(data_path)
        result["disk"] = {"path": data_path, "used_pct": round(pct, 2)}
        if pct >= 90.0:
            degraded = True
    except Exception as e:
        # Don't flap readyz over a shutil / fs hiccup.
        result["disk"] = f"check_failed: {type(e).__name__}"

    status_code = 200 if overall_ok else 503
    if overall_ok:
        result["status"] = "degraded" if degraded else "ok"
    else:
        result["status"] = "degraded"
    return JSONResponse(status_code=status_code, content=result)
