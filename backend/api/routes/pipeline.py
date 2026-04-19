"""API routes for the automated daily trading pipeline."""
from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from core.auth import require_auth
from api.routes.auth import require_admin

logger = logging.getLogger("alphadesk.pipeline.api")

router = APIRouter()

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "pipeline_logs"


# ---- Response models ----

class PipelineStatus(BaseModel):
    """Live pipeline status surfaced by GET /pipeline/status.

    `running` is derived from ``_pipeline_lock.locked()`` so it cannot
    drift out of sync with reality (persona-7 #1). The remaining fields
    are written by the running pipeline as it crosses stage boundaries
    — they are ``None`` while idle.
    """
    running: bool
    stage: str | None = None
    progress: dict[str, int] | None = None
    started_at: str | None = None  # ISO 8601 UTC
    run_id: str | None = None
    current_strategy: str | None = None
    last_run: str | None = None
    last_result: str | None = None


class SchedulerState(BaseModel):
    """Persisted scheduler state surfaced by GET /pipeline/scheduler_state.

    Mirrors the dict the scheduler writes to Redis at key
    ``pipeline:scheduler_state`` (see pipeline_runner.py:288). The dict
    holds ``last_<window>`` ISO date strings; we surface them as one
    ``last_heartbeat`` (most recent) plus ``next_scheduled_run`` (computed
    from USMarketCalendar) and ``missed_runs`` (windows that should have
    fired today but haven't).
    """
    last_heartbeat: str | None = None
    next_scheduled_run: str | None = None
    missed_runs: int = 0
    raw_state: dict[str, Any] = {}


# Rate-limit POST /pipeline/run — 1 run per 60 seconds per user. The pipeline
# itself is expensive (dozens of Alpaca/Polygon calls + Claude spawns). Reuse
# the same Redis-pipeline pattern auth.py uses for login. Fail-closed on Redis
# errors: this endpoint is too expensive to let through on a Redis blip.
_PIPELINE_RATE_WINDOW = 60
_PIPELINE_RATE_MAX = 1


async def _pipeline_rate_limit(username: str) -> None:
    """Rate-limit POST /pipeline/run. On 429 we set Retry-After to the
    actual remaining TTL of the Redis key — not the window length — so
    a client that hits the limit 50s in is told "wait 10s" not "wait 60s"
    (persona-9 #10).
    """
    key = f"pipeline_run:{username}"
    try:
        from core.redis import get_redis
        redis = await get_redis()
        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, _PIPELINE_RATE_WINDOW, nx=True)
        # ttl returns seconds (-2 = no key, -1 = no TTL, >=0 = seconds left).
        # We add it to the same pipeline so we don't pay an extra round-trip.
        pipe.ttl(key)
        results = await pipe.execute()
        count = int(results[0])
        ttl = int(results[2])
    except Exception:
        logger.warning("pipeline rate-limit: Redis unavailable", exc_info=True)
        # Fail closed — skipping the limiter on such an expensive endpoint
        # would let a panicked user burn the Polygon quota in 30 seconds.
        raise HTTPException(
            status_code=503,
            detail={"error": "rate_limiter_unavailable", "retry": True},
        )

    if count > _PIPELINE_RATE_MAX:
        # Use the actual remaining TTL when available; clamp to >=1 so
        # browsers don't spin-retry.
        retry_after = ttl if ttl > 0 else _PIPELINE_RATE_WINDOW
        retry_after = max(1, retry_after)
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": "Pipeline can only be triggered once per minute. Please wait.",
                "retry_after": retry_after,
            },
            headers={"Retry-After": str(retry_after)},
        )


# ---- POST /run — manually trigger the pipeline (fire-and-forget) ----

