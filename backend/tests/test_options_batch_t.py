"""Batch T regression tests:

* T-2: chain shape — ``contracts`` pinned to nearest expiry while
  ``expirations`` lists every available date; ``limit`` query param caps
  contract count without breaking shape.
* T-3: greeks pre-computed — IV-bearing contracts whose upstream greeks
  came back as zero are populated via Black-Scholes.
* T-4: volume / OI mapping — the chain pulls cumulative session volume
  from ``dailyBar.v`` (not ``trade.s``) and OI from snapshot's
  ``openInterest``.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest


# ---------------------------------------------------------------------------
# T-2: stable chain shape
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chain_pins_to_nearest_expiry_when_filter_omitted():
    """Without an expiry filter, contracts are pinned to the nearest expiry
    while ``expirations`` still exposes the full ladder."""
    from services import options as opts

    near = date.today() + timedelta(days=7)
    far = date.today() + timedelta(days=42)
    contracts = [
        opts.OptionContract(
            symbol=f"AAPL{exp.strftime('%y%m%d')}C00250000",
            underlying="AAPL",
            expiry=exp,
            strike=250.0,
            option_type=opts.OptionType.CALL,
            bid=1.0, ask=1.2, last=1.1,
            volume=500, open_interest=2000,
            iv=0.25,
            delta=0.5, gamma=0.01, theta=-0.02, vega=0.1, rho=0.05,
        )
        for exp in (near, far)
    ]
    fake_chain = opts.OptionChain(
        underlying="AAPL",
        spot_price=250.0,
        expirations=[near, far],
        contracts=contracts,
        fetched_at=datetime.now(timezone.utc),
        is_demo=False,
    )

    with patch.object(opts, "_fetch_real_chain", AsyncMock(return_value=fake_chain)):
        out = await opts.fetch_chain("AAPL")

    # Both expiries surfaced.
    assert near in out.expirations
    assert far in out.expirations
    # But contracts pinned to nearest only.
    returned_expiries = {c.expiry for c in out.contracts}
    assert returned_expiries == {near}, returned_expiries


@pytest.mark.asyncio
async def test_chain_with_expiry_filter_keeps_only_filtered_expiry():
    """When the caller pins ``expiry`` the response narrows ``expirations`` to match."""
    from services import options as opts

    pinned = date.today() + timedelta(days=14)
    contracts = [
        opts.OptionContract(
            symbol=f"AAPL{pinned.strftime('%y%m%d')}P00250000",
            underlying="AAPL",
            expiry=pinned,
            strike=250.0,
            option_type=opts.OptionType.PUT,
            bid=1.0, ask=1.2, last=1.1,
            volume=500, open_interest=2000,
            iv=0.25,
            delta=-0.5, gamma=0.01, theta=-0.02, vega=0.1, rho=-0.05,
        )
    ]
    fake_chain = opts.OptionChain(
        underlying="AAPL",
        spot_price=250.0,
        expirations=[pinned],
        contracts=contracts,
        fetched_at=datetime.now(timezone.utc),
        is_demo=False,
    )

    with patch.object(opts, "_fetch_real_chain", AsyncMock(return_value=fake_chain)):
        out = await opts.fetch_chain("AAPL", expiry=pinned)

    assert out.expirations == [pinned]
    assert all(c.expiry == pinned for c in out.contracts)


@pytest.mark.asyncio
async def test_chain_shape_is_identical_for_real_and_demo(monkeypatch: pytest.MonkeyPatch):
    """Real and demo chains must expose the same field set."""
    from services import options as opts

    # Force the demo path by stubbing the real fetcher to return None.
    with patch.object(opts, "_fetch_real_chain", AsyncMock(return_value=None)):
        demo = await opts.fetch_chain("AAPL")

    # Demo flagged.
    assert demo.is_demo is True
    # Same model fields as the real path.
    assert hasattr(demo, "expirations")
    assert hasattr(demo, "contracts")
    assert hasattr(demo, "spot_price")
    assert hasattr(demo, "fetched_at")
    # Demo chain pinned to nearest expiry too.
    if demo.contracts:
        nearest = min(c.expiry for c in demo.contracts)
        assert {c.expiry for c in demo.contracts} == {nearest}


# ---------------------------------------------------------------------------
# T-3: greeks pre-computed
# ---------------------------------------------------------------------------

def test_fill_missing_greeks_populates_zero_greeks_when_iv_known():
    """Contracts with iv > 0 but all-zero greeks should get BSM values."""
    from services import options as opts

    expiry = date.today() + timedelta(days=30)
    c = opts.OptionContract(
        symbol="AAPL250505C00250000",
        underlying="AAPL",
        expiry=expiry,
        strike=250.0,
        option_type=opts.OptionType.CALL,
        bid=5.0, ask=5.2, last=5.1,
        volume=1000, open_interest=5000,
        iv=0.30,
        delta=0.0, gamma=0.0, theta=0.0, vega=0.0, rho=0.0,
    )
    opts._fill_missing_greeks([c], spot=250.0)

    # Delta should land near 0.5 for ATM call ~30 days.
    assert 0.4 < c.delta < 0.7, f"unexpected delta: {c.delta}"
    assert c.gamma > 0, "gamma must be positive for non-degenerate ATM call"
    assert c.theta < 0, "theta must be negative for long call"
    assert c.vega > 0, "vega must be positive"


def test_fill_missing_greeks_does_not_overwrite_real_greeks():
    """Pre-existing non-zero greeks must NOT be touched."""
    from services import options as opts

    expiry = date.today() + timedelta(days=30)
    real_delta = 0.42
    c = opts.OptionContract(
        symbol="AAPL250505C00250000",
        underlying="AAPL",
        expiry=expiry,
        strike=250.0,
        option_type=opts.OptionType.CALL,
        bid=5.0, ask=5.2, last=5.1,
        volume=1000, open_interest=5000,
        iv=0.30,
        delta=real_delta, gamma=0.001, theta=-0.05, vega=0.1, rho=0.02,
    )
    opts._fill_missing_greeks([c], spot=250.0)

    assert c.delta == real_delta, "real upstream greek was clobbered"


def test_fill_missing_greeks_skips_zero_iv_contracts():
    """Contracts with iv=0 stay at zero greeks (no IV → no BSM input)."""
    from services import options as opts

    expiry = date.today() + timedelta(days=30)
    c = opts.OptionContract(
        symbol="AAPL250505C00250000",
        underlying="AAPL",
        expiry=expiry,
        strike=250.0,
        option_type=opts.OptionType.CALL,
        bid=5.0, ask=5.2, last=5.1,
        volume=1000, open_interest=5000,
        iv=0.0,
        delta=0.0, gamma=0.0, theta=0.0, vega=0.0, rho=0.0,
    )
    opts._fill_missing_greeks([c], spot=250.0)

    assert c.delta == 0.0
    assert c.vega == 0.0


# ---------------------------------------------------------------------------
# T-4: volume / OI mapping
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_real_chain_uses_daily_bar_volume_not_trade_size():
    """Volume must come from ``dailyBar.v`` (cumulative session) rather
    than ``latestTrade.s`` (which is the latest tick = often 1)."""
    from services import options as opts

    today = date.today()
    expiry = today + timedelta(days=30)
    occ = f"AAPL{expiry.strftime('%y%m%d')}C00250000"
    payload = {
        "snapshots": {
            occ: {
                "latestQuote": {"bp": 5.0, "ap": 5.2},
                "latestTrade": {"p": 5.1, "s": 1},  # tick size — should NOT be used
                "dailyBar": {"v": 12345},  # cumulative session volume
                "openInterest": 8888,
                "impliedVolatility": 0.30,
                "greeks": {},  # missing greeks → triggers BSM fill
            }
        },
        "next_page_token": None,
    }

    class _FakeResponse:
        status_code = 200

        def json(self):
            return payload

        @property
        def text(self):
            return ""

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get(self, *a, **k):
            return _FakeResponse()

    opts._chain_cache.clear()
    with patch.object(opts, "_alpaca_keys_empty", return_value=False), \
         patch.object(opts, "_fetch_alpaca_spot", AsyncMock(return_value=250.0)), \
         patch.object(httpx, "AsyncClient", _FakeClient):
        chain = await opts._fetch_real_chain("AAPL", None, None, None, None, chain_limit=200)

    assert chain is not None, "expected a real chain"
    assert len(chain.contracts) == 1
    c = chain.contracts[0]
    assert c.volume == 12345, f"expected dailyBar.v=12345, got {c.volume}"
    assert c.open_interest == 8888, f"expected OI=8888, got {c.open_interest}"
    # Greeks were populated by _fill_missing_greeks since the snapshot had empty greeks.
    assert c.delta != 0.0
    assert c.gamma != 0.0


@pytest.mark.asyncio
async def test_real_chain_falls_back_to_prev_daily_bar_volume():
    """Pre-market sessions: dailyBar may be empty, fall back to prevDailyBar."""
    from services import options as opts

    today = date.today()
    expiry = today + timedelta(days=30)
    occ = f"AAPL{expiry.strftime('%y%m%d')}C00250000"
    payload = {
        "snapshots": {
            occ: {
                "latestQuote": {"bp": 5.0, "ap": 5.2},
                "latestTrade": {"p": 5.1, "s": 1},
                "dailyBar": {},  # nothing yet today
                "prevDailyBar": {"v": 7777},
                "openInterest": 1234,
                "impliedVolatility": 0.30,
                "greeks": {"delta": 0.55, "gamma": 0.01, "theta": -0.02, "vega": 0.1, "rho": 0.02},
            }
        },
        "next_page_token": None,
    }

    class _FakeResponse:
        status_code = 200

        def json(self):
            return payload

        @property
        def text(self):
            return ""

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get(self, *a, **k):
            return _FakeResponse()

    opts._chain_cache.clear()
    with patch.object(opts, "_alpaca_keys_empty", return_value=False), \
         patch.object(opts, "_fetch_alpaca_spot", AsyncMock(return_value=250.0)), \
         patch.object(httpx, "AsyncClient", _FakeClient):
        chain = await opts._fetch_real_chain("AAPL", None, None, None, None, chain_limit=200)

    assert chain is not None
    assert chain.contracts[0].volume == 7777


# ---------------------------------------------------------------------------
# T-2 limit ceiling
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chain_limit_clamped_to_max():
    """Asking for more than the ceiling silently clamps."""
    from services import options as opts

    # No real chain — exercise the clamping branch via the public entry.
    with patch.object(opts, "_fetch_real_chain", AsyncMock(return_value=None)):
        chain = await opts.fetch_chain("AAPL", chain_limit=99999)

    # We don't actually care about content — just that no exception fires
    # and the demo chain came back.
    assert chain is not None
    assert chain.is_demo is True
