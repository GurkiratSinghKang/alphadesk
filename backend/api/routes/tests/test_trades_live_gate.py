"""Tests for the Wave 6 hardening of the live-trading strategy gate.

These tests lock in the fixes for A1#3 and A1#11 in
``backend/api/routes/trades.py``:

* ``_canonical_strategy_name`` is an allowlist — unknown strings raise
  ``ValueError`` rather than silently passing through (previously any
  hyphen-free token, e.g. ``"orbx"``, was returned unchanged and slipped
  past the deny-list).
* ``_reject_if_live_forbidden`` translates that ``ValueError`` into an
  HTTP 400 ("unknown strategy"), so an attacker who spoofs a strategy
  name can't bypass the ``STRATEGY_LIVE_DISABLED`` / ``STRATEGY_PAPER_ONLY``
  gates.
* ``strategy=None`` (manual / discretionary order) still short-circuits
  the gate — the canonical name map does not cover manual trades.
* ``pairs-stat-arb`` canonicalizes to ``pairs_trading`` (the frontend
  uses both spellings in different routes).
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from api.routes import trades as trades_mod


# --------------------------------------------------------------------------- #
# _canonical_strategy_name                                                    #
# --------------------------------------------------------------------------- #


def test_canonical_name_accepts_known_canonical_orb() -> None:
    assert trades_mod._canonical_strategy_name("orb") == "orb"


def test_canonical_name_rejects_orb_sniper_variant() -> None:
    # "orb-sniper" is a hyphen-id that is *not* in the allowlist. Previously
    # the function returned None on this input and let the gate treat it as
    # a manual order — a silent bypass. Now it must raise.
    with pytest.raises(ValueError, match="unknown strategy"):
        trades_mod._canonical_strategy_name("orb-sniper")


def test_canonical_name_rejects_orbx_spoof() -> None:
    # "orbx" has no hyphen so the old lax check returned it unchanged. The
    # attacker used that to route past STRATEGY_LIVE_DISABLED={"orb"}. The
    # allowlist must refuse it.
    with pytest.raises(ValueError, match="unknown strategy"):
        trades_mod._canonical_strategy_name("orbx")


def test_canonical_name_allows_none_for_manual_orders() -> None:
    assert trades_mod._canonical_strategy_name(None) is None


def test_canonical_name_blank_string_returns_none() -> None:
    # Empty / whitespace-only input is equivalent to None (no strategy).
    assert trades_mod._canonical_strategy_name("") is None
    assert trades_mod._canonical_strategy_name("   ") is None


def test_canonical_name_pairs_stat_arb_alias() -> None:
    assert trades_mod._canonical_strategy_name("pairs-stat-arb") == "pairs_trading"


def test_canonical_name_pairs_trading_primary_id() -> None:
    assert trades_mod._canonical_strategy_name("pairs-trading") == "pairs_trading"


def test_canonical_name_accepts_canonical_underscore_form() -> None:
    # Already-canonical underscore names in the values set pass through.
    assert trades_mod._canonical_strategy_name("pairs_trading") == "pairs_trading"
    assert trades_mod._canonical_strategy_name("kama_breakout") == "kama_breakout"


# --------------------------------------------------------------------------- #
# _reject_if_live_forbidden                                                   #
# --------------------------------------------------------------------------- #


@pytest.fixture
def force_live_alpaca(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin both gate inputs so the deny-list actually evaluates: the URL check
    must report "live" AND the operator-intent flag ``LIVE_TRADING_ENABLED``
    must be True. Wave-A bypass-fix: the gate now requires BOTH to fire so a
    misconfigured deploy can't accidentally route to live capital. We patch
    the original symbols in ``core.config`` because the centralized gate
    imports them lazily inside the function body."""
    from core import config as core_config

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)


def test_live_gate_rejects_orb_with_422(force_live_alpaca: None) -> None:
    with pytest.raises(HTTPException) as excinfo:
        trades_mod._reject_if_live_forbidden("orb")
    assert excinfo.value.status_code == 422
    assert "denylist" in excinfo.value.detail


