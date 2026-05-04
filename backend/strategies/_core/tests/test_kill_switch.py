"""Unit tests for the three-layer kill-switch."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from strategies._core.kill_switch import (
    Decision,
    DisabledEvent,
    KillSwitchContext,
)
# These will be imported by later test classes:
# from strategies._core.kill_switch import InMemoryDisabledEventsRepo, KillSwitch


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
