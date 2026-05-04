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
