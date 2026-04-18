"""Pipeline scheduler — multi-window strategy execution.

Strategies run at their academically optimal times, not all at once:

    6:00 AM ET  — Pre-market: PEAD (earnings scan), Regime model
    9:35 AM ET  — Market open: execute PEAD T+1 entries
   10:05 AM ET  — Post-opening range: ORB breakouts, VWAP monitoring begins
   12:00 PM ET  — Midday: Pairs z-score check, KAMA squeeze scan
    3:30 PM ET  — Close window: RSI-2 (MOC entry), Mean Reversion (MOC), VRP scan,
                  Earnings Vol, position exits
    3:55 PM ET  — Monthly (last trading day): TS Momentum, Dual Momentum, Momentum+Quality
    3:30 PM ET  — Weekly (Friday): Regime Adaptive reallocation, Pairs cointegration refresh

Academic basis:
- Connors (2008): RSI-2 must enter at close (MOC), not open
- Antonacci (2014): Dual Momentum rebalances end of month
- Jegadeesh & Titman (1993): monthly momentum rebalance
- Crabel (1990): ORB executes after 30-min range forms (10:00+ AM)
- Bernard & Thomas (1989): PEAD entries on T+1 open
- Tastytrade: VRP best scanned at 3 PM when IV surface is established
- Gatev et al. (2006): Pairs need intraday z-score monitoring

Started/stopped from the FastAPI lifespan in main.py.
"""
from __future__ import annotations

import asyncio
import calendar
import logging
from datetime import datetime, date, time as dt_time, timedelta
from zoneinfo import ZoneInfo

from data.calendar import USMarketCalendar
from data.ingestion.daily_pipeline import (
    run_daily_pipeline,
    run_position_check,
    get_pipeline_status,
)

logger = logging.getLogger("alphadesk.pipeline.scheduler")

# Single shared instance — USMarketCalendar keeps an internal schedule cache
# keyed on the (start, end) range passed to ``_schedule``; building it once
# and reusing means holidays are memoised across the whole scheduler loop.
_CAL = USMarketCalendar()

# How often to reconcile the trade ledger with Alpaca (seconds).
# 5 minutes is short enough to catch broker-side fills quickly, long enough
# that it doesn't dominate API quota or step on the main scheduler cadence.
LEDGER_SYNC_INTERVAL_SEC = 300

ET = ZoneInfo("America/New_York")

# ─── Strategy Groups by Optimal Run Time ────────────────────

# Pre-market analysis (6:00 AM) — scan overnight events
PREMARKET_STRATEGIES = ["pead", "regime_adaptive"]

# Market open (9:35 AM) — execute pre-market signals
OPEN_STRATEGIES = ["pead"]

# Post-opening range (10:05 AM) — intraday breakout strategies
POST_OR_STRATEGIES = ["orb", "vwap"]

# Midday (12:00 PM) — market-neutral and squeeze strategies
MIDDAY_STRATEGIES = ["pairs_trading", "kama_breakout"]

# Close window (3:30 PM) — MOC entry strategies + VRP scan
CLOSE_STRATEGIES = [
    "rsi2_reversal",    # Connors: enter at close
    "mean_reversion",   # End-of-day scan for oversold
    "vrp_harvest",      # IV surface established by 3 PM
    "earnings_vol",     # T-1 entries for upcoming earnings
]

# Monthly (last trading day, 3:55 PM) — rebalance strategies
MONTHLY_STRATEGIES = [
    "ts_momentum",      # 200-SMA evaluation
    "dual_momentum",    # Top-quintile re-rank
    "momentum_quality", # Cross-sectional momentum rebalance
]

# Weekly (Friday 3:30 PM) — regime and cointegration refresh
WEEKLY_STRATEGIES = ["regime_adaptive", "pairs_trading"]

# ─── Schedule Windows ───────────────────────────────────────

WINDOWS = {
    "premarket":  dt_time(6, 0),
    "open":       dt_time(9, 35),
    "post_or":    dt_time(10, 5),
    "midday":     dt_time(12, 0),
    "close":      dt_time(15, 30),
    "monthly":    dt_time(15, 55),
}

_scheduler_task: asyncio.Task | None = None
_ledger_sync_task: asyncio.Task | None = None
_should_stop = False


def _is_market_hours() -> bool:
    """Return True if current ET time is within US equity RTH.

    Holiday-aware via :class:`USMarketCalendar` — previously this was a
    ``weekday() < 5`` check which mis-reported Christmas-on-a-Monday, MLK
    Day, Good Friday, etc. as "market hours". Half-day closes (13:00 ET)
    are also respected: at 15:00 ET on the day after Thanksgiving the
    scheduler correctly sees the market as closed.
    """
    now = datetime.now(ET)
    today = now.date()
    if not _CAL.is_trading_day(today):
        return False
    try:
        open_utc, close_utc = _CAL.session_hours(today)
    except ValueError:
        return False
    open_et = open_utc.astimezone(ET)
    close_et = close_utc.astimezone(ET)
    return open_et <= now < close_et


