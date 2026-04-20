"""Tests for Wave C (persona 74 P0 #1) Redis Streams helpers.

The backend publishes ``trade_updates`` to a durable Redis Stream so that a
WebSocket client that drops mid-fill can reconnect, send its last-seen
stream ID, and replay anything it missed. Before Wave C this was pub/sub
only — a fire-and-forget path.

These tests exercise the round-trip:

* ``redis_xadd_trade_update(user_id, event)`` appends to
  ``trade_updates:{user_id}`` and returns a Redis Stream ID.
* ``redis_xread_trade_updates(user_id, last_id)`` returns every entry
  strictly after ``last_id`` — the resume semantics the reconnect path
  depends on.
* ``last_id="0-0"`` replays from the start.
* ``last_id=$`` is live-only (nothing replayed; blocks briefly for new).
* ``MAXLEN ~ 10000`` bounds the stream so the reconnect window is
  sized correctly.

We use ``fakeredis.aioredis.FakeRedis`` instead of a live Redis so the
test suite doesn't require an external service and can run in any CI.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
import pytest_asyncio

from core import redis as redis_module
from core.redis import (
    redis_xadd_portfolio,
    redis_xadd_trade_update,
    redis_xread_portfolio,
    redis_xread_trade_updates,
)


@pytest_asyncio.fixture
async def fake_redis(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Swap the global ``get_redis`` with a fakeredis-backed client.

    The real ``get_redis`` builds an ``aioredis`` client at first use and
    memoises it in ``_redis_pool``. We monkeypatch the entire getter so
    every helper in ``core.redis`` transparently routes to fakeredis. The
    fixture yields the fake client so tests can seed it directly when
    useful (and to make sure the close-on-exit path doesn't touch a pool
    we didn't set up).
    """
    fakeredis = pytest.importorskip("fakeredis")
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)

    async def _get_fake() -> Any:
        return client

    monkeypatch.setattr(redis_module, "get_redis", _get_fake)
    try:
        yield client
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_xadd_returns_stream_id(fake_redis: Any) -> None:
    """XADD returns a Redis Stream ID in the ``<ms>-<seq>`` format."""
    entry_id = await redis_xadd_trade_update(
        "alice",
        {"event": "fill", "symbol": "AAPL", "qty": 100},
    )
    assert isinstance(entry_id, str)
    # Redis Stream IDs look like "1700000000000-0". fakeredis emits the
    # same format. Minimum validation: contains a hyphen and the left
    # half parses as an int.
    left, _, _ = entry_id.partition("-")
    assert left.isdigit()


@pytest.mark.asyncio
async def test_xread_replays_full_history_from_zero(fake_redis: Any) -> None:
    """``last_id=0-0`` replays every entry in the stream.

    This is the explicit "give me everything" path. Useful for debugging
    and for a test harness that wants to observe every published event.
    """
    await redis_xadd_trade_update("alice", {"event": "new", "order_id": "1"})
    await redis_xadd_trade_update("alice", {"event": "fill", "order_id": "2"})
    await redis_xadd_trade_update("alice", {"event": "partial_fill", "order_id": "3"})

    entries = await redis_xread_trade_updates("alice", last_id="0-0")
    assert len(entries) == 3
    # Payloads round-trip through the JSON envelope
    events = [e["event"] for _id, e in entries]
    assert events == ["new", "fill", "partial_fill"]


