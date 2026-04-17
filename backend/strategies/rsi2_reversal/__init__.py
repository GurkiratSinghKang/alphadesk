"""rsi2_reversal strategy package.

Importing this module fires the ``@register_strategy`` decorator on
:class:`RSI2ReversalStrategy`, registering it under ``"rsi2_reversal"`` in
the strategy registry.

Uses a relative import so the package can be loaded either as
``backend.strategies.rsi2_reversal`` (the canonical path used by the
registry's ``load_all()``) or as ``strategies.rsi2_reversal`` (the legacy
alias from ``backend/strategies/__init__.py``) without a circular import.
The decorator itself is wrapped with :func:`strategy._safe_register` so
double-loading under both module paths is tolerated.
"""

from .strategy import RSI2ReversalStrategy

__all__ = ["RSI2ReversalStrategy"]
