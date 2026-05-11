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
import os
import uuid
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import FastAPI, Depends, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, ORJSONResponse
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from core.auth import require_auth
from api.routes import auth as auth_routes

from core.config import settings
from core.database import init_db, close_db
from core.logging import CLIENT_IP, REQUEST_ID, configure_logging
from core.redis import get_redis, close_redis
from api.routes import market, screener, analysis, options, trades, portfolio, agents, webhooks
from api.routes import symbols, strategies, market_overview, risk, pipeline, news, tickers
from api.routes import tickers_fundamentals
from api.routes import analytics as analytics_routes
from api.routes import tradingagents
from api.routes import broker as broker_routes
from api.routes import earnings
from api.routes import access_requests as access_requests_routes
from api.routes import exit_rules as exit_rules_routes
from api.routes import admin_control as admin_control_routes
from api.routes import metrics as metrics_routes
from api.routes import user as user_routes
# v2 Phase B (B.1–B.18) backend extensions. Each module owns one
# slice of the redesign plan; ALL_V2_MISC_ROUTERS aggregates the
# lighter-weight read-mostly slices into a single import.
from api.routes import v2_pipeline_stages, v2_agent_control, v2_watchlists
from api.routes import v2_notifications, v2_user_settings, v2_user_layout
from api.routes import v2_feature_flags
from api.routes.v2_misc import ALL_V2_MISC_ROUTERS
from api.middleware.skip_db_init_warning import SkipDbInitWarningMiddleware
from api.websocket.handler import websocket_endpoint
from data.ingestion.alpaca_stream import start_alpaca_stream, stop_alpaca_stream
from data.ingestion.fill_reconciler import start_fill_reconciler, stop_fill_reconciler
from data.ingestion.periodic_reconciler import (
    start_periodic_reconciler,
    stop_periodic_reconciler,
)
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

    # Round-8 / T-1: fail-fast on the broker URL ↔ live-trading flag
    # asymmetry. ``assert_live_enabled_or_paper()`` raises a clear
    # ``RuntimeError`` if ``ALPACA_BASE_URL`` points at the live host
    # without ``LIVE_TRADING_ENABLED=true`` (and vice-versa). Per-order
    # ``reject_if_live_forbidden`` calls catch the same misconfig later
    # but only AFTER strategies have started spinning up — booting hard
    # is the safer signal for a misconfigured deploy.
    from core.trading_gate import assert_live_enabled_or_paper
    assert_live_enabled_or_paper()

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

    # Wave 6β Fix 1 (persona 117 P0) + Fix 2 (Round-5 deferred / P106):
    # start the periodic broker-vs-ledger reconciler.  Closes the
    # kill-9-between-Alpaca-accept-and-DB-commit split window that used
    # to survive until the next restart.  Runs every 5 min, Redis-locked
    # for multi-worker safety.  Also drives the pending_flatten drain
    # so a halt-while-market-closed queue fires at the next open.
    #
    # MUST be started AFTER reconcile_on_boot + start_fill_reconciler
    # so the first live tick doesn't race the boot reconcile against
    # the same Alpaca /v2/orders window.
    try:
        await start_periodic_reconciler()
    except Exception:
        logger.warning(
            "Periodic reconciler failed to start", exc_info=True,
        )

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

    # Round-4 CLUSTER 6 #23: slowloris-resistant rate-limit sweep.
    # Without the periodic background sweep, the per-IP history dicts in
    # ``api.routes._rate_limit`` only pruned themselves at saturation, so
    # a stream of unique IPs each making one request and never coming
    # back left empty deques accumulating in memory. Runs every 60s.
    try:
        from api.routes._rate_limit import start_periodic_sweep
        start_periodic_sweep()
        logger.info("Rate-limit periodic sweep started")
    except Exception:
        logger.warning("Rate-limit periodic sweep failed to start", exc_info=True)

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

    # Round-4 CLUSTER 6 #23: stop the rate-limit sweep loop.
    try:
        from api.routes._rate_limit import stop_periodic_sweep
        await stop_periodic_sweep()
    except Exception:
        logger.warning("shutdown: rate-limit sweep stop raised", exc_info=True)

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

    # Wave 6β — stop the periodic reconciler before the fill
    # reconciler.  Ordering doesn't strictly matter (both are
    # independent) but doing it first means we don't take a
    # half-drained tick to completion after the fill reconciler
    # has already torn down its subscription.
    try:
        await stop_periodic_reconciler()
    except Exception:
        logger.warning(
            "shutdown: stop_periodic_reconciler raised", exc_info=True,
        )

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

    # Round-6 K-9: drain the module-singleton FMP AsyncClient so we
    # don't leak open keepalive connections on shutdown.
    try:
        from data.providers._fmp_http import close_async_client as _close_fmp_async
        await _close_fmp_async()
    except Exception:
        logger.warning("shutdown: close FMP async client raised", exc_info=True)

    logger.info("Shutdown complete")


