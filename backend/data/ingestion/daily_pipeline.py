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
                    f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/VIX",
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
# connection can't stall the order path indefinitely. 0.5s is generous for
# a local Redis (typical round-trip is <5ms) but short enough that an
# operator pressing the panic button during a Redis incident still gets a
# fail-closed response within sub-second latency.
_HALT_CHECK_TIMEOUT_SECONDS = 0.5


async def _is_trading_halted() -> bool:
    """Return True if the admin halt flag is set.

    Canonical implementation — ``backend/api/routes/trades.py`` imports this
    rather than keep a duplicate copy (Wave C dedup). Previously there were
    two near-identical copies in ``trades.py`` and here with subtly
    different error-message wording; the trades copy was dropped in favour
    of this one so a fix here applies everywhere.

    Fails *closed* — if Redis is unreachable OR the call times out, we
    treat the system as halted so an outage doesn't silently enable trading
    during a crisis. The 0.5s ``asyncio.wait_for`` wrapper ensures a wedged
    Redis connection cannot delay order submission indefinitely.
    """
    try:
        from core.redis import cache_get
        result = await asyncio.wait_for(
            cache_get(_HALT_REDIS_KEY),
            timeout=_HALT_CHECK_TIMEOUT_SECONDS,
        )
        if result is not None and isinstance(result, dict):
            return bool(result.get("halted", False))
        return False
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
    return {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        "Content-Type": "application/json",
    }


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
    """Return True when current ET time is between 9:35 and 15:55."""
    now = datetime.now(ET)
    market_open = now.replace(hour=9, minute=35, second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=55, second=0, microsecond=0)
    return market_open <= now <= market_close


def _now_et() -> datetime:
    return datetime.now(ET)


# =====================================================================
# Alpaca helpers
# =====================================================================

async def _get_account(client: httpx.AsyncClient) -> dict[str, Any]:
    resp = await client.get(f"{_base_url()}/v2/account", headers=_alpaca_headers())
    resp.raise_for_status()
    return resp.json()


