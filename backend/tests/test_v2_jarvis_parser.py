"""B.7 — Jarvis intent parser tests.

Pins the rule-based parser's grammar so future changes (or the
Phase 2 Anthropic-backed swap) can't accidentally regress the
known-good prompts. Per the B.7 risk register: the registry is
frozen + the parser cannot invent actions; we validate every
known case here.
"""
from __future__ import annotations

import pytest


def test_parser_known_prompts() -> None:
    from agents.jarvis import parse_intent

    table = [
        ("halt trades on NVDA", ("trade_halt", "halt", {"symbol": "NVDA"})),
        ("halt trading", ("trade_halt", "halt", {"all": True})),
        ("resume trading", ("trade_halt", "resume", {"all": True})),
        ("pause ingest stage", ("pipeline_stage", "pause", {"stage": "ingest"})),
        ("pause execution", ("pipeline_stage", "pause", {"stage": "execute"})),
        ("resume risk gate", ("pipeline_stage", "resume", {"stage": "risk"})),
        ("pause research agent", ("agent", "pause", {"archetype": "research"})),
        ("rotate Anthropic key", ("key", "rotate", {"provider": "anthropic"})),
        ("trigger deploy to staging", ("deploy", "trigger", {"env": "staging"})),
        ("deploy to prod", ("deploy", "trigger", {"env": "prod"})),
    ]
    for prompt, (mod, action, scope_subset) in table:
        spec = parse_intent(prompt)
        assert spec is not None, f"failed to parse: {prompt!r}"
        assert spec.module == mod, f"{prompt!r}: module {spec.module!r} ≠ {mod!r}"
        assert spec.action == action, f"{prompt!r}: action {spec.action!r} ≠ {action!r}"
        for k, v in scope_subset.items():
            assert spec.scope.get(k) == v, f"{prompt!r}: scope.{k}={spec.scope.get(k)!r} ≠ {v!r}"


def test_parser_unrecognized_prompt() -> None:
    from agents.jarvis import parse_intent

    assert parse_intent("hello world") is None
    assert parse_intent("") is None
    assert parse_intent("   ") is None


def test_intent_spec_rejects_unknown_module() -> None:
    """The frozen registry must reject invented modules."""
    from agents.jarvis import IntentSpec

    with pytest.raises(ValueError, match="Unknown module"):
        IntentSpec(module="exfiltrate_keys", action="run", scope={}, params={})


def test_intent_spec_rejects_unknown_action() -> None:
    from agents.jarvis import IntentSpec

    with pytest.raises(ValueError, match="Unknown action"):
        IntentSpec(module="trade_halt", action="liquidate", scope={}, params={})


def test_dry_run_diff_includes_audit_event() -> None:
    from agents.jarvis import dry_run_diff, parse_intent

    spec = parse_intent("halt trades on NVDA")
    assert spec is not None
    diff = dry_run_diff(spec)
    assert diff["audit_event"] == "halt_toggled"
    assert "NVDA" in diff["would"]
    assert diff["destructive"] is True


def test_set_spend_cap_extracts_dollar_amount() -> None:
    from agents.jarvis import parse_intent

    spec = parse_intent("set research agent spend cap to 75")
    assert spec is not None
    assert spec.module == "agent"
    assert spec.action == "set_spend_cap"
    assert spec.scope == {"archetype": "research"}
    assert spec.params == {"daily_spend_cap_usd": 75.0}
