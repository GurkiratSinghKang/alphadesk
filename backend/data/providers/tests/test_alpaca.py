"""Integration tests for :class:`AlpacaBarProvider`.

These hit the live Alpaca API — we have a paid subscription, cost is nil.
Mark them ``integration`` so CI can skip if needed.
"""

from __future__ import annotations

import pytest

from core.config import settings
from data.providers.alpaca import AlpacaBarProvider

_alpaca_key = settings.ALPACA_API_KEY.get_secret_value()
_alpaca_secret = settings.ALPACA_SECRET_KEY.get_secret_value()

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not (_alpaca_key and _alpaca_secret),
        reason="ALPACA_API_KEY / ALPACA_SECRET_KEY not set; skipping live API tests",
    ),
]


@pytest.fixture(scope="module")
def provider():
    with AlpacaBarProvider() as p:
        yield p


def test_daily_bars_single_symbol(provider):
    df = provider.bars(["SPY"], "2024-01-02", "2024-01-05")
    assert len(df) >= 3
    assert set(df.columns) == {
        "symbol", "ts", "open", "high", "low", "close",
        "volume", "vwap", "n_trades",
    }
    assert (df["symbol"] == "SPY").all()
    assert df["close"].min() > 0


def test_daily_bars_multi_symbol(provider):
    df = provider.bars(["SPY", "QQQ"], "2024-01-02", "2024-01-05")
    assert len(df) >= 6
    assert set(df["symbol"]) == {"SPY", "QQQ"}
    # sorted by (symbol, ts)
    for sym, sub in df.groupby("symbol"):
        assert sub["ts"].is_monotonic_increasing


def test_ts_is_tz_aware_utc(provider):
    df = provider.bars(["SPY"], "2024-01-02", "2024-01-05")
    dt = str(df["ts"].dtype)
    # pandas 2.x emits [ns, UTC]; pandas 3.x emits [us, UTC] — both are fine.
    assert dt.startswith("datetime64[") and dt.endswith(", UTC]")


def test_empty_symbols_returns_empty(provider):
    df = provider.bars([], "2024-01-02", "2024-01-05")
    assert len(df) == 0


def test_invalid_tf_raises(provider):
    with pytest.raises(ValueError):
        provider.bars(["SPY"], "2024-01-02", "2024-01-05", tf="1sec")
