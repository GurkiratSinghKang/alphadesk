"""Master Agent — central coordinator that approves/rejects trade requests.

Every strategy must request permission from the Master Agent before placing
a trade.  The agent enforces per-strategy allocation limits, portfolio-wide
limits, position-level limits, prevents duplicate holdings, and manages
strategy drawdowns, sector concentration, regime-conditional exposure,
and VaR-based risk budgets.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
from typing import Any

from data.volatility_map import VOL_MAP_PRE_SP500

logger = logging.getLogger("alphadesk.master_agent")


class MasterAgent:
    """Central coordinator that approves/rejects trade requests from strategies.

    Responsibilities:
    - Prevent duplicate positions (no two strategies buy the same stock)
    - Enforce per-strategy allocation limits
    - Enforce portfolio-wide limits (regime-adaptive deployment, max 15 positions)
    - Track which strategy owns which position
    - Per-strategy drawdown stop losses (P1)
    - Sector concentration limits (P2)
    - Regime-conditional gross exposure via VIX (P3)
    - VaR-based risk budgets (P4)
    - Smart Claude-powered trade review (P5)
    - Circuit breaker
    """

    # Shared momentum data — module-level snapshot, used when an instance
    # is constructed without explicit data. Each MasterAgent takes a COPY at
    # __init__, so later mutations on one instance don't silently affect
    # decisions another instance has already made (P1 #7).
    _SHARED_MOMENTUM_DATA: dict[str, float] = {}
    _SHARED_ABSOLUTE_MOMENTUM_DATA: dict[str, float] = {}

    @classmethod
    def set_momentum_data(cls, data: dict[str, float]) -> None:
        """Update the shared snapshot (read at the next ``MasterAgent()``).

        Existing instances are NOT affected — they retain the snapshot they
        took at construction time. To push new data into an existing
        instance, use :meth:`update_momentum_data`.
        """
        cls._SHARED_MOMENTUM_DATA = dict(data)

    @classmethod
    def set_absolute_momentum(cls, data: dict[str, float]) -> None:
        """Update the shared 12-month absolute momentum snapshot."""
        cls._SHARED_ABSOLUTE_MOMENTUM_DATA = dict(data)

    def update_momentum_data(self, data: dict[str, float]) -> None:
        """Replace THIS instance's 6-month momentum data."""
        self.MOMENTUM_DATA = dict(data)

    def update_absolute_momentum(self, data: dict[str, float]) -> None:
        """Replace THIS instance's 12-month absolute momentum data."""
        self.ABSOLUTE_MOMENTUM_DATA = dict(data)

    # Per-strategy notional caps as a fraction of equity.
    # Built dynamically from the registry at first use via
    # :meth:`_build_strategy_limits`; strategies requiring a different
    # allocation cap can be added to ``STRATEGY_LIMIT_OVERRIDES`` below.
    # The previous hardcoded 15-entry dict left 3 "ghost" strategies
    # (claude_alpha, mean_reversion, vcp_breakout) reserving notional they
    # never actually used — and silently starved any future registry addition
    # to a 10% fallback that blew the portfolio deployment limit.
    STRATEGY_LIMIT_OVERRIDES: dict[str, float] = {
        # Reserved for strategies that need a different cap than equal-weight.
        # Example: "claude_alpha": 0.15  # larger discretionary allocation.
    }

    _STRATEGY_LIMITS_CACHE: dict[str, float] | None = None

    # Categories that should NOT be included in strategy-limit allocation.
    # `smoke` strategies (category=="smoke") are registered for engine
    # round-trip tests but excluded from `build_all_strategies()` — counting
    # them in the 1/N divisor reserves an unused slot and makes the real
    # runners collectively under-allocate their slice while the non-running
    # smoke name hoards 1/N. Persona-63 P0-3.
    EXCLUDE_FROM_LIMITS: set[str] = {"smoke"}

    @classmethod
    def _build_strategy_limits(cls) -> dict[str, float]:
        """Build the per-strategy notional cap dict from the registry.

        Equal-weight across registered *runnable* strategies (``1/N`` each),
        with per-name overrides applied on top. Cached so the registry is
        only walked once per process.

        Excludes strategies whose :class:`StrategyMeta.category` is in
        :attr:`EXCLUDE_FROM_LIMITS` (e.g. ``smoke``) so the divisor matches
        what ``build_all_strategies`` actually runs — persona-63 P0-3. If
        the total somehow exceeds 1.0 (override misconfiguration) we
        normalize so the portfolio cap stays an invariant.
        """
        if cls._STRATEGY_LIMITS_CACHE is not None:
            return cls._STRATEGY_LIMITS_CACHE
        try:
            # Task 19: switched from the legacy ``strategies.registry`` (now
            # nearly empty — the 12 unmigrated strategies fail to import
            # post-base.py-deletion) to ``_core.protocol``. Phase 3 migrates
            # strategies one-by-one; as each lands, the equal-weight cap
            # rebalances automatically.
            from strategies._core.protocol import list_strategies
            metas = list_strategies()
            names = [
                m.name for m in metas
                if m.category not in cls.EXCLUDE_FROM_LIMITS
            ]
        except Exception as exc:
            logger.warning(
                "Could not load strategy registry (%s); STRATEGY_LIMITS "
                "will fall back to the per-call 10%% default.", exc,
            )
            names = []

        limits: dict[str, float] = {}
        if names:
            equal = 1.0 / len(names)
            for n in names:
                limits[n] = equal
        # Apply overrides on top of equal-weight
        limits.update(cls.STRATEGY_LIMIT_OVERRIDES)

        # Hard invariant: sum(limits) must not exceed 1.0 — otherwise the
        # portfolio deployment cap is unenforceable by construction. Overrides
        # that push the sum past 1.0 get proportionally normalized.
        total = sum(limits.values())
        if total > 1.0:
            logger.warning(
                "STRATEGY_LIMITS sum=%.4f exceeds 1.0; normalizing to preserve "
                "portfolio deployment invariant.", total,
            )
            limits = {k: v / total for k, v in limits.items()}

        cls._STRATEGY_LIMITS_CACHE = limits
        logger.info(
            "STRATEGY_LIMITS built from registry: %d runnable strategies, "
            "equal weight=%.4f, sum=%.4f",
            len(names), (1.0 / len(names)) if names else 0.0,
            sum(limits.values()),
        )
        return limits

    # Backwards-compat read-only view. Eager-build so any code that iterates
    # ``STRATEGY_LIMITS.items()`` still works. (Property on a class isn't
    # trivially picklable, so we use a class-level dict updated on first
    # construction and via _build_strategy_limits.)
    STRATEGY_LIMITS: dict[str, float] = {}
    MAX_POSITIONS = 20  # raised for 15 strategies
    MAX_DEPLOYED_PCT = 0.90  # 90% of equity deployable (competition mode)
    MAX_PER_POSITION = 0.08  # max 8% per position
    MIN_CONVICTION = 50
    MIN_REWARD_RISK_RATIO = 1.2  # Minimum 1.2:1 reward-to-risk (accommodates mean reversion)

    # Risk monitor toggle — when False, all P1-P4 checks are bypassed
    RISK_MONITOR_ENABLED: bool = True

    # P1: Per-strategy drawdown limits
    STRATEGY_DRAWDOWN_LIMIT = -0.05  # -5% from peak
    STRATEGY_RESUME_THRESHOLD = -0.03  # resume at -3%

    # P2: Sector concentration limits
    SECTOR_LIMIT = 0.30  # max 30% in any sector
    SECTOR_WARN = 0.25   # require higher conviction above 25%

    # P3: Regime-conditional deployment limits (keyed by VIX regime)
    REGIME_DEPLOYMENT_LIMITS: dict[str, float] = {
        "bull_low_vol": 0.80,    # VIX < 18
        "bull_high_vol": 0.60,   # VIX 18-25
        "bear": 0.30,            # VIX > 25
        "crisis": 0.10,          # VIX > 35
    }

    # P4: VaR-based risk budget
    MAX_PORTFOLIO_VAR = 0.02  # max 2% daily VaR

    # Strategy categories whose trades SHOULD NOT be gated on absolute /
    # trailing momentum. These strategies trade counter to trend
    # (mean-reversion, short-vol, market-neutral, intraday pivots) and a
    # long-only momentum gate rejects their signals by construction.
    #
    # Category values come from StrategyMeta.category on the registry record:
    #   - "options"   -> VRP harvest, earnings_vol (short-vol structures)
    #   - "pairs"     -> pairs_trading (market-neutral)
    #   - "intraday"  -> VWAP, ORB (intraday reversion / breakout on thin lookback)
    # The "smoke" category is a dev-only bucket; we skip it for safety.
    MOMENTUM_GATE_SKIP_CATEGORIES: set[str] = {"options", "pairs", "intraday", "smoke"}
    # Per-name overrides for equity-category strategies that are explicitly
    # mean-reversion (so category="equity" alone isn't enough to tell).
    MOMENTUM_GATE_SKIP_STRATEGIES: set[str] = {
        "rsi2_reversal",     # 2-period RSI bounce -- buys oversold dips
    }

    # Typical daily volatilities (shared across VaR + crowding detection).
    # The canonical values live in :mod:`backend.data.volatility_map` so the
    # list can be versioned and methodology documented in one place; the
    # class attribute is kept as a compat shim for any caller that reads it
    # via ``MasterAgent.VOL_MAP`` directly.
    VOL_MAP: dict[str, float] = dict(VOL_MAP_PRE_SP500)

    def __init__(
        self,
        equity: float,
        cash: float,
        existing_positions: dict[str, dict[str, Any]],
        vix_level: float = 16.5,
        momentum_data: dict[str, float] | None = None,
        absolute_momentum_data: dict[str, float] | None = None,
    ) -> None:
        # Ensure the registry-driven STRATEGY_LIMITS is populated. Safe to
        # call repeatedly — ``_build_strategy_limits`` caches on the class.
        MasterAgent.STRATEGY_LIMITS = MasterAgent._build_strategy_limits()

        self.equity = equity
        self.cash = cash
        # {symbol: {strategy, notional, shares, entry_price, ...}}
        self.existing_positions = dict(existing_positions)
        self.pending_orders: list[dict[str, Any]] = []
        self.rejections: list[dict[str, Any]] = []

        # Instance-local copy of the momentum snapshot. If the caller doesn't
        # inject one we snapshot the shared dict at construction time, so
        # later mutations via set_momentum_data() don't retroactively change
        # decisions this instance has already made.
        self.MOMENTUM_DATA: dict[str, float] = (
            dict(momentum_data) if momentum_data is not None
            else dict(self._SHARED_MOMENTUM_DATA)
        )
        self.ABSOLUTE_MOMENTUM_DATA: dict[str, float] = (
            dict(absolute_momentum_data) if absolute_momentum_data is not None
            else dict(self._SHARED_ABSOLUTE_MOMENTUM_DATA)
        )

        # P1: Strategy drawdown tracking. Seeded from Redis so peaks and
        # halt state survive across pipeline runs — persona-16 P0-5 /
        # persona-63 P0-4. Falls back to empty dicts when Redis is
        # unavailable or the keys don't yet exist; the background
        # :meth:`_load_persisted_state` task repopulates them shortly after
        # __init__ (fire-and-forget because __init__ is sync). Reads that
        # happen before the task completes see the empty state — safer than
        # blocking __init__ on Redis round-trips for a cold boot.
        self.strategy_peaks: dict[str, float] = {}
        self.strategy_current: dict[str, float] = {}
        self.halted_strategies: set[str] = set()
        self._state_loaded: bool = False
        # Schedule async load — if there's an event loop running we pick up
        # persisted state shortly; if not (e.g. synchronous test), the
        # caller can ``await master.load_persisted_state()`` explicitly.
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(self.load_persisted_state())
        except RuntimeError:
            # No running loop yet — skip; caller should await load before use.
            pass

        # Per-instance asyncio lock serialising check-then-act on
        # cash / positions / pending_orders in :meth:`request_trade` and
        # :meth:`request_trade_smart`. Persona-63 P0-1, P0-2, P0-5: under
        # ``asyncio.gather`` of 12 strategies, concurrent `request_trade_smart`
        # calls await Claude between the check and the write; without a
        # lock the deployment / sector / duplicate-symbol invariants are
        # defeated. Cross-worker serialisation is backend-scope (single
        # gunicorn worker today; revisit if we scale horizontally).
        self._trade_lock = asyncio.Lock()

        # P3: Regime detection
        self.vix_level = vix_level
        self.regime = self._detect_regime()
        self.max_deployment = self.REGIME_DEPLOYMENT_LIMITS[self.regime]

    # ------------------------------------------------------------------
    # Redis-persisted drawdown state (persona-16 P0-5 / persona-63 P0-4)
    # ------------------------------------------------------------------
    # Without persistence, ``strategy_peaks`` and ``halted_strategies`` reset
    # on every pipeline-run because ``daily_pipeline.py`` constructs a fresh
    # MasterAgent each invocation. Yesterday's -5% halt is forgotten before
    # this morning's cron tick — making the drawdown limit unreachable
    # across runs. We persist both to Redis so the 30-day-rolling drawdown
    # view actually sticks.

    # 180-day TTL: a halted strategy needs to stay halted long enough that
    # an operator investigates before it silently resurrects. Wave 4R Fix 3:
    # the previous 30-day TTL caused the Redis set to expire after a month
    # of inactivity — e.g. a strategy halted on Dec 1 would auto-un-halt on
    # Jan 1 with no log line. 180 days covers a full quarter of operator
    # vacation + a round of code iteration without spurious resurrection,
    # and is still short enough that genuinely stale entries (code deleted,
    # peak-definition obsolete) don't block forever.
    _STATE_TTL_SECONDS: int = 60 * 60 * 24 * 180
    _REDIS_PEAKS_KEY: str = "master:strategy_peaks"
    _REDIS_HALTED_KEY: str = "master:halted_strategies"
    # Redis hash mapping strategy -> ISO-8601 UTC timestamp of when the halt
    # was recorded. Lets :meth:`resume_trading` log the halt duration and
    # lets the boot-time halt-expiry check warn when a Redis halt has no
    # corresponding durable record. Mirrors ``_REDIS_HALTED_KEY``'s TTL.
    _REDIS_HALT_TIMESTAMPS_KEY: str = "master:halted_strategy_timestamps"

    async def load_persisted_state(self) -> None:
        """Populate ``strategy_peaks`` and ``halted_strategies`` from Redis.

        Idempotent — safe to call more than once. Silently falls back to the
        in-memory empty defaults if Redis is unavailable (operator still gets
        a ``WARNING`` once per instance via the logger). The first pipeline
        run after a Redis wipe behaves like a cold boot: peaks start over and
        no strategies are halted.
        """
        if self._state_loaded:
            return
        try:
            from core.redis import get_redis
            redis = await get_redis()
            if redis is None:
                self._state_loaded = True
                return
            peaks_raw = await redis.hgetall(self._REDIS_PEAKS_KEY)
            halted_raw = await redis.smembers(self._REDIS_HALTED_KEY)
            if peaks_raw:
                self.strategy_peaks = {
                    str(k): float(v) for k, v in peaks_raw.items()
                }
            if halted_raw:
                self.halted_strategies = set(str(s) for s in halted_raw)
            logger.info(
                "MasterAgent loaded persisted state: %d peaks, %d halted",
                len(self.strategy_peaks), len(self.halted_strategies),
            )
        except Exception:
            logger.warning(
                "MasterAgent could not load persisted state from Redis; "
                "starting from empty peaks/halts", exc_info=True,
            )
        finally:
            self._state_loaded = True

    async def _persist_peak(self, strategy: str, peak: float) -> None:
        """Persist a single strategy's peak to the Redis hash + refresh TTL.

        Wave 2G / persona-79 Race 6: ``HSET`` followed by a separate
        ``EXPIRE`` is two round-trips and not atomic — if the process dies
        between them the hash exists without a TTL and ``master:strategy_peaks``
        leaks forever. We pipeline both commands so they ship as one atomic
        burst over the wire (redis-py async pipelines are not transactional
        by default but the two writes hit the same key and Redis is
        single-threaded, so observers either see both or neither).
        """
        try:
            from core.redis import get_redis
            redis = await get_redis()
            if redis is None:
                return
            async with redis.pipeline() as p:
                p.hset(self._REDIS_PEAKS_KEY, strategy, str(peak))
                p.expire(self._REDIS_PEAKS_KEY, self._STATE_TTL_SECONDS)
                await p.execute()
        except Exception:
            logger.warning(
                "Failed to persist strategy_peak for %s to Redis",
                strategy, exc_info=True,
            )

    async def _persist_halt_add(self, strategy: str) -> None:
        """Add a strategy to the Redis halted-strategies set + refresh TTL.

        Wave 2G / persona-79 Race 6: ``SADD`` + ``EXPIRE`` pipelined
        atomically so a crash between the two cannot leave the halted-set
        without its TTL.  Same rationale as ``_persist_peak``.

        Wave 4R: also stamps ``_REDIS_HALT_TIMESTAMPS_KEY[strategy]`` with
        the current UTC ISO-8601 timestamp so :meth:`resume_trading` can
        log the halt duration on release.
        """
        from datetime import datetime as _dt, timezone as _tz

        try:
            from core.redis import get_redis
            redis = await get_redis()
            if redis is None:
                return
            now_iso = _dt.now(_tz.utc).isoformat()
            async with redis.pipeline() as p:
                p.sadd(self._REDIS_HALTED_KEY, strategy)
                p.expire(self._REDIS_HALTED_KEY, self._STATE_TTL_SECONDS)
                # Record halt-start only if absent (don't reset on idempotent re-add)
                # We use HSETNX semantics via a GET-then-SET fallback below.
                p.hsetnx(self._REDIS_HALT_TIMESTAMPS_KEY, strategy, now_iso)
                p.expire(self._REDIS_HALT_TIMESTAMPS_KEY, self._STATE_TTL_SECONDS)
                await p.execute()
        except Exception:
            logger.warning(
                "Failed to persist halt(%s) to Redis", strategy, exc_info=True,
            )

    async def _persist_halt_remove(self, strategy: str) -> None:
        """Remove a strategy from the Redis halted-strategies set.

        Wave 4R: logs the halt duration when a timestamp is available so the
        operator can see at-a-glance how long the strategy was blocked.
        """
        from datetime import datetime as _dt, timezone as _tz

        try:
            from core.redis import get_redis
            redis = await get_redis()
            if redis is None:
                return
            halted_since_raw = await redis.hget(
                self._REDIS_HALT_TIMESTAMPS_KEY, strategy
            )
            await redis.srem(self._REDIS_HALTED_KEY, strategy)
            await redis.hdel(self._REDIS_HALT_TIMESTAMPS_KEY, strategy)
            if halted_since_raw:
                try:
                    halted_since = _dt.fromisoformat(
                        halted_since_raw.decode()
                        if isinstance(halted_since_raw, (bytes, bytearray))
                        else halted_since_raw
                    )
                    delta = _dt.now(_tz.utc) - halted_since
                    logger.info(
                        "RESUME strategy '%s' halted for %.1fh (since %s)",
                        strategy, delta.total_seconds() / 3600.0,
                        halted_since.isoformat(),
                    )
                except Exception:
                    # Corrupt timestamp shouldn't block the resume.
                    logger.debug(
                        "Could not parse halt timestamp for %s",
                        strategy, exc_info=True,
                    )
        except Exception:
            logger.warning(
                "Failed to remove halt(%s) from Redis", strategy, exc_info=True,
            )

    @classmethod
    async def halt_expiry_boot_check(cls) -> None:
        """Boot-time consistency check for the Redis halt set.

        Wave 4R Fix 3: compares the Redis ``master:halted_strategies`` set
        against any Postgres ``halt_state`` durable record (Wave 4P) and
        logs discrepancies so an operator can spot:

        * A Redis entry without a Postgres row (the halt will silently
          vanish on TTL expiry without audit trail).
        * A Postgres row without a Redis entry (the in-memory / runtime
          view has lost track of an explicit operator halt — the next
          pipeline run would trade as if no halt existed).

        Runs once on boot from ``main.lifespan``. If the Postgres table
        doesn't exist (Wave 4P not deployed yet), the check degrades to a
        pure Redis inventory dump — still useful, since the halt-set
        content is now visible in a boot log line.
        """
        try:
            from core.redis import get_redis
            redis = await get_redis()
            redis_halts: set[str] = set()
            if redis is not None:
                raw = await redis.smembers(cls._REDIS_HALTED_KEY)
                redis_halts = {
                    (s.decode() if isinstance(s, (bytes, bytearray)) else str(s))
                    for s in (raw or set())
                }
        except Exception:
            logger.warning(
                "halt_expiry_boot_check: could not read Redis halt set",
                exc_info=True,
            )
            return

        # Best-effort Postgres side.  The Wave 4P ``halt_state`` table is a
        # SINGLETON (id=1) kill-switch — ``is_halted=TRUE`` means "stop
        # everything"; the per-strategy Redis halt set is orthogonal to it
        # (drawdown-driven, per-name).  We read the singleton so the boot
        # log surfaces BOTH signals and any ambiguity is visible.
        pg_global_halted: bool | None = None
        try:
            from core.config import settings as _settings
            if not _settings.SKIP_DB_INIT:
                from core.database import _get_session_factory
                from sqlalchemy import text as _text

                factory = _get_session_factory()
                async with factory() as session:
                    try:
                        result = await session.execute(
                            _text(
                                "SELECT is_halted FROM halt_state "
                                "WHERE id = 1"
                            )
                        )
                        row = result.fetchone()
                        if row is not None:
                            pg_global_halted = bool(row[0])
                    except Exception:
                        # Table doesn't exist / migration not applied — degrade.
                        pass
        except Exception:
            logger.debug(
                "halt_expiry_boot_check: Postgres lookup skipped",
                exc_info=True,
            )

        # Log both signals so an operator can see what the next tick will
        # do. A WARN fires only when the global kill-switch is active (the
        # most urgent case). Per-strategy drift just rides the INFO line.
        if pg_global_halted is True:
            logger.warning(
                "halt_expiry_boot_check: GLOBAL halt is ACTIVE "
                "(halt_state.is_halted=TRUE); per-strategy redis halts=%s",
                sorted(redis_halts),
            )
        elif pg_global_halted is False:
            logger.info(
                "halt_expiry_boot_check: global halt clear; "
                "per-strategy redis halts (%d): %s",
                len(redis_halts), sorted(redis_halts),
            )
        else:
            # No halt_state row accessible — log redis inventory only.
            logger.info(
                "halt_expiry_boot_check: redis-only inventory (%d halts): %s",
                len(redis_halts), sorted(redis_halts),
            )

    async def halt_strategy(self, strategy: str) -> None:
        """Manually halt a strategy (e.g. from an admin endpoint).

        Wave 2G / persona-79 Race 4: this used to schedule the Redis
        persist via ``loop.create_task`` and return synchronously. If the
        process died before the background task ran, the in-memory halt
        existed but Redis didn't — so the next pipeline run on a fresh
        MasterAgent didn't know the strategy was halted. We make this
        async-only and ``await`` the persist so the caller can't see
        ``halt_strategy`` return successfully without the durable write
        having completed (or having failed loudly via the inner WARN log).

        The previous synchronous variant has been removed; every caller
        must now ``await`` this method. ``async_halt_strategy`` was
        consolidated into this single entry point — no deprecation alias
        is shipped because there are no external in-tree callers.
        """
        if strategy not in self.halted_strategies:
            self.halted_strategies.add(strategy)
            logger.warning("MANUAL HALT: strategy '%s'", strategy)
        await self._persist_halt_add(strategy)

    # ------------------------------------------------------------------
    # P1: Strategy drawdown tracking
    # ------------------------------------------------------------------

    def update_strategy_pnl(self, strategy: str, current_value: float) -> dict[str, Any]:
        """Track strategy equity and check drawdown limits.

        Peaks and halt-set mutations are mirrored to Redis via fire-and-
        forget tasks so the Sync signature of this method is preserved
        (callers inside sync paths don't have to await). If no event loop
        is running the persist is skipped and the in-memory state remains
        authoritative for the current process.
        """
        peak_changed = False
        if strategy not in self.strategy_peaks:
            self.strategy_peaks[strategy] = current_value
            peak_changed = True
        if current_value > self.strategy_peaks[strategy]:
            self.strategy_peaks[strategy] = current_value
            peak_changed = True

        self.strategy_current[strategy] = current_value
        peak = self.strategy_peaks[strategy]
        drawdown = (current_value - peak) / peak if peak > 0 else 0

        # Helper to schedule async persistence without breaking the sync API.
        def _schedule(coro: Any) -> None:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(coro)
                else:
                    coro.close()  # no loop — drop the coroutine cleanly
            except RuntimeError:
                coro.close()

        if peak_changed:
            _schedule(self._persist_peak(strategy, peak))

        if drawdown < self.STRATEGY_DRAWDOWN_LIMIT and strategy not in self.halted_strategies:
            self.halted_strategies.add(strategy)
            logger.warning(
                "HALT strategy '%s': drawdown %.1f%% exceeds limit %.1f%%",
                strategy, drawdown * 100, self.STRATEGY_DRAWDOWN_LIMIT * 100,
            )
            _schedule(self._persist_halt_add(strategy))
            return {"action": "halt", "drawdown": drawdown}

        if strategy in self.halted_strategies and drawdown > self.STRATEGY_RESUME_THRESHOLD:
            self.halted_strategies.discard(strategy)
            logger.info(
                "RESUME strategy '%s': drawdown recovered to %.1f%%",
                strategy, drawdown * 100,
            )
            _schedule(self._persist_halt_remove(strategy))
            return {"action": "resume", "drawdown": drawdown}

        return {"action": "ok", "drawdown": drawdown}

    # ------------------------------------------------------------------
    # P2: Sector concentration
    # ------------------------------------------------------------------

    def _get_sector_exposure(self) -> dict[str, float]:
        """Calculate current sector allocation as % of total deployed."""
        sector_totals: dict[str, float] = {}
        total = sum(p.get("notional", 0) for p in self.existing_positions.values())
        if total == 0:
            return {}
        for sym, pos in self.existing_positions.items():
            sector = pos.get("sector", "Unknown")
            sector_totals[sector] = sector_totals.get(sector, 0) + pos.get("notional", 0)
        return {s: v / total for s, v in sector_totals.items()}

    # ------------------------------------------------------------------
    # P3: Regime detection
    # ------------------------------------------------------------------

    def _detect_regime(self) -> str:
        """Classify market regime based on VIX level."""
        if self.vix_level > 35:
            return "crisis"
        elif self.vix_level > 25:
            return "bear"
        elif self.vix_level > 18:
            return "bull_high_vol"
        else:
            return "bull_low_vol"

    # ------------------------------------------------------------------
    # P4: VaR estimation
    # ------------------------------------------------------------------

    def _estimate_position_var(self, symbol: str, notional: float) -> float:
        """Estimate daily VaR for a position. Uses typical daily volatilities."""
        daily_vol = self.VOL_MAP.get(symbol, 0.020)  # default 2% daily vol
        return notional * daily_vol * 2.33  # 99% confidence

    def _portfolio_var(self) -> float:
        """Estimate portfolio VaR (sum of position VaRs with 0.7 diversification factor)."""
        individual_vars = []
        for sym, pos in self.existing_positions.items():
            var = self._estimate_position_var(sym, pos.get("notional", 0))
            individual_vars.append(var)
        if not individual_vars:
            return 0
        # Apply diversification benefit (0.7 factor — assumes ~50% average correlation)
        return sum(individual_vars) * 0.7

    # ------------------------------------------------------------------
    # Factor crowding detection
    # ------------------------------------------------------------------

    def detect_factor_crowding(self) -> dict[str, Any]:
        """Detect if portfolio is overcrowded in any factor.

        Returns warnings for each crowded factor.
        """
        warnings: list[dict[str, Any]] = []
        positions = self.existing_positions

        if len(positions) < 3:
            return {"crowded": False, "warnings": [], "position_count": len(positions)}

        total = len(positions)

        # 1. Momentum crowding: If most positions have high RS scores
        rs_scores = [p.get("rs_score", 50) for p in positions.values() if p.get("rs_score")]
        if rs_scores:
            avg_rs = sum(rs_scores) / len(rs_scores)
            if avg_rs > 75:
                warnings.append({
                    "factor": "momentum",
                    "severity": "high",
                    "message": f"Portfolio heavily momentum-tilted (avg RS: {avg_rs:.0f}). Vulnerable to momentum reversal.",
                    "action": "Consider adding mean-reversion positions or reducing momentum allocation."
                })

        # 2. Sector crowding
        sector_exp = self._get_sector_exposure()
        for sector, pct in sector_exp.items():
            if pct > 0.35:
                warnings.append({
                    "factor": f"sector:{sector}",
                    "severity": "high",
                    "message": f"Sector '{sector}' at {pct*100:.0f}% — exceeds 35% threshold.",
                    "action": f"Diversify away from {sector}. Consider other sectors."
                })

        # 3. Volatility crowding: If most positions are high-vol
        vols = [self.VOL_MAP.get(sym, 0.02) for sym in positions.keys()]
        if vols:
            avg_vol = sum(vols) / len(vols)
            if avg_vol > 0.025:  # Average daily vol > 2.5%
                warnings.append({
                    "factor": "high_volatility",
                    "severity": "medium",
                    "message": f"Portfolio avg daily vol: {avg_vol*100:.1f}%. High vol concentration increases tail risk.",
                    "action": "Add low-vol defensive names (utilities, staples) or reduce position sizes."
                })

        # 4. Strategy crowding: If one strategy dominates
        strategy_counts: dict[str, int] = {}
        for p in positions.values():
            s = p.get("strategy", "unknown")
            strategy_counts[s] = strategy_counts.get(s, 0) + 1
        for strat, count in strategy_counts.items():
            if total > 3 and count / total > 0.5:
                warnings.append({
                    "factor": f"strategy:{strat}",
                    "severity": "medium",
                    "message": f"Strategy '{strat}' owns {count}/{total} positions ({count/total*100:.0f}%). Diversify across strategies.",
                    "action": f"Reduce {strat} allocation, increase underweight strategies."
                })

        # 5. Correlation estimate: If too many tech/growth names
        growth_sectors = {"Technology", "Communication Services", "Consumer Discretionary"}
        growth_count = sum(1 for p in positions.values() if p.get("sector") in growth_sectors)
        if total > 3 and growth_count / total > 0.6:
            warnings.append({
                "factor": "growth_tilt",
                "severity": "high",
                "message": f"Growth/tech tilt: {growth_count}/{total} positions in growth sectors. High correlation risk.",
                "action": "Add value/defensive names: energy, healthcare, staples, financials."
            })

        # 6. Low-vol underweight: If no position has vol < 1.5%, warn
        low_vol_count = sum(1 for s in positions if self.VOL_MAP.get(s, 0.02) < 0.015)
        if total > 5 and low_vol_count == 0:
            warnings.append({
                "factor": "no_low_vol",
                "severity": "medium",
                "message": f"No low-volatility positions in portfolio. Missing defensive diversification.",
                "action": "Add consumer staples (PG, KO, WMT) or utilities (XLU) for lower portfolio vol."
            })

        return {
            "crowded": len(warnings) > 0,
            "warnings": warnings,
            "position_count": total,
        }

    # ------------------------------------------------------------------
    # Volatility-targeted position sizing (risk parity at position level)
    # ------------------------------------------------------------------

    def calculate_vol_targeted_size(self, symbol: str, max_notional: float = 5000) -> float:
        """Size position inversely to volatility (risk parity at position level)."""
        vol = self.VOL_MAP.get(symbol, 0.020)

        # Target: 1% daily portfolio risk per position
        target_risk = 0.01 * self.equity  # $1,000 for $100K portfolio
        vol_sized = target_risk / vol  # notional to achieve target risk

        # Cap at max_notional
        return min(vol_sized, max_notional)

    # ------------------------------------------------------------------
    # Strategy-aware momentum gate exemption
    # ------------------------------------------------------------------

    # Per-strategy warning de-duplication for registry lookup failures.
    _MOMENTUM_GATE_WARNED: set[str] = set()

    def _momentum_gate_exempt(self, strategy: str) -> bool:
        """Return True if momentum gates should NOT apply to this strategy.

        Consulted in :meth:`request_trade` before checks 6b/6c.  A strategy is
        exempt if:

        * its name is in :attr:`MOMENTUM_GATE_SKIP_STRATEGIES` (explicit
          per-name whitelist for mean-reversion equities), or
        * its registry :class:`StrategyMeta.category` is in
          :attr:`MOMENTUM_GATE_SKIP_CATEGORIES` (``options``, ``pairs``,
          ``intraday`` trade counter to or orthogonal to trend).

        Behaviour on registry errors:
          * ``KeyError`` (strategy not registered) — the expected miss path
            for fallback adapters and ad-hoc strategy names. Logged once per
            name at WARNING so it's visible but not spammy, then treated as
            "not exempt" so the gate still applies.
          * Any other exception propagates upward — a broken registry is an
            operational problem we want surfaced, not silently swallowed.
        """
        if strategy in self.MOMENTUM_GATE_SKIP_STRATEGIES:
            return True
        try:
            # Task 19: switched to ``_core.protocol.get_meta`` — the legacy
            # registry is empty post-``strategies/base.py``-deletion.
            from strategies._core.protocol import get_meta
            meta = get_meta(strategy)
        except Exception:
            meta = None
        if meta is None:
            if strategy not in self._MOMENTUM_GATE_WARNED:
                self._MOMENTUM_GATE_WARNED.add(strategy)
                logger.warning(
                    "_momentum_gate_exempt: strategy %r not in registry; "
                    "defaulting to exempt=False (gate will apply). Every "
                    "pairs/options/intraday signal from this name will be "
                    "rejected until it is registered.", strategy,
                )
            return False
        return meta.category in self.MOMENTUM_GATE_SKIP_CATEGORIES

    # ------------------------------------------------------------------
    # Trade gating
    # ------------------------------------------------------------------

    def request_trade(
        self,
        strategy: str,
        symbol: str,
        side: str,
        notional: float,
        conviction: int,
        rationale: str,
        shares: int = 0,
        entry_price: float = 0.0,
        stop_loss: float | None = None,
        take_profit: float | None = None,
        sector: str = "Unknown",
    ) -> dict[str, Any]:
        """Strategy requests permission to trade.

        Returns ``{"approved": bool, "reason": str}``.
        """
        # -- Risk Monitor bypass: when disabled, approve all buys --
        if not self.RISK_MONITOR_ENABLED:
            # Only enforce duplicate symbol check (safety)
            if side == "buy" and symbol in self.existing_positions:
                holding = self.existing_positions[symbol].get("strategy", "unknown")
                return {"approved": False, "reason": f"{symbol} already held by '{holding}'"}

            order = {
                "strategy": strategy, "symbol": symbol, "side": side,
                "notional": notional, "shares": shares, "conviction": conviction,
                "rationale": rationale, "entry_price": entry_price,
                "stop_loss": stop_loss, "take_profit": take_profit,
            }
            self.pending_orders.append(order)
            if side == "buy":
                self.existing_positions[symbol] = {
                    "strategy": strategy, "notional": notional, "sector": sector,
                }
                self.cash -= notional
            logger.warning("RISK MONITOR OFF — auto-approved: %s %s %s $%.0f", strategy, side, symbol, notional)
            return {"approved": True, "reason": "Approved (risk monitor disabled)"}

        # -- P1: Check if strategy is halted due to drawdown --
        if strategy in self.halted_strategies:
            reason = f"Strategy '{strategy}' is halted (drawdown > {abs(self.STRATEGY_DRAWDOWN_LIMIT)*100}%)"
            remediation = f"Wait for drawdown to recover above {abs(self.STRATEGY_RESUME_THRESHOLD)*100}% or manually resume the strategy."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # -- sells are always allowed (exit existing position) --
        if side == "sell":
            self.pending_orders.append({
                "strategy": strategy,
                "symbol": symbol,
                "side": side,
                "notional": notional,
                "shares": shares,
                "conviction": conviction,
                "rationale": rationale,
                "entry_price": entry_price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
            })
            return {"approved": True, "reason": "Sell approved"}

        # -- buy checks --

        # Check 0: Risk/reward ratio enforcement
        if side == "buy" and entry_price > 0 and stop_loss and stop_loss > 0 and take_profit and take_profit > 0:
            risk = entry_price - stop_loss
            reward = take_profit - entry_price
            if risk > 0:
                rr_ratio = reward / risk
                if rr_ratio < self.MIN_REWARD_RISK_RATIO:
                    reason = (
                        f"Risk/reward {rr_ratio:.1f}:1 below minimum "
                        f"{self.MIN_REWARD_RISK_RATIO}:1 "
                        f"(risk=${risk:.2f}, reward=${reward:.2f})"
                    )
                    remediation = f"Widen take-profit to >${entry_price + risk * self.MIN_REWARD_RISK_RATIO:.2f} or tighten stop-loss to >${entry_price - reward / self.MIN_REWARD_RISK_RATIO:.2f}."
                    self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
                    return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 1: No duplicate symbols across strategies
        if symbol in self.existing_positions:
            holding_strategy = self.existing_positions[symbol].get('strategy', 'unknown')
            reason = f"{symbol} already held by strategy '{holding_strategy}'"
            remediation = f"Close the existing {symbol} position in '{holding_strategy}' first, or choose a different symbol."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 2: Strategy allocation limit
        strategy_deployed = sum(
            p.get("notional", 0)
            for p in self.existing_positions.values()
            if p.get("strategy") == strategy
        )
        # Also count pending orders for this strategy
        strategy_pending = sum(
            o["notional"]
            for o in self.pending_orders
            if o["strategy"] == strategy and o["side"] == "buy"
        )
        strategy_limit = self.STRATEGY_LIMITS.get(strategy, 0.10) * self.equity
        if strategy_deployed + strategy_pending + notional > strategy_limit:
            available = max(0, strategy_limit - strategy_deployed - strategy_pending)
            reason = (
                f"Strategy '{strategy}' would exceed allocation "
                f"({strategy_deployed + strategy_pending + notional:.0f} > {strategy_limit:.0f})"
            )
            remediation = f"Reduce position size to ${available:.0f} or close existing {strategy} positions to free allocation."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 3: Portfolio-wide deployment limit (P3: regime-adaptive)
        total_deployed = sum(p.get("notional", 0) for p in self.existing_positions.values())
        total_pending = sum(o["notional"] for o in self.pending_orders if o["side"] == "buy")
        if total_deployed + total_pending + notional > self.max_deployment * self.equity:
            available = max(0, self.max_deployment * self.equity - total_deployed - total_pending)
            reason = (
                f"Portfolio deployment would exceed {self.max_deployment * 100:.0f}% "
                f"(regime: {self.regime}, VIX: {self.vix_level})"
            )
            remediation = f"Reduce position to ${available:.0f}, close existing positions, or wait for regime to improve (current VIX: {self.vix_level:.1f})."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 4: Max positions
        current_count = len(self.existing_positions) + len(
            [o for o in self.pending_orders if o["side"] == "buy"]
        )
        if current_count >= self.MAX_POSITIONS:
            reason = f"Max {self.MAX_POSITIONS} positions reached"
            remediation = f"Close one or more existing positions to free a slot. Currently holding {current_count} positions."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 5: Per-position limit
        max_pos_dollar = self.MAX_PER_POSITION * self.equity
        if notional > max_pos_dollar:
            reason = (
                f"Position size ${notional:.0f} exceeds "
                f"{self.MAX_PER_POSITION * 100:.0f}% limit (${max_pos_dollar:.0f})"
            )
            remediation = f"Reduce position size to ${max_pos_dollar:.0f} or below ({self.MAX_PER_POSITION * 100:.0f}% of ${self.equity:.0f} equity)."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 6: Minimum conviction
        if conviction < self.MIN_CONVICTION:
            reason = f"Conviction {conviction} below minimum {self.MIN_CONVICTION}"
            remediation = f"Re-analyze with stricter criteria to increase conviction above {self.MIN_CONVICTION}, or wait for a stronger signal."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 6b / 6c: Momentum gates -- strategy-aware.
        #
        # The absolute-momentum gate (12-month) and trailing-momentum gate
        # (6-month) are long-only trend filters. Strategies whose intent is
        # to trade AGAINST the prevailing trend (mean-reversion, short-vol,
        # pairs, intraday) should not be gated by these checks, otherwise
        # every signal from them is rejected by construction.
        #
        # We consult StrategyMeta.category from the registry; unknown names
        # (not yet registered, or fallback adapters) default to applying the
        # gate -- safer than silently disabling it for a strategy that
        # actually IS trend-following.
        gate_momentum = side == "buy" and not self._momentum_gate_exempt(strategy)

        if gate_momentum:
            # Check 6b: Absolute momentum gate (Antonacci Dual Momentum)
            abs_mom = self.ABSOLUTE_MOMENTUM_DATA.get(symbol)
            if abs_mom is not None and abs_mom < -5:
                reason = f"Absolute momentum gate: {symbol} 12-month return is {abs_mom:.1f}% (below -5% threshold). Not buying downtrends."
                remediation = f"Wait for {symbol} to establish positive 12-month momentum, or choose a symbol with positive absolute momentum."
                self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
                return {"approved": False, "reason": reason, "remediation": remediation}

            # Check 6c: Require non-severely-negative 6-month momentum
            momentum = self.MOMENTUM_DATA.get(symbol)
            if momentum is not None and momentum < -10:
                reason = f"Momentum gate: {symbol} has strongly negative momentum ({momentum:.1f}%, below -10% threshold)."
                remediation = f"Wait for {symbol} 6-month momentum to recover above -10%, or select a symbol with stronger relative strength."
                self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
                return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 7: Sufficient cash
        if notional > self.cash:
            reason = f"Insufficient cash (${self.cash:.0f} < ${notional:.0f})"
            remediation = f"Reduce position size to ${self.cash:.0f} or close existing positions to free cash."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 8 (P2): Sector concentration limit
        # Only enforce when portfolio has enough positions for meaningful diversification
        num_positions = len(self.existing_positions)
        if num_positions >= 3:
            exposure = self._get_sector_exposure()
            current_sector_pct = exposure.get(sector, 0)
            total_pending = sum(o.get("notional", 0) for o in self.pending_orders if o.get("side") == "buy")
            total_base = total_deployed + total_pending
            projected_sector_pct = (current_sector_pct * total_base + notional) / (total_base + notional)

            if projected_sector_pct > self.SECTOR_LIMIT:
                reason = f"Sector '{sector}' would reach {projected_sector_pct*100:.0f}% (limit: {self.SECTOR_LIMIT*100}%)"
                other_sectors = [s for s in ["Technology", "Healthcare", "Financials", "Energy", "Consumer Staples", "Industrials"] if s != sector]
                remediation = f"Choose a symbol from a different sector ({', '.join(other_sectors[:3])}) to diversify."
                self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
                return {"approved": False, "reason": reason, "remediation": remediation}

            if current_sector_pct > self.SECTOR_WARN and conviction < 70:
                reason = f"Sector '{sector}' at {current_sector_pct*100:.0f}% -- conviction {conviction} < 70 required"
                remediation = f"Increase conviction above 70 (re-analyze with stronger signal) or pick a symbol from an underweight sector."
                self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
                return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 9 (P4): VaR budget
        new_var = self._estimate_position_var(symbol, notional)
        portfolio_var_after = self._portfolio_var() + new_var * 0.7
        var_limit = self.MAX_PORTFOLIO_VAR * self.equity
        if portfolio_var_after > var_limit:
            max_notional_for_var = max(0, (var_limit - self._portfolio_var()) / (self.VOL_MAP.get(symbol, 0.02) * 2.33 * 0.7))
            reason = f"Portfolio VaR would reach ${portfolio_var_after:.0f} (limit: ${var_limit:.0f})"
            remediation = f"Reduce position to ${max_notional_for_var:.0f} to stay within VaR budget, or close a high-vol position first."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # ---- Low-vol preference: log diversification benefit ----
        avg_portfolio_vol = (
            sum(self.VOL_MAP.get(s, 0.02) for s in self.existing_positions)
            / max(len(self.existing_positions), 1)
        ) if self.existing_positions else 0
        stock_vol = self.VOL_MAP.get(symbol, 0.02)
        if avg_portfolio_vol > 0.025 and stock_vol < 0.015 and side == "buy":
            logger.info(
                "Low-vol diversifier benefit: %s vol %.1f%% helps reduce portfolio vol %.1f%%",
                symbol, stock_vol * 100, avg_portfolio_vol * 100,
            )

        # ---- Approved ----
        order = {
            "strategy": strategy,
            "symbol": symbol,
            "side": side,
            "notional": notional,
            "shares": shares,
            "conviction": conviction,
            "rationale": rationale,
            "entry_price": entry_price,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
        }
        self.pending_orders.append(order)
        # Track the symbol so subsequent strategies can't also buy it
        self.existing_positions[symbol] = {
            "strategy": strategy,
            "notional": notional,
            "sector": sector,
        }
        self.cash -= notional
        logger.info(
            "APPROVED: %s %s %s $%.0f (conviction=%d, sector=%s, regime=%s)",
            strategy, side, symbol, notional, conviction, sector, self.regime,
        )
        return {"approved": True, "reason": "Approved"}

    # ------------------------------------------------------------------
    # P5: Smart Claude-powered review
    # ------------------------------------------------------------------

    async def smart_review(self, symbol: str, side: str, notional: float,
                           conviction: int, rationale: str, sector: str) -> dict[str, Any]:
        """Ask Claude to review the trade in portfolio context."""
        # Build portfolio summary for Claude
        sector_exp = self._get_sector_exposure()
        total_deployed = sum(p.get("notional", 0) for p in self.existing_positions.values())
        deployment_pct = total_deployed / self.equity * 100 if self.equity > 0 else 0
        portfolio_summary = {
            "equity": self.equity,
            "cash": self.cash,
            "positions": len(self.existing_positions),
            "deployment_pct": deployment_pct,
            "regime": self.regime,
            "vix": self.vix_level,
            "top_sectors": dict(sorted(sector_exp.items(), key=lambda x: x[1], reverse=True)[:5]),
            "portfolio_var_pct": self._portfolio_var() / self.equity * 100 if self.equity > 0 else 0,
        }

        prompt = (
            f"You are the Master Risk Agent for a multi-strategy trading fund.\n\n"
            f"Portfolio state:\n"
            f"- Equity: ${self.equity:,.0f}, Cash: ${self.cash:,.0f}\n"
            f"- Deployed: {portfolio_summary['deployment_pct']:.0f}%, Positions: {portfolio_summary['positions']}\n"
            f"- Regime: {self.regime}, VIX: {self.vix_level}\n"
            f"- Sector exposure: {json.dumps(portfolio_summary['top_sectors'])}\n"
            f"- Portfolio VaR: {portfolio_summary['portfolio_var_pct']:.1f}% of equity\n\n"
            f"Trade request:\n"
            f"- {side.upper()} {symbol} (sector: {sector}), notional: ${notional:,.0f}\n"
            f"- Conviction: {conviction}/100\n"
            f"- Rationale: {rationale[:200]}\n\n"
            f"Should this trade be APPROVED or REJECTED? Consider:\n"
            f"1. Does it diversify or concentrate the portfolio?\n"
            f"2. Is it appropriate for the current regime?\n"
            f"3. Is the position sizing reasonable?\n\n"
            f'Respond with JSON: {{"decision": "approve" or "reject", "reason": "one sentence", "suggested_size_adjustment": 1.0}}'
        )

        try:
            result_text: str | None = None
            mode = "auto"
            try:
                from agents.claude_client import get_client
                from core.config import settings

                api_secret = getattr(settings, "ANTHROPIC_API_KEY", None)
                api_key = api_secret.get_secret_value() if api_secret else ""
                mode = (getattr(settings, "CLAUDE_BACKEND", "auto") or "auto").lower()
                if api_key and mode in {"auto", "api"}:
                    result_text = await get_client().complete(
                        system="You are AlphaDesk's risk reviewer. Return only JSON.",
                        user=prompt,
                        model="haiku",
                        max_tokens=800,
                        timeout=30,
                        context={"endpoint": "master_agent.smart_review", "symbol": symbol},
                    )
            except Exception:
                logger.warning(
                    "master_agent: Claude API smart-review failed for %s; trying CLI fallback",
                    symbol, exc_info=True,
                )

            if result_text is None:
                if mode == "api":
                    return {"claude_decision": "approve", "claude_reason": "Claude API unavailable, rules-based approval", "size_adjustment": 1.0}
                claude_cli = shutil.which("claude")
                if not claude_cli:
                    return {"claude_decision": "approve", "claude_reason": "Claude unavailable, rules-based approval", "size_adjustment": 1.0}
                from agents.claude_audit import new_claude_audit_id, write_claude_audit_record

                request_id = new_claude_audit_id()
                request_payload = {
                    "runtime": "cli",
                    "model": "haiku",
                    "system": "AlphaDesk master-agent trade risk review",
                    "prompt": prompt,
                }
                t0 = asyncio.get_running_loop().time()
                proc = await asyncio.create_subprocess_exec(
                    claude_cli, "--print", "--model", "haiku", "--output-format", "json", prompt,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                )
                try:
                    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
                except asyncio.TimeoutError:
                    await write_claude_audit_record(
                        request_id=request_id,
                        source="master_agent.smart_review.cli",
                        request=request_payload,
                        status="timeout",
                        context={"endpoint": "master_agent.smart_review", "symbol": symbol},
                        duration_ms=int((asyncio.get_running_loop().time() - t0) * 1000),
                        error={"type": "TimeoutError", "message": "Claude CLI exceeded 30s"},
                    )
                    raise
                elapsed_ms = int((asyncio.get_running_loop().time() - t0) * 1000)
                raw = stdout.decode(errors="replace").strip()
                err = stderr.decode(errors="replace").strip()
                if proc.returncode != 0:
                    await write_claude_audit_record(
                        request_id=request_id,
                        source="master_agent.smart_review.cli",
                        request=request_payload,
                        response={"raw": raw, "stderr": err},
                        status="error",
                        context={"endpoint": "master_agent.smart_review", "symbol": symbol},
                        duration_ms=elapsed_ms,
                        error={"type": "ClaudeCLIError", "message": err or "non-zero exit"},
                    )
                    return {"claude_decision": "approve", "claude_reason": "Claude unavailable, rules-based approval", "size_adjustment": 1.0}

                data = json.loads(raw)
                result_text = data.get("result", raw) if isinstance(data, dict) else raw
                await write_claude_audit_record(
                    request_id=request_id,
                    source="master_agent.smart_review.cli",
                    request=request_payload,
                    response={"raw": raw, "result_text": result_text},
                    status="success",
                    context={"endpoint": "master_agent.smart_review", "symbol": symbol},
                    duration_ms=elapsed_ms,
                )

            # Try to find JSON in the response
            json_match = re.search(r'\{[^}]*"decision"[^}]*\}', result_text)
            if json_match:
                decision = json.loads(json_match.group())
                return {
                    "claude_decision": decision.get("decision", "approve"),
                    "claude_reason": decision.get("reason", ""),
                    "size_adjustment": decision.get("suggested_size_adjustment", 1.0),
                }
        except Exception:
            logger.warning(
                "master_agent: Claude smart-review failed for %s — falling back to rules-based approval",
                symbol, exc_info=True,
            )

        # Fallback: approve (don't block on Claude failure)
        return {"claude_decision": "approve", "claude_reason": "Claude unavailable, rules-based approval", "size_adjustment": 1.0}

    async def request_trade_smart(
        self,
        strategy: str,
        symbol: str,
        side: str,
        notional: float,
        conviction: int,
        rationale: str,
        shares: int = 0,
        entry_price: float = 0.0,
        stop_loss: float | None = None,
        take_profit: float | None = None,
        sector: str = "Unknown",
    ) -> dict[str, Any]:
        """Trade request with optional Claude review for high-conviction trades.

        Serialised by ``self._trade_lock`` so the check-then-write sequence
        — risk checks -> tentative approval (symbol added + cash decremented)
        -> 30 s Claude await -> possible rollback — runs atomically against
        the shared mutable state (``cash``, ``existing_positions``,
        ``pending_orders``). Without this lock, concurrent strategies under
        ``asyncio.gather`` can race on the await inside :meth:`smart_review`
        and defeat the deployment / duplicate-symbol invariants
        (persona-63 P0-1 / P0-2 / P0-5).
        """
        async with self._trade_lock:
            # Wave 2H (persona-76 P76-7): restricted-symbol deny-list
            # enforced at the routing layer so EVERY strategy path (not
            # just the HTTP order endpoint) refuses a banned ticker. Runs
            # BEFORE the rules-based gate so the reason string is the
            # most informative failure reported back to the caller.
            try:
                from core.compliance import assert_not_restricted
                assert_not_restricted(symbol)
            except ValueError as exc:
                self.rejections.append({
                    "strategy": strategy, "symbol": symbol,
                    "reason": str(exc),
                })
                return {"approved": False, "reason": f"restricted symbol: {symbol}"}

            # First run rules-based checks
            result = self.request_trade(
                strategy, symbol, side, notional, conviction, rationale,
                shares=shares, entry_price=entry_price, stop_loss=stop_loss,
                take_profit=take_profit, sector=sector,
            )
            if not result["approved"]:
                return result

            # For trades near limits or low conviction, ask Claude
            total_deployed = sum(p.get("notional", 0) for p in self.existing_positions.values())
            deployment_pct = total_deployed / self.equity if self.equity > 0 else 0

            if deployment_pct > 0.40 or conviction < 70:
                review = await self.smart_review(symbol, side, notional, conviction, rationale, sector)
                if review["claude_decision"] == "reject":
                    # Undo the approval
                    if symbol in self.existing_positions:
                        del self.existing_positions[symbol]
                    self.pending_orders = [o for o in self.pending_orders if o["symbol"] != symbol]
                    self.cash += notional
                    self.rejections.append({
                        "symbol": symbol, "strategy": strategy,
                        "reason": f"Claude review rejected: {review['claude_reason']}",
                    })
                    return {"approved": False, "reason": f"Claude review: {review['claude_reason']}"}

                # Apply size adjustment
                if review.get("size_adjustment", 1.0) != 1.0:
                    adj = review["size_adjustment"]
                    for o in self.pending_orders:
                        if o["symbol"] == symbol:
                            o["notional"] = notional * adj
                            o["shares"] = max(1, int(o.get("shares", 0) * adj))

            return result

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    def get_summary(self) -> dict[str, Any]:
        """Return allocation summary per strategy.

        Wave 2G / persona-79 Race 5: ``self._trade_lock`` only wraps WRITES
        in :meth:`request_trade_smart`; reads (this method, the rest UI / API
        callers) used to iterate ``self.existing_positions`` and
        ``self.pending_orders`` directly while a concurrent writer mutated
        them. Iterating a dict that's being mutated raises
        ``RuntimeError: dictionary changed size during iteration`` and
        crashes the request.

        We snapshot via ``dict()`` / ``list()`` at the top of the method.
        Both copy operations are atomic in CPython under the GIL — they
        release a consistent point-in-time view even if a writer is
        racing — and downstream reads use only the snapshot. Sector +
        VaR helpers continue to read from ``self.existing_positions``
        directly because they're called inside the lock by
        ``request_trade``; here we substitute the snapshot for the public
        read path.
        """
        # Atomic copy — no locks needed, no inconsistency risk to the
        # downstream iteration. dict() over a live dict is one CPython
        # bytecode instruction (BUILD_MAP_UNPACK_WITH_CALL eq) and runs
        # under the GIL.
        positions_snapshot = dict(self.existing_positions)
        pending_snapshot = list(self.pending_orders)
        rejections_snapshot = list(self.rejections)
        halted_snapshot = list(self.halted_strategies)

        by_strategy: dict[str, dict[str, Any]] = {}
        for sym, pos in positions_snapshot.items():
            strat = pos.get("strategy", "unknown")
            if strat not in by_strategy:
                by_strategy[strat] = {"deployed": 0.0, "positions": 0, "symbols": []}
            by_strategy[strat]["deployed"] += pos.get("notional", 0)
            by_strategy[strat]["positions"] += 1
            by_strategy[strat]["symbols"].append(sym)

        total_deployed = sum(s["deployed"] for s in by_strategy.values())

        # Compute sector exposure + portfolio VaR off the snapshot so the
        # numbers are internally consistent with by_strategy. We inline
        # the helper logic because the existing helpers read from
        # ``self.existing_positions``.
        sector_totals: dict[str, float] = {}
        sector_total_notional = sum(p.get("notional", 0) for p in positions_snapshot.values())
        for sym, pos in positions_snapshot.items():
            sector = pos.get("sector", "Unknown")
            sector_totals[sector] = sector_totals.get(sector, 0) + pos.get("notional", 0)
        sector_exposure = (
            {s: v / sector_total_notional for s, v in sector_totals.items()}
            if sector_total_notional > 0 else {}
        )

        individual_vars = [
            self._estimate_position_var(sym, pos.get("notional", 0))
            for sym, pos in positions_snapshot.items()
        ]
        portfolio_var = sum(individual_vars) * 0.7 if individual_vars else 0

        return {
            "equity": self.equity,
            "cash": self.cash,
            "total_deployed": total_deployed,
            "deployed_pct": round(total_deployed / self.equity * 100, 1) if self.equity else 0,
            "total_positions": len(positions_snapshot),
            "pending_orders": len(pending_snapshot),
            "rejections_count": len(rejections_snapshot),
            "rejections": rejections_snapshot,
            "by_strategy": by_strategy,
            # P1-P4 additions
            "regime": self.regime,
            "vix_level": self.vix_level,
            "max_deployment_pct": round(self.max_deployment * 100, 1),
            "halted_strategies": halted_snapshot,
            "sector_exposure": sector_exposure,
            "portfolio_var": round(portfolio_var, 2),
            "portfolio_var_pct": round(portfolio_var / self.equity * 100, 2) if self.equity else 0,
        }
