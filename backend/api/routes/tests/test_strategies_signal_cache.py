"""Integration tests for the iter-16 signal-cache fallback inside
``GET /api/v1/strategies/by-symbol/{symbol}``.

Iter 11 left the chip's third state ("Active signal . long . score 0.87")
deferred -- ``has_entry_signal`` / ``signal_score`` / ``signal_side`` all
returned False/None because no per-strategy signal cache existed. Iter 16
added the cache layer (``services.signal_cache``); these tests pin the
end-to-end contract:

  * Cache hit -> endpoint surfaces ``has_entry_signal=True`` + ``score`` +
    ``side`` from the cached payload.
  * Cache miss -> endpoint falls back to the iter-11 falsy/None defaults
    so a Redis outage doesn't take down the symbols page.
  * Strategy class overrides still take precedence over the cache miss
    path -- the cache only escalates a miss/None to a hit.

These complement ``test_strategies_by_symbol.py`` (iter-11 contract pins);
the existing tests stub the cache helpers to a noop, so they pass through
this code path with ``cached=None`` and continue to work unchanged.
"""

from __future__ import annotations

from typing import Any

import pytest

from api.routes import strategies as strat_mod


def _patch_ledger(monkeypatch: pytest.MonkeyPatch, rows: list[dict[str, Any]]) -> None:
    """Stub TradeLedger so the route reads from ``rows`` instead of Postgres."""
    from data.ingestion import trade_ledger as ledger_mod

    class _StubLedger:
        def list(self, filter: dict[str, Any] | None = None) -> list[dict[str, Any]]:
            if not filter:
                return list(rows)
            sym = filter.get("symbol")
            if sym is not None:
                return [r for r in rows if r.get("symbol") == sym]
            return list(rows)

    monkeypatch.setattr(ledger_mod, "TradeLedger", _StubLedger)


def _patch_strat_cache_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub the route's own response cache (``strategies_by_symbol:*``).

    Note this is the **route-level** 60s response cache, distinct from the
    iter-16 per-signal cache. Each test recomputes the response from
    scratch by stubbing this to a miss; the per-signal cache is then
    stubbed inside each test as needed.
    """
    from core import redis as redis_mod

    async def _miss(_key: str) -> None:
        return None

    async def _noop_set(_key: str, _data: Any, ttl_seconds: int = 60) -> None:
        return None

    monkeypatch.setattr(redis_mod, "cache_get", _miss)
    monkeypatch.setattr(redis_mod, "cache_set", _noop_set)


def _patch_signal_cache(
    monkeypatch: pytest.MonkeyPatch,
    payload_by_strategy_and_symbol: dict[tuple[str, str], dict[str, Any] | None],
) -> None:
    """Stub ``services.signal_cache.get_signal`` to return seeded payloads.

    Keys are ``(ledger_strategy_name, SYMBOL)`` matching the cross-walk used
    by the route (``_ID_TO_NAME[route_id]``). A missing key returns ``None``
    (i.e. cache miss).
    """
    from services import signal_cache as signal_cache_mod

    async def _stub_get(strategy_id: str, symbol: str) -> dict[str, Any] | None:
        return payload_by_strategy_and_symbol.get((strategy_id, symbol.upper()))

    monkeypatch.setattr(signal_cache_mod, "get_signal", _stub_get)


# ---------------------------------------------------------------------------
# Cache-hit path (iter-16 unlocks 3rd chip state)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_hit_promotes_match_to_active_signal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A cached signal for momentum_quality/NVDA flips ``has_entry_signal=True``
    on that match and surfaces the cached score + side.
    """
    _patch_ledger(monkeypatch, rows=[])
    _patch_strat_cache_noop(monkeypatch)
    _patch_signal_cache(
        monkeypatch,
        {
            ("momentum_quality", "NVDA"): {
                "score": 0.85,
                "side": "long",
                "evaluated_at": "2026-05-07T10:00:00+00:00",
                "conviction": 85,
            },
        },
    )

    resp = await strat_mod.get_strategies_by_symbol("NVDA")
    by_id = {m.strategy_id: m for m in resp.matches}

    momentum = by_id["momentum-quality"]
    assert momentum.has_entry_signal is True
    assert momentum.score == pytest.approx(0.85)
    assert momentum.side == "long"

    # No leakage to other strategies.
    for sid, m in by_id.items():
        if sid == "momentum-quality":
            continue
        assert m.has_entry_signal is False, (
            f"{sid} unexpectedly inherited the momentum-quality cache hit"
        )
        assert m.score is None
        assert m.side is None