app = FastAPI(
    title="AlphaDesk API",
    description="AI-powered trading platform API",
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
    # B3.1: keep the default ``redirect_slashes=True`` behaviour explicit.
    # Routers like /api/v1/strategies declare their root at ``"/"`` so a
    # caller hitting ``/api/v1/strategies`` (no trailing slash) gets a 307
    # redirect to ``/api/v1/strategies/``. The 307 carries an empty body
    # (the report's "0 bytes" symptom); curl-like clients that follow
    # redirects pick up the JSON, while clients that don't see an empty
    # 307. Setting this flag True is the documented FastAPI default but
    # we declare it explicitly so the behaviour can't drift if a future
    # refactor flips it. The strategies router additionally registers
    # an explicit slash-less alias below to short-circuit the redirect
    # round-trip for callers that bail on 307.
    redirect_slashes=True,
)

# Round-4 CLUSTER 6 #25: tighten CORS in production. The localhost
# origins are dev-only — leaving them in the prod allowlist meant any
# operator running a malicious page on http://localhost:3000 against a
# user's session cookie could read /api/v1/* responses (the
# allow_credentials=True flag below makes that real). Gate on
# settings.is_production so prod ONLY allows PRODUCTION_ORIGIN.
cors_origins: list[str] = []
if not settings.is_production:
    cors_origins.extend([
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ])
if settings.PRODUCTION_ORIGIN:
    cors_origins.append(settings.PRODUCTION_ORIGIN)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Idempotency-Key"],
)

# BUG-077 (audit 2026-05-11, M1-10 / P8-04 / M4-08): CORSMiddleware above
# rejects preflighted requests from disallowed origins, but it does NOT
# reject "simple" POSTs (Content-Type: text/plain + JSON body, etc.) and
# our auth cookie is SameSite=Lax which permits the cookie to ride on
# top-level POST navigations from third-party origins. Net effect: a
# malicious page could POST to /api/v1/trades/orders with a JSON-as-
# text/plain body and the browser would attach the user's session.
#
# This middleware adds a second wall: for state-changing methods on
# /api/v1/*, reject any request whose `Origin` header is set and is NOT
# in the allowed list. Requests WITHOUT an `Origin` header are server-
# to-server (curl, webhooks, internal cron) and are allowed through —
# they don't carry a browser cookie by definition.
#
# Exemptions: webhook endpoints (where the caller has no notion of
# Origin) and `/api/v1/security/csp-report` (browsers POST CSP reports
# without an `Origin` matching ours, intentionally). Add paths here as
# new external POSTs land.
_CSRF_EXEMPT_PREFIXES = (
    "/api/v1/webhooks/",
    "/api/v1/security/csp-report",
)
_CSRF_PROTECTED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_CSRF_ALLOWED_ORIGINS = frozenset(cors_origins)


