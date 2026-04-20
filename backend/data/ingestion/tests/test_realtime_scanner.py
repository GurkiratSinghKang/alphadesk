"""Tests for the Wave 2H liquidity filters in ``realtime_scanner``
(persona-76 P76-5).

``_liquidity_filters_ok`` is the gate — each test pins two of the three
inputs and varies the third across the boundary. ``_fetch_liquidity_metrics``
is monkeypatched so these tests never touch FMP or Polygon.
"""

from __future__ import annotations

import pytest

from data.ingestion import realtime_scanner as rs


def _patch_metrics(
    monkeypatch: pytest.MonkeyPatch,
    *,
    market_cap: float,
    avg_dollar_volume_30d: float,
) -> None:
    """Force ``_fetch_liquidity_metrics`` to a fixed payload."""

    async def _fake(_symbol: str) -> dict[str, float]:
        return {
            "market_cap": market_cap,
            "avg_dollar_volume_30d": avg_dollar_volume_30d,
        }

    monkeypatch.setattr(rs, "_fetch_liquidity_metrics", _fake)


# --------------------------------------------------------------------------- #
# Price floor                                                                 #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_price_below_floor_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    # Market cap + volume both huge so the failure must come from price.
    _patch_metrics(
        monkeypatch,
        market_cap=10_000_000_000,
        avg_dollar_volume_30d=50_000_000,
    )
    ok, reason = await rs._liquidity_filters_ok("PENNY", 3.25)
    assert ok is False
    assert "price" in reason.lower()


@pytest.mark.asyncio
async def test_price_exactly_at_floor_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_metrics(
        monkeypatch,
        market_cap=10_000_000_000,
        avg_dollar_volume_30d=50_000_000,
    )
    ok, _ = await rs._liquidity_filters_ok("AAPL", rs.LIQUIDITY_MIN_PRICE_USD)
    assert ok is True


@pytest.mark.asyncio
async def test_price_floor_checked_before_metrics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # If price is below floor, _fetch_liquidity_metrics must NOT be called
    # — the provider lookups are expensive and the sub-$5 refusal alone
    # is enough to refuse the setup. Assert by raising on call.
    async def _boom(_symbol: str) -> dict[str, float]:
        raise AssertionError("liquidity provider was called for sub-floor price")

    monkeypatch.setattr(rs, "_fetch_liquidity_metrics", _boom)
    ok, reason = await rs._liquidity_filters_ok("CHEAP", 1.00)
    assert ok is False
    assert "price" in reason.lower()


# --------------------------------------------------------------------------- #
# Market-cap floor                                                            #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_small_cap_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    # $200M — below the $300M floor.
    _patch_metrics(
        monkeypatch,
        market_cap=200_000_000,
        avg_dollar_volume_30d=50_000_000,
    )
    ok, reason = await rs._liquidity_filters_ok("SMALL", 42.00)
    assert ok is False
    assert "market cap" in reason.lower()


@pytest.mark.asyncio
async def test_market_cap_at_floor_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_metrics(
        monkeypatch,
        market_cap=rs.LIQUIDITY_MIN_MARKET_CAP_USD,
        avg_dollar_volume_30d=50_000_000,
    )
    ok, _ = await rs._liquidity_filters_ok("MID", 42.00)
    assert ok is True


@pytest.mark.asyncio
async def test_zero_market_cap_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    # Provider miss returns 0 for market_cap — must fail closed.
    _patch_metrics(
        monkeypatch,
        market_cap=0,
        avg_dollar_volume_30d=50_000_000,
    )
    ok, reason = await rs._liquidity_filters_ok("UNKNOWN", 42.00)
    assert ok is False
    assert "market cap" in reason.lower()


# --------------------------------------------------------------------------- #
# Average dollar-volume floor                                                 #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_thin_volume_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    # $500k/day — well below the $5M floor.
    _patch_metrics(
        monkeypatch,
        market_cap=10_000_000_000,
        avg_dollar_volume_30d=500_000,
    )
    ok, reason = await rs._liquidity_filters_ok("THIN", 42.00)
    assert ok is False
    assert "volume" in reason.lower()


@pytest.mark.asyncio
async def test_avg_dollar_volume_at_floor_passes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_metrics(
        monkeypatch,
        market_cap=10_000_000_000,
        avg_dollar_volume_30d=rs.LIQUIDITY_MIN_AVG_DOLLAR_VOLUME_USD,
    )
    ok, _ = await rs._liquidity_filters_ok("OK", 42.00)
    assert ok is True


@pytest.mark.asyncio
async def test_zero_volume_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    # Polygon miss / no bars returned — fail closed.
    _patch_metrics(
        monkeypatch,
        market_cap=10_000_000_000,
        avg_dollar_volume_30d=0,
    )
    ok, reason = await rs._liquidity_filters_ok("DARK", 42.00)
    assert ok is False
    assert "volume" in reason.lower()


# --------------------------------------------------------------------------- #
# All-pass happy path                                                         #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_all_three_filters_pass_for_large_liquid_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_metrics(
        monkeypatch,
        market_cap=2_000_000_000_000,  # AAPL-scale
        avg_dollar_volume_30d=10_000_000_000,  # $10B/day
    )
    ok, _ = await rs._liquidity_filters_ok("AAPL", 180.00)
    assert ok is True
