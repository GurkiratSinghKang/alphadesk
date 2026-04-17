"""Provider protocols that every vendor adapter must satisfy.

These Protocols are the one and only contract the backtest engine, the
strategies and the tuner depend on. Concrete adapters (Alpaca, Polygon, FMP)
implement whichever protocols apply. A fake in-memory provider can be dropped
in for unit tests.

Every method returns a ``pandas.DataFrame`` with a documented schema — never a
raw ``dict`` or ``list``. This keeps downstream code vectorised and avoids
vendor-specific JSON shapes leaking into strategy logic.

See ``docs/superpowers/specs/2026-04-17-strategy-overhaul-design.md`` §5.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Iterable, Protocol, runtime_checkable

import pandas as pd


# --------------------------------------------------------------------------- #
# Bar data                                                                    #
# --------------------------------------------------------------------------- #
@runtime_checkable
class BarProvider(Protocol):
    """Historical OHLCV bars for a universe of symbols.

    Implementations: :class:`backend.data.providers.alpaca.AlpacaBarProvider`,
    :class:`backend.data.providers.polygon.PolygonStockBarProvider`.
    """

    def bars(
        self,
        symbols: Iterable[str],
        start: date | datetime | str,
        end: date | datetime | str,
        tf: str = "1D",
    ) -> pd.DataFrame:
        """Return OHLCV bars for ``symbols`` from ``start`` to ``end`` inclusive.

        Args:
            symbols: Iterable of ticker symbols (e.g. ``["SPY", "QQQ"]``).
            start: First calendar day (naive date or ISO string).
            end: Last calendar day (inclusive).
            tf: Timeframe. Canonical values: ``"1D"`` (daily), ``"1min"``,
                ``"5min"``, ``"15min"``, ``"1H"``. Adapters may support
                additional strings and should document them.

        Returns:
            DataFrame with columns
            ``[symbol, ts, open, high, low, close, volume, vwap, n_trades]``.
            ``ts`` is a UTC-aware ``datetime64[ns, UTC]`` at the bar's
            opening timestamp. Split/dividend adjusted where the vendor
            supports it. Sorted by ``(symbol, ts)`` ascending.
        """
        ...


# --------------------------------------------------------------------------- #
# Options                                                                     #
# --------------------------------------------------------------------------- #
@runtime_checkable
class OptionsProvider(Protocol):
    """Options chain, per-contract bars and historical IV.

    Implementation: :class:`backend.data.providers.polygon.PolygonOptionsProvider`.
    """

    def chain_snapshot(
        self, underlying: str, asof: date | datetime | str
    ) -> pd.DataFrame:
        """Full option chain for ``underlying`` at a point in time.

        Args:
            underlying: Equity ticker (e.g. ``"SPY"``).
            asof: Calendar date. If the vendor does not expose historical
                snapshots on the Developer tier, implementations fall back to
                the current live snapshot and log the deviation.

        Returns:
            DataFrame with columns
            ``[contract_ticker, underlying, expiration, strike,
            option_type, bid, ask, last, volume, open_interest,
            iv, delta, gamma, theta, vega, rho, asof]``.
            ``option_type`` is ``"call"`` or ``"put"``. Greeks may be NaN for
            older snapshots. Row count can be tens of thousands for liquid
            underlyings.
        """
        ...

    def contract_bars(
        self,
        contract: str,
        start: date | datetime | str,
        end: date | datetime | str,
        tf: str = "1D",
    ) -> pd.DataFrame:
        """Historical OHLCV bars for a specific options contract.

        Args:
            contract: Polygon-style contract ticker, e.g.
                ``"O:SPY240119C00475000"``.
            start: First calendar day (inclusive).
            end: Last calendar day (inclusive).
            tf: Bar timeframe.

        Returns:
            DataFrame with columns
            ``[contract, ts, open, high, low, close, volume, vwap, n_trades]``.
            ``ts`` is UTC-aware. Sorted by ``ts`` ascending.
        """
        ...

    def historical_iv(
        self,
        underlying: str,
        start: date | datetime | str,
        end: date | datetime | str,
    ) -> pd.DataFrame:
        """Daily at-the-money implied volatility history for ``underlying``.

        Args:
            underlying: Equity ticker.
            start: First calendar day (inclusive).
            end: Last calendar day (inclusive).

        Returns:
            DataFrame with columns ``[date, underlying, iv_atm_30d,
            iv_atm_60d, iv_atm_90d]``. Missing tenors are NaN.
        """
        ...


# --------------------------------------------------------------------------- #
# Earnings                                                                    #
# --------------------------------------------------------------------------- #
@runtime_checkable
class EarningsProvider(Protocol):
    """Earnings calendar, historical surprises and analyst consensus.

    Implementation: :class:`backend.data.providers.fmp.FMPEarningsProvider`.
    """

    def calendar(
        self,
        start: date | datetime | str,
        end: date | datetime | str,
        symbols: Iterable[str] | None = None,
    ) -> pd.DataFrame:
        """All upcoming/historical earnings releases in a date window.

        Args:
            start: First calendar day (inclusive).
            end: Last calendar day (inclusive).
            symbols: Optional filter to this set; ``None`` → entire market.

        Returns:
            DataFrame with columns ``[symbol, date, eps_actual, eps_estimated,
            revenue_actual, revenue_estimated, last_updated]``. ``date`` is a
            Python ``date``. ``eps_actual`` is NaN for future releases.
        """
        ...

    def surprises(
        self,
        symbol: str,
        start: date | datetime | str,
        end: date | datetime | str,
    ) -> pd.DataFrame:
        """Per-quarter earnings history + SUE (standardised unexpected earnings).

        SUE is computed as
        ``(eps_actual - eps_estimated) / stdev(last N surprises)`` with N=8
        rolling (i.e. two years of quarters).

        Args:
            symbol: Equity ticker.
            start: First calendar day.
            end: Last calendar day.

        Returns:
            DataFrame with columns ``[symbol, date, eps_actual, eps_estimated,
            surprise, surprise_pct, sue, revenue_actual, revenue_estimated]``.
            Sorted by ``date`` ascending.
        """
        ...

    def consensus(self, symbol: str, asof: date | datetime | str) -> dict:
        """Analyst consensus EPS/revenue estimate for the next release.

        Args:
            symbol: Equity ticker.
            asof: Point-in-time date.

        Returns:
            ``{"symbol": str, "next_earnings_date": date,
            "eps_estimated": float, "revenue_estimated": float}``.
            Fields are NaN/None when no consensus is published.
        """
        ...


# --------------------------------------------------------------------------- #
# Fundamentals                                                                #
# --------------------------------------------------------------------------- #
@runtime_checkable
class FundamentalsProvider(Protocol):
    """Point-in-time financial statements and derived scores.

    Implementation: :class:`backend.data.providers.fmp.FMPFundamentalsProvider`.
    """

    def statements(self, symbol: str, asof: date | datetime | str) -> dict:
        """Most-recent annual income / balance / cash-flow statements at ``asof``.

        Only statements filed on or before ``asof`` are returned — no
        look-ahead bias.

        Args:
            symbol: Equity ticker.
            asof: Point-in-time date.

        Returns:
            ``{"income": DataFrame, "balance": DataFrame, "cashflow": DataFrame,
            "profile": dict}``. Each DataFrame holds the most-recent 5 annual
            rows with fiscal-period columns (``revenue``, ``netIncome``,
            ``totalAssets``, ``operatingCashFlow`` …).
        """
        ...

    def piotroski_f(self, symbol: str, asof: date | datetime | str) -> int:
        """Piotroski F-score (0–9) as of ``asof``, using latest annual data.

        Nine binary tests across profitability (4), leverage/liquidity (3) and
        operating efficiency (2). See Piotroski 2000 for definitions.

        Returns:
            Integer in ``[0, 9]``. Raises ``ValueError`` if fewer than two
            annual statements are available (score requires YoY deltas).
        """
        ...


# --------------------------------------------------------------------------- #
# Calendar                                                                    #
# --------------------------------------------------------------------------- #
@runtime_checkable
class CalendarProvider(Protocol):
    """Trading-session metadata for the US equity market.

    Implementation: :class:`backend.data.calendar.USMarketCalendar`.
    """

    def sessions(
        self, start: date | datetime | str, end: date | datetime | str
    ) -> pd.DatetimeIndex:
        """All NYSE/NASDAQ trading days in ``[start, end]``."""
        ...

    def is_trading_day(self, d: date | datetime | str) -> bool:
        """True iff ``d`` is a regular or early-close session."""
        ...

    def next_session(self, d: date | datetime | str) -> date:
        """First trading day strictly after ``d``."""
        ...

    def session_hours(self, d: date | datetime | str) -> tuple[datetime, datetime]:
        """UTC-aware ``(open, close)`` for session on ``d``; handles half days."""
        ...