@app.middleware("http")
async def enforce_origin_on_state_changes(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Reject browser-driven cross-origin state changes (CSRF defense)."""
    method = request.method.upper()
    if method in _CSRF_PROTECTED_METHODS:
        path = request.url.path
        if path.startswith("/api/v1/") and not any(
            path.startswith(p) for p in _CSRF_EXEMPT_PREFIXES
        ):
            origin = request.headers.get("origin")
            if origin and origin not in _CSRF_ALLOWED_ORIGINS:
                from core.logging import REQUEST_ID  # local import: avoid cycle
                # Log at WARNING with request_id so a single grep correlates
                # to the Caddy access entry. Don't echo the Origin verbatim
                # to client to avoid reflective-content concerns.
                import logging
                logging.getLogger("alphadesk.csrf").warning(
                    "csrf rejected: cross-origin state change",
                    extra={
                        "event": "csrf_reject",
                        "method": method,
                        "path": path,
                        "origin": origin,
                        "request_id": REQUEST_ID.get(),
                    },
                )
                return JSONResponse(
                    {"detail": "Origin not allowed for state-changing request"},
                    status_code=403,
                )
    return await call_next(request)


# BUG-078 (audit 2026-05-11, M1-03): authed data routes had NO per-IP rate
# limit. M1 demonstrated this by firing 50 GETs to /portfolio/summary in 8
# seconds with all 200 OKs. A credential-stuffing-style enumeration or a
# runaway script could pin a backend worker indefinitely.
#
# This middleware adds a loose, in-process sliding-window per-IP cap on
# /api/v1/* requests. The threshold is intentionally generous (default
# 600 requests / 60s = 10 req/s) so legitimate dashboard polling (BUG-069
# = 41 calls on first paint, plus 1 Hz refreshes) is unaffected; the cap
# only catches genuine abuse.
#
# Per-endpoint stricter caps stack on top — see backend/api/routes/
# _rate_limit.py for the Claude/full-research/detail/analysis buckets,
# and auth.py's login lockout. Those tighter buckets still apply for
# expensive endpoints.
#
# Exemptions: same as CSRF (webhooks + CSP report) plus the web-vitals
# beacon (browsers fire one per page-nav and we want every signal) and
# health endpoints (load-balancer probes can't authenticate).
#
# Storage: in-process deque per IP, guarded by an asyncio lock. -w 1 in
# prod (BUG-091) means this is fine until horizontal scaling lands; at
# that point swap to Redis (same pattern as _rate_limit.py's B-50
# follow-up).
import asyncio as _rl_asyncio
import time as _rl_time
from collections import defaultdict as _rl_defaultdict, deque as _rl_deque

_GLOBAL_RATE_LIMIT_PATH_PREFIX = "/api/v1/"
_GLOBAL_RATE_LIMIT_EXEMPT_PREFIXES = (
    "/api/v1/webhooks/",
    "/api/v1/security/csp-report",
    "/api/v1/metrics/vitals",
    "/api/v1/auth/login",  # already has its own stricter cap
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
)
_GLOBAL_RATE_LIMIT_MAX = int(os.environ.get("API_GLOBAL_RATE_LIMIT_MAX", "600"))
_GLOBAL_RATE_LIMIT_WINDOW = float(os.environ.get("API_GLOBAL_RATE_LIMIT_WINDOW_SECONDS", "60"))
_global_rate_history: dict[str, "_rl_deque[float]"] = _rl_defaultdict(_rl_deque)
_global_rate_lock = _rl_asyncio.Lock()


def _global_rate_client_key(request: Request) -> str:
    """Per-request bucket key. Use client.host (post-ProxyHeadersMiddleware)
    so the real caller IP is the bucket key, not Caddy's bridge address."""
    return (request.client.host if request.client else None) or "unknown"


@app.middleware("http")
async def enforce_global_rate_limit(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Loose per-IP rate limit on /api/v1/* to catch runaway clients."""
    path = request.url.path
    if not path.startswith(_GLOBAL_RATE_LIMIT_PATH_PREFIX):
        return await call_next(request)
    if any(path.startswith(p) for p in _GLOBAL_RATE_LIMIT_EXEMPT_PREFIXES):
        return await call_next(request)

    key = _global_rate_client_key(request)
    now = _rl_time.monotonic()
    window_start = now - _GLOBAL_RATE_LIMIT_WINDOW

    async with _global_rate_lock:
        bucket = _global_rate_history[key]
        while bucket and bucket[0] < window_start:
            bucket.popleft()
        if len(bucket) >= _GLOBAL_RATE_LIMIT_MAX:
            from core.logging import REQUEST_ID  # local import: avoid cycle
            import logging
            logging.getLogger("alphadesk.ratelimit").warning(
                "global rate limit exceeded",
                extra={
                    "event": "global_rate_limit_exceeded",
                    "path": path,
                    "client_key": key,
                    "bucket_size": len(bucket),
                    "window_s": _GLOBAL_RATE_LIMIT_WINDOW,
                    "request_id": REQUEST_ID.get(),
                },
            )
            retry_after = max(1, int(_GLOBAL_RATE_LIMIT_WINDOW - (now - bucket[0])))
            return JSONResponse(
                {"detail": "Too many requests. Slow down."},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)
    return await call_next(request)

# Only trust X-Forwarded-For from Caddy and the loopback. Caddy lives in the
# ``alphadesk`` user bridge network (172.18+.0.0/16 range, depending on Docker
# assignment). ``trusted_hosts=["*"]`` let any client rotate X-Forwarded-For
# to bypass per-IP rate limits; we now restrict to the private IP ranges Caddy
# actually uses plus loopback for local dev.
#
# Round-4 CLUSTER 6 #22: dropped 10.0.0.0/8 and 192.168.0.0/16 from the
# trusted-hosts list. The docker network inspect of the alphadesk
# compose stack confirms Caddy lives on 172.18.x.x; the older 10.x and
# 192.x entries were a "just in case" addition that broadened the
# trust surface to any LAN client and made per-IP rate limits forgable
# from inside the container's effective routing scope (k8s NodePort
# IPs land on those ranges too).
#
# TRUSTED_PROXY_HOSTS lets production pin the exact Docker bridge subnet
# while local dev keeps a loopback-only default. Single-proxy assumption
# matters: every additional trusted host in the list expands the IPs that
# may legitimately set X-Forwarded-For, which is the bucket key per-IP
# rate limits hash on. ``["*"]`` was a free spoof of any rate-limit bucket.
_TRUSTED_PROXY_HOSTS = [
    host.strip()
    for host in os.getenv("TRUSTED_PROXY_HOSTS", "127.0.0.1,::1").split(",")
    if host.strip()
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


# B2.22: Pydantic v2's default ``string_pattern_mismatch`` error leaks the
# raw regex (``"String should match pattern '^[A-Z]{1,6}(\\.[A-Z])?$'"``)
# into the user-facing ``detail`` blob. Override the handler for the
# symbol-pattern paths so users see a clean "Ticker symbols must be 1-6
# uppercase letters (optionally followed by .X)" message instead.
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.exception_handlers import (
    request_validation_exception_handler as _default_validation_handler,
)  # noqa: E402

_TICKER_PATTERN_RAW = r"^[A-Z]{1,6}(\.[A-Z])?$"
_TICKER_FRIENDLY_MSG = (
    "Ticker symbols must be 1-6 uppercase letters "
    "(optionally followed by .X, e.g. BRK.B)"
)


@app.exception_handler(RequestValidationError)
async def _friendly_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Rewrite ticker-pattern validation errors with a human-readable msg.

    Only touches errors whose ``ctx.pattern`` matches the canonical ticker
    regex; everything else falls through to FastAPI's default handler so
    other validation errors keep their existing shape.
    """
    rewrote = False
    cleaned: list[dict[str, Any]] = []
    for err in exc.errors():
        ctx = err.get("ctx") or {}
        pattern = ctx.get("pattern") if isinstance(ctx, dict) else None
        if (
            err.get("type") == "string_pattern_mismatch"
            and pattern == _TICKER_PATTERN_RAW
        ):
            rewrote = True
            cleaned.append({
                "type": "ticker_format_invalid",
                "loc": err.get("loc"),
                "msg": _TICKER_FRIENDLY_MSG,
                "input": err.get("input"),
            })
        else:
            cleaned.append(err)
    if rewrote:
        return JSONResponse(status_code=422, content={"detail": cleaned})
    return await _default_validation_handler(request, exc)


# --- Routers ---
app.include_router(market.router, prefix="/api/v1/market", tags=["Market Data"], dependencies=[Depends(require_auth)])
app.include_router(screener.router, prefix="/api/v1/screener", tags=["Screener"], dependencies=[Depends(require_auth)])
app.include_router(analysis.router, prefix="/api/v1/analysis", tags=["Analysis"], dependencies=[Depends(require_auth)])
app.include_router(options.router, prefix="/api/v1/options", tags=["Options"], dependencies=[Depends(require_auth)])
app.include_router(trades.router, prefix="/api/v1/trades", tags=["Trades"], dependencies=[Depends(require_auth)])
app.include_router(portfolio.router, prefix="/api/v1/portfolio", tags=["Portfolio"], dependencies=[Depends(require_auth)])
app.include_router(analytics_routes.router, prefix="/api/v1/analytics", tags=["Analytics"], dependencies=[Depends(require_auth)])
app.include_router(agents.router, prefix="/api/v1/agents", tags=["Agents"], dependencies=[Depends(require_auth)])
app.include_router(webhooks.router, prefix="/api/v1/webhooks", tags=["Webhooks"])
app.include_router(symbols.router, prefix="/api/v1/symbols", tags=["Symbols"], dependencies=[Depends(require_auth)])
app.include_router(strategies.router, prefix="/api/v1/strategies", tags=["Strategies"], dependencies=[Depends(require_auth)])

# B3.1: explicit slash-less alias so callers hitting ``/api/v1/strategies``
# (no trailing slash) get the JSON list directly instead of a 307 to
# ``/api/v1/strategies/`` with an empty body. The redirect was reported as
# "0 bytes" by HTTP clients that don't follow redirects automatically.
@app.get(
    "/api/v1/strategies",
    tags=["Strategies"],
    include_in_schema=False,
    dependencies=[Depends(require_auth)],
)
async def _list_strategies_no_slash():  # pragma: no cover - thin alias
    """Slash-less alias for ``GET /api/v1/strategies/`` (B3.1).

    Re-uses the canonical handler from the strategies router so the
    response shape stays in lockstep.
    """
    return await strategies.list_strategies()


# B3.2: alerts live under the trades router (``/api/v1/trades/alerts``)
# but observability/ops dashboards probe ``/api/v1/alerts`` looking for
# system-level alerts and currently get a 404. Surface a top-level alias
# that proxies to the canonical handler so the path-discovery succeeds
# without relocating the underlying route.
@app.get(
    "/api/v1/alerts",
    tags=["Trades"],
    include_in_schema=False,
)
async def _alerts_alias(  # pragma: no cover - thin alias
    response: Response,
    symbol: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0, le=1000),
    username: str = Depends(require_auth),
):
    """Top-level alias for ``GET /api/v1/trades/alerts`` (B3.2)."""
    return await trades.list_alerts(
        response=response,
        symbol=symbol,
        limit=limit,
        offset=offset,
        username=username,
    )


# B3.7: HALT lives at /api/v1/trades/halt-status and /api/v1/trades/halt
# but the global halt is conceptually a risk control, not a trade. Alias
# both verbs under /api/v1/risk/* so ops dashboards / observability looking
# for a system-level halt endpoint find it. The trades-prefixed paths stay
# in place for back-compat — the aliases simply re-dispatch into the same
# canonical handlers.
@app.get(
    "/api/v1/halt-status",
    tags=["Risk"],
    include_in_schema=False,
)
async def _halt_status_top_level_alias(  # pragma: no cover - thin alias
    username: str = Depends(require_auth),
):
    """Top-level alias for ``GET /api/v1/trades/halt-status`` (BUG-063)."""
    return await trades.get_halt_status(username=username)


@app.post(
    "/api/v1/halt",
    tags=["Risk"],
    include_in_schema=False,
)
async def _halt_post_top_level_alias(  # pragma: no cover - thin alias
    req: Request,
    flatten: bool = Query(True),
    reason: str | None = Query(None, max_length=256),
    username: str = Depends(require_auth),
):
    """Top-level alias for ``POST /api/v1/trades/halt`` (BUG-063)."""
    return await trades.halt_trading(
        req=req, flatten=flatten, reason=reason, username=username,
    )


@app.post(
    "/api/v1/halt/resume",
    tags=["Risk"],
    include_in_schema=False,
)
async def _halt_resume_top_level_alias(  # pragma: no cover - thin alias
    req: Request,
    username: str = Depends(require_auth),
):
    """Top-level alias for ``POST /api/v1/trades/resume`` (BUG-063)."""
    return await trades.resume_trading(req=req, username=username)


@app.get(
    "/api/v1/risk/halt-status",
    tags=["Risk"],
    include_in_schema=False,
)
async def _halt_status_risk_alias(  # pragma: no cover - thin alias
    username: str = Depends(require_auth),
):
    """Risk-prefixed alias for ``GET /api/v1/trades/halt-status`` (B3.7)."""
    return await trades.get_halt_status(username=username)


@app.post(
    "/api/v1/risk/halt",
    tags=["Risk"],
    include_in_schema=False,
)
async def _halt_post_risk_alias(  # pragma: no cover - thin alias
    req: Request,
    flatten: bool = Query(True),
    reason: str | None = Query(None, max_length=256),
    username: str = Depends(require_auth),
):
    """Risk-prefixed alias for ``POST /api/v1/trades/halt`` (B3.7)."""
    return await trades.halt_trading(
        req=req, flatten=flatten, reason=reason, username=username,
    )
app.include_router(market_overview.router, prefix="/api/v1/market-overview", tags=["Market Overview"], dependencies=[Depends(require_auth)])
app.include_router(risk.router, prefix="/api/v1/risk", tags=["Risk"], dependencies=[Depends(require_auth)])
app.include_router(pipeline.router, prefix="/api/v1/pipeline", tags=["Pipeline"], dependencies=[Depends(require_auth)])
app.include_router(news.router, prefix="/api/v1/news", tags=["News"], dependencies=[Depends(require_auth)])
app.include_router(tickers.router, prefix="/api/v1/tickers", tags=["Tickers"], dependencies=[Depends(require_auth)])
# Fundamental snapshot endpoint — split out of the main tickers router to
# keep the per-symbol cache key + response model isolated. Same prefix so
# clients see ``/api/v1/tickers/{sym}/fundamentals`` alongside the
# existing ``/api/v1/tickers/context`` endpoint.
app.include_router(tickers_fundamentals.router, prefix="/api/v1/tickers", tags=["Tickers"], dependencies=[Depends(require_auth)])
app.include_router(earnings.router, prefix="/api/v1", tags=["Earnings"], dependencies=[Depends(require_auth)])
app.include_router(tradingagents.router, prefix="/api/v1/tradingagents", tags=["TradingAgents"], dependencies=[Depends(require_auth)])
app.include_router(broker_routes.router, prefix="/api/v1/broker", tags=["Broker"], dependencies=[Depends(require_auth)])
# Round-7 / M-8: web-vitals beacon — public endpoint (sendBeacon
# fires from unauth pages too, and require_auth would silently drop
# every landing-page sample). Validated payload shape + per-IP
# rate-limit at the route layer keeps abuse bounded.
app.include_router(metrics_routes.router, prefix="/api/v1/metrics", tags=["Metrics"])
app.include_router(access_requests_routes.router, prefix="/api/v1/access-requests", tags=["Access Requests"])
# PM-5 (audit/2026-05-05-position-management): admin CRUD for the
# configurable exit-rules engine. Auth-required; rule edits are
# sensitive (an enabled 21-DTE rule will close every position on
# Friday-of-opex).
app.include_router(exit_rules_routes.router, prefix="/api/v1/exit-rules", tags=["Exit Rules"], dependencies=[Depends(require_auth)])
# Admin Control Center — provider-agnostic key rotation, dashboard
# layout config, and a "Push to prod" button that triggers the GitHub
# Actions deploy workflow. Routes self-gate via require_admin /
# require_auth (the layout GET is auth-only because the dashboard
# fetches it on every authed mount).
app.include_router(admin_control_routes.router, prefix="/api/v1", tags=["Admin Control Center"])
# Round-23 / persona-A P0: CSP violation report ingest. Public endpoint
# (browsers POST without credentials when violation fires); validated +
# per-IP rate-limited at the route layer. Used by the Report-Only CSP
# in Caddyfile to inventory inline scripts/styles before flipping the
# enforced policy.
from api.routes import security as security_routes  # noqa: E402
app.include_router(security_routes.router, prefix="/api/v1/security", tags=["Security"])
app.include_router(auth_routes.router, prefix="/api/v1/auth", tags=["Auth"])
# Wave 4Q (persona-103): user-rights endpoints (GDPR Art. 17 + Art. 20 /
# CCPA parity).  Auth is enforced INSIDE each handler via Depends(require_auth)
# rather than router-level so the handlers can also do a password re-auth
# on the erase path — a router-level dep would fire before we can read the
# body for the password field.
app.include_router(user_routes.router, prefix="/api/v1/user", tags=["User Rights"])

# v2 Phase B (B.1–B.18) — backend extensions per the redesign plan.
# Mounted after the existing routers so frontends opt in via the new
# /api/v1 paths without disturbing established endpoints. Each router
# owns one slice; ALL_V2_MISC_ROUTERS bundles the read-mostly slices
# (B.5/B.7/B.9–B.15/B.17/B.18) for compactness.
app.include_router(v2_pipeline_stages.router, prefix="/api/v1", tags=["v2 Pipeline Stages"])
app.include_router(v2_agent_control.router, prefix="/api/v1", tags=["v2 Agent Control"])
app.include_router(v2_watchlists.router, prefix="/api/v1", tags=["v2 Watchlists"])
app.include_router(v2_notifications.router, prefix="/api/v1", tags=["v2 Notifications"])
app.include_router(v2_user_settings.router, prefix="/api/v1", tags=["v2 User Settings"])
app.include_router(v2_user_settings.mode_router, prefix="/api/v1", tags=["v2 User Trading Mode"])
app.include_router(v2_user_layout.router, prefix="/api/v1", tags=["v2 User Layout"])
app.include_router(v2_feature_flags.router, prefix="/api/v1", tags=["v2 Feature Flags"])
app.include_router(v2_feature_flags.admin_router, prefix="/api/v1", tags=["v2 Feature Flags Admin"])
for v2_router in ALL_V2_MISC_ROUTERS:
    app.include_router(v2_router, prefix="/api/v1")

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
    # BUG-093: capture client IP so audit-writing helpers without a Request
    # in scope (e.g., wash_trade surveillance, pipeline workers triggered
    # by a request) can stamp the IP on their audit entries via CLIENT_IP.
    client_ip = (request.client.host if request.client else None) or request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or None
    rid_token = REQUEST_ID.set(request_id)
    ip_token = CLIENT_IP.set(client_ip)
    try:
        response = await call_next(request)
    finally:
        REQUEST_ID.reset(rid_token)
        CLIENT_IP.reset(ip_token)
    response.headers["X-Request-ID"] = request_id
    return response


# --- Health ---
# Round-6 L-14: /livez and /readyz are PUBLIC (load-balancer probes
# can't authenticate), so we strip ``git_sha`` from their JSON.
# Leaking the deploy SHA gives an unauthenticated attacker a ground-
# truth signal of which version is running, narrowing the
# vulnerability window for any version-specific CVE. The SHA still
# lives behind /readyz-full, which is now gated by ``require_auth``.
@app.get("/livez", tags=["Health"])
async def livez() -> dict:
    """Liveness probe — process is up and accepting requests.

    Used by docker/Kubernetes to decide whether to restart the container.
    No dependency checks: any failure here means the Python process itself
    is wedged, and a restart is the correct recovery.

    Round-6 L-14: ``git_sha`` removed from this public endpoint.
    Authenticated callers can still get the SHA via /readyz-full.
    """
    return {"status": "ok"}


@app.get("/health", tags=["Health"])
@app.get("/healthz", tags=["Health"])
async def health_check() -> dict:
    """Aliases for /livez.

    /health: legacy compat — docker-compose.prod.yml healthcheck.
    /healthz: Kubernetes-style convention; pairs with the existing /readyz.

    Round-6 L-14: ``git_sha`` removed (see /livez).
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
            # Round-11 / BB-21 (P2): emit a structured event + Redis
            # counter so an external probe / alert rule can detect
            # disk-pressure without scraping the body. We deliberately
            # keep the HTTP status at 200 (LB-friendly) — flipping to
            # 503 here would drop the container out of rotation, which
            # is wrong for "disk almost full" (not the same kind of
            # outage as DB-down).
            logger.warning(
                "readyz: disk pressure detected (%.1f%% used)",
                pct,
                extra={"event": "readyz_disk_pressure", "pct": pct, "path": data_path},
            )
    except Exception as e:
        # Don't flap readyz over a shutil / fs hiccup.
        result["disk"] = f"check_failed: {type(e).__name__}"
        # Round-11 / BB-21: also surface check failures on telemetry so
        # a permission regression doesn't go silent for weeks.
        logger.warning(
            "readyz: disk check failed",
            exc_info=e,
            extra={"event": "readyz_disk_check_failed"},
        )

    status_code = 200 if overall_ok else 503
    if overall_ok:
        result["status"] = "degraded" if degraded else "ok"
    else:
        result["status"] = "degraded"
    return JSONResponse(status_code=status_code, content=result)


# ─── /readyz-full ─ deep health probe (B-31 + Round-5 Cluster D) ──────
#
# `/readyz` is the load-balancer probe — fast, local deps only, 503 drops
# the container out of rotation. Pulling it out because Anthropic had a
# 5-min hiccup would be the wrong trade-off. `/readyz-full` is the
# monitoring-dashboard probe — it additionally queries FMP and Anthropic
# with short timeouts and reports a per-dependency status, plus today's
# Claude spend (H-2), the current sizes of the in-memory dedup dicts
# (H-7), and the deploy git SHA (H-8).
#
# Variable TTL (H-4): 30 s when status=ok, 5 s when degraded — so a
# recovering system isn't masked by a stale ok-snapshot, while a healthy
# snapshot caches long enough that a curl-loop probe doesn't pound the
# DB / Redis / paid upstreams.
import time as _time  # alias to avoid the ``import time`` shadowing risk

_READYZ_FULL_CACHE: dict[str, Any] = {"snapshot": None, "ts": 0.0, "status": ""}
_READYZ_FULL_TTL_OK_S = 30.0
_READYZ_FULL_TTL_DEGRADED_S = 5.0
# Audit P0-3 (2026-05-05): the cache is updated across three separate
# dict assignments below. Without a lock, a concurrent reader between
# the snapshot write and the timestamp write sees a fresh snapshot but
# a stale ``ts``, computes a huge ``age``, and bypasses the TTL guard
# — triggering a full FMP + Anthropic recompute on every concurrent
# request. The lock serialises the writer; readers continue to use the
# (atomic) dict-key reads on the fast path.
_READYZ_FULL_LOCK: asyncio.Lock = asyncio.Lock()


async def _probe_fmp() -> dict[str, Any]:
    """Cheap FMP health probe. Returns {"status": "ok|down|skipped", "latency_ms": ...}."""
    from core.config import settings
    key = settings.FMP_API_KEY.get_secret_value() if settings.FMP_API_KEY else ""
    if not key:
        return {"status": "skipped", "reason": "FMP_API_KEY not configured"}
    try:
        import httpx
        t0 = _time.perf_counter()
        async with httpx.AsyncClient(timeout=2.0) as client:
            # /earnings-calendar limited to a one-day window; tiny response.
            r = await client.get(
                "https://financialmodelingprep.com/api/v3/quote/AAPL",
                params={"apikey": key},
            )
        latency_ms = round((_time.perf_counter() - t0) * 1000, 1)
        if r.status_code == 200:
            return {"status": "ok", "latency_ms": latency_ms}
        return {
            "status": "degraded", "latency_ms": latency_ms,
            "reason": f"HTTP {r.status_code}",
        }
    except Exception as e:
        return {"status": "down", "reason": f"{type(e).__name__}: {e}"}


async def _probe_anthropic() -> dict[str, Any]:
    """Cheap Anthropic health probe via /models (no token billing)."""
    from core.config import settings
    key = settings.ANTHROPIC_API_KEY.get_secret_value() if settings.ANTHROPIC_API_KEY else ""
    if not key:
        return {"status": "skipped", "reason": "ANTHROPIC_API_KEY not configured"}
    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=key)
        t0 = _time.perf_counter()
        await asyncio.wait_for(client.models.list(limit=1), timeout=2.0)
        latency_ms = round((_time.perf_counter() - t0) * 1000, 1)
        return {"status": "ok", "latency_ms": latency_ms}
    except asyncio.TimeoutError:
        return {"status": "degraded", "reason": "timeout > 2s"}
    except Exception as e:
        return {"status": "down", "reason": f"{type(e).__name__}: {e}"}


@app.get("/readyz-full", tags=["Health"], dependencies=[Depends(require_auth)])
async def readyz_full() -> JSONResponse:
    """Deep readiness probe — DB + Redis + Claude spend + dict sizes.

    Round-5 Cluster D enhancements:
      * H-2: ``claude_spend_today_usd`` — running daily total in Redis.
      * H-4: variable TTL — 30 s when status=ok, 5 s when degraded.
      * H-7: ``dict_sizes`` block exposing inflight_structured len so a
        memory leak shows up before OOM.
      * H-8: ``git_sha`` so a curl-loop knows which deploy is live.

    External dependencies (FMP, Anthropic) are best-effort — failures
    flag the response degraded but never trigger a 503 (upstream
    outages shouldn't drop the container out of LB rotation).

    Round-6 L-14: now gated by ``require_auth``. The body exposes
    Claude spend (operational secret), in-flight dict sizes (capacity
    signal an attacker could time DoS bursts against), and git_sha
    (vulnerability triage signal). None of those should be on a
    public endpoint.
    """
    now = _time.monotonic()
    age = now - _READYZ_FULL_CACHE["ts"]
    cached_status = _READYZ_FULL_CACHE.get("status", "")
    ttl = _READYZ_FULL_TTL_OK_S if cached_status == "ok" else _READYZ_FULL_TTL_DEGRADED_S
    if _READYZ_FULL_CACHE["snapshot"] is not None and age < ttl:
        snap = dict(_READYZ_FULL_CACHE["snapshot"])
        # ``_http_status`` is internal — strip it before returning.
        http_status = snap.pop("_http_status", 200)
        snap["cache_age_s"] = round(age, 2)
        return JSONResponse(status_code=http_status, content=snap)

    # Audit P0-3: serialise the recompute path so concurrent waiters
    # share one upstream call rather than each launching their own
    # FMP + Anthropic probes. After acquiring the lock, re-check the
    # cache — the previous holder may have just written a fresh value.
    async with _READYZ_FULL_LOCK:
        now = _time.monotonic()
        age = now - _READYZ_FULL_CACHE["ts"]
        cached_status = _READYZ_FULL_CACHE.get("status", "")
        ttl = _READYZ_FULL_TTL_OK_S if cached_status == "ok" else _READYZ_FULL_TTL_DEGRADED_S
        if _READYZ_FULL_CACHE["snapshot"] is not None and age < ttl:
            snap = dict(_READYZ_FULL_CACHE["snapshot"])
            http_status = snap.pop("_http_status", 200)
            snap["cache_age_s"] = round(age, 2)
            return JSONResponse(status_code=http_status, content=snap)

        return await _readyz_full_recompute(now)


async def _readyz_full_recompute(now: float) -> JSONResponse:
    """Recompute path for ``readyz_full``. Caller must hold ``_READYZ_FULL_LOCK``."""
    # ── Recompute ─────────────────────────────────────────────────
    snapshot: dict[str, Any] = {}
    overall_ok = True

    # DB — proves the connection pool is live.
    try:
        from sqlalchemy import text
        from core.database import _get_engine

        engine = _get_engine()

        async def _db_ping() -> None:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))

        await asyncio.wait_for(_db_ping(), timeout=0.8)
        snapshot["db"] = "ok"
    except Exception as e:
        overall_ok = False
        snapshot["db"] = f"down: {type(e).__name__}"

    # Redis ping.
    try:
        redis = await get_redis()
        await asyncio.wait_for(redis.ping(), timeout=0.5)
        snapshot["redis"] = "ok"
    except Exception as e:
        overall_ok = False
        snapshot["redis"] = f"down: {type(e).__name__}"

    # External upstream probes — flag-only (don't 503).
    try:
        fmp, anthropic_r = await asyncio.gather(
            _probe_fmp(), _probe_anthropic(),
        )
        snapshot["fmp"] = fmp
        snapshot["anthropic"] = anthropic_r
    except Exception as e:
        snapshot["fmp"] = {"status": "skipped", "reason": str(e)}
        snapshot["anthropic"] = {"status": "skipped", "reason": str(e)}

    # H-2: live Claude spend.
    try:
        from agents.claude_client import get_today_claude_spend_usd
        snapshot["claude_spend_today_usd"] = round(
            await get_today_claude_spend_usd(), 4
        )
    except Exception:
        snapshot["claude_spend_today_usd"] = None

    # H-7: dict size snapshot. Helps catch memory leaks before OOM.
    try:
        from services import earnings_screener as _es
        snapshot["dict_sizes"] = {
            "inflight_structured": len(_es._inflight_structured),
            "fmp_upcoming_locks": len(_es._FMP_UPCOMING_LOCKS),
        }
    except Exception:
        snapshot["dict_sizes"] = {}

    # H-8: git_sha so a curl-loop monitor knows which build is live.
    try:
        from core.logging import GIT_SHA
        snapshot["git_sha"] = GIT_SHA
    except Exception:
        snapshot["git_sha"] = "unknown"

    if overall_ok:
        # External "down" → degraded but still HTTP 200.
        if any(
            isinstance(snapshot.get(k), dict) and snapshot[k].get("status") == "down"
            for k in ("fmp", "anthropic")
        ):
            snapshot["status"] = "degraded"
        else:
            snapshot["status"] = "ok"
        snapshot["_http_status"] = 200
    else:
        snapshot["status"] = "degraded"
        snapshot["_http_status"] = 503

    _READYZ_FULL_CACHE["snapshot"] = dict(snapshot)
    _READYZ_FULL_CACHE["ts"] = now
    _READYZ_FULL_CACHE["status"] = snapshot["status"]

    out = dict(snapshot)
    http_status = out.pop("_http_status", 200)
    out["cache_age_s"] = 0.0
    return JSONResponse(status_code=http_status, content=out)