async def _sync_ledger_with_alpaca() -> None:
    """Reconcile trade ledger with Alpaca positions.

    Extracted from the old in-request handlers as part of the C2 fix: GET
    endpoints must never mutate state, so the reconciliation runs here
    on a 5-minute cadence during market hours.
    """
    import httpx
    from core.config import settings
    from data.ingestion.trade_ledger import TradeLedger

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions",
                headers={
                    "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                    "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                },
            )
    except Exception as exc:
        logger.warning("Ledger sync: Alpaca request failed: %s", exc)
        return

    if resp.status_code != 200:
        logger.warning(
            "Ledger sync: Alpaca returned HTTP %s, body=%s",
            resp.status_code, resp.text[:200],
        )
        return

    try:
        alpaca_positions = resp.json()
    except Exception as exc:
        logger.warning("Ledger sync: Alpaca response not JSON: %s", exc)
        return

    try:
        ledger = TradeLedger()
        summary = ledger.sync_with_alpaca(alpaca_positions)
        logger.info("Ledger sync tick: %s", summary)
    except Exception as exc:
        logger.exception("Ledger sync failed: %s", exc)


async def _ledger_sync_loop() -> None:
    """Background coroutine: reconcile ledger with Alpaca every N seconds."""
    global _should_stop
    logger.info(
        "Ledger→Alpaca sync loop started (every %ds during market hours)",
        LEDGER_SYNC_INTERVAL_SEC,
    )
    while not _should_stop:
        try:
            if _is_market_hours():
                await _sync_ledger_with_alpaca()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.exception("Ledger sync loop error: %s", exc)
        # Sleep in small chunks so stop_pipeline_scheduler returns quickly.
        slept = 0
        while slept < LEDGER_SYNC_INTERVAL_SEC and not _should_stop:
            await asyncio.sleep(min(30, LEDGER_SYNC_INTERVAL_SEC - slept))
            slept += 30
    logger.info("Ledger→Alpaca sync loop stopped")


def _is_trading_day() -> bool:
    """Holiday-aware replacement for the old ``_is_weekday`` check.

    Uses :class:`USMarketCalendar` so that New Year's Day, MLK Day,
    Presidents' Day, Good Friday, Memorial Day, Juneteenth, July 4th,
    Labor Day, Thanksgiving, and Christmas all return False — even when
    they fall on a weekday. See edge-cases-audit-r3.md P0 #4.
    """
    return _CAL.is_trading_day(datetime.now(ET).date())


# Back-compat alias: other call sites may still import `_is_weekday`.
# Redirect to the holiday-aware version so there is a single source of truth.
_is_weekday = _is_trading_day


def _is_last_trading_day() -> bool:
    """Check if today is the last TRADING day of the month.

    Walks backwards from the last calendar day and finds the first date
    that :class:`USMarketCalendar` agrees is a session — so end-of-month
    rebalances correctly fire on the last *trading* day even when the
    month ends on a holiday weekday (e.g. New Year's Eve falls on a Fri
    where the session is already closed).
    """
    now = datetime.now(ET)
    last_day = calendar.monthrange(now.year, now.month)[1]
    d = date(now.year, now.month, last_day)
    # Walk backwards until we hit a real trading session.
    while not _CAL.is_trading_day(d):
        d -= timedelta(days=1)
    return now.date() == d


def _is_friday() -> bool:
    """True if today is a trading Friday (skips Good Friday etc.)."""
    now = datetime.now(ET)
    return now.weekday() == 4 and _CAL.is_trading_day(now.date())


def _in_window(target: dt_time, window_minutes: int = 5) -> bool:
    """Check if current ET time is within window_minutes of target."""
    now_dt = datetime.now(ET)
    now = now_dt.time()
    end_minute = target.minute + window_minutes
    end_hour = target.hour + end_minute // 60
    end_time = dt_time(min(end_hour, 23), end_minute % 60)
    return target <= now <= end_time


def _close_window_target(today: date) -> dt_time:
    """Return the ET time to fire close-window strategies today.

    On regular session days the window fires at 15:30 ET (30 min before
    16:00 close). On half-days the close is 13:00 ET and the window
    shifts to 12:30 ET so MOC entries still land before the bell rather
    than against a market that closed two hours earlier. See
    edge-cases-audit-r3.md A/P1 "Early-close days".
    """
    default = WINDOWS["close"]
    try:
        if not _CAL.is_trading_day(today) or not _CAL.is_early_close(today):
            return default
        _, close_utc = _CAL.session_hours(today)
        close_et = close_utc.astimezone(ET)
        # 30 minutes before the early close, same offset as the default.
        shifted = (
            datetime.combine(today, dt_time(close_et.hour, close_et.minute))
            - timedelta(minutes=30)
        ).time()
        return shifted
    except Exception:
        # If anything goes sideways in calendar lookup, fall back to the
        # hard-coded default rather than skipping the window entirely.
        logger.warning("Could not compute early-close window for %s; using default", today)
        return default


