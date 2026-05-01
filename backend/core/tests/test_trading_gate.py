"""Tests for the centralized trading gate (Wave-A bypass-path fix).

The previous implementation lived inline in ``backend/api/routes/trades.py``
and was only applied to ``POST /api/v1/trades/orders``. Personas 66/67/69
flagged that every other order-submission path bypassed the gate. The
canonical implementation now lives in ``backend/core/trading_gate.py`` and
is exercised by all six bypass paths (HTTP, agent, daily pipeline, scanner,
MCP broker, webhook).

This module covers:

* ``canonical_strategy_name`` allowlist semantics.
* ``reject_if_live_forbidden`` HTTP context (raises HTTPException).
* ``reject_if_live_forbidden`` non-HTTP context (raises RuntimeError).
* ``LIVE_TRADING_ENABLED`` × URL-host gating matrix.
* ``assert_live_enabled_or_paper`` boot-time misconfig check.
* ``is_live_alpaca_base_url`` exact-host match (Wave-A).
* Audit-log emission on rejection.
"""

from __future__ import annotations

import logging

import pytest
from fastapi import HTTPException

from core import config as core_config
from core import trading_gate
from core.trading_gate import (
    assert_live_enabled_or_paper,
    canonical_strategy_name,
    reject_if_live_forbidden,
)


# --------------------------------------------------------------------------- #
# canonical_strategy_name                                                     #
# --------------------------------------------------------------------------- #


def test_canonical_name_none() -> None:
    assert canonical_strategy_name(None) is None


def test_canonical_name_blank() -> None:
    assert canonical_strategy_name("") is None
    assert canonical_strategy_name("   ") is None


def test_canonical_name_known_canonical() -> None:
    assert canonical_strategy_name("orb") == "orb"
    assert canonical_strategy_name("kama_breakout") == "kama_breakout"
    assert canonical_strategy_name("pairs_trading") == "pairs_trading"


def test_canonical_name_hyphen_id() -> None:
    assert canonical_strategy_name("vrp-harvesting") == "vrp_harvest"
    assert canonical_strategy_name("pairs-stat-arb") == "pairs_trading"
    assert canonical_strategy_name("kama-breakout") == "kama_breakout"


def test_canonical_name_unknown_raises() -> None:
    # The allowlist must reject any token that isn't a known canonical or
    # mapped hyphen-id. This is the fix for the persona-66 spoofing vector.
    with pytest.raises(ValueError, match="unknown strategy"):
        canonical_strategy_name("orbx")
    with pytest.raises(ValueError, match="unknown strategy"):
        canonical_strategy_name("orb-sniper")
    with pytest.raises(ValueError, match="unknown strategy"):
        canonical_strategy_name("totally-fake-strategy")


def test_canonical_name_normalizes_case_and_whitespace() -> None:
    assert canonical_strategy_name("  ORB  ") == "orb"
    assert canonical_strategy_name("ORB") == "orb"
    # Spaces collapse to hyphen so "vrp harvesting" maps too.
    assert canonical_strategy_name("vrp harvesting") == "vrp_harvest"


# --------------------------------------------------------------------------- #
# reject_if_live_forbidden — HTTP context                                     #
# --------------------------------------------------------------------------- #


@pytest.fixture
def live_active(monkeypatch: pytest.MonkeyPatch) -> None:
    """URL=live + LIVE_TRADING_ENABLED=True so the gate is *armed*."""
    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)


def test_http_gate_rejects_orb_with_422(live_active: None) -> None:
    with pytest.raises(HTTPException) as excinfo:
        reject_if_live_forbidden("orb", caller="test")
    assert excinfo.value.status_code == 422
    assert "denylist" in excinfo.value.detail


def test_http_gate_rejects_kama_breakout_with_422(live_active: None) -> None:
    with pytest.raises(HTTPException) as excinfo:
        reject_if_live_forbidden("kama_breakout", caller="test")
    assert excinfo.value.status_code == 422
    assert "paper-only" in excinfo.value.detail


def test_http_gate_rejects_unknown_strategy_with_400(live_active: None) -> None:
    with pytest.raises(HTTPException) as excinfo:
        reject_if_live_forbidden("orbx", caller="test")
    assert excinfo.value.status_code == 400


def test_http_gate_allows_manual_none(live_active: None) -> None:
    # Manual orders skip the gate even when live is armed.
    reject_if_live_forbidden(None, caller="test")


def test_http_gate_allows_non_denylisted_strategy_on_live(live_active: None) -> None:
    # A canonical strategy that isn't on either deny-list must pass.
    # ``pead`` is autonomous and not in PAPER_ONLY — kept stable as the
    # canonical "this-strategy-is-allowed" probe; ``vrp_harvest`` was the
    # original probe but it now lives in LIVE_DISABLED via the auto-derive
    # rule (kind="research") (Round-6 / I-2).
    reject_if_live_forbidden("pead", caller="test")


# --------------------------------------------------------------------------- #
# reject_if_live_forbidden — non-HTTP context                                 #
# --------------------------------------------------------------------------- #


def test_non_http_gate_raises_runtimeerror_for_orb(live_active: None) -> None:
    # The pipeline / scanner / MCP / agent paths run outside FastAPI and
    # cannot raise HTTPException. Verify they get a plain RuntimeError.
    with pytest.raises(RuntimeError) as excinfo:
        reject_if_live_forbidden("orb", caller="test", http_context=False)
    assert "denylist" in str(excinfo.value)


def test_non_http_gate_raises_runtimeerror_for_unknown(live_active: None) -> None:
    with pytest.raises(RuntimeError) as excinfo:
        reject_if_live_forbidden("orbx", caller="test", http_context=False)
    assert "unknown strategy" in str(excinfo.value)


