# backend/tests/_core/test_providers.py
"""Provider abstraction + factory tests. Adapters over the existing FMP/Alpaca code."""
from __future__ import annotations

import os
from datetime import date

import pandas as pd
import pytest

from strategies._core.providers import (
    BarProvider,
    EarningsProvider,
    FundamentalsProvider,
    ProviderBundle,
    default_provider_bundle,
)


def test_bar_provider_protocol_has_fetch_window():
    assert hasattr(BarProvider, "fetch_window")


def test_provider_bundle_instantiates_with_three_providers():
    class FakeBars:
        def fetch_window(self, symbols, asof, lookback_days):
            return pd.DataFrame()

    class FakeEarnings:
        def fetch_window(self, symbols, asof, lookback_days):
            return pd.DataFrame()

    class FakeFundamentals:
        def snapshot(self, symbols, asof):
            return pd.DataFrame()

    bundle = ProviderBundle(
        bars=FakeBars(),
        earnings=FakeEarnings(),
        fundamentals=FakeFundamentals(),
    )
    assert bundle.bars is not None
    assert bundle.earnings is not None


@pytest.mark.skipif(
    os.environ.get("ALPACA_API_KEY") is None,
    reason="ALPACA_API_KEY not set — skipping live provider instantiation",
)
def test_default_provider_bundle_returns_bundle():
    """default_provider_bundle() returns a bundle with default backend providers.
    Not all strategies use earnings/fundamentals, so those may be None."""
    bundle = default_provider_bundle()
    assert bundle.bars is not None  # bars provider is required
