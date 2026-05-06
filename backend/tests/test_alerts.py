"""Tests for ``services.alerts`` — the oncall webhook dispatcher.

Audit P0-5 (STRATEGY-HARDENING-AUDIT 2026-05-05) — the dispatcher must:

* Build correct PagerDuty Events API v2 payloads (routing_key,
  event_action="trigger", severity, dedup_key)
* Suppress repeat alerts within the dedup window
* Silently skip destinations whose URL/key is empty
* Fan-out by severity (P0 → PagerDuty + Discord, P1 → Slack + Discord,
  P2 → Discord only)
* Never propagate destination errors back to the caller (fail-open)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, status_code: int = 200, text: str = "OK") -> None:
        self.status_code = status_code
        self.text = text


class _FakeClient:
    """A drop-in replacement for ``httpx.AsyncClient``.

    Records every ``post`` call on ``cls.calls`` so tests can assert
    the URL + payload shape without going to the network.
    """

    calls: list[tuple[str, dict[str, Any]]] = []
    response_factory = staticmethod(lambda: _FakeResponse(200, "OK"))
    raise_on_post: bool = False

    def __init__(self, **kwargs: Any) -> None:
        # Store kwargs so tests can verify timeout etc. if needed.
        self._kwargs = kwargs

    async def __aenter__(self) -> "_FakeClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    async def post(self, url: str, json: dict[str, Any] | None = None) -> _FakeResponse:
        type(self).calls.append((url, json or {}))
        if type(self).raise_on_post:
            raise RuntimeError("simulated network failure")
        return type(self).response_factory()


def _client_factory(**kw: Any) -> _FakeClient:
    return _FakeClient(**kw)


def _alert(**overrides: Any) -> Any:
    """Build a default :class:`Alert` for the suite."""
    from services.alerts import Alert, AlertSeverity

    base = dict(
        severity=AlertSeverity.P0,
        title="Test alert",
        description="Test description",
        source="test.suite",
        metadata={"foo": "bar"},
        occurred_at=datetime(2026, 5, 5, 12, 0, 0, tzinfo=timezone.utc),
        deduplication_key=None,
    )
    base.update(overrides)
    return Alert(**base)


def _settings_with(
    *,
    pagerduty: str = "",
    discord: str = "",
    slack: str = "",
    generic: str = "",
    dedup: int = 900,
) -> Any:
    """Build a tiny stand-in for the Settings object."""
    s = MagicMock()
    s.ALERT_PAGERDUTY_INTEGRATION_KEY = pagerduty
    s.ALERT_DISCORD_WEBHOOK_URL = discord
    s.ALERT_SLACK_WEBHOOK_URL = slack
    s.ALERT_GENERIC_WEBHOOK_URL = generic
    s.ALERT_DEDUP_WINDOW_SECONDS = dedup
    s.DISCORD_WEBHOOK_URL = ""
    return s


@pytest.fixture(autouse=True)
def _reset_state():
    """Reset the dedup cache + recorded calls before every test."""
    from services.alerts import _reset_dedup_cache_for_tests

    _reset_dedup_cache_for_tests()
    _FakeClient.calls = []
    _FakeClient.raise_on_post = False
    _FakeClient.response_factory = staticmethod(lambda: _FakeResponse(200, "OK"))
    yield
    _reset_dedup_cache_for_tests()
    _FakeClient.calls = []


# ---------------------------------------------------------------------------
# OA-3: PagerDuty payload shape
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pagerduty_payload_shape_p0():
    """P0 alert with dedup key should produce a critical-severity trigger
    with all the canonical Events API v2 fields."""
    from services.alerts import AlertSeverity, fire_alert

    alert = _alert(
        severity=AlertSeverity.P0,
        title="Pipeline down",
        deduplication_key="dpl.run",
        metadata={"equity": 100000.0, "day_pnl": -2500.0},
    )
    settings = _settings_with(
        pagerduty="my-routing-key",
        discord="https://discord.example/wh1",
    )

    await fire_alert(alert, settings_obj=settings, client_factory=_client_factory)

    pd_calls = [
        (url, body) for url, body in _FakeClient.calls
        if url == "https://events.pagerduty.com/v2/enqueue"
    ]
    assert len(pd_calls) == 1
    _, body = pd_calls[0]
    assert body["routing_key"] == "my-routing-key"
    assert body["event_action"] == "trigger"
    assert body["dedup_key"] == "dpl.run"
    payload = body["payload"]
    assert payload["summary"] == "Pipeline down"
    assert payload["source"] == "test.suite"
    assert payload["severity"] == "critical"
    # Custom details merge alert.metadata + description for context.
    cd = payload["custom_details"]
    assert cd["equity"] == 100000.0
    assert cd["day_pnl"] == -2500.0
    assert "Test description" in cd["description"]


@pytest.mark.asyncio
async def test_pagerduty_severity_mapping():
    """Severity → PagerDuty severity mapping table."""
    from services.alerts import AlertSeverity, _pagerduty_severity

    assert _pagerduty_severity(AlertSeverity.P0) == "critical"
    assert _pagerduty_severity(AlertSeverity.P1) == "error"
    assert _pagerduty_severity(AlertSeverity.P2) == "warning"


@pytest.mark.asyncio
async def test_pagerduty_omits_dedup_key_when_unset():
    """Alerts without a dedup key must not include the field — PagerDuty
    treats every absent ``dedup_key`` as a fresh incident."""
    from services.alerts import AlertSeverity, fire_alert

    await fire_alert(
        _alert(severity=AlertSeverity.P0, deduplication_key=None),
        settings_obj=_settings_with(pagerduty="key"),
        client_factory=_client_factory,
    )
    pd_calls = [c for c in _FakeClient.calls if "pagerduty" in c[0]]
    assert len(pd_calls) == 1
    assert "dedup_key" not in pd_calls[0][1]


# ---------------------------------------------------------------------------
# Dedup window
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dedup_window_blocks_repeat_within_window():
    """Two alerts with the same dedup key inside the window: only one fires."""
    from services.alerts import AlertSeverity, fire_alert

    settings = _settings_with(pagerduty="key", dedup=900)
    a = _alert(severity=AlertSeverity.P0, deduplication_key="repeat.me")

    await fire_alert(a, settings_obj=settings, client_factory=_client_factory)
    n_after_first = len(_FakeClient.calls)
    assert n_after_first == 1

    # Second call — same dedup key, should be suppressed.
    await fire_alert(a, settings_obj=settings, client_factory=_client_factory)
    assert len(_FakeClient.calls) == n_after_first


@pytest.mark.asyncio
async def test_dedup_does_not_block_distinct_keys():
    """Different dedup keys should each fire — dedup is per-key."""
    from services.alerts import AlertSeverity, fire_alert

    settings = _settings_with(pagerduty="key")

    await fire_alert(
        _alert(severity=AlertSeverity.P0, deduplication_key="key.a"),
        settings_obj=settings,
        client_factory=_client_factory,
    )
    await fire_alert(
        _alert(severity=AlertSeverity.P0, deduplication_key="key.b"),
        settings_obj=settings,
        client_factory=_client_factory,
    )
    assert len(_FakeClient.calls) == 2


@pytest.mark.asyncio
async def test_no_dedup_when_key_unset():
    """Alerts without a dedup key are never suppressed — every event ships."""
    from services.alerts import AlertSeverity, fire_alert

    settings = _settings_with(pagerduty="key")
    a = _alert(severity=AlertSeverity.P0, deduplication_key=None)

    await fire_alert(a, settings_obj=settings, client_factory=_client_factory)
    await fire_alert(a, settings_obj=settings, client_factory=_client_factory)
    assert len(_FakeClient.calls) == 2


# ---------------------------------------------------------------------------
# Missing-destination configuration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_missing_pagerduty_silently_skips_p0():
    """When PAGERDUTY key is empty, P0 still ships to Discord; PD is silently skipped."""
    from services.alerts import AlertSeverity, fire_alert

    await fire_alert(
        _alert(severity=AlertSeverity.P0),
        settings_obj=_settings_with(discord="https://discord.example/wh"),
        client_factory=_client_factory,
    )
    urls = [c[0] for c in _FakeClient.calls]
    assert "https://discord.example/wh" in urls
    assert all("pagerduty" not in u for u in urls)


@pytest.mark.asyncio
async def test_no_destinations_configured_is_safe_noop():
    """Empty config: dispatcher returns cleanly with zero HTTP calls."""
    from services.alerts import fire_alert

    await fire_alert(
        _alert(),
        settings_obj=_settings_with(),
        client_factory=_client_factory,
    )
    assert _FakeClient.calls == []


@pytest.mark.asyncio
async def test_legacy_discord_webhook_url_fallback():
    """When ALERT_DISCORD_WEBHOOK_URL is empty but the legacy
    DISCORD_WEBHOOK_URL is set, the dispatcher uses the legacy value."""
    from services.alerts import AlertSeverity, fire_alert

    settings = _settings_with()
    settings.ALERT_DISCORD_WEBHOOK_URL = ""
    settings.DISCORD_WEBHOOK_URL = "https://discord.example/legacy"
    await fire_alert(
        _alert(severity=AlertSeverity.P2),
        settings_obj=settings,
        client_factory=_client_factory,
    )
    urls = [c[0] for c in _FakeClient.calls]
    assert urls == ["https://discord.example/legacy"]


# ---------------------------------------------------------------------------
# Severity routing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_p0_fans_to_pagerduty_and_discord():
    """P0 → {pagerduty, discord}."""
    from services.alerts import AlertSeverity, fire_alert

    await fire_alert(
        _alert(severity=AlertSeverity.P0),
        settings_obj=_settings_with(
            pagerduty="key",
            discord="https://discord.example/wh",
            slack="https://slack.example/wh",
        ),
        client_factory=_client_factory,
    )
    urls = [c[0] for c in _FakeClient.calls]
    assert any("pagerduty" in u for u in urls)
    assert any("discord" in u for u in urls)
    assert all("slack" not in u for u in urls)


@pytest.mark.asyncio
async def test_p1_fans_to_slack_and_discord():
    """P1 → {slack, discord} — no oncall page."""
    from services.alerts import AlertSeverity, fire_alert

    await fire_alert(
        _alert(severity=AlertSeverity.P1),
        settings_obj=_settings_with(
            pagerduty="key",
            discord="https://discord.example/wh",
            slack="https://slack.example/wh",
        ),
        client_factory=_client_factory,
    )
    urls = [c[0] for c in _FakeClient.calls]
    assert all("pagerduty" not in u for u in urls)
    assert any("slack" in u for u in urls)
    assert any("discord" in u for u in urls)


@pytest.mark.asyncio
async def test_p2_only_discord():
    """P2 → {discord} — log-grade, no Slack ping."""
    from services.alerts import AlertSeverity, fire_alert

    await fire_alert(
        _alert(severity=AlertSeverity.P2),
        settings_obj=_settings_with(
            pagerduty="key",
            discord="https://discord.example/wh",
            slack="https://slack.example/wh",
        ),
        client_factory=_client_factory,
    )
    urls = [c[0] for c in _FakeClient.calls]
    assert urls == ["https://discord.example/wh"]


@pytest.mark.asyncio
async def test_generic_webhook_receives_every_severity():
    """Generic webhook is the 'send everything' hook for self-hosted routers."""
    from services.alerts import AlertSeverity, fire_alert

    settings = _settings_with(
        generic="https://router.example/all",
        discord="https://discord.example/wh",
    )

    for sev in (AlertSeverity.P0, AlertSeverity.P1, AlertSeverity.P2):
        await fire_alert(
            _alert(severity=sev, deduplication_key=None),
            settings_obj=settings,
            client_factory=_client_factory,
        )

    generic_calls = [
        c for c in _FakeClient.calls
        if c[0] == "https://router.example/all"
    ]
    assert len(generic_calls) == 3
    # Generic destination receives the structured alert payload.
    assert generic_calls[0][1]["severity"] == "p0"
    assert generic_calls[1][1]["severity"] == "p1"
    assert generic_calls[2][1]["severity"] == "p2"


# ---------------------------------------------------------------------------
# Fail-open semantics
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fire_alert_swallows_destination_errors():
    """Network errors from individual destinations must NOT propagate."""
    from services.alerts import AlertSeverity, fire_alert

    _FakeClient.raise_on_post = True

    # Should not raise — fire-and-forget dispatcher.
    await fire_alert(
        _alert(severity=AlertSeverity.P0),
        settings_obj=_settings_with(
            pagerduty="key",
            discord="https://discord.example/wh",
        ),
        client_factory=_client_factory,
    )
    # All destinations attempted (PagerDuty + Discord).
    assert len(_FakeClient.calls) == 2


@pytest.mark.asyncio
async def test_fire_alert_swallows_pagerduty_4xx():
    """PagerDuty rejecting the trigger (e.g. invalid routing key) is logged
    but doesn't propagate."""
    from services.alerts import AlertSeverity, fire_alert

    _FakeClient.response_factory = staticmethod(
        lambda: _FakeResponse(403, "invalid routing_key")
    )

    await fire_alert(
        _alert(severity=AlertSeverity.P0),
        settings_obj=_settings_with(pagerduty="bogus-key"),
        client_factory=_client_factory,
    )
    # Single attempt, no exception bubbled.
    assert len(_FakeClient.calls) == 1