@pytest.mark.asyncio
async def test_xread_resumes_from_last_id(fake_redis: Any) -> None:
    """After reading to a point, passing that ID replays only the tail.

    This is the reconnect-resume contract. The client remembers the last
    ID it delivered to the UI; on reconnect it sends that ID and the
    server ships everything after it.
    """
    id1 = await redis_xadd_trade_update("alice", {"event": "fill", "order_id": "1"})
    id2 = await redis_xadd_trade_update("alice", {"event": "fill", "order_id": "2"})
    id3 = await redis_xadd_trade_update("alice", {"event": "fill", "order_id": "3"})

    # Simulate: client saw id2, disconnected, reconnected. Resume from id2.
    entries = await redis_xread_trade_updates("alice", last_id=id2)

    # Only id3 should come back — id1 and id2 are strictly before the cursor.
    assert len(entries) == 1
    replayed_id, replayed_event = entries[0]
    assert replayed_id == id3
    assert replayed_event["order_id"] == "3"
    # id1 was not part of the assertion but we also want to be sure the
    # helper returns the id2-cursor-or-later semantics (not id1-or-later).
    assert id1 != replayed_id


@pytest.mark.asyncio
async def test_xread_returns_empty_when_caught_up(fake_redis: Any) -> None:
    """Passing the most recent ID yields an empty list.

    The reconnect path relies on an empty-return meaning "nothing to
    replay, fall through to the live pub/sub tail". A stale response
    would double-emit the last event on every reconnect.
    """
    last = await redis_xadd_trade_update("alice", {"event": "fill", "order_id": "1"})

    entries = await redis_xread_trade_updates("alice", last_id=last)
    assert entries == []


@pytest.mark.asyncio
async def test_xread_dollar_is_live_only(fake_redis: Any) -> None:
    """``last_id="$"`` never replays past entries — this is live-only mode.

    Fresh subscribers that don't have a cursor default to ``"$"``; they
    should not receive the current stream backlog, only new events
    published AFTER they subscribed.
    """
    await redis_xadd_trade_update("alice", {"event": "fill", "order_id": "1"})
    await redis_xadd_trade_update("alice", {"event": "fill", "order_id": "2"})

    # block_ms=0 -> non-blocking; on an empty read we return immediately.
    entries = await redis_xread_trade_updates("alice", last_id="$", block_ms=0)
    assert entries == []


@pytest.mark.asyncio
async def test_per_user_isolation(fake_redis: Any) -> None:
    """``alice`` and ``bob`` get separate streams.

    Wave C scopes trade_updates per user so a reconnect for one account
    can't accidentally replay another account's fills. Keyed as
    ``trade_updates:{user_id}``.
    """
    await redis_xadd_trade_update("alice", {"event": "fill", "order_id": "A1"})
    await redis_xadd_trade_update("bob", {"event": "fill", "order_id": "B1"})
    await redis_xadd_trade_update("alice", {"event": "fill", "order_id": "A2"})

    alice_entries = await redis_xread_trade_updates("alice", last_id="0-0")
    bob_entries = await redis_xread_trade_updates("bob", last_id="0-0")

    assert [e["order_id"] for _i, e in alice_entries] == ["A1", "A2"]
    assert [e["order_id"] for _i, e in bob_entries] == ["B1"]


@pytest.mark.asyncio
async def test_portfolio_stream_roundtrip(fake_redis: Any) -> None:
    """The ``portfolio`` stream uses the same XADD/XREAD round-trip.

    Unlike trade_updates it's a single shared stream (not per-user)
    because portfolio snapshots carry their own user-scoping inside the
    payload. Still has to support resume-from-cursor.
    """
    id1 = await redis_xadd_portfolio({"type": "snapshot", "equity": 100_000})
    id2 = await redis_xadd_portfolio({"type": "snapshot", "equity": 101_000})

    all_entries = await redis_xread_portfolio(last_id="0-0")
    assert len(all_entries) == 2

    # Resume from id1 gives only id2.
    tail = await redis_xread_portfolio(last_id=id1)
    assert len(tail) == 1
    assert tail[0][0] == id2
    assert tail[0][1]["equity"] == 101_000


