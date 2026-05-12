"""Iter-28: regression tests for the four earnings-screener cache TTL knobs
promoted from hardcoded module constants in
``services.earnings_screener`` to ``core.config.Settings``.

Goals:
  * defaults match the historic hardcoded numbers (120 / 30 / 3600 / 900)
  * an env-var override is honoured by a freshly-instantiated ``Settings``
  * the in-module ``_*_cache_ttl_s()`` helpers read settings at call time
    so a monkeypatched value flows through to call sites

Pattern mirrors ``backend/tests/test_config.py`` (Batch U scalars).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Match the import-path bootstrap used by other backend service tests so
# the file can run from repo root or backend/ directly.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_BACKEND = _REPO_ROOT / "backend"
for p in (_REPO_ROOT, _BACKEND):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))


# ---------------------------------------------------------------------------
# Defaults — must equal the previous hardcoded values byte-for-byte.
# ---------------------------------------------------------------------------


def test_default_market_regime_cache_ttl_seconds_is_120() -> None:
    from core.config import Settings

    assert Settings().MARKET_REGIME_CACHE_TTL_SECONDS == 120


def test_default_market_regime_error_cache_ttl_seconds_is_30() -> None:
    from core.config import Settings

    assert Settings().MARKET_REGIME_ERROR_CACHE_TTL_SECONDS == 30


def test_default_pt_changes_cache_ttl_seconds_is_3600() -> None:
    from core.config import Settings

    assert Settings().PT_CHANGES_CACHE_TTL_SECONDS == 3600


def test_default_news_sentiment_cache_ttl_seconds_is_900() -> None:
    from core.config import Settings

    assert Settings().NEWS_SENTIMENT_CACHE_TTL_SECONDS == 900


# ---------------------------------------------------------------------------
# Env-var overrides — a freshly-built Settings picks up the env value.
# ---------------------------------------------------------------------------


def test_env_override_market_regime_cache_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MARKET_REGIME_CACHE_TTL_SECONDS", "60")
    from core.config import Settings

    assert Settings().MARKET_REGIME_CACHE_TTL_SECONDS == 60


def test_env_override_market_regime_error_cache_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MARKET_REGIME_ERROR_CACHE_TTL_SECONDS", "15")
    from core.config import Settings

    assert Settings().MARKET_REGIME_ERROR_CACHE_TTL_SECONDS == 15


def test_env_override_pt_changes_cache_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PT_CHANGES_CACHE_TTL_SECONDS", "1800")
    from core.config import Settings

    assert Settings().PT_CHANGES_CACHE_TTL_SECONDS == 1800


def test_env_override_news_sentiment_cache_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEWS_SENTIMENT_CACHE_TTL_SECONDS", "450")
    from core.config import Settings

    assert Settings().NEWS_SENTIMENT_CACHE_TTL_SECONDS == 450


# ---------------------------------------------------------------------------
# Helpers read the live ``settings`` singleton at call time.
#
# The earnings_screener module exposes thin ``_*_cache_ttl_s()`` helpers
# that re-read ``core.config.settings`` on every invocation. A
# monkeypatch on the singleton must flow through to those helpers so a
# runtime knob can be tuned without re-importing the module.
# ---------------------------------------------------------------------------


def test_market_regime_ttl_helper_reads_settings_at_call_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import services.earnings_screener as es
    from core.config import settings

    monkeypatch.setattr(settings, "MARKET_REGIME_CACHE_TTL_SECONDS", 77)
    assert es._market_regime_cache_ttl_s() == 77


def test_market_regime_error_ttl_helper_reads_settings_at_call_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import services.earnings_screener as es
    from core.config import settings

    monkeypatch.setattr(settings, "MARKET_REGIME_ERROR_CACHE_TTL_SECONDS", 11)
    assert es._market_regime_error_cache_ttl_s() == 11


def test_pt_changes_ttl_helper_reads_settings_at_call_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import services.earnings_screener as es
    from core.config import settings

    monkeypatch.setattr(settings, "PT_CHANGES_CACHE_TTL_SECONDS", 7200)
    assert es._pt_changes_cache_ttl_s() == 7200


def test_news_sentiment_ttl_helper_reads_settings_at_call_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import services.earnings_screener as es
    from core.config import settings

    monkeypatch.setattr(settings, "NEWS_SENTIMENT_CACHE_TTL_SECONDS", 333)
    assert es._news_sentiment_cache_ttl_s() == 333
