"""AlphaDesk backtest engine.

Event-driven, bar-by-bar backtester with walk-forward support. Supports equities
and multi-leg options. Money in ``Decimal``, ratios in ``float``.

Public surface:

    from backend.backtest.types import Bar, Signal, Fill, Position, Trade, Context, BacktestResult
    from backend.backtest.types import OrderType, TimeInForce, Side
    from backend.backtest.portfolio import Portfolio
    from backend.backtest.execution import ExecutionSimulator
    from backend.backtest.costs import CostModel, DefaultCostModel
    from backend.backtest.engine import BacktestEngine
    from backend.backtest.metrics import summary_dict
    from backend.backtest.walkforward import WalkForwardRunner
    from backend.backtest.report import ReportWriter
"""

from backend.backtest.types import (
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
