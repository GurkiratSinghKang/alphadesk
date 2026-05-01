"""Live-gate coverage for the broker MCP tool.

Wave 2F / persona-78 gap #1 sub-item: ``mcp_servers.broker.server.submit_order``
is one of the six bypass paths Wave A wired into
``core.trading_gate.reject_if_live_forbidden``. Before Wave A this tool
had ZERO gates — an LLM agent could call it with ``strategy="orb"`` on
a live account and the order would route to live capital.

These tests prove the gate fires from the MCP tool path and never
reaches the Alpaca POST. Unlike the HTTP path (which raises
``HTTPException``) and the pipeline path (which re-raises
``RuntimeError``), the MCP path is designed to RETURN a structured
rejection dict — agents cannot handle raised exceptions cleanly in a
tool-call response. We assert the rejection shape here.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest


@pytest.fixture
def live_armed(monkeypatch: pytest.MonkeyPatch) -> None:
    """URL=live + LIVE_TRADING_ENABLED=True so the gate is active."""
    from core import config as core_config

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)


@pytest.fixture
def broker_server() -> Any:
    """Instantiate the broker MCP server.

    ``BrokerServer()`` registers its tools globally via the MCP registry
    — that's fine for a test since the registry is idempotent and the
    functions we care about are methods on the instance anyway.
    """
    from mcp_servers.broker.server import BrokerServer

    return BrokerServer()


@pytest.fixture
def trap_httpx(monkeypatch: pytest.MonkeyPatch) -> dict[str, bool]:
    """Replace ``httpx.AsyncClient`` with a trap that fails the test loudly
    if any HTTP request is made. If the gate passes through, this probe
    catches it — the broker MCP tool must NOT reach ``/v2/orders`` for a
    denylisted strategy on a live config.
    """
    probes = {"http_called": False}

    class _TrapClient:
        async def __aenter__(self) -> Any:
            return self

        async def __aexit__(self, *args: Any) -> None:
            return None

        async def post(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover
            probes["http_called"] = True
            raise AssertionError(
                "SECURITY: MCP broker submit_order POSTed to Alpaca "
                "despite the live-gate — bypass regression."
            )

        async def get(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover
            probes["http_called"] = True
            raise AssertionError("unexpected HTTP GET in gated path")

    # The server module binds ``httpx`` at module scope; patch there.
    import mcp_servers.broker.server as broker_mod

    class _NSHttpx:
        AsyncClient = _TrapClient

    monkeypatch.setattr(broker_mod, "httpx", _NSHttpx)
    return probes


@pytest.mark.asyncio
async def test_submit_order_rejects_orb_on_live(
    live_armed: None, broker_server: Any, trap_httpx: dict[str, bool],
) -> None:
    """ORB strategy on live must return a ``rejected_by_gate`` dict — NOT
    raise, NOT reach httpx.

    Contract: the tool returns a normal-shaped dict so the LLM agent sees
    a tool-call result; the ``status`` field carries the sentinel
    ``"rejected_by_gate"`` so downstream planners can treat it distinctly
    from a broker-side rejection.
    """
    result = await broker_server.submit_order(
        symbol="AAPL", qty=10, side="buy", strategy="orb",
    )
    assert result["status"] == "rejected_by_gate"
    assert result["order_id"] is None
    assert "denylist" in result["error"]
    assert trap_httpx["http_called"] is False


@pytest.mark.asyncio
async def test_submit_order_rejects_kama_breakout_on_live(
    live_armed: None, broker_server: Any, trap_httpx: dict[str, bool],
) -> None:
    """``kama_breakout`` is paper-only; rejected with the paper-only reason."""
    result = await broker_server.submit_order(
        symbol="AAPL", qty=10, side="buy", strategy="kama_breakout",
    )
    assert result["status"] == "rejected_by_gate"
    assert "paper-only" in result["error"]
    assert trap_httpx["http_called"] is False


@pytest.mark.asyncio
async def test_submit_order_rejects_unknown_strategy_on_live(
    live_armed: None, broker_server: Any, trap_httpx: dict[str, bool],
) -> None:
    """Spoofed strategy names are rejected too — persona-66 parity."""
    result = await broker_server.submit_order(
        symbol="AAPL", qty=10, side="buy", strategy="orbx",
    )
    assert result["status"] == "rejected_by_gate"
    assert "unknown strategy" in result["error"]
    assert trap_httpx["http_called"] is False


@pytest.mark.asyncio
async def test_submit_order_allows_manual_explicit_strategy_on_live(
    live_armed: None, broker_server: Any, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Manual orders must pass an explicit ``strategy`` (Wave 5β Fix 3).

    Prior behaviour: ``strategy=None`` was accepted and the live-gate
    was skipped for that call. That let an LLM agent submit any order
    to live capital just by omitting ``strategy``. The MCP tool now
    REQUIRES a non-empty ``strategy``; the happy-path here passes
    ``"manual"`` (a non-denylisted identifier) so the gate evaluates
    normally and the order reaches the broker.

    Round-7 / O-7: the previous version of this test relied on the
    fail-open ``except Exception: pass`` around the risk gate — a
    market order without limit_price made the notional pre-computation
    raise HTTPException, the bare-except swallowed it, and the order
    sailed through. We now fail closed (any gate error rejects the
    order). To exercise the broker happy-path we mock the risk-gate
    entry point so the test is about "does the gate pass-through
    submit to Alpaca" rather than about the gate's own internals.
    """
    class _OKResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "id": "broker-1",
                "status": "accepted",
                "symbol": "AAPL",
                "qty": "10",
                "side": "buy",
                "type": "market",
            }

    class _OKClient:
        async def __aenter__(self) -> Any:
            return self

        async def __aexit__(self, *args: Any) -> None:
            return None

        async def post(self, *args: Any, **kwargs: Any) -> _OKResponse:
            return _OKResponse()

    import mcp_servers.broker.server as broker_mod

    class _NSHttpx:
        AsyncClient = _OKClient

    monkeypatch.setattr(broker_mod, "httpx", _NSHttpx)

    # Need broker keys so the ``_headers`` helper returns something valid.
    from core import config as core_config

    monkeypatch.setattr(
        core_config.settings.ALPACA_API_KEY,
        "get_secret_value",
        lambda: "TEST_KEY",
        raising=False,
    )
    monkeypatch.setattr(
        core_config.settings.ALPACA_SECRET_KEY,
        "get_secret_value",
        lambda: "TEST_SECRET",
        raising=False,
    )

    # Stub the risk gate so we test the broker path, not the gate.
    # Returning ``(True, "passed")`` mirrors the real gate's success shape.
    from api.routes import _risk_pipeline

    async def _fake_pass(*_args: Any, **_kwargs: Any) -> tuple[bool, str]:
        return True, "passed"

    monkeypatch.setattr(_risk_pipeline, "run_aggregate_risk_check", _fake_pass)

    submitted: dict[str, Any] = {}

    async def _fake_submit(request: Any, **_kwargs: Any) -> Any:
        submitted["request"] = request
        return SimpleNamespace(
            id="broker-1",
            status="accepted",
            legs=request.legs,
        )

    monkeypatch.setattr(_risk_pipeline, "submit_order_via_api", _fake_submit)

    # Manual / discretionary order — explicit 'manual' strategy.
    result = await broker_server.submit_order(
        symbol="AAPL", qty=10, side="buy", strategy="manual",
    )
    assert result["order_id"] == "broker-1"
    assert result["status"] == "accepted"
    assert submitted["request"].strategy == "manual"


