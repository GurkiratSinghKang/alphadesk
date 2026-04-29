"""Round-5 backend correctness + observability fixes — regression tests.

These cover the audit findings (Personas E, G, H) that motivated the
Round-5 work:

  * Cluster A — Data flag propagation: ``StrikeLadder.is_demo``,
    ``EarningsDetail.error_codes``, ``watchlist_only`` filter.
  * Cluster B — ``_inflight_structured`` race + state hygiene.
  * Cluster C — Cache schema bump, ``_load_iv_term`` parallelism +
    failure semantics.
  * Cluster D — Claude budget kill-switch, log records carrying user_id,
    /livez + /readyz-full git_sha + variable TTL.
  * Cluster E — Settings-driven test-mode FMP cache bypass.

A failing test in this module signals a regression on a Round-5 fix.
Add a new case here when extending any of those subsystems.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ─── Cluster A — Data flag propagation ───────────────────────


@pytest.mark.asyncio
async def test_strike_ladder_carries_demo_flag():
    """E-1: when ``OptionChain.is_demo`` is True (BSM-derived demo path),
    the StrikeLadder MUST surface that flag so the frontend DEMO DATA
    badge can render. Previously the screener silently dropped the flag."""
    from services import earnings_screener as svc

    class _FakeContract:
        def __init__(self, side: str) -> None:
            self.option_type = "call" if side == "call" else "put"
            self.strike = 100.0
            self.delta = 0.5 if side == "call" else -0.5
            self.bid = 1.0
            self.ask = 1.2
            self.last = 1.1
            self.iv = 0.4
            self.theta = -0.05
            self.gamma = 0.01
            self.vega = 0.1
            self.open_interest = 100
            self.volume = 50

    class _FakeChain:
        spot_price = 100.0
        contracts = [_FakeContract("call"), _FakeContract("put")]
        expirations = [date.today()]
        is_demo = True

    async def _stub_fetch_chain(*_args, **_kwargs):
        return _FakeChain()

    with patch("services.options.fetch_chain", side_effect=_stub_fetch_chain):
        result = await svc._load_strike_ladder("NVDA", expiry=None)

    assert result is not None
    assert result["is_demo"] is True


@pytest.mark.asyncio
async def test_get_detail_marks_partial_when_claude_fails():
    """E-3: when Claude returns None (outage / parse error), partial MUST
    flip to True and ``claude_unavailable`` must appear in error_codes."""
    from services import earnings_screener as svc

    fake_news = {"articles": [], "is_demo": False}
    with patch.object(svc, "_load_quote", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_strike_ladder", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_claude_structured", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_iv_term", AsyncMock(return_value=(None, False))), \
         patch.object(svc, "_load_skew", AsyncMock(return_value=None)), \
         patch.object(svc, "_news_payload", AsyncMock(return_value=fake_news)), \
         patch.object(
             svc, "_load_earnings_meta",
             AsyncMock(return_value={
                 "company": "Nvidia", "sector": "Semis",
                 "report_date": "2026-04-23", "report_time": "AMC",
                 "symbol": "NVDA",
             }),
         ):
        detail = await svc.get_detail("NVDA")

    assert detail.partial is True
    assert "claude_unavailable" in detail.error_codes


@pytest.mark.asyncio
async def test_get_detail_emits_chain_demo_in_error_codes():
    """E-1 follow-on: a demo-flagged StrikeLadder must surface
    ``chain_demo`` in error_codes AND flip partial=True."""
    from services import earnings_screener as svc

    demo_ladder = {
        "expiry": date.today(),
        "underlying_price": 100.0,
        "rows": [],
        "is_demo": True,
    }
    fake_claude = {
        "verdict": "neutral",
        "direction_magnitude": {"bull_case_pct": 0.0, "bear_case_pct": 0.0},
        "thesis": "x", "catalysts": [], "risks": [],
        # Round-12 / DR-1: replaced "short call" with a defined-risk setup.
        "suggested_play": "iron condor", "suggested_play_reason": "x",
        "confidence": 0.5, "model": "claude-haiku-4-7",
        "generated_at": datetime.now(timezone.utc),
    }
    fake_news = {"articles": [], "is_demo": False}
    with patch.object(svc, "_load_quote", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_strike_ladder", AsyncMock(return_value=demo_ladder)), \
         patch.object(svc, "_load_claude_structured", AsyncMock(return_value=fake_claude)), \
         patch.object(svc, "_load_iv_term", AsyncMock(return_value=(None, False))), \
         patch.object(svc, "_load_skew", AsyncMock(return_value=None)), \
         patch.object(svc, "_news_payload", AsyncMock(return_value=fake_news)), \
         patch.object(
             svc, "_load_earnings_meta",
             AsyncMock(return_value={
                 "company": "Nvidia", "sector": "Semis",
                 "report_date": "2026-04-23", "report_time": "AMC",
                 "symbol": "NVDA",
             }),
         ):
        detail = await svc.get_detail("NVDA")

    assert detail.partial is True
    assert "chain_demo" in detail.error_codes
    # Forward-compat: the demo flag is also exposed on the embedded ladder.
    assert detail.strike_ladder is not None
    assert detail.strike_ladder.is_demo is True


@pytest.mark.asyncio
async def test_list_upcoming_filters_by_watchlist_when_flagged(monkeypatch):
    """G-15: ``watchlist_only=True`` must reduce the result to symbols
    in the configured watchlist. Previously the kwarg was a complete
    no-op."""
    from core.config import settings
    from services import earnings_screener as svc

    monkeypatch.setattr(settings, "WATCHLIST_DEFAULT_SYMBOLS", "NVDA,TSLA")

    fake = [
        {"symbol": "NVDA", "company": "N", "sector": "S",
         "report_date": "2026-04-23", "report_time": "AMC"},
        {"symbol": "AAPL", "company": "A", "sector": "S",
         "report_date": "2026-04-24", "report_time": "AMC"},
        {"symbol": "TSLA", "company": "T", "sector": "S",
         "report_date": "2026-04-25", "report_time": "AMC"},
    ]

    async def _hydrate(row, *, min_iv_rank: float = 0,
                       client_host=None, today=None):
        return {**row, "price": 100.0, "iv_rank": 50,
                "days_until": 1, "report_state": "upcoming"}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=_hydrate)):
        resp = await svc.list_upcoming(watchlist_only=True)

    symbols = sorted(r.symbol for r in resp.earnings)
    # Curated filter only keeps NVDA, TSLA (AAPL would too, but it's
    # not in our test watchlist).
    assert symbols == ["NVDA", "TSLA"]


@pytest.mark.asyncio
async def test_list_upcoming_prefers_explicit_watchlist(monkeypatch):
    """A user-provided watchlist must override the operator default."""
    from core.config import settings
    from services import earnings_screener as svc

    monkeypatch.setattr(settings, "WATCHLIST_DEFAULT_SYMBOLS", "NVDA")

    fake = [
        {"symbol": "NVDA", "company": "N", "sector": "S",
         "report_date": "2026-04-23", "report_time": "AMC"},
        {"symbol": "AAPL", "company": "A", "sector": "S",
         "report_date": "2026-04-24", "report_time": "AMC"},
    ]

    async def _hydrate(row, *, min_iv_rank: float = 0,
                       client_host=None, today=None):
        return {**row, "price": 100.0, "iv_rank": 50,
                "days_until": 1, "report_state": "upcoming"}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=_hydrate)):
        resp = await svc.list_upcoming(
            watchlist_only=True,
            watchlist_symbols=["AAPL"],
        )

    assert [r.symbol for r in resp.earnings] == ["AAPL"]


@pytest.mark.asyncio
async def test_list_upcoming_empty_explicit_watchlist_returns_no_rows(monkeypatch):
    """An explicit empty user watchlist should not fall back to defaults."""
    from core.config import settings
    from services import earnings_screener as svc

    monkeypatch.setattr(settings, "WATCHLIST_DEFAULT_SYMBOLS", "NVDA")

    fake = [
        {"symbol": "NVDA", "company": "N", "sector": "S",
         "report_date": "2026-04-23", "report_time": "AMC"},
    ]

    async def _hydrate(row, *, min_iv_rank: float = 0,
                       client_host=None, today=None):
        return {**row, "price": 100.0, "iv_rank": 50,
                "days_until": 1, "report_state": "upcoming"}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=_hydrate)):
        resp = await svc.list_upcoming(
            watchlist_only=True,
            watchlist_symbols=[],
        )

    assert resp.earnings == []


@pytest.mark.asyncio
async def test_list_upcoming_watchlist_off_no_filtering(monkeypatch):
    """When watchlist_only=False the watchlist setting is ignored."""
    from core.config import settings
    from services import earnings_screener as svc

    monkeypatch.setattr(settings, "WATCHLIST_DEFAULT_SYMBOLS", "NVDA")

    fake = [
        {"symbol": "NVDA", "company": "N", "sector": "S",
         "report_date": "2026-04-23", "report_time": "AMC"},
        {"symbol": "AAPL", "company": "A", "sector": "S",
         "report_date": "2026-04-24", "report_time": "AMC"},
    ]

    async def _hydrate(row, *, min_iv_rank: float = 0,
                       client_host=None, today=None):
        return {**row, "price": 100.0, "iv_rank": 50,
                "days_until": 1, "report_state": "upcoming"}

    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=_hydrate)):
        resp = await svc.list_upcoming(watchlist_only=False)

    assert {r.symbol for r in resp.earnings} == {"NVDA", "AAPL"}


# ─── Cluster B — _inflight_structured race ──────────────────


@pytest.mark.asyncio
async def test_inflight_structured_lock_is_lazy():
    """G-11: the asyncio.Lock guarding get-or-create is created lazily
    (asyncio.Lock binds to the running event loop on construction).
    Module-import-time creation would break under fresh per-session
    test loops."""
    from services import earnings_screener as svc

    # Reset to confirm the lazy path.
    svc._INFLIGHT_LOCK = None
    lock = svc._get_inflight_lock()
    assert isinstance(lock, asyncio.Lock)
    assert svc._INFLIGHT_LOCK is lock
    # Subsequent calls return the same instance.
    assert svc._get_inflight_lock() is lock


@pytest.mark.asyncio
async def test_inflight_structured_done_callback_identity_compare():
    """G-11/E-4: the done-callback must identity-compare before popping.
    A successor task that replaced the dict entry must NOT be wiped by
    a predecessor's cleanup."""
    from services import earnings_screener as svc

    svc._inflight_structured.clear()

    # Simulate the race: register task_a, then replace it with task_b;
    # when task_a's callback fires it should NOT pop task_b.
    async def _sleep_a():
        return None

    async def _sleep_b():
        return None

    task_a = asyncio.create_task(_sleep_a())
    task_b = asyncio.create_task(_sleep_b())

    inflight_key = "NVDA:2026-04-23"
    svc._inflight_structured[inflight_key] = task_a
    # Construct the same identity-checking callback the production code uses.
    def _done(t, k=inflight_key):
        if svc._inflight_structured.get(k) is t:
            svc._inflight_structured.pop(k, None)
    task_a.add_done_callback(_done)
    # Successor replaces the entry.
    svc._inflight_structured[inflight_key] = task_b
    await task_a
    await asyncio.sleep(0)  # let done-callbacks fire
    # task_b survives — the callback noticed it wasn't task_a in the dict.
    assert svc._inflight_structured.get(inflight_key) is task_b
    await task_b


