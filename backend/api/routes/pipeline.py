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

    B3.6: ``halted_by_admin`` and ``kill_switch_layers`` are typed
    non-nullable with sensible defaults so consumers can rely on
    boolean / list semantics without a ``null`` short-circuit (e.g.
    ``if status.halted_by_admin`` no longer needs an ``is None`` guard).
    """
    running: bool
    stage: str | None = None
    progress: dict[str, int] | None = None
    started_at: str | None = None  # ISO 8601 UTC
    run_id: str | None = None
    current_strategy: str | None = None
    last_run: str | None = None
    last_result: str | None = None
    # B3.6: never-null defaults so ``status.halted_by_admin`` short-
    # circuits cleanly. Populated from the running pipeline globals when
    # the pipeline is active; ``False`` / empty list while idle.
    halted_by_admin: bool = False
    kill_switch_layers: list[dict[str, Any]] = []


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
    username: str = Depends(require_admin),
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

    # Audit MB-P0-1: thread the requesting admin's username so each
    # automated order is routed to *their* Alpaca BrokerConnection row
    # rather than the server-wide env credentials.
    run_id = await start_daily_pipeline_async(
        screen_limit=screen_limit,
        analyze_limit=analyze_limit,
        username=username,
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

    B3.6: ``halted_by_admin`` and ``kill_switch_layers`` are normalized
    so a ``null`` upstream becomes ``False`` / ``[]`` — Pydantic's
    default-factory takes over on missing keys.
    """
    from data.ingestion.daily_pipeline import get_pipeline_status

    raw = get_pipeline_status()
    # Defensive normalization: even if upstream emits explicit ``None``
    # for these keys (rather than omitting them), coerce to the
    # contract defaults so the response shape is stable.
    if raw.get("halted_by_admin") is None:
        raw["halted_by_admin"] = False
    if raw.get("kill_switch_layers") is None:
        raw["kill_switch_layers"] = []
    return PipelineStatus(**raw)


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

# ---- GET /universe — pre-screen universe size for the funnel hero ----

class PipelineUniverseResponse(BaseModel):
    count: int
    source: str
    filter_criteria: str
    as_of: datetime


@router.get("/universe", response_model=PipelineUniverseResponse)
async def pipeline_universe() -> PipelineUniverseResponse:
    """Return the size of the pre-screen universe + a one-line description.

    Powers the design's "01 UNIVERSE 4823 / S&P 1500 + ADRs · liquidity
    > $20m" funnel cell on /pipeline. Today the count is the local
    symbol catalogue (`api.routes.symbols._build_demo_symbols`); once
    the backend wires a true point-in-time S&P 500 / Russell 1000
    constituents endpoint (FMPFundamentalsProvider.sp500_constituents
    is partially scaffolded), the body can swap to that source while
    keeping the response shape stable for the frontend.
    """
    try:
        from api.routes.symbols import _build_demo_symbols
        symbols = _build_demo_symbols()
        count = len(symbols)
        source = "Local symbol catalogue (S&P 500 + major-cap ADRs)"
    except Exception:
        # Fall back to a known-good ballpark so the funnel cell never
        # renders an "—" just because the symbol DB is unavailable.
        count = 500
        source = "Estimate — symbol catalogue unavailable"

    return PipelineUniverseResponse(
        count=count,
        source=source,
        filter_criteria="Liquidity > $20m ADV · price > $5 · regular-hours U.S. listings",
        as_of=datetime.now(tz=timezone.utc),
    )


