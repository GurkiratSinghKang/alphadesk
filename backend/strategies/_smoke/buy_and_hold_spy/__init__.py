"""buy_and_hold_spy smoke-test strategy.

Imported for its registration side-effect: the class below is registered
with the strategy registry via ``@register_strategy`` when the module is
imported (directly or via :func:`backend.strategies.registry.load_all`).
"""

from strategies._smoke.buy_and_hold_spy.strategy import BuyAndHoldSPY

__all__ = ["BuyAndHoldSPY"]