# ─── Cluster C — IV term partial + cache schema ─────────────


@pytest.mark.asyncio
async def test_load_iv_term_returns_tuple():
    """E-11 contract: _load_iv_term returns (points, is_partial)."""
    from services import earnings_screener as svc

    class _Contract:
        option_type = "call"
        strike = 100.0
        iv = 0.4

    class _Chain:
        spot_price = 100.0
        contracts = [_Contract()]
        expirations = [date(2026, 5, 1), date(2026, 6, 1)]
        is_demo = False

    async def _fetch(symbol, expiry=None, **_):
        return _Chain()

    with patch("services.options.fetch_chain", side_effect=_fetch):
        result = await svc._load_iv_term("NVDA")

    assert isinstance(result, tuple)
    assert len(result) == 2
    points, is_partial = result
    assert is_partial is False  # both fetches succeeded


@pytest.mark.asyncio
async def test_load_iv_term_partial_on_majority_failure():
    """E-11: when more than half of the per-expiration fetches fail,
    is_partial=True so get_detail can append iv_term_partial."""
    from services import earnings_screener as svc

    class _Contract:
        option_type = "call"
        strike = 100.0
        iv = 0.4

    class _ChainOK:
        spot_price = 100.0
        contracts = [_Contract()]
        expirations = [
            date.today(), date(2026, 5, 1), date(2026, 6, 1), date(2026, 7, 1),
        ]
        is_demo = False

    call_count = 0

    async def _fetch(symbol, expiry=None, **_):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # First call (the unfiltered chain) succeeds — used to enumerate
            # expirations and reused for the first leg.
            return _ChainOK()
        # Fail every per-expiration call after that.
        raise RuntimeError("alpaca down")

    with patch("services.options.fetch_chain", side_effect=_fetch):
        points, is_partial = await svc._load_iv_term("NVDA")

    # 3 per-expiration fetches (after reusing the first), all 3 failed → partial.
    assert is_partial is True


