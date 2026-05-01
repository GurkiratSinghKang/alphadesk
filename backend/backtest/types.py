"""Shared backtest domain types.

This module is intentionally small and dependency-light. Execution,
portfolio, reporting, and tests all import from here so the option
backtest path has one coherent contract for bars, signals, fills, and
positions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Mapping


def _d(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


class AssetClass(Enum):
    EQUITY = "equity"
    OPTION = "option"
    MULTILEG = "multileg"


class Side(Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(Enum):
    MKT = "MKT"
    MOO = "MOO"
    MOC = "MOC"
    LMT = "LMT"
    STOP = "STOP"
    TP = "TP"


class TimeInForce(Enum):
    DAY = "DAY"
    GTC = "GTC"
    IOC = "IOC"


@dataclass(frozen=True)
class Bar:
    symbol: str
    ts: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int | float = 0


@dataclass(frozen=True)
class OptionLeg:
    contract_id: str
    side: Side
    qty: int = 1
    underlying: str | None = None
    expiry: date | None = None
    strike: Decimal | None = None
    right: str | None = None
    multiplier: int = 100


@dataclass
class Signal:
    symbol: str
    quantity: int | None = None
    target_weight: float | Decimal | None = None
    order_type: OrderType = OrderType.MKT
    time_in_force: TimeInForce = TimeInForce.DAY
    limit_price: Decimal | None = None
    stop_price: Decimal | None = None
    take_profit: Decimal | None = None
    legs: tuple[OptionLeg, ...] = field(default_factory=tuple)
    tag: str = ""
    asof: date | datetime | None = None


@dataclass
class Fill:
    symbol: str
    ts: datetime
    side: Side
    quantity: int
    price: Decimal
    commission: Decimal = Decimal("0")
    slippage: Decimal = Decimal("0")
    legs: tuple[OptionLeg, ...] = field(default_factory=tuple)
    leg_prices: tuple[Decimal, ...] = field(default_factory=tuple)
    tag: str = ""

    @property
    def signed_quantity(self) -> int:
        return int(self.quantity) if self.side is Side.BUY else -int(self.quantity)


@dataclass
class Position:
    symbol: str
    quantity: int
    avg_price: Decimal
    asset_class: AssetClass = AssetClass.EQUITY
    opened_at: datetime | None = None
    last_price: Decimal | None = None
    realized_pnl: Decimal = Decimal("0")
    multiplier: int = 1
    underlying: str | None = None
    expiry: date | None = None
    strike: Decimal | None = None
    right: str | None = None
    stop_price: Decimal | None = None
    take_profit: Decimal | None = None
    tag: str = ""

    @property
    def is_flat(self) -> bool:
        return int(self.quantity) == 0

    @property
    def is_short(self) -> bool:
        return int(self.quantity) < 0

    def market_value(self, price: Decimal | float | int | str) -> Decimal:
        return Decimal(self.quantity) * _d(price) * Decimal(self.multiplier or 1)

    def unrealized_pnl(self, price: Decimal | float | int | str) -> Decimal:
        return (
            Decimal(self.quantity)
            * (_d(price) - self.avg_price)
            * Decimal(self.multiplier or 1)
        )


@dataclass
class Trade:
    symbol: str
    side: Side
    quantity: int
    entry_ts: datetime
    entry_price: Decimal
    exit_ts: datetime | None = None
    exit_price: Decimal | None = None
    pnl: Decimal = Decimal("0")
    commission: Decimal = Decimal("0")
    tag: str = ""

    @property
    def is_closed(self) -> bool:
        return self.exit_ts is not None


@dataclass
class Context:
    asof: date | None = None
    positions: Mapping[str, Position] = field(default_factory=dict)
    cash: Decimal = Decimal("0")
    equity: Decimal = Decimal("0")
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class BacktestResult:
    strategy_name: str
    start: date | None
    end: date | None
    params: Mapping[str, Any]
    metrics: dict[str, float]
    equity_curve: Any
    trades: list[Trade] = field(default_factory=list)
    fills: list[Fill] = field(default_factory=list)
    daily_returns: Any = None
    audit_metadata: dict[str, Any] = field(default_factory=dict)


__all__ = [
    "AssetClass",
    "BacktestResult",
    "Bar",
    "Context",
    "Fill",
    "OptionLeg",
    "OrderType",
    "Position",
    "Side",
    "Signal",
    "TimeInForce",
    "Trade",
]
