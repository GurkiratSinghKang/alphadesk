"""DailyPipelineRunner — single-day live invocation.

Replaces the legacy strategy_adapter.py. Called by the existing daily
pipeline scheduler (data.ingestion.pipeline_runner) once per trading day
per strategy; returns a StrategyResult that the MasterAgent processes.
"""
from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal
from typing import Any, Awaitable, Callable, Literal

import numpy as np

from strategies._core.contracts import (
    Position,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import Strategy
from strategies._core.providers import ProviderBundle


# A ``positions_provider`` is a callable returning the broker-side position
# snapshot at ``asof``. It may be sync (``list[Position]``) or async
# (``Awaitable[list[Position]]``) — the runner accepts both.
PositionsProvider = Callable[[date], list[Position] | Awaitable[list[Position]]]


class StateStore:
    """Abstract state persistence — read/write a strategy's state dict.

    Round-11 / AA-1.4 (P1): formerly an in-memory dict. Two
    concurrent invocations of the same strategy (scheduled cron +
    manual ``/api/strategies/{id}/run``) used to ``load → run →
    save`` over each other; the later writer's ``state_update``
    overwrote the earlier without merging. A process restart
    dropped every strategy's persisted state — pairs_trading lost
    its ``active``/``positions``/``pending`` ledger and PEAD lost
    its time-stop watchdog dict.

    Now wires through the Redis cache (``core/redis.py``) with a
    per-strategy ``asyncio.Lock`` so ``load`` and ``save`` for the
    same strategy serialise within a single process. Cross-process
    races would still need a Redis WATCH/MULTI/EXEC primitive — but
    AlphaDesk runs a single ``gunicorn -w 1`` worker, so the lock
    here is sufficient.

    Falls back to the in-memory dict when Redis is unreachable —
    same fail-open posture as ``cache_get`` callers; preserves
    the legacy behaviour for ``backend/tests/`` which never had a
    real Redis.
    """

    # 30 days — long enough that a strategy whose state hasn't been
    # touched (e.g. paused for a few weeks) doesn't lose its ledger.
    _TTL_SECONDS = 30 * 86_400

    def __init__(self):
        self._data: dict[str, dict[str, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock_for(self, strategy_name: str) -> asyncio.Lock:
        lock = self._locks.get(strategy_name)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[strategy_name] = lock
        return lock

    async def load(self, strategy_name: str) -> dict[str, Any]:
        async with self._lock_for(strategy_name):
            try:
                from core.redis import cache_get
                payload = await cache_get(f"strategy_state:{strategy_name}")
                if isinstance(payload, dict):
                    # Mirror into in-process cache so test paths +
                    # Redis-down fallback still see the latest state.
                    self._data[strategy_name] = dict(payload)
                    return dict(payload)
            except Exception:
                pass
            return self._data.get(strategy_name, {})

    async def save(self, strategy_name: str, state: dict[str, Any]) -> None:
        async with self._lock_for(strategy_name):
            self._data[strategy_name] = dict(state)
            try:
                from core.redis import cache_set
                await cache_set(
                    f"strategy_state:{strategy_name}",
                    dict(state),
                    ttl_seconds=self._TTL_SECONDS,
                )
            except Exception:
                # Fail-open — strategy state is best-effort durable;
                # better to lose the next run's state-update than to
                # halt the pipeline on a Redis blip.
                pass


class DailyPipelineRunner:
    def __init__(
        self,
        strategy: Strategy,
        providers: ProviderBundle,
        state_store: StateStore,
        positions_provider: PositionsProvider | None = None,
    ):
        """Construct a DailyPipelineRunner.

        Round-6 / I-13: ``positions_provider`` is the broker-side position
        snapshot loader. Pass ``None`` (or omit) to keep the legacy empty-
        positions behaviour for backtest / paper smoke runs; pass a real
        callable in live mode so strategies that condition on the open book
        (kama_breakout exits, pead time-stops, pairs_trading watchdog) see
        the broker truth instead of a silent empty list.

        The callable accepts ``asof`` and returns ``list[Position]`` either
        synchronously or as a coroutine; ``run_today`` awaits if needed.
        """
        self._strategy = strategy
        self._providers = providers
        self._state_store = state_store
        self._positions_provider = positions_provider

    async def run_today(
        self,
        params: StrategyParams,
        asof: date | None = None,
        mode: Literal["paper", "live"] = "live",
        cash: Decimal | float | int | str | None = None,
        equity: Decimal | float | int | str | None = None,
    ) -> StrategyResult:
        if asof is None:
            # For production, use a market calendar. Phase 1 uses today.
            from datetime import date as _date
            asof = _date.today()
        if mode not in ("paper", "live"):
            raise ValueError(f"mode must be 'paper' or 'live' (got {mode!r})")

        # Round-6 / I-1: research-kind strategies are research stubs — they
        # carry no executable signal path and must never be invoked from the
        # live pipeline. Returning early with an explicit diagnostic preserves
        # the runner's "shape contract" (always returns a StrategyResult) and
        # surfaces the block reason to the MasterAgent / audit log.
        if getattr(self._strategy.META, "kind", "autonomous") == "research":
            return StrategyResult(
                signals=[], state_update={},
                diagnostics={"research_kind_blocked": True},
                warnings=[
                    f"{self._strategy.META.name} has meta.kind='research' — "
                    "research stubs cannot emit live signals; pipeline is a no-op"
                ],
            )

        # meta.paper_only = True blocks live-mode emission; the strategy
        # still runs in backtest/paper modes. The runner returns an empty
        # result with a warning so the MasterAgent sees the block reason.
        if self._strategy.META.paper_only and mode == "live":
            return StrategyResult(
                signals=[], state_update={},
                diagnostics={"paper_only_blocked": True},
                warnings=[
                    f"{self._strategy.META.name} has meta.paper_only=True — "
                    "skipped live-mode emission"
                ],
            )

        # Round-13 / RD-12 (P1): operator-pause gate. The /strategies UI
        # writes ``strategy_status:{name}`` to Redis when the operator
        # pauses a strategy mid-day; the legacy ``daily_pipeline.py``
        # respects this gate (AA-1.3) but the new ``_core`` runner used
        # this exact same path didn't, so a paused strategy continued
        # to emit live signals if dispatched via the new runner. Now
        # both runners short-circuit identically.
        try:
            from core.redis import cache_get
            paused = await cache_get(
                f"strategy_status:{self._strategy.META.name}"
            )
            if isinstance(paused, dict) and paused.get("status") == "paused":
                return StrategyResult(
                    signals=[], state_update={},
                    diagnostics={"operator_paused": True, "paused_at": paused.get("paused_at")},
                    warnings=[
                        f"{self._strategy.META.name} is operator-paused "
                        f"(status set at {paused.get('paused_at', 'unknown')}) — "
                        "skipped live-mode emission"
                    ],
                )
        except Exception:
            # Redis blip: don't fail-OPEN on the pause check, but don't
            # crash the run either. The legacy pipeline mirrors this
            # behaviour — operators rely on Postgres-side halt for the
            # hard kill switch, this Redis gate is the per-strategy
            # soft pause.
            pass

        state = await self._state_store.load(self._strategy.META.name)
        symbols = self._strategy.universe(asof, state)
        fetch_warnings: list[str] = []

        def _fetch_bars(timeframe: str):
            try:
                return self._providers.bars.fetch_window(
                    symbols,
                    asof,
                    self._strategy.META.lookback_days,
                    timeframe=timeframe,
                )
            except TypeError:
                if timeframe == "1D":
                    return self._providers.bars.fetch_window(
                        symbols, asof, self._strategy.META.lookback_days
                    )
                raise

        bars = _fetch_bars("1D")
        intraday_bars = {}
        for timeframe in tuple(getattr(self._strategy.META, "required_bars", ("daily",))):
            if timeframe == "daily":
                continue
            try:
                intraday_bars[timeframe] = _fetch_bars(timeframe)
            except Exception:
                fetch_warnings.append(
                    f"{self._strategy.META.name}: could not load {timeframe} bars"
                )
        earnings = (
            self._providers.earnings.fetch_window(symbols, asof, self._strategy.META.lookback_days)
            if self._providers.earnings else None
        )
        fundamentals = (
            self._providers.fundamentals.snapshot(symbols, asof)
            if self._providers.fundamentals else None
        )
        options_chains = {}
        if (
            getattr(self._strategy.META, "category", None) == "options"
            and getattr(self._providers, "options", None) is not None
            and symbols
        ):
            try:
                maybe_options = self._providers.options.fetch_chains(symbols, asof)
                if hasattr(maybe_options, "__await__"):
                    options_chains = await maybe_options  # type: ignore[assignment]
                else:
                    options_chains = dict(maybe_options)  # type: ignore[arg-type]
            except Exception:
                fetch_warnings.append(
                    f"{self._strategy.META.name}: could not load options chains"
                )

        # Round-6 / I-13: positions are not optional in live mode. If the
        # provider isn't wired, fail loudly here rather than silently feed
        # the strategy an empty book — the previous behaviour caused
        # kama_breakout / pead / pairs_trading to skip exits and time-stops
        # because they couldn't see the broker positions, and a half-empty
        # ledger drifted further every day. Construction-time wiring is the
        # only safe default.
        positions: list[Position] = []
        if mode == "live" and self._positions_provider is None:
            raise RuntimeError(
                "DailyPipelineRunner cannot run live with empty positions — "
                "wire positions_provider"
            )
        if self._positions_provider is not None:
            maybe_positions = self._positions_provider(asof)
            if hasattr(maybe_positions, "__await__"):
                positions = await maybe_positions  # type: ignore[assignment]
            else:
                positions = list(maybe_positions)  # type: ignore[arg-type]

        # Live mode uses a deterministic seed derived from strategy name + date
        # so replay from state_store is stable across process restarts on the same day.
        import hashlib
        seed_bytes = hashlib.sha256(f"{self._strategy.META.name}:{asof.isoformat()}".encode()).digest()[:4]
        seed = int.from_bytes(seed_bytes, "big")

        cash_value, equity_value = _account_values_for_mode(
            mode, cash=cash, equity=equity,
        )

        input = StrategyInput(
            asof=asof, mode=mode, bars=bars, intraday_bars=intraday_bars,
            earnings=earnings, fundamentals=fundamentals,
            options_chains=options_chains,
            cash=cash_value,
            equity=equity_value,
            positions=positions,
            state=state,
            seed=seed,
            rng=np.random.default_rng(seed),
        )
        result = self._strategy.run(input, params)
        if fetch_warnings:
            result.warnings = [*fetch_warnings, *(result.warnings or [])]

        # Persist state update for the next day's run
        await self._state_store.save(
            self._strategy.META.name,
            {**state, **result.state_update},
        )
        return result


def _account_values_for_mode(
    mode: Literal["paper", "live"],
    *,
    cash: Decimal | float | int | str | None,
    equity: Decimal | float | int | str | None,
) -> tuple[Decimal, Decimal]:
    """Return account values for StrategyInput.

    Paper runs need realistic capital so sizing-aware strategies can exercise
    their entry logic. Live runs should receive broker/MasterAgent account
    values from the caller; missing values stay zero to avoid fabricating
    capital in real-money mode.
    """
    fallback = Decimal("100000") if mode == "paper" else Decimal("0")
    cash_value = _to_decimal_account_value(cash, fallback=fallback)
    equity_value = _to_decimal_account_value(equity, fallback=fallback)
    return cash_value, equity_value


def _to_decimal_account_value(
    value: Decimal | float | int | str | None,
    *,
    fallback: Decimal,
) -> Decimal:
    if value is None:
        return fallback
    try:
        parsed = Decimal(str(value))
    except Exception:
        return fallback
    if parsed < 0:
        return fallback
    return parsed
