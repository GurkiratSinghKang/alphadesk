"""KAMA Breakout strategy package.

Importing this package fires the ``@register_strategy`` decorator on
:class:`KamaBreakoutStrategy` and registers it under ``"kama_breakout"``
in the ``strategies._core.protocol`` registry.
"""

from .strategy import KamaBreakoutStrategy

__all__ = ["KamaBreakoutStrategy"]