@pytest.mark.asyncio
async def test_submit_order_fails_closed_when_risk_gate_raises(
    live_armed: None, broker_server: Any, monkeypatch: pytest.MonkeyPatch,
    trap_httpx: dict[str, bool],
) -> None:
    """Round-7 / O-7: any exception from the aggregate risk gate must
    reject the order rather than fall through to Alpaca.

    Prior behaviour: ``try/except Exception: pass`` around the gate.
    A transient Redis hiccup, a typo in the risk pipeline, or a real
    rejection that surfaced as HTTPException all triggered the same
    silent pass-through; the order then submitted to live capital
    despite the operator believing the gate was guarding it.

    We patch the gate to raise unconditionally and assert the broker
    HTTP path is never reached and the response carries the
    ``rejected_by_risk_error`` sentinel so callers can distinguish a
    gate-internal failure from a normal denial.
    """
    from api.routes import _risk_pipeline

    async def _explode(*_args: Any, **_kwargs: Any) -> tuple[bool, str]:
        raise RuntimeError("simulated risk-gate dependency failure")

    monkeypatch.setattr(_risk_pipeline, "run_aggregate_risk_check", _explode)

    result = await broker_server.submit_order(
        symbol="AAPL", qty=10, side="buy", strategy="manual",
    )
    assert result["order_id"] is None
    assert result["status"] == "rejected_by_risk_error"
    assert "fail closed" in result["error"]
    assert trap_httpx["http_called"] is False


@pytest.mark.asyncio
async def test_submit_order_rejects_missing_strategy(
    broker_server: Any,
) -> None:
    """Wave 5β Fix 3 (P108 P1): missing strategy raises ValueError.

    A prior wave treated ``strategy=None`` as "manual / discretionary"
    and skipped the live-gate denylist check. An LLM agent that forgot
    to pass ``strategy`` could therefore bypass the gate. We now fail
    fast with a ValueError, preventing both accidental omission and
    deliberate gate-evasion by agents.
    """
    with pytest.raises(ValueError, match="strategy"):
        await broker_server.submit_order(symbol="AAPL", qty=10, side="buy")
    with pytest.raises(ValueError, match="strategy"):
        await broker_server.submit_order(
            symbol="AAPL", qty=10, side="buy", strategy="",
        )
    with pytest.raises(ValueError, match="strategy"):
        await broker_server.submit_order(
            symbol="AAPL", qty=10, side="buy", strategy=None,
        )
