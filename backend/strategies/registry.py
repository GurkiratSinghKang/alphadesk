"""Strategy registry -- decorator-based discovery of strategy packages.

Strategies declare themselves via the :func:`register_strategy` decorator. At
import time the decorator stores the class + its :class:`StrategyMeta` in a
process-wide dict, keyed by strategy name.

The registry is *import-safe*: :func:`load_all` walks every subpackage under
``backend.strategies`` and imports it; if any one import raises, the error is
logged and discovery continues. A single broken strategy package never
prevents the rest from loading.

Usage from the engine / tuner / CLI
-----------------------------------

.. code-block:: python

    from strategies.registry import load_all, get_strategy, list_strategies

    load_all()                                 # triggers decorator-side-effects
    names = [m.name for m in list_strategies()]
    cls = get_strategy("buy_and_hold_spy")
    instance = cls()
    instance.configure(params)

Thread-safety
-------------

Registration uses a process-local dict; decorators fire at import time and
Python imports are protected by the GIL-backed import lock. No additional
synchronization is applied.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
import sys
from dataclasses import replace
from typing import Callable, TypeVar

from strategies.base import Strategy, StrategyMeta

log = logging.getLogger("alphadesk.strategies.registry")

T = TypeVar("T")

# Package we scan in :func:`load_all`.
#
# In the container the backend is WORKDIR=/app with ``strategies/`` as a
# top-level package (no ``backend.`` prefix). In local dev / tests the same
# code is imported as ``backend.strategies``. We prefer ``strategies`` because
# it works in both environments: when ``strategies`` is importable from sys.path
# (container), it resolves; in dev where backend/ is often added to sys.path,
# ``strategies`` resolves to the same modules.
#
# Override with ``ALPHADESK_STRATEGIES_PACKAGE`` if a deployment needs a
# different layout.
import os as _os

_PACKAGE = _os.environ.get("ALPHADESK_STRATEGIES_PACKAGE", "strategies")

# name -> class
_STRATEGY_CLASSES: dict[str, type] = {}
# name -> StrategyMeta
_STRATEGY_META: dict[str, StrategyMeta] = {}


class StrategyRegistrationError(RuntimeError):
    """Raised when a strategy cannot be registered."""


def register_strategy(
    name: str | None = None,
    *,
    category: str = "equity",
    required_bars: tuple[str, ...] | list[str] = ("daily",),
    required_lookback_days: int = 250,
    min_universe_size: int = 1,
    supports_shorts: bool = False,
    supports_options: bool = False,
    description: str = "",
) -> Callable[[type[T]], type[T]]:
    """Decorator: register a strategy class with the registry.

    Parameters
    ----------
    name:
        Registry key. If omitted, the class's ``name`` attribute is used.
    category, required_bars, required_lookback_days, min_universe_size,
    supports_shorts, supports_options, description:
        Fields forwarded to :class:`StrategyMeta`.

    Raises
    ------
    StrategyRegistrationError
        If the name is already registered, or if the class does not carry
        the ``name`` / ``required_bars`` / ``required_lookback_days``
        attributes the :class:`Strategy` protocol requires.
    """

    def decorator(cls: type[T]) -> type[T]:
        key = name or getattr(cls, "name", None)
        if not key:
            raise StrategyRegistrationError(
                f"@register_strategy: class {cls.__name__} has no 'name' "
                "attribute and no 'name=' was passed to the decorator."
            )

        # Sanity-check that the class looks like a Strategy. We use duck typing
        # (getattr) rather than isinstance(cls, Strategy) because Protocol
        # runtime_checkable requires instances, not classes.
        for required in ("configure", "universe", "generate_signals", "manage"):
            if not hasattr(cls, required):
                raise StrategyRegistrationError(
                    f"@register_strategy({key!r}): class {cls.__name__} is "
                    f"missing required method '{required}'."
                )

        # Sync the class's ``name`` attr with the registry key so a strategy
        # written as ``class Foo: name = 'foo'`` stays consistent when the
        # caller passes ``name='bar'``.
        try:
            if getattr(cls, "name", None) != key:
                cls.name = key  # type: ignore[attr-defined]
        except Exception:
            # Classes that define ``name`` as a read-only descriptor -- rare,
            # but don't fail registration over it.
            pass

        meta = StrategyMeta(
            name=key,
            category=category,
            required_bars=tuple(required_bars),
            required_lookback_days=required_lookback_days,
            min_universe_size=min_universe_size,
            supports_shorts=supports_shorts,
            supports_options=supports_options,
            description=description,
        )

        if key in _STRATEGY_CLASSES:
            existing = _STRATEGY_CLASSES[key]
            if existing is cls:
                # Idempotent re-registration (can happen when the package is
                # imported twice, e.g. via different sys.path entries).
                log.debug("Strategy %r re-registered (identical class).", key)
                return cls
            raise StrategyRegistrationError(
                f"@register_strategy({key!r}): name already registered to "
                f"{existing.__module__}.{existing.__name__}."
            )

        _STRATEGY_CLASSES[key] = cls
        _STRATEGY_META[key] = meta
        log.debug(
            "Registered strategy %r -> %s.%s", key, cls.__module__, cls.__name__
        )
        return cls

    return decorator


def get_strategy(name: str) -> type:
    """Return the *class* registered under ``name``.

    Raises
    ------
    KeyError
        If ``name`` is not registered. Call :func:`load_all` first if you
        haven't already.
    """

    try:
        return _STRATEGY_CLASSES[name]
    except KeyError as exc:
        raise KeyError(
            f"Strategy {name!r} is not registered. Known strategies: "
            f"{sorted(_STRATEGY_CLASSES)}"
        ) from exc


def get_meta(name: str) -> StrategyMeta:
    """Return the :class:`StrategyMeta` for ``name``.

    Raises
    ------
    KeyError
        If ``name`` is not registered.
    """

    try:
        return _STRATEGY_META[name]
    except KeyError as exc:
        raise KeyError(
            f"Strategy {name!r} is not registered. Known strategies: "
            f"{sorted(_STRATEGY_META)}"
        ) from exc


def list_strategies() -> list[StrategyMeta]:
    """Return the metadata for all currently-registered strategies.

    Ordered alphabetically by name for deterministic CLI output.
    """

    return [replace(_STRATEGY_META[n]) for n in sorted(_STRATEGY_META)]


def list_names() -> list[str]:
    """Return just the registered names (shortcut for common UI code)."""

    return sorted(_STRATEGY_CLASSES)


def unregister(name: str) -> None:
    """Remove ``name`` from the registry. Primarily for tests.

    No-op if the name is not registered.
    """

    _STRATEGY_CLASSES.pop(name, None)
    _STRATEGY_META.pop(name, None)


def clear() -> None:
    """Wipe the registry. Primarily for tests."""

    _STRATEGY_CLASSES.clear()
    _STRATEGY_META.clear()


def load_all(package: str | None = None) -> list[str]:
    """Walk ``package`` (default: ``backend.strategies``) and import everything.

    Any ``@register_strategy`` decorators encountered during import populate
    the registry as a side effect. Subpackages that fail to import are logged
    and skipped -- a single broken strategy does not prevent the rest from
    loading.

    Returns the list of fully-qualified module names that were imported
    successfully (useful for debugging).
    """

    target = package or _PACKAGE
    imported: list[str] = []
    try:
        pkg = importlib.import_module(target)
    except Exception as exc:  # pragma: no cover - target is our own package
        log.error("load_all: cannot import %s: %s", target, exc)
        return imported

    if not hasattr(pkg, "__path__"):
        # Not a package -- nothing to walk.
        return imported

    def _on_walk_error(mod_name: str) -> None:
        # Called by pkgutil when __import__ inside walk_packages raises --
        # typically when a subpackage's ``__init__.py`` fails. Log and keep
        # walking; the module won't be in ``sys.modules`` so we don't need
        # to re-visit it below.
        exc = sys.exc_info()[1]
        log.error(
            "load_all: skipping %s (import failed: %s)", mod_name, exc
        )

    for mod_info in pkgutil.walk_packages(
        pkg.__path__, prefix=f"{target}.", onerror=_on_walk_error
    ):
        name = mod_info.name
        # Skip test modules -- tests don't register strategies, and importing
        # them can pull in pytest fixtures with heavy side effects.
        if ".tests" in name or name.endswith(".tests") or name.endswith(".conftest"):
            continue
        try:
            importlib.import_module(name)
            imported.append(name)
        except Exception as exc:  # pragma: no cover - exercised in tests
            log.error("load_all: skipping %s (import failed: %s)", name, exc)
            continue
    return imported


# ---------------------------------------------------------------------------
# Implementation-stage taxonomy (Wave 27 ghost-strategy remediation)
# ---------------------------------------------------------------------------
#
# The ``@register_strategy`` decorator only runs for strategies that ship a
# Python package under ``backend/strategies/<name>/``. That list is the ground
# truth for "can we actually run this strategy today?".
#
# However the catalogue-layer (``backend/api/routes/strategies.py::_STRATEGIES``)
# historically carried marketing placeholders — strategies we want to surface
# to the UI but haven't built yet (``claude-alpha``, ``dividend-capture``,
# ``gap-fill``, ``mean-reversion``, ``pairs-stat-arb``, ``sector-rotation``,
# ``vcp-breakout``). The audit flagged these as "ghosts": they render as
# ``status="active"`` with null metrics, confusing researchers who see an
# "ACTIVE" label but empty charts.
#
# The helpers below give the rest of the codebase (API layer, rail selectors,
# the new ``/strategies`` listing page) a single canonical place to ask
# "is this strategy implemented, planned, or neither?" without re-hardcoding
# the list in every caller. The registry itself only tracks decorator-registered
# classes; this taxonomy lives beside it because it describes the same concept.
#
# ``PLANNED_STRATEGIES`` uses the frontend / API route-id form (hyphens) because
# that is what UI code and REST consumers speak. Callers that have a registry
# underscore name should translate through
# ``backend/api/routes/strategies.py::_REGISTRY_TO_ROUTE`` before asking.

#: Strategies that ship a working Python package under ``backend/strategies/``.
#: Keep this list in sync with the directory listing — these are the names the
#: ``@register_strategy`` decorator mints at import time. Expressed as route
#: ids (hyphen form) for parity with ``STRATEGY_META`` on the frontend.
IMPLEMENTED_STRATEGY_ROUTE_IDS: frozenset[str] = frozenset({
    "momentum-quality",
    "pead",
    "vrp-harvesting",
    "earnings-vol-premium",
    "regime-adaptive",
    "ts-momentum",
    "rsi2-reversal",
    "dual-momentum",
    "pairs-trading",
    "kama-breakout",
    "orb",
    "vwap-strategy",
})

#: Strategies we've advertised in the catalogue but haven't yet implemented.
#: The UI surfaces these with a muted "Coming soon" affordance rather than an
#: "Active" pill, and the listing page groups them into a separate section.
#: ``manual-discretionary`` is deliberately NOT here — it is a real, first-class
#: bucket backed by the trade ledger (see
#: ``backend/data/ingestion/trade_ledger.py`` — manual trades land there).
PLANNED_STRATEGY_ROUTE_IDS: frozenset[str] = frozenset({
    "claude-alpha",
    "dividend-capture",
    "gap-fill",
    "mean-reversion",
    "pairs-stat-arb",
    "sector-rotation",
    "vcp-breakout",
})


def implementation_stage(route_id: str) -> str:
    """Return the implementation stage for a frontend / API route-id.

    Values:
        * ``"live"`` — a Python package exists and runs in the backtester /
          pipeline; OOS metrics are real.
        * ``"planned"`` — advertised on the rail but no implementation yet;
          the UI should render these as "coming soon" and disable trading
          affordances.
        * ``"other"`` — not one of the curated lists. Today this is just
          ``manual-discretionary`` (ledger-backed user trades) and anything
          we haven't categorised yet. Callers should treat ``"other"`` as
          "don't assume it's either live or planned; show the raw status".
    """
    if route_id in IMPLEMENTED_STRATEGY_ROUTE_IDS:
        return "live"
    if route_id in PLANNED_STRATEGY_ROUTE_IDS:
        return "planned"
    return "other"


def is_implemented(route_id: str) -> bool:
    """Return True if the strategy has a real backend package."""
    return route_id in IMPLEMENTED_STRATEGY_ROUTE_IDS


__all__ = [
    "register_strategy",
    "get_strategy",
    "get_meta",
    "list_strategies",
    "list_names",
    "unregister",
    "clear",
    "load_all",
    "StrategyRegistrationError",
    "IMPLEMENTED_STRATEGY_ROUTE_IDS",
    "PLANNED_STRATEGY_ROUTE_IDS",
    "implementation_stage",
    "is_implemented",
]
