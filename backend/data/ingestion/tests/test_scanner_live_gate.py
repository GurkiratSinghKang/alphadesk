"""Live-gate coverage for the real-time scanner execution path.

Wave 2F / persona-78 gap #1 sub-item: ``realtime_scanner._execute_triggered_setup``
is one of the six bypass paths Wave A wired into
``core.trading_gate.reject_if_live_forbidden``. Previously there was no
test proving the gate fires when the scanner sees an ``orb`` setup on a
live configuration.

The scanner path is special: the handler SWALLOWS the ``RuntimeError``
(by design — a denied realtime setup must not crash the scanner loop),
so we assert on a DIFFERENT observable. If the gate rejects, the
handler:

* logs a warning line naming the strategy + err,
* returns early WITHOUT calling ``_place_order``.

We intercept ``_place_order`` with a probe and verify it was never
called; that's the load-bearing signal for "gate fired, broker untouched".
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
def paper_armed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Paper URL so allowed scanner orders can reach the order probe."""
    from core import config as core_config

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: False)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", False, raising=False)


@pytest.fixture
def stub_side_effects(monkeypatch: pytest.MonkeyPatch) -> dict[str, list]:
    """Replace every side-effect inside ``_execute_triggered_setup``:

    * ``core.redis.publish`` — no-op, so the scanner doesn't dial Redis.
    * ``data.ingestion.daily_pipeline._place_order`` — the probe. If the
      gate DOES fire the probe must be untouched; if the gate fails open,
      the probe records the call and the test fails.
    * ``data.ingestion.trade_ledger.TradeLedger`` — stubbed so the test
      doesn't attempt Postgres access.

    Returns the probe dict so tests can assert against it.
    """
    from data.ingestion import daily_pipeline as pipeline_mod
    import data.ingestion.realtime_scanner as scanner_mod
    from api.routes import trades as trades_mod
    import core.redis as redis_mod

    probes: dict[str, list] = {
        "place_order_calls": [],
        "bracket_order_calls": [],
        "ledger_entries": [],
        "persisted_trades": [],
    }

    async def _fake_publish(channel: str, data: dict) -> int:
        return 0

    async def _fake_place_order(
        client: Any, symbol: str, qty: int, side: str, *, strategy: str = "unknown",
    ) -> dict:
        probes["place_order_calls"].append(
            {"symbol": symbol, "qty": qty, "side": side, "strategy": strategy}
        )
        return {"id": "should-not-be-reached", "client_order_id": "scanner-short-coid"}

    async def _fake_place_bracket_order(
        client: Any,
        symbol: str,
        qty: int,
        stop_price: float,
        take_profit_price: float | None,
        *,
        strategy: str = "unknown",
    ) -> dict:
        probes["bracket_order_calls"].append(
            {
                "symbol": symbol,
                "qty": qty,
                "stop_price": stop_price,
                "take_profit_price": take_profit_price,
                "strategy": strategy,
            }
        )
        return {"id": "bracket-order", "client_order_id": "scanner-bracket-coid"}

    async def _fake_persist_realtime_trade_for_reconciliation(**kwargs: Any) -> None:
        probes["persisted_trades"].append(kwargs)

    class _StubLedger:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def record_entry(self, **kwargs: Any) -> None:
            probes["ledger_entries"].append(kwargs)

    async def _fake_halted() -> bool:
        return False

    async def _fake_rate_limit(username: str) -> None:
        return None

    async def _fake_agg(payload: Any, username: str | None = None) -> tuple[bool, str]:
        return True, "ok"

    async def _fake_risk(payload: Any) -> tuple[bool, str]:
        return True, "ok"

    monkeypatch.setattr(redis_mod, "publish", _fake_publish)
    monkeypatch.setattr(pipeline_mod, "_place_order", _fake_place_order)
    monkeypatch.setattr(pipeline_mod, "_place_bracket_order", _fake_place_bracket_order)
    monkeypatch.setattr(
        scanner_mod,
        "_persist_realtime_trade_for_reconciliation",
        _fake_persist_realtime_trade_for_reconciliation,
    )
    monkeypatch.setattr(trades_mod, "_is_trading_halted", _fake_halted)
    monkeypatch.setattr(trades_mod, "_enforce_order_rate_limit", _fake_rate_limit)
    monkeypatch.setattr(trades_mod, "_aggregate_risk_check", _fake_agg)
    monkeypatch.setattr(trades_mod, "_risk_check", _fake_risk)

    # TradeLedger is imported INSIDE the function, so patch at the origin
    # module so the lazy import resolves to the stub.
    import data.ingestion.trade_ledger as ledger_mod

    monkeypatch.setattr(ledger_mod, "TradeLedger", _StubLedger)
    return probes


