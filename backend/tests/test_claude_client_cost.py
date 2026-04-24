"""B-29 regression test — ClaudeClient.complete emits a structured
`claude_call` log line with input/output tokens + USD cost, and records
caller-supplied context fields (symbol, endpoint, user_id, …).

We don't hit the real Anthropic API; we stub ``messages.create`` with a
fake response that carries a `usage` object matching the SDK shape.
"""
from __future__ import annotations

import logging
import types
from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_complete_emits_claude_call_log_with_cost_and_context(caplog):
    from agents import claude_client

    fake_resp = types.SimpleNamespace(
        content=[types.SimpleNamespace(text="ok")],
        usage=types.SimpleNamespace(input_tokens=150, output_tokens=80),
    )

    with patch.object(claude_client.settings, "ANTHROPIC_API_KEY") as key_attr:
        key_attr.get_secret_value.return_value = "sk-test"
        with patch("anthropic.AsyncAnthropic") as mock_anthropic:
            mock_anthropic.return_value.messages.create = AsyncMock(return_value=fake_resp)
            client = claude_client.ClaudeClient()
            with caplog.at_level(logging.INFO, logger="agents.claude_client"):
                out = await client.complete(
                    system="sys", user="usr", model="opus",
                    context={"symbol": "NVDA", "endpoint": "earnings.full_research"},
                )

    assert out == "ok"
    events = [r for r in caplog.records if getattr(r, "event", None) == "claude_call"]
    assert len(events) == 1, f"expected one claude_call event, got {events}"
    rec = events[0]
    assert rec.model == "claude-opus-4-7"
    assert rec.input_tokens == 150
    assert rec.output_tokens == 80
    # Opus pricing: 150 * 15 / 1e6 + 80 * 75 / 1e6 = 0.00225 + 0.006 = 0.00825
    assert rec.cost_usd == pytest.approx(0.00825, abs=1e-6)
    assert rec.symbol == "NVDA"
    assert rec.endpoint == "earnings.full_research"


def test_pricing_fallback_overestimates_for_unknown_model():
    from agents.claude_client import _estimate_cost_usd

    # 1M input + 1M output tokens on an unknown model → Opus-rate fallback
    cost = _estimate_cost_usd("future-claude-9", 1_000_000, 1_000_000)
    assert cost == pytest.approx(15.00 + 75.00, abs=0.01)


def test_pricing_known_models():
    from agents.claude_client import _estimate_cost_usd

    # Haiku: 0.80 + 4.00 per 1M
    assert _estimate_cost_usd("claude-haiku-4-7", 1_000_000, 1_000_000) == pytest.approx(4.80)
    # Sonnet: 3 + 15
    assert _estimate_cost_usd("claude-sonnet-4-7", 1_000_000, 1_000_000) == pytest.approx(18.00)
    # Opus: 15 + 75
    assert _estimate_cost_usd("claude-opus-4-7", 1_000_000, 1_000_000) == pytest.approx(90.00)
