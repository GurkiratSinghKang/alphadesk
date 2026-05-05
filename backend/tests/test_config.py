"""Batch U: Settings-class regression tests for ops-tunable scalars
moved out of hardcoded constants in
`audit-reports/2026-05-05/HARDCODING-SWEEP.md`.

Goals: verify defaults, env-var overrides, and that the helper
functions in earnings_screener / earnings_prewarm pick up env
overrides at runtime.
"""
from __future__ import annotations

import pytest


def test_defaults_match_historic_hardcoded_values():
    """Refactor — defaults must equal previous hardcoded values."""
    from core.config import Settings

    s = Settings()
    # A-1 / A-2: IV regime thresholds
    assert s.EARNINGS_IV_RICH_THRESHOLD == 70.0
    assert s.EARNINGS_IV_CHEAP_THRESHOLD == 35.0
    # A-3: Claude opus per-call cost
    assert s.CLAUDE_OPUS_COST_PER_CALL_USD == 0.30
    # A-4 / A-5: FMP cache TTLs
    assert s.FMP_CALENDAR_CACHE_TTL_SECONDS == 300
    assert s.FMP_RESCUE_CACHE_TTL_SECONDS == 300
    # A-6 through A-9: rate-limit caps
    assert s.RATE_LIMIT_FULL_RESEARCH_MAX == 5
    assert s.RATE_LIMIT_FULL_RESEARCH_WINDOW_SECONDS == 600.0
    assert s.RATE_LIMIT_DETAIL_MAX == 30
    assert s.RATE_LIMIT_DETAIL_WINDOW_SECONDS == 600.0
    assert s.RATE_LIMIT_ANALYSIS_PER_IP == 30
    assert s.RATE_LIMIT_ANALYSIS_PER_IP_WINDOW_SECONDS == 60.0
    assert s.RATE_LIMIT_ANALYSIS_GLOBAL == 100
    assert s.RATE_LIMIT_ANALYSIS_GLOBAL_WINDOW_SECONDS == 60.0
    # A-21: greek calc risk-free rate
    assert s.GREEK_CALCULATION_RISK_FREE_RATE == 0.05
    # Batch R follow-up
    assert s.PREWARM_ENABLED is True
    assert s.PREWARM_CLAUDE_ENABLED is True


def test_env_override_iv_rich_threshold(monkeypatch):
    monkeypatch.setenv("EARNINGS_IV_RICH_THRESHOLD", "82.5")
    from core.config import Settings
    assert Settings().EARNINGS_IV_RICH_THRESHOLD == 82.5


def test_env_override_claude_opus_cost(monkeypatch):
    monkeypatch.setenv("CLAUDE_OPUS_COST_PER_CALL_USD", "0.42")
    from core.config import Settings
    assert Settings().CLAUDE_OPUS_COST_PER_CALL_USD == 0.42


def test_env_override_rate_limit_full_research_max(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_FULL_RESEARCH_MAX", "12")
    from core.config import Settings
    assert Settings().RATE_LIMIT_FULL_RESEARCH_MAX == 12


def test_env_override_fmp_calendar_ttl(monkeypatch):
    monkeypatch.setenv("FMP_CALENDAR_CACHE_TTL_SECONDS", "120")
    from core.config import Settings
    assert Settings().FMP_CALENDAR_CACHE_TTL_SECONDS == 120


def test_fmp_ttl_helpers_read_settings_at_call_time(monkeypatch):
    """Helper indirection picks up runtime settings changes."""
    import services.earnings_screener as es
    from core.config import settings

    monkeypatch.setattr(settings, "FMP_CALENDAR_CACHE_TTL_SECONDS", 99)
    monkeypatch.setattr(settings, "FMP_RESCUE_CACHE_TTL_SECONDS", 17)
    assert es._fmp_upcoming_ttl_s() == 99
    assert es._fmp_rescue_ttl_s() == 17


def test_claude_thesis_cost_helper_reads_settings_at_call_time(monkeypatch):
    import services.earnings_prewarm as ep
    from core.config import settings

    monkeypatch.setattr(settings, "CLAUDE_OPUS_COST_PER_CALL_USD", 0.55)
    assert ep._claude_thesis_cost_usd() == 0.55


def test_rate_limit_module_constants_match_settings_defaults():
    from api.routes import _rate_limit
    from core.config import settings

    assert _rate_limit._BUCKET_MAX == settings.RATE_LIMIT_FULL_RESEARCH_MAX
    assert _rate_limit._BUCKET_WINDOW_S == settings.RATE_LIMIT_FULL_RESEARCH_WINDOW_SECONDS
    assert _rate_limit._DETAIL_BUCKET_MAX == settings.RATE_LIMIT_DETAIL_MAX
    assert _rate_limit._DETAIL_BUCKET_WINDOW_S == settings.RATE_LIMIT_DETAIL_WINDOW_SECONDS
    assert _rate_limit._ANALYSIS_BUCKET_MAX == settings.RATE_LIMIT_ANALYSIS_PER_IP
    assert _rate_limit._ANALYSIS_GLOBAL_MAX == settings.RATE_LIMIT_ANALYSIS_GLOBAL
