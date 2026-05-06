"""Wave V V1-1 / V1-2 / V1-3 / V1-4 — volume signals.

Covers:
  * V1-1: relative_volume math against a mocked Polygon ADV20 fetch.
  * V1-2: chain-level call/put volume + OI aggregates sum correctly.
  * V1-3: per-contract volume_oi_ratio edge cases.
  * V1-4: liquidity_score known cases (great / mediocre / dead).

All tests run offline — Polygon / Alpaca HTTP layers are mocked.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest


# ---------------------------------------------------------------------------
# V1-1: relative_volume math
# ---------------------------------------------------------------------------


def test_compute_relative_volume_typical_case():
    """volume=1.5M / ADV=1.0M -> 1.5 (a-day day)."""
    from services.market import _compute_relative_volume

    assert _compute_relative_volume(1_500_000, 1_000_000) == 1.5


def test_compute_relative_volume_quiet_day():
    """volume=400k / ADV=1.0M -> 0.4 (quiet)."""
    from services.market import _compute_relative_volume

    assert _compute_relative_volume(400_000, 1_000_000) == 0.4


def test_compute_relative_volume_returns_none_for_missing_adv():
    """Missing ADV must NOT fabricate a ratio — returns None."""
    from services.market import _compute_relative_volume

    assert _compute_relative_volume(500_000, None) is None
    assert _compute_relative_volume(500_000, 0) is None


def test_compute_relative_volume_returns_none_for_zero_volume():
    """Zero today-volume returns None (we need a numerator)."""
    from services.market import _compute_relative_volume

    assert _compute_relative_volume(0, 1_000_000) is None
    assert _compute_relative_volume(None, 1_000_000) is None


@pytest.mark.asyncio
async def test_fetch_avg_daily_volume_20d_mocked_polygon():
    """ADV20 = sum(20 most recent daily volumes) / 20."""
    from services import market

    # Build a fake Polygon /v2/aggs response: 20 daily bars at 1M each.
    daily_bars = [{"v": 1_000_000} for _ in range(20)]

    class _FakeResponse:
        status_code = 200

        def json(self):
            return {"results": daily_bars, "queryCount": 20, "resultsCount": 20}

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

    import httpx

    with patch.object(market, "_polygon_key_empty", return_value=False), \
         patch.object(httpx, "AsyncClient", _FakeClient), \
         patch("core.redis.cache_get", AsyncMock(return_value=None)), \
         patch("core.redis.cache_set", AsyncMock(return_value=None)):
        adv = await market._fetch_avg_daily_volume_20d("AAPL")

    assert adv == 1_000_000


@pytest.mark.asyncio
async def test_fetch_avg_daily_volume_20d_returns_none_for_short_history():
    """Newly listed symbols (< 20 daily bars) return None — not a partial avg."""
    from services import market

    # Only 10 daily bars available — should return None rather than averaging.
    daily_bars = [{"v": 1_000_000} for _ in range(10)]

    class _FakeResponse:
        status_code = 200

        def json(self):
            return {"results": daily_bars}

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

    import httpx

    with patch.object(market, "_polygon_key_empty", return_value=False), \
         patch.object(httpx, "AsyncClient", _FakeClient), \
         patch("core.redis.cache_get", AsyncMock(return_value=None)), \
         patch("core.redis.cache_set", AsyncMock(return_value=None)):
        adv = await market._fetch_avg_daily_volume_20d("NEWLY_LISTED")

    assert adv is None


@pytest.mark.asyncio
async def test_fetch_avg_daily_volume_20d_no_polygon_key_returns_none():
    """No Polygon key configured -> None (no fabrication)."""
    from services import market

    with patch.object(market, "_polygon_key_empty", return_value=True):
        adv = await market._fetch_avg_daily_volume_20d("AAPL")

    assert adv is None


# ---------------------------------------------------------------------------
# V1-3: volume_oi_ratio edge cases
# ---------------------------------------------------------------------------


def test_volume_oi_ratio_typical():
    """vol=200, oi=100 -> 2.0."""
    from services.options import _compute_volume_oi_ratio

    assert _compute_volume_oi_ratio(200, 100) == 2.0


def test_volume_oi_ratio_zero_volume():
    """vol=0, oi=500 -> 0.0 (no fresh activity, all carry)."""
    from services.options import _compute_volume_oi_ratio

    assert _compute_volume_oi_ratio(0, 500) == 0.0


def test_volume_oi_ratio_zero_oi_with_volume_clamps_divisor():
    """vol=50, oi=0 -> 50.0 (divisor clamped to 1, fresh activity / no carry)."""
    from services.options import _compute_volume_oi_ratio

    assert _compute_volume_oi_ratio(50, 0) == 50.0


def test_volume_oi_ratio_both_zero_returns_none():
    """vol=0, oi=0 -> None (no information)."""
    from services.options import _compute_volume_oi_ratio

    assert _compute_volume_oi_ratio(0, 0) is None


def test_volume_oi_ratio_handles_none_inputs():
    """None inputs are treated as zero — both None -> None (no info)."""
    from services.options import _compute_volume_oi_ratio

    assert _compute_volume_oi_ratio(None, None) is None
    assert _compute_volume_oi_ratio(100, None) == 100.0


# ---------------------------------------------------------------------------
# V1-2: chain aggregates
# ---------------------------------------------------------------------------


def test_chain_aggregates_sums_call_and_put_separately():
    """Aggregates split call vs put correctly."""
    from services import options as opts

    expiry = date.today() + timedelta(days=14)
    calls = [
        opts.OptionContract(
            symbol=f"AAPL{expiry.strftime('%y%m%d')}C00{strike:05d}000",
            underlying="AAPL", expiry=expiry, strike=strike,
            option_type=opts.OptionType.CALL,
            bid=1.0, ask=1.2, last=1.1,
            volume=v, open_interest=oi,
            iv=0.25, delta=0.5, gamma=0.01, theta=-0.02, vega=0.1,
        )
        for strike, v, oi in [(245, 100, 1000), (250, 200, 2000), (255, 300, 3000)]
    ]
    puts = [
        opts.OptionContract(
            symbol=f"AAPL{expiry.strftime('%y%m%d')}P00{strike:05d}000",
            underlying="AAPL", expiry=expiry, strike=strike,
            option_type=opts.OptionType.PUT,
            bid=1.0, ask=1.2, last=1.1,
            volume=v, open_interest=oi,
            iv=0.25, delta=-0.5, gamma=0.01, theta=-0.02, vega=0.1,
        )
        for strike, v, oi in [(245, 50, 500), (250, 75, 750), (255, 25, 250)]
    ]
    call_vol, put_vol, ratio, call_oi, put_oi = opts._compute_chain_aggregates(calls + puts)

    assert call_vol == 600  # 100 + 200 + 300
    assert put_vol == 150  # 50 + 75 + 25
    assert call_oi == 6000  # 1000 + 2000 + 3000
    assert put_oi == 1500  # 500 + 750 + 250
    assert ratio == 4.0  # 600 / 150


def test_chain_aggregates_empty_chain_safe_default():
    """Empty contracts list -> all zeros, ratio 1.0 (degenerate / safe)."""
    from services import options as opts

    call_vol, put_vol, ratio, call_oi, put_oi = opts._compute_chain_aggregates([])
    assert call_vol == 0
    assert put_vol == 0
    assert ratio == 1.0
    assert call_oi == 0
    assert put_oi == 0


def test_chain_aggregates_all_calls_no_puts():
    """All-call chain doesn't divide by zero — uses max(put_vol, 1) denominator."""
    from services import options as opts

    expiry = date.today() + timedelta(days=14)
    contracts = [
        opts.OptionContract(
            symbol=f"AAPL{expiry.strftime('%y%m%d')}C00250000",
            underlying="AAPL", expiry=expiry, strike=250.0,
            option_type=opts.OptionType.CALL,
            bid=1.0, ask=1.2, last=1.1,
            volume=500, open_interest=1000,
            iv=0.25, delta=0.5, gamma=0.01, theta=-0.02, vega=0.1,
        )
    ]
    call_vol, put_vol, ratio, _, _ = opts._compute_chain_aggregates(contracts)
    assert call_vol == 500
    assert put_vol == 0
    assert ratio == 500.0  # 500 / max(0, 1) = 500