@router.get("/summary")
async def pipeline_summary() -> dict[str, Any]:
    """Compute aggregate statistics across all pipeline run logs.

    Scans every JSON log in the pipeline_logs directory and returns
    totals for trades placed/rejected, approval rate, most active
    strategy, most common rejection reason, and a portfolio
    since-start snapshot.

    Batch E (2026-05-05) — P1-17: closed-trade metrics
    (``total_closed_trades``, ``realized_pnl``, win/loss counts, best/
    worst trade) are now computed via
    :func:`services.closed_trade_metrics.closed_trade_metrics_for_strategy`,
    which reads from the same ``TradeLedger`` source that
    ``/portfolio/performance`` and ``/strategies/{id}/analytics`` use.
    Before this fix, the two surfaces disagreed: ``/pipeline/summary``
    counted approved orders from log files (5 trades / +$853) while
    ``/portfolio/performance`` counted closed trades from the ledger
    (0 trades / $0 — because no closed rows existed yet). The audit
    persona-new-user flagged this as a trust-killer P1.
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

    # Batch E P1-17: closed-trade metrics MUST come from the same source
    # /portfolio/performance reads — the trade ledger. Walking pipeline
    # log files to count "approved orders" produced numbers that the
    # portfolio analytics page directly contradicted (the audit caught
    # 5/+$853 here vs 0/$0 there). Use the shared helper so the two
    # endpoints can never drift again.
    from services.closed_trade_metrics import closed_trade_metrics_for_strategy
    closed_trade_metrics = closed_trade_metrics_for_strategy()

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
        # Batch E P1-17 — ledger-derived closed-trade metrics. These
        # values are byte-for-byte the same as what /portfolio/performance
        # and /strategies/{id}/analytics emit because all three call into
        # services.closed_trade_metrics.
        "closed_trade_metrics": closed_trade_metrics,
    }


# ---- GET /staged — structured staged candidates from latest run ----

class StagedCandidate(BaseModel):
    symbol: str
    strategy: str | None = None
    signal: str | None = None
    conviction: float | None = None
    entry_price: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    rationale: str | None = None
    timestamp: str | None = None


class StagedCandidatesResponse(BaseModel):
    run_date: str | None
    universe_estimate: int | None
    candidates: list[StagedCandidate] = []


@router.get("/staged", response_model=StagedCandidatesResponse)
async def pipeline_staged_candidates() -> StagedCandidatesResponse:
    """Return structured staged candidates from the most recent pipeline run.

    Powers the design's "STAGED · AWAITING YOUR REVIEW" 2x2 grid on
    /pipeline. Reads the most recent run JSON from `pipeline_logs/`,
    walks the loose-shaped `signals` array (or `strategies.{id}.trades`
    for the multi-strategy format), and returns a structured shape the
    frontend can render without per-row defensive parsing.

    Empty `candidates` is a valid response — the design's empty state
    explains the desk has nothing pending review.
    """
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_files = sorted(LOG_DIR.glob("????-??-??.json"), reverse=True)
    if not log_files:
        return StagedCandidatesResponse(run_date=None, universe_estimate=None)

    latest = log_files[0]
    try:
        data = json.loads(latest.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Failed to read latest pipeline log %s", latest.name, exc_info=True)
        return StagedCandidatesResponse(run_date=None, universe_estimate=None)

    run_date = data.get("date") or latest.stem
    candidates: list[StagedCandidate] = []

    def _coerce(record: dict[str, Any], strategy_hint: str | None = None) -> StagedCandidate | None:
        symbol = record.get("symbol") or record.get("ticker")
        if not symbol:
            return None
        signal_block = record.get("signal") if isinstance(record.get("signal"), dict) else {}
        return StagedCandidate(
            symbol=str(symbol).upper(),
            strategy=strategy_hint or record.get("strategy"),
            signal=record.get("signal_type")
                or record.get("side")
                or (signal_block.get("type") if isinstance(signal_block, dict) else None)
                or "PENDING",
            conviction=_safe_float(
                record.get("conviction")
                or record.get("score")
                or record.get("confidence")
            ),
            entry_price=_safe_float(record.get("entry_price") or signal_block.get("entry_price")),
            stop_loss=_safe_float(record.get("stop_loss") or signal_block.get("stop_loss")),
            take_profit=_safe_float(record.get("take_profit") or signal_block.get("take_profit")),
            rationale=record.get("rationale") or record.get("reason") or record.get("note"),
            timestamp=record.get("timestamp"),
        )

    # Format A: top-level `signals` list (legacy single-strategy logs).
    for sig in data.get("signals", []):
        if isinstance(sig, dict):
            c = _coerce(sig)
            if c is not None:
                candidates.append(c)

    # Format B: `strategies.{id}.trades` multi-strategy logs.
    for strat_id, strat_data in data.get("strategies", {}).items():
        if not isinstance(strat_data, dict):
            continue
        for trade in strat_data.get("trades", []) or []:
            if not isinstance(trade, dict):
                continue
            # Only include trades that haven't been routed to orders yet
            # ("approved" but not "placed"). The design's "awaiting your
            # review" semantic excludes already-filled orders.
            if trade.get("placed") or trade.get("order_id"):
                continue
            c = _coerce(trade, strategy_hint=strat_id)
            if c is not None:
                candidates.append(c)

    # Universe size hint (best-effort) — read from the same source the
    # /pipeline/universe endpoint uses so the section header can render
    # "{N} candidates · top X% of universe" without a second fetch.
    universe_estimate: int | None = None
    try:
        from api.routes.symbols import _build_demo_symbols
        universe_estimate = len(_build_demo_symbols())
    except Exception:
        pass

    return StagedCandidatesResponse(
        run_date=run_date,
        universe_estimate=universe_estimate,
        candidates=candidates,
    )


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        f = float(value)
        return f if f != 0 or value == 0 else None
    except (TypeError, ValueError):
        return None


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
    """Return all open AI-managed positions with stop/target levels.

    BUG-001 / BUG-015 fix: previously this endpoint enriched positions by
    hitting ``/v2/stocks/{symbol}/trades/latest`` per symbol, while the
    Desk/Reports pages read from ``/v2/positions`` (Alpaca's own
    ``current_price`` on the position record). The two feeds drift by a
    few cents within a tick, producing the "+$275 vs +$375 vs +$284"
    spread between Desk / Pipeline / Reports for the same AVGO position.

    Unified pricing: fetch ``/v2/positions`` once and use those
    ``current_price`` values as the source of truth. Fall back to
    ``/trades/latest`` only for symbols the broker doesn't report
    (paper-broker race, or ledger-only synthetic positions).
    """
    from data.ingestion.trade_ledger import TradeLedger

    ledger = TradeLedger()
    open_positions = ledger.get_open_positions()
    performance = ledger.get_performance_summary()

    # J-17 (Round-6) — prefer the authoritative ``Trade.filled_qty`` on
    # the row when present so partial-fill positions show the actual
    # filled size rather than the leg-level submitted size. Lookup is
    # by symbol AND open status (a closed trade for the same symbol
    # would represent a different lifecycle).
    if open_positions:
        try:
            from core.config import settings as _s
            if not _s.SKIP_DB_INIT:
                from sqlalchemy import select, desc
                from core.database import _get_session_factory
                from data.storage.models import Trade

                factory = _get_session_factory()
                async with factory() as db:
                    q = (
                        select(Trade)
                        .where(Trade.status.in_(["submitted", "open", "filled", "partial"]))
                        .order_by(desc(Trade.entry_time))
                        .limit(500)
                    )
                    rows = (await db.execute(q)).scalars().all()
                    sym_to_filled: dict[str, float] = {}
                    for t in rows:
                        if t.symbol and getattr(t, "filled_qty", None) is not None:
                            try:
                                fq = float(t.filled_qty)
                                if fq > 0 and t.symbol not in sym_to_filled:
                                    sym_to_filled[t.symbol] = fq
                            except (TypeError, ValueError):
                                continue
                # Apply override — only when DB carries a legitimate
                # filled_qty. Pre-J-17 rows stay None and the existing
                # leg-level qty propagates unchanged.
                for pos in open_positions:
                    sym = pos.get("symbol")
                    if sym and sym in sym_to_filled:
                        pos["shares"] = sym_to_filled[sym]
        except Exception:
            logger.debug(
                "pipeline_positions: filled_qty enrichment skipped",
                exc_info=True,
            )

    # Enrich open positions with live market prices — SAME source as
    # /trades/positions so every page shows the identical current_price.
    if open_positions:
        import httpx
        from core.config import settings

        broker_prices: dict[str, float] = {}
        # J-1 (Round-6) — partial-fill drift fix. The broker's
        # ``avg_entry_price`` reflects the volume-weighted fill price
        # across every partial fill that landed for the position.
        # Override the local ledger's entry_price with the broker's
        # avg_entry_price when both exist, so Desk / Pipeline /
        # Reports converge on the same entry basis (BUG-001).
        broker_avg_entry: dict[str, float] = {}
        alpaca_headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Single /v2/positions fetch — same feed as Desk/Reports.
                try:
                    pos_resp = await client.get(
                        f"{settings.ALPACA_BASE_URL}/v2/positions",
                        headers=alpaca_headers,
                    )
                    if pos_resp.status_code == 200:
                        for bp in pos_resp.json():
                            sym = bp.get("symbol", "")
                            if sym:
                                try:
                                    broker_prices[sym] = float(bp.get("current_price", 0))
                                except (TypeError, ValueError):
                                    pass
                                # J-1 — capture avg_entry_price for
                                # the partial-fill override below.
                                try:
                                    avg_entry = float(bp.get("avg_entry_price", 0) or 0)
                                    if avg_entry > 0:
                                        broker_avg_entry[sym] = avg_entry
                                except (TypeError, ValueError):
                                    pass
                except Exception:
                    logger.debug("Broker /v2/positions fetch failed", exc_info=True)

                for pos in open_positions:
                    symbol = pos.get("symbol", "")
                    if not symbol:
                        continue
                    current_price = broker_prices.get(symbol, 0) or 0

                    # J-1 — override ledger entry_price with broker's
                    # volume-weighted avg_entry_price when both exist.
                    ledger_entry = pos.get("entry_price", 0)
                    bp_avg = broker_avg_entry.get(symbol)
                    if bp_avg and ledger_entry:
                        pos["entry_price"] = bp_avg
                    if not current_price:
                        # Fallback for ledger-only symbols not held at broker.
                        try:
                            resp = await client.get(
                                f"{settings.ALPACA_DATA_BASE_URL}/v2/stocks/{symbol}/trades/latest",
                                headers=alpaca_headers,
                            )
                            if resp.status_code == 200:
                                current_price = resp.json().get("trade", {}).get("p", 0)
                        except Exception:
                            logger.debug("Failed to fetch live price for %s", symbol)
                    if current_price:
                        pos["current_price"] = current_price
                        # Use the (possibly broker-overridden) entry_price
                        # so P&L matches the override above.
                        entry = pos.get("entry_price", 0)
                        shares = pos.get("shares", 0)
                        # Honour position side — short P&L inverts sign.
                        # Previously this unconditionally used (current-entry),
                        # so a short that dropped 5% showed as a LOSS in
                        # /pipeline/positions while /trades/positions showed
                        # it as a profit. Ledger stores side per row.
                        side = str(pos.get("side") or "long").lower()
                        if entry and shares:
                            if side == "short":
                                pos["pnl"] = round((entry - current_price) * shares, 2)
                                pos["pnl_pct"] = round(((entry - current_price) / entry) * 100, 2)
                            else:
                                pos["pnl"] = round((current_price - entry) * shares, 2)
                                pos["pnl_pct"] = round(((current_price - entry) / entry) * 100, 2)
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
