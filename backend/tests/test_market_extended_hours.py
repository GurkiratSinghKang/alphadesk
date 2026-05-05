"""Tests for Batch EH (extended-hours pricing) — 2026-05-05.

Covers the new fields surfaced on ``services.market.Quote`` plus the
session-classification helpers in ``core.time``. Mocks Polygon /Alpaca
HTTP responses so the tests run offline.
"""
from __future__ import annotations

from datetime import datetime, time, timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest

from core import time as core_time
from services.market import (
    Quote,
    _classify_session,
    _classify_trade_session,
    _compute_extended_fields,
)

_NY = ZoneInfo("America/New_York")


# ---------------------------------------------------------------------------
# Session classification — pre / regular / post / closed
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "et_dt, expected",
    [
        # Tuesday samples to avoid weekend short-circuit.
        (datetime(2026, 5, 5, 6, 0, tzinfo=_NY), "pre"),
        (datetime(2026, 5, 5, 9, 29, tzinfo=_NY), "pre"),
        (datetime(2026, 5, 5, 9, 30, tzinfo=_NY), "regular"),
        (datetime(2026, 5, 5, 12, 0, tzinfo=_NY), "regular"),
        (datetime(2026, 5, 5, 15, 59, tzinfo=_NY), "regular"),
        (datetime(2026, 5, 5, 16, 0, tzinfo=_NY), "post"),
        (datetime(2026, 5, 5, 19, 59, tzinfo=_NY), "post"),
        (datetime(2026, 5, 5, 20, 0, tzinfo=_NY), "closed"),
        (datetime(2026, 5, 5, 3, 59, tzinfo=_NY), "closed"),
        # Saturday is always closed regardless of clock.
        (datetime(2026, 5, 9, 12, 0, tzinfo=_NY), "closed"),
    ],
)
def test_current_session_classification(et_dt, expected):
    assert core_time.current_session(et_dt) == expected


def test_classify_trade_session_post_market():
    """A trade at 17:00 ET is post-market."""
    trade_dt = datetime(2026, 5, 5, 17, 0, tzinfo=_NY).astimezone(timezone.utc)
    assert _classify_trade_session(trade_dt) == "post"


def test_classify_trade_session_pre_market():
    """A trade at 07:30 ET is pre-market."""
    trade_dt = datetime(2026, 5, 5, 7, 30, tzinfo=_NY).astimezone(timezone.utc)
    assert _classify_trade_session(trade_dt) == "pre"


def test_classify_trade_session_regular_returns_none():
    """Regular-session trades emit None — only pre/post bubble up as
    extended-hours sessions on the quote payload."""
    trade_dt = datetime(2026, 5, 5, 14, 30, tzinfo=_NY).astimezone(timezone.utc)
    assert _classify_trade_session(trade_dt) is None


def test_classify_trade_session_none_input():
    assert _classify_trade_session(None) is None


# ---------------------------------------------------------------------------
# _compute_extended_fields — payload-level EH derivation
# ---------------------------------------------------------------------------

def test_compute_extended_fields_post_market_amd_scenario():
    """The AMD scenario from the bug: regular close $356, post-market trade $403."""
    trade_dt = datetime(2026, 5, 5, 18, 0, tzinfo=_NY).astimezone(timezone.utc)
    fields = _compute_extended_fields(
        last_trade_price=403.0,
        last_trade_dt=trade_dt,
        regular_close=356.0,
    )
    assert fields["extended_session"] == "post"
    assert fields["extended_price"] == 403.0
    assert fields["regular_close_price"] == 356.0
    assert fields["extended_change"] == 47.0
    # 47/356 * 100 ~= 13.20
    assert fields["extended_change_pct"] == pytest.approx(13.20, abs=0.01)
    assert fields["last_trade_time"] == trade_dt


