"""B-29 regression test — ClaudeClient.complete emits a structured
`claude_call` log line with input/output tokens + USD cost, and records
caller-supplied context fields (symbol, endpoint, user_id, …).

We don't hit the real Anthropic API; we stub ``messages.create`` with a
fake response that carries a `usage` object matching the SDK shape.
"""
from __future__ import annotations

import logging
import json
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

    # Haiku: conservative 1.00 + 5.00 per 1M estimate
    assert _estimate_cost_usd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000) == pytest.approx(6.00)
    # Sonnet: 3 + 15
    assert _estimate_cost_usd("claude-sonnet-4-6", 1_000_000, 1_000_000) == pytest.approx(18.00)
    # Opus: 15 + 75
    assert _estimate_cost_usd("claude-opus-4-7", 1_000_000, 1_000_000) == pytest.approx(90.00)


# ─── B-30 timeout tests ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_complete_raises_claude_timeout_on_deadline(caplog):
    """Hung Anthropic → ClaudeTimeoutError after the configured deadline,
    not the SDK's 600s default. Semaphore must be released (next caller
    can proceed)."""
    import asyncio as _aio
    from agents import claude_client

    async def _hang(*_a, **_k):
        await _aio.sleep(5)  # longer than our 0.1s test deadline

    with patch.object(claude_client.settings, "ANTHROPIC_API_KEY") as key_attr:
        key_attr.get_secret_value.return_value = "sk-test"
        with patch("anthropic.AsyncAnthropic") as mock_anthropic:
            mock_anthropic.return_value.messages.create = _hang
            client = claude_client.ClaudeClient()
            with caplog.at_level(logging.WARNING, logger="agents.claude_client"):
                with pytest.raises(claude_client.ClaudeTimeoutError):
                    await client.complete(
                        system="sys", user="usr", model="opus",
                        timeout=0.1,
                        context={"symbol": "NVDA"},
                    )

    timeout_events = [r for r in caplog.records if getattr(r, "status", None) == "timeout"]
    assert len(timeout_events) == 1
    assert timeout_events[0].symbol == "NVDA"
    assert timeout_events[0].timeout_s == 0.1


def test_claude_timeout_is_subclass_of_timeouterror():
    """Existing broad try/except TimeoutError handlers keep working."""
    from agents.claude_client import ClaudeTimeoutError
    assert issubclass(ClaudeTimeoutError, TimeoutError)


@pytest.mark.asyncio
async def test_complete_writes_opt_in_raw_audit_log(tmp_path, monkeypatch):
    """When explicitly enabled, every ClaudeClient call writes a JSONL
    request/response record while redacting secret-looking strings."""
    from agents import claude_client

    fake_resp = types.SimpleNamespace(
        content=[types.SimpleNamespace(text="assistant response")],
        usage=types.SimpleNamespace(input_tokens=10, output_tokens=5),
        model="claude-opus-4-7",
        stop_reason="end_turn",
    )

    monkeypatch.setattr(claude_client.settings, "CLAUDE_AUDIT_LOG_ENABLED", True)
    monkeypatch.setattr(claude_client.settings, "CLAUDE_AUDIT_LOG_DIR", str(tmp_path))
    monkeypatch.setattr(claude_client.settings, "CLAUDE_AUDIT_LOG_MAX_CHARS", 200000)

    with patch.object(claude_client.settings, "ANTHROPIC_API_KEY") as key_attr:
        key_attr.get_secret_value.return_value = "sk-test"
        with patch("anthropic.AsyncAnthropic") as mock_anthropic:
            mock_anthropic.return_value.messages.create = AsyncMock(return_value=fake_resp)
            client = claude_client.ClaudeClient()
            out = await client.complete(
                system="system prompt with fake key sk-ant-api03-SECRETSECRET",
                user="user prompt",
                model="opus",
                max_tokens=123,
                context={"endpoint": "test.audit"},
            )

    assert out == "assistant response"
    files = list(tmp_path.glob("claude-*.jsonl"))
    assert len(files) == 1
    raw = files[0].read_text(encoding="utf-8")
    assert "sk-ant-api03-SECRETSECRET" not in raw
    record = json.loads(raw.splitlines()[0])
    assert record["status"] == "success"
    assert record["context"]["endpoint"] == "test.audit"
    assert record["request"]["max_tokens"] == 123
    assert record["request"]["messages"][0]["content"] == "user prompt"
    assert record["response"]["content"] == "assistant response"
