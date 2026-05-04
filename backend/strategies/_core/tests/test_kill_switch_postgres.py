"""Integration test for PostgresDisabledEventsRepo against a real DB.

Skipped unless RUN_INTEGRATION_TESTS=1 in the environment. Run with:

    RUN_INTEGRATION_TESTS=1 PYTHONPATH=backend pytest \\
        backend/strategies/_core/tests/test_kill_switch_postgres.py -v
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.database import _get_engine

from strategies._core.kill_switch import (
    DisabledEvent,
    PostgresDisabledEventsRepo,
)


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_INTEGRATION_TESTS") != "1",
    reason="set RUN_INTEGRATION_TESTS=1 to run Postgres integration tests",
)


@pytest_asyncio.fixture
async def session():
    engine = _get_engine()
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
        # Roll back to keep tests isolated
        await s.rollback()


@pytest.mark.asyncio
async def test_insert_and_retrieve(session: AsyncSession) -> None:
    repo = PostgresDisabledEventsRepo(session)
    ev = DisabledEvent(
        id=None, strategy="test_pead", layer=1,
        triggered_at=datetime.now(timezone.utc),
        peak_nav=100.0, current_nav=85.0, threshold=-0.08,
    )
    inserted = await repo.insert_async(ev)
    assert inserted.id is not None
    found = await repo.latest_unresolved_for_strategy_async("test_pead", layer=1)
    assert found is not None
    assert found.peak_nav == 100.0


@pytest.mark.asyncio
async def test_resolve(session: AsyncSession) -> None:
    repo = PostgresDisabledEventsRepo(session)
    ev = await repo.insert_async(
        DisabledEvent(
            id=None, strategy="test_pead", layer=3,
            triggered_at=datetime.now(timezone.utc),
            manual_actor="alice", reason="testing",
        )
    )
    await repo.resolve_async(ev.id, resolved_by="bob")
    found = await repo.latest_unresolved_for_strategy_async("test_pead", layer=3)
    assert found is None
