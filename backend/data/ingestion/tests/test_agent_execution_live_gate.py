"""Live-gate coverage for the ExecutionAgent.

Wave 2F / persona-78 gap #1 sub-item: ``agents.execution.ExecutionAgent.execute_trade``
is one of the six bypass paths Wave A wired into
``core.trading_gate.reject_if_live_forbidden``. Before Wave A, an LLM
agent could call this method with ``structure={"strategy": "orb"}`` on
a live account with zero gate.

Contract (from the wrapper in ``agents/execution.py::execute_trade``):

* Gate rejection must NOT raise. The execution agent is called from
  inside the agent supervisor loop — an uncaught exception corrupts the
  turn and triggers auto-retry. Instead the method returns
  ``{"success": False, "error": "<live-gate msg>"}``.
* The error message must carry the live-gate signature (denylist /
  paper-only / unknown strategy) so downstream planners can classify
  the rejection distinctly from a risk or broker-side failure.
* No broker POST is attempted — we replace ``httpx`` with a trap to
  catch regressions.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture
def live_armed(monkeypatch: pytest.MonkeyPatch) -> None:
    """URL=live + LIVE_TRADING_ENABLED=True so the gate is active."""
    from core import config as core_config

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)


@pytest.fixture
def agent_stubs(monkeypatch: pytest.MonkeyPatch) -> dict[str, bool]:
    """Stub the execution agent's side effects:

    * ``_agent_is_trading_halted`` — False, so the halt check is a no-op
      (the previous test fixture in this repo uses the same pattern).
    * ``httpx.AsyncClient`` — trap. A gated rejection must exit BEFORE
      any HTTP request; the trap catches regressions.
    * ``core.redis.cache_get`` — returns a dummy quote so the method
      gets past the market-data guard and we can then assert the gate
      fires (not the missing-quote fallback).

    The test fixture for the allow-path (non-denylisted strategy) is in
    a separate fixture because its httpx stub must behave as a happy
    broker, not a trap.
    """
    from agents import execution as exec_mod

    probes = {"http_called": False}

    async def _fake_halted() -> bool:
        return False

    async def _fake_cache_get(key: str) -> Any:
        if key.startswith("quote:"):
            return {"last": 150.0}
        return None

    class _TrapClient:
        async def __aenter__(self) -> Any:
            return self

        async def __aexit__(self, *args: Any) -> None:
            return None

        async def post(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover
            probes["http_called"] = True
            raise AssertionError(
                "SECURITY: ExecutionAgent POSTed to Alpaca despite the live-gate."
            )

        async def get(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover
            probes["http_called"] = True
            raise AssertionError(
                "ExecutionAgent reached Alpaca account GET on a gated path."
            )

    monkeypatch.setattr(exec_mod, "_agent_is_trading_halted", _fake_halted)

    import core.redis as redis_mod

    monkeypatch.setattr(redis_mod, "cache_get", _fake_cache_get)
    # ``execute_trade`` imports ``cache_get`` inside the function body, so
    # it resolves from the source module — the above patch is sufficient.

    # ``httpx`` is also imported INSIDE ``execute_trade``. Patch at the
    # library module level so the function's local ``import httpx`` picks
    # up our trap. We replace only ``AsyncClient`` (the method uses nothing
    # else) so the rest of httpx stays functional for tests that happen
    # to load it unrelatedly.
    import httpx as httpx_mod

    monkeypatch.setattr(httpx_mod, "AsyncClient", _TrapClient)

    return probes


def _make_agent() -> Any:
    """Build an ExecutionAgent instance.

    We bypass ``BaseAgent.__init__`` (which would try to construct MCP
    clients) because we only exercise ``execute_trade`` — the BaseAgent
    init does not matter for the gate contract. The simplest path is to
    instantiate via ``object.__new__`` and set the required attributes.
    """
    from agents.execution import ExecutionAgent

    # Subclass attributes are fine to inherit; we just need an instance
    # with enough state to call ``execute_trade`` (which only reads
    # module-level helpers and its args).
    agent = object.__new__(ExecutionAgent)
    return agent


@pytest.mark.asyncio
async def test_execute_trade_rejects_orb_on_live(
    live_armed: None, agent_stubs: dict[str, bool],
) -> None:
    """``structure.strategy == "orb"`` on live → returns success=False."""
    agent = _make_agent()
    result = await agent.execute_trade(
        symbol="AAPL",
        side="buy",
        structure={"strategy": "orb", "stop_distance_pct": 0.05},
        risk_budget=1000.0,
        portfolio_value=100_000.0,
    )
    assert result["success"] is False
    assert "denylist" in result["error"]
    assert agent_stubs["http_called"] is False


@pytest.mark.asyncio
async def test_execute_trade_rejects_kama_breakout_on_live(
    live_armed: None, agent_stubs: dict[str, bool],
) -> None:
    """``kama_breakout`` is paper-only; agent refuses on live."""
    agent = _make_agent()
    result = await agent.execute_trade(
        symbol="AAPL",
        side="buy",
        structure={"strategy": "kama_breakout", "stop_distance_pct": 0.05},
        risk_budget=1000.0,
        portfolio_value=100_000.0,
    )
    assert result["success"] is False
    assert "paper-only" in result["error"]
    assert agent_stubs["http_called"] is False


@pytest.mark.asyncio
async def test_execute_trade_rejects_unknown_strategy_on_live(
    live_armed: None, agent_stubs: dict[str, bool],
) -> None:
    """Spoofed strategy — agent refuses with unknown-strategy reason."""
    agent = _make_agent()
    result = await agent.execute_trade(
        symbol="AAPL",
        side="buy",
        structure={"strategy": "orbx", "stop_distance_pct": 0.05},
        risk_budget=1000.0,
        portfolio_value=100_000.0,
    )
    assert result["success"] is False
    assert "unknown strategy" in result["error"]
    assert agent_stubs["http_called"] is False


@pytest.mark.asyncio
async def test_execute_trade_gate_runs_before_market_data_check(
    live_armed: None,
    agent_stubs: dict[str, bool],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Gate fires BEFORE the market-data / buying-power checks.

    Rationale: the market-data check hits Redis; the buying-power check
    hits Alpaca. Both are expensive and both are racy on a denylisted
    strategy. The Wave A contract says the gate is the first safety
    check after the halt flag — assert that by replacing ``cache_get``
    to return None (which would yield "No market data available" if the
    method reached it). We expect the denylist error instead.
    """
    import core.redis as redis_mod

    async def _no_quote(key: str) -> Any:
        return None

    monkeypatch.setattr(redis_mod, "cache_get", _no_quote)

    agent = _make_agent()
    result = await agent.execute_trade(
        symbol="AAPL",
        side="buy",
        structure={"strategy": "orb"},
        risk_budget=1000.0,
        portfolio_value=100_000.0,
    )
    assert result["success"] is False
    assert "denylist" in result["error"], (
        "Expected the live-gate denylist error to take precedence over "
        "the missing-quote error — got: " + repr(result.get("error"))
    )