@pytest.mark.asyncio
async def test_fire_alert_swallows_settings_failure():
    """Even a malformed settings object must not break the caller's
    critical path — dispatcher fails open at the outermost layer."""
    from services.alerts import fire_alert

    bad_settings = MagicMock()
    # ``getattr(bad_settings, ...)`` returns a MagicMock for every attr
    # which would normally pass the truthiness check; force the dedup
    # window read to raise to exercise the outer-try guard.
    type(bad_settings).ALERT_DEDUP_WINDOW_SECONDS = property(
        lambda self: (_ for _ in ()).throw(ValueError("boom"))
    )

    # Should not raise.
    await fire_alert(_alert(), settings_obj=bad_settings, client_factory=_client_factory)


# ---------------------------------------------------------------------------
# OA-2: Settings defaults
# ---------------------------------------------------------------------------


def test_settings_defaults_for_alerts():
    """All alert-related Settings fields default to safe disabled values."""
    from core.config import Settings

    s = Settings()
    assert s.ALERT_PAGERDUTY_INTEGRATION_KEY.get_secret_value() == ""
    assert s.ALERT_DISCORD_WEBHOOK_URL.get_secret_value() == ""
    assert s.ALERT_SLACK_WEBHOOK_URL.get_secret_value() == ""
    assert s.ALERT_GENERIC_WEBHOOK_URL.get_secret_value() == ""
    assert s.ALERT_DEDUP_WINDOW_SECONDS == 900


def test_settings_env_override_dedup_window(monkeypatch):
    monkeypatch.setenv("ALERT_DEDUP_WINDOW_SECONDS", "60")
    from core.config import Settings

    assert Settings().ALERT_DEDUP_WINDOW_SECONDS == 60