def test_compute_extended_fields_regular_session_emits_none():
    """A regular-session trade leaves ``extended_*`` as None."""
    trade_dt = datetime(2026, 5, 5, 14, 0, tzinfo=_NY).astimezone(timezone.utc)
    fields = _compute_extended_fields(
        last_trade_price=200.0,
        last_trade_dt=trade_dt,
        regular_close=199.0,
    )
    assert fields["extended_session"] is None
    assert fields["extended_price"] is None
    assert fields["extended_change"] is None
    assert fields["extended_change_pct"] is None
    # regular_close_price still passes through so frontend can show
    # "Close: $199" alongside the live mark.
    assert fields["regular_close_price"] == 199.0


def test_compute_extended_fields_no_regular_close_safely_skips_change():
    """When ``regular_close`` is missing we still emit the price but
    skip the change/pct so the UI doesn't render a -100% spike."""
    trade_dt = datetime(2026, 5, 5, 18, 0, tzinfo=_NY).astimezone(timezone.utc)
    fields = _compute_extended_fields(
        last_trade_price=403.0,
        last_trade_dt=trade_dt,
        regular_close=None,
    )
    assert fields["extended_session"] == "post"
    assert fields["extended_price"] == 403.0
    assert fields["extended_change"] is None
    assert fields["extended_change_pct"] is None
    assert fields["regular_close_price"] is None


def test_compute_extended_fields_no_extended_trade_returns_none():
    """When there's no trade timestamp, ``extended_*`` are all None."""
    fields = _compute_extended_fields(
        last_trade_price=None,
        last_trade_dt=None,
        regular_close=356.0,
    )
    assert fields["extended_session"] is None
    assert fields["extended_price"] is None
    assert fields["regular_close_price"] == 356.0


# ---------------------------------------------------------------------------
# Quote schema — field defaults are non-breaking
# ---------------------------------------------------------------------------

def test_quote_schema_extended_fields_default_to_none():
    """Existing callers that don't pass EH fields still work — the new
    fields default to None and ``session`` defaults to 'regular'."""
    q = Quote(
        symbol="AMD",
        bid=355.0,
        ask=356.0,
        last=355.5,
        volume=1_000_000,
        timestamp=datetime.now(timezone.utc),
    )
    assert q.extended_price is None
    assert q.extended_session is None
    assert q.regular_close_price is None
    assert q.session == "regular"


def test_quote_schema_with_post_market_payload_round_trips():
    """A constructed quote with the AMD post-market values round-trips
    through model_dump/model_validate without losing fields."""
    trade_dt = datetime(2026, 5, 5, 18, 0, tzinfo=_NY).astimezone(timezone.utc)
    q = Quote(
        symbol="AMD",
        bid=402.5,
        ask=403.5,
        last=403.0,
        volume=10_000_000,
        timestamp=trade_dt,
        regular_close_price=356.0,
        extended_price=403.0,
        extended_change=47.0,
        extended_change_pct=13.20,
        extended_session="post",
        last_trade_time=trade_dt,
        session="post",
    )
    payload = q.model_dump(mode="json")
    rehydrated = Quote.model_validate(payload)
    assert rehydrated.extended_price == 403.0
    assert rehydrated.extended_session == "post"
    assert rehydrated.session == "post"


