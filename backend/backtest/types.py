"""Shared types for the backtest engine.

Money is represented as :class:`decimal.Decimal` everywhere. Floats are used
only for ratios (weights, returns, metrics) where decimal precision is not
meaningful.

This module also exposes :class:`Protocol` stubs for the data-provider and
``Strategy`` interfaces so the engine can be typechecked and run before teams
F2 / F4 land their concrete implementations. The engine tries to import the
real protocols from :mod:`backend.data.providers.base` and
:mod:`backend.strategies.base` first, and falls back to the local stubs when
those packages do not yet exist.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import (
    Any,
    Iterable,
    Mapping,
    Optional,
    Protocol,
    TYPE_CHECKING,
    runtime_checkable,
)

if TYPE_CHECKING:
    import pandas as pd


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class Side(str, enum.Enum):
    """Which side of the market a fill / position is on."""

    BUY = "buy"
    SELL = "sell"

    @property
    def sign(self) -> int:
        """+1 for a buy, -1 for a sell."""

        return 1 if self is Side.BUY else -1


class OrderType(str, enum.Enum):
    """Supported order types.

    ``MKT``  -- fill at the current bar's close (immediately).
    ``LMT``  -- fill only if the next bar's range crosses the limit price.
    ``MOO``  -- market-on-open: fill at the next bar's open.
    ``MOC``  -- market-on-close: fill at the current bar's close.
    ``STOP`` -- stop order: triggered when the market crosses ``stop_price``.
    ``TP``   -- take-profit: triggered when the market crosses ``take_profit``.
    """

    MKT = "market"
    LMT = "limit"
    MOO = "market_on_open"
    MOC = "market_on_close"
    STOP = "stop"
    TP = "take_profit"


class TimeInForce(str, enum.Enum):
    """Order-lifetime directive."""

    DAY = "day"
    GTC = "gtc"
    IOC = "ioc"


class AssetClass(str, enum.Enum):
    EQUITY = "equity"
    OPTION = "option"
    MULTILEG = "multileg"


# ---------------------------------------------------------------------------
# Market data
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Bar:
    """A single OHLCV bar.

    Prices are ``Decimal`` so we never convert traded quantities through IEEE
    floats. Adjusted close is optional; when supplied it carries split and
    dividend information (adjusted-close convention).
    """

    symbol: str
    ts: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int = 0
    adjusted_close: Optional[Decimal] = None
    # Optional corporate action info. Populated by providers that know the
    # action for this bar (the most common case is `split_ratio=2.0` on a 2:1
    # split day and `dividend` being the cash dividend paid on ex-date).
    split_ratio: Decimal = Decimal("1")
    dividend: Decimal = Decimal("0")

    @property
    def ts_date(self) -> date:
        return self.ts.date() if isinstance(self.ts, datetime) else self.ts


# ---------------------------------------------------------------------------
# Orders, signals, fills
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OptionLeg:
    """A single leg of a multi-leg option order/position."""

    contract_id: str
    side: Side
    qty: int
    limit_price: Optional[Decimal] = None

    # Informational contract metadata. The engine does not rely on these
    # fields to simulate fills, but cost models and P&L accounting can use
    # them when present.
    underlying: Optional[str] = None
    expiry: Optional[date] = None
    strike: Optional[Decimal] = None
    right: Optional[str] = None  # "C" / "P"
    multiplier: int = 100


@dataclass(frozen=True)
class Signal:
    """A signal emitted by a ``Strategy`` for a particular symbol.

    Exactly one of ``target_weight`` or ``quantity`` must be set:

    * ``target_weight`` -- a portfolio weight in ``[-1.0, 1.0]``.
    * ``quantity``      -- a raw signed share / contract count.

    ``legs`` is a list of :class:`OptionLeg` describing a multi-leg options
    order. When populated, the equity fields are ignored and the order is
    treated as a spread whose fills are simulated leg-by-leg.
    """

    symbol: str
    target_weight: Optional[float] = None
    quantity: Optional[int] = None
    stop_price: Optional[Decimal] = None
    take_profit: Optional[Decimal] = None
    legs: tuple[OptionLeg, ...] = field(default_factory=tuple)
    order_type: OrderType = OrderType.MKT
    time_in_force: TimeInForce = TimeInForce.GTC
    limit_price: Optional[Decimal] = None
    tag: str = ""
    # When the signal was generated. The engine enforces no-look-ahead: a
    # signal issued on bar T can only fill on bar T (MOC) or bar T+1 (MOO).
    asof: Optional[date] = None

    def asset_class(self) -> AssetClass:
        if self.legs:
            return AssetClass.MULTILEG
        return AssetClass.EQUITY


@dataclass(frozen=True)
class Fill:
    """A completed fill.

    For single-leg equity / option fills ``price`` is the fill price and
    ``legs`` is empty.

    For multi-leg option fills ``price`` is the **net per-spread premium**
    (positive for a net credit, negative for a net debit — sign is consistent
    with the ``side`` of the parent :class:`Signal`: a SELL spread has
    ``side=Side.SELL`` and a positive net credit flows into cash). ``legs``
    carries the individual :class:`OptionLeg` records, and ``leg_prices``
    carries each leg's *per-contract* fill price (already slippage-adjusted)
    in the same order as ``legs``. The portfolio uses ``leg_prices`` when
    booking leg-by-leg :class:`Position` state; the net ``price`` remains
    the canonical cashflow summary for analytics.
    """

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
        return self.side.sign * self.quantity

    @property
    def notional(self) -> Decimal:
        return Decimal(self.quantity) * self.price


# ---------------------------------------------------------------------------
# Portfolio state
# ---------------------------------------------------------------------------


@dataclass
class Position:
    """A single open position.

    For equities: ``symbol`` is the ticker, ``quantity`` is signed (negative
    means short), ``avg_price`` is the volume-weighted average cost.

    For options legs (``asset_class == AssetClass.OPTION``): ``symbol`` is the
    contract ticker (e.g. ``O:SPY240119C00475000``), ``quantity`` is signed
    (negative = short leg), ``avg_price`` is the per-contract premium paid or
    received, ``multiplier`` is the contract multiplier (typically 100),
    ``underlying`` is the stock ticker, and ``expiry`` / ``strike`` / ``right``
    are carried for reporting and lifecycle (expiry-based closes).

    The historical ``AssetClass.MULTILEG`` form is still accepted for legacy
    call sites that pre-date the per-leg model; in that mode ``legs`` carries
    the full leg tuple and ``avg_price`` is a net per-spread premium.
    """

    symbol: str
    quantity: int = 0
    avg_price: Decimal = Decimal("0")
    asset_class: AssetClass = AssetClass.EQUITY
    legs: tuple[OptionLeg, ...] = field(default_factory=tuple)
    realized_pnl: Decimal = Decimal("0")
    opened_at: Optional[datetime] = None
    last_price: Decimal = Decimal("0")
    stop_price: Optional[Decimal] = None
    take_profit: Optional[Decimal] = None
    tag: str = ""
    # Option-leg metadata. Only populated when ``asset_class == OPTION``.
    multiplier: int = 1
    underlying: Optional[str] = None
    expiry: Optional[date] = None
    strike: Optional[Decimal] = None
    right: Optional[str] = None  # "C" / "P"

    @property
    def is_long(self) -> bool:
        return self.quantity > 0

    @property
    def is_short(self) -> bool:
        return self.quantity < 0

    @property
    def is_flat(self) -> bool:
        return self.quantity == 0

    def market_value(self, price: Decimal) -> Decimal:
        """Current market value of the position (signed).

        Equities: ``quantity * price``.
        Options legs: ``quantity * price * multiplier`` because option prices
        quote per-share but each contract controls ``multiplier`` shares.
        Legacy MULTILEG: treated like equities (net per-spread price is
        already baked in).
        """

        if self.asset_class is AssetClass.OPTION:
            return Decimal(self.quantity) * price * Decimal(self.multiplier or 100)
        return Decimal(self.quantity) * price

    def unrealized_pnl(self, price: Decimal) -> Decimal:
        if self.quantity == 0:
            return Decimal("0")
        if self.asset_class is AssetClass.OPTION:
            return (
                Decimal(self.quantity)
                * (price - self.avg_price)
                * Decimal(self.multiplier or 100)
            )
        return Decimal(self.quantity) * (price - self.avg_price)


@dataclass
class Trade:
    """A round-trip trade (entry -> exit)."""

    symbol: str
    side: Side
    quantity: int
    entry_ts: datetime
    entry_price: Decimal
    exit_ts: Optional[datetime] = None
    exit_price: Optional[Decimal] = None
    pnl: Decimal = Decimal("0")
    commission: Decimal = Decimal("0")
    tag: str = ""

    @property
    def is_closed(self) -> bool:
        return self.exit_ts is not None


# ---------------------------------------------------------------------------
# Context handed to strategies on each call
# ---------------------------------------------------------------------------


@dataclass
class Context:
    """Mutable context object passed to ``Strategy`` hooks.

    The engine populates the provider handles once and updates ``asof`` on
    every bar before calling strategy hooks. Strategies may stash private
    state on ``state`` -- the engine treats that dict as opaque.
    """

    asof: date
    cash: Decimal
    equity: Decimal
    positions: list[Position] = field(default_factory=list)
    bar_provider: Any = None
    options_provider: Any = None
    earnings_provider: Any = None
    fundamentals_provider: Any = None
    calendar_provider: Any = None
    params: dict[str, Any] = field(default_factory=dict)
    state: dict[str, Any] = field(default_factory=dict)

    def position(self, symbol: str) -> Optional[Position]:
        for p in self.positions:
            if p.symbol == symbol:
                return p
        return None


# ---------------------------------------------------------------------------
# Backtest result
# ---------------------------------------------------------------------------


@dataclass
class BacktestResult:
    """Output of a single backtest run."""

    equity_curve: "pd.DataFrame"  # columns: date, cash, equity, positions_value
    trades: list[Trade]
    fills: list[Fill]
    daily_returns: "pd.Series"
    metrics: dict[str, float]
    params: dict[str, Any] = field(default_factory=dict)
    start: Optional[date] = None
    end: Optional[date] = None
    strategy_name: str = ""


# ---------------------------------------------------------------------------
# Protocol stubs (temporary -- teams F2 / F4 will replace these)
# ---------------------------------------------------------------------------


@runtime_checkable
class BarProviderProto(Protocol):
    """Subset of ``BarProvider`` the engine depends on."""

    def bars(self, symbols, start, end, tf: str = "1D"):  # pragma: no cover
        ...


@runtime_checkable
class OptionsProviderProto(Protocol):
    def chain_snapshot(self, underlying, asof):  # pragma: no cover
        ...

    def contract_bars(self, contract, start, end, tf: str = "1D"):  # pragma: no cover
        ...

    def historical_iv(self, underlying, start, end):  # pragma: no cover
        ...


@runtime_checkable
class EarningsProviderProto(Protocol):
    def calendar(self, start, end, symbols=None):  # pragma: no cover
        ...

    def surprises(self, symbol, start, end):  # pragma: no cover
        ...

    def consensus(self, symbol, asof):  # pragma: no cover
        ...


@runtime_checkable
class FundamentalsProviderProto(Protocol):
    def statements(self, symbol, asof):  # pragma: no cover
        ...

    def piotroski_f(self, symbol, asof):  # pragma: no cover
        ...


@runtime_checkable
class CalendarProviderProto(Protocol):
    def sessions(self, start, end):  # pragma: no cover
        ...


@runtime_checkable
class StrategyProto(Protocol):
    """Stub of the ``Strategy`` protocol (section 5 of the design doc)."""

    name: str
    required_bars: list[str]
    required_lookback_days: int

    def configure(self, params: Mapping[str, Any]) -> None:  # pragma: no cover
        ...

    def universe(self, asof: date, ctx: Context) -> Iterable[str]:  # pragma: no cover
        ...

    def generate_signals(
        self, asof: date, ctx: Context
    ) -> Iterable[Signal]:  # pragma: no cover
        ...

    def on_fill(self, fill: Fill, ctx: Context) -> None:  # pragma: no cover
        ...

    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:  # pragma: no cover
        ...


# Re-export whichever names the rest of the package should import. Engine code
# should use these aliases so we can swap to the real provider / strategy
# modules by changing a single import block in a downstream package.
BarProvider = BarProviderProto
OptionsProvider = OptionsProviderProto
EarningsProvider = EarningsProviderProto
FundamentalsProvider = FundamentalsProviderProto
CalendarProvider = CalendarProviderProto
Strategy = StrategyProto


__all__ = [
    # enums
    "Side",
    "OrderType",
    "TimeInForce",
    "AssetClass",
    # data
    "Bar",
    # orders
    "OptionLeg",
    "Signal",
    "Fill",
    # portfolio
    "Position",
    "Trade",
    # context + result
    "Context",
    "BacktestResult",
    # protocol stubs
    "BarProvider",
    "OptionsProvider",
    "EarningsProvider",
    "FundamentalsProvider",
    "CalendarProvider",
    "Strategy",
]
