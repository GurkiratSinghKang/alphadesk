"""Earnings Volatility (short iron butterfly) strategy package.

Importing this module fires the ``@register_strategy`` decorator on
:class:`EarningsVolStrategy`, registering it under ``"earnings_vol"`` in the
strategy registry.

Uses a relative import so the package can be loaded either as
``backend.strategies.earnings_vol`` (the canonical path used by the
registry's ``load_all()``) or as ``strategies.earnings_vol`` (the legacy
alias from ``backend/strategies/__init__.py``) without a circular import.
The decorator itself is wrapped with ``_safe_register`` so double-loading
under both module paths is tolerated.
"""

from .strategy import EarningsVolStrategy

__all__ = ["EarningsVolStrategy"]
