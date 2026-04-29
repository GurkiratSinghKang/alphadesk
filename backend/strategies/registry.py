"""Strategy registry — thin compatibility re-export layer.

All registration now lives in :mod:`strategies._core.protocol`. This module
keeps the callers that still ``from strategies.registry import …`` working
by re-exporting the new names, and preserves the route-id taxonomy
(``IMPLEMENTED_STRATEGY_ROUTE_IDS`` / ``PLANNED_STRATEGY_ROUTE_IDS``)
the frontend / API route-id translation still depends on.

Usage:

.. code-block:: python

    from strategies.registry import load_all, get_strategy, list_strategies

    load_all()                     # triggers @register_strategy side-effects
    names = [m.name for m in list_strategies()]
    cls = get_strategy("pead")
    instance = cls()               # new ABC: direct instantiation

Strategy authors should import directly from ``strategies._core.protocol``.
This module exists only to smooth the migration for in-flight callers.
"""

from __future__ import annotations

import importlib
import logging
import os
import pkgutil
import sys
from typing import Optional

from strategies._core.protocol import (
    Strategy,
    StrategyMeta,
    _REGISTRY,
    get_meta as _core_get_meta,
    get_strategy as _core_get_strategy,
    list_strategies as _core_list_strategies,
    register_strategy,
)

log = logging.getLogger("alphadesk.strategies.registry")


class StrategyRegistrationError(RuntimeError):
    """Raised when a strategy cannot be registered."""


# --------------------------------------------------------------------------- #
# Re-exports (thin wrappers so callers using the legacy shapes keep working)  #
# --------------------------------------------------------------------------- #
def get_strategy(name: str):
    """Return the *class* registered under ``name``, or raise KeyError."""
    cls = _core_get_strategy(name)
    if cls is None:
        known = sorted(m.name for m in _core_list_strategies())
        raise KeyError(f"Strategy {name!r} is not registered. Known: {known}")
    return cls


def get_meta(name: str) -> StrategyMeta:
    """Return the :class:`StrategyMeta` for ``name``, or raise KeyError."""
    meta = _core_get_meta(name)
    if meta is None:
        known = sorted(m.name for m in _core_list_strategies())
        raise KeyError(f"Strategy {name!r} is not registered. Known: {known}")
    return meta


def list_strategies() -> list[StrategyMeta]:
    """Return metadata for all currently-registered strategies, sorted by name."""
    return sorted(_core_list_strategies(), key=lambda m: m.name)


def list_names() -> list[str]:
    """Return just the registered names (shortcut for common UI code)."""
    return sorted(m.name for m in _core_list_strategies())


def unregister(name: str) -> None:
    """Remove ``name`` from the registry. Primarily for tests."""
    _REGISTRY.pop(name, None)


def clear() -> None:
    """Wipe the registry. Primarily for tests."""
    _REGISTRY.clear()


# --------------------------------------------------------------------------- #
# Package walker                                                              #
# --------------------------------------------------------------------------- #
# The package we scan for ``@register_strategy`` side-effects.
_PACKAGE = os.environ.get("ALPHADESK_STRATEGIES_PACKAGE", "strategies")


def load_all(package: Optional[str] = None) -> list[str]:
    """Walk ``package`` and import every submodule, triggering registration.

    Modules that fail to import are logged and skipped — a single broken
    strategy does not stop the rest from loading. Returns the list of
    fully-qualified module names that were imported successfully.
    """
    target = package or _PACKAGE
    imported: list[str] = []
    try:
        pkg = importlib.import_module(target)
    except Exception as exc:  # pragma: no cover
        log.error("load_all: cannot import %s: %s", target, exc)
        return imported

    if not hasattr(pkg, "__path__"):
        return imported

    def _on_walk_error(mod_name: str) -> None:
        exc = sys.exc_info()[1]
        log.error("load_all: skipping %s (import failed: %s)", mod_name, exc)

    for mod_info in pkgutil.walk_packages(
        pkg.__path__, prefix=f"{target}.", onerror=_on_walk_error,
    ):
        name = mod_info.name
        if ".tests" in name or name.endswith(".tests") or name.endswith(".conftest"):
            continue
        try:
            importlib.import_module(name)
            imported.append(name)
        except Exception as exc:
            log.error("load_all: skipping %s (import failed: %s)", name, exc)
            continue
    return imported


# --------------------------------------------------------------------------- #
# Implementation-stage taxonomy (surface the catalogue knows about)           #
# --------------------------------------------------------------------------- #
#: Strategies that ship a working Python package under
#: ``backend/strategies/`` or are legacy route aliases to one. Route-id form
#: (hyphens), matching the frontend.
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
    # Legacy alias retained for API compatibility; backed by pairs_trading.
    "pairs-stat-arb",
    "kama-breakout",
    "orb",
    "vwap-strategy",
    "earnings-options-play",
})

#: Strategies advertised in the catalogue but not yet implemented.
PLANNED_STRATEGY_ROUTE_IDS: frozenset[str] = frozenset({
    "claude-alpha",
    "dividend-capture",
    "gap-fill",
    "mean-reversion",
    "sector-rotation",
    "vcp-breakout",
})


def implementation_stage(route_id: str) -> str:
    """Return ``"live"`` / ``"planned"`` / ``"other"`` for a frontend route-id."""
    if route_id in IMPLEMENTED_STRATEGY_ROUTE_IDS:
        return "live"
    if route_id in PLANNED_STRATEGY_ROUTE_IDS:
        return "planned"
    return "other"


def is_implemented(route_id: str) -> bool:
    """True iff the route-id has a real backend package."""
    return route_id in IMPLEMENTED_STRATEGY_ROUTE_IDS


__all__ = [
    # Re-exported from _core.protocol
    "register_strategy",
    "Strategy",
    "StrategyMeta",
    # Compatibility lookups
    "get_strategy",
    "get_meta",
    "list_strategies",
    "list_names",
    "unregister",
    "clear",
    "load_all",
    "StrategyRegistrationError",
    # Taxonomy
    "IMPLEMENTED_STRATEGY_ROUTE_IDS",
    "PLANNED_STRATEGY_ROUTE_IDS",
    "implementation_stage",
    "is_implemented",
]