@pytest.mark.asyncio
async def test_demo_chain_carries_volume_signals_end_to_end():
    """Demo chain populates per-contract volume_oi_ratio + chain aggregates."""
    from services import options as opts

    # Force demo path by stubbing _fetch_real_chain.
    with patch.object(opts, "_fetch_real_chain", AsyncMock(return_value=None)):
        chain = await opts.fetch_chain("AAPL")

    assert chain.is_demo is True
    # Aggregates should be populated.
    assert chain.total_call_volume + chain.total_put_volume > 0
    assert chain.total_call_oi + chain.total_put_oi > 0
    # call_put_volume_ratio is a finite float (not None).
    assert isinstance(chain.call_put_volume_ratio, float)

    # Each contract should carry its own volume_oi_ratio (or None when both zero).
    for c in chain.contracts:
        if c.volume == 0 and c.open_interest == 0:
            assert c.volume_oi_ratio is None
        else:
            assert c.volume_oi_ratio is not None
            assert c.volume_oi_ratio == round(
                c.volume / max(c.open_interest, 1), 4
            )

    # Aggregates equal the sum of per-contract values.
    expected_call_vol = sum(c.volume for c in chain.contracts if c.option_type == opts.OptionType.CALL)
    expected_put_vol = sum(c.volume for c in chain.contracts if c.option_type == opts.OptionType.PUT)
    assert chain.total_call_volume == expected_call_vol
    assert chain.total_put_volume == expected_put_vol