@pytest.mark.asyncio
async def test_maxlen_bounds_stream(
    fake_redis: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MAXLEN ~ trims the stream so we never exceed the resume window.

    ``approximate=True`` lets Redis keep up to a few hundred extra entries
    for O(1) trimming — we just need the overall count to be bounded
    rather than exact. To keep the test fast we temporarily shrink
    ``STREAM_MAXLEN`` to 50 and seed 200 entries; the production value of
    10k is exercised implicitly by the same XADD code path.
    """
    # Use a tiny MAXLEN for the test so we don't need to seed 11k entries
    # through fakeredis (which would be slow). Production uses 10k; the
    # relevant behaviour is the XADD MAXLEN plumbing, which is identical.
    monkeypatch.setattr(redis_module, "STREAM_MAXLEN", 50)

    n = 200
    for i in range(n):
        await redis_xadd_trade_update("load", {"event": "fill", "n": i})

    stream_len = await fake_redis.xlen(f"{redis_module.STREAM_TRADE_UPDATES_PREFIX}:load")
    # Bounded: must be at most the MAXLEN budget (with some slack for
    # approximate-trim). The important contract is "this does not grow
    # unboundedly"; we don't care about the exact head/tail boundary.
    assert stream_len <= redis_module.STREAM_MAXLEN * 2


@pytest.mark.asyncio
async def test_xadd_encodes_non_string_fields(fake_redis: Any) -> None:
    """Nested dicts / numerics round-trip through the JSON envelope.

    Redis Streams only accept string fields. The helper JSON-encodes the
    full payload under ``_payload`` so an Alpaca event with nested ``raw``
    and numeric ``qty`` survives the round-trip intact.
    """
    event = {
        "event": "fill",
        "symbol": "AAPL",
        "qty": 100.5,
        "raw": {"nested": {"deep": True}, "list": [1, 2, 3]},
    }
    entry_id = await redis_xadd_trade_update("alice", event)
    entries = await redis_xread_trade_updates("alice", last_id="0-0")
    assert len(entries) == 1
    returned_id, returned_event = entries[0]
    assert returned_id == entry_id
    assert returned_event["qty"] == 100.5
    assert returned_event["raw"]["nested"]["deep"] is True
    assert returned_event["raw"]["list"] == [1, 2, 3]
    # The _ts marker is added by _stream_encode; presence is the contract.
    assert "_ts" in returned_event


@pytest.mark.asyncio
async def test_reconnect_simulation_end_to_end(fake_redis: Any) -> None:
    """End-to-end simulation of the Wave C reconnect path.

    1. Live session: publish 3 events, client delivers all 3, cursor = id3.
    2. Client disconnects. Backend keeps publishing: publish 2 more.
    3. Client reconnects, sends last_id=id3. Server replays id4+id5.
    4. Cursor now = id5; next reconnect with id5 gets an empty replay.
    """
    # Live session.
    id1 = await redis_xadd_trade_update("alice", {"event": "fill", "n": 1})
    id2 = await redis_xadd_trade_update("alice", {"event": "fill", "n": 2})
    id3 = await redis_xadd_trade_update("alice", {"event": "fill", "n": 3})

    # Client catches up live (simulated — the client's onmessage would
    # have seen all three).
    live_entries = await redis_xread_trade_updates("alice", last_id="0-0")
    assert [e["n"] for _i, e in live_entries] == [1, 2, 3]

    # Client drops. Backend keeps publishing.
    id4 = await redis_xadd_trade_update("alice", {"event": "fill", "n": 4})
    id5 = await redis_xadd_trade_update("alice", {"event": "fill", "n": 5})

    # Client reconnects, sends last_id=id3. Server replays tail.
    replay = await redis_xread_trade_updates("alice", last_id=id3)
    replay_ns = [e["n"] for _i, e in replay]
    assert replay_ns == [4, 5]
    replay_ids = [i for i, _e in replay]
    assert replay_ids == [id4, id5]

    # Cursor now id5; any further reconnect with id5 yields empty.
    empty = await redis_xread_trade_updates("alice", last_id=id5)
    assert empty == []

    # Suppress unused-var warnings — id1/id2 are part of the narrative.
    _ = (id1, id2)
