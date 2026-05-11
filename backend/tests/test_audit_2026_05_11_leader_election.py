"""Regression tests for BUG-091 — Redis leader-election lock.

The pipeline scheduler is gated by a Redis `SET NX` lock so only one
worker per cluster runs the schedulers. Without these tests, a future
refactor could silently break the singleton property and re-introduce
the duplicate-scheduler class that the Dockerfile's `-w 1` was pinned
to prevent.

Mirrors the AsyncMock-on-get_redis pattern in
`backend/tests/test_l14_l15_endpoints.py`.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch):
    """Inject a freshly-instantiated AsyncMock redis client."""
    from core import redis as redis_mod

    redis = AsyncMock()
    # SET defaults to "key already exists" — tests opt into success.
    redis.set = AsyncMock(return_value=None)
    redis.get = AsyncMock(return_value=None)
    redis.delete = AsyncMock(return_value=0)

    async def _get_redis():
        return redis

    monkeypatch.setattr(redis_mod, "get_redis", _get_redis)
    return redis


@pytest.fixture(autouse=True)
def reset_leader_state(monkeypatch: pytest.MonkeyPatch):
    """Reset the module-level _LEADER_TOKEN between tests."""
    from data.ingestion import pipeline_runner as pr_mod

    monkeypatch.setattr(pr_mod, "_LEADER_TOKEN", None)
    yield
    monkeypatch.setattr(pr_mod, "_LEADER_TOKEN", None)


# ─── BUG-091 ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bug_091_first_worker_wins_the_lock(fake_redis):
    """SET NX returns truthy → this worker is leader, token persisted."""
    fake_redis.set.return_value = True
    from data.ingestion.pipeline_runner import _acquire_scheduler_leadership
    from data.ingestion import pipeline_runner as pr_mod

    is_leader = await _acquire_scheduler_leadership()
    assert is_leader is True, "first SET NX must yield leadership"
    assert pr_mod._LEADER_TOKEN is not None, "module token must be set on win"
    # The redis SET call must use NX + a TTL — verify the kwargs.
    assert fake_redis.set.await_count == 1
    args, kwargs = fake_redis.set.await_args
    assert kwargs.get("nx") is True, "SET must use NX semantics"
    assert isinstance(kwargs.get("ex"), int), "SET must include an expiry (ex)"


@pytest.mark.asyncio
async def test_bug_091_second_worker_loses_the_lock(fake_redis):
    """SET NX returns None → another worker holds the lock; skip scheduler."""
    fake_redis.set.return_value = None
    from data.ingestion.pipeline_runner import _acquire_scheduler_leadership
    from data.ingestion import pipeline_runner as pr_mod

    is_leader = await _acquire_scheduler_leadership()
    assert is_leader is False, "SET NX returning None means another worker is leader"
    assert pr_mod._LEADER_TOKEN is None, "lost election must leave token unset"


@pytest.mark.asyncio
async def test_bug_091_redis_unavailable_falls_back_to_single_worker_mode(monkeypatch):
    """Redis unreachable → assume `-w 1` posture; start scheduler.

    The alternative (skip start when Redis is unknown) would prevent
    the scheduler from running on any deploy that loses Redis briefly;
    the audit's design choice was "scheduler is safety-critical, run
    it when state is ambiguous."
    """
    from core import redis as redis_mod

    async def _get_redis_unavailable():
        return None

    monkeypatch.setattr(redis_mod, "get_redis", _get_redis_unavailable)

    from data.ingestion.pipeline_runner import _acquire_scheduler_leadership

    is_leader = await _acquire_scheduler_leadership()
    assert is_leader is True, (
        "When Redis is unavailable, the worker must assume single-worker mode "
        "and start the scheduler (fail-open posture per BUG-091 design)."
    )


@pytest.mark.asyncio
async def test_bug_091_redis_raises_falls_back_to_single_worker(monkeypatch):
    """Redis client raises → fail-open and start the scheduler."""
    from core import redis as redis_mod

    async def _get_redis_explodes():
        raise RuntimeError("redis is on fire")

    monkeypatch.setattr(redis_mod, "get_redis", _get_redis_explodes)

    from data.ingestion.pipeline_runner import _acquire_scheduler_leadership

    is_leader = await _acquire_scheduler_leadership()
    assert is_leader is True, (
        "Redis probe raising must NOT block the scheduler — the same "
        "fail-open posture as Redis unavailable."
    )


@pytest.mark.asyncio
async def test_bug_091_release_leadership_only_deletes_when_we_hold_token(fake_redis):
    """`_release_scheduler_leadership` must check `GET == our token`
    before `DEL` so a leader that lost the race doesn't accidentally
    delete a sibling's lock."""
    # First acquire to seed _LEADER_TOKEN.
    fake_redis.set.return_value = True
    from data.ingestion.pipeline_runner import (
        _acquire_scheduler_leadership,
        _release_scheduler_leadership,
    )
    from data.ingestion import pipeline_runner as pr_mod

    await _acquire_scheduler_leadership()
    assert pr_mod._LEADER_TOKEN is not None
    our_token = pr_mod._LEADER_TOKEN

    # On release, get returns the SAME token (we still hold it).
    fake_redis.get.return_value = our_token
    await _release_scheduler_leadership()

    # The delete should have fired.
    assert fake_redis.delete.await_count == 1, "release must delete the lock"
    assert pr_mod._LEADER_TOKEN is None, "module token must clear on release"


@pytest.mark.asyncio
async def test_bug_091_release_no_op_when_token_already_lost(fake_redis):
    """If we somehow lost the lock between heartbeats, `release` must
    NOT delete a sibling's lock by mistake."""
    fake_redis.set.return_value = True
    from data.ingestion.pipeline_runner import (
        _acquire_scheduler_leadership,
        _release_scheduler_leadership,
    )

    await _acquire_scheduler_leadership()

    # Simulate another worker now holds the lock with their own token.
    fake_redis.get.return_value = "some_other_token"
    await _release_scheduler_leadership()

    # We should NOT have called delete — that lock isn't ours anymore.
    assert fake_redis.delete.await_count == 0, (
        "must not delete a lock the current worker doesn't hold "
        "(otherwise dual-leader race becomes a deadlock)"
    )