@pytest.mark.asyncio
async def test_short_signal_round_trips_through_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A cached ``short`` signal surfaces as ``side="short"`` on the wire."""
    _patch_ledger(monkeypatch, rows=[])
    _patch_strat_cache_noop(monkeypatch)
    _patch_signal_cache(
        monkeypatch,
        {
            ("rsi2_reversal", "SPY"): {
                "score": 0.72,
                "side": "short",
                "evaluated_at": "2026-05-07T10:00:00+00:00",
                "conviction": 72,
            },
        },
    )

    resp = await strat_mod.get_strategies_by_symbol("SPY")
    by_id = {m.strategy_id: m for m in resp.matches}
    rsi = by_id["rsi2-reversal"]
    assert rsi.has_entry_signal is True
    assert rsi.score == pytest.approx(0.72)
    assert rsi.side == "short"


# ---------------------------------------------------------------------------
# Cache-miss path (preserves iter-11 contract)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_miss_preserves_falsy_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When no cache entries are seeded, every match has the iter-11 contract
    (``has_entry_signal=False``, ``score=None``, ``side=None``).

    Pins the regression: a Redis blip (or a strategy that never emitted
    today) must not change the falsy default into a stale truthy chip.
    """
    _patch_ledger(monkeypatch, rows=[])
    _patch_strat_cache_noop(monkeypatch)
    _patch_signal_cache(monkeypatch, {})

    resp = await strat_mod.get_strategies_by_symbol("NVDA")
    for m in resp.matches:
        assert m.has_entry_signal is False
        assert m.score is None
        assert m.side is None


@pytest.mark.asyncio
async def test_cache_miss_when_only_other_symbol_seeded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A signal seeded for AAPL doesn't leak into the NVDA endpoint response."""
    _patch_ledger(monkeypatch, rows=[])
    _patch_strat_cache_noop(monkeypatch)
    _patch_signal_cache(
        monkeypatch,
        {
            ("momentum_quality", "AAPL"): {
                "score": 0.85,
                "side": "long",
                "evaluated_at": "2026-05-07T10:00:00+00:00",
                "conviction": 85,
            },
        },
    )

    resp = await strat_mod.get_strategies_by_symbol("NVDA")
    by_id = {m.strategy_id: m for m in resp.matches}
    momentum = by_id["momentum-quality"]
    # AAPL hit must not bleed into NVDA's response.
    assert momentum.has_entry_signal is False
    assert momentum.score is None
    assert momentum.side is None


@pytest.mark.asyncio
async def test_cache_read_failure_falls_through_to_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If ``get_signal`` raises (Redis outage), the route still serves a
    valid response with the iter-11 falsy defaults.

    The route wraps the cache call in a try/except so a single Redis blip
    can never 500 the symbols page.
    """
    _patch_ledger(monkeypatch, rows=[])
    _patch_strat_cache_noop(monkeypatch)

    from services import signal_cache as signal_cache_mod

    async def _boom(_strategy: str, _symbol: str) -> dict[str, Any] | None:
        raise RuntimeError("simulated redis outage")

    monkeypatch.setattr(signal_cache_mod, "get_signal", _boom)

    resp = await strat_mod.get_strategies_by_symbol("NVDA")
    for m in resp.matches:
        assert m.has_entry_signal is False
        assert m.score is None
        assert m.side is None


# ---------------------------------------------------------------------------
# Cache-hit + null score/side -> "Active signal" alone (iter-11 chip degrade)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_hit_with_null_score_and_side_still_surfaces_signal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A cached entry with ``score=None`` / ``side=None`` still flips
    ``has_entry_signal=True`` so the chip degrades to "Active signal" alone.

    This pairs with the iter-11 frontend test
    (``StrategyReverseLookup.test.tsx``: "renders 'Active signal' alone when
    side and score are null").
    """
    _patch_ledger(monkeypatch, rows=[])
    _patch_strat_cache_noop(monkeypatch)
    _patch_signal_cache(
        monkeypatch,
        {
            ("pead", "NVDA"): {
                "score": None,
                "side": None,
                "evaluated_at": "2026-05-07T10:00:00+00:00",
                "conviction": None,
            },
        },
    )

    resp = await strat_mod.get_strategies_by_symbol("NVDA")
    by_id = {m.strategy_id: m for m in resp.matches}
    pead = by_id["pead"]
    assert pead.has_entry_signal is True
    assert pead.score is None
    assert pead.side is None


