"""End-to-end test: kill-switch row in repo halts the live pipeline runner.

Audit B-F3 / R-F1 (2026-05-05) — three independent agents found that the
``Emergency Disable`` UI button wrote to ``strategy_disabled_events`` but
the live runner ignored the row (``DailyPipelineRunner`` was constructed
without a ``kill_switch=`` arg in ``data.ingestion.strategy_runner.py``).
This test asserts the gap is closed end-to-end:

  1. Insert a layer-3 ``DisabledEvent`` for ``test_strategy``
  2. Build a ``DailyPipelineRunner`` wired to a ``KillSwitch`` over that repo
  3. Call ``runner.run_today(...)`` with a strategy that would normally emit
     a non-empty signal
  4. Assert: zero signals, ``kill_switch_disabled=True`` in diagnostics,
     ``strategy.run`` was never called

A separate Postgres-backed variant lives in
``test_kill_switch_postgres.py`` (skipped unless ``RUN_INTEGRATION_TESTS=1``);
this in-memory E2E always runs in CI so the wire-up never silently
regresses.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import StrategyResult
from strategies._core.kill_switch import (
    DisabledEvent,
    InMemoryDisabledEventsRepo,
    KillSwitch,
)
from strategies._core.runners.pipeline_runner import (
    DailyPipelineRunner,
    StateStore,
)


# --------------------------------------------------------------------------- #
# Test fixtures                                                               #
# --------------------------------------------------------------------------- #
class _StubMeta:
    name = "test_strategy"
    lookback_days = 5
    paper_only = False
    kind = "autonomous"
    category = "equity"
    required_bars = ("daily",)
    required_ticker_contexts = ()


class _StubStrategy:
    """Mock Strategy: would emit a non-empty StrategyResult if invoked.

    Tracks invocation in ``run_called`` so the test can assert the wrapper
    short-circuited the call when the kill-switch tripped.
    """

    META = _StubMeta()

    def __init__(self) -> None:
        self.run_called = False

    @property
    def name(self) -> str:
        return self.META.name

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return []

    def run(self, input: Any, params: Any) -> StrategyResult:
        self.run_called = True
        # Would-be signal — only reached if kill-switch lets the call through.
        return StrategyResult(signals=[], diagnostics={"reached_strategy": True})


class _StubBars:
    def fetch_window(self, symbols, asof, lookback, **kwargs) -> pd.DataFrame:
        return pd.DataFrame(
            {"open": [], "high": [], "low": [], "close": [], "volume": []},
            index=pd.MultiIndex.from_tuples([], names=["date", "symbol"]),
        )


class _StubProviders:
    bars = _StubBars()
    earnings = None
    fundamentals = None
    options = None


def _empty_positions(asof: date) -> list:
    return []


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_layer3_disable_blocks_run_today() -> None:
    """An unresolved layer-3 row must short-circuit ``run_today``."""
    repo = InMemoryDisabledEventsRepo()
    repo.insert(DisabledEvent(
        id=None, strategy="test_strategy", layer=3,
        triggered_at=datetime.now(timezone.utc),
        manual_actor="alice", reason="manual emergency disable for test",
    ))
    ks = KillSwitch(repo=repo)
    strategy = _StubStrategy()
    runner = DailyPipelineRunner(
        strategy=strategy,
        providers=_StubProviders(),  # type: ignore[arg-type]
        state_store=StateStore(),
        positions_provider=_empty_positions,  # type: ignore[arg-type]
        kill_switch=ks,
    )

    result = await runner.run_today(
        params=MagicMock(),
        asof=date(2026, 5, 4),
        mode="live",
        cash=Decimal("100000"),
        equity=Decimal("100000"),
    )

    assert result.signals == [], "expected zero signals when kill-switch is tripped"
    assert result.diagnostics.get("kill_switch_disabled") is True
    assert result.diagnostics.get("kill_switch_layer") == 3
    assert "manual emergency disable for test" in (result.diagnostics.get("kill_switch_reason") or "")
    assert strategy.run_called is False, "strategy.run() must NOT execute when blocked"
    assert any("kill-switch layer 3" in (w or "") for w in (result.warnings or [])), (
        f"expected layer-3 warning, got {result.warnings!r}"
    )


@pytest.mark.asyncio
async def test_layer3_resolved_does_not_block() -> None:
    """A *resolved* layer-3 row must NOT block ``run_today``."""
    repo = InMemoryDisabledEventsRepo()
    ev = repo.insert(DisabledEvent(
        id=None, strategy="test_strategy", layer=3,
        triggered_at=datetime.now(timezone.utc),
        manual_actor="alice", reason="prior disable",
    ))
    repo.resolve(ev.id, resolved_by="bob")  # resolved — should not gate
    ks = KillSwitch(repo=repo)
    strategy = _StubStrategy()
    runner = DailyPipelineRunner(
        strategy=strategy,
        providers=_StubProviders(),  # type: ignore[arg-type]
        state_store=StateStore(),
        positions_provider=_empty_positions,  # type: ignore[arg-type]
        kill_switch=ks,
    )

    result = await runner.run_today(
        params=MagicMock(),
        asof=date(2026, 5, 4),
        mode="live",
        cash=Decimal("100000"),
        equity=Decimal("100000"),
    )

    assert result.diagnostics.get("kill_switch_disabled") is not True
    assert strategy.run_called is True
    assert result.diagnostics.get("reached_strategy") is True


@pytest.mark.asyncio
async def test_no_kill_switch_runs_strategy_directly() -> None:
    """Default ``kill_switch=None`` preserves legacy behaviour."""
    strategy = _StubStrategy()
    runner = DailyPipelineRunner(
        strategy=strategy,
        providers=_StubProviders(),  # type: ignore[arg-type]
        state_store=StateStore(),
        positions_provider=_empty_positions,  # type: ignore[arg-type]
        # no kill_switch
    )

    result = await runner.run_today(
        params=MagicMock(),
        asof=date(2026, 5, 4),
        mode="live",
        cash=Decimal("100000"),
        equity=Decimal("100000"),
    )

    assert strategy.run_called is True
    assert result.diagnostics.get("kill_switch_disabled") is not True


@pytest.mark.asyncio
async def test_layer3_disable_unrelated_strategy_unaffected() -> None:
    """A disable row for strategy A must not block strategy B's run."""
    repo = InMemoryDisabledEventsRepo()
    repo.insert(DisabledEvent(
        id=None, strategy="other_strategy", layer=3,
        triggered_at=datetime.now(timezone.utc),
        manual_actor="alice", reason="unrelated disable",
    ))
    ks = KillSwitch(repo=repo)
    strategy = _StubStrategy()  # name = "test_strategy"
    runner = DailyPipelineRunner(
        strategy=strategy,
        providers=_StubProviders(),  # type: ignore[arg-type]
        state_store=StateStore(),
        positions_provider=_empty_positions,  # type: ignore[arg-type]
        kill_switch=ks,
    )

    result = await runner.run_today(
        params=MagicMock(),
        asof=date(2026, 5, 4),
        mode="live",
        cash=Decimal("100000"),
        equity=Decimal("100000"),
    )

    assert strategy.run_called is True
    assert result.diagnostics.get("kill_switch_disabled") is not True


