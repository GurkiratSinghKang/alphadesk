"""Integration test: pipeline_runner wrapper respects the kill-switch."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock

import numpy as np
import pandas as pd

from strategies._core.contracts import StrategyInput, StrategyResult
from strategies._core.kill_switch import (
    DisabledEvent,
    InMemoryDisabledEventsRepo,
    KillSwitch,
    KillSwitchContext,
)


def _empty_bars() -> pd.DataFrame:
    return pd.DataFrame(
        {"open": [], "high": [], "low": [], "close": [], "volume": []},
        index=pd.MultiIndex.from_tuples([], names=["date", "symbol"]),
    )


def _build_input() -> StrategyInput:
    return StrategyInput(
        asof=date(2026, 5, 4),
        mode="live",
        bars=_empty_bars(),
        cash=Decimal("100000"),
        equity=Decimal("100000"),
        positions=[],
        state={},
        seed=42,
        rng=np.random.default_rng(42),
    )


class TestPipelineRunnerKillSwitch:
    def test_disabled_strategy_short_circuits(self) -> None:
        """When kill-switch returns disabled, strategy.run() is NOT called."""
        from strategies._core.runners.pipeline_runner import (
            invoke_strategy_with_kill_switch,
        )
        repo = InMemoryDisabledEventsRepo()
        repo.insert(DisabledEvent(
            id=None, strategy="test_strategy", layer=3,
            triggered_at=datetime.now(timezone.utc),
            manual_actor="alice", reason="test",
        ))
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=98.0,
                                alloc_capital=10000.0, realized_today=0.0)

        mock_strategy = MagicMock()
        mock_strategy.name = "test_strategy"
        mock_params = MagicMock()
        result = invoke_strategy_with_kill_switch(
            strategy=mock_strategy,
            input=_build_input(),
            params=mock_params,
            kill_switch=ks,
            kill_switch_context=ctx,
        )
        # strategy.run() must NOT have been called
        mock_strategy.run.assert_not_called()
        # Result is a no-op StrategyResult with diagnostic
        assert isinstance(result, StrategyResult)
        assert result.signals == []
        assert result.diagnostics.get("kill_switch_disabled") is True
        assert result.diagnostics.get("kill_switch_layer") == 3

    def test_enabled_strategy_runs_normally(self) -> None:
        """When kill-switch returns enabled, strategy.run() IS called and its result returned."""
        from strategies._core.runners.pipeline_runner import (
            invoke_strategy_with_kill_switch,
        )
        repo = InMemoryDisabledEventsRepo()
        ks = KillSwitch(repo=repo)
        ctx = KillSwitchContext(peak_nav=100.0, current_nav=98.0,
                                alloc_capital=10000.0, realized_today=0.0)

        expected = StrategyResult(signals=[], diagnostics={"ran": True}, warnings=[])
        mock_strategy = MagicMock()
        mock_strategy.name = "test_strategy"
        mock_strategy.run = MagicMock(return_value=expected)
        mock_params = MagicMock()
        result = invoke_strategy_with_kill_switch(
            strategy=mock_strategy,
            input=_build_input(),
            params=mock_params,
            kill_switch=ks,
            kill_switch_context=ctx,
        )
        mock_strategy.run.assert_called_once()
        assert result.diagnostics.get("ran") is True

    def test_kill_switch_none_bypasses_check(self) -> None:
        """If kill_switch=None, the wrapper invokes the strategy directly."""
        from strategies._core.runners.pipeline_runner import (
            invoke_strategy_with_kill_switch,
        )
        expected = StrategyResult(signals=[], diagnostics={"ran": True}, warnings=[])
        mock_strategy = MagicMock()
        mock_strategy.name = "test_strategy"
        mock_strategy.run = MagicMock(return_value=expected)
        mock_params = MagicMock()
        result = invoke_strategy_with_kill_switch(
            strategy=mock_strategy,
            input=_build_input(),
            params=mock_params,
            kill_switch=None,
            kill_switch_context=None,
        )
        mock_strategy.run.assert_called_once()
        assert result.diagnostics.get("ran") is True


class TestBacktestBypassesKillSwitch:
    def test_backtest_runner_does_not_import_kill_switch(self) -> None:
        """Backtests must not consult the kill-switch — verify by inspection."""
        from pathlib import Path
        backtest_path = Path(__file__).resolve().parents[1] / "runners" / "backtest_runner.py"
        text = backtest_path.read_text()
        assert "kill_switch" not in text.lower(), (
            "backtest_runner.py imports or references kill_switch; "
            "backtests must always run regardless of production state."
        )

    def test_signal_runner_does_not_import_kill_switch(self) -> None:
        from pathlib import Path
        signal_path = Path(__file__).resolve().parents[1] / "runners" / "signal_runner.py"
        text = signal_path.read_text()
        assert "kill_switch" not in text.lower(), (
            "signal_runner.py imports or references kill_switch; "
            "signal replay must always run regardless of production state."
        )