def _orb_setup(symbol: str = "AAPL", strategy: str = "orb") -> dict[str, Any]:
    """Minimal valid ``setup`` dict that would otherwise fire a real-time trade.

    Matches the shape ``_execute_triggered_setup`` reads — the required
    fields are ``strategy``, ``symbol``, ``fill_price`` (or
    ``trigger_price``), and ``shares``.
    """
    return {
        "strategy": strategy,
        "symbol": symbol,
        "fill_price": 150.0,
        "shares": 10,
        "conviction": 75,
        "type": "breakout",
        "direction": "long",
        "rationale": "test",
    }


@pytest.mark.asyncio
async def test_scanner_refuses_orb_on_live(
    live_armed: None, stub_side_effects: dict[str, list],
) -> None:
    """An ``orb`` setup on a live config must NOT reach ``_place_order``."""
    from data.ingestion.realtime_scanner import _execute_triggered_setup

    await _execute_triggered_setup(_orb_setup(strategy="orb"))

    assert stub_side_effects["place_order_calls"] == [], (
        "SECURITY: realtime scanner called _place_order for a denylisted "
        "strategy on a live config — gate bypassed."
    )
    # Ledger SHOULD also be untouched: record_entry runs AFTER the POST
    # in the handler, so a gated path never logs a fictitious entry.
    assert stub_side_effects["ledger_entries"] == []
    assert stub_side_effects["persisted_trades"] == []


@pytest.mark.asyncio
async def test_scanner_refuses_kama_breakout_on_live(
    live_armed: None, stub_side_effects: dict[str, list],
) -> None:
    """``kama_breakout`` is paper-only; on live it must be refused too."""
    from data.ingestion.realtime_scanner import _execute_triggered_setup

    await _execute_triggered_setup(_orb_setup(strategy="kama_breakout"))
    assert stub_side_effects["place_order_calls"] == []


@pytest.mark.asyncio
async def test_scanner_refuses_spoofed_strategy_on_live(
    live_armed: None, stub_side_effects: dict[str, list],
) -> None:
    """A spoofed (non-allowlisted) strategy name is rejected as unknown.

    Guarantees parity with the HTTP path — the persona-66 canonicalisation
    fix also protects the scanner. A fail-open here would let an attacker
    who can inject a setup dict sidestep the deny-list.
    """
    from data.ingestion.realtime_scanner import _execute_triggered_setup

    await _execute_triggered_setup(_orb_setup(strategy="orbx"))
    assert stub_side_effects["place_order_calls"] == []


