"""
AlphaDesk Daily Trading Pipeline — Multi-Strategy Edition

Runs every trading day:
1. Create Master Agent (portfolio gatekeeper)
2. Run each strategy: screen -> analyze -> generate trades (ask Master)
3. Execute approved trades via Alpaca
4. Check exits for existing positions
5. Log everything
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from core.config import settings
from data.ingestion.master_agent import MasterAgent
from data.ingestion.strategy_runner import (
    ALL_STRATEGIES,
    BaseStrategyRunner,
)
from data.ingestion.trade_ledger import TradeLedger

logger = logging.getLogger("alphadesk.pipeline")

ET = ZoneInfo("America/New_York")

# ----- Safety constants -----
MAX_POSITION_PCT = 0.06          # 6 % of equity per position (avoids rounding rejections)
MAX_POSITION_DOLLAR = 6_000.0    # hard cap per position
MAX_OPEN_POSITIONS = 15
MAX_DAILY_TRADES = 30
CIRCUIT_BREAKER_PCT = -0.02      # stop if daily P&L < -2 %
MIN_CONVICTION = 50
ANALYZE_TOP_N = 40               # total analysis budget across all strategies
SCREEN_TOP_N = 100               # screen more, strategies will filter

CLAUDE_CLI = os.environ.get("CLAUDE_CLI_PATH", "claude")
LOG_DIR = Path(__file__).resolve().parent.parent / "pipeline_logs"


_VIX_CACHE_KEY = "pipeline:last_vix_level"
_VIX_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7  # one week


async def _get_vix_level(client: httpx.AsyncClient) -> float | None:
    """Fetch VIX level from the market-overview regime endpoint or Polygon.

    Returns ``None`` when both providers fail AND there is no cached prior
    value. The previous behaviour silently returned 16.5 ("bull_low_vol")
    on any failure — so if real VIX was 30+ during a crisis, MasterAgent
    would oversize positions at exactly the wrong moment
    (code-patterns-audit-r4 P0 #1).

    On success we cache the value in Redis so the next pipeline run can
    fall back to the prior day's VIX (safer than a hardcoded constant).
    """
    from core.redis import cache_get, cache_set

    fetched: float | None = None
    fetch_errors: list[str] = []

    # Try our own regime endpoint first (uses Polygon VIX data)
    try:
        from api.routes.market_overview import _get_regime_data
        regime = await _get_regime_data()
        if regime and "vix_level" in regime:
            fetched = float(regime["vix_level"])
    except Exception as exc:
        fetch_errors.append(f"regime endpoint: {exc}")
        logger.exception("VIX fetch via regime endpoint failed")

    # Fallback: fetch ^VIX from Polygon if available
    if fetched is None:
        try:
            from core.config import settings
            polygon_key = settings.POLYGON_API_KEY.get_secret_value()
            if polygon_key:
                resp = await client.get(
                    f"{settings.POLYGON_BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers/VIX",
                    params={"apiKey": polygon_key},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    last = data.get("ticker", {}).get("lastTrade", {}).get("p")
                    if last and last < 100:  # sanity check
                        fetched = round(float(last), 1)
                else:
                    fetch_errors.append(
                        f"Polygon VIX HTTP {resp.status_code}"
                    )
        except Exception as exc:
            fetch_errors.append(f"Polygon VIX: {exc}")
            logger.exception("VIX fetch via Polygon failed")

    if fetched is not None:
        # Cache for the next run's fallback
        try:
            await cache_set(_VIX_CACHE_KEY, {"vix": fetched}, ttl_seconds=_VIX_CACHE_TTL_SECONDS)
        except Exception:
            logger.debug("Could not persist VIX to Redis cache", exc_info=True)
        return fetched

    # Both providers failed — try yesterday's cached VIX before giving up.
    try:
        cached = await cache_get(_VIX_CACHE_KEY)
        if cached and isinstance(cached, dict) and "vix" in cached:
            prior = float(cached["vix"])
            logger.error(
                "VIX fetch failed (%s); using prior cached VIX=%.1f",
                "; ".join(fetch_errors) or "unknown", prior,
            )
            return prior
    except Exception:
        logger.debug("VIX cache lookup failed", exc_info=True)

    # Truly no data — return None. Caller MUST handle.
    logger.error(
        "VIX fetch failed and no cached prior value: %s",
        "; ".join(fetch_errors) or "unknown",
    )
    return None

# ----- Halt checkpoint (persona-16 P0-1) -----
# The admin panic-button halt flag lives in Redis under the same key that
# ``backend/api/routes/trades.py`` writes to from ``POST /api/v1/trades/halt``.
# Before persona-16 the pipeline ignored it entirely — an operator hitting
# the button still watched the bot trade on the next cron tick. We now check
# the flag at every pipeline stage entry.

_HALT_REDIS_KEY = "trading:halted"

# Wave C (persona 74 P0 #3): bound the Redis halt-check so a wedged Redis
# connection can't stall the order path indefinitely.
#
# 2026-04-20 — raised from 0.5s to 2.0s. In production, 0.5s was being hit
# under load (~5 timeouts/hour on the master-agent loop) because the Redis
# call can coincide with a cold-connection handshake or a brief event-loop
# pause from another awaitable. Every timeout caused fail-closed HALTED,
# which cascaded into "Strategy X skipped" for every strategy in that
# pipeline tick — i.e. the bot stopped trading for ~30 min per false
# positive. 2s is still well under the pipeline stage budget and still
# sub-second-plus-headroom for a real panic-button press.
_HALT_CHECK_TIMEOUT_SECONDS = 2.0


async def _is_trading_halted() -> bool:
    """Return True if the admin halt flag is set.

    Canonical implementation — ``backend/api/routes/trades.py`` imports this
    rather than keep a duplicate copy (Wave C dedup). Previously there were
    two near-identical copies in ``trades.py`` and here with subtly
    different error-message wording; the trades copy was dropped in favour
    of this one so a fix here applies everywhere.

    Wave 4P Fix 1 (P96) — two-tier read path.  Postgres is now the
    SOURCE OF TRUTH; Redis is a cache.  Order of operations:

        1. Read ``halt_state.is_halted`` from Postgres.  If the row
           says halted, return True immediately.
        2. Fall back to Redis (0.5s timeout) as a fast-path cache ONLY
           when Postgres is unreachable.
        3. If BOTH stores are unreachable AND no cache entry exists,
           fail CLOSED (return True). An outage must not silently
           enable trading.

    Before this fix, a Redis ``FLUSHALL`` or cold restart would erase
    the halt key and trading would auto-resume on the next tick.  The
    Postgres row survives both — the cache is purely a latency
    optimisation.
    """
    # ---- Primary read: Postgres (source of truth) -------------------
    pg_ok = False
    pg_halted = False
    skip_db = False
    try:
        from core.config import settings as _s
        if _s.SKIP_DB_INIT:
            # SKIP_DB_INIT mode — no DB available, rely on Redis alone.
            # This preserves the pre-Wave-4P test behaviour where the
            # halt flag flows through Redis only.
            skip_db = True
        else:
            from core.database import _get_session_factory
            from data.storage.models import HaltState

            factory = _get_session_factory()
            async with factory() as db:
                row = await db.get(HaltState, 1)
                if row is not None:
                    pg_ok = True
                    pg_halted = bool(row.is_halted)
                else:
                    # No seed row — treat as not halted.  Marks the
                    # primary read as "succeeded" so we don't fail-closed
                    # when the migration hasn't run yet (test fixtures).
                    pg_ok = True
                    pg_halted = False
    except Exception:
        # Postgres unreachable — fall through to Redis cache.
        logger.warning(
            "Halt-flag PG read failed; falling through to Redis cache",
            exc_info=True,
        )

    if pg_ok:
        # Keep the Redis cache in sync with the authoritative answer so
        # downstream consumers that tail the key don't flap.  Best-effort.
        try:
            from core.redis import cache_set, get_redis
            if pg_halted:
                await cache_set(
                    _HALT_REDIS_KEY, {"halted": True}, ttl_seconds=86400,
                )
            else:
                r = await get_redis()
                if r is not None:
                    await r.delete(_HALT_REDIS_KEY)
        except Exception:
            logger.debug(
                "Halt-flag cache refresh skipped (Redis unreachable)",
                exc_info=True,
            )
        return pg_halted

    # ---- Fallback: Redis cache --------------------------------------
    # Either Postgres is unavailable OR SKIP_DB_INIT=True (test /
    # offline dev loop).  Redis may still have the cached answer (e.g.
    # from the last successful _is_trading_halted() call before
    # Postgres went down, or from the halt endpoint that writes
    # through to the cache).  An ERROR from Redis (timeout /
    # exception) is still fail-closed, but a clean "key not found"
    # falls through to False — otherwise a test / fresh-install
    # environment with no halt ever set would permanently appear
    # halted.
    #
    # Wave 6β Fix 7 (from Round-5 deferred) — when BOTH Postgres and
    # Redis are effectively unreachable (pg_ok=False AND Redis key
    # absent / Redis down), we MUST fail-closed in production.  The
    # pre-Wave-4P "missing key = not halted" semantics are preserved
    # only when ``SKIP_DB_INIT=True`` (the test / offline dev loop).
    # In production, ``pg_ok=False`` implies an actual DB outage —
    # returning False in that state means trading proceeds against
    # an unknown halt status, which is the exact scenario the
    # kill-switch exists to prevent.
    try:
        from core.redis import cache_get
        result = await asyncio.wait_for(
            cache_get(_HALT_REDIS_KEY),
            timeout=_HALT_CHECK_TIMEOUT_SECONDS,
        )
        if result is not None and isinstance(result, dict):
            return bool(result.get("halted", False))
        # Key absent in Redis.
        if skip_db:
            # Test / SKIP_DB_INIT loop — no DB ever, absent key ==
            # "no halt was ever set".  Preserves pre-Wave-4P semantics.
            return False
        # Production branch.  Postgres read FAILED above (pg_ok=False)
        # AND Redis has no cache entry.  Both stores are unusable for a
        # positive "not halted" answer — fail CLOSED.  Logged at ERROR
        # so oncall is paged by the log pipeline.
        logger.error(
            "Halt-flag check: both Postgres read AND Redis cache lookup "
            "are unusable (pg_ok=%s, redis_key_absent=True); "
            "treating as HALTED for safety",
            pg_ok,
        )
        return True
    except asyncio.TimeoutError:
        logger.error(
            "Halt-flag check timed out after %.2fs; treating as HALTED for safety",
            _HALT_CHECK_TIMEOUT_SECONDS,
        )
        return True
    except Exception:
        logger.warning(
            "Halt-flag check failed; treating as HALTED for safety",
            exc_info=True,
        )
        return True


async def halt_state_resync_on_boot() -> None:
    """Emit a ``halt_state_resync`` audit event if Redis drifted from PG.

    Wave 4P Fix 1 (P96) — if a ``FLUSHALL`` or cold Redis restart
    wiped the cache while Postgres says halted (or vice-versa),
    surface the mismatch via ``core.audit`` so the operator knows the
    cache was re-materialised from the DB.  Best-effort — boot must
    not be blocked by an audit failure.
    """
    try:
        from core.config import settings as _s
        if _s.SKIP_DB_INIT:
            return

        from core.database import _get_session_factory
        from data.storage.models import HaltState
        from core.redis import cache_get, cache_set, get_redis
        from core.audit import write_audit

        factory = _get_session_factory()
        async with factory() as db:
            row = await db.get(HaltState, 1)
            pg_halted = bool(row.is_halted) if row is not None else False

        redis_halted = False
        cache_present = False
        try:
            cached = await cache_get(_HALT_REDIS_KEY)
            if cached is not None and isinstance(cached, dict):
                cache_present = True
                redis_halted = bool(cached.get("halted", False))
        except Exception:
            logger.debug("halt_state_resync: redis read failed", exc_info=True)

        if pg_halted != redis_halted or (pg_halted and not cache_present):
            # Re-hydrate Redis from Postgres so future reads can use the
            # fast path, then log a durable audit entry.
            try:
                if pg_halted:
                    await cache_set(
                        _HALT_REDIS_KEY, {"halted": True}, ttl_seconds=86400,
                    )
                else:
                    r = await get_redis()
                    if r is not None:
                        await r.delete(_HALT_REDIS_KEY)
            except Exception:
                logger.debug("halt_state_resync: rehydrate failed", exc_info=True)

            await write_audit(
                "halt_state_resync",
                username=None,
                ip=None,
                request_id=None,
                details={
                    "pg_halted": pg_halted,
                    "redis_halted": redis_halted,
                    "redis_cache_present": cache_present,
                    "reason": "redis_wiped_or_drift_detected",
                },
            )
    except Exception:
        logger.debug(
            "halt_state_resync: skipped (non-fatal boot check failure)",
            exc_info=True,
        )


# ----- Pipeline state -----
# `_pipeline_lock` is the single source of truth for "is the pipeline currently
# running" — `.locked()` is exposed via /pipeline/status. The dict below holds
# everything else operators need to see live (persona-7 #1, #4, #5).
_pipeline_lock = asyncio.Lock()

# Live, mutable state — read by ``get_pipeline_status`` on every poll. The
# pipeline writes to these as it crosses stage boundaries so an operator
# refreshing /pipeline can actually see what's happening.
CURRENT_STAGE: str | None = None
CURRENT_STRATEGY: str | None = None
CURRENT_PROGRESS: dict[str, int] | None = None  # {"current": N, "total": M}
CURRENT_STARTED_AT: datetime | None = None
CURRENT_RUN_ID: str | None = None

# Cooperative cancellation flag. ``request_cancel`` flips this True; the
# pipeline checks it at every major boundary (start of each stage, after
# each strategy) and exits gracefully writing ``last_result = "cancelled"``.
# Reset to False at the start of every run.
CANCEL_REQUESTED: bool = False

_pipeline_status: dict[str, Any] = {
    "last_run": None,
    "last_result": None,
}


def _reset_live_state() -> None:
    """Clear all live-run globals — called at run-start AND in the finally
    block so a crashed run does not leave stale stage/progress visible to
    operators on the next poll."""
    global CURRENT_STAGE, CURRENT_STRATEGY, CURRENT_PROGRESS
    global CURRENT_STARTED_AT, CURRENT_RUN_ID
    CURRENT_STAGE = None
    CURRENT_STRATEGY = None
    CURRENT_PROGRESS = None
    CURRENT_STARTED_AT = None
    CURRENT_RUN_ID = None


def request_cancel() -> bool:
    """Flip the cooperative cancel flag. Returns True if a run is currently
    in flight (so the caller can confirm the cancel will be honoured), False
    if the pipeline is already idle."""
    global CANCEL_REQUESTED
    if not _pipeline_lock.locked():
        return False
    CANCEL_REQUESTED = True
    logger.warning(
        "Pipeline cancel requested (run_id=%s, stage=%s, strategy=%s)",
        CURRENT_RUN_ID, CURRENT_STAGE, CURRENT_STRATEGY,
    )
    return True


class _PipelineCancelled(Exception):
    """Raised at a cancel checkpoint to unwind the pipeline cleanly. Caught
    in ``_run_pipeline_inner``'s try/except so the run terminates with
    ``last_result = "cancelled"`` instead of a generic exception trace."""


def _check_cancel(stage: str | None = None) -> None:
    """Cooperative cancel checkpoint. Call at major stage/loop boundaries.
    Raises ``_PipelineCancelled`` if a cancel was requested since the last
    check — caller is expected to let it propagate to the run wrapper.

    Stages where we check (in order):
      - top of run (before any expensive call)
      - after master agent setup
      - before each strategy in the screen/analyze/risk loop
      - before order execution
      - before exit checking
    """
    if CANCEL_REQUESTED:
        logger.warning(
            "Pipeline cancel honoured at stage=%s (run_id=%s)",
            stage or CURRENT_STAGE, CURRENT_RUN_ID,
        )
        raise _PipelineCancelled(stage or CURRENT_STAGE or "unknown")


def get_pipeline_status() -> dict[str, Any]:
    """Return a JSON-serialisable snapshot of pipeline state for /status.

    `running` is derived from ``_pipeline_lock.locked()`` — there is no
    second source of truth to drift out of sync with. `started_at` is
    serialized to ISO 8601 (the rest of the dict already is).
    """
    return {
        "running": _pipeline_lock.locked(),
        "stage": CURRENT_STAGE,
        "current_strategy": CURRENT_STRATEGY,
        "progress": dict(CURRENT_PROGRESS) if CURRENT_PROGRESS else None,
        "started_at": CURRENT_STARTED_AT.isoformat() if CURRENT_STARTED_AT else None,
        "run_id": CURRENT_RUN_ID,
        "last_run": _pipeline_status.get("last_run"),
        "last_result": _pipeline_status.get("last_result"),
    }


# =====================================================================
# Helpers
# =====================================================================

def _alpaca_headers() -> dict[str, str]:
    """Return server-wide Alpaca headers from env settings.

    DEPRECATED in multi-user deployments — ``_alpaca_creds_for_user`` should
    be used wherever a ``username`` is in scope so per-user
    :class:`BrokerConnection` rows are honoured (Audit MB-P0-1). This
    helper remains for legacy single-admin deployments and for callers that
    have not yet been threaded through with username.
    """
    return {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        "Content-Type": "application/json",
    }


async def _alpaca_creds_for_user(
    username: str | None,
) -> tuple[dict[str, str], str]:
    """Resolve (headers, base_url) for the given user, falling back to env.

    Mirrors the pattern in ``api.routes.trades._alpaca_credentials_or_503``:

      * When ``username`` is provided, look up the active
        :class:`BrokerConnection` row and use its decrypted credentials and
        per-environment base URL (paper vs live). This keeps multi-user
        deployments routing each user's automated orders through their own
        Alpaca account.

      * When ``username`` is ``None`` or no DB row matches, fall back to
        the server-wide env credentials returned by ``_alpaca_headers()`` /
        ``_base_url()``. A deprecation warning is logged so audits can
        flag any internal caller that has not yet been threaded with the
        owning username (Audit MB-P0-1).

    Raises ``RuntimeError`` only when the env-fallback path itself trips
    the safety check in ``_base_url()`` (live broker without
    ``LIVE_TRADING_ENABLED``); broker-credential errors are surfaced via
    :class:`services.broker_connections.BrokerCredentialError` which the
    caller propagates so the pipeline aborts instead of silently routing
    to the wrong account.
    """
    if username:
        try:
            from services.broker_connections import get_alpaca_credentials

            creds = await get_alpaca_credentials(username)
            if creds is not None:
                headers = {
                    **creds.headers,
                    "Content-Type": "application/json",
                }
                return headers, creds.base_url.rstrip("/")
        except Exception:
            # Surface the credential error rather than silently using env
            # creds — multi-user deployments must not route a scheduled
            # strategy to the wrong account when DB lookup blows up.
            raise
    else:
        logger.warning(
            "daily_pipeline: alpaca creds resolved without a username "
            "(falling back to env credentials). Multi-user deployments "
            "should thread `username` through to honour per-user "
            "BrokerConnection rows. See Audit MB-P0-1."
        )
    return _alpaca_headers(), _base_url()


def _base_url() -> str:
    """Return the broker base URL.

    Wave-A bypass-fix: the previous ``"paper" not in url`` substring check
    was both brittle (path-only match could be tricked) and over-blocking
    (refused live even when intended). The new policy:

    * Reject only when the URL points at the live broker (canonical host
      ``api.alpaca.markets``) AND the operator has NOT opted in via
      ``LIVE_TRADING_ENABLED=True``.
    * Per-strategy live-deny enforcement is layered on top in
      ``_place_order`` / ``_place_bracket_order`` via
      ``core.trading_gate.reject_if_live_forbidden``.
    """
    from core.config import is_live_alpaca_base_url
    url = settings.ALPACA_BASE_URL
    if is_live_alpaca_base_url(url) and not getattr(settings, "LIVE_TRADING_ENABLED", False):
        raise RuntimeError(
            f"SAFETY: ALPACA_BASE_URL ({url}) points at the live broker but "
            "LIVE_TRADING_ENABLED is False. Refusing to trade on a live account "
            "without explicit operator opt-in."
        )
    return url.rstrip("/")


def _is_within_trading_window() -> bool:
    """Return True when now is inside today's real equity session.

    Wave 4R: previously hard-coded 9:35–15:55 ET, which:

    * Fired against a closed market on half-days (Thanksgiving-eve, Jul 3)
      where the session ends at 13:00 ET — Alpaca rejects any MOC order
      submitted after the bell.
    * Returned True on full holidays (MLK, Good Friday, Christmas-on-a-
      weekday) because the check was purely a clock comparison with no
      calendar awareness.

    The replacement consults the shared :mod:`data.calendar` singleton so a
    single holiday table (``pandas_market_calendars`` NYSE schedule) is the
    authority for both the scheduler and the trade-submission path.

    The 5-minute lead-in (``open + 5min``) preserves the previous
    behaviour of skipping the first few minutes of chaotic open-cross
    prints; the 5-minute lead-out (``close - 5min``) matches the old
    15:55 ET cutoff so MOC orders have a minute-or-two slack for the
    broker to accept them before the bell.
    """
    from data.calendar import (
        is_trading_day as _is_trading_day,
        market_open as _market_open,
        market_close as _market_close,
    )

    now_et = datetime.now(ET)
    today = now_et.date()
    if not _is_trading_day(today):
        return False
    try:
        open_et = _market_open(today).astimezone(ET) + timedelta(minutes=5)
        close_et = _market_close(today).astimezone(ET) - timedelta(minutes=5)
    except (ValueError, Exception):
        return False
    return open_et <= now_et <= close_et


def _now_et() -> datetime:
    return datetime.now(ET)


# =====================================================================
# Alpaca helpers
# =====================================================================

async def _get_account(
    client: httpx.AsyncClient,
    *,
    username: str | None = None,
) -> dict[str, Any]:
    """Audit MB-P0-1: ``username`` routes account fetch through that
    user's :class:`BrokerConnection` row."""
    headers, base_url = await _alpaca_creds_for_user(username)
    resp = await client.get(f"{base_url}/v2/account", headers=headers)
    resp.raise_for_status()
    return resp.json()


async def _get_positions(
    client: httpx.AsyncClient,
    *,
    username: str | None = None,
) -> list[dict[str, Any]]:
    """Audit MB-P0-1: ``username`` routes positions fetch through that
    user's :class:`BrokerConnection` row."""
    headers, base_url = await _alpaca_creds_for_user(username)
    resp = await client.get(f"{base_url}/v2/positions", headers=headers)
    resp.raise_for_status()
    return resp.json()


async def _place_order(
    client: httpx.AsyncClient,
    symbol: str,
    qty: int,
    side: str,
    strategy: str = "unknown",
    *,
    username: str | None = None,
) -> dict[str, Any]:
    """Place a market order on Alpaca paper.

    Includes a client_order_id encoding the strategy name for traceability.

    Wave-A bypass-fix: enforces ``core.trading_gate.reject_if_live_forbidden``
    so denylisted strategies (orb / kama_breakout) cannot reach live capital
    via this pipeline path. Persona-66 flagged this as one of the most
    exploited bypasses (the daily pipeline POSTs hundreds of orders per
    session with no per-strategy gate).

    Audit MB-P0-1: when ``username`` is provided, route through that
    user's :class:`BrokerConnection` row so multi-user deployments do
    not bill every scheduled order to whichever account is in ``.env``.
    Omitting ``username`` falls back to env credentials with a deprecation
    warning (see ``_alpaca_creds_for_user``).
    """
    from datetime import datetime, timezone
    from core.trading_gate import reject_if_live_forbidden
    # Pipeline strategy names are already canonical underscore form (the
    # registry uses them as-is); pass an empty/None strategy as None so the
    # gate logs an INFO line instead of trying to canonicalise "unknown".
    _gate_strategy = strategy if strategy and strategy != "unknown" else None
    reject_if_live_forbidden(
        _gate_strategy,
        caller="daily_pipeline._place_order",
        http_context=False,
    )
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    client_order_id = f"{strategy}_{symbol}_{ts}"

    body = {
        "symbol": symbol,
        "qty": str(qty),
        "side": side,
        "type": "market",
        "time_in_force": "day",
        "client_order_id": client_order_id,
    }
    headers, base_url = await _alpaca_creds_for_user(username)
    resp = await client.post(
        f"{base_url}/v2/orders",
        headers=headers,
        json=body,
    )
    resp.raise_for_status()
    order = resp.json()
    order.setdefault("client_order_id", client_order_id)
    logger.info(
        "Order placed: %s %s %d shares  strategy=%s  order_id=%s  client_id=%s",
        side.upper(), symbol, qty, strategy, order.get("id"), client_order_id,
    )
    return order


async def _place_bracket_order(
    client: httpx.AsyncClient,
    symbol: str,
    qty: int,
    stop_price: float,
    take_profit_price: float | None,
    strategy: str = "unknown",
    *,
    username: str | None = None,
) -> dict[str, Any]:
    """Place a Alpaca bracket buy order — entry + stop-loss (and optional
    take-profit) submitted as a single atomic order_class.

    Eliminates the previous race where the entry market order would fill but
    the follow-up stop-order POST failed (network blip, Alpaca rate limit),
    leaving a naked position. With ``order_class=bracket`` Alpaca either
    accepts the whole structure or rejects it whole — no half-state.

    Time-in-force: GTC for the legs, DAY for the entry. (Matches Alpaca's
    documented bracket requirements.)

    See concurrency-audit-r4 P0 #4 / code-patterns-audit-r4 P0 #2.

    Wave-A bypass-fix: live-trading deny-gate now enforced here too — the
    bracket path was a sibling bypass of ``_place_order``.

    Audit MB-P0-1: ``username`` is threaded through to per-user
    :class:`BrokerConnection` credentials.
    """
    from datetime import datetime, timezone
    from core.trading_gate import reject_if_live_forbidden
    _gate_strategy = strategy if strategy and strategy != "unknown" else None
    reject_if_live_forbidden(
        _gate_strategy,
        caller="daily_pipeline._place_bracket_order",
        http_context=False,
    )
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    client_order_id = f"{strategy}_{symbol}_{ts}_b"

    body: dict[str, Any] = {
        "symbol": symbol,
        "qty": str(qty),
        "side": "buy",
        "type": "market",
        "time_in_force": "day",
        "order_class": "bracket",
        "stop_loss": {"stop_price": str(round(stop_price, 2))},
        "client_order_id": client_order_id,
    }
    if take_profit_price and take_profit_price > 0:
        body["take_profit"] = {"limit_price": str(round(take_profit_price, 2))}

    headers, base_url = await _alpaca_creds_for_user(username)
    resp = await client.post(
        f"{base_url}/v2/orders",
        headers=headers,
        json=body,
    )
    resp.raise_for_status()
    order = resp.json()
    order.setdefault("client_order_id", client_order_id)
    logger.info(
        "Bracket order placed: BUY %s %d  stop=$%.2f  tp=%s  strategy=%s  order_id=%s",
        symbol, qty, stop_price,
        f"${take_profit_price:.2f}" if take_profit_price else "none",
        strategy, order.get("id"),
    )
    return order


async def _place_stop_order(
    client: httpx.AsyncClient,
    symbol: str,
    qty: int,
    stop_price: float,
    side: str = "sell",
    strategy: str = "unknown",
    *,
    username: str | None = None,
) -> dict[str, Any]:
    """Place a protective stop order on Alpaca.

    Audit MB-P0-1: ``username`` is threaded through to per-user
    :class:`BrokerConnection` credentials.
    """
    from core.trading_gate import reject_if_live_forbidden
    _gate_strategy = strategy if strategy and strategy != "unknown" else None
    reject_if_live_forbidden(
        _gate_strategy,
        caller="daily_pipeline._place_stop_order",
        http_context=False,
    )
    body = {
        "symbol": symbol,
        "qty": str(qty),
        "side": side,
        "type": "stop",
        "stop_price": str(round(stop_price, 2)),
        "time_in_force": "gtc",  # Good-til-cancelled
    }
    headers, base_url = await _alpaca_creds_for_user(username)
    resp = await client.post(
        f"{base_url}/v2/orders",
        headers=headers,
        json=body,
    )
    resp.raise_for_status()
    order = resp.json()
    logger.info(
        "Stop-loss order placed: %s %s %d shares @ $%.2f  strategy=%s  order_id=%s",
        side.upper(), symbol, qty, stop_price, strategy, order.get("id"),
    )
    return order


async def _place_limit_order(
    client: httpx.AsyncClient,
    symbol: str,
    qty: int,
    limit_price: float,
    side: str = "sell",
    strategy: str = "unknown",
    *,
    username: str | None = None,
) -> dict[str, Any]:
    """Place a take-profit limit order on Alpaca.

    Audit MB-P0-1: ``username`` is threaded through to per-user
    :class:`BrokerConnection` credentials.
    """
    from core.trading_gate import reject_if_live_forbidden
    _gate_strategy = strategy if strategy and strategy != "unknown" else None
    reject_if_live_forbidden(
        _gate_strategy,
        caller="daily_pipeline._place_limit_order",
        http_context=False,
    )
    body = {
        "symbol": symbol,
        "qty": str(qty),
        "side": side,
        "type": "limit",
        "limit_price": str(round(limit_price, 2)),
        "time_in_force": "gtc",
    }
    headers, base_url = await _alpaca_creds_for_user(username)
    resp = await client.post(
        f"{base_url}/v2/orders",
        headers=headers,
        json=body,
    )
    resp.raise_for_status()
    order = resp.json()
    logger.info(
        "Take-profit order placed: %s %s %d shares @ $%.2f  strategy=%s  order_id=%s",
        side.upper(), symbol, qty, limit_price, strategy, order.get("id"),
    )
    return order


async def _ensure_stop_orders(
    client: httpx.AsyncClient,
    ledger: TradeLedger,
    *,
    username: str | None = None,
) -> list[dict[str, Any]]:
    """Ensure all open positions have active stop-loss orders on Alpaca.

    Audit MB-P0-1: ``username`` selects which Alpaca account is queried
    for already-open stop orders (so duplicates are detected against the
    *user's* account, not the env account) and which account the new
    stop is placed against.
    """
    placed: list[dict[str, Any]] = []
    open_positions = ledger.get_open_positions()

    # Get existing orders to avoid duplicates
    headers, base_url = await _alpaca_creds_for_user(username)
    resp = await client.get(f"{base_url}/v2/orders?status=open", headers=headers)
    existing_orders = resp.json() if resp.status_code == 200 else []
    symbols_with_stops = {
        (o.get("symbol"), o.get("side"))
        for o in existing_orders
        if o.get("type") == "stop"
    }

    for trade in open_positions:
        sym = trade["symbol"]
        is_short = str(trade.get("side") or "long").lower() in {"short", "sell", "s"}
        protective_side = "buy" if is_short else "sell"
        if (sym, protective_side) in symbols_with_stops:
            continue  # already has a stop

        stop_price = trade.get("signal", {}).get("stop_loss") or trade.get("stop_loss")
        if not stop_price:
            # Default stop: long = 5% below entry, short = 5% above entry.
            stop_price = trade.get("entry_price", 0) * (1.05 if is_short else 0.95)

        if stop_price and stop_price > 0:
            try:
                order = await _place_stop_order(
                    client, sym, trade["shares"], stop_price,
                    side=protective_side,
                    strategy=trade.get("strategy", "unknown"),
                    username=username,
                )
                placed.append({
                    "symbol": sym,
                    "side": protective_side,
                    "stop_price": stop_price,
                    "order_id": order.get("id"),
                })
            except Exception:
                logger.error("Failed to place stop for %s", sym, exc_info=True)

    return placed


async def _poll_fill_price(
    client: httpx.AsyncClient,
    order_id: str,
    max_attempts: int = 10,
    delay: float = 1.0,
    *,
    username: str | None = None,
) -> float | None:
    """Poll Alpaca for an order's filled_avg_price.

    Returns the fill price once the order reaches 'filled' status, or
    None if it doesn't fill within *max_attempts* polls.

    Audit MB-P0-1: ``username`` routes the poll through the order
    owner's :class:`BrokerConnection` row so the status query lands on
    the same account the order was placed against.
    """
    headers, base_url = await _alpaca_creds_for_user(username)
    for _ in range(max_attempts):
        try:
            resp = await client.get(
                f"{base_url}/v2/orders/{order_id}",
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                status = data.get("status", "")
                if status == "filled":
                    avg = data.get("filled_avg_price")
                    if avg is not None:
                        return float(avg)
                elif status in ("canceled", "expired", "rejected"):
                    return None
        except Exception:
            logger.debug("order-status poll failed; will retry", exc_info=True)
        await asyncio.sleep(delay)
    return None


# =====================================================================
# Bracket outbox (persona-65 F8 / P65)
# =====================================================================
# The bracket-fallback path in ``_execute_approved_orders`` places an entry
# and then (if the bracket class wasn't accepted) posts stop + TP as
# separate Alpaca calls. A SIGKILL between the entry fill and the stop
# POST leaves the position naked and invisible to the next pipeline run.
#
# We fix this with a tiny outbox: before submitting the entry we write a
# Redis hash ``outbox:pending:{uuid}`` with the full plan, then update its
# status field as each leg submits, and finally delete it when all three
# legs are either on the broker or explicitly abandoned. On boot,
# ``replay_pending_brackets()`` walks every remaining outbox row and
# reconciles it against Alpaca: if the entry filled and the stop is still
# missing, we place the stop now; if the entry never filled, we discard
# the row.

_OUTBOX_PREFIX = "outbox:pending:"
_OUTBOX_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days — plenty for recovery, bounds growth

# Wave 2G / persona-79 Race 7: ownership lock prefix. ``replay_pending_brackets``
# can race with the normal flow inside ``_execute_approved_orders`` if a boot
# happens while a pipeline run is mid-flight; both code paths can scan the same
# outbox row and submit duplicate stop orders. Before acting on a row we now
# attempt a SET-NX on this lock key; only the claimer proceeds, and the lock
# auto-expires after 60 s in case the holder crashes mid-action so the row can
# be reclaimed on the next replay tick.
_OUTBOX_LOCK_PREFIX = "lock:outbox:"
_OUTBOX_LOCK_TTL_SECONDS = 60


async def _outbox_create(
    outbox_id: str, plan: dict[str, Any],
) -> None:
    """Write the pre-submission bracket plan to Redis."""
    try:
        from core.redis import get_redis
        redis = await get_redis()
        if redis is None:
            return
        key = _OUTBOX_PREFIX + outbox_id
        plan_copy = {**plan, "status": "planned",
                     "created_at": datetime.now(timezone.utc).isoformat()}
        # Store as JSON in a single hash field for readability + atomic
        # replacement. (HSET stringly-typed everywhere avoids Redis type
        # coercion surprises.)
        await redis.hset(key, "plan", json.dumps(plan_copy))
        await redis.expire(key, _OUTBOX_TTL_SECONDS)
    except Exception:
        logger.warning(
            "Bracket outbox create failed (id=%s) — continuing without "
            "recovery guarantee", outbox_id, exc_info=True,
        )


async def _outbox_update(outbox_id: str, patch: dict[str, Any]) -> None:
    """Merge ``patch`` into the stored plan."""
    try:
        from core.redis import get_redis
        redis = await get_redis()
        if redis is None:
            return
        key = _OUTBOX_PREFIX + outbox_id
        raw = await redis.hget(key, "plan")
        if not raw:
            return
        plan = json.loads(raw)
        plan.update(patch)
        plan["updated_at"] = datetime.now(timezone.utc).isoformat()
        await redis.hset(key, "plan", json.dumps(plan))
    except Exception:
        logger.warning(
            "Bracket outbox update failed (id=%s)", outbox_id, exc_info=True,
        )


async def _outbox_delete(outbox_id: str) -> None:
    """Clear an outbox row once the multi-leg order is fully settled."""
    try:
        from core.redis import get_redis
        redis = await get_redis()
        if redis is None:
            return
        await redis.delete(_OUTBOX_PREFIX + outbox_id)
    except Exception:
        logger.warning("Bracket outbox delete failed (id=%s)", outbox_id, exc_info=True)


async def _outbox_try_claim(outbox_id: str) -> bool:
    """Wave 2G / persona-79 Race 7 — atomic ownership claim on an outbox row.

    Returns True iff this caller acquired the lock, False if another
    worker / boot-replay already owns it. Implemented as a single
    ``SET NX EX 60`` so the claim is atomic at the Redis layer; the TTL
    means a holder that crashes mid-action leaves the row reclaimable
    after a minute rather than orphaning it.

    Used inside ``replay_pending_brackets`` so the boot-replay path and
    the live ``_execute_approved_orders`` path can never both submit a
    duplicate stop for the same row.
    """
    try:
        from core.redis import get_redis
        redis = await get_redis()
        if redis is None:
            # No Redis = no cross-process synchronisation possible. We
            # still proceed (boot replay is a recovery path, dropping it
            # would be worse than the rare double-submit window) but log
            # so this is auditable.
            logger.warning(
                "outbox_try_claim(%s): Redis unavailable — proceeding "
                "without ownership lock", outbox_id,
            )
            return True
        key = _OUTBOX_LOCK_PREFIX + outbox_id
        # SET NX EX is the canonical atomic distributed-lock primitive.
        # redis-py async returns True / None depending on whether the
        # SET happened.
        ok = await redis.set(key, "1", nx=True, ex=_OUTBOX_LOCK_TTL_SECONDS)
        return bool(ok)
    except Exception:
        logger.warning(
            "outbox_try_claim(%s) failed — proceeding unlocked",
            outbox_id, exc_info=True,
        )
        return True


async def _outbox_release(outbox_id: str) -> None:
    """Release the ownership lock taken by :func:`_outbox_try_claim`.

    Best-effort: a stale lock auto-expires after ``_OUTBOX_LOCK_TTL_SECONDS``
    so a missed release just means the row sits locked for at most one
    minute. We don't bother with a Lua-script value-check here because
    the row is single-purpose and we hold it only briefly.
    """
    try:
        from core.redis import get_redis
        redis = await get_redis()
        if redis is None:
            return
        await redis.delete(_OUTBOX_LOCK_PREFIX + outbox_id)
    except Exception:
        logger.debug(
            "outbox_release(%s) failed — TTL will reclaim",
            outbox_id, exc_info=True,
        )


async def replay_pending_brackets() -> list[dict[str, Any]]:
    """Replay any outbox rows left over from a previous (crashed) run.

    Call on boot — walks every ``outbox:pending:*`` row and reconciles it
    against Alpaca's order / position state:

      * entry absent on broker -> discard the row (entry never reached
        Alpaca, nothing to protect).
      * entry filled and stop already open -> discard.
      * entry filled and stop missing -> submit the stop now.
      * entry still pending at broker -> leave the row for the next replay.

    Returns the list of actions taken so boot code / tests can assert on
    behaviour. Errors per-row do not abort the whole replay.
    """
    actions: list[dict[str, Any]] = []
    try:
        from core.redis import get_redis
        redis = await get_redis()
        if redis is None:
            return actions
        async for key in redis.scan_iter(match=_OUTBOX_PREFIX + "*"):
            outbox_id = key.split(":", 2)[-1]
            # Wave 2G / persona-79 Race 7: atomic ownership claim. If the
            # live ``_execute_approved_orders`` path is concurrently
            # processing this row, only the first claimer wins and the
            # other path skips. The lock auto-expires after 60 s so a
            # crashed claimer doesn't permanently strand the row.
            if not await _outbox_try_claim(outbox_id):
                actions.append({"id": outbox_id, "action": "skip_locked"})
                continue
            claimed = True
            try:
                raw = await redis.hget(key, "plan")
                if not raw:
                    await redis.delete(key)
                    continue
                plan = json.loads(raw)
                sym = plan.get("symbol")
                strategy = plan.get("strategy", "unknown")
                qty = int(plan.get("qty", 0))
                stop = plan.get("stop")
                entry_order_id = plan.get("entry_order_id")
                entry_side = str(plan.get("side") or "long").lower()
                stop_side = "buy" if entry_side in {"short", "sell", "s"} else "sell"
                if not sym or qty <= 0:
                    await redis.delete(key)
                    actions.append({"id": outbox_id, "action": "discard_invalid"})
                    continue

                # TODO(Audit MB-P0-1): the outbox plan does not currently
                # carry the owning ``username``, so the boot-replay path
                # falls through to env credentials. Multi-user deployments
                # need the outbox row to persist ``username`` at
                # ``_outbox_create`` time so the replay places the missing
                # stop on the same Alpaca account the entry filled on. Until
                # that is wired up, this path will keep using env creds and
                # log the deprecation warning emitted by
                # ``_alpaca_creds_for_user(None)``.
                username = plan.get("username")
                async with httpx.AsyncClient(timeout=10) as client:
                    # Check current Alpaca state for this symbol
                    try:
                        headers, base_url = await _alpaca_creds_for_user(username)
                        resp = await client.get(
                            f"{base_url}/v2/positions/{sym}",
                            headers=headers,
                        )
                        entry_filled = resp.status_code == 200
                    except Exception:
                        entry_filled = False

                    if not entry_filled and not entry_order_id:
                        # Never made it to broker — discard.
                        await redis.delete(key)
                        actions.append({"id": outbox_id, "action": "discard_no_entry", "symbol": sym})
                        continue

                    # Check if a stop is already on the books
                    has_stop = False
                    try:
                        headers, base_url = await _alpaca_creds_for_user(username)
                        r = await client.get(
                            f"{base_url}/v2/orders",
                            headers=headers,
                            params={"status": "open", "symbols": sym},
                        )
                        if r.status_code == 200:
                            for o in r.json():
                                if o.get("type") == "stop" and o.get("side") == stop_side:
                                    has_stop = True
                                    break
                    except Exception:
                        logger.warning(
                            "replay: could not list open orders for %s", sym,
                            exc_info=True,
                        )

                    if entry_filled and not has_stop and stop and stop > 0:
                        try:
                            await _place_stop_order(
                                client, sym, qty, float(stop),
                                side=stop_side,
                                strategy=strategy,
                                username=username,
                            )
                            await redis.delete(key)
                            actions.append({
                                "id": outbox_id, "action": "placed_stop",
                                "symbol": sym, "stop": stop,
                            })
                            logger.warning(
                                "Bracket replay: placed missing stop for %s @ $%.2f "
                                "(strategy=%s)", sym, float(stop), strategy,
                            )
                            continue
                        except Exception:
                            logger.error(
                                "Bracket replay: failed to place stop for %s",
                                sym, exc_info=True,
                            )
                            actions.append({
                                "id": outbox_id, "action": "stop_place_failed",
                                "symbol": sym,
                            })
                            continue

                    if entry_filled and has_stop:
                        await redis.delete(key)
                        actions.append({
                            "id": outbox_id, "action": "clean_entry_and_stop",
                            "symbol": sym,
                        })
            except Exception:
                logger.error(
                    "Bracket replay: row processing failed (key=%s)", key,
                    exc_info=True,
                )
            finally:
                # Wave 2G / persona-79 Race 7: always release the lock so
                # subsequent passes (or the live executor) can pick the row
                # back up if we left work undone. The TTL on the lock key is
                # the safety net — even a missed release reclaims after 60 s.
                if claimed:
                    await _outbox_release(outbox_id)
    except Exception:
        logger.error("Bracket replay walk failed", exc_info=True)
    return actions


async def _execute_approved_orders(
    client: httpx.AsyncClient,
    master: MasterAgent,
    ledger: TradeLedger,
    *,
    username: str | None = None,
) -> list[dict[str, Any]]:
    """Place buy orders for all approved pending orders from the master agent.

    Audit MB-P0-1: ``username`` is threaded through every per-order
    submission so multi-user deployments route each order to its owning
    Alpaca account.
    """
    orders_placed: list[dict[str, Any]] = []

    # Enforce daily trade limit. Track orders submitted in this batch too;
    # a run that starts at 29/30 must not submit two more orders.
    executed_today = ledger.count_today_trades()
    if executed_today >= MAX_DAILY_TRADES:
        logger.warning(
            "Daily trade limit reached (%d/%d), skipping remaining orders",
            executed_today, MAX_DAILY_TRADES,
        )
        return orders_placed

    try:
        open_positions_by_symbol = {
            str(p.get("symbol")): p
            for p in ledger.get_open_positions()
        }
    except Exception:
        logger.warning(
            "Could not load open positions before order execution",
            exc_info=True,
        )
        open_positions_by_symbol = {}

    for order in list(master.pending_orders):
        if executed_today >= MAX_DAILY_TRADES:
            logger.warning(
                "Daily trade limit reached during batch (%d/%d), skipping remaining orders",
                executed_today, MAX_DAILY_TRADES,
            )
            break
        requested_side = str(order.get("side", "buy")).lower()
        if requested_side not in {"buy", "sell", "short"}:
            continue
        sym = order["symbol"]
        shares = order.get("shares", 0)
        if shares < 1:
            continue
        strategy_name = order.get("strategy", "unknown")

        if requested_side == "sell":
            position = open_positions_by_symbol.get(sym)
            if not position:
                msg = (
                    "sell signal refused: no tracked open position for "
                    f"{sym}; use side='short' for new short exposure"
                )
                logger.warning(msg)
                orders_placed.append({
                    "symbol": sym,
                    "side": "sell",
                    "shares": shares,
                    "strategy": strategy_name,
                    "error": msg,
                })
                continue
            try:
                open_shares = int(float(position.get("shares") or position.get("quantity") or 0))
            except (TypeError, ValueError):
                open_shares = 0
            if open_shares < int(shares):
                msg = (
                    f"sell signal refused: requested {shares} shares of {sym} "
                    f"but only {open_shares} are tracked open"
                )
                logger.warning(msg)
                orders_placed.append({
                    "symbol": sym,
                    "side": "sell",
                    "shares": shares,
                    "strategy": strategy_name,
                    "error": msg,
                })
                continue
            try:
                position_side = str(position.get("side") or "long").lower()
                broker_side = "buy" if position_side in {"short", "sell", "s"} else "sell"
                result = await _place_order(
                    client, sym, shares, broker_side,
                    strategy=strategy_name,
                    username=username,
                )
                order_id = result.get("id")
                fill_price = (
                    await _poll_fill_price(client, order_id, username=username)
                    if order_id
                    else None
                )
                exit_price = (
                    fill_price
                    if fill_price is not None
                    else float(order.get("entry_price") or position.get("entry_price") or 0)
                )
                ledger.record_exit(
                    sym, shares, exit_price,
                    order.get("rationale", "strategy_exit"),
                    side=position_side,
                )
                orders_placed.append({
                    "symbol": sym,
                    "side": "sell",
                    "broker_side": broker_side,
                    "shares": shares,
                    "strategy": strategy_name,
                    "conviction": order.get("conviction"),
                    "order_id": order_id,
                    "status": result.get("status"),
                })
                executed_today += 1
            except Exception as e:
                logger.error("Exit order failed for %s", sym, exc_info=True)
                orders_placed.append({
                    "symbol": sym,
                    "side": "sell",
                    "shares": shares,
                    "strategy": strategy_name,
                    "error": str(e),
                })
            continue

        if requested_side == "short":
            order_entry_estimate = order.get("entry_price", 0)
            effective_stop = order.get("stop_loss")
            if not effective_stop or effective_stop <= 0:
                effective_stop = (
                    round(order_entry_estimate * 1.05, 2)
                    if order_entry_estimate > 0
                    else None
                )
            tp_estimate = order.get("take_profit")
            if (not tp_estimate or tp_estimate <= 0) and order_entry_estimate > 0:
                tp_estimate = round(order_entry_estimate * 0.90, 2)

            order_id: str | None = None
            fill_price: float | None = None
            outbox_id = uuid.uuid4().hex
            await _outbox_create(outbox_id, {
                "outbox_id": outbox_id,
                "strategy": strategy_name,
                "symbol": sym,
                "qty": shares,
                "side": "short",
                "entry": order_entry_estimate,
                "stop": effective_stop,
                "tp": tp_estimate,
            })

            try:
                result = await _place_order(
                    client, sym, shares, "sell",
                    strategy=strategy_name,
                    username=username,
                )
                order_id = result.get("id")
                await _outbox_update(outbox_id, {
                    "status": "entry_submitted_no_stop",
                    "entry_order_id": order_id,
                })

                ledger.record_entry(
                    symbol=sym,
                    shares=shares,
                    price=order_entry_estimate,
                    signal={
                        "stop_loss": effective_stop,
                        "take_profit": tp_estimate,
                        "conviction": order.get("conviction", 0),
                    },
                    rationale=order.get("rationale", ""),
                    strategy=strategy_name,
                    side="short",
                )

                if order_id:
                    fill_price = await _poll_fill_price(client, order_id, username=username)
                    if fill_price is not None:
                        ledger.update_entry_price(sym, fill_price)

                if effective_stop and effective_stop > 0:
                    try:
                        stop_oid = await _place_stop_order(
                            client, sym, shares, effective_stop,
                            side="buy", strategy=strategy_name,
                            username=username,
                        )
                        await _outbox_update(outbox_id, {
                            "status": "entry_and_stop_submitted",
                            "stop_order_id": stop_oid.get("id") if isinstance(stop_oid, dict) else None,
                        })
                    except Exception as stop_err:
                        logger.critical(
                            "CRITICAL: short stop order FAILED for %s after entry "
                            "filled — attempting emergency cover. Error: %s",
                            sym, stop_err, exc_info=True,
                        )
                        try:
                            cover = await _place_order(
                                client, sym, shares, "buy",
                                strategy=f"{strategy_name}_unwind",
                                username=username,
                            )
                            logger.critical(
                                "Emergency short cover submitted for %s order_id=%s",
                                sym, cover.get("id"),
                            )
                            ledger.record_exit(
                                sym, shares,
                                fill_price if fill_price is not None else order_entry_estimate,
                                "stop_loss_failed_unwind",
                                side="short",
                            )
                        except Exception as cover_err:
                            logger.critical(
                                "CRITICAL: emergency short cover ALSO failed for %s: %s. "
                                "POSITION IS NAKED — operator intervention required.",
                                sym, cover_err, exc_info=True,
                            )
                        raise RuntimeError(
                            f"Short stop placement failed for {sym}: {stop_err}"
                        ) from stop_err

                if tp_estimate and tp_estimate > 0:
                    try:
                        await _place_limit_order(
                            client, sym, shares, tp_estimate,
                            side="buy", strategy=strategy_name,
                            username=username,
                        )
                    except Exception as e:
                        logger.error(
                            "Short take-profit order failed for %s: %s",
                            sym, e, exc_info=True,
                        )

                orders_placed.append({
                    "symbol": sym,
                    "side": "short",
                    "broker_side": "sell",
                    "shares": shares,
                    "strategy": strategy_name,
                    "conviction": order.get("conviction"),
                    "order_id": order_id,
                    "status": result.get("status"),
                    "bracket": False,
                })
                executed_today += 1
                await _outbox_delete(outbox_id)
            except Exception as e:
                logger.error("Short order failed for %s", sym, exc_info=True)
                orders_placed.append({
                    "symbol": sym,
                    "side": "short",
                    "shares": shares,
                    "strategy": strategy_name,
                    "error": str(e),
                })
            continue

        try:
            # Compute effective stop_loss up front so we can submit a bracket
            # order atomically. If we don't have a stop, fall back to 5% below
            # the pre-trade entry estimate. concurrency-audit-r4 P0 #4 +
            # code-patterns-audit-r4 P0 #2 — the previous flow placed the
            # entry first, then the stop in a separate request: if the stop
            # POST failed, the position was naked.
            order_entry_estimate = order.get("entry_price", 0)
            effective_stop = order.get("stop_loss")
            if not effective_stop or effective_stop <= 0:
                effective_stop = (
                    round(order_entry_estimate * 0.95, 2)
                    if order_entry_estimate > 0
                    else None
                )
            tp_estimate = order.get("take_profit")

            order_id: str | None = None
            result: dict[str, Any]
            used_bracket = False
            fill_price: float | None = None  # populated by _poll_fill_price below

            # Persona-65: pre-register the multi-leg plan in the outbox BEFORE
            # we touch Alpaca. A SIGKILL between this write and the legs
            # lands the row in Redis for ``replay_pending_brackets()`` to
            # reconcile on boot.
            outbox_id = uuid.uuid4().hex
            await _outbox_create(outbox_id, {
                "outbox_id": outbox_id,
                "strategy": strategy_name,
                "symbol": sym,
                "qty": shares,
                "entry": order_entry_estimate,
                "stop": effective_stop,
                "tp": tp_estimate,
            })

            if effective_stop and effective_stop > 0:
                # Atomic bracket: entry + stop (+ optional TP). Alpaca either
                # accepts the whole envelope or rejects it whole — no half-state
                # naked position. If bracket placement raises, the entry never
                # filled, so there is nothing to roll back on the broker side.
                try:
                    result = await _place_bracket_order(
                        client, sym, shares,
                        effective_stop,
                        tp_estimate if tp_estimate and tp_estimate > 0 else None,
                        strategy=strategy_name,
                        username=username,
                    )
                    order_id = result.get("id")
                    used_bracket = True
                    # Bracket is atomic at the broker — entry + stop + TP all
                    # booked together, so the outbox row can be retired as
                    # soon as the POST returns 2xx.
                    await _outbox_update(outbox_id, {
                        "status": "bracket_submitted",
                        "entry_order_id": order_id,
                    })
                except Exception as bracket_err:
                    # Bracket failed (e.g. account doesn't support it, bad
                    # params). Fall back to plain market order, but the
                    # follow-on stop-loss failure must now be treated as a
                    # CRITICAL — see code-patterns-audit-r4 P0 #2.
                    logger.warning(
                        "Bracket order failed for %s (%s); falling back to "
                        "market+stop with strict failure handling",
                        sym, bracket_err,
                    )
                    result = await _place_order(
                        client, sym, shares, "buy",
                        strategy=strategy_name,
                        username=username,
                    )
                    order_id = result.get("id")
                    # Entry submitted, stop NOT yet on the broker — outbox
                    # must reflect the vulnerable half-state so a SIGKILL
                    # between here and the stop POST is recoverable.
                    await _outbox_update(outbox_id, {
                        "status": "entry_submitted_no_stop",
                        "entry_order_id": order_id,
                    })
            else:
                # No stop available — place plain market order. We still
                # record the trade but log a CRITICAL because the position is
                # unprotected.
                logger.critical(
                    "Placing %s without a stop-loss (no effective_stop computed). "
                    "Position will be naked — review strategy signal.",
                    sym,
                )
                result = await _place_order(
                    client, sym, shares, "buy",
                    strategy=strategy_name,
                    username=username,
                )
                order_id = result.get("id")
                await _outbox_update(outbox_id, {
                    "status": "entry_submitted_no_stop_planned",
                    "entry_order_id": order_id,
                })

            # Record the entry with the pre-trade estimate first
            ledger.record_entry(
                symbol=sym,
                shares=shares,
                price=order_entry_estimate,
                signal={
                    "stop_loss": effective_stop,
                    "take_profit": tp_estimate,
                    "conviction": order.get("conviction", 0),
                },
                rationale=order.get("rationale", ""),
                strategy=strategy_name,
            )

            # Poll for actual fill price and recalculate stop/take-profit
            if order_id:
                fill_price = await _poll_fill_price(client, order_id, username=username)
                if fill_price is not None:
                    ledger.update_entry_price(sym, fill_price)
                    logger.info(
                        "Updated %s ledger entry_price to fill price $%.2f",
                        sym, fill_price,
                    )
                    # Recalculate stop/take-profit relative to actual fill
                    old_entry = order_entry_estimate
                    old_stop = order.get("stop_loss", 0)
                    old_tp = order.get("take_profit", 0)
                    if old_entry and old_entry > 0:
                        stop_pct = (old_entry - old_stop) / old_entry if old_stop else 0.05
                        tp_pct = (old_tp - old_entry) / old_entry if old_tp else 0.10
                    else:
                        stop_pct = 0.05
                        tp_pct = 0.10
                    order["stop_loss"] = round(fill_price * (1 - stop_pct), 2)
                    order["take_profit"] = round(fill_price * (1 + tp_pct), 2)
                    logger.info(
                        "Recalculated %s levels from fill $%.2f: "
                        "stop=$%.2f, target=$%.2f",
                        sym, fill_price,
                        order["stop_loss"], order["take_profit"],
                    )
                else:
                    logger.warning(
                        "Could not get fill price for %s order %s; "
                        "ledger retains pre-trade estimate",
                        sym, order_id,
                    )

            # If the bracket already established stop+TP atomically with the
            # entry, we're done — skip the follow-up posts. Otherwise (bracket
            # fallback path or no-stop path) we must post the stop and TP
            # separately and handle their failure as critical.
            if not used_bracket:
                # Place stop-loss order on Alpaca — failure is now CRITICAL
                # and we attempt to unwind the entry. code-patterns-audit-r4
                # P0 #2: do not silently log and continue with a naked
                # position.
                if effective_stop and effective_stop > 0:
                    try:
                        stop_oid = await _place_stop_order(
                            client, sym, shares, effective_stop,
                            strategy=strategy_name,
                            username=username,
                        )
                        logger.info(
                            "Stop-loss order placed for %s: %s",
                            sym,
                            stop_oid.get("id") if isinstance(stop_oid, dict) else stop_oid,
                        )
                        # Stop is now live at the broker — outbox no longer
                        # needs to protect the vulnerable gap.
                        await _outbox_update(outbox_id, {
                            "status": "entry_and_stop_submitted",
                            "stop_order_id": stop_oid.get("id") if isinstance(stop_oid, dict) else None,
                        })
                    except Exception as stop_err:
                        logger.critical(
                            "CRITICAL: stop-loss order FAILED for %s after entry "
                            "filled — attempting emergency unwind. Error: %s",
                            sym, stop_err, exc_info=True,
                        )
                        # Best-effort emergency close so the position is not
                        # left naked. This may itself fail (broker outage),
                        # in which case the operator MUST be alerted.
                        try:
                            unwind = await _place_order(
                                client, sym, shares, "sell",
                                strategy=f"{strategy_name}_unwind",
                                username=username,
                            )
                            logger.critical(
                                "Emergency unwind submitted for %s order_id=%s",
                                sym, unwind.get("id"),
                            )
                            ledger.record_exit(
                                sym, shares,
                                fill_price if fill_price is not None else order_entry_estimate,
                                "stop_loss_failed_unwind",
                            )
                        except Exception as unwind_err:
                            logger.critical(
                                "CRITICAL: emergency unwind ALSO failed for %s: %s. "
                                "POSITION IS NAKED — operator intervention required.",
                                sym, unwind_err, exc_info=True,
                            )
                        # Re-raise so the outer except records the failure
                        # in orders_placed and rolls back master state.
                        raise RuntimeError(
                            f"Stop-loss placement failed for {sym}: {stop_err}"
                        ) from stop_err

                # Place take-profit limit order on Alpaca immediately
                if order.get("take_profit"):
                    try:
                        tp_oid = await _place_limit_order(
                            client, sym, shares, order["take_profit"],
                            strategy=strategy_name,
                            username=username,
                        )
                        logger.info(
                            "Take-profit order placed for %s: %s",
                            sym,
                            tp_oid.get("id") if isinstance(tp_oid, dict) else tp_oid,
                        )
                    except Exception as e:
                        # TP failure is non-critical (we still have a stop) —
                        # log loudly but do not unwind.
                        logger.error(
                            "Take-profit order failed for %s: %s",
                            sym, e, exc_info=True,
                        )

            orders_placed.append({
                "symbol": sym,
                "side": "buy",
                "shares": shares,
                "strategy": order.get("strategy"),
                "conviction": order.get("conviction"),
                "order_id": order_id,
                "status": result.get("status"),
                "bracket": used_bracket,
            })
            executed_today += 1
            # All legs are either at the broker or explicitly abandoned —
            # the outbox row has served its purpose. Deleting it here keeps
            # the Redis set bounded and makes the next ``replay_pending_brackets``
            # pass a no-op for this order.
            await _outbox_delete(outbox_id)
        except Exception as e:
            logger.error("Order failed for %s", sym, exc_info=True)

            # --- Ghost position rollback ---
            # The MasterAgent already added this symbol to existing_positions
            # and decremented cash during request_trade(). Roll back both so
            # the symbol is not permanently blocked and cash is accurate.
            notional = order.get("notional", 0)
            if sym in master.existing_positions:
                del master.existing_positions[sym]
                logger.warning(
                    "Rollback: removed %s from master.existing_positions", sym,
                )
            if notional:
                master.cash += notional
                logger.warning(
                    "Rollback: restored $%.0f to master.cash (now $%.0f)",
                    notional, master.cash,
                )
            # Remove from pending_orders so it isn't retried
            master.pending_orders = [
                o for o in master.pending_orders if o.get("symbol") != sym
            ]

            # Leave the outbox row for replay to inspect — if the entry
            # actually reached Alpaca and filled despite the exception,
            # the replay will add the missing stop.
            orders_placed.append({
                "symbol": sym,
                "side": "buy",
                "shares": shares,
                "strategy": order.get("strategy"),
                "error": str(e),
            })
    return orders_placed


async def _check_exits(
    client: httpx.AsyncClient,
    ledger: TradeLedger,
    *,
    username: str | None = None,
) -> list[dict[str, Any]]:
    """Check open positions against stop loss / take profit.

    Audit MB-P0-1: ``username`` routes broker queries / cancels /
    replacements through the position owner's :class:`BrokerConnection`
    row instead of the env credentials.
    """
    closed_orders: list[dict[str, Any]] = []
    open_trades = ledger.get_open_positions()

    if not open_trades:
        return closed_orders

    try:
        positions = await _get_positions(client, username=username)
    except Exception:
        logger.error("Failed to fetch positions", exc_info=True)
        return closed_orders

    pos_map = {p["symbol"]: p for p in positions}

    for trade in open_trades:
        sym = trade["symbol"]
        pos = pos_map.get(sym)
        if not pos:
            continue

        current_price = float(pos.get("current_price", 0))
        stop = trade.get("stop_loss")
        target = trade.get("take_profit")
        entry_price = trade.get("entry_price", 0)
        is_short = str(trade.get("side") or "long").lower() in {"short", "sell", "s"}
        exit_side = "buy" if is_short else "sell"

        reason = None
        if is_short:
            if stop and current_price >= stop:
                reason = "stop_loss"
            elif target and current_price <= target:
                reason = "take_profit"
        else:
            if stop and current_price <= stop:
                reason = "stop_loss"
            elif target and current_price >= target:
                reason = "take_profit"

        # Time-based exit: Close positions held > 20 trading days (~28 calendar days)
        if not reason:
            entry_time_raw = trade.get("entry_time")
            entry_date: datetime | None = None
            if isinstance(entry_time_raw, datetime):
                entry_date = entry_time_raw if entry_time_raw.tzinfo else entry_time_raw.replace(tzinfo=timezone.utc)
            elif isinstance(entry_time_raw, str) and entry_time_raw:
                try:
                    entry_date = datetime.fromisoformat(entry_time_raw.replace("Z", "+00:00"))
                    if entry_date.tzinfo is None:
                        entry_date = entry_date.replace(tzinfo=timezone.utc)
                except ValueError:
                    entry_date = None
            if entry_date is not None:
                days_held = (datetime.now(timezone.utc) - entry_date).days
                if days_held > 28:
                    reason = f"time_exit: held {days_held} days (max 20 trading days)"

        # Trailing stop: if position is up > 5%, move stop to breakeven + buffer.
        if (
            not reason
            and entry_price > 0
            and (
                (not is_short and current_price > entry_price * 1.05)
                or (is_short and current_price < entry_price * 0.95)
            )
        ):
            new_stop = entry_price * (0.99 if is_short else 1.01)
            old_stop = trade.get("signal", {}).get("stop_loss") or trade.get("stop_loss", 0) or 0
            should_move_stop = new_stop < old_stop if is_short else new_stop > old_stop
            if should_move_stop:
                # Persist the updated stop level via the ledger update API.
                # Previously this called the long-removed ``ledger._persist()``
                # method (left over from the JSON-file ledger) which raised
                # AttributeError silently — the in-memory mutation evaporated
                # on the next loop and trailing stops never trailed.
                # concurrency-audit-r4 P0 #4.
                trade_id = trade.get("id")
                rounded_new_stop = round(new_stop, 2)
                if trade_id is not None:
                    try:
                        ledger.update(int(trade_id), {"stop_loss": rounded_new_stop})
                        logger.info(
                            "Trailing stop updated for %s (id=%s): $%.2f -> $%.2f (persisted to DB)",
                            sym, trade_id, old_stop, new_stop,
                        )
                    except Exception as exc:
                        logger.error(
                            "Failed to persist trailing stop for %s (id=%s): %s",
                            sym, trade_id, exc, exc_info=True,
                        )
                else:
                    logger.warning(
                        "Trailing stop for %s skipped: trade row has no id",
                        sym,
                    )
                # Cancel old stop order and place new one at higher level
                try:
                    # Cancel existing stop orders for this symbol
                    headers, base_url = await _alpaca_creds_for_user(username)
                    resp = await client.get(
                        f"{base_url}/v2/orders?status=open&symbols={sym}",
                        headers=headers,
                    )
                    if resp.status_code == 200:
                        for existing_order in resp.json():
                            if existing_order.get("type") == "stop" and existing_order.get("side") == exit_side:
                                await client.delete(
                                    f"{base_url}/v2/orders/{existing_order['id']}",
                                    headers=headers,
                                )
                    await _place_stop_order(
                        client, sym, trade["shares"], rounded_new_stop,
                        side=exit_side,
                        strategy=trade.get("strategy", "unknown"),
                        username=username,
                    )
                    logger.info(
                        "Trailing stop updated for %s: raised from $%.2f to $%.2f",
                        sym, old_stop, new_stop,
                    )
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 403:
                        logger.debug("Trailing stop for %s skipped (403 — check Alpaca account/permissions)", sym)
                    else:
                        logger.warning("Failed to update trailing stop for %s", sym, exc_info=True)
                except Exception:
                    logger.warning("Failed to update trailing stop for %s", sym, exc_info=True)

        if reason:
            try:
                order = await _place_order(
                    client, sym, trade["shares"], exit_side,
                    strategy=trade.get("strategy", "unknown"),
                    username=username,
                )
                order_id = order.get("id")
                if order_id:
                    fill_price = await _poll_fill_price(client, order_id, username=username)
                    if fill_price is not None:
                        ledger.record_exit(
                            sym, trade["shares"], fill_price, reason,
                            side="short" if is_short else "long",
                        )
                    else:
                        logger.warning("Sell order for %s may not have filled (order %s) — recording exit at snapshot price", sym, order_id)
                        ledger.record_exit(
                            sym, trade["shares"], current_price, reason,
                            side="short" if is_short else "long",
                        )
                else:
                    ledger.record_exit(
                        sym, trade["shares"], current_price, reason,
                        side="short" if is_short else "long",
                    )

                # --- Bracket order cleanup ---
                # When one leg fills (stop-loss or take-profit), cancel
                # the opposing open bracket leg to avoid orphaned orders.
                try:
                    headers, base_url = await _alpaca_creds_for_user(username)
                    resp = await client.get(
                        f"{base_url}/v2/orders?status=open&symbols={sym}",
                        headers=headers,
                    )
                    if resp.status_code == 200:
                        for open_order in resp.json():
                            otype = open_order.get("type", "")
                            oside = open_order.get("side", "")
                            oid = open_order.get("id")
                            if oside == exit_side and otype in ("stop", "limit") and oid:
                                await client.delete(
                                    f"{base_url}/v2/orders/{oid}",
                                    headers=headers,
                                )
                                logger.info(
                                    "Cancelled orphaned %s order for %s (id=%s) after %s exit",
                                    otype, sym, oid, reason,
                                )
                except Exception:
                    logger.warning(
                        "Failed to cancel bracket orders for %s",
                        sym, exc_info=True,
                    )

                closed_orders.append({
                    "symbol": sym,
                    "side": "short" if is_short else "sell",
                    "broker_side": exit_side,
                    "shares": trade["shares"],
                    "price": current_price,
                    "reason": reason,
                    "strategy": trade.get("strategy", "unknown"),
                    "order_id": order.get("id"),
                })
            except Exception as e:
                logger.error("Exit order failed for %s", sym, exc_info=True)
                closed_orders.append({
                    "symbol": sym,
                    "side": "short" if is_short else "sell",
                    "broker_side": exit_side,
                    "error": str(e),
                })

    return closed_orders


# =====================================================================
# Log
# =====================================================================

def _save_log(log: dict[str, Any]) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    date_str = log.get("date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    path = LOG_DIR / f"{date_str}.json"
    path.write_text(json.dumps(log, indent=2, default=str), encoding="utf-8")
    logger.info("Pipeline log saved to %s", path)
    return path


# =====================================================================
# Main pipeline entry point
# =====================================================================

async def run_daily_pipeline(
    screen_limit: int = SCREEN_TOP_N,
    analyze_limit: int = ANALYZE_TOP_N,
    only_strategies: list[str] | None = None,
    *,
    username: str | None = None,
) -> dict[str, Any]:
    """Execute the full multi-strategy daily trading pipeline.

    Args:
        only_strategies: If provided, only run these strategy names.
            Used by the multi-window scheduler to run subsets at optimal times.
        username: Audit MB-P0-1 — owning user whose
            :class:`BrokerConnection` row should receive every order this
            run places. Falls back to env credentials when omitted (legacy
            single-admin deployments and the existing scheduler /
            continuous_monitor callers).
    """
    global _pipeline_status, CANCEL_REQUESTED, CURRENT_STARTED_AT, CURRENT_RUN_ID

    if _pipeline_lock.locked():
        return {"error": "Pipeline already running"}

    async with _pipeline_lock:
        # Initialise live-run state under the lock so /status sees the
        # fields populated *before* the first heavy call. A run_id is
        # always generated here when one was not pre-allocated (e.g. by
        # ``start_daily_pipeline_async``).
        if CURRENT_RUN_ID is None:
            CURRENT_RUN_ID = uuid.uuid4().hex
        if CURRENT_STARTED_AT is None:
            CURRENT_STARTED_AT = datetime.now(timezone.utc)
        # Always reset cancel flag at the start of a fresh run so a stale
        # request from a previous (already-honoured) cancel doesn't
        # immediately abort this one.
        CANCEL_REQUESTED = False
        try:
            return await _run_pipeline_inner(
                screen_limit=screen_limit,
                analyze_limit=analyze_limit,
                only_strategies=only_strategies,
                username=username,
            )
        finally:
            # Clear live-run state when the lock is released — operators
            # should see an idle pipeline reflect that immediately.
            _reset_live_state()
            CANCEL_REQUESTED = False


async def start_daily_pipeline_async(
    screen_limit: int = SCREEN_TOP_N,
    analyze_limit: int = ANALYZE_TOP_N,
    only_strategies: list[str] | None = None,
    *,
    username: str | None = None,
) -> str:
    """Fire-and-forget pipeline launcher used by ``POST /pipeline/run``.

    Returns the new ``run_id`` immediately while the pipeline executes in
    the background via ``asyncio.create_task``. Errors raised by the
    background coroutine are captured into ``_pipeline_status['last_result']``
    so /status can surface "error: <message>" without the operator having
    to grep server logs.

    Caller MUST check ``_pipeline_lock.locked()`` first and reject with
    409 if a run is already in flight — this function does not sanity-check
    the lock and will silently spawn a second task that immediately blocks
    on ``async with _pipeline_lock``.

    Single-worker assumption: AlphaDesk runs a single gunicorn worker, so
    the lock + globals are process-wide unique. If we ever scale to multi-
    worker, this whole module needs to move to Redis-backed state.

    Audit MB-P0-1: ``username`` is forwarded to ``run_daily_pipeline`` so
    multi-user deployments route every order to the requesting user's
    Alpaca account.
    """
    global CURRENT_RUN_ID, CURRENT_STARTED_AT

    # Pre-allocate the run_id so the HTTP caller can return it immediately
    # — the inner function will re-use this value rather than generating
    # its own. Same for started_at.
    run_id = uuid.uuid4().hex
    CURRENT_RUN_ID = run_id
    CURRENT_STARTED_AT = datetime.now(timezone.utc)

    # Wave 3K Fix 6 (persona-87 P2): structured pipeline-start event.
    # Previously the background launcher returned silently; the only
    # record of a new pipeline run was scattered across whatever the
    # inner function logged. A single ``event=pipeline_started`` at
    # launch makes the run trivially correlatable with the completion
    # record emitted below (same ``run_id``).
    logger.info(
        "pipeline_started",
        extra={
            "event": "pipeline_started",
            "run_id": run_id,
            "screen_limit": screen_limit,
            "analyze_limit": analyze_limit,
            "only_strategies": list(only_strategies) if only_strategies else None,
            "username": username,
        },
    )

    async def _wrapper() -> None:
        _outcome = "success"
        _error_repr: str | None = None
        try:
            result = await run_daily_pipeline(
                screen_limit=screen_limit,
                analyze_limit=analyze_limit,
                only_strategies=only_strategies,
                username=username,
            )
            if isinstance(result, dict):
                if result.get("skipped"):
                    _outcome = f"skipped:{result.get('reason', 'unknown')}"
                elif result.get("halted_by_admin"):
                    _outcome = "halted_by_admin"
                elif result.get("errors"):
                    _outcome = "completed_with_errors"
                else:
                    _outcome = str(_pipeline_status.get("last_result") or "success")
        except _PipelineCancelled:
            # Already logged + last_result set inside the inner function.
            _outcome = "cancelled"
        except Exception as exc:
            logger.exception("Background pipeline run failed: %s", exc)
            _pipeline_status["last_result"] = f"error: {exc}"
            _outcome = "error"
            _error_repr = repr(exc)
        finally:
            # Wave 3K Fix 6 (persona-87 P2): mirror the start event on
            # completion so downstream dashboards can compute run
            # duration / success-rate directly from the log stream.
            logger.info(
                "pipeline_completed",
                extra={
                    "event": "pipeline_completed",
                    "run_id": run_id,
                    "outcome": _outcome,
                    "error": _error_repr,
                },
            )

    asyncio.create_task(_wrapper())
    return run_id


async def _run_pipeline_inner(
    screen_limit: int = SCREEN_TOP_N,
    analyze_limit: int = ANALYZE_TOP_N,
    only_strategies: list[str] | None = None,
    *,
    username: str | None = None,
) -> dict[str, Any]:
    """Inner pipeline logic, called under _pipeline_lock.

    Audit MB-P0-1: ``username`` is forwarded to every per-broker call so
    each automated order is routed to the requesting user's Alpaca
    account in multi-user deployments.
    """
    global _pipeline_status, CURRENT_STAGE, CURRENT_STRATEGY, CURRENT_PROGRESS

    _pipeline_status["last_run"] = datetime.now(timezone.utc).isoformat()
    _pipeline_status["last_result"] = "running"
    CURRENT_STAGE = "init"
    CURRENT_STRATEGY = None
    CURRENT_PROGRESS = None
    _check_cancel("init")

    # Halt checkpoint at run entry (persona-16 P0-1): if the admin flag is
    # set when the scheduler fires, fail fast before the pipeline does any
    # expensive work. The same check is re-run at every strategy boundary
    # and before execution, so a halt flipped mid-run is still honoured.
    if await _is_trading_halted():
        logger.warning("Pipeline aborted at entry — trading halted by admin")
        _pipeline_status["last_result"] = "halted_by_admin"
        return {
            "halted_by_admin": True,
            "message": "Pipeline did not run — trading halted by admin.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    errors: list[str] = []
    log: dict[str, Any] = {
        "date": _now_et().strftime("%Y-%m-%d"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "strategies": {},
        "master_agent": {},
        "orders_placed": [],
        "orders_closed": [],
        "portfolio_snapshot": {},
        "errors": errors,
    }

    try:
        # Safety: paper-only check
        _base_url()

        # Safety: trading window check. Previously this only appended an
        # error and continued — the pipeline would still call the screener,
        # run agents, and submit orders against a closed book (Alpaca
        # rejects MOC after the bell, but market orders queued pre-open
        # can still fill at unfavourable auction prints). A "Run Now"
        # click outside the session must be a no-op, not a silent queue.
        if not _is_within_trading_window():
            now = _now_et()
            logger.warning(
                "Pipeline aborted — outside trading window (%s ET)",
                now.strftime("%H:%M"),
            )
            _pipeline_status["last_result"] = "skipped_market_closed"
            return {
                "skipped": True,
                "reason": "market_closed",
                "message": (
                    f"Market closed at {now.strftime('%H:%M')} ET; "
                    "pipeline did not run. Orders are not queued."
                ),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        if only_strategies:
            requested = set(only_strategies)
            runnable_names = {cls.name for cls in ALL_STRATEGIES}
            if requested.isdisjoint(runnable_names):
                missing = sorted(requested)
                logger.warning(
                    "Pipeline skipped - requested strategies have no runnable "
                    "autonomous backend today: %s",
                    ", ".join(missing),
                )
                _pipeline_status["last_result"] = "skipped_no_runnable_strategies"
                return {
                    "skipped": True,
                    "no_retry": True,
                    "reason": "no_runnable_strategies",
                    "message": (
                        "Requested strategies are research-only, planned, or "
                        "unknown, so there is no autonomous strategy to run."
                    ),
                    "requested_strategies": sorted(requested),
                    "runnable_strategies": sorted(runnable_names),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }

        # Persona-65 P65: reconcile any bracket outbox rows left over from
        # a previous crashed run BEFORE we start a new one. Any row whose
        # entry filled but stop was never placed gets the missing stop
        # submitted now. Errors here are logged but do not abort the run.
        try:
            replay_actions = await replay_pending_brackets()
            if replay_actions:
                logger.warning(
                    "Bracket outbox replay took %d action(s)", len(replay_actions),
                )
                log["bracket_replay"] = replay_actions
        except Exception:
            logger.error("Bracket outbox replay failed", exc_info=True)

        ledger = TradeLedger()

        async with httpx.AsyncClient(timeout=30) as client:
            # ---- Account state ----
            CURRENT_STAGE = "account"
            _check_cancel("account")
            try:
                account = await _get_account(client, username=username)
                equity = float(account.get("equity", 100_000))
                cash = float(account.get("cash", 0))
                day_pnl = float(account.get("equity", 0)) - float(
                    account.get("last_equity", account.get("equity", 0))
                )
            except Exception as e:
                logger.error("Cannot reach Alpaca account; aborting pipeline", exc_info=True)
                errors.append(f"Alpaca account unavailable: {type(e).__name__}")
                log["aborted"] = True
                log["reason"] = "account_unavailable"
                log["portfolio_snapshot"] = {
                    "account_available": False,
                    "account_error": type(e).__name__,
                }
                _pipeline_status["last_result"] = "account_unavailable"
                return log

            # ---- Circuit breaker ----
            if equity > 0 and (day_pnl / equity) < CIRCUIT_BREAKER_PCT:
                msg = (
                    f"CIRCUIT BREAKER: daily P&L {day_pnl:.2f} "
                    f"({day_pnl/equity*100:.1f}%) exceeds -{abs(CIRCUIT_BREAKER_PCT)*100}% limit"
                )
                logger.critical(msg)
                errors.append(msg)
                log["portfolio_snapshot"] = {"equity": equity, "cash": cash, "day_pnl": day_pnl}

                # Audit P0-5 (2026-05-05): replaced ad-hoc Discord-only
                # post with the generic ``services.alerts.fire_alert``
                # dispatcher so PagerDuty pages oncall in addition to
                # the Discord ping. Fail-open: dispatcher swallows its
                # own errors so the pipeline still records the breaker
                # trip even if every destination is misconfigured.
                try:
                    from services.alerts import (
                        Alert,
                        AlertSeverity,
                        fire_alert,
                    )
                    from datetime import datetime, timezone

                    await fire_alert(Alert(
                        severity=AlertSeverity.P0,
                        title="Circuit breaker tripped — daily PnL exceeded -2%",
                        description=(
                            f"Pipeline halted. day_pnl={day_pnl:.2f} "
                            f"({day_pnl/equity*100:.2f}%) exceeds threshold "
                            f"{abs(CIRCUIT_BREAKER_PCT)*100:.1f}%. See "
                            "docs/RUNBOOK-alerts.md#circuit-breaker"
                        ),
                        source="daily_pipeline.circuit_breaker",
                        deduplication_key="daily_pipeline.circuit_breaker",
                        occurred_at=datetime.now(timezone.utc),
                        metadata={
                            "equity": float(equity),
                            "day_pnl": float(day_pnl),
                            "day_pnl_pct": float(day_pnl / equity),
                            "threshold_pct": float(CIRCUIT_BREAKER_PCT),
                        },
                    ))
                except Exception:
                    logger.critical(
                        "Circuit breaker notify dispatcher raised",
                        exc_info=True,
                    )

                _save_log(log)
                _pipeline_status["last_result"] = "circuit_breaker"
                return log

            # ---- Fetch VIX level for regime detection (P3) ----
            # code-patterns-audit-r4 P0 #1: do NOT silently fall through to
            # 16.5 (bull_low_vol). If both VIX fetches fail and there's no
            # cached prior value, abort the pipeline rather than trade with
            # the wrong regime.
            vix_level = await _get_vix_level(client)
            if vix_level is None:
                msg = (
                    "Pipeline aborted: VIX unavailable (regime detection "
                    "would default to bull_low_vol and oversize positions)."
                )
                logger.critical(msg)
                errors.append(msg)
                _save_log(log)
                _pipeline_status["last_result"] = "vix_unavailable"
                return log

            # ---- Ensure all existing positions have stop-loss orders ----
            try:
                stops_placed = await _ensure_stop_orders(client, ledger, username=username)
                if stops_placed:
                    logger.info("Placed %d missing stop-loss orders", len(stops_placed))
                    log["stops_ensured"] = stops_placed
            except Exception as e:
                logger.error("Failed to ensure stop orders", exc_info=True)
                errors.append(f"Stop order check failed: {e}")

            # ---- Create Master Agent ----
            existing_positions = ledger.get_position_strategy_map()
            master = MasterAgent(
                equity=equity,
                cash=cash,
                existing_positions=existing_positions,
                vix_level=vix_level,
            )
            logger.info(
                "Master Agent: regime=%s, VIX=%.1f, max_deployment=%.0f%%",
                master.regime, master.vix_level, master.max_deployment * 100,
            )

            # ---- Factor crowding detection ----
            crowding = master.detect_factor_crowding()
            log["factor_crowding"] = crowding
            if crowding["crowded"]:
                for w in crowding["warnings"]:
                    logger.warning("CROWDING: [%s] %s", w["factor"], w["message"])

            # ---- Populate momentum data for the momentum filter ----
            try:
                from data.ingestion.strategy_runner import get_screener_results
                screened = await get_screener_results(limit=100)
                momentum_data: dict[str, float] = {}
                for stock in screened:
                    momentum_data[stock["symbol"]] = stock.get("change_pct", 0)

                # Fetch actual 6-month returns for top candidates
                for stock in screened[:20]:
                    sym = stock["symbol"]
                    try:
                        resp = await client.get(
                            f"{settings.ALPACA_DATA_BASE_URL}/v2/stocks/{sym}/bars",
                            headers=_alpaca_headers(),
                            params={
                                "timeframe": "1Day",
                                "limit": 1,
                                "start": (datetime.now(timezone.utc) - timedelta(days=180)).strftime("%Y-%m-%d"),
                                "feed": "sip",
                            },
                        )
                        if resp.status_code == 200:
                            bars = resp.json().get("bars", [])
                            if bars:
                                price_6m_ago = bars[0]["c"]
                                current_price = stock.get("price", 0)
                                if current_price and current_price > 0 and price_6m_ago and price_6m_ago > 0:
                                    momentum_data[sym] = ((current_price / price_6m_ago) - 1) * 100
                    except Exception:
                        logger.debug("6-month momentum fetch failed for %s", sym, exc_info=True)

                MasterAgent.set_momentum_data(momentum_data)
                # Also patch the already-constructed master so it sees this
                # snapshot for the current pipeline run (P1 #7 fix).
                master.update_momentum_data(momentum_data)
                logger.info("Momentum data populated for %d symbols", len(momentum_data))

                # Fetch 12-month absolute momentum (Antonacci Dual Momentum)
                abs_momentum: dict[str, float] = {}
                for stock in screened[:30]:
                    sym = stock["symbol"]
                    try:
                        resp = await client.get(
                            f"{settings.ALPACA_DATA_BASE_URL}/v2/stocks/{sym}/bars",
                            headers=_alpaca_headers(),
                            params={
                                "timeframe": "1Day",
                                "limit": 1,
                                "start": (_now_et() - timedelta(days=365)).strftime("%Y-%m-%d"),
                                "feed": "sip",
                            },
                        )
                        if resp.status_code == 200:
                            bars = resp.json().get("bars", [])
                            if bars:
                                price_1y_ago = bars[0]["c"]
                                current = stock.get("price", 0)
                                if current and price_1y_ago:
                                    abs_momentum[sym] = ((current / price_1y_ago) - 1) * 100
                    except Exception:
                        logger.debug("12-month momentum fetch failed for %s", sym, exc_info=True)

                MasterAgent.set_absolute_momentum(abs_momentum)
                master.update_absolute_momentum(abs_momentum)
                logger.info("Absolute momentum (12-month) data populated for %d symbols", len(abs_momentum))
            except Exception as e:
                logger.error("Failed to populate momentum data", exc_info=True)
                errors.append(f"Momentum data failed: {e}")

            # ---- Update strategy PnL BEFORE running strategies (P1) ----
            # Must run before new trades are approved, so drawdown peaks
            # reflect only actual positions, not un-traded approvals.
            pre_strategy_values: dict[str, float] = {}
            for sym, pos in master.existing_positions.items():
                strat = pos.get("strategy", "unknown")
                pre_strategy_values[strat] = pre_strategy_values.get(strat, 0) + pos.get("notional", 0)
            for strat, value in pre_strategy_values.items():
                pnl_result = master.update_strategy_pnl(strat, value)
                if pnl_result["action"] == "halt":
                    logger.warning(
                        "Strategy '%s' HALTED (pre-trade): drawdown %.1f%%",
                        strat, pnl_result["drawdown"] * 100,
                    )

            # ---- Run each strategy (screening in parallel) ----
            _check_cancel("pre_strategies")
            if only_strategies:
                strategy_instances = [cls() for cls in ALL_STRATEGIES if cls.name in only_strategies]
                logger.info("Running subset: %s", [s.name for s in strategy_instances])
            else:
                strategy_instances = [cls() for cls in ALL_STRATEGIES]
            num_strategies = len(strategy_instances)
            per_strategy_limit = max(2, analyze_limit // num_strategies)

            # Counter for live progress — incremented as each strategy
            # finishes. Strategies run concurrently via asyncio.gather, so
            # the counter is "how many done so far" not "currently working
            # on number N".
            CURRENT_PROGRESS = {"current": 0, "total": num_strategies}
            _completed_strategies = 0

            async def _run_single_strategy(strategy: BaseStrategyRunner) -> tuple[str, dict[str, Any]]:
                """Run one strategy end-to-end and route its signals through master.

                Task-17 rewrite: the legacy three-stage protocol
                (``screen()`` → ``analyze()`` → ``generate_trades(master)``) is
                replaced by a single ``runner.run(master)`` call that wraps
                the unified :class:`~strategies._core.protocol.Strategy` ABC.
                The runner internally drives a
                :class:`~strategies._core.runners.pipeline_runner.DailyPipelineRunner`
                and converts each emitted :class:`Signal` into a
                ``master.request_trade`` call, preserving the legacy
                approvals/rejections flow on the master agent.
                """
                global CURRENT_STAGE, CURRENT_STRATEGY, CURRENT_PROGRESS
                nonlocal _completed_strategies
                strat_name = strategy.name

                # Halt checkpoint (persona-16 P0-1): the admin halt flag must
                # stop the strategy loop at the entrance of each stage, not
                # only in the manual-order handler. If the operator hits the
                # panic button mid-run, we still bail before request_trade()
                # touches MasterAgent.
                if await _is_trading_halted():
                    logger.warning(
                        "Strategy %s skipped — trading halted by admin",
                        strat_name,
                    )
                    _completed_strategies += 1
                    if CURRENT_PROGRESS is not None:
                        CURRENT_PROGRESS = {
                            "current": _completed_strategies,
                            "total": num_strategies,
                        }
                    return strat_name, {
                        "screened": 0, "analyzed": 0, "analyses": [],
                        "trades_requested": 0, "trades_approved": 0,
                        "trades": [], "halted_by_admin": True,
                    }

                # Round-11 / AA-1.3 (P0): respect per-strategy operator
                # pause. ``POST /api/v1/strategies/{id}/toggle`` writes
                # ``strategy_status:{id}`` to Redis, but the daily
                # pipeline previously never read it — the badge in the
                # /strategies UI flipped to "paused" while the next
                # cron tick still ran the strategy and routed signals
                # through MasterAgent. Mirrors the global halt check
                # above; emits a structured log so the run summary
                # can attribute the skip to the operator action.
                try:
                    from core.redis import cache_get as _cache_get

                    paused_payload = await _cache_get(
                        f"strategy_status:{strat_name}"
                    )
                    if (
                        isinstance(paused_payload, dict)
                        and paused_payload.get("status") == "paused"
                    ):
                        logger.info(
                            "Strategy %s skipped — operator-paused",
                            strat_name,
                        )
                        _completed_strategies += 1
                        if CURRENT_PROGRESS is not None:
                            CURRENT_PROGRESS = {
                                "current": _completed_strategies,
                                "total": num_strategies,
                            }
                        return strat_name, {
                            "screened": 0, "analyzed": 0, "analyses": [],
                            "trades_requested": 0, "trades_approved": 0,
                            "trades": [], "operator_paused": True,
                        }
                except Exception:
                    # Fail-open here is intentional: a Redis blip should
                    # not silently disable strategies. The halt check
                    # above is fail-closed for the panic path; this
                    # check is fail-open because the side-effect of an
                    # incorrect skip is missing trades for the day,
                    # which is more harmful than running a strategy
                    # the operator wanted paused.
                    logger.debug(
                        "Strategy %s pause-flag lookup failed — proceeding",
                        strat_name,
                        exc_info=True,
                    )

                # Cooperative cancel: check before each strategy boundary.
                _check_cancel(f"strategy:{strat_name}")
                # Update live status. Multiple strategies execute in
                # parallel via gather — CURRENT_STRATEGY reflects the most
                # recent one to start, which is good enough for UI breadcrumbs.
                CURRENT_STRATEGY = strat_name
                CURRENT_STAGE = "risk"
                logger.info("Running strategy: %s", strat_name)

                try:
                    result = await strategy.run(master)
                except Exception:
                    logger.exception("pipeline run failed for %s", strat_name)
                    result = {
                        "screened": 0, "analyzed": 0, "analyses": [],
                        "trades_requested": 0, "trades_approved": 0, "trades": [],
                    }
                _check_cancel(f"strategy:{strat_name}:post_run")

                logger.info(
                    "  %s: %d signals, %d trades requested, %d approved",
                    strat_name,
                    result.get("screened", 0),
                    result.get("trades_requested", 0),
                    result.get("trades_approved", 0),
                )

                _completed_strategies += 1
                if CURRENT_PROGRESS is not None:
                    CURRENT_PROGRESS = {
                        "current": _completed_strategies,
                        "total": num_strategies,
                    }

                return strat_name, result

            results = await asyncio.gather(
                *[_run_single_strategy(s) for s in strategy_instances],
                return_exceptions=True,
            )

            for i, result in enumerate(results):
                strat_name = strategy_instances[i].name
                if isinstance(result, Exception):
                    logger.exception("Strategy %s failed: %s", strat_name, result)
                    errors.append(f"Strategy {strat_name} failed: {result}")
                    log["strategies"][strat_name] = {"error": str(result)}
                else:
                    name, data = result
                    log["strategies"][name] = data

            # ---- Update strategy PnL (P1) ----
            strategy_values: dict[str, float] = {}
            for sym, pos in master.existing_positions.items():
                strat = pos.get("strategy", "unknown")
                strategy_values[strat] = strategy_values.get(strat, 0) + pos.get("notional", 0)
            for strat, value in strategy_values.items():
                pnl_result = master.update_strategy_pnl(strat, value)
                if pnl_result["action"] == "halt":
                    logger.warning(
                        "Strategy '%s' HALTED: drawdown %.1f%%",
                        strat, pnl_result["drawdown"] * 100,
                    )

            # ---- Master Agent summary ----
            summary = master.get_summary()
            log["master_agent"] = {
                "approved": len(master.pending_orders),
                "rejected": len(master.rejections),
                "rejections": master.rejections,
                "summary": summary,
                "regime": master.regime,
                "vix_level": master.vix_level,
                "max_deployment_pct": master.max_deployment * 100,
                "sector_exposure": master._get_sector_exposure(),
                "portfolio_var": master._portfolio_var(),
                "halted_strategies": list(master.halted_strategies),
            }

            # ---- Execute approved orders ----
            CURRENT_STAGE = "execute"
            CURRENT_STRATEGY = None  # back to "everyone" for execution
            _check_cancel("execute")

            # Halt checkpoint (persona-16 P0-1): even if strategies produced
            # approved orders before the halt was flipped, we MUST NOT send
            # them to Alpaca. The halt flag takes precedence over any
            # pre-halt work in-flight.
            if await _is_trading_halted():
                logger.warning(
                    "Order execution skipped — trading halted by admin "
                    "(approved=%d discarded)",
                    len(master.pending_orders),
                )
                log["orders_placed"] = []
                log["halted_by_admin"] = True
                errors.append("Trading halted by admin — orders not submitted")
                _pipeline_status["last_result"] = "halted_by_admin"
                _save_log(log)
                return log

            orders_placed = await _execute_approved_orders(
                client, master, ledger, username=username,
            )
            log["orders_placed"] = orders_placed

            # ---- Check exits ----
            CURRENT_STAGE = "exit_check"
            _check_cancel("exit_check")
            closed = await _check_exits(client, ledger, username=username)
            log["orders_closed"] = closed

            # ---- Portfolio snapshot ----
            try:
                account = await _get_account(client, username=username)
                positions = await _get_positions(client, username=username)
                log["portfolio_snapshot"] = {
                    "equity": float(account.get("equity", 0)),
                    "cash": float(account.get("cash", 0)),
                    "positions": len(positions),
                    "day_pnl": day_pnl,
                }
            except Exception as e:
                logger.warning("Snapshot failed", exc_info=True)
                errors.append(f"Snapshot failed: {e}")
                log["portfolio_snapshot"] = {"equity": equity, "cash": cash}

    except _PipelineCancelled as cancelled:
        # Cooperative cancel hit a checkpoint. Log + persist whatever
        # partial state we accumulated so the operator can audit it.
        msg = f"Pipeline cancelled at stage {cancelled.args[0] if cancelled.args else 'unknown'}"
        logger.warning(msg)
        errors.append(msg)
        _pipeline_status["last_result"] = "cancelled"
        _save_log(log)
        return log
    except Exception as e:
        logger.exception("Pipeline failed")
        errors.append(f"Pipeline exception: {e}")

        # Audit P0-5 (2026-05-05): page oncall when the daily pipeline
        # raises an unhandled exception. Same dedup key per-run so a
        # multi-stage failure doesn't fire 5 distinct pages — PagerDuty
        # collapses them into one incident.
        try:
            from services.alerts import (
                Alert,
                AlertSeverity,
                fire_alert,
            )
            from datetime import datetime, timezone

            await fire_alert(Alert(
                severity=AlertSeverity.P0,
                title=f"Daily pipeline failure: {type(e).__name__}",
                description=(
                    f"Pipeline raised {type(e).__name__}: {e}. See "
                    "docs/RUNBOOK-alerts.md#daily-pipeline"
                ),
                source="daily_pipeline.run",
                deduplication_key="daily_pipeline.run",
                occurred_at=datetime.now(timezone.utc),
                metadata={
                    "exception_type": type(e).__name__,
                    "errors_count": len(errors),
                },
            ))
        except Exception:
            logger.error(
                "Pipeline failure alert dispatcher raised",
                exc_info=True,
            )
    finally:
        current_result = _pipeline_status.get("last_result")
        # Don't double-save in the cancel path (it returned above) —
        # the cancel branch already persisted its log + result.
        if current_result != "cancelled":
            _save_log(log)
            if current_result in {None, "running"}:
                _pipeline_status["last_result"] = (
                    "success" if not errors else "completed_with_errors"
                )

    return log


async def run_position_check(
    *, username: str | None = None,
) -> dict[str, Any]:
    """Mid-day or end-of-day position check for stop/target exits.

    Audit MB-P0-1: ``username`` routes the broker query / cancel / replace
    calls through that user's :class:`BrokerConnection` row.
    """
    logger.info("Running position check")
    ledger = TradeLedger()
    result: dict[str, Any] = {"closed": [], "errors": []}

    try:
        _base_url()
        async with httpx.AsyncClient(timeout=30) as client:
            closed = await _check_exits(client, ledger, username=username)
            result["closed"] = closed
    except Exception as e:
        logger.error("Position check failed", exc_info=True)
        result["errors"].append(str(e))

    return result


# =====================================================================
# Earnings pre-warm hook (Batch R)
# =====================================================================
# Lives alongside ``run_position_check`` so the scheduler in
# ``pipeline_runner.py`` can dispatch to a single canonical entry point.
# The actual logic is in :mod:`services.earnings_prewarm` — this is the
# thin trading-day-aware wrapper that the cron-style scheduler calls.

async def run_earnings_prewarm() -> dict[str, Any]:
    """Pre-warm the earnings cache for top-50 tickers reporting today /
    tomorrow.

    Skips on non-trading days so the prewarm doesn't fire against a
    closed market on weekends / US holidays — Batch R's whole point is
    "first user lands on today's report card and gets <500 ms"; on a
    holiday there's no such user. Returns the ``PrewarmRunResult``
    payload as a dict so callers (scheduler, /pipeline/prewarm route)
    can log / audit it without having to import the dataclass.
    """
    logger.info("Running earnings prewarm")
    try:
        from data.calendar import is_trading_day as _is_trading_day

        if not _is_trading_day(_now_et().date()):
            logger.info("Earnings prewarm skipped — not a trading day")
            return {
                "skipped": True,
                "reason": "not_a_trading_day",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
    except Exception:
        # Calendar lookup failure is non-fatal — continue and let the
        # FMP calendar inside the prewarm decide whether there are rows.
        logger.debug(
            "Earnings prewarm: trading-day check failed, continuing",
            exc_info=True,
        )

    try:
        from services.earnings_prewarm import prewarm_earnings

        result = await prewarm_earnings()
    except Exception as exc:
        logger.exception("Earnings prewarm failed")
        return {
            "error": f"{type(exc).__name__}: {exc}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    return {
        "started_at": result.started_at.isoformat(),
        "finished_at": result.finished_at.isoformat(),
        "duration_ms": result.duration_ms,
        "symbols_attempted": result.symbols_attempted,
        "symbols_succeeded": result.symbols_succeeded,
        "claude_calls": result.claude_calls,
        "estimated_cost_usd": round(result.estimated_cost_usd, 2),
        "skipped_reason": result.skipped_reason,
    }