async def _get_positions(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    resp = await client.get(f"{_base_url()}/v2/positions", headers=_alpaca_headers())
    resp.raise_for_status()
    return resp.json()


async def _place_order(
    client: httpx.AsyncClient,
    symbol: str,
    qty: int,
    side: str,
    strategy: str = "unknown",
) -> dict[str, Any]:
    """Place a market order on Alpaca paper.

    Includes a client_order_id encoding the strategy name for traceability.

    Wave-A bypass-fix: enforces ``core.trading_gate.reject_if_live_forbidden``
    so denylisted strategies (orb / kama_breakout) cannot reach live capital
    via this pipeline path. Persona-66 flagged this as one of the most
    exploited bypasses (the daily pipeline POSTs hundreds of orders per
    session with no per-strategy gate).
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
    resp = await client.post(
        f"{_base_url()}/v2/orders",
        headers=_alpaca_headers(),
        json=body,
    )
    resp.raise_for_status()
    order = resp.json()
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

    resp = await client.post(
        f"{_base_url()}/v2/orders",
        headers=_alpaca_headers(),
        json=body,
    )
    resp.raise_for_status()
    order = resp.json()
    logger.info(
        "Bracket order placed: BUY %s %d  stop=$%.2f  tp=%s  strategy=%s  order_id=%s",
        symbol, qty, stop_price,
        f"${take_profit_price:.2f}" if take_profit_price else "none",
        strategy, order.get("id"),
    )
    return order


async def _place_stop_order(client: httpx.AsyncClient, symbol: str, qty: int, stop_price: float) -> dict[str, Any]:
    """Place a stop-loss sell order on Alpaca."""
    body = {
        "symbol": symbol,
        "qty": str(qty),
        "side": "sell",
        "type": "stop",
        "stop_price": str(round(stop_price, 2)),
        "time_in_force": "gtc",  # Good-til-cancelled
    }
    resp = await client.post(
        f"{_base_url()}/v2/orders",
        headers=_alpaca_headers(),
        json=body,
    )
    resp.raise_for_status()
    order = resp.json()
    logger.info("Stop-loss order placed: SELL %s %d shares @ $%.2f  order_id=%s",
                symbol, qty, stop_price, order.get("id"))
    return order


async def _place_limit_order(client: httpx.AsyncClient, symbol: str, qty: int, limit_price: float) -> dict[str, Any]:
    """Place a take-profit limit sell order on Alpaca."""
    body = {
        "symbol": symbol,
        "qty": str(qty),
        "side": "sell",
        "type": "limit",
        "limit_price": str(round(limit_price, 2)),
        "time_in_force": "gtc",
    }
    resp = await client.post(
        f"{_base_url()}/v2/orders",
        headers=_alpaca_headers(),
        json=body,
    )
    resp.raise_for_status()
    order = resp.json()
    logger.info("Take-profit order placed: SELL %s %d shares @ $%.2f  order_id=%s",
                symbol, qty, limit_price, order.get("id"))
    return order


async def _ensure_stop_orders(client: httpx.AsyncClient, ledger: TradeLedger) -> list[dict[str, Any]]:
    """Ensure all open positions have active stop-loss orders on Alpaca."""
    placed: list[dict[str, Any]] = []
    open_positions = ledger.get_open_positions()

    # Get existing orders to avoid duplicates
    resp = await client.get(f"{_base_url()}/v2/orders?status=open", headers=_alpaca_headers())
    existing_orders = resp.json() if resp.status_code == 200 else []
    symbols_with_stops = {o["symbol"] for o in existing_orders if o.get("type") == "stop" and o.get("side") == "sell"}

    for trade in open_positions:
        sym = trade["symbol"]
        if sym in symbols_with_stops:
            continue  # already has a stop

        stop_price = trade.get("signal", {}).get("stop_loss") or trade.get("stop_loss")
        if not stop_price:
            # Default stop: 5% below entry
            stop_price = trade.get("entry_price", 0) * 0.95

        if stop_price and stop_price > 0:
            try:
                order = await _place_stop_order(client, sym, trade["shares"], stop_price)
                placed.append({"symbol": sym, "stop_price": stop_price, "order_id": order.get("id")})
            except Exception:
                logger.error("Failed to place stop for %s", sym, exc_info=True)

    return placed


async def _poll_fill_price(
    client: httpx.AsyncClient,
    order_id: str,
    max_attempts: int = 10,
    delay: float = 1.0,
) -> float | None:
    """Poll Alpaca for an order's filled_avg_price.

    Returns the fill price once the order reaches 'filled' status, or
    None if it doesn't fill within *max_attempts* polls.
    """
    for _ in range(max_attempts):
        try:
            resp = await client.get(
                f"{_base_url()}/v2/orders/{order_id}",
                headers=_alpaca_headers(),
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
                if not sym or qty <= 0:
                    await redis.delete(key)
                    actions.append({"id": outbox_id, "action": "discard_invalid"})
                    continue

                async with httpx.AsyncClient(timeout=10) as client:
                    # Check current Alpaca state for this symbol
                    try:
                        resp = await client.get(
                            f"{_base_url()}/v2/positions/{sym}",
                            headers=_alpaca_headers(),
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
                        r = await client.get(
                            f"{_base_url()}/v2/orders",
                            headers=_alpaca_headers(),
                            params={"status": "open", "symbols": sym},
                        )
                        if r.status_code == 200:
                            for o in r.json():
                                if o.get("type") == "stop" and o.get("side") == "sell":
                                    has_stop = True
                                    break
                    except Exception:
                        logger.warning(
                            "replay: could not list open orders for %s", sym,
                            exc_info=True,
                        )

                    if entry_filled and not has_stop and stop and stop > 0:
                        try:
                            await _place_stop_order(client, sym, qty, float(stop))
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
) -> list[dict[str, Any]]:
    """Place buy orders for all approved pending orders from the master agent."""
    orders_placed: list[dict[str, Any]] = []

    # Enforce daily trade limit
    today_count = ledger.count_today_trades()
    if today_count >= MAX_DAILY_TRADES:
        logger.warning(
            "Daily trade limit reached (%d/%d), skipping remaining orders",
            today_count, MAX_DAILY_TRADES,
        )
        return orders_placed

    for order in list(master.pending_orders):
        if order["side"] != "buy":
            continue
        sym = order["symbol"]
        shares = order.get("shares", 0)
        if shares < 1:
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
            strategy_name = order.get("strategy", "unknown")

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
                fill_price = await _poll_fill_price(client, order_id)
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
                        tp_oid = await _place_limit_order(client, sym, shares, order["take_profit"])
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
) -> list[dict[str, Any]]:
    """Check open positions against stop loss / take profit."""
    closed_orders: list[dict[str, Any]] = []
    open_trades = ledger.get_open_positions()

    if not open_trades:
        return closed_orders

    try:
        positions = await _get_positions(client)
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

        reason = None
        if stop and current_price <= stop:
            reason = "stop_loss"
        elif target and current_price >= target:
            reason = "take_profit"

        # Time-based exit: Close positions held > 20 trading days (~28 calendar days)
        if not reason:
            entry_date = datetime.fromisoformat(trade.get("entry_time", "2026-01-01T00:00:00+00:00"))
            days_held = (datetime.now(timezone.utc) - entry_date).days
            if days_held > 28:
                reason = f"time_exit: held {days_held} days (max 20 trading days)"

        # Trailing stop: If position is up > 5%, move stop to breakeven + buffer
        if not reason and entry_price > 0 and current_price > entry_price * 1.05:
            new_stop = entry_price * 1.01  # Move stop to 1% above entry (breakeven + buffer)
            old_stop = trade.get("signal", {}).get("stop_loss") or trade.get("stop_loss", 0) or 0
            if new_stop > old_stop:
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
                    resp = await client.get(
                        f"{_base_url()}/v2/orders?status=open&symbols={sym}",
                        headers=_alpaca_headers(),
                    )
                    if resp.status_code == 200:
                        for existing_order in resp.json():
                            if existing_order.get("type") == "stop" and existing_order.get("side") == "sell":
                                await client.delete(
                                    f"{_base_url()}/v2/orders/{existing_order['id']}",
                                    headers=_alpaca_headers(),
                                )
                    await _place_stop_order(client, sym, trade["shares"], rounded_new_stop)
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
                order = await _place_order(client, sym, trade["shares"], "sell")
                order_id = order.get("id")
                if order_id:
                    fill_price = await _poll_fill_price(client, order_id)
                    if fill_price is not None:
                        ledger.record_exit(sym, trade["shares"], fill_price, reason)
                    else:
                        logger.warning("Sell order for %s may not have filled (order %s) — recording exit at snapshot price", sym, order_id)
                        ledger.record_exit(sym, trade["shares"], current_price, reason)
                else:
                    ledger.record_exit(sym, trade["shares"], current_price, reason)

                # --- Bracket order cleanup ---
                # When one leg fills (stop-loss or take-profit), cancel
                # the opposing open bracket leg to avoid orphaned orders.
                try:
                    resp = await client.get(
                        f"{_base_url()}/v2/orders?status=open&symbols={sym}",
                        headers=_alpaca_headers(),
                    )
                    if resp.status_code == 200:
                        for open_order in resp.json():
                            otype = open_order.get("type", "")
                            oside = open_order.get("side", "")
                            oid = open_order.get("id")
                            if oside == "sell" and otype in ("stop", "limit") and oid:
                                await client.delete(
                                    f"{_base_url()}/v2/orders/{oid}",
                                    headers=_alpaca_headers(),
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
                    "side": "sell",
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
                    "side": "sell",
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
) -> dict[str, Any]:
    """Execute the full multi-strategy daily trading pipeline.

    Args:
        only_strategies: If provided, only run these strategy names.
            Used by the multi-window scheduler to run subsets at optimal times.
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
    """
    global CURRENT_RUN_ID, CURRENT_STARTED_AT

    # Pre-allocate the run_id so the HTTP caller can return it immediately
    # — the inner function will re-use this value rather than generating
    # its own. Same for started_at.
    run_id = uuid.uuid4().hex
    CURRENT_RUN_ID = run_id
    CURRENT_STARTED_AT = datetime.now(timezone.utc)

    async def _wrapper() -> None:
        try:
            await run_daily_pipeline(
                screen_limit=screen_limit,
                analyze_limit=analyze_limit,
                only_strategies=only_strategies,
            )
        except _PipelineCancelled:
            # Already logged + last_result set inside the inner function.
            pass
        except Exception as exc:
            logger.exception("Background pipeline run failed: %s", exc)
            _pipeline_status["last_result"] = f"error: {exc}"

    asyncio.create_task(_wrapper())
    return run_id


async def _run_pipeline_inner(
    screen_limit: int = SCREEN_TOP_N,
    analyze_limit: int = ANALYZE_TOP_N,
    only_strategies: list[str] | None = None,
) -> dict[str, Any]:
    """Inner pipeline logic, called under _pipeline_lock."""
    global _pipeline_status, CURRENT_STAGE, CURRENT_STRATEGY, CURRENT_PROGRESS

    _pipeline_status["last_run"] = datetime.now(timezone.utc).isoformat()
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

        # Safety: trading window check
        if not _is_within_trading_window():
            now = _now_et()
            logger.warning("Outside trading window (%s ET)", now.strftime("%H:%M"))
            errors.append(f"Outside trading window ({now.strftime('%H:%M')} ET)")

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
                account = await _get_account(client)
                equity = float(account.get("equity", 100_000))
                cash = float(account.get("cash", 0))
                day_pnl = float(account.get("equity", 0)) - float(
                    account.get("last_equity", account.get("equity", 0))
                )
            except Exception as e:
                logger.error("Cannot reach Alpaca account", exc_info=True)
                equity = 100_000
                cash = 100_000
                day_pnl = 0
                errors.append(f"Alpaca account unreachable: {e}")

            # ---- Circuit breaker ----
            if equity > 0 and (day_pnl / equity) < CIRCUIT_BREAKER_PCT:
                msg = (
                    f"CIRCUIT BREAKER: daily P&L {day_pnl:.2f} "
                    f"({day_pnl/equity*100:.1f}%) exceeds -{abs(CIRCUIT_BREAKER_PCT)*100}% limit"
                )
                logger.critical(msg)
                errors.append(msg)
                log["portfolio_snapshot"] = {"equity": equity, "cash": cash, "day_pnl": day_pnl}

                # Send alert via available channels
                try:
                    discord_url = settings.DISCORD_WEBHOOK_URL.get_secret_value() if hasattr(settings.DISCORD_WEBHOOK_URL, 'get_secret_value') else settings.DISCORD_WEBHOOK_URL
                    if discord_url:
                        async with httpx.AsyncClient(timeout=5) as discord_client:
                            await discord_client.post(discord_url, json={"content": f"🚨 CIRCUIT BREAKER: Pipeline halted — daily P&L exceeded -2% threshold"})
                except Exception:
                    logger.critical(
                        "Circuit breaker notify failed — oncall will not be paged via Discord",
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
                stops_placed = await _ensure_stop_orders(client, ledger)
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
                            f"https://data.alpaca.markets/v2/stocks/{sym}/bars",
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
                            f"https://data.alpaca.markets/v2/stocks/{sym}/bars",
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
                """Screen, analyze, and generate trades for one strategy."""
                global CURRENT_STAGE, CURRENT_STRATEGY, CURRENT_PROGRESS
                nonlocal _completed_strategies
                strat_name = strategy.name

                # Halt checkpoint (persona-16 P0-1): the admin halt flag must
                # stop the strategy loop at the entrance of each stage, not
                # only in the manual-order handler. If the operator hits the
                # panic button after screen() started, we still bail before
                # generate_trades() can request any new orders.
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

                # Cooperative cancel: check before each strategy boundary.
                _check_cancel(f"strategy:{strat_name}")
                # Update live status. Multiple strategies execute in
                # parallel via gather — CURRENT_STRATEGY reflects the most
                # recent one to start, which is good enough for UI breadcrumbs.
                CURRENT_STRATEGY = strat_name
                logger.info("Running strategy: %s", strat_name)

                # Screen
                CURRENT_STAGE = "screen"
                candidates = await strategy.screen()
                logger.info(
                    "  %s screened %d candidates", strat_name, len(candidates),
                )
                _check_cancel(f"strategy:{strat_name}:post_screen")

                # Analyze (limit per strategy to conserve CLI calls)
                CURRENT_STAGE = "analyze"
                to_analyze = candidates[:per_strategy_limit]
                analyses = await strategy.analyze(to_analyze)
                logger.info(
                    "  %s analyzed %d candidates", strat_name, len(analyses),
                )
                _check_cancel(f"strategy:{strat_name}:post_analyze")

                # Generate trades (asks master for permission). This is the
                # "risk" stage — master agent decides approve / reject per
                # symbol against position limits, sector caps, etc.
                CURRENT_STAGE = "risk"
                trades = await strategy.generate_trades(analyses, master)
                approved = [t for t in trades if t.get("approved")]
                logger.info(
                    "  %s: %d trades requested, %d approved",
                    strat_name, len(trades), len(approved),
                )

                _completed_strategies += 1
                if CURRENT_PROGRESS is not None:
                    CURRENT_PROGRESS = {
                        "current": _completed_strategies,
                        "total": num_strategies,
                    }

                return strat_name, {
                    "screened": len(candidates),
                    "analyzed": len(analyses),
                    "analyses": analyses,
                    "trades_requested": len(trades),
                    "trades_approved": len(approved),
                    "trades": trades,
                }

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

            orders_placed = await _execute_approved_orders(client, master, ledger)
            log["orders_placed"] = orders_placed

            # ---- Check exits ----
            CURRENT_STAGE = "exit_check"
            _check_cancel("exit_check")
            closed = await _check_exits(client, ledger)
            log["orders_closed"] = closed

            # ---- Portfolio snapshot ----
            try:
                account = await _get_account(client)
                positions = await _get_positions(client)
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
    finally:
        # Don't double-save in the cancel path (it returned above) —
        # the cancel branch already persisted its log + result.
        if _pipeline_status.get("last_result") != "cancelled":
            _save_log(log)
            _pipeline_status["last_result"] = "success" if not errors else "completed_with_errors"

    return log


async def run_position_check() -> dict[str, Any]:
    """Mid-day or end-of-day position check for stop/target exits."""
    logger.info("Running position check")
    ledger = TradeLedger()
    result: dict[str, Any] = {"closed": [], "errors": []}

    try:
        _base_url()
        async with httpx.AsyncClient(timeout=30) as client:
            closed = await _check_exits(client, ledger)
            result["closed"] = closed
    except Exception as e:
        logger.error("Position check failed", exc_info=True)
        result["errors"].append(str(e))

    return result