def test_live_gate_rejects_kama_breakout_with_422(force_live_alpaca: None) -> None:
    with pytest.raises(HTTPException) as excinfo:
        trades_mod._reject_if_live_forbidden("kama_breakout")
    assert excinfo.value.status_code == 422
    assert "paper-only" in excinfo.value.detail


def test_live_gate_rejects_unknown_strategy_with_400(force_live_alpaca: None) -> None:
    # "orb-sniper" is not on the allowlist — must be 400 (unknown), not 422
    # (denylisted). 422 would confirm to an attacker that ``orb`` specifically
    # is blocked; 400 is the correct "malformed request" response.
    with pytest.raises(HTTPException) as excinfo:
        trades_mod._reject_if_live_forbidden("orb-sniper")
    assert excinfo.value.status_code == 400
    assert "unknown strategy" in excinfo.value.detail


def test_live_gate_rejects_spoofed_orbx_with_400(force_live_alpaca: None) -> None:
    with pytest.raises(HTTPException) as excinfo:
        trades_mod._reject_if_live_forbidden("orbx")
    assert excinfo.value.status_code == 400
    assert "unknown strategy" in excinfo.value.detail


def test_live_gate_allows_manual_order_none(force_live_alpaca: None) -> None:
    # strategy=None is a manual / discretionary order — the catalog gate
    # doesn't apply. Must not raise even when the base URL is live.
    trades_mod._reject_if_live_forbidden(None)


def test_live_gate_logs_skip_for_manual_orders(
    force_live_alpaca: None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Wave 6 requirement: manual-order skips must be captured in the audit log.
    # Wave-A: log line is now emitted by the centralized gate
    # (``core.trading_gate``); the message format is preserved.
    import logging

    with caplog.at_level(logging.INFO, logger="core.trading_gate"):
        trades_mod._reject_if_live_forbidden(None)
    assert any("strategy=None" in rec.message for rec in caplog.records)


# --------------------------------------------------------------------------- #
# Wave-A: LIVE_TRADING_ENABLED gating semantics                               #
# --------------------------------------------------------------------------- #


def test_live_gate_passes_when_env_disabled_url_paper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # LIVE_TRADING_ENABLED=False + URL=paper → unconditionally allow.
    from core import config as core_config

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: False)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", False, raising=False)
    # Even denylisted strategies must pass on paper.
    trades_mod._reject_if_live_forbidden("orb")
    trades_mod._reject_if_live_forbidden("kama_breakout")


def test_live_gate_passes_when_env_disabled_url_live(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # LIVE_TRADING_ENABLED=False + URL=live → operator hasn't opted in to
    # live, so the per-strategy gate doesn't fire. (``_submit_to_broker`` and
    # ``assert_live_enabled_or_paper`` will catch the misconfig elsewhere.)
    from core import config as core_config

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", False, raising=False)
    trades_mod._reject_if_live_forbidden("orb")
    trades_mod._reject_if_live_forbidden("kama_breakout")


def test_live_gate_fires_only_when_env_and_url_both_say_live(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # LIVE_TRADING_ENABLED=True + URL=live + denylisted strategy → 422.
    from core import config as core_config

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)
    with pytest.raises(HTTPException) as excinfo:
        trades_mod._reject_if_live_forbidden("orb")
    assert excinfo.value.status_code == 422


def test_assert_live_enabled_or_paper_raises_on_misconfig_env_no_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # LIVE_TRADING_ENABLED=True but URL is paper → boot-time misconfig.
    from core import config as core_config
    from core.trading_gate import assert_live_enabled_or_paper

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: False)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", True, raising=False)
    with pytest.raises(RuntimeError, match="Misconfig"):
        assert_live_enabled_or_paper()


def test_assert_live_enabled_or_paper_raises_on_misconfig_url_no_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # URL is live but LIVE_TRADING_ENABLED=False → boot-time misconfig.
    from core import config as core_config
    from core.trading_gate import assert_live_enabled_or_paper

    monkeypatch.setattr(core_config, "is_live_alpaca_base_url", lambda url=None: True)
    monkeypatch.setattr(core_config.settings, "LIVE_TRADING_ENABLED", False, raising=False)
    with pytest.raises(RuntimeError, match="Misconfig"):
        assert_live_enabled_or_paper()
