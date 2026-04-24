"""Global Equities Momentum (GEM) — Antonacci's Dual Momentum.

Importing this package fires the ``@register_strategy`` decorator on
:class:`DualMomentumStrategy`, registering it under ``"dual_momentum"`` in
the ``strategies._core.protocol`` registry.
"""

from .strategy import DualMomentumStrategy

__all__ = ["DualMomentumStrategy"]
