"""rsi2_reversal strategy package.

Importing this package fires the ``@register_strategy`` decorator on
:class:`RSI2ReversalStrategy`, registering it under ``"rsi2_reversal"`` in
the ``strategies._core.protocol`` registry.
"""

from .strategy import RSI2ReversalStrategy

__all__ = ["RSI2ReversalStrategy"]
