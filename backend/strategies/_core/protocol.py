# backend/strategies/_core/protocol.py
"""Strategy ABC + registry decorator.

Every strategy in AlphaDesk inherits from Strategy, declares PARAMS_MODEL
(pointing at its Pydantic Params subclass), implements universe() and
run(), and registers itself via @register_strategy at import time.

This module is the single source of truth for what it means to be a
Strategy. The runners (in runners/) consume Strategy instances but
never import concrete strategy classes.
"""
from __future__ import annotations

import abc
from datetime import date
from typing import Any, Callable, ClassVar, Literal

from pydantic import BaseModel, ConfigDict

from strategies._core.contracts import (
    Fill,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)


class Strategy(abc.ABC):
    """Every strategy inherits from this ABC.

    Required class-level declarations:
      PARAMS_MODEL — Pydantic subclass of StrategyParams validating the
                     strategy's parameters. Runner uses it to parse
                     CLI --params and serve JSON Schema.

    Required methods:
      universe(asof, state) — return symbols the runner should pre-fetch bars for
      run(input, params)    — pure-function alpha logic; return StrategyResult

    Optional methods:
      on_fill(fill, state)  — update state after a fill; default is no-op

    Purity invariants (enforced by runner construction + code review):
      * run() MUST NOT perform I/O (no provider access, no network)
      * run() MUST NOT read wall-clock time — input.asof is the only time source
      * run() MUST NOT use global RNG — input.rng is the only random source
      * state mutations flow ONLY through StrategyResult.state_update and
        on_fill() return values; no `self._state` on strategy instances
    """

    PARAMS_MODEL: ClassVar[type[StrategyParams]]
    """Subclass must set. Registry validates its presence."""

    META: ClassVar["StrategyMeta"]
    """Set by @register_strategy. Reading post-registration is fine."""

    @abc.abstractmethod
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        """Return symbols the runner should pre-fetch bars for on `asof`.

        Called BEFORE run(). May read state (for strategies with a dynamic
        universe tracked across bars) but MUST NOT read positions or params
        — those are signal-logic concerns. For static universes, return a
        constant list.
        """

    @abc.abstractmethod
    def run(
        self,
        input: StrategyInput,
        params: StrategyParams,
    ) -> StrategyResult:
        """Pure-function alpha logic. Deterministic given (input, params)."""

    def on_fill(
        self,
        fill: Fill,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        """Optional state update after a fill. Default: no-op.

        Called BETWEEN run() calls by the runner; the returned dict is
        shallow-merged into state before the next bar. Strategies that
        need per-position memory (entry price for stops, ATR at entry)
        override this.
        """
        return {}

    # ------------------------------------------------------------------ #
    # Reverse-lookup hooks (T11 — symbols-page strategy band)            #
    # ------------------------------------------------------------------ #
    # The symbols-page reverse-lookup endpoint asks "for this symbol,
    # what does each strategy think?". The four hooks below give each
    # strategy a chance to answer without dragging the whole runner along.
    #
    # Defaults are deliberately conservative so an unmigrated strategy
    # falls through to "in universe / no signal / no score / no side" —
    # back-compat with iter 10's hardcoded defaults. Strategies that have
    # a stable static universe (sector ETFs, pairs lists, factor seeds)
    # SHOULD override ``is_in_universe`` so the symbols page doesn't
    # render a sea of "watching" chips.
    #
    # ``has_entry_signal`` / ``signal_score`` / ``signal_side`` remain
    # deferred globally — there is no per-strategy signal cache today
    # (the daily pipeline writes ledger trades, not a "live signals"
    # surface). When that surface lands, override these in each
    # strategy or in a shared mixin.
    def is_in_universe(self, symbol: str) -> bool:
        """Return True if ``symbol`` is currently a candidate for this strategy.

        Default is permissive (``True``). Override when the strategy has a
        bounded static universe — sector ETFs, factor seeds, options-liquid
        names — so the reverse-lookup card doesn't render every strategy
        as "watching" for every ticker.

        Pure / cheap. Called per-symbol on the symbols-page hot path; do
        NOT touch I/O. Reading a module-level constant or short list is
        fine; calling a provider is not.
        """
        return True

    def has_entry_signal(self, symbol: str) -> bool:
        """Return True if there is an actionable entry signal for ``symbol`` right now.

        Default is conservative (``False``). The per-strategy signal cache
        that would back this hook (last pipeline run → recommended
        symbols) does not exist yet; once it does, strategies override
        this to read from it.
        """
        return False

    def signal_score(self, symbol: str) -> float | None:
        """Return the entry-signal score for ``symbol`` if one is cached, else ``None``.

        Default is ``None``. Pairs with ``has_entry_signal`` — when that
        returns ``True``, this should return the corresponding score.
        """
        return None

    def signal_side(self, symbol: str) -> Literal["long", "short"] | None:
        """Return the side of the cached entry signal for ``symbol``, or ``None``.

        Default is ``None``. Pairs with ``has_entry_signal``.
        """
        return None


class StrategyMeta(BaseModel):
    """Registry metadata attached by @register_strategy. Frozen."""

    model_config = ConfigDict(frozen=True)

    name: str
    category: Literal["equity", "options", "pairs", "macro", "intraday", "smoke"] = "equity"
    description: str = ""
    kind: Literal["autonomous", "research"] = "autonomous"
    lookback_days: int = 250
    required_bars: tuple[Literal["daily", "1min", "5min", "1h"], ...] = ("daily",)
    min_universe_size: int = 1
    paper_only: bool = False
    """When True, DailyPipelineRunner blocks this strategy from live mode.

    The strategy still backtests and paper-trades normally; only live-mode
    signal emission is suppressed. Use for strategies whose OOS track record
    hasn't crossed the bar for production capital (see audit procedure in
    docs/STRATEGIES.md).
    """
    params_model: type[StrategyParams] | None = None
    """Set by @register_strategy from the class's PARAMS_MODEL attribute."""


_REGISTRY: dict[str, tuple[type[Strategy], StrategyMeta]] = {}


def register_strategy(meta: StrategyMeta) -> Callable[[type[Strategy]], type[Strategy]]:
    """Decorator that registers a Strategy subclass in the process-global registry.

    Usage:
        @register_strategy(StrategyMeta(name="pead", category="options", ...))
        class PEADStrategy(Strategy):
            PARAMS_MODEL = PEADParams
            ...

    Raises TypeError if the class doesn't declare PARAMS_MODEL. Stamps
    META onto the class post-registration so runners can read it via
    cls.META.
    """
    def decorator(cls: type[Strategy]) -> type[Strategy]:
        if not hasattr(cls, "PARAMS_MODEL"):
            raise TypeError(
                f"{cls.__name__} must declare PARAMS_MODEL: type[StrategyParams]"
            )
        frozen_meta = meta.model_copy(update={"params_model": cls.PARAMS_MODEL})
        cls.META = frozen_meta
        _REGISTRY[meta.name] = (cls, frozen_meta)
        return cls

    return decorator


def get_strategy(name: str) -> type[Strategy] | None:
    entry = _REGISTRY.get(name)
    return entry[0] if entry else None


def get_meta(name: str) -> StrategyMeta | None:
    entry = _REGISTRY.get(name)
    return entry[1] if entry else None


def list_strategies() -> list[StrategyMeta]:
    return [meta for _, meta in _REGISTRY.values()]
