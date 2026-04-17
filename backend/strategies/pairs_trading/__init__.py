"""pairs_trading strategy package.

Importing this module fires the ``@register_strategy`` decorator on
:class:`PairsTradingStrategy`, registering it under ``"pairs_trading"``
in the strategy registry.

The class implements cointegration-gated, dollar-neutral pairs trading
on a sector-grouped ~50-ticker US large-cap universe. See ``spec.md``
for the full academic spec.
"""

from .strategy import PairsTradingStrategy

__all__ = ["PairsTradingStrategy"]