async def _run_window(
    window_name: str,
    strategies: list[str],
    state: dict,
    cache_set,
) -> None:
    """Run a subset of strategies for a given time window."""
    today = datetime.now(ET).strftime("%Y-%m-%d")
    state_key = f"last_{window_name}"

    if state.get(state_key) == today:
        return  # Already ran today

    logger.info(
        "=== %s window === Running: %s",
        window_name.upper(), ", ".join(strategies),
    )
    state[state_key] = today
    await cache_set("pipeline:scheduler_state", state, ttl_seconds=172800)

    try:
        result = await run_daily_pipeline(only_strategies=strategies)
        approved = result.get("approved", [])
        rejected = result.get("rejected", [])
        logger.info(
            "%s window complete: %d approved, %d rejected",
            window_name, len(approved), len(rejected),
        )
    except Exception as e:
        logger.exception("%s window failed: %s", window_name, e)


async def _scheduler_loop() -> None:
    """Multi-window scheduler loop — checks every 30s for due windows."""
    global _should_stop

    logger.info(
        "Pipeline scheduler started (multi-window mode)\n"
        "  6:00 AM  — Pre-market: PEAD, Regime\n"
        "  9:35 AM  — Open: PEAD T+1 executions\n"
        " 10:05 AM  — Post-OR: ORB, VWAP\n"
        " 12:00 PM  — Midday: Pairs, KAMA\n"
        "  3:30 PM  — Close: RSI-2 (MOC), Mean Rev, VRP, Earnings Vol\n"
        "  3:55 PM  — Monthly: TS Momentum, Dual Momentum, MQ\n"
        "  3:30 PM  — Weekly (Fri): Regime realloc, Pairs refresh"
    )

    from core.redis import cache_get, cache_set

    state = await cache_get("pipeline:scheduler_state") or {}

    while not _should_stop:
        try:
            if not _is_weekday():
                await asyncio.sleep(60)
                continue

            # ── Pre-market (6:00 AM) ──
            if _in_window(WINDOWS["premarket"]):
                await _run_window("premarket", PREMARKET_STRATEGIES, state, cache_set)

            # ── Market open (9:35 AM) ──
            if _in_window(WINDOWS["open"]):
                await _run_window("open", OPEN_STRATEGIES, state, cache_set)

            # ── Post-opening range (10:05 AM) ──
            if _in_window(WINDOWS["post_or"]):
                await _run_window("post_or", POST_OR_STRATEGIES, state, cache_set)

            # ── Midday (12:00 PM) ──
            if _in_window(WINDOWS["midday"]):
                await _run_window("midday", MIDDAY_STRATEGIES, state, cache_set)

            # ── Close window (3:30 PM regular / 12:30 PM on half-days) ──
            close_target = _close_window_target(datetime.now(ET).date())
            if _in_window(close_target):
                await _run_window("close", CLOSE_STRATEGIES, state, cache_set)

                # Also run position check (stops/targets) for all strategies
                today = datetime.now(ET).strftime("%Y-%m-%d")
                if state.get("last_position_check") != today:
                    state["last_position_check"] = today
                    await cache_set("pipeline:scheduler_state", state, ttl_seconds=172800)
                    try:
                        await run_position_check()
                    except Exception as e:
                        logger.exception("Position check failed: %s", e)

                # Weekly (Friday): regime + pairs refresh
                if _is_friday():
                    await _run_window("weekly", WEEKLY_STRATEGIES, state, cache_set)

            # ── Monthly rebalance (3:55 PM, last trading day) ──
            if _in_window(WINDOWS["monthly"]) and _is_last_trading_day():
                await _run_window("monthly", MONTHLY_STRATEGIES, state, cache_set)

            await asyncio.sleep(30)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.exception("Scheduler loop error: %s", e)
            await asyncio.sleep(60)

    logger.info("Pipeline scheduler stopped")


async def start_pipeline_scheduler() -> None:
    """Start the daily pipeline scheduler + ledger sync as background tasks."""
    global _scheduler_task, _ledger_sync_task, _should_stop
    _should_stop = False
    _scheduler_task = asyncio.create_task(_scheduler_loop())
    _ledger_sync_task = asyncio.create_task(_ledger_sync_loop())
    logger.info("Pipeline scheduler + ledger sync background tasks created")


async def stop_pipeline_scheduler() -> None:
    """Stop the scheduler + ledger sync gracefully."""
    global _should_stop, _scheduler_task, _ledger_sync_task
    _should_stop = True
    for label, task_ref in (("scheduler", "_scheduler_task"), ("ledger_sync", "_ledger_sync_task")):
        task = globals().get(task_ref)
        if task:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            globals()[task_ref] = None
    logger.info("Pipeline scheduler + ledger sync stopped")
