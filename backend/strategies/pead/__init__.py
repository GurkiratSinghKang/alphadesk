"""pead strategy package.

Importing this module fires the ``@register_strategy`` decorator on
:class:`PEADStrategy`, registering it under ``"pead"`` in the strategy
registry. Same layout as the other Phase 1 packages (rsi2_reversal,
momentum_quality, dual_momentum, ...).

Uses a relative import so the package loads either as
``backend.strategies.pead`` (canonical, used by ``load_all()``) or as
``strategies.pead`` (legacy alias). The ``_safe_register`` shim in
:mod:`.strategy` tolerates double-loading under both module paths.
"""

from .strategy import PEADStrategy

__all__ = ["PEADStrategy"]
