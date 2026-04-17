"""Integration tests for :class:`PolygonOptionsProvider`."""

from __future__ import annotations

from datetime import date

import pytest

from backend.data.providers.polygon import PolygonOptionsProvider

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def provider():
    with PolygonOptionsProvider() as p:
        yield p


def test_contract_bars(provider):
    df = provider.contract_bars(
        "O:SPY240119C00475000", date(2024, 1, 2), date(2024, 1, 12)
    )
    assert len(df) >= 7
    assert set(df.columns) == {
        "contract", "ts", "open", "high", "low", "close",
        "volume", "vwap", "n_trades",
    }
    assert (df["contract"] == "O:SPY240119C00475000").all()


def test_chain_snapshot_live(provider):
    today = date.today()
    df = provider.chain_snapshot("SPY", today)
    # Live chain is always thousands of rows for SPY when the market is open
    # or recently closed. Weekends can be quiet but still return contracts.
    assert len(df) > 0
    required = {
        "contract_ticker", "underlying", "expiration", "strike", "option_type",
        "iv", "delta", "gamma", "theta", "vega",
    }
    assert required.issubset(df.columns)
    # On live snapshots at least some Greeks should be populated.
    assert df["delta"].notna().any()


@pytest.mark.slow
def test_chain_snapshot_historical(provider):
    # SPY chain for any day spans ~380k contracts across all expirations;
    # this test takes ~30s because it paginates the full universe.
    df = provider.chain_snapshot("SPY", date(2024, 1, 2))
    assert len(df) > 100
    # Per spec, Greeks may be empty on older snapshots — don't assert on them
    assert (df["underlying"] == "SPY").all()


def test_historical_iv_returns_frame(provider):
    df = provider.historical_iv("SPY", "2024-01-02", "2024-01-12")
    # The Developer-tier implementation is intentionally a no-op that returns
    # an empty frame; we just assert the schema.
    assert set(df.columns) == {
        "date", "underlying", "iv_atm_30d", "iv_atm_60d", "iv_atm_90d",
    }
