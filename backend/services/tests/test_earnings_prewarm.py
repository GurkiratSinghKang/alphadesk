"""Unit tests for the earnings pre-warm pipeline (Batch R).

These tests stub every external upstream — Alpaca options chain, FMP
earnings calendar, FMP surprises, Anthropic Opus — so the suite never
makes a network call and never touches the Claude budget. The goal is
behaviour coverage of the orchestration layer:

  * filtering to today + tomorrow only
  * structured logs at start / per-symbol / end
  * cost ceiling tracking ($0.30 per Claude call)
  * env kill-switch (``ALPHADESK_PREWARM_ENABLED=false``)
  * Claude-only kill-switch (``ALPHADESK_PREWARM_CLAUDE_ENABLED=false``)
  * cache-hit short-circuit (no Claude cost charged on warm cache)
  * upstream failures become per-stage errors, not run-level aborts
"""
from __future__ import annotations

import logging
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

# Match the import-path bootstrap used by other backend tests so this file
# can run from repo root or backend/ directly. ``services.earnings_prewarm``
# expects ``services.*`` and ``core.*`` to resolve.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_BACKEND = _REPO_ROOT / "backend"
for p in (_REPO_ROOT, _BACKEND):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_calendar_row(
    *,
    symbol: str,
    days_until: int,
    report_date_obj: date | None = None,
    report_time: str = "AMC",
    company: str | None = None,
    sector: str = "Technology",
):
    """Build a stand-in for ``CalendarRow`` with the fields the prewarm reads."""
    if report_date_obj is None:
        # Pick a stable date that's deterministic for the test name.
        report_date_obj = date(2026, 5, 5)
    return SimpleNamespace(
        symbol=symbol,
        company=company or f"{symbol} Inc.",
        sector=sector,
        report_date=report_date_obj,
        report_time=report_time,
        days_until=days_until,
    )


