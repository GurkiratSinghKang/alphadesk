"""Tests for audit-gap fixes (B2.20-44, B3.1, B3.2, B3.6, B3.7).

Each test maps to a single bug ID from
``.planning/earnings-options-play-bugs/REPORT.md`` so a future regression
points straight back at the report row that defined the contract.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app

# Auth override is installed by conftest.py's session-scoped autouse fixture.
client = TestClient(app)


# ─── B2.20 / B2.36: search ranking puts exact match first ────────


def test_search_local_exact_match_outranks_etfs():
    """``q=AAPL`` must put AAPL ahead of any AAPx leveraged ETF."""
    from api.routes.symbols import _rank_symbols, SymbolInfo

    symbols = [
        SymbolInfo(symbol="AAPB", name="GraniteShares 2x Long AAPL", type="etf",
                   exchange="NASDAQ"),
        SymbolInfo(symbol="AAPD", name="Direxion Daily AAPL Bear", type="etf",
                   exchange="NASDAQ"),
        SymbolInfo(symbol="AAPL", name="Apple Inc.", type="stock",
                   exchange="NASDAQ"),
        SymbolInfo(symbol="AAPU", name="Direxion Daily AAPL Bull", type="etf",
                   exchange="NASDAQ"),
        SymbolInfo(symbol="AAPW", name="Some other AAPL ETF", type="etf",
                   exchange="NASDAQ"),
    ]
    ranked = _rank_symbols(symbols, "AAPL", limit=5)
    assert ranked[0].symbol == "AAPL", "exact match must be first"


def test_search_local_nvda_outranks_anv_substring():
    """``q=NVDA`` must NOT return ANV first (B2.20 specific finding)."""
    from api.routes.symbols import _rank_symbols, SymbolInfo

    symbols = [
        SymbolInfo(symbol="ANV", name="Autocallable NVDA ETF", type="etf",
                   exchange="NASDAQ"),
        SymbolInfo(symbol="NVDA", name="NVIDIA Corp.", type="stock",
                   exchange="NASDAQ"),
    ]
    ranked = _rank_symbols(symbols, "NVDA", limit=5)
    assert ranked[0].symbol == "NVDA", "exact match must beat name-only ANV"


def test_search_local_stock_beats_etf_within_prefix_tier():
    """Within the prefix-match tier, plain stocks rank ahead of ETFs."""
    from api.routes.symbols import _rank_symbols, SymbolInfo

    symbols = [
        SymbolInfo(symbol="AAPB", name="ETF", type="etf", exchange="NASDAQ"),
        SymbolInfo(symbol="AAPL", name="Apple", type="stock", exchange="NASDAQ"),
    ]
    ranked = _rank_symbols(symbols, "AAP", limit=5)
    # AAPL is a stock, AAPB is an ETF — both match prefix "AAP".
    assert ranked[0].symbol == "AAPL"


# ─── B2.21: empty query returns empty list ────────────────────────


def test_search_empty_query_returns_empty_list():
    """``q=`` must NOT alphabetically dump the symbol list."""
    r = client.get("/api/v1/symbols/search?q=")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 0
    assert body["results"] == []


def test_search_whitespace_only_returns_empty_list():
    """A whitespace-only query is also empty."""
    r = client.get("/api/v1/symbols/search?q=%20%20%20")
    assert r.status_code == 200
    assert r.json()["count"] == 0


# ─── B2.22: friendly ticker-format error message ──────────────────


def test_invalid_ticker_format_returns_friendly_message():
    """The Pydantic regex must NOT leak into the user-facing error."""
    r = client.get("/api/v1/earnings/INVALID7/detail")
    assert r.status_code == 422
    body = r.json()
    detail = body["detail"]
    # Detail should be a list with our rewritten error
    assert isinstance(detail, list)
    err = detail[0]
    assert err["type"] == "ticker_format_invalid"
    assert "1-6 uppercase" in err["msg"]
    # Critical: the regex pattern must NOT leak into the message
    assert "^[A-Z]" not in err["msg"]
    assert "pattern" not in err["msg"].lower()


# ─── B2.43 / iter 17: legacy watchlist endpoint redirects to /user ────


def test_watchlist_legacy_endpoint_redirects_to_user_route():
    """``/api/v1/symbols/watchlist`` 308-redirects to ``/api/v1/user/watchlist``.

    Iter 17 promoted the empty-list stub to a real per-user surface.
    The legacy path stays as a 308 permanent redirect so any straggler
    bookmark or cached tab lands on the live endpoint with its method
    preserved (308 vs 301 keeps POST/DELETE intact).
    """
    # ``allow_redirects=False`` (httpx) / ``follow_redirects=False`` —
    # depending on starlette/httpx version. TestClient's ``get`` accepts
    # ``follow_redirects``.
    r = client.get("/api/v1/symbols/watchlist", follow_redirects=False)
    assert r.status_code == 308
    assert r.headers["location"] == "/api/v1/user/watchlist"


# ─── B2.38 / B2.44: error_codes is always a list ──────────────────


def test_analysis_error_codes_is_list_not_null():
    """``error_codes`` must default to ``[]`` rather than ``null``."""
    from api.schemas.earnings import EarningsAnalysis

    # Construct without specifying error_codes; default factory takes over.
    analysis = EarningsAnalysis(
        symbol="TEST",
        fetched_at=datetime.now(timezone.utc),
        is_demo=False,
    )
    assert analysis.error_codes == []
    assert analysis.error_codes is not None


# ─── B3.6: pipeline status defaults are non-null ──────────────────


def test_pipeline_status_defaults_non_null():
    """``halted_by_admin`` and ``kill_switch_layers`` must never be null."""
    from api.routes.pipeline import PipelineStatus

    status = PipelineStatus(running=False)
    assert status.halted_by_admin is False
    assert status.kill_switch_layers == []


def test_pipeline_status_endpoint_normalizes_null_upstream():
    """Even if the upstream emits ``None`` for these keys, the response
    serializer must coerce to ``False`` / ``[]``."""
    raw = {
        "running": False,
        "stage": None,
        "current_strategy": None,
        "progress": None,
        "started_at": None,
        "run_id": None,
        "last_run": None,
        "last_result": "success",
        "halted_by_admin": None,
        "kill_switch_layers": None,
    }
    with patch("data.ingestion.daily_pipeline.get_pipeline_status", return_value=raw):
        r = client.get("/api/v1/pipeline/status")
    assert r.status_code == 200
    body = r.json()
    assert body["halted_by_admin"] is False
    assert body["kill_switch_layers"] == []


# ─── B3.1: /api/v1/strategies (no slash) returns content ──────────


def test_strategies_no_slash_alias_returns_200():
    """``/api/v1/strategies`` (no trailing slash) must return content."""
    # Don't 502 if Alpaca isn't reachable in tests — patch the underlying
    # handler's HTTP probe.
    from api.routes import strategies as _s

    async def _stub_list_strategies():
        return []

    with patch.object(_s, "list_strategies", side_effect=_stub_list_strategies):
        r = client.get("/api/v1/strategies", follow_redirects=False)
    # Either we get content directly (alias hit) or the alias path
    # short-circuits without a redirect.
    assert r.status_code == 200, f"got {r.status_code}: {r.text}"


# ─── B3.2: /api/v1/alerts alias works ─────────────────────────────


def test_alerts_top_level_alias_returns_200():
    """``GET /api/v1/alerts`` aliases trades.list_alerts (B3.2)."""
    from api.routes import trades as _t

    # Patch the underlying alerts loader to return an empty list rather
    # than touching Redis in tests.
    async def _stub_get_all_alerts(username: str | None = None):
        return []

    with patch.object(_t, "_get_all_alerts", side_effect=_stub_get_all_alerts):
        r = client.get("/api/v1/alerts")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ─── B3.7: risk-prefixed halt aliases work ────────────────────────


def test_risk_halt_status_alias_returns_200():
    """``GET /api/v1/risk/halt-status`` aliases trades.get_halt_status."""
    from api.routes import trades as _t

    async def _not_halted():
        return False

    with patch.object(_t, "_is_trading_halted", side_effect=_not_halted):
        r = client.get("/api/v1/risk/halt-status")
    assert r.status_code == 200
    body = r.json()
    assert body.get("halted") is False