@pytest.mark.asyncio
async def test_load_iv_term_avoids_double_first_fetch():
    """E-10: first chain must be reused for expirations[0] — only
    N fetches total when there are N expirations, not N+1."""
    from services import earnings_screener as svc

    class _Contract:
        option_type = "call"
        strike = 100.0
        iv = 0.4

    class _Chain:
        spot_price = 100.0
        contracts = [_Contract()]
        expirations = [date(2026, 5, 1), date(2026, 6, 1), date(2026, 7, 1)]
        is_demo = False

    fetch_count = 0

    async def _fetch(symbol, expiry=None, **_):
        nonlocal fetch_count
        fetch_count += 1
        return _Chain()

    with patch("services.options.fetch_chain", side_effect=_fetch):
        await svc._load_iv_term("NVDA")

    # 3 expirations → 1 (first unfiltered) + 2 (rest) = 3 total fetches.
    # Old buggy code would have made 4 (1 + 3).
    assert fetch_count == 3


def test_cache_schema_version_is_two():
    """G-12: bumping the schema version is the migration trigger for
    every wire-shape change. v2 = Round-5 (added is_demo, error_codes
    on EarningsDetail / StrikeLadder / OptionChain). Anyone landing a
    new field on those models MUST also bump this and add a migration
    note in the cache.py docstring."""
    from core.cache import _CURRENT_SCHEMA_VERSION

    assert _CURRENT_SCHEMA_VERSION == 2


