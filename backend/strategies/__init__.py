"""Legacy strategies aggregator — kept as empty stub during Phase 1.

The top-level `backend.strategies` package was previously a flat module tree
with a STRATEGIES dict. Phase 1 is migrating each strategy into its own
subpackage (e.g. `backend.strategies.rsi2_reversal`) registered via the new
`backend.strategies.registry` decorator. The legacy flat imports collide with
the new subpackages (circular import), so the aggregator is emptied here.

Phase 2 will delete the legacy flat modules entirely. Until then, use the
registry: `from backend.strategies.registry import get_strategy, load_all`.
"""

from __future__ import annotations

import logging

from strategies.base import BaseStrategy

logger = logging.getLogger("alphadesk.strategies")

STRATEGIES: dict[str, type[BaseStrategy]] = {}


def get_strategy(name: str) -> BaseStrategy | None:
    """Legacy shim — prefer backend.strategies.registry.get_strategy.

    Forwards to the new registry so any remaining callers keep working.
    """

    try:
        from strategies.registry import get_strategy as _new_get
        cls = _new_get(name)
        return cls() if cls else None
    except Exception:
        logger.debug(
            "strategies.get_strategy(%s) shim: registry lookup failed",
            name, exc_info=True,
        )
        return None