@pytest.mark.asyncio
async def test_scanner_does_not_publish_alert_on_gated_path(
    live_armed: None,
    stub_side_effects: dict[str, list],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The gate runs BEFORE the ``publish("alerts", …)`` call.

    Rationale: an alert for a denylisted strategy would confuse the
    frontend (it shows "pending signal" and then silently never fills).
    Assert the gate short-circuits BEFORE the publish — by tracking the
    channels that were published to.
    """
    import core.redis as redis_mod

    published: list[str] = []

    async def _capture_publish(channel: str, data: dict) -> int:
        published.append(channel)
        return 0

    monkeypatch.setattr(redis_mod, "publish", _capture_publish)

    from data.ingestion.realtime_scanner import _execute_triggered_setup

    await _execute_triggered_setup(_orb_setup(strategy="orb"))
    assert published == []
    assert stub_side_effects["place_order_calls"] == []


@pytest.mark.asyncio
async def test_scanner_routes_long_setup_through_atomic_bracket(
    paper_armed: None,
    stub_side_effects: dict[str, list],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A long realtime trigger carries its stop/target to Alpaca atomically."""
    import data.ingestion.realtime_scanner as scanner
    import core.trading_gate as gate

    async def _liquid_ok(symbol: str, price: float) -> tuple[bool, str | None]:
        return True, None

    monkeypatch.setattr(scanner, "_liquidity_filters_ok", _liquid_ok)
    monkeypatch.setattr(gate, "reject_if_live_forbidden", lambda *args, **kwargs: None)

    await scanner._execute_triggered_setup(
        {
            **_orb_setup(strategy="mean_reversion"),
            "direction": "long",
            "stop_loss": 142.50,
            "take_profit": 168.00,
        }
    )

    assert stub_side_effects["place_order_calls"] == []
    assert stub_side_effects["bracket_order_calls"] == [
        {
            "symbol": "AAPL",
            "qty": 10,
            "stop_price": 142.50,
            "take_profit_price": 168.00,
            "strategy": "mean_reversion",
        }
    ]
    assert stub_side_effects["persisted_trades"][0]["result"] == {
        "id": "bracket-order",
        "client_order_id": "scanner-bracket-coid",
    }
    assert stub_side_effects["persisted_trades"][0]["ledger_side"] == "long"
    assert stub_side_effects["ledger_entries"][0]["side"] == "long"


@pytest.mark.asyncio
async def test_scanner_routes_short_setup_as_sell(
    paper_armed: None,
    stub_side_effects: dict[str, list],
    monkeypatch: pytest.MonkeyPatch,
    ) -> None:
    """A bearish realtime setup opens a short, not an accidental long."""
    import data.ingestion.realtime_scanner as scanner
    import core.trading_gate as gate

    async def _liquid_ok(symbol: str, price: float) -> tuple[bool, str | None]:
        return True, None

    monkeypatch.setattr(scanner, "_liquidity_filters_ok", _liquid_ok)
    monkeypatch.setattr(gate, "reject_if_live_forbidden", lambda *args, **kwargs: None)

    await scanner._execute_triggered_setup(
        {
            **_orb_setup(strategy="mean_reversion"),
            "direction": "short",
            "stop_loss": 157.50,
            "take_profit": 135.00,
        }
    )

    assert stub_side_effects["place_order_calls"] == [
        {
            "symbol": "AAPL",
            "qty": 10,
            "side": "sell",
            "strategy": "mean_reversion",
        }
    ]
    assert stub_side_effects["ledger_entries"][0]["side"] == "short"


@pytest.mark.asyncio
async def test_scanner_refuses_when_global_halt_active(
    paper_armed: None,
    stub_side_effects: dict[str, list],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Realtime scanner must honor the same global halt as manual orders."""
    import data.ingestion.realtime_scanner as scanner
    from api.routes import trades as trades_mod
    import core.trading_gate as gate

    async def _liquid_ok(symbol: str, price: float) -> tuple[bool, str | None]:
        return True, None

    async def _halted() -> bool:
        return True

    monkeypatch.setattr(scanner, "_liquidity_filters_ok", _liquid_ok)
    monkeypatch.setattr(gate, "reject_if_live_forbidden", lambda *args, **kwargs: None)
    monkeypatch.setattr(trades_mod, "_is_trading_halted", _halted)

    await scanner._execute_triggered_setup(_orb_setup(strategy="mean_reversion"))

    assert stub_side_effects["place_order_calls"] == []
    assert stub_side_effects["ledger_entries"] == []
