# backend/strategies/_core/providers.py
"""Provider abstractions + factories. Thin facades over existing AlphaDesk
backend provider classes (AlpacaBarProvider, FMPEarningsProvider, etc).

Runners accept a ProviderBundle rather than individual providers so
tests can swap in fakes easily.
"""
from __future__ import annotations

from datetime import date
from typing import Protocol

import pandas as pd


class BarProvider(Protocol):
    def fetch_window(
        self, symbols: list[str], asof: date, lookback_days: int
    ) -> pd.DataFrame:
        """Return bars for `symbols` over the `lookback_days` window ending at `asof`.

        Returned DataFrame has columns (open, high, low, close, volume) and
        a multi-index of (date, symbol). Missing symbols are omitted silently;
        callers handle empty windows.
        """
        ...


class EarningsProvider(Protocol):
    def fetch_window(
        self, symbols: list[str], asof: date, lookback_days: int
    ) -> pd.DataFrame:
        """Return earnings announcements for `symbols` over the window.

        DataFrame columns: symbol, report_date, report_time (BMO/AMC/DMT),
        eps_actual, eps_est, surprise.
        """
        ...


class FundamentalsProvider(Protocol):
    def snapshot(
        self, symbols: list[str], asof: date
    ) -> pd.DataFrame:
        """Return a point-in-time fundamentals snapshot for `symbols` on `asof`."""
        ...


class ProviderBundle:
    """Container for all providers a strategy might need. Not all strategies
    use all providers; missing providers are None and accessed via conditional
    checks in the runner."""

    def __init__(
        self,
        bars: BarProvider,
        earnings: EarningsProvider | None = None,
        fundamentals: FundamentalsProvider | None = None,
    ):
        self.bars = bars
        self.earnings = earnings
        self.fundamentals = fundamentals


def default_provider_bundle() -> ProviderBundle:
    """Return a ProviderBundle wired to the current AlphaDesk backend providers.

    Uses lazy imports to avoid circular-import issues when strategies/_core
    is imported at module-load time by the registry machinery.

    Raises ImportError or configuration errors if backend providers are not
    properly configured (e.g. missing ALPACA_API_KEY). Tests that exercise
    this function should be marked skipif ALPACA_API_KEY is unset.
    """
    # Lazy imports to keep strategies/_core/ independent of data/providers.
    from data.providers.alpaca import AlpacaBarProvider
    from data.providers.fmp_earnings import FMPEarningsProvider

    return ProviderBundle(
        bars=AlpacaBarProvider(),
        earnings=FMPEarningsProvider(),
        fundamentals=None,
    )