def test_non_http_gate_allows_manual_none(live_active: None) -> None:
    reject_if_live_forbidden(None, caller="test", http_context=False)


# --------------------------------------------------------------------------- #
# LIVE_TRADING_ENABLED × URL gating matrix                                    #
# --------------------------------------------------------------------------- #


def test_gate_disarmed_when_env_false(monkeypatch: pytest.MonkeyPatch) -> None:
    # URL=live but env=False → the per-strategy gate does NOT fire.
    # ``_submit_to_broker`` and ``assert_live_enabled_or_paper`` catch the
    # misconfig elsewhere; the per-strategy gate itself is gated on intent.
    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", False, raising=False)
    reject_if_live_forbidden("orb", caller="test")
    reject_if_live_forbidden("kama_breakout", caller="test")


def test_gate_disarmed_when_url_paper(monkeypatch: pytest.MonkeyPatch) -> None:
    # URL=paper + env=True (or False) → unconditionally allow.
    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: False)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)
    reject_if_live_forbidden("orb", caller="test")
    reject_if_live_forbidden("kama_breakout", caller="test")


def test_gate_armed_only_when_both_say_live(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)
    with pytest.raises(HTTPException):
        reject_if_live_forbidden("orb", caller="test")


# --------------------------------------------------------------------------- #
# assert_live_enabled_or_paper                                                #
# --------------------------------------------------------------------------- #


def test_assert_passes_paper_paper(monkeypatch: pytest.MonkeyPatch) -> None:
    # URL=paper + env=False → consistent paper config, no raise.
    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: False)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", False, raising=False)
    assert_live_enabled_or_paper()


def test_assert_passes_live_live(monkeypatch: pytest.MonkeyPatch) -> None:
    # URL=live + env=True → consistent live config, no raise.
    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)
    assert_live_enabled_or_paper()


def test_assert_raises_on_env_true_url_paper(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: False)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)
    with pytest.raises(RuntimeError, match="Misconfig"):
        assert_live_enabled_or_paper()


def test_assert_raises_on_url_live_env_false(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", False, raising=False)
    with pytest.raises(RuntimeError, match="Misconfig"):
        assert_live_enabled_or_paper()


# --------------------------------------------------------------------------- #
# is_live_alpaca_base_url — exact host match (Wave-A)                         #
# --------------------------------------------------------------------------- #


def test_is_live_url_canonical_live() -> None:
    assert core_config.is_live_alpaca_base_url("https://api.alpaca.markets") is True
    assert core_config.is_live_alpaca_base_url("https://api.alpaca.markets/v2") is True


def test_is_live_url_canonical_paper() -> None:
    assert core_config.is_live_alpaca_base_url("https://paper-api.alpaca.markets") is False
    assert core_config.is_live_alpaca_base_url("https://paper-api.alpaca.markets/v2") is False


def test_is_live_url_substring_attack_does_not_match() -> None:
    # Wave-A: substring-based check would have flagged this as live because
    # it contains "api.alpaca.markets" in the path. Exact-host match must
    # treat it as not-live (the netloc is the attacker's host).
    assert core_config.is_live_alpaca_base_url(
        "https://attacker.example.com/api.alpaca.markets/v2"
    ) is False


def test_is_live_url_path_appended_does_not_break_match() -> None:
    # ``api.alpaca.markets/?route=paper`` previously bypassed the substring
    # check (it contains "paper") and was treated as paper. Exact-host now
    # correctly classifies it as live.
    assert core_config.is_live_alpaca_base_url(
        "https://api.alpaca.markets/?route=paper"
    ) is True


def test_is_live_url_unknown_host_treated_as_not_live() -> None:
    # Mock / staging / sandbox URLs are not live.
    assert core_config.is_live_alpaca_base_url("https://alpaca-mock.internal") is False
    assert core_config.is_live_alpaca_base_url("https://staging.alpaca.markets") is False


def test_is_live_url_empty_treated_as_not_live() -> None:
    assert core_config.is_live_alpaca_base_url("") is False


def test_is_live_url_port_ignored() -> None:
    # Port numbers in the netloc (alpaca:443) must not break the match.
    assert core_config.is_live_alpaca_base_url("https://api.alpaca.markets:443/v2") is True


# --------------------------------------------------------------------------- #
# Audit-log emission (Wave A scope: log only, DB audit owned by Wave B)      #
# --------------------------------------------------------------------------- #


def test_reject_emits_warning_log(
    live_active: None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger=trading_gate.logger.name):
        with pytest.raises(HTTPException):
            reject_if_live_forbidden(
                "orb",
                caller="test.live_audit",
                username="alice",
            )
    rejects = [r for r in caplog.records if r.message == "live_gate_reject"]
    assert rejects, "expected a live_gate_reject warning"
    rec = rejects[0]
    assert getattr(rec, "strategy", None) == "orb"
    assert getattr(rec, "caller", None) == "test.live_audit"
    assert getattr(rec, "reason", None) == "paper_only"
    assert getattr(rec, "username", None) == "alice"


def test_unknown_strategy_emits_warning_log(
    live_active: None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger=trading_gate.logger.name):
        with pytest.raises(HTTPException):
            reject_if_live_forbidden(
                "orbx",
                caller="test.unknown_audit",
                username="bob",
            )
    rejects = [r for r in caplog.records if r.message == "live_gate_reject"]
    assert rejects, "expected a live_gate_reject warning for unknown strategy"
    assert getattr(rejects[0], "reason", None) == "unknown_strategy"


def test_manual_skip_emits_info_log(
    live_active: None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.INFO, logger=trading_gate.logger.name):
        reject_if_live_forbidden(None, caller="test.manual")
    info = [r for r in caplog.records if "strategy=None" in r.message]
    assert info, "expected an INFO log for the None-strategy skip"
