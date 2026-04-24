"""vwap strategy package.

Importing this module fires the ``@register_strategy`` decorator on
:class:`VWAPStrategy`, registering it under ``"vwap"`` in the
``strategies._core.protocol`` registry.
"""

from .strategy import VWAPStrategy

__all__ = ["VWAPStrategy"]
