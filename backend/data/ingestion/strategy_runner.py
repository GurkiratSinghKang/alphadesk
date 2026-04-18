"""Legacy strategy runner facade — thin compatibility shim over Phase 2-C.

Historically this module defined ``BaseStrategyRunner`` and a dozen concrete
``<Name>Runner`` classes that implemented both Phase 0 discovery/scoring and
Phase 1-lite screening-by-demo-RNG.  Phase 2-C replaces the whole mess with
adapters over the Phase 1 registry: :class:`~.strategy_adapter.LiveStrategyAdapter`
wraps each registered :class:`~backend.strategies.base.Strategy` and exposes
the legacy ``screen() / analyze() / generate_trades()`` API consumed by
:mod:`.daily_pipeline`.

Public surface
--------------

* ``BaseStrategyRunner`` — re-exported from
  :mod:`.strategy_adapter` so downstream imports keep working.
* ``ALL_STRATEGIES`` — a list of adapter *subclasses*, one per registered
  (non-smoke) strategy.  Dynamically built at import time from the registry,
  so adding a strategy under ``backend/strategies/<name>/`` automatically
  flows through.
* ``get_screener_results(strategy_name=None, limit=100)`` — replacement for
  the old ``_get_screener_results`` demo path.  Delegates to the adapter's
  ``screen()`` method.  With ``strategy_name=None`` it aggregates across the
  monthly momentum/quality universe which is what ``daily_pipeline.py`` wants
  when it populates ``MasterAgent.MOMENTUM_DATA``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from data.ingestion.strategy_adapter import (
    BaseStrategyRunner,
    LiveStrategyAdapter,
    build_all_strategies,
)

logger = logging.getLogger("alphadesk.strategy_runner")

# --------------------------------------------------------------------------- #
# Dynamic registry-backed ALL_STRATEGIES                                      #
# --------------------------------------------------------------------------- #
# Built once at import time.  The ``LiveStrategyAdapter.screen/analyze`` hooks
# already call ``load_all()`` lazily — we run it here too so a failure to
# discover strategies surfaces at import rather than deep inside the pipeline.
ALL_STRATEGIES: list[type[LiveStrategyAdapter]] = build_all_strategies()

logger.info(
    "strategy_runner: loaded %d adapters from registry (%s)",
    len(ALL_STRATEGIES), [cls.name for cls in ALL_STRATEGIES],
)


# --------------------------------------------------------------------------- #
# Public helpers                                                              #
# --------------------------------------------------------------------------- #
async def get_screener_results(
    strategy_name: str | None = None, limit: int = 100,
) -> list[dict[str, Any]]:
    """Return a list of screener-style dicts for pipeline consumption.

    Replaces the old ``_get_screener_results`` which read from
    ``api.routes.screener._generate_demo_screener_results`` — the RNG-backed
    demo path the Phase 2 audit flagged as a P0.

    With ``strategy_name`` given, delegates to that strategy adapter's
    ``screen()`` method.  Without, aggregates across the momentum/quality
    strategy (whose universe is the closest match to the old demo list).
    Each entry has at minimum ``{"symbol", "price"}``; ``change_pct`` and
    ``sector`` are filled from Alpaca when available, or left at defaults.

    Fully async: callers in an event loop must ``await`` this. Pure-sync
    callers can use :func:`get_screener_results_sync` below, which starts a
    fresh event loop via ``asyncio.run`` only when no loop is running.
    """
    # Select the adapter(s) to query.
    adapters: list[LiveStrategyAdapter] = []
    if strategy_name:
        for cls in ALL_STRATEGIES:
            if cls.name == strategy_name:
                adapters.append(cls())
                break
        if not adapters:
            logger.warning(
                "get_screener_results: no adapter for %r — returning empty",
                strategy_name,
            )
            return []
    else:
        # Default to the momentum_quality universe (largest, daily cadence).
        for cls in ALL_STRATEGIES:
            if cls.name == "momentum_quality":
                adapters.append(cls())
                break
        if not adapters and ALL_STRATEGIES:
            adapters.append(ALL_STRATEGIES[0]())

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for adapter in adapters:
        try:
            rows = await adapter.screen()
        except Exception as e:
            logger.warning(
                "get_screener_results: %s.screen() failed: %s", adapter.name, e,
            )
            continue
        for r in rows:
            sym = r.get("symbol")
            if not sym or sym in seen:
                continue
            seen.add(sym)
            out.append({
                "symbol": sym,
                "name": r.get("name", sym),
                "price": r.get("price", 0.0),
                "sector": r.get("sector", "Unknown"),
                "change_pct": r.get("change_pct", 0.0),
                "volume": r.get("volume", 0),
                "composite_score": r.get("composite_score", 0.0),
                "metrics": r.get("metrics", {}),
            })
            if len(out) >= limit:
                return out
    return out


def get_screener_results_sync(
    strategy_name: str | None = None, limit: int = 100,
) -> list[dict[str, Any]]:
    """Synchronous wrapper for callers that are NOT inside an event loop.

    Raises :class:`RuntimeError` if called from inside a running loop — the
    correct call there is ``await get_screener_results(...)``. This prevents
    the previous anti-pattern of spinning a new event loop in a thread pool,
    which blocked the outer loop and created a new httpx connection pool per
    call.
    """
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = None
    if loop is not None and loop.is_running():
        raise RuntimeError(
            "get_screener_results_sync called from inside a running event loop; "
            "use `await get_screener_results(...)` instead."
        )
    return asyncio.run(get_screener_results(strategy_name, limit))


__all__ = [
    "BaseStrategyRunner",
    "LiveStrategyAdapter",
    "ALL_STRATEGIES",
    "get_screener_results",
    "get_screener_results_sync",
]
