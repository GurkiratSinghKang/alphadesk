"""Unit tests for the three-layer kill-switch."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from strategies._core.kill_switch import (
    Decision,
    DisabledEvent,
    InMemoryDisabledEventsRepo,
    KillSwitch,
    KillSwitchContext,
)


class TestDecision:
    def test_construction_enabled(self) -> None:
        d = Decision(enabled=True, layer=0, reason="all checks passed", metrics={})
        assert d.enabled is True
        assert d.layer == 0
        assert d.reason == "all checks passed"
        assert d.metrics == {}

    def test_construction_disabled(self) -> None:
        d = Decision(
            enabled=False,
            layer=1,
            reason="dd -10.0% <= threshold -8.0%",
            metrics={"peak_nav": 100.0, "current_nav": 90.0},
        )
        assert d.enabled is False
        assert d.layer == 1


class TestKillSwitchContext:
    def test_construction(self) -> None:
        ctx = KillSwitchContext(
            peak_nav=100.0,
            current_nav=95.0,
            alloc_capital=10000.0,
            realized_today=-50.0,
        )
        assert ctx.peak_nav == 100.0
        assert ctx.realized_today == -50.0


class TestInMemoryDisabledEventsRepo:
    def test_insert_returns_event_with_id(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        event = DisabledEvent(
            id=None,
            strategy="pead",
            layer=1,
            triggered_at=datetime(2026, 5, 4, 12, 0, tzinfo=timezone.utc),
            peak_nav=100.0,
            current_nav=90.0,
            threshold=-0.08,
        )
        inserted = repo.insert(event)
        assert inserted.id == 1
        assert inserted.strategy == "pead"

    def test_insert_assigns_sequential_ids(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        e1 = repo.insert(DisabledEvent(id=None, strategy="pead", layer=1,
                                       triggered_at=datetime.now(timezone.utc)))
        e2 = repo.insert(DisabledEvent(id=None, strategy="orb", layer=2,
                                       triggered_at=datetime.now(timezone.utc)))
        assert e1.id == 1
        assert e2.id == 2

    def test_latest_unresolved_for_strategy_returns_none_if_empty(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        assert repo.latest_unresolved_for_strategy("pead", layer=3) is None

    def test_latest_unresolved_for_strategy_returns_event(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        repo.insert(DisabledEvent(id=None, strategy="pead", layer=3,
                                  triggered_at=datetime(2026, 5, 4, 9, 0, tzinfo=timezone.utc),
                                  reason="manual"))
        found = repo.latest_unresolved_for_strategy("pead", layer=3)
        assert found is not None
        assert found.strategy == "pead"
        assert found.layer == 3

    def test_latest_unresolved_skips_resolved(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        e = repo.insert(DisabledEvent(id=None, strategy="pead", layer=3,
                                      triggered_at=datetime(2026, 5, 4, 9, 0, tzinfo=timezone.utc)))
        repo.resolve(e.id, resolved_by="alice")
        assert repo.latest_unresolved_for_strategy("pead", layer=3) is None

    def test_latest_unresolved_returns_most_recent(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        repo.insert(DisabledEvent(id=None, strategy="pead", layer=1,
                                  triggered_at=datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)))
        repo.insert(DisabledEvent(id=None, strategy="pead", layer=1,
                                  triggered_at=datetime(2026, 5, 4, 9, 0, tzinfo=timezone.utc)))
        found = repo.latest_unresolved_for_strategy("pead", layer=1)
        assert found is not None
        assert found.triggered_at == datetime(2026, 5, 4, 9, 0, tzinfo=timezone.utc)

    def test_resolve_sets_resolved_fields(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        e = repo.insert(DisabledEvent(id=None, strategy="pead", layer=3,
                                      triggered_at=datetime.now(timezone.utc)))
        repo.resolve(e.id, resolved_by="bob")
        # resolved row should not appear via latest_unresolved
        assert repo.latest_unresolved_for_strategy("pead", layer=3) is None
        # but should exist in repo._events with resolved_by populated
        assert any(ev.resolved_by == "bob" for ev in repo._events.values())


class TestLayer1Drawdown:
    def test_no_drawdown_returns_enabled(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=98.0, alloc_capital=10000.0, realized_today=0.0)
        d = ks.check_layer1_drawdown("pead", ctx)
        assert d.enabled is True
        assert d.layer == 0

    def test_above_threshold_returns_enabled(self) -> None:
        # -3% drawdown is well above -8% default threshold
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=97.0, alloc_capital=10000.0, realized_today=0.0)
        d = ks.check_layer1_drawdown("pead", ctx)
        assert d.enabled is True

    def test_at_threshold_returns_disabled(self) -> None:
        # exact -8% drawdown is the trigger boundary (inclusive)
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=92.0, alloc_capital=10000.0, realized_today=0.0)
        d = ks.check_layer1_drawdown("pead", ctx)
        assert d.enabled is False
        assert d.layer == 1
        assert "dd" in d.reason.lower()

    def test_below_threshold_returns_disabled(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=85.0, alloc_capital=10000.0, realized_today=0.0)
        d = ks.check_layer1_drawdown("pead", ctx)
        assert d.enabled is False
        assert d.layer == 1
        assert d.metrics["peak_nav"] == 100.0
        assert d.metrics["current_nav"] == 85.0

    def test_zero_peak_nav_returns_enabled(self) -> None:
        # Avoid div-by-zero edge: a strategy that has never been deployed
        # has peak_nav=0 and should be enabled (no DD definable).
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=0.0, current_nav=0.0, alloc_capital=10000.0, realized_today=0.0)
        d = ks.check_layer1_drawdown("pead", ctx)
        assert d.enabled is True

    def test_writes_event_on_disable(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=85.0, alloc_capital=10000.0, realized_today=0.0)
        ks.check_layer1_drawdown("pead", ctx)
        ev = repo.latest_unresolved_for_strategy("pead", layer=1)
        assert ev is not None
        assert ev.peak_nav == 100.0
        assert ev.current_nav == 85.0
        assert ev.threshold == -0.08

    def test_does_not_double_log_on_repeated_call(self) -> None:
        # Idempotency: if the strategy is already in a disabled state, calling again
        # should not insert a second event.
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=85.0, alloc_capital=10000.0, realized_today=0.0)
        ks.check_layer1_drawdown("pead", ctx)
        ks.check_layer1_drawdown("pead", ctx)
        events = [ev for ev in repo._events.values() if ev.strategy == "pead" and ev.layer == 1]
        assert len(events) == 1

    def test_custom_threshold(self) -> None:
        # A stricter -5% threshold means -6% DD triggers it.
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo, layer1_threshold=-0.05)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=94.0, alloc_capital=10000.0, realized_today=0.0)
        d = ks.check_layer1_drawdown("pead", ctx)
        assert d.enabled is False


class TestLayer2DailyPnL:
    def test_no_loss_returns_enabled(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=100.0, alloc_capital=10000.0, realized_today=50.0)
        d = ks.check_layer2_daily_pnl("pead", ctx)
        assert d.enabled is True

    def test_above_threshold_returns_enabled(self) -> None:
        # -1% of alloc is above -2% default threshold
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=100.0, alloc_capital=10000.0, realized_today=-100.0)
        d = ks.check_layer2_daily_pnl("pead", ctx)
        assert d.enabled is True

    def test_at_threshold_returns_disabled(self) -> None:
        # exactly -2% (-200 / 10000) is inclusive trigger
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=100.0, alloc_capital=10000.0, realized_today=-200.0)
        d = ks.check_layer2_daily_pnl("pead", ctx)
        assert d.enabled is False
        assert d.layer == 2

    def test_below_threshold_returns_disabled(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=100.0, alloc_capital=10000.0, realized_today=-500.0)
        d = ks.check_layer2_daily_pnl("pead", ctx)
        assert d.enabled is False
        assert d.metrics["realized_today"] == -500.0
        assert d.metrics["alloc_capital"] == 10000.0

    def test_zero_alloc_returns_enabled(self) -> None:
        # avoid div-by-zero
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=100.0, alloc_capital=0.0, realized_today=-100.0)
        d = ks.check_layer2_daily_pnl("pead", ctx)
        assert d.enabled is True

    def test_writes_event_on_disable(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=100.0, alloc_capital=10000.0, realized_today=-300.0)
        ks.check_layer2_daily_pnl("pead", ctx)
        ev = repo.latest_unresolved_for_strategy("pead", layer=2)
        assert ev is not None
        assert ev.realized_pnl == -300.0
        assert ev.alloc_capital == 10000.0
        assert ev.threshold == -0.02

    def test_idempotent_on_repeated_call(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=100.0, alloc_capital=10000.0, realized_today=-300.0)
        ks.check_layer2_daily_pnl("pead", ctx)
        ks.check_layer2_daily_pnl("pead", ctx)
        events = [ev for ev in repo._events.values() if ev.strategy == "pead" and ev.layer == 2]
        assert len(events) == 1


class TestLayer3Manual:
    def test_no_unresolved_event_returns_enabled(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        d = ks.check_layer3_manual("pead")
        assert d.enabled is True

    def test_unresolved_layer3_event_returns_disabled(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        repo.insert(DisabledEvent(
            id=None, strategy="pead", layer=3,
            triggered_at=datetime.now(timezone.utc),
            manual_actor="alice",
            reason="suspected data feed issue",
        ))
        ks = KillSwitch(repo=repo)
        d = ks.check_layer3_manual("pead")
        assert d.enabled is False
        assert d.layer == 3
        assert "suspected data feed issue" in d.reason

    def test_resolved_event_returns_enabled(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ev = repo.insert(DisabledEvent(
            id=None, strategy="pead", layer=3,
            triggered_at=datetime.now(timezone.utc),
            manual_actor="alice",
        ))
        repo.resolve(ev.id, resolved_by="alice")
        ks = KillSwitch(repo=repo)
        d = ks.check_layer3_manual("pead")
        assert d.enabled is True

    def test_unrelated_strategy_unaffected(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        repo.insert(DisabledEvent(
            id=None, strategy="orb", layer=3,
            triggered_at=datetime.now(timezone.utc),
        ))
        ks = KillSwitch(repo=repo)
        assert ks.check_layer3_manual("pead").enabled is True
        assert ks.check_layer3_manual("orb").enabled is False

    def test_layer1_event_does_not_trigger_layer3(self) -> None:
        # An auto-disable from Layer 1 should not satisfy Layer 3's check.
        # (Layers are independent; only manual Layer-3 inserts gate Layer 3.)
        repo = InMemoryDisabledEventsRepo()
        repo.insert(DisabledEvent(
            id=None, strategy="pead", layer=1,
            triggered_at=datetime.now(timezone.utc),
        ))
        ks = KillSwitch(repo=repo)
        d = ks.check_layer3_manual("pead")
        assert d.enabled is True


class TestIsEnabledComposite:
    def test_all_layers_pass_returns_enabled(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=98.0, alloc_capital=10000.0, realized_today=-50.0)
        d = ks.is_enabled("pead", ctx)
        assert d.enabled is True
        assert d.layer == 0

    def test_layer1_fail_short_circuits(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=85.0, alloc_capital=10000.0, realized_today=0.0)
        d = ks.is_enabled("pead", ctx)
        assert d.enabled is False
        assert d.layer == 1

    def test_layer2_fail_when_layer1_passes(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=98.0, alloc_capital=10000.0, realized_today=-300.0)
        d = ks.is_enabled("pead", ctx)
        assert d.enabled is False
        assert d.layer == 2

    def test_layer3_fail_when_1_and_2_pass(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        repo.insert(DisabledEvent(id=None, strategy="pead", layer=3,
                                  triggered_at=datetime.now(timezone.utc),
                                  manual_actor="alice", reason="testing"))
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=98.0, alloc_capital=10000.0, realized_today=-50.0)
        d = ks.is_enabled("pead", ctx)
        assert d.enabled is False
        assert d.layer == 3

    def test_layer1_fails_does_not_log_layer2(self) -> None:
        # Short-circuit: when layer 1 fails, layer 2 should not even run
        # (and so should not log a layer-2 event even if layer 2 would also trigger).
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=85.0, alloc_capital=10000.0, realized_today=-300.0)
        ks.is_enabled("pead", ctx)
        layer2_events = [ev for ev in repo._events.values() if ev.strategy == "pead" and ev.layer == 2]
        assert len(layer2_events) == 0


class TestManualDisableReEnable:
    def test_disable_manual_writes_layer3_event(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ks.disable_manual("pead", actor="alice", reason="data feed degraded")
        ev = repo.latest_unresolved_for_strategy("pead", layer=3)
        assert ev is not None
        assert ev.manual_actor == "alice"
        assert ev.reason == "data feed degraded"

    def test_disable_manual_idempotent(self) -> None:
        # Calling twice while already disabled should be a no-op
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ks.disable_manual("pead", actor="alice", reason="first")
        ks.disable_manual("pead", actor="bob", reason="second")
        events = [ev for ev in repo._events.values() if ev.strategy == "pead" and ev.layer == 3]
        assert len(events) == 1
        # First reason wins (the existing event is preserved)
        assert events[0].reason == "first"

    def test_re_enable_resolves_event(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ks.disable_manual("pead", actor="alice", reason="data feed degraded")
        ks.re_enable("pead", actor="alice")
        assert repo.latest_unresolved_for_strategy("pead", layer=3) is None
        # is_enabled should reflect the re-enable
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=98.0, alloc_capital=10000.0, realized_today=0.0)
        assert ks.is_enabled("pead", ctx).enabled is True

    def test_re_enable_with_no_active_event_is_noop(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        # Calling re_enable on a strategy that isn't disabled shouldn't raise
        ks.re_enable("pead", actor="alice")
        assert repo.latest_unresolved_for_strategy("pead", layer=3) is None


class TestAsyncIsEnabled:
    """Audit B-F3 / R-F1 (2026-05-05): live runner uses ``is_enabled_async``
    so the layer-3 SELECT runs natively against the async Postgres session
    instead of bouncing through the sync facade's thread-pool bridge per
    pipeline tick. The async path must be byte-equivalent to the sync one
    for the in-memory repo (sync-only methods); the Postgres repo paths
    are exercised by ``test_kill_switch_postgres.py``.
    """

    @pytest.mark.asyncio
    async def test_async_layer3_no_event_returns_enabled(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        d = await ks.check_layer3_manual_async("pead")
        assert d.enabled is True
        assert d.layer == 0

    @pytest.mark.asyncio
    async def test_async_layer3_unresolved_returns_disabled(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        repo.insert(DisabledEvent(
            id=None, strategy="pead", layer=3,
            triggered_at=datetime.now(timezone.utc),
            manual_actor="alice", reason="test",
        ))
        ks = KillSwitch(repo=repo)
        d = await ks.check_layer3_manual_async("pead")
        assert d.enabled is False
        assert d.layer == 3

    @pytest.mark.asyncio
    async def test_async_is_enabled_layer1_short_circuits(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=85.0,
                                alloc_capital=10000.0, realized_today=0.0)
        d = await ks.is_enabled_async("pead", ctx)
        assert d.enabled is False
        assert d.layer == 1

    @pytest.mark.asyncio
    async def test_async_is_enabled_layer3_via_repo(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        repo.insert(DisabledEvent(
            id=None, strategy="pead", layer=3,
            triggered_at=datetime.now(timezone.utc),
            manual_actor="alice", reason="ops halt",
        ))
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=98.0,
                                alloc_capital=10000.0, realized_today=0.0)
        d = await ks.is_enabled_async("pead", ctx)
        assert d.enabled is False
        assert d.layer == 3
        assert "ops halt" in d.reason

    @pytest.mark.asyncio
    async def test_async_is_enabled_all_pass(self) -> None:
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=98.0,
                                alloc_capital=10000.0, realized_today=-50.0)
        d = await ks.is_enabled_async("pead", ctx)
        assert d.enabled is True
        assert d.layer == 0

    @pytest.mark.asyncio
    async def test_async_layer3_uses_async_repo_method_when_available(self) -> None:
        """When the repo exposes ``latest_unresolved_for_strategy_async``,
        ``check_layer3_manual_async`` must prefer it over the sync method
        (the live PostgresDisabledEventsRepo only has the sync facade as a
        thread-pool bridge — calling sync from inside the async runner
        would defeat the whole point of the async variant)."""
        from unittest.mock import AsyncMock, MagicMock

        async_repo = MagicMock()
        async_repo.latest_unresolved_for_strategy_async = AsyncMock(return_value=None)
        async_repo.latest_unresolved_for_strategy = MagicMock(return_value=None)
        ks = KillSwitch(repo=async_repo)
        d = await ks.check_layer3_manual_async("pead")
        async_repo.latest_unresolved_for_strategy_async.assert_awaited_once_with("pead", 3)
        async_repo.latest_unresolved_for_strategy.assert_not_called()
        assert d.enabled is True
