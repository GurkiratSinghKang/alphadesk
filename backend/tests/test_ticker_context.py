from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from services.ticker_context import (
    FactSpec,
    FactEnvelope,
    FreshnessMeta,
    LoadedFact,
    TickerContextService,
    classify_freshness,
)


def test_classify_freshness_respects_stale_after_and_demo() -> None:
    observed = datetime(2026, 5, 3, 14, 0, tzinfo=timezone.utc)
    meta = FreshnessMeta(
        observed_at=observed,
        stale_after_seconds=60,
        quality="fresh",
        source="market_waterfall",
    )

    assert classify_freshness(meta, now=observed + timedelta(seconds=30)) == "fresh"
    assert classify_freshness(meta, now=observed + timedelta(seconds=61)) == "stale"

    demo = meta.model_copy(update={"is_demo": True})
    assert classify_freshness(demo, now=observed + timedelta(days=1)) == "demo"


@pytest.mark.asyncio
async def test_context_refreshes_missing_fact_and_returns_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    service = TickerContextService()
    observed = datetime(2026, 5, 3, 14, 0, tzinfo=timezone.utc)
    refreshed = FactEnvelope(
        value={"symbol": "AAPL", "last": 123.45},
        freshness=FreshnessMeta(
            observed_at=observed,
            as_of=observed,
            stale_after_seconds=15,
            quality="fresh",
            source="market_waterfall",
        ),
    )
    persisted: list[str] = []

    async def no_existing(*args, **kwargs):
        return None

    async def fake_refresh(symbol, spec):
        assert symbol == "AAPL"
        assert spec.field == "quote"
        return refreshed

    async def fake_persist(symbol, spec, envelope):
        persisted.append(f"{symbol}:{spec.field}:{envelope.value['last']}")

    async def no_cache(*args, **kwargs):
        return None

    monkeypatch.setattr(service, "_load_cached_or_persisted", no_existing)
    monkeypatch.setattr(service, "_refresh_fact", fake_refresh)
    monkeypatch.setattr(service, "_persist_fact", fake_persist)
    monkeypatch.setattr(service, "_store_hot_cache", no_cache)

    context = await service.get("aapl", needs=["quote"])

    assert context.symbol == "AAPL"
    assert context.quote is not None
    assert context.quote.value["last"] == 123.45
    assert context.quote.freshness.quality == "fresh"
    assert persisted == ["AAPL:quote:123.45"]


@pytest.mark.asyncio
async def test_context_returns_stale_fact_when_refresh_fails_with_warning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = TickerContextService()
    observed = datetime.now(timezone.utc) - timedelta(minutes=10)
    stale = FactEnvelope(
        value={"symbol": "NVDA", "last": 200.0},
        freshness=FreshnessMeta(
            observed_at=observed,
            stale_after_seconds=15,
            quality="stale",
            source="market_waterfall",
        ),
    )

    async def existing(*args, **kwargs):
        return stale

    async def boom(*args, **kwargs):
        raise RuntimeError("provider down")

    async def no_write(*args, **kwargs):
        return None

    monkeypatch.setattr(service, "_load_cached_or_persisted", existing)
    monkeypatch.setattr(service, "_refresh_fact", boom)
    monkeypatch.setattr(service, "_persist_fact", no_write)
    monkeypatch.setattr(service, "_store_hot_cache", no_write)

    context = await service.get("NVDA", needs=["quote"], on_stale="allow_with_warning")

    assert context.quote is stale
    assert context.warnings
    assert context.warnings[0].code == "refresh_failed_stale_returned"


@pytest.mark.asyncio
async def test_custom_fact_loader_uses_same_envelope_and_persistence_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = TickerContextService()
    observed = datetime(2026, 5, 3, 14, 0, tzinfo=timezone.utc)
    spec = FactSpec(
        field="earnings.event_metrics",
        namespace="earnings",
        key="event_metrics:2026-05-03:auto",
        source="unit",
        stale_after_seconds=300,
    )
    persisted: list[tuple[str, str, str, dict]] = []

    async def no_existing(*args, **kwargs):
        return None

    async def no_cache(*args, **kwargs):
        return None

    async def fake_persist(symbol, fact_spec, envelope):
        persisted.append((symbol, fact_spec.namespace, fact_spec.key, envelope.value))

    async def loader() -> LoadedFact:
        return LoadedFact(
            value={"expected_move_pct": 5.2},
            as_of=observed,
            source="unit_loader",
            stale_after_seconds=120,
        )

    monkeypatch.setattr(service, "_load_cached_or_persisted", no_existing)
    monkeypatch.setattr(service, "_persist_fact", fake_persist)
    monkeypatch.setattr(service, "_store_hot_cache", no_cache)

    envelope, warnings = await service.get_or_refresh_custom_fact("msft", spec, loader)

    assert warnings == []
    assert envelope.value == {"expected_move_pct": 5.2}
    assert envelope.freshness.as_of == observed
    assert envelope.freshness.source == "unit_loader"
    assert envelope.freshness.stale_after_seconds == 120
    assert persisted == [
        ("MSFT", "earnings", "event_metrics:2026-05-03:auto", {"expected_move_pct": 5.2})
    ]