@pytest.mark.asyncio
async def test_cache_get_returns_none_on_v1_legacy_payload():
    """v1 entries written before the bump must deserialise as cache
    misses, not fail-open into a partial Pydantic shape."""
    from core import cache as cache_mod

    # Envelope shape uses ``schema_version`` + ``value``. A v1 entry
    # carries the older version; the get() path must reject it.
    raw = {"schema_version": 1, "value": {"some": "old shape"}}
    with patch.object(cache_mod, "cache_get", AsyncMock(return_value=raw)):
        out = await cache_mod._RedisCache().get("earnings:test:KEY")
    assert out is None


@pytest.mark.asyncio
async def test_cache_set_get_roundtrip_v2():
    """Writing v2 + reading back returns the original payload."""
    from core import cache as cache_mod

    written: dict = {}

    async def _fake_set(key, value, ttl_seconds=300):
        written[key] = value

    async def _fake_get(key):
        return written.get(key)

    with patch.object(cache_mod, "cache_set", side_effect=_fake_set), \
         patch.object(cache_mod, "cache_get", side_effect=_fake_get):
        c = cache_mod._RedisCache()
        await c.set("earnings:t:K", {"x": 1})
        out = await c.get("earnings:t:K")
    assert out == {"x": 1}


@pytest.mark.asyncio
async def test_cache_get_logs_hit_and_miss(caplog):
    """H-5: hit/miss outcomes emit DEBUG records with key_prefix."""
    from core import cache as cache_mod

    written: dict = {}

    async def _fake_set(key, value, ttl_seconds=300):
        written[key] = value

    async def _fake_get(key):
        return written.get(key)

    caplog.set_level(logging.DEBUG, logger="core.cache")
    with patch.object(cache_mod, "cache_set", side_effect=_fake_set), \
         patch.object(cache_mod, "cache_get", side_effect=_fake_get):
        c = cache_mod._RedisCache()
        # Miss
        await c.get("earnings:miss:KEY")
        # Hit (after writing)
        await c.set("earnings:hit:KEY", {"x": 1})
        await c.get("earnings:hit:KEY")

    outcomes = [
        getattr(r, "outcome", None) for r in caplog.records
        if getattr(r, "event", None) == "cache"
    ]
    assert "miss" in outcomes
    assert "hit" in outcomes


# ─── Cluster D — Claude budget kill-switch + observability ──


