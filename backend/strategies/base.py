"""Strategy base protocol, metadata, and context definitions.

================================================================================
Strategy authors (Phase 1), read this first
================================================================================

Every strategy is a Python *package* under ``backend.strategies``. The package
must, at minimum, contain:

- ``strategy.py`` -- a class implementing the :class:`Strategy` protocol below
  and decorated with :func:`backend.strategies.registry.register_strategy`.
- ``__init__.py`` -- imports from ``.strategy`` so the decorator fires at
  import time.
- ``spec.md`` -- one- or two-paragraph academic description (citations, rules).

The :class:`Strategy` protocol is a light-touch lifecycle:

    configure(params)        -- called once after construction with a dict of
                                parameter overrides (typically from the tuner).
    universe(asof, ctx)      -- return the set of symbols the strategy wants
                                bars for on this date. The engine uses this to
                                tell the data provider what to prefetch.
    generate_signals(asof, ctx)
                             -- emit *new* Signals on this bar. The engine will
                                route them through execution simulation.
    on_fill(fill, ctx)       -- optional; called after each of your fills so
                                you can update internal state (e.g. track
                                entry ATR for stops).
    manage(asof, ctx)        -- emit *exit/adjust* Signals for open positions.

The engine calls your hooks in this order each trading bar::

    1. mark-to-market -> Context populated (asof, cash, equity, positions)
    2. strategy.universe(asof, ctx)            # prefetch
    3. strategy.manage(asof, ctx)              # exits first
    4. strategy.generate_signals(asof, ctx)    # then entries
    5. execution simulator fills orders
    6. strategy.on_fill(fill, ctx) for each fill

Rules of the road
-----------------

* **No look-ahead.** ``ctx.asof`` is the timestamp of the *current* bar's
  close. You may read bars up to and including ``asof``; the engine enforces
  this on the bar provider. A signal emitted on bar T fills no earlier than
  the close of bar T (MOC order type) or the open of bar T+1 (MOO/MKT).
* **Use ``ctx.cache``.** The engine passes the same dict across bars so you
  can memoize indicators, cache screens, and track stateful rules (e.g.
  entry prices for trailing stops). It is private to your strategy.
* **Declare your parameters.** Implement :meth:`Strategy.search_space` to tell
  the tuner which knobs to optimize; see :mod:`backend.tuner.search`.
* **Fail loud.** If data is missing, raise -- the engine will catch, log the
  error, and return a failed-backtest result (Sharpe = -inf to the tuner).
  Silent degradation creates garbage backtests.
* **Money is ``Decimal``; ratios are ``float``.** Weights, RSI values, z-scores
  are floats. Prices and cash are :class:`decimal.Decimal`.

Minimal example::

    from strategies.base import Strategy
    from strategies.registry import register_strategy
    from strategies.signal import Signal
    from tuner.search import IntRange

    @register_strategy(
        name="my_strategy",
        category="equity",
        required_bars=["daily"],
        required_lookback_days=250,
        description="...",
    )
    class MyStrategy:
        name = "my_strategy"
        required_bars = ["daily"]
        required_lookback_days = 250

        def configure(self, params):
            self.lookback = int(params.get("lookback", 60))

        def universe(self, asof, ctx):
            return ["SPY"]

        def generate_signals(self, asof, ctx):
            yield Signal(symbol="SPY", target_weight=1.0)

        def manage(self, asof, ctx):
            return []

        def on_fill(self, fill, ctx):
            pass

        @classmethod
        def search_space(cls):
            return {"lookback": IntRange(20, 200)}

================================================================================
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable, Mapping, Protocol, TYPE_CHECKING, runtime_checkable

# The canonical engine types (Signal, OptionLeg, Context, Fill, Bar ...) live
# in ``backend.backtest.types``. We re-export the ones strategy authors touch
# every day so they only need to import from ``backend.strategies.*``.
from backtest.types import (
    Bar,
    Context,
    Fill,
    OptionLeg,
    OrderType,
    Side,
    Signal,
    TimeInForce,
)

if TYPE_CHECKING:  # pragma: no cover - used for docstring references only
    pass


# --------------------------------------------------------------------------- #
# StrategyMeta                                                                #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class StrategyMeta:
    """Descriptive metadata attached to a strategy by the registry decorator.

    ``StrategyMeta`` is what ``list_strategies()`` returns and what the
    frontend / CLI can render without having to construct the strategy. It
    carries no behaviour.

    Attributes
    ----------
    name:
        Registry key. Must be unique across the process. Lowercase
        ``snake_case`` by convention. Must match the strategy class's
        ``name`` attribute.
    category:
        Coarse taxonomy bucket -- one of ``"equity"``, ``"options"``,
        ``"pairs"``, ``"macro"``, ``"intraday"``, ``"smoke"``.
    required_bars:
        Ordered list of bar timeframes the strategy consumes, e.g.
        ``["daily"]`` or ``["1min", "daily"]``. The engine uses this to
        wire the bar provider.
    required_lookback_days:
        Warmup window, in calendar days. The engine will fetch and *skip*
        this many days before invoking the strategy so indicators have
        enough history.
    min_universe_size:
        Minimum number of symbols ``universe()`` is expected to return on
        any given day. Strategies that run on a single ticker (e.g. a SPY
        trend follower) use ``1``; cross-sectional strategies typically
        set ``50`` or more.
    supports_shorts:
        Whether the strategy may emit negative weights / short positions.
        The engine refuses shorts from strategies that set this to False.
    supports_options:
        Whether any emitted signal may carry ``legs`` (a multi-leg options
        order). The engine refuses option legs from strategies that set
        this to False.
    description:
        One-sentence human summary for the registry UI.
    """

    name: str
    category: str = "equity"
    required_bars: tuple[str, ...] = ("daily",)
    required_lookback_days: int = 250
    min_universe_size: int = 1
    supports_shorts: bool = False
    supports_options: bool = False
    description: str = ""


# --------------------------------------------------------------------------- #
# Strategy protocol                                                           #
# --------------------------------------------------------------------------- #
@runtime_checkable
class Strategy(Protocol):
    """The contract every strategy satisfies.

    See the module docstring for a walkthrough and minimal example.

    Implementations are classes (not instances). The engine / registry
    instantiates them with ``cls()`` and then calls :meth:`configure` with
    the chosen parameter dict. Strategies must be picklable so they can
    round-trip through the tuner's Optuna storage.
    """

    #: Registry key -- must match the ``name`` passed to ``@register_strategy``.
    name: str
    #: Ordered bar-timeframes this strategy needs. See :class:`StrategyMeta`.
    required_bars: list[str]
    #: Warmup window in calendar days.
    required_lookback_days: int

    def configure(self, params: Mapping[str, Any]) -> None:
        """Apply a parameter override dict to the strategy instance.

        Called exactly once, immediately after instantiation. The engine
        passes the merged defaults + user overrides + tuner-suggested
        values. Implementations should coerce types, validate ranges, and
        pre-compute anything that depends only on params (not on data).
        """
        ...

    def universe(self, asof: date, ctx: "Context") -> Iterable[str]:
        """Return the list of symbols to consider on ``asof``.

        The engine calls this first on each bar so it can tell the bar
        provider what to prefetch. Keep it cheap; the heavy lifting belongs
        in :meth:`generate_signals`.
        """
        ...

    def generate_signals(self, asof: date, ctx: "Context") -> Iterable["Signal"]:
        """Emit new entry signals for this bar.

        Runs *after* :meth:`manage` each bar, so exits are processed first
        and entry cash / margin is accurate. May yield zero or more
        :class:`Signal` objects.
        """
        ...

    def on_fill(self, fill: "Fill", ctx: "Context") -> None:
        """Optional hook: called after each of your fills.

        Use this to stash per-position state (e.g. the ATR at entry for a
        trailing-stop rule) in ``ctx.cache``.
        """
        ...

    def manage(self, asof: date, ctx: "Context") -> Iterable["Signal"]:
        """Emit exit / adjust signals for *existing* positions.

        Invoked before :meth:`generate_signals` each bar. Typical uses:
        trailing stops, time-based exits, hedge rebalances.
        """
        ...


# --------------------------------------------------------------------------- #
# Back-compat Context helpers                                                 #
# --------------------------------------------------------------------------- #
# The engine's Context (defined in backend.backtest.types) already carries
# everything strategies need. We expose a small shim below so a strategy can
# write ``ctx.cache`` or ``ctx.calendar`` without caring whether the engine
# called the field ``state`` or ``calendar_provider`` under the hood.
#
# These helpers are additive only -- they do not shadow any engine attribute.


def cache_of(ctx: "Context") -> dict[str, Any]:
    """Return the per-strategy scratch dict stored on ``ctx``.

    The engine persists this dict across bars for the same strategy. Use it
    instead of instance attributes when you need per-run state; two concurrent
    backtests of the same strategy class will share class-level state but get
    distinct ``ctx.cache`` dicts.
    """

    # The engine field is named ``state``. We also accept a ``cache``
    # attribute for forward-compat if F1 renames the field later.
    cache = getattr(ctx, "cache", None)
    if cache is None:
        cache = ctx.state
    return cache


def calendar_of(ctx: "Context") -> Any:
    """Return the :class:`CalendarProvider` wired to ``ctx``.

    The engine stores it under ``calendar_provider``. Some older spec drafts
    used ``calendar``. This helper accepts either.
    """

    cal = getattr(ctx, "calendar", None)
    if cal is None:
        cal = getattr(ctx, "calendar_provider", None)
    return cal


# Note: ``from backend.strategies.base import Context`` and
# ``from backend.backtest.types import Context`` refer to the same object
# because of the re-export at the top of this file.


__all__ = [
    # protocol + meta
    "Strategy",
    "StrategyMeta",
    # re-exports from the engine
    "Bar",
    "Context",
    "Fill",
    "OptionLeg",
    "OrderType",
    "Side",
    "Signal",
    "TimeInForce",
    # helpers
    "cache_of",
    "calendar_of",
]
