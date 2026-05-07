"""Unit tests for ``services.signal_cache``.

Covers the iter-16 cache layer that backs the symbols-page reverse-lookup
chip's third state ("Active signal . long . score 0.87"). Tests stub the
underlying ``core.redis.cache_get`` / ``cache_set`` so the suite never
touches a live Redis -- the cache module is pure-async-glue and does not
own connection management.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

# Match the import-path bootstrap used by other backend service tests so
# the file can run from repo root or backend/ directly.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_BACKEND = _REPO_ROOT / "backend"
for p in (_REPO_ROOT, _BACKEND):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from services import signal_cache  # noqa: E402


# ---------------------------------------------------------------------------
# Fake Redis -- in-memory dict + ttl tracker
# ---------------------------------------------------------------------------


class _FakeRedisStore:
    """Tiny in-memory stand-in for ``core.redis.cache_{get,set}``.

    Records the last ttl per key so tests can assert TTL handling without
    needing a real Redis server.
    """

    def __init__(self) -> None:
        self.store: dict[str, Any] = {}
        self.ttls: dict[str, int] = {}
        self.set_calls: list[tuple[str, Any, int]] = []

    async def get(self, key: str) -> Any | None:
        return self.store.get(key)

    async def set(self, key: str, value: Any, ttl_seconds: int = 300) -> None:
        self.store[key] = value
        self.ttls[key] = ttl_seconds
        self.set_calls.append((key, value, ttl_seconds))


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedisStore:
    """Patch ``signal_cache``'s imports of cache_get / cache_set to point
    at an in-memory store.
    """
    store = _FakeRedisStore()
    monkeypatch.setattr(signal_cache, "cache_get", store.get)
    monkeypatch.setattr(signal_cache, "cache_set", store.set)
    return store


# ---------------------------------------------------------------------------
# Round-trip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_then_get_round_trips_payload(fake_redis: _FakeRedisStore) -> None:
    """``set_signals_for_strategy`` followed by ``get_signal`` returns the same payload."""
    await signal_cache.set_signals_for_strategy(
        "momentum_quality",
        {"NVDA": {"score": 0.87, "side": "long", "conviction": 87}},
    )
    cached = await signal_cache.get_signal("momentum_quality", "NVDA")
    assert cached is not None
    assert cached["score"] == pytest.approx(0.87)
    assert cached["side"] == "long"
    assert cached["conviction"] == 87
    # ``evaluated_at`` is auto-stamped to ISO 8601 UTC.
    assert isinstance(cached["evaluated_at"], str)
    assert "T" in cached["evaluated_at"]


@pytest.mark.asyncio
async def test_short_side_round_trips(fake_redis: _FakeRedisStore) -> None:
    """A ``short`` signal (e.g. from a mean-reversion strategy) round-trips intact."""
    await signal_cache.set_signals_for_strategy(
        "rsi2_reversal",
        {"SPY": {"score": 0.75, "side": "short", "conviction": 75}},
    )
    cached = await signal_cache.get_signal("rsi2_reversal", "SPY")
    assert cached is not None
    assert cached["side"] == "short"
    assert cached["score"] == pytest.approx(0.75)


@pytest.mark.asyncio
async def test_keys_are_normalised(fake_redis: _FakeRedisStore) -> None:
    """Strategy id is lowercased; symbol is uppercased; both sides agree on the key."""
    await signal_cache.set_signals_for_strategy(
        "MOMENTUM_QUALITY",
        {"nvda": {"score": 0.87, "side": "long", "conviction": 87}},
    )
    # Same payload retrievable under any-case strategy id + any-case symbol.
    assert await signal_cache.get_signal("momentum_quality", "NVDA") is not None
    assert await signal_cache.get_signal("MoMenTuM_QualiTy", "NvDa") is not None
    # The on-the-wire key shape is canonical.
    assert "signal_cache:momentum_quality:NVDA:v1" in fake_redis.store


# ---------------------------------------------------------------------------
# Miss path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_miss_returns_none(fake_redis: _FakeRedisStore) -> None:
    """A symbol that was never written returns ``None`` -- not raises."""
    result = await signal_cache.get_signal("momentum_quality", "TSLA")
    assert result is None


@pytest.mark.asyncio
async def test_miss_when_strategy_unknown(fake_redis: _FakeRedisStore) -> None:
    """An unknown strategy returns ``None`` even if the symbol was cached for another strategy."""
    await signal_cache.set_signals_for_strategy(
        "momentum_quality",
        {"NVDA": {"score": 0.87, "side": "long", "conviction": 87}},
    )
    assert await signal_cache.get_signal("pead", "NVDA") is None


# ---------------------------------------------------------------------------
# Malformed payload defenses (cache poisoning / schema drift)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_malformed_non_dict_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """A non-dict cached value (e.g. someone wrote a list) is treated as a miss."""

    async def _bad_get(_key: str) -> Any:
        return ["not", "a", "dict"]

    async def _noop_set(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(signal_cache, "cache_get", _bad_get)
    monkeypatch.setattr(signal_cache, "cache_set", _noop_set)
    assert await signal_cache.get_signal("momentum_quality", "NVDA") is None


@pytest.mark.asyncio
async def test_malformed_bad_side_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unsupported ``side`` (e.g. ``"flat"``) is treated as a miss."""

    async def _bad_get(_key: str) -> Any:
        return {
            "score": 0.5,
            "side": "flat",  # not in {long, short, None}
            "evaluated_at": "2026-05-07T00:00:00+00:00",
            "conviction": 50,
        }

    async def _noop_set(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(signal_cache, "cache_get", _bad_get)
    monkeypatch.setattr(signal_cache, "cache_set", _noop_set)
    assert await signal_cache.get_signal("any", "NVDA") is None


@pytest.mark.asyncio
async def test_malformed_bad_score_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """A non-numeric score (e.g. ``"high"``) is treated as a miss."""

    async def _bad_get(_key: str) -> Any:
        return {
            "score": "high",  # can't coerce to float
            "side": "long",
            "evaluated_at": "2026-05-07T00:00:00+00:00",
            "conviction": 80,
        }

    async def _noop_set(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(signal_cache, "cache_get", _bad_get)
    monkeypatch.setattr(signal_cache, "cache_set", _noop_set)
    assert await signal_cache.get_signal("any", "NVDA") is None


@pytest.mark.asyncio
async def test_malformed_missing_evaluated_at_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A missing ``evaluated_at`` field is treated as a miss."""

    async def _bad_get(_key: str) -> Any:
        return {"score": 0.8, "side": "long", "conviction": 80}

    async def _noop_set(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(signal_cache, "cache_get", _bad_get)
    monkeypatch.setattr(signal_cache, "cache_set", _noop_set)
    assert await signal_cache.get_signal("any", "NVDA") is None


@pytest.mark.asyncio
async def test_score_can_be_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """``score=None`` is valid -- it pairs with ``side=None`` for a "signal but no score" payload."""

    async def _get(_key: str) -> Any:
        return {
            "score": None,
            "side": None,
            "evaluated_at": "2026-05-07T00:00:00+00:00",
            "conviction": None,
        }

    async def _noop_set(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(signal_cache, "cache_get", _get)
    monkeypatch.setattr(signal_cache, "cache_set", _noop_set)
    cached = await signal_cache.get_signal("any", "NVDA")
    assert cached is not None
    assert cached["score"] is None
    assert cached["side"] is None
    assert cached["conviction"] is None


@pytest.mark.asyncio
async def test_bad_conviction_coerces_to_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """A non-int conviction is sanitised to None rather than failing the read."""

    async def _get(_key: str) -> Any:
        return {
            "score": 0.8,
            "side": "long",
            "evaluated_at": "2026-05-07T00:00:00+00:00",
            "conviction": "not-a-number",
        }

    async def _noop_set(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(signal_cache, "cache_get", _get)
    monkeypatch.setattr(signal_cache, "cache_set", _noop_set)
    cached = await signal_cache.get_signal("any", "NVDA")
    assert cached is not None
    assert cached["score"] == pytest.approx(0.8)
    assert cached["side"] == "long"
    assert cached["conviction"] is None


# ---------------------------------------------------------------------------
# TTL handling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_default_ttl_is_24h(fake_redis: _FakeRedisStore) -> None:
    """Default TTL on the wire is the constant -- 24h, not the global cache 300s."""
    await signal_cache.set_signals_for_strategy(
        "momentum_quality",
        {"NVDA": {"score": 0.87, "side": "long", "conviction": 87}},
    )
    assert fake_redis.ttls["signal_cache:momentum_quality:NVDA:v1"] == signal_cache.SIGNAL_CACHE_TTL
    assert signal_cache.SIGNAL_CACHE_TTL == 24 * 60 * 60


@pytest.mark.asyncio
async def test_custom_ttl_threads_through(fake_redis: _FakeRedisStore) -> None:
    """An explicit ``ttl=`` kwarg overrides the default and reaches ``cache_set``."""
    await signal_cache.set_signals_for_strategy(
        "momentum_quality",
        {"NVDA": {"score": 0.87, "side": "long", "conviction": 87}},
        ttl=120,
    )
    assert fake_redis.ttls["signal_cache:momentum_quality:NVDA:v1"] == 120


# ---------------------------------------------------------------------------
# Bulk-write robustness
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_write_skips_bad_entry_continues_others(
    fake_redis: _FakeRedisStore,
) -> None:
    """One bad payload among many doesn't drop the rest of the run.

    The runner emits a dict-of-symbols at once; a single coercion error
    (e.g. a string that won't parse to int for conviction) must NOT stop
    the other symbols from being written.
    """
    await signal_cache.set_signals_for_strategy(
        "momentum_quality",
        {
            "NVDA": {"score": 0.87, "side": "long", "conviction": 87},
            # ``conviction`` here is intentionally a string the int() call
            # will reject; the loop swallows the error and continues.
            "BADSTOCK": {"score": 0.5, "side": "long", "conviction": "definitely-not-int"},
            "AAPL": {"score": 0.72, "side": "long", "conviction": 72},
        },
    )
    # Both healthy symbols got written.
    assert await signal_cache.get_signal("momentum_quality", "NVDA") is not None
    assert await signal_cache.get_signal("momentum_quality", "AAPL") is not None
    # The bad one didn't take down the run, but also wasn't persisted.
    assert await signal_cache.get_signal("momentum_quality", "BADSTOCK") is None


@pytest.mark.asyncio
async def test_bulk_write_continues_when_individual_set_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If ``cache_set`` itself raises for one symbol, the rest still go through.

    Simulates a Redis OOM / connection blip on a specific key. The
    per-symbol try/except must catch and continue.
    """

    written: list[str] = []
    fail_for = "BADSTOCK"

    async def _flaky_set(key: str, _value: Any, _ttl: int) -> None:
        if fail_for in key:
            raise RuntimeError("simulated redis blip")
        written.append(key)

    async def _empty_get(_key: str) -> Any:
        return None

    monkeypatch.setattr(signal_cache, "cache_set", _flaky_set)
    monkeypatch.setattr(signal_cache, "cache_get", _empty_get)

    await signal_cache.set_signals_for_strategy(
        "momentum_quality",
        {
            "NVDA": {"score": 0.87, "side": "long", "conviction": 87},
            "BADSTOCK": {"score": 0.5, "side": "long", "conviction": 50},
            "AAPL": {"score": 0.72, "side": "long", "conviction": 72},
        },
    )

    keys_written = {k.split(":")[2] for k in written}
    assert "NVDA" in keys_written
    assert "AAPL" in keys_written
    assert "BADSTOCK" not in keys_written


@pytest.mark.asyncio
async def test_bulk_write_empty_input_is_a_noop(fake_redis: _FakeRedisStore) -> None:
    """An empty signals_by_symbol does not fan out to ``cache_set``."""
    await signal_cache.set_signals_for_strategy("momentum_quality", {})
    assert fake_redis.set_calls == []


@pytest.mark.asyncio
async def test_unsupported_side_is_normalised_to_none(fake_redis: _FakeRedisStore) -> None:
    """Writing a payload with ``side="flat"`` stores ``side=None`` (sanitised on write)."""
    await signal_cache.set_signals_for_strategy(
        "momentum_quality",
        {"NVDA": {"score": 0.87, "side": "flat", "conviction": 87}},
    )
    # The on-the-wire write is sanitised; on-read we'd see side=None which
    # is in the allowed set so it round-trips.
    cached = await signal_cache.get_signal("momentum_quality", "NVDA")
    assert cached is not None
    assert cached["side"] is None