# ---------------------------------------------------------------------------
# V1-4: liquidity_score known cases
# ---------------------------------------------------------------------------


def test_liquidity_score_great_liquidity():
    """Tight spread (2%) + heavy volume (500) + heavy OI (5000) -> close to 1.0."""
    from services.options import compute_liquidity_score

    # bid=4.95, ask=5.05, mid=5.00, spread_pct = 0.10/5.00 = 2% < 5% -> spread_score=1.0
    # volume=500 >= 100 -> volume_score=1.0
    # oi=5000 >= 500 -> oi_score=1.0
    # base = 0.5 + 0.25 + 0.25 = 1.0
    score = compute_liquidity_score(
        bid=4.95, ask=5.05, volume=500, open_interest=5000, relative_volume=None,
    )
    assert score == 1.0


def test_liquidity_score_great_with_relative_volume_bonus():
    """Heavy underlying flow (rel_vol > 1.5) adds bonus but still capped at 1.0."""
    from services.options import compute_liquidity_score

    score = compute_liquidity_score(
        bid=4.95, ask=5.05, volume=500, open_interest=5000, relative_volume=2.0,
    )
    # Base would be 1.0 + 0.1 bonus = 1.1, clamped to 1.0.
    assert score == 1.0


def test_liquidity_score_dead_contract():
    """Wide spread (40%) + zero volume + zero OI -> 0.0 (untradeable)."""
    from services.options import compute_liquidity_score

    score = compute_liquidity_score(
        bid=0.50, ask=0.70, volume=0, open_interest=0, relative_volume=None,
    )
    # spread = 0.20/0.60 = 33% > 30% -> spread_score=0.0
    # volume=0 -> volume_score=0.0
    # oi=0 -> oi_score=0.0
    assert score == 0.0


def test_liquidity_score_mediocre_contract():
    """Mid-range — meaningful, but not great. Should be ~0.4-0.6 range."""
    from services.options import compute_liquidity_score

    # bid=2.40, ask=2.60, mid=2.50, spread_pct = 0.20/2.50 = 8% (between 5% and 30%)
    # spread_score = 1 - (0.08 - 0.05) / 0.25 = 0.88
    # volume=50 -> volume_score = 0.5
    # oi=250 -> oi_score = 0.5
    # base = 0.5 * 0.88 + 0.25 * 0.5 + 0.25 * 0.5 = 0.44 + 0.125 + 0.125 = 0.69
    score = compute_liquidity_score(
        bid=2.40, ask=2.60, volume=50, open_interest=250, relative_volume=None,
    )
    assert 0.4 < score < 0.8, f"unexpected mediocre score: {score}"


def test_liquidity_score_no_quote_returns_zero():
    """Both bid and ask are 0 (no two-sided market) -> 0.0."""
    from services.options import compute_liquidity_score

    score = compute_liquidity_score(
        bid=0, ask=0, volume=100, open_interest=1000, relative_volume=None,
    )
    assert score == 0.0


def test_liquidity_score_with_relative_volume_bonus():
    """Mediocre contract + busy underlying -> bonus applied."""
    from services.options import compute_liquidity_score

    # Same mediocre setup as above, base ~0.69
    base = compute_liquidity_score(
        bid=2.40, ask=2.60, volume=50, open_interest=250, relative_volume=None,
    )
    bonused = compute_liquidity_score(
        bid=2.40, ask=2.60, volume=50, open_interest=250, relative_volume=2.0,
    )
    # Bonus is +0.10 (clamped to 1.0).
    assert bonused > base
    assert bonused == pytest.approx(min(1.0, base + 0.10), abs=1e-4)


def test_liquidity_score_bounded_zero_to_one():
    """Score is always in [0, 1] regardless of inputs."""
    from services.options import compute_liquidity_score

    for bid, ask, vol, oi, rv in [
        (10, 10.01, 10000, 100000, 5.0),  # over-saturated
        (0.01, 100, 0, 0, None),  # extreme spread
        (1, 2, 50, 250, 10.0),  # bonus stacks
        (5, 5, 50, 250, None),  # zero spread (mid still > 0)
    ]:
        score = compute_liquidity_score(bid, ask, vol, oi, rv)
        assert 0.0 <= score <= 1.0, f"score out of range: {score}"