@router.post("/run", status_code=202)
async def trigger_pipeline(
    screen_limit: int = Query(100, ge=1, le=500, description="Number of stocks to screen"),
    analyze_limit: int = Query(40, ge=1, le=200, description="Total analysis budget across all strategies"),
    username: str = Depends(require_auth),
) -> dict[str, Any]:
    """Kick off the multi-strategy pipeline asynchronously.

    Persona-7 #2 P0: the previous implementation awaited the full run
    (30-180s) on the request handler, which meant the client had to keep
    the HTTP connection open for the duration and a closed tab orphaned
    the response. This now spawns ``run_daily_pipeline`` via
    ``asyncio.create_task`` and returns 202 Accepted with the new
    ``run_id`` immediately. Clients poll ``GET /pipeline/status`` to track
    the run.
    """
    # Rate-limit (1 per 60s per user) — this is an expensive endpoint.
    await _pipeline_rate_limit(username)

    from data.ingestion.daily_pipeline import (
        _pipeline_lock,
        start_daily_pipeline_async,
    )

    # If the pipeline is already running, return 409 Conflict.
    if _pipeline_lock.locked():
        raise HTTPException(
            status_code=409,
            detail={"error": "already_running", "message": "Pipeline is already running"},
        )

    run_id = await start_daily_pipeline_async(
        screen_limit=screen_limit,
        analyze_limit=analyze_limit,
    )

    return {
        "run_id": run_id,
        "status": "started",
    }


# ---- POST /cancel — cooperative kill-switch (admin only) ----

@router.post("/cancel")
async def cancel_pipeline(
    _admin: str = Depends(require_admin),
) -> dict[str, Any]:
    """Cooperatively cancel the in-flight pipeline run (persona-7 #3 P0).

    Sets a module-level flag the running pipeline checks at every major
    boundary (start of each stage, before each strategy, before order
    execution, before exit checks). The pipeline exits gracefully and
    writes ``last_result = "cancelled"`` so /status surfaces the outcome.

    Returns 200 with ``{cancelled: True}`` when the flag was set against
    a live run. Returns ``{cancelled: False, reason: "no_run"}`` when no
    run is currently in flight — admins typically want to know they fired
    a cancel against nothing rather than getting 404.
    """
    from data.ingestion.daily_pipeline import request_cancel

    accepted = request_cancel()
    if not accepted:
        return {"cancelled": False, "reason": "no_run"}
    return {"cancelled": True}


# ---- GET /status — current pipeline status (live) ----

@router.get("/status", response_model=PipelineStatus)
async def pipeline_status() -> PipelineStatus:
    """Get the live pipeline status (persona-7 #1 P0).

    `running`, `stage`, `progress`, `started_at`, `run_id`, and
    `current_strategy` are sourced from the running pipeline's module-
    level globals. They're ``None`` while idle. `last_run` and
    `last_result` carry over from the previous completed run so an
    operator landing on the page sees what last happened.
    """
    from data.ingestion.daily_pipeline import get_pipeline_status

    return PipelineStatus(**get_pipeline_status())


# ---- GET /scheduler_state — persisted scheduler state (persona-7 #8) ----

