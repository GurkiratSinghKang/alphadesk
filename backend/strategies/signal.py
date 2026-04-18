"""Signal + OptionLeg re-exports for strategy authors.

The authoritative types live in :mod:`backend.backtest.types` (team F1's
engine). Strategy code imports from *this* module so Phase 2 can relocate the
engine freely without touching every strategy package.

Notes for strategy authors
--------------------------

- ``Signal`` takes *either* ``target_weight`` (portfolio fraction in
  ``[-1.0, 1.0]``) *or* ``quantity`` (raw signed share / contract count). Set
  exactly one.
- ``order_type`` defaults to :attr:`OrderType.MKT`. Use ``MOC`` to fill on the
  current bar's close and ``MOO`` to fill on the next bar's open. ``LMT``
  fills only when the next bar's range crosses ``limit_price``.
- For options spreads, leave the equity fields alone and fill ``legs`` with a
  tuple of :class:`OptionLeg`. The engine will simulate each leg's fill.
- ``stop_price`` and ``take_profit`` are stored on the :class:`Position` after
  the fill; the engine raises :class:`OrderType.STOP` / :class:`OrderType.TP`
  exits automatically when the market crosses them.

Example
-------

.. code-block:: python

    from decimal import Decimal
    from strategies.signal import Signal, OptionLeg, OrderType, Side

    # Go 100% long SPY on today's close
    sig = Signal(symbol="SPY", target_weight=1.0, order_type=OrderType.MOC)

    # Short straddle on SPY (one spread unit = one call + one put)
    legs = (
        OptionLeg(contract_id="O:SPY240119C00475000", side=Side.SELL, qty=1),
        OptionLeg(contract_id="O:SPY240119P00475000", side=Side.SELL, qty=1),
    )
    straddle = Signal(symbol="SPY", quantity=1, legs=legs)

The canonical field definitions live in
:mod:`backend.backtest.types`; see that module for full attribute docstrings.
"""

from __future__ import annotations

from backtest.types import (
    OptionLeg,
    OrderType,
    Side,
    Signal,
    TimeInForce,
)

__all__ = [
    "Signal",
    "OptionLeg",
    "OrderType",
    "Side",
    "TimeInForce",
]
