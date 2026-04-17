"""Data provider layer for AlphaDesk strategy backtesting and live pipeline.

This package defines vendor-agnostic ``Protocol``s in :mod:`base` plus concrete
implementations for Alpaca (:mod:`alpaca`), Polygon (:mod:`polygon`) and
Financial Modeling Prep (:mod:`fmp`). All providers return pandas DataFrames
with documented schemas so strategy code can be swapped between vendors.

A ``ParquetCache`` in :mod:`cache` memoises any provider method to
``~/.alphadesk/cache`` keyed by (provider, method, args).
"""

from backend.data.providers.base import (
    BarProvider,
    CalendarProvider,
    EarningsProvider,
    FundamentalsProvider,
    OptionsProvider,
)

__all__ = [
    "BarProvider",
    "CalendarProvider",
    "EarningsProvider",
    "FundamentalsProvider",
    "OptionsProvider",
]
