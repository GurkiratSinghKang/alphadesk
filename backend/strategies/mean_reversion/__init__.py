"""Mean Reversion (slow / quality-conditioned) — long-only weekly reversal book.

Importing this package fires the ``@register_strategy`` decorator on
:class:`MeanReversionStrategy`, registering it under ``"mean_reversion"``
in the ``strategies._core.protocol`` registry.

Distinct from :mod:`strategies.rsi2_reversal` (which is a 2-3 session
Connors RSI(2) book). This is a ~30-trading-day reversal with a
fundamental-quality gate on top.
"""

from .strategy import MeanReversionStrategy

__all__ = ["MeanReversionStrategy"]
