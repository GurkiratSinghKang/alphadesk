from __future__ import annotations

from unittest.mock import patch


def test_base_agent_auto_mode_prefers_api_key_over_cli(monkeypatch):
    from agents import base

    class DummyAgent(base.BaseAgent):
        name = "dummy"

    monkeypatch.setattr(base, "CLAUDE_CLI", "/usr/local/bin/claude")
    monkeypatch.setattr(base.settings, "CLAUDE_BACKEND", "auto")

    with patch.object(base.settings, "ANTHROPIC_API_KEY") as key_attr:
        key_attr.get_secret_value.return_value = "sk-test"
        with patch("anthropic.AsyncAnthropic") as mock_anthropic:
            agent = DummyAgent()

    assert agent._use_cli is False
    assert agent._api_client is mock_anthropic.return_value


def test_claude_runtime_available_respects_forced_api_without_key(monkeypatch):
    from agents import base

    monkeypatch.setattr(base, "CLAUDE_CLI", "/usr/local/bin/claude")
    monkeypatch.setattr(base.settings, "CLAUDE_BACKEND", "api")

    with patch.object(base.settings, "ANTHROPIC_API_KEY") as key_attr:
        key_attr.get_secret_value.return_value = ""
        assert base.claude_runtime_available() is False
