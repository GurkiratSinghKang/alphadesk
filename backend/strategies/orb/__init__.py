"""ORB (Opening Range Breakout) strategy package.

Importing this module fires the ``@register_strategy`` decorator on
:class:`ORBStrategy`, registering it under ``"orb"`` in the strategy
registry. The decorator is wrapped with ``_safe_register`` so double-loading
under the canonical + legacy module paths is tolerated.
"""

from .strategy import ORBStrategy, OrbDayResult

__all__ = ["ORBStrategy", "OrbDayResult"]
