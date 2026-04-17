"""vwap strategy package.

Importing this module fires the ``@register_strategy`` decorator on
:class:`VWAPSessionStrategy`, registering it under ``"vwap"`` in the strategy
registry.
"""

from .strategy import VWAPSessionStrategy

__all__ = ["VWAPSessionStrategy"]
