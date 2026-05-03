from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def authed_client():
    from core.auth import require_auth
    from main import app

    async def fake_user() -> str:
        return "test_user"

    previous = app.dependency_overrides.get(require_auth)
    app.dependency_overrides[require_auth] = fake_user
    try:
        yield TestClient(app)
    finally:
        if previous is None:
            app.dependency_overrides.pop(require_auth, None)
        else:
            app.dependency_overrides[require_auth] = previous


def test_ticker_context_route_normalizes_symbols_and_needs(
    monkeypatch: pytest.MonkeyPatch,
    authed_client,
) -> None:
    from api.routes import tickers
    from services.ticker_context import (
        FactEnvelope,
        FreshnessMeta,
        TickerContext,
        TickerContextResponse,
    )

    called: dict = {}

    async def fake_get_ticker_context(symbols, *, needs, max_age_seconds, on_stale):
        called.update(
            {
                "symbols": symbols,
                "needs": needs,
                "max_age_seconds": max_age_seconds,
                "on_stale": on_stale,
            }
        )
        now = datetime.now(timezone.utc)
        return TickerContextResponse(
            symbols={
                "AAPL": TickerContext(
                    symbol="AAPL",
                    quote=FactEnvelope(
                        value={"last": 123.45},
                        freshness=FreshnessMeta(
                            observed_at=now,
                            as_of=now,
                            stale_after_seconds=15,
                            quality="fresh",
                            source="market_waterfall",
                        ),
                    ),
                )
            }
        )

    monkeypatch.setattr(tickers, "get_ticker_context", fake_get_ticker_context)

    resp = authed_client.get(
        "/api/v1/tickers/context?symbols=aapl,AAPL&needs=quote,options&max_age_seconds=30"
    )

    assert resp.status_code == 200, resp.text
    assert called == {
        "symbols": ["AAPL"],
        "needs": ["quote", "options_summary"],
        "max_age_seconds": 30,
        "on_stale": "allow_with_warning",
    }
    assert resp.json()["symbols"]["AAPL"]["quote"]["value"]["last"] == 123.45


def test_ticker_context_route_rejects_unknown_need(authed_client) -> None:
    resp = authed_client.get("/api/v1/tickers/context?symbols=AAPL&needs=quote,bogus")

    assert resp.status_code == 422
