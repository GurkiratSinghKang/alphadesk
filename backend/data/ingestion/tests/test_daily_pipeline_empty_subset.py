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
    """A research-only subset skips before provider IO."""
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

    requested = ["earnings-options-play", "vrp_harvest"]
    result = await dp._run_pipeline_inner(only_strategies=requested)

    assert result["skipped"] is True
    assert result["no_retry"] is True
    assert result["reason"] == "no_runnable_strategies"
    assert result["requested_strategies"] == requested
    assert "orb" in result["runnable_strategies"]
    assert replay_called is False


@pytest.mark.asyncio
async def test_market_closed_skip_preserves_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A manual after-hours run should not be surfaced as a successful run."""
    from data.ingestion import daily_pipeline as dp

    async def _not_halted() -> bool:
        return False

    monkeypatch.setattr(dp, "_is_trading_halted", _not_halted)
    monkeypatch.setattr(dp, "_is_within_trading_window", lambda: False)
    monkeypatch.setattr(dp, "_base_url", lambda: "https://paper-api.alpaca.markets")
    monkeypatch.setattr(dp, "_save_log", lambda log: None)

    dp._pipeline_status["last_result"] = "success"

    result = await dp._run_pipeline_inner()

    assert result["skipped"] is True
    assert result["reason"] == "market_closed"
    assert dp._pipeline_status["last_result"] == "skipped_market_closed"


@pytest.mark.asyncio
async def test_account_unavailable_aborts_before_strategy_io(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Broker account state is required; never trade on synthetic equity."""
    from data.ingestion import daily_pipeline as dp

    saved_logs: list[dict] = []

    async def _not_halted() -> bool:
        return False

    async def _replay_pending_brackets() -> list:
        return []

    async def _account_down(client) -> dict:
        raise RuntimeError("broker offline")

    async def _vix_should_not_run(client) -> float:
        raise AssertionError("VIX fetch should not run after account failure")

    class _Ledger:
        pass

    class _AsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args) -> None:
            return None

    monkeypatch.setattr(dp, "_is_trading_halted", _not_halted)
    monkeypatch.setattr(dp, "_is_within_trading_window", lambda: True)
    monkeypatch.setattr(dp, "_base_url", lambda: "https://paper-api.alpaca.markets")
    monkeypatch.setattr(dp, "replay_pending_brackets", _replay_pending_brackets)
    monkeypatch.setattr(dp, "TradeLedger", _Ledger)
    monkeypatch.setattr(dp, "_get_account", _account_down)
    monkeypatch.setattr(dp, "_get_vix_level", _vix_should_not_run)
    monkeypatch.setattr(dp.httpx, "AsyncClient", _AsyncClient)
    monkeypatch.setattr(dp, "_save_log", lambda log: saved_logs.append(log))

    dp._pipeline_status["last_result"] = "success"
    result = await dp._run_pipeline_inner()

    assert result["aborted"] is True
    assert result["reason"] == "account_unavailable"
    assert result["portfolio_snapshot"] == {
        "account_available": False,
        "account_error": "RuntimeError",
    }
    assert result["errors"] == ["Alpaca account unavailable: RuntimeError"]
    assert dp._pipeline_status["last_result"] == "account_unavailable"
    assert saved_logs == [result]
