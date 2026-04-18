"""AlphaDesk backtest engine.

Event-driven, bar-by-bar backtester with walk-forward support. Supports equities
and multi-leg options. Money in ``Decimal``, ratios in ``float``.

Public surface:

    from backtest.types import Bar, Signal, Fill, Position, Trade, Context, BacktestResult
    from backtest.types import OrderType, TimeInForce, Side
    from backtest.portfolio import Portfolio
    from backtest.execution import ExecutionSimulator
    from backtest.costs import CostModel, DefaultCostModel
    from backtest.engine import BacktestEngine
    from backtest.metrics import summary_dict
    from backtest.walkforward import WalkForwardRunner
    from backtest.report import ReportWriter
"""

from backtest.types import (
    Bar,
    Fill,
    Signal,
    Position,
    OptionLeg,
    Trade,
    Context,
    BacktestResult,
    OrderType,
    TimeInForce,
    Side,
)

__all__ = [
    "Bar",
    "Fill",
    "Signal",
    "Position",
    "OptionLeg",
    "Trade",
    "Context",
    "BacktestResult",
    "OrderType",
    "TimeInForce",
    "Side",
]
