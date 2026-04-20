"""Live-gate coverage for the daily pipeline's order-submission paths.

Wave 2F / persona-78 gap #1 sub-item: ``daily_pipeline._place_order`` and
``daily_pipeline._place_bracket_order`` are two of the six bypass paths
Wave A wired into ``core.trading_gate.reject_if_live_forbidden``. Neither
had a test that proved the gate actually fired from the pipeline. This
module fills that gap.

We drive the functions directly (no Alpaca, no HTTP). The gate is the
first thing they do — an ``orb`` strategy on a live configuration must
raise ``RuntimeError`` BEFORE the function ever reaches the
``httpx.AsyncClient.post`` call. A regression that moved the gate below
the POST would let the test's fake client record a ``post_called``
signal; we assert that flag stays False.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

# Mirror the other ingestion tests' sys.path bootstrap so ``from core.*``
# imports resolve in isolation.
BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture
def live_armed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force URL=live AND LIVE_TRADING_ENABLED=True so the gate fires.

    This is the only configuration in which the per-strategy deny-list
    is active. On paper URLs or with the env flag off, the gate is a
    no-op — those configurations are covered by the core trading-gate
    tests under ``backend/core/tests/test_trading_gate.py``.
    """
    from core import config as core_config

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)


class _PostProbe:
    """Stand-in for the ``httpx.AsyncClient`` the pipeline receives.

    ``post_called`` is the canary: the gate must refuse BEFORE the POST,
    so this flag must stay False on every denied call. If a refactor
    ever reverses the ordering, ``post_called`` goes True and the test
    fails with a clear message.
    """

    def __init__(self) -> None:
        self.post_called = False

    async def post(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover
        self.post_called = True
        raise AssertionError(
            "SECURITY: live-gate bypass — pipeline POSTed to broker despite "
            "strategy=orb on a live configuration."
        )


@pytest.mark.asyncio
async def test_place_order_rejects_orb_on_live(live_armed: None) -> None:
    """``_place_order(strategy='orb')`` on a live config must raise."""
    from data.ingestion.daily_pipeline import _place_order

    probe = _PostProbe()
    with pytest.raises(RuntimeError, match="denylist"):
        await _place_order(probe, "AAPL", 10, "buy", strategy="orb")
    assert probe.post_called is False


@pytest.mark.asyncio
async def test_place_bracket_order_rejects_orb_on_live(live_armed: None) -> None:
    """Bracket variant — separate code path, same gate. Wave-A covered both."""
    from data.ingestion.daily_pipeline import _place_bracket_order

    probe = _PostProbe()
    with pytest.raises(RuntimeError, match="denylist"):
        await _place_bracket_order(
            probe, "AAPL", 10, stop_price=140.0, take_profit_price=160.0, strategy="orb",
        )
    assert probe.post_called is False


@pytest.mark.asyncio
async def test_place_order_rejects_paper_only_kama_on_live(live_armed: None) -> None:
    """``kama_breakout`` is on the paper-only list; also refused live."""
    from data.ingestion.daily_pipeline import _place_order

    probe = _PostProbe()
    with pytest.raises(RuntimeError, match="paper-only"):
        await _place_order(probe, "AAPL", 10, "buy", strategy="kama_breakout")
    assert probe.post_called is False


@pytest.mark.asyncio
async def test_place_order_rejects_unknown_strategy_on_live(live_armed: None) -> None:
    """Spoofed strategy name (``orbx``) is rejected with the unknown-strategy
    message — this is the persona-66 allowlist-bypass fix in its pipeline form.
    """
    from data.ingestion.daily_pipeline import _place_order

    probe = _PostProbe()
    with pytest.raises(RuntimeError, match="unknown strategy"):
        await _place_order(probe, "AAPL", 10, "buy", strategy="orbx")
    assert probe.post_called is False


@pytest.mark.asyncio
async def test_place_order_passes_allowed_strategy_on_paper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Paper config — the gate does NOT fire even for denylisted strategies.

    The deny-list exists to keep ``orb`` off LIVE capital; paper routing
    is explicitly permitted so strategies can keep accumulating evidence.
    """
    from core import config as core_config

    # Force URL=paper so the gate is disarmed.
    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: False)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", False, raising=False)

    # Stub out httpx so we don't have to stand up an Alpaca mock — we
    # only need to prove that the gate did NOT raise, i.e. control flow
    # reached the POST.
    from data.ingestion import daily_pipeline as pipeline_mod

    post_log: list[str] = []

    class _PaperPostOK:
        async def post(self, *args: Any, **kwargs: Any) -> Any:
            post_log.append("ok")

            class _R:
                status_code = 200

                @staticmethod
                def json() -> dict:
                    return {"id": "broker-1"}

                @staticmethod
                def raise_for_status() -> None:
                    return None

            return _R()

    # Prevent the helper from trying to validate the base URL against
    # ``settings.ALPACA_BASE_URL``; the test patched the host-check above.
    monkeypatch.setattr(pipeline_mod, "_base_url", lambda: "https://paper-api.alpaca.markets")
    monkeypatch.setattr(pipeline_mod, "_alpaca_headers", lambda: {})

    await pipeline_mod._place_order(
        _PaperPostOK(), "AAPL", 10, "buy", strategy="orb",
    )
    assert post_log == ["ok"]