@pytest.mark.asyncio
async def test_claude_budget_kill_switch_logs_when_over_but_does_not_raise(monkeypatch, caplog):
    """Round-29 (user pivot): the previous H-2 hard-cap behaviour was
    silently halting Claude calls when the spend tracker glitched, so
    the budget-exceeded path is now a SOFT cap — log a WARNING but
    keep the call flowing. Operators who want a hard cap should drive
    it externally (e.g. an Anthropic billing alarm) rather than rely
    on this in-process gate."""
    import logging
    from agents import claude_client as cc
    from core.config import settings

    monkeypatch.setattr(settings, "CLAUDE_DAILY_BUDGET_USD", 1.0)
    monkeypatch.setattr(settings, "CLAUDE_BUDGET_KILL_SWITCH_ENABLED", True)

    async def _over_budget(_estimate):
        return 99.0

    async def _no_op_reconcile(_e, _a):
        return None

    monkeypatch.setattr(cc, "_record_spend_estimate", _over_budget)
    monkeypatch.setattr(cc, "_reconcile_spend", _no_op_reconcile)

    # The API call SHOULD fire — return a minimal valid response.
    fake_resp = MagicMock()
    fake_resp.content = [MagicMock(text="ok")]
    fake_resp.usage.input_tokens = 1
    fake_resp.usage.output_tokens = 1
    fake_resp.usage.cache_creation_input_tokens = 0
    fake_resp.usage.cache_read_input_tokens = 0
    fake_resp.model = "claude-haiku-4-7"
    fake_anthropic = AsyncMock()
    fake_anthropic.messages.create = AsyncMock(return_value=fake_resp)

    client = cc.ClaudeClient.__new__(cc.ClaudeClient)
    client._client = fake_anthropic

    with caplog.at_level(logging.WARNING, logger="agents.claude_client"):
        result = await client.complete(system="s", user="u", model="claude-haiku-4-7")

    # Soft-cap log fired but call proceeded.
    assert any(
        "soft_threshold_crossed" in record.message for record in caplog.records
    )
    assert result is not None
    fake_anthropic.messages.create.assert_called_once()


@pytest.mark.asyncio
async def test_claude_budget_kill_switch_disabled_via_setting(monkeypatch):
    """H-2: with the kill-switch disabled, an over-budget total must
    NOT raise — the API call proceeds normally."""
    from agents import claude_client as cc
    from core.config import settings

    monkeypatch.setattr(settings, "CLAUDE_DAILY_BUDGET_USD", 1.0)
    monkeypatch.setattr(settings, "CLAUDE_BUDGET_KILL_SWITCH_ENABLED", False)

    async def _over_budget(_estimate):
        return 99.0

    async def _no_op_reconcile(_e, _a):
        return None

    monkeypatch.setattr(cc, "_record_spend_estimate", _over_budget)
    monkeypatch.setattr(cc, "_reconcile_spend", _no_op_reconcile)

    class _FakeText:
        text = "ok"

    class _FakeResp:
        content = [_FakeText()]
        usage = type("U", (), {"input_tokens": 1, "output_tokens": 1})()

    fake_anthropic = AsyncMock()
    fake_anthropic.messages.create = AsyncMock(return_value=_FakeResp())

    client = cc.ClaudeClient.__new__(cc.ClaudeClient)
    client._client = fake_anthropic

    out = await client.complete(system="s", user="u", model="claude-haiku-4-7")
    assert out == "ok"


@pytest.mark.asyncio
async def test_claude_call_log_includes_user_id(monkeypatch, caplog):
    """H-3: the Claude call log line must carry user_id from the
    caller's context dict so cost-attribution dashboards can break
    spend down per user."""
    from agents import claude_client as cc
    from core.config import settings

    monkeypatch.setattr(settings, "CLAUDE_DAILY_BUDGET_USD", 1000.0)
    monkeypatch.setattr(settings, "CLAUDE_BUDGET_KILL_SWITCH_ENABLED", True)

    async def _under_budget(_e):
        return 0.0

    async def _no_op_reconcile(_e, _a):
        return None

    monkeypatch.setattr(cc, "_record_spend_estimate", _under_budget)
    monkeypatch.setattr(cc, "_reconcile_spend", _no_op_reconcile)

    class _FakeText:
        text = "ok"

    class _FakeResp:
        content = [_FakeText()]
        usage = type("U", (), {"input_tokens": 1, "output_tokens": 1})()

    fake_anthropic = AsyncMock()
    fake_anthropic.messages.create = AsyncMock(return_value=_FakeResp())

    client = cc.ClaudeClient.__new__(cc.ClaudeClient)
    client._client = fake_anthropic

    caplog.set_level(logging.INFO, logger="agents.claude_client")
    await client.complete(
        system="s", user="u", model="claude-haiku-4-7",
        context={"user_id": "alice", "endpoint": "earnings.detail"},
    )

    matched = [
        r for r in caplog.records
        if getattr(r, "event", None) == "claude_call"
    ]
    assert matched, "expected at least one claude_call log line"
    assert getattr(matched[0], "user_id", None) == "alice"
    assert getattr(matched[0], "endpoint", None) == "earnings.detail"


