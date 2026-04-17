"""KAMA Breakout strategy package.

Importing this package fires the ``@register_strategy`` decorator on
:class:`KamaBreakout` and registers it under the name ``"kama_breakout"``.

See ``spec.md`` for the academic spec and ``strategy.py`` for the code.

Uses a relative import so the package can be loaded either as
``backend.strategies.kama_breakout`` (the canonical path used by the
registry's ``load_all()``) or as ``strategies.kama_breakout`` (the legacy
alias that ``backend/strategies/__init__.py`` still uses) without a
circular import.
"""

from .strategy import KamaBreakout

# Legacy name for backward compat with the pre-Phase-2
# ``backend/strategies/__init__.py`` dict-based registry.
KAMABreakoutStrategy = KamaBreakout

__all__ = ["KamaBreakout", "KAMABreakoutStrategy"]