# ---------------------------------------------------------------------------
# fetch_quote — Polygon snapshot wires EH fields end-to-end
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fetch_quote_polygon_post_market_amd():
    """Mock Polygon's snapshot response with a post-market trade and
    verify ``extended_price``/``extended_session`` populate."""
    from services import market as market_svc

    # Tuesday 18:00 ET => post-market.
    trade_dt = datetime(2026, 5, 5, 18, 0, tzinfo=_NY).astimezone(timezone.utc)
    trade_ts_ns = int(trade_dt.timestamp() * 1_000_000_000)

    polygon_response = {
        "ticker": {
            "lastTrade": {"p": 403.0, "t": trade_ts_ns},
            "lastQuote": {"p": 402.5, "P": 403.5, "s": 1, "S": 1},
            "day": {"v": 50_000_000, "c": 356.0},
            "prevDay": {"c": 350.0},
            "todaysChangePerc": 0.5,
        }
    }

    class _Resp:
        status_code = 200

        def json(self):
            return polygon_response

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **kw):
            return _Resp()

    # No need to reach Redis cache; patch helpers to be inert.
    async def _no_cache(*a, **kw):
        return None

    async def _no_cache_set(*a, **kw):
        return None

    with patch.object(market_svc, "_polygon_key_empty", lambda: False), \
         patch("httpx.AsyncClient", lambda *a, **kw: _Client()), \
         patch("core.redis.cache_get", _no_cache), \
         patch("core.redis.cache_set", _no_cache_set):
        quote = await market_svc.fetch_quote("AMD")

    assert quote.symbol == "AMD"
    assert quote.last == 403.0
    assert quote.extended_price == 403.0
    assert quote.extended_session == "post"
    assert quote.regular_close_price == 356.0
    # change vs regular close
    assert quote.extended_change == pytest.approx(47.0, abs=0.01)
    assert quote.last_trade_time is not None


@pytest.mark.asyncio
async def test_fetch_quote_polygon_no_extended_trade_emits_none():
    """When the latest trade is in regular hours, ``extended_*`` are None.

    Regression: don't fabricate post-market values from a regular-session tape.
    """
    from services import market as market_svc

    trade_dt = datetime(2026, 5, 5, 14, 0, tzinfo=_NY).astimezone(timezone.utc)
    trade_ts_ns = int(trade_dt.timestamp() * 1_000_000_000)

    polygon_response = {
        "ticker": {
            "lastTrade": {"p": 200.0, "t": trade_ts_ns},
            "lastQuote": {"p": 199.5, "P": 200.5, "s": 1, "S": 1},
            "day": {"v": 25_000_000, "c": 0},  # close not yet set mid-session
            "prevDay": {"c": 199.0},
        }
    }

    class _Resp:
        status_code = 200

        def json(self):
            return polygon_response

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **kw):
            return _Resp()

    async def _no_cache(*a, **kw):
        return None

    async def _no_cache_set(*a, **kw):
        return None

    with patch.object(market_svc, "_polygon_key_empty", lambda: False), \
         patch("httpx.AsyncClient", lambda *a, **kw: _Client()), \
         patch("core.redis.cache_get", _no_cache), \
         patch("core.redis.cache_set", _no_cache_set):
        quote = await market_svc.fetch_quote("MSFT")

    assert quote.last == 200.0
    assert quote.extended_price is None
    assert quote.extended_session is None
    # regular_close_price falls back to prev day when day.c not set yet.
    assert quote.regular_close_price == 199.0


# ---------------------------------------------------------------------------
# Position live value — extended_price overrides broker mark
# ---------------------------------------------------------------------------

def test_position_response_extended_market_value_for_equity():
    """Equity: market_value = qty * extended_price * 1.0."""
    from api.routes.trades import PositionResponse

    p = PositionResponse(
        symbol="AMD",
        quantity=100,
        side="long",
        avg_cost=300.0,
        current_price=356.0,  # broker mark (regular close)
        market_value=35_600.0,
        unrealized_pnl=5_600.0,
        unrealized_pnl_pct=18.66,
        asset_class="us_equity",
        extended_price=403.0,
        extended_market_value=40_300.0,
        value_session="extended",
    )
    assert p.extended_market_value == 40_300.0
    assert p.value_session == "extended"


def test_position_response_value_session_default_regular():
    """Backwards-compat: positions without EH info keep ``value_session='regular'``."""
    from api.routes.trades import PositionResponse

    p = PositionResponse(
        symbol="GOOGL",
        quantity=10,
        side="long",
        avg_cost=200.0,
        current_price=205.0,
        market_value=2_050.0,
        unrealized_pnl=50.0,
        unrealized_pnl_pct=2.5,
    )
    assert p.value_session == "regular"
    assert p.extended_price is None
    assert p.extended_market_value is None