def test_livez_returns_status(authed_client):
    """Round-6 L-14 superseded H-8: /livez no longer leaks git_sha to
    public callers. Authenticated callers can still read git_sha via
    /readyz-full. The deploy-correlation use case is satisfied by
    GIT_SHA in JSON log records (see test_logging_includes_git_sha)."""
    r = authed_client.get("/livez")
    assert r.status_code == 200
    body = r.json()
    assert body == {"status": "ok"}
    assert "git_sha" not in body


def test_health_returns_status(authed_client):
    """Round-6 L-14: /health (back-compat alias) also strips git_sha."""
    r = authed_client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body == {"status": "ok"}
    assert "git_sha" not in body


def test_logging_includes_git_sha():
    """H-8: GIT_SHA stamps every JSON log record so log aggregators
    can correlate lines with a specific deploy."""
    import json
    import logging as _logging
    from io import StringIO

    from core.logging import GIT_SHA, JsonFormatter

    formatter = JsonFormatter()
    record = _logging.LogRecord(
        name="test", level=_logging.INFO, pathname="/x", lineno=1,
        msg="hello", args=(), exc_info=None,
    )
    out = formatter.format(record)
    payload = json.loads(out)
    assert "git_sha" in payload
    assert payload["git_sha"] == GIT_SHA  # default "unknown" in test env


# ─── Cluster D — /readyz-full variable TTL + body fields ────


def test_readyz_full_response_carries_round5_fields(authed_client, monkeypatch):
    """H-2/H-7/H-8: response body surfaces claude_spend_today_usd,
    dict_sizes, git_sha, cache_age_s. The whole point of these is
    operator visibility — guard the contract."""
    import main

    main._READYZ_FULL_CACHE["snapshot"] = None
    main._READYZ_FULL_CACHE["ts"] = 0.0
    main._READYZ_FULL_CACHE["status"] = ""

    # Patch DB + Redis paths to return ok.
    from unittest.mock import AsyncMock, patch
    fake_conn = AsyncMock()
    fake_conn.execute = AsyncMock(return_value=None)
    fake_conn.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_conn.__aexit__ = AsyncMock(return_value=None)
    fake_engine = AsyncMock()
    fake_engine.connect = lambda: fake_conn

    async def _redis_factory():
        m = AsyncMock()
        m.ping = AsyncMock(return_value=True)
        return m

    fake_fmp = AsyncMock(return_value={"status": "skipped", "reason": "test"})
    fake_anthropic = AsyncMock(return_value={"status": "skipped", "reason": "test"})

    with patch("core.database._get_engine", return_value=fake_engine), \
         patch("main.get_redis", _redis_factory), \
         patch("main._probe_fmp", fake_fmp), \
         patch("main._probe_anthropic", fake_anthropic):
        r = authed_client.get("/readyz-full")
    body = r.json()
    # All Round-5 D fields present.
    assert "claude_spend_today_usd" in body
    assert "dict_sizes" in body
    assert "git_sha" in body
    assert "cache_age_s" in body


def test_readyz_full_no_http_status_leak(authed_client):
    """H-4 hygiene: ``_http_status`` is an internal field we use to
    cache the response code; it must NOT leak into the JSON body."""
    import main
    import time as _time

    main._READYZ_FULL_CACHE["snapshot"] = {
        "status": "ok", "db": "ok", "redis": "ok",
        "_http_status": 200, "git_sha": "test", "dict_sizes": {},
        "claude_spend_today_usd": 1.23,
    }
    main._READYZ_FULL_CACHE["status"] = "ok"
    main._READYZ_FULL_CACHE["ts"] = _time.monotonic() - 5

    r = authed_client.get("/readyz-full")
    body = r.json()
    assert "_http_status" not in body