def _make_calendar_response(rows: list[Any]):
    return SimpleNamespace(
        earnings=rows,
        generated_at=datetime.now(timezone.utc),
        partial=False,
    )


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prewarm_runs_chain_iv_history_and_claude_for_each_symbol(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Happy path: 2 reporters today/tomorrow → 8 stage calls + 2 Claude theses."""
    from services import earnings_prewarm

    # Knobs ON.
    monkeypatch.delenv("ALPHADESK_PREWARM_ENABLED", raising=False)
    monkeypatch.delenv("ALPHADESK_PREWARM_CLAUDE_ENABLED", raising=False)

    rows = [
        _make_calendar_row(symbol="AMD", days_until=0),
        _make_calendar_row(symbol="MSFT", days_until=1),
    ]

    monkeypatch.setattr(
        earnings_prewarm,
        "_list_today_and_tomorrow_symbols",
        AsyncMock(return_value=[
            {
                "symbol": r.symbol,
                "company": r.company,
                "sector": r.sector,
                "report_date": r.report_date.isoformat(),
                "report_time": r.report_time,
                "next_friday_expiry": None,
            }
            for r in rows
        ]),
    )

    chain_calls: list[tuple[str, date | None]] = []
    iv_calls: list[str] = []
    history_calls: list[tuple[str, date]] = []
    research_calls: list[tuple[str, str]] = []

    async def fake_fetch_chain(symbol: str, expiry=None, **kwargs):
        chain_calls.append((symbol, expiry))
        return SimpleNamespace(contracts=[], expirations=[], spot_price=100.0)

    async def fake_fetch_iv_analysis(symbol: str, **kwargs):
        iv_calls.append(symbol)
        return SimpleNamespace(
            current_iv=0.4, iv_rank=50, iv_percentile=60,
            hv_20=0.35, hv_50=0.32, hv_100=0.30, is_demo=False,
        )

    async def fake_load_historical(symbol: str, report_date: date, *, lookback_quarters: int = 8):
        history_calls.append((symbol, report_date))
        return {"quarters": [], "stats": {}}

    async def fake_load_cached(symbol: str, *, meta: dict):
        return None  # cold cache → forces run_full_research

    async def fake_run_full_research(symbol: str, *, meta: dict):
        research_calls.append((symbol, meta["report_date"]))
        return SimpleNamespace(model="opus")

    # services.options
    import services.options as options_module
    monkeypatch.setattr(options_module, "fetch_chain", fake_fetch_chain)
    monkeypatch.setattr(options_module, "fetch_iv_analysis", fake_fetch_iv_analysis)

    # services.earnings_screener — both the historical loader and the
    # Claude full-research loaders. The prewarm imports them lazily inside
    # each stage, so we patch the module attributes directly.
    import services.earnings_screener as screener_module
    monkeypatch.setattr(screener_module, "_load_historical_earnings", fake_load_historical)
    monkeypatch.setattr(screener_module, "load_cached_full_research", fake_load_cached)
    monkeypatch.setattr(screener_module, "run_full_research", fake_run_full_research)

    caplog.set_level(logging.INFO, logger="alphadesk.earnings_prewarm")
    result = await earnings_prewarm.prewarm_earnings(concurrency=1)

    assert sorted(result.symbols_attempted) == ["AMD", "MSFT"]
    assert sorted(result.symbols_succeeded) == ["AMD", "MSFT"]
    assert result.claude_calls == 2
    assert result.estimated_cost_usd == pytest.approx(0.60, abs=1e-6)
    assert result.skipped_reason is None

    assert sorted(c[0] for c in chain_calls) == ["AMD", "MSFT"]
    assert sorted(iv_calls) == ["AMD", "MSFT"]
    assert sorted(c[0] for c in history_calls) == ["AMD", "MSFT"]
    assert sorted(c[0] for c in research_calls) == ["AMD", "MSFT"]

    # Structured log events emitted at start / per-symbol / end.
    events = [getattr(rec, "event", None) for rec in caplog.records]
    assert "prewarm.start" in events
    assert "prewarm.symbol" in events
    assert "prewarm.end" in events


@pytest.mark.asyncio
async def test_prewarm_skips_when_disabled_via_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``ALPHADESK_PREWARM_ENABLED=false`` short-circuits before any upstream
    is touched (no Claude budget burn during incidents)."""
    from services import earnings_prewarm

    monkeypatch.setenv("ALPHADESK_PREWARM_ENABLED", "false")
    list_mock = AsyncMock()
    monkeypatch.setattr(
        earnings_prewarm,
        "_list_today_and_tomorrow_symbols",
        list_mock,
    )

    result = await earnings_prewarm.prewarm_earnings()

    assert result.skipped_reason == "disabled_via_env"
    assert result.symbols_attempted == []
    assert result.claude_calls == 0
    assert result.estimated_cost_usd == 0.0
    list_mock.assert_not_called()


@pytest.mark.asyncio
async def test_prewarm_claude_disabled_still_warms_chain_iv_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the Claude kill-switch fires, chain/IV/history still warm but
    no Anthropic call (and no $0.30 charge) is incurred."""
    from services import earnings_prewarm

    monkeypatch.delenv("ALPHADESK_PREWARM_ENABLED", raising=False)
    monkeypatch.setenv("ALPHADESK_PREWARM_CLAUDE_ENABLED", "false")

    rows = [{
        "symbol": "AMD",
        "company": "AMD Inc.",
        "sector": "Tech",
        "report_date": "2026-05-05",
        "report_time": "AMC",
        "next_friday_expiry": None,
    }]
    monkeypatch.setattr(
        earnings_prewarm, "_list_today_and_tomorrow_symbols",
        AsyncMock(return_value=rows),
    )

    chain_called = False
    iv_called = False
    history_called = False
    research_called = False

    async def fake_fetch_chain(symbol, expiry=None, **kwargs):
        nonlocal chain_called
        chain_called = True
        return SimpleNamespace(contracts=[], expirations=[], spot_price=100.0)

    async def fake_fetch_iv_analysis(symbol, **kwargs):
        nonlocal iv_called
        iv_called = True
        return SimpleNamespace(
            current_iv=0.4, iv_rank=50, iv_percentile=60,
            hv_20=0.35, hv_50=0.32, hv_100=0.30, is_demo=False,
        )

    async def fake_load_historical(symbol, report_date, *, lookback_quarters=8):
        nonlocal history_called
        history_called = True
        return None

    async def fake_run_full_research(symbol, *, meta):
        nonlocal research_called
        research_called = True
        return SimpleNamespace()

    import services.options as options_module
    monkeypatch.setattr(options_module, "fetch_chain", fake_fetch_chain)
    monkeypatch.setattr(options_module, "fetch_iv_analysis", fake_fetch_iv_analysis)
    import services.earnings_screener as screener_module
    monkeypatch.setattr(screener_module, "_load_historical_earnings", fake_load_historical)
    monkeypatch.setattr(screener_module, "run_full_research", fake_run_full_research)

    result = await earnings_prewarm.prewarm_earnings(concurrency=1)

    assert chain_called
    assert iv_called
    assert history_called
    assert research_called is False
    assert result.claude_calls == 0
    assert result.estimated_cost_usd == 0.0
    # Per-symbol record exists; the claude stage is logged as skipped.
    assert len(result.per_symbol) == 1
    sym_result = result.per_symbol[0]
    claude_stage = next(s for s in sym_result.stages if s.stage == "claude_thesis")
    assert claude_stage.ok is True
    assert claude_stage.skipped_reason == "claude_disabled_via_env"


@pytest.mark.asyncio
async def test_prewarm_claude_cache_hit_does_not_rerun(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A warm Claude cache means zero cost — the prewarm should observe the
    pre-flight hit and skip the actual Opus call."""
    from services import earnings_prewarm

    monkeypatch.delenv("ALPHADESK_PREWARM_ENABLED", raising=False)
    monkeypatch.delenv("ALPHADESK_PREWARM_CLAUDE_ENABLED", raising=False)

    rows = [{
        "symbol": "NVDA",
        "company": "NVIDIA",
        "sector": "Tech",
        "report_date": "2026-05-05",
        "report_time": "AMC",
        "next_friday_expiry": None,
    }]
    monkeypatch.setattr(
        earnings_prewarm, "_list_today_and_tomorrow_symbols",
        AsyncMock(return_value=rows),
    )

    async def fake_fetch_chain(symbol, expiry=None, **kwargs):
        return SimpleNamespace(contracts=[], expirations=[], spot_price=100.0)

    async def fake_fetch_iv_analysis(symbol, **kwargs):
        return SimpleNamespace(
            current_iv=0.4, iv_rank=50, iv_percentile=60,
            hv_20=0.35, hv_50=0.32, hv_100=0.30, is_demo=False,
        )

    async def fake_load_historical(symbol, report_date, *, lookback_quarters=8):
        return {"quarters": [], "stats": {}}

    # Cache hit → load_cached_full_research returns a non-None payload.
    async def fake_load_cached(symbol, *, meta):
        return SimpleNamespace(model="opus_cached")

    research_called = False

    async def fake_run_full_research(symbol, *, meta):
        nonlocal research_called
        research_called = True
        return SimpleNamespace()

    import services.options as options_module
    monkeypatch.setattr(options_module, "fetch_chain", fake_fetch_chain)
    monkeypatch.setattr(options_module, "fetch_iv_analysis", fake_fetch_iv_analysis)
    import services.earnings_screener as screener_module
    monkeypatch.setattr(screener_module, "_load_historical_earnings", fake_load_historical)
    monkeypatch.setattr(screener_module, "load_cached_full_research", fake_load_cached)
    monkeypatch.setattr(screener_module, "run_full_research", fake_run_full_research)

    result = await earnings_prewarm.prewarm_earnings(concurrency=1)

    assert research_called is False
    assert result.claude_calls == 0
    assert result.estimated_cost_usd == 0.0
    sym_result = result.per_symbol[0]
    claude_stage = next(s for s in sym_result.stages if s.stage == "claude_thesis")
    assert claude_stage.ok is True
    assert claude_stage.skipped_reason == "cache_hit"


@pytest.mark.asyncio
async def test_prewarm_filters_to_today_and_tomorrow_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``_list_today_and_tomorrow_symbols`` drops rows with days_until > 1.

    The ``list_upcoming("both")`` call returns the front-of-week + next-week
    union; the prewarm intentionally narrows to the next two sessions because
    that is the window users care about for day-of report cards.
    """
    from services import earnings_prewarm

    rows = [
        _make_calendar_row(symbol="AMD", days_until=0),     # today
        _make_calendar_row(symbol="MSFT", days_until=1),    # tomorrow
        _make_calendar_row(symbol="GOOGL", days_until=3),   # too far out
        _make_calendar_row(symbol="META", days_until=5),    # too far out
    ]

    async def fake_list_upcoming(**kwargs):
        return _make_calendar_response(rows)

    import services.earnings_screener as screener_module
    monkeypatch.setattr(screener_module, "list_upcoming", fake_list_upcoming)

    out = await earnings_prewarm._list_today_and_tomorrow_symbols()
    assert sorted(r["symbol"] for r in out) == ["AMD", "MSFT"]


@pytest.mark.asyncio
async def test_prewarm_chain_failure_records_per_stage_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A raise from ``fetch_chain`` is recorded on the chain stage but
    later stages still run — the prewarm must not abort a whole symbol on
    one upstream blip."""
    from services import earnings_prewarm

    monkeypatch.delenv("ALPHADESK_PREWARM_ENABLED", raising=False)
    monkeypatch.delenv("ALPHADESK_PREWARM_CLAUDE_ENABLED", raising=False)

    rows = [{
        "symbol": "AMD",
        "company": "AMD",
        "sector": "Tech",
        "report_date": "2026-05-05",
        "report_time": "AMC",
        "next_friday_expiry": None,
    }]
    monkeypatch.setattr(
        earnings_prewarm, "_list_today_and_tomorrow_symbols",
        AsyncMock(return_value=rows),
    )

    async def boom_fetch_chain(symbol, expiry=None, **kwargs):
        raise RuntimeError("alpaca offline")

    async def fake_fetch_iv_analysis(symbol, **kwargs):
        return SimpleNamespace(
            current_iv=0.4, iv_rank=50, iv_percentile=60,
            hv_20=0.35, hv_50=0.32, hv_100=0.30, is_demo=False,
        )

    async def fake_load_historical(symbol, report_date, *, lookback_quarters=8):
        return None

    async def fake_load_cached(symbol, *, meta):
        return None

    async def fake_run_full_research(symbol, *, meta):
        return SimpleNamespace()

    import services.options as options_module
    monkeypatch.setattr(options_module, "fetch_chain", boom_fetch_chain)
    monkeypatch.setattr(options_module, "fetch_iv_analysis", fake_fetch_iv_analysis)
    import services.earnings_screener as screener_module
    monkeypatch.setattr(screener_module, "_load_historical_earnings", fake_load_historical)
    monkeypatch.setattr(screener_module, "load_cached_full_research", fake_load_cached)
    monkeypatch.setattr(screener_module, "run_full_research", fake_run_full_research)

    result = await earnings_prewarm.prewarm_earnings(concurrency=1)

    sym_result = result.per_symbol[0]
    chain_stage = next(s for s in sym_result.stages if s.stage == "chain")
    iv_stage = next(s for s in sym_result.stages if s.stage == "iv")
    claude_stage = next(s for s in sym_result.stages if s.stage == "claude_thesis")

    assert chain_stage.ok is False
    assert "alpaca offline" in (chain_stage.error or "")
    # Later stages still ran — the per-symbol pipeline is best-effort.
    assert iv_stage.ok is True
    assert claude_stage.ok is True

    # Symbol is NOT in `succeeded` because not all stages were ok.
    assert "AMD" not in result.symbols_succeeded
    # But Claude was called once → cost still incurred.
    assert result.claude_calls == 1
    assert result.estimated_cost_usd == pytest.approx(0.30, abs=1e-6)


@pytest.mark.asyncio
async def test_prewarm_calendar_unavailable_returns_clean_skip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the FMP calendar itself blows up (provider outage), the prewarm
    returns a structured skip rather than a 500-equivalent exception."""
    from services import earnings_prewarm

    monkeypatch.delenv("ALPHADESK_PREWARM_ENABLED", raising=False)

    async def boom_list():
        raise RuntimeError("fmp 504")

    monkeypatch.setattr(
        earnings_prewarm, "_list_today_and_tomorrow_symbols", boom_list,
    )

    result = await earnings_prewarm.prewarm_earnings()
    assert result.skipped_reason == "calendar_unavailable"
    assert result.symbols_attempted == []
    assert result.claude_calls == 0


@pytest.mark.asyncio
async def test_prewarm_no_symbols_in_window_short_circuits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty window (Sunday → next earnings is Tuesday) is not an error.

    The prewarm logs ``prewarm.end`` with ``skipped_reason='no_symbols_in_window'``
    and zero cost.
    """
    from services import earnings_prewarm

    monkeypatch.delenv("ALPHADESK_PREWARM_ENABLED", raising=False)
    monkeypatch.setattr(
        earnings_prewarm, "_list_today_and_tomorrow_symbols",
        AsyncMock(return_value=[]),
    )

    result = await earnings_prewarm.prewarm_earnings()
    assert result.skipped_reason == "no_symbols_in_window"
    assert result.symbols_attempted == []
    assert result.claude_calls == 0


@pytest.mark.asyncio
async def test_run_earnings_prewarm_wrapper_skips_on_non_trading_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ``daily_pipeline.run_earnings_prewarm`` wrapper returns a
    structured skip on non-trading days — no upstream calls, no cost."""
    from data.ingestion import daily_pipeline as dp

    # Pretend it's a holiday.
    import data.calendar as cal
    monkeypatch.setattr(cal, "is_trading_day", lambda d: False)

    called = False

    async def should_not_run(*args, **kwargs):
        nonlocal called
        called = True
        return None

    # If the wrapper short-circuits, we should never reach the prewarm.
    from services import earnings_prewarm
    monkeypatch.setattr(earnings_prewarm, "prewarm_earnings", should_not_run)

    result = await dp.run_earnings_prewarm()
    assert result["skipped"] is True
    assert result["reason"] == "not_a_trading_day"
    assert called is False
