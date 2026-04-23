"""Strategies package — decorator-registered strategy subpackages.

All migrated strategies live under ``backend/strategies/<name>/`` and
register themselves via :func:`strategies._core.protocol.register_strategy`.
The legacy ``BaseStrategy`` ABC, its single-file modules, and
``strategies/base.py`` were removed in Task 19 of the Strategy SOTA
Foundation plan. Unmigrated strategy packages (Phase 3 work) still import
from the deleted ``strategies.base`` and will fail to load — that is
expected and absorbed by :func:`strategies.registry.load_all`.

Public lookup:

    from strategies._core.protocol import list_strategies, get_strategy

    cls = get_strategy("pead")
"""

from __future__ import annotations

import logging

logger = logging.getLogger("alphadesk.strategies")


def get_strategy(name: str):
    """Legacy shim — prefer :func:`backend.strategies.registry.get_strategy`.

    Forwards to the registry so any remaining callers keep working. Returns
    an *instance* (the registry returns the class); kept for the handful of
    call-sites that still expect the pre-registry behaviour.
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
