"""Strategies package — decorator-registered strategy subpackages.

All strategies live in their own subpackage under ``backend/strategies/``
(e.g. ``backend.strategies.rsi2_reversal``) and register themselves via the
:mod:`backend.strategies.registry` decorator. The legacy ``BaseStrategy``
ABC and its single-file strategy modules have been removed — use the
:class:`backend.strategies.base.Strategy` protocol for new work.

Public lookup:

    from strategies.registry import load_all, get_strategy

    load_all()
    cls = get_strategy("rsi2_reversal")
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
