"""Tests for the Wave 2H operator-owned deny-list (persona-76 P76-7).

Covers:

* ``is_restricted`` — truthy check, case-insensitive, whitespace-safe.
* ``assert_not_restricted`` — raises ``ValueError`` on hit, silent on miss.
* ``_normalise`` — ticker canonicalisation.
* Env-var loading — comma-separated ``RESTRICTED_SYMBOLS`` populates the
  frozenset at import.
* File loading — JSON list, JSON object with ``symbols`` key.
* Both sources union without duplication.
* Empty / malformed inputs fail safe to "gate does not fire".
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from core import compliance


# --------------------------------------------------------------------------- #
# is_restricted / assert_not_restricted                                       #
# --------------------------------------------------------------------------- #


def _patch_set(monkeypatch: pytest.MonkeyPatch, symbols: set[str]) -> None:
    """Swap the module-level frozenset so a single test sees its own list."""
    monkeypatch.setattr(compliance, "RESTRICTED_SYMBOLS", frozenset(symbols))


def test_is_restricted_true_for_listed(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_set(monkeypatch, {"GME", "AMC"})
    assert compliance.is_restricted("GME") is True
    assert compliance.is_restricted("AMC") is True


def test_is_restricted_false_for_unlisted(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_set(monkeypatch, {"GME"})
    assert compliance.is_restricted("AAPL") is False


def test_is_restricted_case_insensitive(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_set(monkeypatch, {"GME"})
    assert compliance.is_restricted("gme") is True
    assert compliance.is_restricted("Gme") is True
    assert compliance.is_restricted("GmE") is True


def test_is_restricted_strips_whitespace(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_set(monkeypatch, {"GME"})
    assert compliance.is_restricted("  GME ") is True
    assert compliance.is_restricted("\tGME\n") is True


def test_is_restricted_none_returns_false(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_set(monkeypatch, {"GME"})
    assert compliance.is_restricted(None) is False


def test_is_restricted_empty_returns_false(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_set(monkeypatch, {"GME"})
    assert compliance.is_restricted("") is False
    assert compliance.is_restricted("   ") is False


def test_assert_not_restricted_raises_for_listed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_set(monkeypatch, {"GME"})
    with pytest.raises(ValueError, match="restricted symbol"):
        compliance.assert_not_restricted("GME")


def test_assert_not_restricted_silent_for_unlisted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_set(monkeypatch, {"GME"})
    # Must return None / not raise
    compliance.assert_not_restricted("AAPL")


def test_assert_not_restricted_case_insensitive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_set(monkeypatch, {"AMC"})
    with pytest.raises(ValueError):
        compliance.assert_not_restricted("amc")


def test_assert_not_restricted_error_message_normalises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The error message should show the canonical upper-case form even if
    # the caller passed something messy.
    _patch_set(monkeypatch, {"GME"})
    with pytest.raises(ValueError, match="GME"):
        compliance.assert_not_restricted("  gme ")


# --------------------------------------------------------------------------- #
# _normalise                                                                  #
# --------------------------------------------------------------------------- #


def test_normalise_uppercases() -> None:
    assert compliance._normalise("gme") == "GME"


def test_normalise_strips_whitespace() -> None:
    assert compliance._normalise("  gme ") == "GME"


# --------------------------------------------------------------------------- #
# Env-var loading via settings.RESTRICTED_SYMBOLS                             #
# --------------------------------------------------------------------------- #


def test_env_var_comma_separated_populates_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import config as core_config

    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS", "GME,AMC,BBBY", raising=False,
    )
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS_FILE", "", raising=False,
    )
    compliance._reload_for_tests()
    assert "GME" in compliance.RESTRICTED_SYMBOLS
    assert "AMC" in compliance.RESTRICTED_SYMBOLS
    assert "BBBY" in compliance.RESTRICTED_SYMBOLS


def test_env_var_tolerates_whitespace_around_commas(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import config as core_config

    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS", " GME , AMC , BBBY ", raising=False,
    )
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS_FILE", "", raising=False,
    )
    compliance._reload_for_tests()
    assert compliance.RESTRICTED_SYMBOLS == frozenset({"GME", "AMC", "BBBY"})


def test_env_var_normalises_to_uppercase(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import config as core_config

    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS", "gme,Amc", raising=False,
    )
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS_FILE", "", raising=False,
    )
    compliance._reload_for_tests()
    assert "GME" in compliance.RESTRICTED_SYMBOLS
    assert "AMC" in compliance.RESTRICTED_SYMBOLS
    assert "gme" not in compliance.RESTRICTED_SYMBOLS


def test_env_var_empty_yields_empty_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import config as core_config

    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS", "", raising=False,
    )
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS_FILE", "", raising=False,
    )
    compliance._reload_for_tests()
    assert compliance.RESTRICTED_SYMBOLS == frozenset()
    assert compliance.is_restricted("GME") is False


def test_env_var_filters_empty_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import config as core_config

    # A stray trailing comma must not inject an empty-string entry that
    # would match ``is_restricted("")``.
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS", "GME,,AMC,", raising=False,
    )
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS_FILE", "", raising=False,
    )
    compliance._reload_for_tests()
    assert "" not in compliance.RESTRICTED_SYMBOLS
    assert compliance.RESTRICTED_SYMBOLS == frozenset({"GME", "AMC"})


# --------------------------------------------------------------------------- #
# File loading via settings.RESTRICTED_SYMBOLS_FILE                           #
# --------------------------------------------------------------------------- #


def test_file_loading_json_list(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import config as core_config

    p = tmp_path / "restricted.json"
    p.write_text(json.dumps(["GME", "AMC", "BBBY"]), encoding="utf-8")
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS", "", raising=False,
    )
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS_FILE", str(p), raising=False,
    )
    compliance._reload_for_tests()
    assert compliance.RESTRICTED_SYMBOLS == frozenset({"GME", "AMC", "BBBY"})


def test_file_loading_json_object_with_symbols_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import config as core_config

    p = tmp_path / "restricted.json"
    p.write_text(json.dumps({"symbols": ["GME", "AMC"]}), encoding="utf-8")
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS", "", raising=False,
    )
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS_FILE", str(p), raising=False,
    )
    compliance._reload_for_tests()
    assert compliance.RESTRICTED_SYMBOLS == frozenset({"GME", "AMC"})


def test_file_missing_path_does_not_crash(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import config as core_config

    missing = tmp_path / "does-not-exist.json"
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS", "", raising=False,
    )
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS_FILE", str(missing), raising=False,
    )
    compliance._reload_for_tests()
    # Missing file should fall back to empty set, NOT crash the service.
    assert compliance.RESTRICTED_SYMBOLS == frozenset()


def test_file_plus_env_union(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import config as core_config

    p = tmp_path / "restricted.json"
    p.write_text(json.dumps(["BBBY"]), encoding="utf-8")
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS", "GME,AMC", raising=False,
    )
    monkeypatch.setattr(
        core_config.settings, "RESTRICTED_SYMBOLS_FILE", str(p), raising=False,
    )
    compliance._reload_for_tests()
    # Both sources should merge without duplication.
    assert compliance.RESTRICTED_SYMBOLS == frozenset({"GME", "AMC", "BBBY"})
