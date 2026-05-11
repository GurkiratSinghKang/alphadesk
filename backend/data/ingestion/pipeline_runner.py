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
from datetime import datetime, date, time as dt_time, timedelta, timezone
from zoneinfo import ZoneInfo

from data.calendar import USMarketCalendar
from data.ingestion.daily_pipeline import (
    run_daily_pipeline,
    run_earnings_prewarm,
    run_exit_monitor,
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

# OE-3 (combo-exit hardening, 2026-05-05): exit-monitor cadence — separate
# from the strategy/window scheduler so combo stops are checked far more
# often than the daily pipeline runs. The 60-second tick during regular
# market hours is the tightest cadence Alpaca's rate limits comfortably
# accommodate (the per-tick work is only the open-trade loop, no chain
# scan or strategy run). Extended-hours quotes are sparse, so the monitor
# slows to 5-minute ticks pre/post; overnight (00:00-04:00 ET) it skips
# entirely because there's no live OPRA data and the only actionable
# events would be next-day-open orders which the daily pipeline picks up.
EXIT_MONITOR_RTH_INTERVAL_SEC = 60
EXIT_MONITOR_EXT_INTERVAL_SEC = 300
# OE-4: alert when no exit-monitor heartbeat has landed within this many
# seconds during market hours. The scheduler tick is 60 s, so 5 min of
# silence is the smallest threshold that's not flappy under transient
# DB blips. Above this, an ERROR is logged (alerts will hook in once
# OPEN-2 lands per the audit plan).
EXIT_MONITOR_STALE_AFTER_SEC = 300

ET = ZoneInfo("America/New_York")

# ─── Strategy Groups by Optimal Run Time ────────────────────

# Pre-market analysis (6:00 AM) — scan overnight events
PREMARKET_STRATEGIES = ["pead", "regime_adaptive", "dividend_capture"]

# ─── Wave 6α Fix 7 (persona-124 P1): 09:30 MOO window for PEAD ───
# Bernard & Thomas (1989) specifies PEAD T+1 entries at the OPEN price,
# which in a US-equity market means an MOO order filled at the official
# opening auction. Alpaca accepts MOO orders submitted up to 09:28 ET;
# the order then executes in the 09:30:00 opening cross.
#
# The old ``open`` window fired at 09:35 ET — five minutes into the
# session. PEAD MOO orders submitted at that time are REJECTED by the
# exchange (OPEN state already cleared) and would typically get rewritten
# to plain market orders, which fill at the *current* quote, not the
# opening print. The result: every PEAD entry slipped by a few tens of
# basis points, which systematically blunts the edge the academic paper
# depends on.
#
# Split the windows:
#   - ``open`` (09:30): PEAD fires here — so the scheduler has submitted
#     the MOO by ~09:30:00, well under Alpaca's 09:28 cutoff when the
#     window hits (the scheduler polls every 30 s, so the first tick
#     after 09:28 catches it; PEAD pre-computes in the 06:00 premarket
#     window, so the only action at 09:30 is fire the MOO).
#   - ``open_plus_5m`` (09:35): reserved for strategies that *want* to
#     wait until the first 5 minutes of price action have cleared (e.g.
#     news-reactive ORB-lite strategies added in future waves). Empty
#     for now to preserve existing behaviour.
OPEN_STRATEGIES = ["pead"]
# Plan C.3: gap-fill fires at 09:35 ET (open + 5min) per its spec —
# the 5-minute settle gives the opening auction time to clear so the
# 09:30 open used as today_open isn't an auction artefact.
OPEN_PLUS_5M_STRATEGIES: list[str] = ["gap_fill"]

# Post-opening range (10:05 AM) — intraday breakout strategies
POST_OR_STRATEGIES = ["orb", "vwap"]

# Midday (12:00 PM) — market-neutral and squeeze strategies
MIDDAY_STRATEGIES = ["pairs_trading", "kama_breakout"]

# Close window (3:30 PM) — MOC entry strategies + VRP scan
# Plan C.4: removed `mean_reversion` from this list — its real scheduling
# is weekly (Friday 3:30 PM), per its spec; it now lives in WEEKLY_STRATEGIES.
CLOSE_STRATEGIES = [
    "rsi2_reversal",    # Connors: enter at close
    "vrp_harvest",      # IV surface established by 3 PM
    "earnings_vol",     # T-1 entries for upcoming earnings
]

# Monthly (last trading day, 3:55 PM) — rebalance strategies
MONTHLY_STRATEGIES = [
    "ts_momentum",      # Sign-of-12M ETF momentum rebalance
    "dual_momentum",    # Antonacci GEM monthly sleeve rotation
    "momentum_quality", # Cross-sectional momentum rebalance
    "sector_rotation",  # 11-GICS-sector top-N rotation with bond fallback (Plan C.5)
]

# Weekly (Friday 3:30 PM) — regime + cointegration + slow mean-reversion
WEEKLY_STRATEGIES = [
    "regime_adaptive",
    "pairs_trading",
    "mean_reversion",  # Slow / quality-conditioned reversal book (Plan C.4)
    "vcp_breakout",    # Minervini VCP breakout — paper-only (Plan C.6)
]

# ─── Schedule Windows ───────────────────────────────────────

WINDOWS = {
    "premarket":     dt_time(6, 0),
    # Batch R: 07:00 ET earnings pre-warm. Runs after FMP's overnight
    # calendar refresh has settled (~06:30 ET) and before users start
    # opening the dashboard at the bell. Fans out chain + IV + Claude
    # thesis prompts for every top-50 reporter today/tomorrow so the
    # earnings-options-play cards render <500 ms instead of paying the
    # ~30 s cold-cache cost on first hit (see
    # ``services.earnings_prewarm`` for the full rationale and per-stage
    # cost ceiling).
    "earnings_prewarm": dt_time(7, 0),
    # Wave 6α Fix 7: 09:30 is the true open; MOO strategies fire here so
    # the submission lands before Alpaca's 09:28 ET cutoff. The
    # ``_in_window`` helper already has a 5-minute tolerance, so the
    # scheduler's 30 s poll reliably hits this window.
    "open":          dt_time(9, 30),
    "open_plus_5m":  dt_time(9, 35),
    "post_or":       dt_time(10, 5),
    "midday":        dt_time(12, 0),
    "close":         dt_time(15, 30),
    "monthly":       dt_time(15, 55),
}

_scheduler_task: asyncio.Task | None = None
_ledger_sync_task: asyncio.Task | None = None
# OE-3: separate task so the exit monitor's 60 s cadence does not block
# the main scheduler loop and does not get rolled in with the 5 min
# ledger-sync cadence.
_exit_monitor_task: asyncio.Task | None = None
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


def _is_extended_hours() -> bool:
    """Pre-market (04:00-09:30 ET) or post-market (16:00-20:00 ET).

    The monitor uses this to slow its tick from 60 s to 5 min — OPRA data
    is much sparser outside RTH and the additional 60 s cycles would only
    burn rate-limit headroom. Holiday-aware (returns False for non-trading
    days, including half-day post-close periods).
    """
    now = datetime.now(ET)
    today = now.date()
    if not _CAL.is_trading_day(today):
        return False
    pre_start = dt_time(4, 0)
    pre_end = dt_time(9, 30)
    post_start = dt_time(16, 0)
    post_end = dt_time(20, 0)
    t = now.time()
    if pre_start <= t < pre_end:
        return True
    if post_start <= t < post_end:
        return True
    return False


def _is_overnight_quiet() -> bool:
    """00:00-04:00 ET — no OPRA quotes, no point ticking."""
    now = datetime.now(ET)
    return dt_time(0, 0) <= now.time() < dt_time(4, 0)


async def _check_exit_monitor_heartbeat() -> None:
    """OE-4 fail-safe: warn when ``exit_monitor:last_run`` is stale.

    The exit checker stamps a Redis key on every successful tick. If the
    most recent timestamp is older than ``EXIT_MONITOR_STALE_AFTER_SEC``
    during market hours, log ERROR. Once OPEN-2 (alerting infra) lands,
    the same callsite will route to PagerDuty / Slack / email — leaving
    the log line in place keeps the heartbeat visible in stdout / Sentry
    in the meantime.

    Skips silently outside market hours since the monitor itself is
    paused overnight and slower in extended hours; a "stale" heartbeat
    at 03:00 ET is correct behaviour, not a bug.
    """
    if not _is_market_hours():
        return
    try:
        from core.redis import cache_get
    except Exception:
        return
    payload = await cache_get("exit_monitor:last_run")
    if not payload:
        logger.error(
            "exit_monitor heartbeat: no last_run stamp in Redis — "
            "monitor may have never started this session",
        )
        return
    ts_str = payload.get("ts") if isinstance(payload, dict) else None
    if not ts_str:
        return
    try:
        last = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00"))
    except ValueError:
        logger.warning("exit_monitor heartbeat: cannot parse ts=%s", ts_str)
        return
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    age_sec = (datetime.now(timezone.utc) - last).total_seconds()
    if age_sec > EXIT_MONITOR_STALE_AFTER_SEC:
        logger.error(
            "exit_monitor heartbeat: STALE — last run %.0f s ago "
            "(threshold %d s); combo stops may not be enforcing",
            age_sec, EXIT_MONITOR_STALE_AFTER_SEC,
        )


async def _exit_monitor_loop() -> None:
    """OE-3 (combo-exit hardening): high-frequency stop-enforcement loop.

    Runs every ``EXIT_MONITOR_RTH_INTERVAL_SEC`` (60 s) during regular
    market hours, every ``EXIT_MONITOR_EXT_INTERVAL_SEC`` (300 s) during
    pre/post-market, and skips overnight. ``run_exit_monitor`` performs
    the actual ``_check_exits`` call; this loop is responsible only for
    cadence and heartbeat health.

    Dies-loud: any unexpected exception is logged at ERROR with traceback
    so a missing-stop-enforcement bug surfaces in oncall before traders
    see it. Cancellation during graceful shutdown is silent.
    """
    global _should_stop
    logger.info(
        "Exit monitor loop started (RTH=%ds, EXT=%ds, overnight=skip; "
        "heartbeat staleness threshold=%ds)",
        EXIT_MONITOR_RTH_INTERVAL_SEC,
        EXIT_MONITOR_EXT_INTERVAL_SEC,
        EXIT_MONITOR_STALE_AFTER_SEC,
    )
    while not _should_stop:
        interval = EXIT_MONITOR_RTH_INTERVAL_SEC  # default tick when in doubt
        try:
            if _is_overnight_quiet():
                interval = EXIT_MONITOR_EXT_INTERVAL_SEC
            elif _is_market_hours():
                await run_exit_monitor()
                # Heartbeat sanity check (logs ERROR if stale).
                await _check_exit_monitor_heartbeat()
                interval = EXIT_MONITOR_RTH_INTERVAL_SEC
            elif _is_extended_hours():
                await run_exit_monitor()
                interval = EXIT_MONITOR_EXT_INTERVAL_SEC
            else:
                # Off-hours, off-trading-day. Long sleep with frequent
                # cancellation checks.
                interval = EXIT_MONITOR_EXT_INTERVAL_SEC
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Exit monitor loop error")
            interval = EXIT_MONITOR_RTH_INTERVAL_SEC
        # Sleep in small chunks so stop_pipeline_scheduler returns quickly.
        slept = 0
        while slept < interval and not _should_stop:
            try:
                await asyncio.sleep(min(15, interval - slept))
            except asyncio.CancelledError:
                break
            slept += 15
    logger.info("Exit monitor loop stopped")


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
    if end_hour >= 24:
        end_time = dt_time(23, 59)
    else:
        end_time = dt_time(end_hour, end_minute % 60)
    return target <= now <= end_time


# Minutes-before-close offsets for each window-that-anchors-to-the-bell.
# These are the REGULAR-day offsets relative to a 16:00 ET close:
#   close:   15:30 -> 30 min before close
#   weekly:  15:30 -> 30 min before close
#   monthly: 15:55 ->  5 min before close
# Wave 4R fix: on half-days the market closes at 13:00 ET so the hard-coded
# WINDOWS["monthly"]=15:55 fires against a market that already closed two
# hours earlier — Alpaca rejects the MOC orders. Instead, every bell-anchored
# window derives its target from the day's actual close time.
_WINDOW_CLOSE_OFFSETS_MIN: dict[str, int] = {
    "close": 30,
    "weekly": 30,
    "monthly": 5,
}


def _close_window_target(today: date, window_name: str = "close") -> dt_time:
    """Return the ET time to fire a bell-anchored window on ``today``.

    Delegates to :func:`data.calendar.market_close` so half-days / early
    closes are respected without maintaining a duplicate holiday table here.
    For ``window_name="close"`` the window fires 30 minutes before the
    actual close (12:30 ET on a half-day, 15:30 ET on a regular day).
    For ``"monthly"`` it fires 5 minutes before — 12:55 ET / 15:55 ET.
    For ``"weekly"`` it mirrors ``close``.

    If ``today`` is not a trading day or the calendar lookup fails, falls
    back to the static ``WINDOWS`` entry so the scheduler still has a
    defined target (the outer loop already guards on ``_is_trading_day``,
    so falling back is belt-and-braces).
    """
    default = WINDOWS.get(window_name, WINDOWS["close"])
    try:
        if not _CAL.is_trading_day(today):
            return default
        from data.calendar import market_close as _market_close

        close_utc = _market_close(today)
        close_et = close_utc.astimezone(ET)
        offset = _WINDOW_CLOSE_OFFSETS_MIN.get(window_name, 30)
        shifted = (
            datetime.combine(today, dt_time(close_et.hour, close_et.minute))
            - timedelta(minutes=offset)
        ).time()
        return shifted
    except Exception:
        # If anything goes sideways in calendar lookup, fall back to the
        # hard-coded default rather than skipping the window entirely.
        logger.warning(
            "Could not compute %s window target for %s; using default",
            window_name, today,
        )
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
    in_progress_key = f"{state_key}_in_progress"

    if state.get(state_key) == today or state.get(in_progress_key) == today:
        return  # Already ran or is currently running today

    logger.info(
        "=== %s window === Running: %s",
        window_name.upper(), ", ".join(strategies),
    )
    state[in_progress_key] = today
    await cache_set("pipeline:scheduler_state", state, ttl_seconds=172800)

    try:
        # TODO(Audit MB-P0-1): the multi-window scheduler is process-wide
        # (no requesting user) so it falls back to env credentials. Multi-
        # user deployments need either a per-user scheduler row or a
        # designated service account. ``run_daily_pipeline`` will log a
        # deprecation warning when ``username`` is omitted.
        result = await run_daily_pipeline(only_strategies=strategies)
        approved = result.get("approved", [])
        rejected = result.get("rejected", [])
        logger.info(
            "%s window complete: %d approved, %d rejected",
            window_name, len(approved), len(rejected),
        )
        if result.get("skipped"):
            state[f"{state_key}_skipped_at"] = datetime.now(timezone.utc).isoformat()
            state[f"{state_key}_skipped_reason"] = result.get("reason", "skipped")
            if result.get("no_retry"):
                state[state_key] = today
                logger.warning(
                    "%s window skipped permanently for today; marking %s "
                    "complete: %s",
                    window_name, state_key,
                    state.get(f"{state_key}_skipped_reason"),
                )
            else:
                logger.warning(
                    "%s window skipped; leaving %s unset so scheduler can retry later today: %s",
                    window_name, state_key, state.get(f"{state_key}_skipped_reason"),
                )
        else:
            state[state_key] = today
            state.pop(f"{state_key}_skipped_reason", None)
        state.pop(in_progress_key, None)
        await cache_set("pipeline:scheduler_state", state, ttl_seconds=172800)
    except Exception:
        logger.exception("%s window failed", window_name)
        state.pop(in_progress_key, None)
        state[f"{state_key}_failed_at"] = datetime.now(timezone.utc).isoformat()
        await cache_set("pipeline:scheduler_state", state, ttl_seconds=172800)


async def _run_earnings_prewarm_window(state: dict, cache_set) -> None:
    """Run the earnings pre-warm at most once per trading day.

    Mirrors :func:`_run_window`'s state contract so a duplicate scheduler
    tick (the loop polls every 30 s, the prewarm window is 5 min wide) does
    not re-spawn the prewarm. Failures don't mark ``last_earnings_prewarm``
    complete, so a later tick the same day will retry.
    """
    today = datetime.now(ET).strftime("%Y-%m-%d")
    state_key = "last_earnings_prewarm"
    in_progress_key = f"{state_key}_in_progress"

    if state.get(state_key) == today or state.get(in_progress_key) == today:
        return

    logger.info("=== EARNINGS_PREWARM window === Pre-warming top-50 reporters")
    state[in_progress_key] = today
    await cache_set("pipeline:scheduler_state", state, ttl_seconds=172800)

    try:
        result = await run_earnings_prewarm()
        if isinstance(result, dict) and result.get("error"):
            # Surface the failure but do not mark complete — the next
            # scheduler tick (or a manual /pipeline/prewarm) can retry.
            state.pop(in_progress_key, None)
            state[f"{state_key}_failed_at"] = datetime.now(timezone.utc).isoformat()
            state[f"{state_key}_error"] = result["error"]
            await cache_set("pipeline:scheduler_state", state, ttl_seconds=172800)
            logger.warning(
                "Earnings prewarm failed: %s", result["error"],
            )
            return
        logger.info(
            "Earnings prewarm complete: %d/%d symbols, %d Claude calls, ~$%.2f",
            len(result.get("symbols_succeeded", [])),
            len(result.get("symbols_attempted", [])),
            result.get("claude_calls", 0),
            result.get("estimated_cost_usd", 0.0),
        )
        state[state_key] = today
        state.pop(in_progress_key, None)
        state.pop(f"{state_key}_error", None)
        await cache_set("pipeline:scheduler_state", state, ttl_seconds=172800)
    except Exception:
        logger.exception("Earnings prewarm window failed")
        state.pop(in_progress_key, None)
        state[f"{state_key}_failed_at"] = datetime.now(timezone.utc).isoformat()
        await cache_set("pipeline:scheduler_state", state, ttl_seconds=172800)


async def _scheduler_loop() -> None:
    """Multi-window scheduler loop — checks every 30s for due windows."""
    global _should_stop

    logger.info(
        "Pipeline scheduler started (multi-window mode)\n"
        "  6:00 AM  — Pre-market: PEAD, Regime\n"
        "  7:00 AM  — Earnings pre-warm: chain/IV/Claude for top-50 reporters (Batch R)\n"
        "  9:30 AM  — Open: PEAD T+1 MOO executions (Wave 6α Fix 7)\n"
        "  9:35 AM  — Open +5m: (reserved — currently empty)\n"
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

            # ── Earnings pre-warm (7:00 AM, Batch R) ──
            # Decoupled from the strategy windows: this fires once per
            # trading day, populates chain + IV + historical-reactions +
            # Claude thesis caches for every top-50 ticker reporting today
            # or tomorrow, so the first user to land on the earnings page
            # gets <500 ms instead of paying ~30 s for a cold Opus call.
            if _in_window(WINDOWS["earnings_prewarm"]):
                await _run_earnings_prewarm_window(state, cache_set)

            # ── Market open (9:30 AM) — MOO strategies fire here so the
            #    submission lands before Alpaca's 09:28 ET cutoff (Wave 6α
            #    Fix 7). Previously this window was 09:35, causing PEAD's
            #    T+1 MOO orders to miss the opening cross by five minutes
            #    and slip into regular market orders five minutes into the
            #    session.
            if _in_window(WINDOWS["open"]):
                await _run_window("open", OPEN_STRATEGIES, state, cache_set)

            # ── Open +5m (9:35 AM) — reserved for strategies that want
            #    the first 5 minutes of price action to have cleared.
            #    OPEN_PLUS_5M_STRATEGIES is currently empty but the window
            #    is wired so future strategies can opt in without another
            #    scheduler edit.
            if OPEN_PLUS_5M_STRATEGIES and _in_window(WINDOWS["open_plus_5m"]):
                await _run_window(
                    "open_plus_5m", OPEN_PLUS_5M_STRATEGIES, state, cache_set,
                )

            # ── Post-opening range (10:05 AM) ──
            if _in_window(WINDOWS["post_or"]):
                await _run_window("post_or", POST_OR_STRATEGIES, state, cache_set)

            # ── Midday (12:00 PM) ──
            if _in_window(WINDOWS["midday"]):
                await _run_window("midday", MIDDAY_STRATEGIES, state, cache_set)

            # ── Close window (3:30 PM regular / 12:30 PM on half-days) ──
            today_et = datetime.now(ET).date()
            close_target = _close_window_target(today_et, "close")
            if _in_window(close_target):
                await _run_window("close", CLOSE_STRATEGIES, state, cache_set)

                # Also run position check (stops/targets) for all strategies
                today = datetime.now(ET).strftime("%Y-%m-%d")
                if state.get("last_position_check") != today:
                    state["last_position_check"] = today
                    await cache_set("pipeline:scheduler_state", state, ttl_seconds=172800)
                    try:
                        await run_position_check()
                    except Exception:
                        logger.exception("Position check failed")

                # Weekly (Friday): regime + pairs refresh — same bell-anchored
                # offset as ``close``, so it picks up the half-day shift too.
                if _is_friday():
                    weekly_target = _close_window_target(today_et, "weekly")
                    # ``weekly`` currently shares the close window's offset, so
                    # _in_window(close_target) already covered it; keep the
                    # explicit check for clarity and so the two offsets can
                    # diverge without subtle breakage.
                    if _in_window(weekly_target):
                        await _run_window("weekly", WEEKLY_STRATEGIES, state, cache_set)

            # ── Monthly rebalance (last trading day) ──
            # 5 min before the bell — 15:55 ET regular, 12:55 ET half-day.
            # Wave 4R: previously fired at WINDOWS["monthly"]=15:55 regardless
            # of early close, against a market that closed at 13:00 ET.
            monthly_target = _close_window_target(today_et, "monthly")
            if _in_window(monthly_target) and _is_last_trading_day():
                await _run_window("monthly", MONTHLY_STRATEGIES, state, cache_set)

            await asyncio.sleep(30)

        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Scheduler loop error")
            await asyncio.sleep(60)

    logger.info("Pipeline scheduler stopped")


_LEADER_LOCK_KEY = "alphadesk:scheduler:leader"
_LEADER_LOCK_TTL_SECONDS = 60
_LEADER_LOCK_REFRESH_SECONDS = 20
_LEADER_TOKEN: str | None = None
_leader_heartbeat_task: asyncio.Task | None = None


async def _acquire_scheduler_leadership() -> bool:
    """Try to claim the singleton scheduler-leader lock in Redis.

    BUG-091 (audit 2026-05-11): the Dockerfile pins ``-w 1`` because
    every worker's lifespan would otherwise spawn its own scheduler /
    ledger-sync / exit-monitor tasks, producing duplicate orders.
    Adding a Redis-backed leader lock lets exactly one worker run the
    schedulers; siblings detect a held lock and skip startup, so
    multi-worker scaling becomes safe.

    Returns True if this worker is the new leader (lock acquired),
    False otherwise. Failures on Redis access return False (fail-safe:
    don't run scheduler when state is unclear; another worker that
    can reach Redis will pick up).
    """
    global _LEADER_TOKEN

    import uuid as _uuid

    try:
        from core.redis import get_redis

        redis = await get_redis()
        if redis is None:
            # No Redis = single-worker mode is the only safe mode.
            # Return True so the scheduler starts. Operators running
            # multi-worker without Redis would deadlock here, which is
            # the right failure mode (they MUST have shared state).
            logger.warning(
                "scheduler leader-election: Redis unavailable, falling back to "
                "single-worker assumption (start scheduler unconditionally)"
            )
            return True
        token = _uuid.uuid4().hex
        # SET key value NX EX ttl → only succeeds if the key doesn't exist.
        # Returns True/None depending on driver; treat anything truthy as ok.
        result = await redis.set(_LEADER_LOCK_KEY, token, ex=_LEADER_LOCK_TTL_SECONDS, nx=True)
        if result:
            _LEADER_TOKEN = token
            logger.info(
                "scheduler leader-election: acquired lock token=%s ttl=%ss",
                token, _LEADER_LOCK_TTL_SECONDS,
            )
            return True
        logger.info(
            "scheduler leader-election: another worker holds the lock; "
            "skipping scheduler start on this worker",
        )
        return False
    except Exception:
        logger.warning(
            "scheduler leader-election: Redis probe raised; assuming "
            "single-worker mode and starting scheduler",
            exc_info=True,
        )
        return True


async def _leader_heartbeat_loop() -> None:
    """Refresh the leader lock periodically so it doesn't expire mid-run.

    Lua-style compare-and-set isn't strictly necessary here: only the
    holder of `_LEADER_TOKEN` is in this process, and we re-set with
    the same token so a sibling that somehow stole the lock would be
    over-written back to us. The TTL refresh is the important bit.
    """
    while True:
        await asyncio.sleep(_LEADER_LOCK_REFRESH_SECONDS)
        if _LEADER_TOKEN is None:
            return
        try:
            from core.redis import get_redis

            redis = await get_redis()
            if redis is None:
                return
            # Refresh TTL without changing the token.
            await redis.set(_LEADER_LOCK_KEY, _LEADER_TOKEN, ex=_LEADER_LOCK_TTL_SECONDS)
        except Exception:
            logger.warning(
                "scheduler leader-election: heartbeat refresh raised", exc_info=True,
            )


async def _release_scheduler_leadership() -> None:
    """Drop the leader lock on graceful shutdown so the next deploy's
    workers can immediately claim it (don't wait for the TTL)."""
    global _LEADER_TOKEN
    if _LEADER_TOKEN is None:
        return
    try:
        from core.redis import get_redis

        redis = await get_redis()
        if redis is not None:
            # Only delete if we still hold the token (best-effort
            # CAS via GETDEL semantic — Redis 6.2+. Fall back to
            # bare DEL on older versions).
            current = await redis.get(_LEADER_LOCK_KEY)
            if current == _LEADER_TOKEN or current == _LEADER_TOKEN.encode():
                await redis.delete(_LEADER_LOCK_KEY)
                logger.info("scheduler leader-election: released lock on shutdown")
    except Exception:
        logger.warning(
            "scheduler leader-election: release on shutdown raised",
            exc_info=True,
        )
    _LEADER_TOKEN = None


async def start_pipeline_scheduler() -> None:
    """Start the daily pipeline scheduler + ledger sync as background tasks.

    Round-11 / BB-13 (P0): both tasks now go through
    ``create_supervised_task`` so a silent death (e.g. unexpected
    ``BaseException``, future refactor that drops the inner ``except``)
    surfaces in the structured logs at ERROR — without it, the next
    cron tick simply doesn't fire and oncall finds out only when a
    user notices. Cancellation during graceful shutdown remains
    silent (logged at INFO).

    BUG-091 (audit 2026-05-11): wraps the task launch in a Redis-backed
    leader lock so multi-worker deployments don't race to spawn
    duplicate schedulers. The Dockerfile's ``-w 1`` is the today
    posture; this lock makes ``-w N`` safe going forward. Only the
    worker that wins the lock runs the schedulers; others log "not
    leader" and skip. Heartbeat refreshes the TTL every 20 s; lock
    TTL is 60 s, so a leader can die for up to ~40 s before a sibling
    picks up.
    """
    from core.supervised_task import create_supervised_task

    global _scheduler_task, _ledger_sync_task, _exit_monitor_task, _should_stop
    global _leader_heartbeat_task
    _should_stop = False

    is_leader = await _acquire_scheduler_leadership()
    if not is_leader:
        logger.info(
            "Pipeline scheduler: not leader; skipping background-task start. "
            "Lock holder will run the daily/ledger/exit loops; this worker "
            "serves API requests only."
        )
        return

    _scheduler_task = create_supervised_task(
        _scheduler_loop(), name="pipeline_scheduler"
    )
    _ledger_sync_task = create_supervised_task(
        _ledger_sync_loop(), name="pipeline_ledger_sync"
    )
    # OE-3: high-frequency exit checker for combo stops. Independent
    # task so a slow chain fetch on one combo doesn't pause the
    # strategy scheduler or the ledger reconciler.
    _exit_monitor_task = create_supervised_task(
        _exit_monitor_loop(), name="pipeline_exit_monitor"
    )
    # Heartbeat keeps the lock alive while we own it.
    _leader_heartbeat_task = create_supervised_task(
        _leader_heartbeat_loop(), name="scheduler_leader_heartbeat"
    )
    logger.info(
        "Pipeline scheduler + ledger sync + exit monitor background tasks created (leader)"
    )


async def stop_pipeline_scheduler() -> None:
    """Stop the scheduler + ledger sync + exit monitor gracefully."""
    global _should_stop, _scheduler_task, _ledger_sync_task, _exit_monitor_task
    global _leader_heartbeat_task
    _should_stop = True
    for label, task_ref in (
        ("scheduler", "_scheduler_task"),
        ("ledger_sync", "_ledger_sync_task"),
        ("exit_monitor", "_exit_monitor_task"),
        # BUG-091: also cancel the leader-heartbeat task before releasing
        # the lock so it stops re-asserting the TTL during shutdown.
        ("leader_heartbeat", "_leader_heartbeat_task"),
    ):
        task = globals().get(task_ref)
        if task:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            globals()[task_ref] = None
    # Release the Redis leader lock so the next deploy's workers can
    # take over immediately rather than waiting for the 60 s TTL.
    await _release_scheduler_leadership()
    logger.info("Pipeline scheduler + ledger sync + exit monitor stopped")
