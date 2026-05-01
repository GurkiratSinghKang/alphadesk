"""Daily-pipeline handling for scheduler windows with no runnable strategy."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.mark.asyncio
async def test_research_only_subset_skips_before_provider_io(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ORB/VWAP scheduler window is valid but currently research-only."""
    from data.ingestion import daily_pipeline as dp

    replay_called = False

    async def _not_halted() -> bool:
        return False

    async def _replay_pending_brackets() -> list:
        nonlocal replay_called
        replay_called = True
        return []

    monkeypatch.setattr(dp, "_is_trading_halted", _not_halted)
    monkeypatch.setattr(dp, "_is_within_trading_window", lambda: True)
    monkeypatch.setattr(dp, "_base_url", lambda: "https://paper-api.alpaca.markets")
    monkeypatch.setattr(dp, "replay_pending_brackets", _replay_pending_brackets)

    result = await dp._run_pipeline_inner(only_strategies=["orb", "vwap"])

    assert result["skipped"] is True
    assert result["no_retry"] is True
    assert result["reason"] == "no_runnable_strategies"
    assert result["requested_strategies"] == ["orb", "vwap"]
    assert "rsi2_reversal" in result["runnable_strategies"]
    assert replay_called is False
