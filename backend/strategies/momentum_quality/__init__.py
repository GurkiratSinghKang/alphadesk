"""Momentum + Quality strategy package.

Importing this module fires ``@register_strategy`` on
:class:`MomentumQualityStrategy`, registering it under ``"momentum_quality"``
in the ``strategies._core.protocol`` registry.
"""

from .strategy import MomentumQualityStrategy

__all__ = ["MomentumQualityStrategy"]