@router.get("/scheduler_state", response_model=SchedulerState)
async def scheduler_state() -> SchedulerState:
    """Surface the scheduler state Redis blob written by pipeline_runner.

    The scheduler at ``data/ingestion/pipeline_runner.py:288`` persists
    a dict like ``{"last_premarket": "2026-04-18", "last_open": ...}`` to
    Redis under the key ``pipeline:scheduler_state``. Operators currently
    have to SSH + ``redis-cli`` to see it; this endpoint exposes the same
    payload plus a computed ``next_scheduled_run`` from
    :class:`USMarketCalendar` and a count of windows that should have
    fired today but haven't (``missed_runs``).
    """
    from core.redis import cache_get
    from datetime import time as dt_time

    raw_state: dict[str, Any] = {}
    try:
        cached = await cache_get("pipeline:scheduler_state")
        if isinstance(cached, dict):
            raw_state = cached
    except Exception:
        logger.warning("scheduler_state: Redis unavailable", exc_info=True)

    # Most recent heartbeat is the highest "last_<window>" value (ISO date
    # strings sort lexically).
    heartbeats = [
        v for k, v in raw_state.items()
        if k.startswith("last_") and isinstance(v, str)
    ]
    last_heartbeat = max(heartbeats) if heartbeats else None

    # Compute next scheduled session (the next trading-day open).
    next_scheduled_run: str | None = None
    try:
        from data.calendar import USMarketCalendar
        from zoneinfo import ZoneInfo
        ET = ZoneInfo("America/New_York")
        cal = USMarketCalendar()
        today_et = datetime.now(ET).date()
        # If today is a trading day and we're before the close window
        # (15:30 ET), the next scheduled run is still today's close.
        if cal.is_trading_day(today_et):
            now_et = datetime.now(ET)
            close_time = now_et.replace(hour=15, minute=30, second=0, microsecond=0)
            if now_et < close_time:
                next_scheduled_run = close_time.isoformat()
        if next_scheduled_run is None:
            next_session = cal.next_session(today_et)
            # Default open: 09:35 ET (the first window the scheduler fires).
            next_open = datetime.combine(next_session, dt_time(9, 35), tzinfo=ET)
            next_scheduled_run = next_open.isoformat()
    except Exception:
        logger.debug("scheduler_state: next-session calc failed", exc_info=True)

    # Missed runs: scheduler windows expected today that have no
    # corresponding "last_<window>" matching today's date.
    missed = 0
    try:
        from zoneinfo import ZoneInfo
        ET = ZoneInfo("America/New_York")
        from datetime import time as dt_time
        from data.ingestion.pipeline_runner import WINDOWS, _is_trading_day
        if _is_trading_day():
            now_et = datetime.now(ET)
            today_str = now_et.strftime("%Y-%m-%d")
            for window_name, target_time in WINDOWS.items():
                # Only count windows whose scheduled time is already past.
                if now_et.time() < target_time:
                    continue
                key = f"last_{window_name}"
                if raw_state.get(key) != today_str:
                    missed += 1
    except Exception:
        logger.debug("scheduler_state: missed-runs calc failed", exc_info=True)

    return SchedulerState(
        last_heartbeat=last_heartbeat,
        next_scheduled_run=next_scheduled_run,
        missed_runs=missed,
        raw_state=raw_state,
    )


# ---- GET /history — last 30 days of pipeline logs ----

