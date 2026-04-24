"""Regime-Adaptive asset-allocation strategy.

Importing this package fires the ``@register_strategy`` decorator on
:class:`RegimeAdaptiveStrategy`, registering it under
``"regime_adaptive"`` in the ``strategies._core.protocol`` registry.
"""

from .strategy import RegimeAdaptiveStrategy

__all__ = ["RegimeAdaptiveStrategy"]