# --------------------------------------------------------------------------- #
# strategy_runner wire-up regression — closes the actual audit gap            #
# --------------------------------------------------------------------------- #
# The original audit finding was specifically that
# ``data.ingestion.strategy_runner.UnifiedStrategyRunner.run`` constructed
# ``DailyPipelineRunner`` without ``kill_switch=`` even after the wrapper
# had been wired. This test fixes that constructor by static inspection so
# a future refactor can't silently drop the arg again.
def test_strategy_runner_constructs_runner_with_kill_switch() -> None:
    """Static guard: strategy_runner.py must wire kill_switch into the runner."""
    from pathlib import Path
    p = Path(__file__).resolve().parents[3] / "data" / "ingestion" / "strategy_runner.py"
    text = p.read_text()
    # The runner must be constructed with kill_switch= (kwarg) — otherwise
    # the wrapper short-circuits to bare strategy.run() and the layer-3
    # row written by the Emergency Disable UI is silently ignored.
    assert "kill_switch=" in text, (
        "strategy_runner.py constructs DailyPipelineRunner without kill_switch=; "
        "the layer-3 emergency-disable UI is dead code. "
        "Re-add the kill_switch= kwarg per audit B-F3 / R-F1."
    )
    assert "PostgresDisabledEventsRepo" in text or "_build_kill_switch" in text, (
        "strategy_runner.py does not import the Postgres-backed repo; "
        "the kill_switch= is being passed but the repo is not Postgres — "
        "the UI button writes to Postgres and the runner reads in-memory, mismatch."
    )
