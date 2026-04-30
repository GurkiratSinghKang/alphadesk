"""Live-gate coverage for the TradingView webhook handler.

Wave 2F / persona-78 gap #1 sub-item: ``webhooks._handle_trade_signal`` is
one of the six bypass paths Wave A wired into
``core.trading_gate.reject_if_live_forbidden``. Before Wave A, a
TradingView alert with ``strategy="orb"`` routed straight through to
``execution_agent.run`` with no gate at all — an attacker who knows (or
discovers) the webhook secret could submit orders for denylisted
strategies onto live capital.

The handler intentionally CATCHES the ``RuntimeError`` the gate raises
so TradingView never sees a 5xx (which would trigger retries and
amplify the bypass attempt). Instead it returns a structured dict with
``action="rejected_by_gate"``. These tests assert that shape AND that
the execution agent was never invoked.
"""
from __future__ import annotations

from typing import Any

import pytest


@pytest.fixture
def live_armed(monkeypatch: pytest.MonkeyPatch) -> None:
    """URL=live + LIVE_TRADING_ENABLED=True so the gate is active."""
    from core import config as core_config

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)


@pytest.fixture
def trap_agent(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Replace ``agents.get_agent("execution")`` with a probe.

    If the gate passes the call through, this probe records the
    invocation and the test fails. The probe stores the last task the
    agent would have run on — useful for diagnosing a regression.
    """
    probes: dict[str, Any] = {"agent_called_with": None}

    class _FakeAgent:
        async def run(self, task: str) -> dict[str, Any]:
            probes["agent_called_with"] = task
            return {"success": True, "order_id": "should-not-be-reached"}

    def _fake_get_agent(name: str) -> Any:
        # Import path must match what webhooks does: ``from agents import get_agent``.
        return _FakeAgent()

    # Patch at the ``agents`` package re-export. Because the webhook does
    # ``from agents import get_agent`` inside the function body, we need
    # to patch the source module — not a copy inside webhooks.
    import agents as agents_pkg

    monkeypatch.setattr(agents_pkg, "get_agent", _fake_get_agent)
    return probes


def _tv_alert(strategy: str, action: str = "buy") -> Any:
    """Build a ``TradingViewAlert`` matching the webhook schema."""
    from api.routes.webhooks import TradingViewAlert

    return TradingViewAlert(
        ticker="AAPL",
        action=action,
        price=150.0,
        strategy=strategy,
        message="test alert",
    )


@pytest.mark.asyncio
async def test_webhook_rejects_orb_on_live(
    live_armed: None, trap_agent: dict[str, Any],
) -> None:
    """TradingView ``buy`` signal with strategy=orb on live → rejected_by_gate.

    Contract: webhook returns a 200 (the route wraps the handler's result
    in ``WebhookResponse``); the action field carries the sentinel so the
    frontend knows the alert was refused.
    """
    from api.routes.webhooks import _handle_trade_signal

    result = await _handle_trade_signal(_tv_alert("orb"))
    assert result["action"] == "rejected_by_gate"
    assert "denylist" in result["detail"]
    assert trap_agent["agent_called_with"] is None, (
        "SECURITY: webhook invoked the execution agent for a denylisted "
        "strategy on live — gate has bypassed."
    )


@pytest.mark.asyncio
async def test_webhook_rejects_kama_breakout_on_live(
    live_armed: None, trap_agent: dict[str, Any],
) -> None:
    """``kama_breakout`` is paper-only; webhook refuses on live."""
    from api.routes.webhooks import _handle_trade_signal

    result = await _handle_trade_signal(_tv_alert("kama_breakout"))
    assert result["action"] == "rejected_by_gate"
    assert "paper-only" in result["detail"]
    assert trap_agent["agent_called_with"] is None


@pytest.mark.asyncio
async def test_webhook_rejects_unknown_strategy_on_live(
    live_armed: None, trap_agent: dict[str, Any],
) -> None:
    """Spoofed strategy name — webhook refuses with unknown-strategy reason."""
    from api.routes.webhooks import _handle_trade_signal

    result = await _handle_trade_signal(_tv_alert("orbx"))
    assert result["action"] == "rejected_by_gate"
    assert "unknown strategy" in result["detail"]
    assert trap_agent["agent_called_with"] is None


@pytest.mark.asyncio
async def test_webhook_allows_manual_none_strategy(
    live_armed: None, trap_agent: dict[str, Any],
) -> None:
    """A TV alert with no ``strategy`` field (manual) bypasses the gate.

    Rationale: the ``strategy`` parameter is optional in the TV alert
    schema — an operator pushing a one-off alert from TradingView
    without a strategy tag is the manual/discretionary case. The gate
    passes those through to the execution agent.
    """
    from api.routes.webhooks import TradingViewAlert, _handle_trade_signal

    alert = TradingViewAlert(
        ticker="AAPL", action="buy", price=150.0, message="manual alert",
    )
    result = await _handle_trade_signal(alert)
    # Execution agent was invoked (though returns success in the stub).
    assert trap_agent["agent_called_with"] is not None
    assert "order_submitted" in result["action"] or "order_failed" in result["action"]


@pytest.mark.asyncio
async def test_webhook_rejects_when_aggregate_risk_gate_errors(
    live_armed: None,
    trap_agent: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Risk service outages must fail closed before the execution agent.

    A valid TradingView signal is still a side-effecting broker path. If the
    shared risk gate cannot evaluate the request, the webhook should return a
    structured rejection instead of continuing to the agent.
    """
    from api.routes import _risk_pipeline as risk_pipeline
    from api.routes.webhooks import TradingViewAlert, _handle_trade_signal

    async def _risk_unavailable(*_args: Any, **_kwargs: Any) -> tuple[bool, str]:
        raise RuntimeError("risk service offline")

    monkeypatch.setattr(risk_pipeline, "run_aggregate_risk_check", _risk_unavailable)

    alert = TradingViewAlert(
        ticker="AAPL",
        action="buy",
        price=150.0,
        message="manual alert",
    )
    result = await _handle_trade_signal(alert)

    assert result["action"] == "rejected_by_risk"
    assert "risk service offline" in result["detail"]
    assert trap_agent["agent_called_with"] is None
