"""Time-Series Momentum (TSMOM) — Moskowitz-Ooi-Pedersen 2012.

Importing this package fires the ``@register_strategy`` decorator on
:class:`TSMomentumStrategy`, registering it under ``"ts_momentum"`` in the
``strategies._core.protocol`` registry.
"""

from .strategy import TSMomentumStrategy

__all__ = ["TSMomentumStrategy"]