# ---------------------------------------------------------------------------
# Strategy-override + cache interaction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_strategy_override_takes_precedence_when_cache_misses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If a strategy class overrides the no-op default and the cache misses,
    the override's value is preserved.

    This guards against accidentally clobbering an in-strategy hook with a
    cache-driven override -- the cache only ever escalates a miss/None into
    a hit, never overrides a stronger truthy value back to false.
    """
    _patch_ledger(monkeypatch, rows=[])
    _patch_strat_cache_noop(monkeypatch)
    _patch_signal_cache(monkeypatch, {})  # all misses

    from strategies.registry import get_strategy

    cls = get_strategy("momentum_quality")
    monkeypatch.setattr(cls, "has_entry_signal", lambda self, sym: sym == "NVDA")
    monkeypatch.setattr(cls, "signal_score", lambda self, sym: 0.91 if sym == "NVDA" else None)
    monkeypatch.setattr(cls, "signal_side", lambda self, sym: "long" if sym == "NVDA" else None)

    resp = await strat_mod.get_strategies_by_symbol("NVDA")
    by_id = {m.strategy_id: m for m in resp.matches}
    momentum = by_id["momentum-quality"]
    assert momentum.has_entry_signal is True
    assert momentum.score == pytest.approx(0.91)
    assert momentum.side == "long"


# ---------------------------------------------------------------------------
# Cache-key cross-walk regression (vwap path)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_hit_for_vwap_strategy_uses_meta_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The route must look up the per-signal cache under the strategy's own
    ``META.name`` (the same string the daily ``UnifiedStrategyRunner`` writes
    under) -- *not* under the dict-inverted ``_ID_TO_NAME`` alias.

    Regression for the iter-16 code review: ``_STRATEGY_NAME_TO_ID`` has two
    aliases for the vwap strategy (``vwap`` and ``vwap_strategy``) both
    mapping to route-id ``vwap-strategy``. Inverting that dict
    (``{v: k for k, v in ...}``) lossy-collapses the duplicates and
    last-write-wins picks ``vwap_strategy`` -- so the reader was looking up
    ``signal_cache:vwap_strategy:NVDA:v1`` while the writer wrote
    ``signal_cache:vwap:NVDA:v1`` -> eternal cache miss for vwap.

    The fix uses ``instance.META.name`` (== ``"vwap"``) instead of the
    inverted alias, guaranteeing the keys match.
    """
    _patch_ledger(monkeypatch, rows=[])
    _patch_strat_cache_noop(monkeypatch)

    seen_keys: list[tuple[str, str]] = []

    async def _spy_get(strategy_id: str, symbol: str):
        seen_keys.append((strategy_id, symbol.upper()))
        if (strategy_id, symbol.upper()) == ("vwap", "NVDA"):
            return {
                "score": 0.85,
                "side": "long",
                "evaluated_at": "2026-05-06T12:00:00+00:00",
                "conviction": 85,
            }
        return None

    from services import signal_cache as signal_cache_mod

    monkeypatch.setattr(signal_cache_mod, "get_signal", _spy_get)

    resp = await strat_mod.get_strategies_by_symbol("NVDA")
    by_id = {m.strategy_id: m for m in resp.matches}

    vwap_match = by_id.get("vwap-strategy")
    assert vwap_match is not None, "vwap-strategy missing from response"
    assert vwap_match.has_entry_signal is True, (
        "vwap cache hit was not picked up -- route is querying the wrong key. "
        f"Keys queried by route: {seen_keys!r}"
    )
    assert vwap_match.score == pytest.approx(0.85)
    assert vwap_match.side == "long"

    # Confirm the route called the cache under "vwap" (META.name), never under
    # "vwap_strategy" (the broken dict-inverted alias).
    vwap_keys = [(sid, sym) for sid, sym in seen_keys if "vwap" in sid]
    assert ("vwap", "NVDA") in vwap_keys, (
        f"route never looked up signal_cache:vwap:NVDA -- saw {vwap_keys!r}"
    )
    assert ("vwap_strategy", "NVDA") not in vwap_keys, (
        f"route is still using the broken inverted alias -- saw {vwap_keys!r}"
    )
