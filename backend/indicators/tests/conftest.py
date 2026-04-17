"""Shared test fixtures for indicators.

Pytest is run from the repo root; this conftest ensures the
``backend.indicators`` import path works.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Make the repo root importable so `from backend.indicators import ...` works
_THIS = Path(__file__).resolve()
_REPO_ROOT = _THIS.parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np
import pandas as pd
import pytest


@pytest.fixture(scope="session")
def synthetic_close() -> pd.Series:
    """A 200-bar daily random-walk close series (deterministic seed)."""
    rng = np.random.default_rng(seed=42)
    steps = rng.normal(loc=0.0005, scale=0.01, size=200)
    prices = 100 * np.exp(np.cumsum(steps))
    idx = pd.date_range("2024-01-02", periods=200, freq="B")
    return pd.Series(prices, index=idx, name="close", dtype="float64")


@pytest.fixture(scope="session")
def synthetic_ohlcv(synthetic_close) -> pd.DataFrame:
    rng = np.random.default_rng(seed=7)
    close = synthetic_close.to_numpy()
    spread = np.abs(rng.normal(0.5, 0.2, size=len(close)))
    high = close + spread
    low = close - spread
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    volume = rng.integers(low=1_000_000, high=5_000_000, size=len(close)).astype(float)
    return pd.DataFrame(
        {
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        },
        index=synthetic_close.index,
        dtype="float64",
    )


@pytest.fixture(scope="session")
def spy_daily():
    """Real SPY daily bars via Alpaca, or skip if unavailable.

    Lazy-imported inside the fixture so test collection doesn't require
    alpaca-py. Skips the test if credentials are missing or alpaca-py is
    not installed in the current environment.
    """
    try:
        from alpaca.data.historical import StockHistoricalDataClient  # type: ignore
        from alpaca.data.requests import StockBarsRequest  # type: ignore
        from alpaca.data.timeframe import TimeFrame  # type: ignore
    except ImportError:
        pytest.skip("alpaca-py not installed; skipping real-data test")

    api_key = os.getenv("ALPACA_API_KEY")
    secret = os.getenv("ALPACA_SECRET_KEY") or os.getenv("ALPACA_API_SECRET")
    if not api_key or not secret:
        pytest.skip("ALPACA_API_KEY / ALPACA_SECRET_KEY not set; skipping")

    client = StockHistoricalDataClient(api_key, secret)
    req = StockBarsRequest(
        symbol_or_symbols="SPY",
        timeframe=TimeFrame.Day,
        start="2023-01-01",
        end="2024-01-01",
    )
    bars = client.get_stock_bars(req).df
    if isinstance(bars.index, pd.MultiIndex):
        bars = bars.xs("SPY", level=0)
    return bars.astype("float64")