@router.get("/history")
async def pipeline_history() -> list[dict[str, Any]]:
    """Return pipeline run summaries for the last 30 days."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    entries: list[dict[str, Any]] = []

    today = datetime.now(timezone.utc).date()
    for i in range(30):
        date = today - timedelta(days=i)
        path = LOG_DIR / f"{date.isoformat()}.json"
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                # Support both old format (signals list) and new multi-strategy format
                strategies_data = data.get("strategies", {})
                total_signals = len(data.get("signals", []))
                if not total_signals and strategies_data:
                    total_signals = sum(
                        s.get("trades_approved", 0)
                        for s in strategies_data.values()
                        if isinstance(s, dict)
                    )
                entries.append({
                    "date": data.get("date", str(date)),
                    "orders_placed": len(data.get("orders_placed", [])),
                    "orders_closed": len(data.get("orders_closed", [])),
                    "signals": total_signals,
                    "strategies_run": len(strategies_data) if strategies_data else 0,
                    "master_agent": data.get("master_agent", {}),
                    "errors": len(data.get("errors", [])),
                    "portfolio_snapshot": data.get("portfolio_snapshot", {}),
                })
            except Exception:
                logger.warning("Failed to parse pipeline log for %s", date, exc_info=True)
                entries.append({"date": str(date), "error": "corrupt_log"})

    return entries


# ---- GET /summary — aggregate pipeline statistics ----

@router.get("/summary")
async def pipeline_summary() -> dict[str, Any]:
    """Compute aggregate statistics across all pipeline run logs.

    Scans every JSON log in the pipeline_logs directory and returns
    totals for trades placed/rejected, approval rate, most active
    strategy, most common rejection reason, and a portfolio
    since-start snapshot.
    """
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    total_runs = 0
    total_placed = 0
    total_rejected = 0
    strategy_placed: Counter[str] = Counter()
    rejection_reasons: Counter[str] = Counter()
    last_run: str | None = None
    first_equity: float | None = None
    last_equity: float | None = None

    log_files = sorted(LOG_DIR.glob("????-??-??.json"))
    for path in log_files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("Skipping corrupt log %s", path.name, exc_info=True)
            continue

        total_runs += 1

        # Track timestamps for last_run
        ts = data.get("timestamp") or data.get("date", "")
        if ts and (last_run is None or ts > last_run):
            last_run = ts

        # Portfolio equity tracking
        ps = data.get("portfolio_snapshot", {})
        eq = ps.get("equity")
        if eq is not None:
            if first_equity is None:
                first_equity = eq
            last_equity = eq

        # Count orders placed (actual broker orders)
        orders = data.get("orders_placed", [])
        total_placed += len(orders)

        # Walk strategies for trade-level data
        master = data.get("master_agent", {})
        total_rejected += master.get("rejected", 0)

        # Count approved trades per strategy
        for strat_name, strat_data in data.get("strategies", {}).items():
            if not isinstance(strat_data, dict):
                continue
            approved = strat_data.get("trades_approved", 0)
            if approved > 0:
                strategy_placed[strat_name] += approved
            # Also count placed orders by strategy
            for trade in strat_data.get("trades", []):
                if trade.get("approved"):
                    strategy_placed[strat_name] += 1

        # Rejection reasons from master agent
        for rej in master.get("rejections", []):
            reason = rej.get("reason", "Unknown")
            rejection_reasons[reason] += 1

    # Also count orders_placed entries toward total if strategies
    # didn't record them (orders are the ground-truth placements)
    # total_placed already accounts for orders_placed above

    total_decisions = total_placed + total_rejected
    approval_rate = round(total_placed / total_decisions * 100, 1) if total_decisions > 0 else 0.0

    most_active = strategy_placed.most_common(1)[0][0] if strategy_placed else None
    most_rejected = rejection_reasons.most_common(1)[0][0] if rejection_reasons else None

    # Portfolio since start
    starting = first_equity or 100_000
    current = last_equity or starting
    total_return_pct = round((current - starting) / starting * 100, 2) if starting else 0

    return {
        "total_runs": total_runs,
        "total_trades_placed": total_placed,
        "total_trades_rejected": total_rejected,
        "approval_rate": approval_rate,
        "most_active_strategy": most_active,
        "most_rejected_reason": most_rejected,
        "last_run": last_run,
        "portfolio_since_start": {
            "starting_equity": round(starting, 2),
            "current_equity": round(current, 2),
            "total_return_pct": total_return_pct,
        },
    }


# ---- GET /history/{date} — specific day log ----

@router.get("/history/{date}")
async def pipeline_history_date(date: str) -> dict[str, Any]:
    """Return the full pipeline log for a specific date (YYYY-MM-DD)."""
    import re
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")
    path = LOG_DIR / f"{date}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"No pipeline log for {date}")

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.error("Failed to read pipeline log %s", date, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to read pipeline log")


# ---- GET /positions — AI-managed positions with entry/exit levels ----

@router.get("/positions")
async def pipeline_positions() -> dict[str, Any]:
    """Return all open AI-managed positions with stop/target levels."""
    from data.ingestion.trade_ledger import TradeLedger

    ledger = TradeLedger()
    open_positions = ledger.get_open_positions()
    performance = ledger.get_performance_summary()

    # Enrich open positions with live market prices
    if open_positions:
        import httpx
        from core.config import settings

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                for pos in open_positions:
                    symbol = pos.get("symbol", "")
                    if not symbol:
                        continue
                    try:
                        resp = await client.get(
                            f"https://data.alpaca.markets/v2/stocks/{symbol}/trades/latest",
                            headers={
                                "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                                "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                            },
                        )
                        if resp.status_code == 200:
                            current_price = resp.json().get("trade", {}).get("p", 0)
                            pos["current_price"] = current_price
                            entry = pos.get("entry_price", 0)
                            shares = pos.get("shares", 0)
                            if entry and shares:
                                pos["pnl"] = round((current_price - entry) * shares, 2)
                                pos["pnl_pct"] = round(((current_price - entry) / entry) * 100, 2)
                    except Exception:
                        logger.debug("Failed to fetch live price for %s", symbol)
        except Exception:
            logger.warning("Failed to enrich pipeline positions with live data")

    return {
        "open_positions": open_positions,
        "performance": performance,
    }


# ---- GET /realtime-setups — view active real-time signal setups ----

@router.get("/realtime-setups")
async def get_realtime_setups() -> dict[str, Any]:
    """Return currently active real-time signal scanner setups."""
    from data.ingestion.realtime_scanner import get_active_setups, _pending_setups, _pairs_setups

    active = get_active_setups()
    details = []
    for sym, setups in _pending_setups.items():
        for s in setups:
            details.append({
                "symbol": sym,
                "strategy": s.get("strategy", ""),
                "type": s.get("type", ""),
                "trigger_price": s.get("trigger_price", 0),
                "direction": s.get("direction", ""),
                "expires": s.get("expires", ""),
            })
    for s in _pairs_setups:
        details.append({
            "symbol": f"{s.get('sym_a', '')}/{s.get('sym_b', '')}",
            "strategy": "pairs_trading",
            "type": "pairs_zscore",
            "trigger_price": s.get("trigger_zscore", 0),
            "direction": s.get("direction", ""),
            "expires": s.get("expires", ""),
        })

    return {
        "summary": active,
        "setups": details,
    }


# ---- GET /schedule — show the multi-window pipeline schedule ----

@router.get("/schedule")
async def get_pipeline_schedule() -> dict[str, Any]:
    """Return the current pipeline execution schedule with strategy assignments."""
    from data.ingestion.pipeline_runner import (
        PREMARKET_STRATEGIES, OPEN_STRATEGIES, POST_OR_STRATEGIES,
        MIDDAY_STRATEGIES, CLOSE_STRATEGIES, MONTHLY_STRATEGIES,
        WEEKLY_STRATEGIES,
    )

    return {
        "windows": [
            {"time": "06:00 ET", "name": "Pre-market scan", "strategies": PREMARKET_STRATEGIES, "frequency": "daily"},
            {"time": "09:35 ET", "name": "Market open execution", "strategies": OPEN_STRATEGIES, "frequency": "daily"},
            {"time": "10:05 ET", "name": "Post-opening range", "strategies": POST_OR_STRATEGIES, "frequency": "daily"},
            {"time": "12:00 ET", "name": "Midday check", "strategies": MIDDAY_STRATEGIES, "frequency": "daily"},
            {"time": "15:30 ET", "name": "Close window (MOC)", "strategies": CLOSE_STRATEGIES, "frequency": "daily"},
            {"time": "15:55 ET", "name": "Monthly rebalance", "strategies": MONTHLY_STRATEGIES, "frequency": "monthly (last trading day)"},
            {"time": "15:30 Fri", "name": "Weekly refresh", "strategies": WEEKLY_STRATEGIES, "frequency": "weekly (Friday)"},
        ],
        "realtime": {
            "strategies": ["orb", "vwap_strategy", "vcp_breakout", "kama_breakout", "pairs_trading"],
            "description": "These strategies also have real-time signal scanning via the Redis quote stream, triggered on every price tick.",
        },
    }
