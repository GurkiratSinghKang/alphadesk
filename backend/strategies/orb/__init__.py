"""ORB (Opening Range Breakout) strategy package.

Importing this module fires the ``@register_strategy`` decorator on
:class:`ORBStrategy`, registering it under ``"orb"`` in the
``strategies._core.protocol`` registry.
"""

from .strategy import ORBStrategy

__all__ = ["ORBStrategy"]