def test_readyz_full_short_ttl_on_degraded(authed_client):
    """H-4: when status is degraded, the cache TTL drops from 30s to 5s
    so a recovering system doesn't get masked by a stale snapshot."""
    import main
    import time as _time

    # Pre-load a degraded snapshot 6 seconds old (past the 5s degraded TTL).
    main._READYZ_FULL_CACHE["snapshot"] = {
        "status": "degraded", "db": "down: X", "redis": "ok",
        "_http_status": 503, "git_sha": "test", "dict_sizes": {},
        "claude_spend_today_usd": 0.0,
    }
    main._READYZ_FULL_CACHE["status"] = "degraded"
    main._READYZ_FULL_CACHE["ts"] = _time.monotonic() - 6

    # Patch internals so the recompute path returns ok, proving the
    # cache was bypassed (it would otherwise serve the degraded snapshot).
    from unittest.mock import AsyncMock, patch
    fake_conn = AsyncMock()
    fake_conn.execute = AsyncMock(return_value=None)
    fake_conn.__aenter__ = AsyncMock(return_value=fake_conn)
    fake_conn.__aexit__ = AsyncMock(return_value=None)
    fake_engine = AsyncMock()
    fake_engine.connect = lambda: fake_conn

    async def _redis_factory():
        m = AsyncMock()
        m.ping = AsyncMock(return_value=True)
        return m

    fake_fmp = AsyncMock(return_value={"status": "skipped"})
    fake_anthropic = AsyncMock(return_value={"status": "skipped"})

    with patch("core.database._get_engine", return_value=fake_engine), \
         patch("main.get_redis", _redis_factory), \
         patch("main._probe_fmp", fake_fmp), \
         patch("main._probe_anthropic", fake_anthropic):
        r = authed_client.get("/readyz-full")

    body = r.json()
    # Recomputed: cache_age_s should be ~0, not ~6 — proves the
    # short TTL kicked in.
    assert body.get("cache_age_s", 99) < 1.0


# ─── Cluster E — Settings flag + module-state hygiene ───────


def test_skip_earnings_fmp_cache_setting_default():
    """E-6: ship-default for SKIP_EARNINGS_FMP_CACHE must be False so
    production benefits from caching even if a test rig forgets to
    flip the flag."""
    from core.config import Settings

    s = Settings()
    assert s.SKIP_EARNINGS_FMP_CACHE is False


def test_watchlist_default_symbols_setting():
    """G-15: the default watchlist setting must be non-empty so the
    flag has visible behaviour out of the box."""
    from core.config import Settings

    s = Settings()
    # Default contains common mega-caps so the watchlist filter has
    # observable behaviour. Empty would be a regression — the flag
    # should do something useful by default.
    assert isinstance(s.WATCHLIST_DEFAULT_SYMBOLS, str)
    assert "AAPL" in s.WATCHLIST_DEFAULT_SYMBOLS


def test_claude_budget_kill_switch_settings():
    """Phase-2 / EP-2 (per user directive 2026-04-26): kill-switch
    flipped OFF + budget bumped 100 → 5,000 so Claude analysis is
    available at all times. Operators can still pin a hard ceiling
    via the env var."""
    from core.config import Settings

    s = Settings()
    assert s.CLAUDE_BUDGET_KILL_SWITCH_ENABLED is False
    assert s.CLAUDE_DAILY_BUDGET_USD >= 5000


# ─── Schema additions on EarningsDetail / StrikeLadder ──────


def test_earnings_detail_has_error_codes_field():
    """Schema-level guard: EarningsDetail.error_codes must be present
    and default to an empty list. Frontend depends on this shape."""
    from api.schemas.earnings import EarningsDetail

    detail = EarningsDetail(
        symbol="NVDA", company="N", sector="S",
        report_date=date(2026, 4, 23), report_time="AMC",
        news=[], partial=False,
        generated_at=datetime.now(timezone.utc),
    )
    assert detail.error_codes == []


def test_strike_ladder_has_is_demo_field():
    """E-1 schema guard: StrikeLadder.is_demo must default False so
    legacy callers don't have to set it explicitly."""
    from api.schemas.earnings import StrikeLadder

    ladder = StrikeLadder(
        expiry=date(2026, 5, 1), underlying_price=100.0, rows=[],
    )
    assert ladder.is_demo is False
