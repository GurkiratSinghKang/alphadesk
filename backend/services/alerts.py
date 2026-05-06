"""Generic webhook-based alert dispatcher.

Audit P0-5 (STRATEGY-HARDENING-AUDIT 2026-05-05): the only existing
notification destination was a single Discord webhook fired ad-hoc from
``daily_pipeline.py``. The comment at the call site even says "oncall
will not be paged via Discord on failure" — there was no PagerDuty
integration, no severity routing, no dedup, no margin / concentration /
soft-PnL hooks. A pipeline failure at 09:30 ET could go uncaught for
hours.

This module is the single dispatcher for all operator-facing alerts:

* Severity-based routing (P0/P1/P2)
* Multiple destinations (Discord, Slack, PagerDuty, generic webhook)
* Dedup window (suppress repeat alerts within N seconds)
* Fail-open — alert delivery failures NEVER propagate to the caller.
  A broker rate-limit alert that itself raises must not turn into a
  cascading order-path failure.

Configuration is env-only (see ``backend/core/config.py``):

* ``ALERT_PAGERDUTY_INTEGRATION_KEY`` — PagerDuty Events API v2 key.
* ``ALERT_DISCORD_WEBHOOK_URL`` — re-uses the existing Discord webhook.
* ``ALERT_SLACK_WEBHOOK_URL`` — optional Slack incoming webhook.
* ``ALERT_GENERIC_WEBHOOK_URL`` — optional generic POST endpoint.
* ``ALERT_DEDUP_WINDOW_SECONDS`` — default 900 (15 min).

When a destination's URL/key is empty the destination is silently
skipped — operators can run with PagerDuty unset (e.g. dev / staging)
without crashing.

Usage::

    from services.alerts import Alert, AlertSeverity, fire_alert

    await fire_alert(Alert(
        severity=AlertSeverity.P0,
        title="Daily pipeline failure",
        description=f"Pipeline raised {type(e).__name__}: {e}",
        source="daily_pipeline.run",
        deduplication_key="daily_pipeline.run",
        occurred_at=datetime.now(timezone.utc),
        metadata={"runbook": "docs/RUNBOOK-alerts.md#daily-pipeline"},
    ))

The caller does NOT await on individual destination delivery — the
dispatcher fans out concurrently and returns once all destinations
have been attempted (success or failure).
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from enum import Enum
from typing import Any

import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class AlertSeverity(str, Enum):
    """Operator-facing severity ladder.

    P0 = page oncall NOW (PagerDuty + Discord).
    P1 = notify, respond within ~2 hours (Slack + Discord).
    P2 = log-grade, review weekly (Discord only).

    The numeric ordering also drives PagerDuty's ``severity`` field on
    Events API v2: P0 → critical, P1 → error, P2 → warning. Anything
    that isn't actionable should never be a P2; use a regular log line.
    """

    P0 = "p0"
    P1 = "p1"
    P2 = "p2"


class Alert(BaseModel):
    """A single alert to dispatch.

    ``deduplication_key`` collapses repeat alerts within the dedup
    window (default 15 min) — wrap a failing-pipeline alert in the same
    key so a 30-tick failure storm produces one page, not 30. PagerDuty's
    Events API v2 also de-duplicates server-side on this field, which
    means a flaky check won't reopen a fresh incident every minute.

    ``metadata`` is a free-form JSON-serialisable dict; it is forwarded
    verbatim to PagerDuty's ``custom_details`` and embedded as a code
    block in the Discord / Slack messages so the runbook recipient has
    the diagnostic state at hand.
    """

    severity: AlertSeverity
    title: str = Field(..., max_length=200)
    description: str
    source: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime
    deduplication_key: str | None = None


# ---------------------------------------------------------------------------
# Dedup state
# ---------------------------------------------------------------------------
#
# Process-local dedup table keyed on ``(severity, deduplication_key)``.
# A small in-memory map is sufficient for AlphaDesk's ``gunicorn -w 1``
# deployment; for multi-worker setups a Redis SETEX would carry the
# dedup window across workers but is out of scope for the P0 fix —
# the wider dedup story is the same problem PagerDuty itself solves on
# the receiving end via ``dedup_key``, so the local cache is belt-and-
# braces for the destinations that don't dedup natively (Discord/Slack).

_DEDUP_CACHE: dict[tuple[str, str], float] = {}


def _is_duplicate(alert: Alert, window_seconds: int) -> bool:
    """Return True if an alert with the same key fired within the window.

    Stamps the cache with the current monotonic time on the first hit
    so subsequent duplicates within ``window_seconds`` are suppressed.
    Lazily evicts expired entries to avoid unbounded growth — a long-
    running process that fires thousands of distinct dedup keys would
    otherwise leak memory at ~64 bytes per entry.
    """
    if alert.deduplication_key is None:
        return False
    key = (alert.severity.value, alert.deduplication_key)
    now = time.monotonic()
    last = _DEDUP_CACHE.get(key)
    if last is not None and (now - last) < window_seconds:
        return True
    _DEDUP_CACHE[key] = now
    # Lazy GC: if the cache grew past 256 entries, evict expired ones.
    if len(_DEDUP_CACHE) > 256:
        cutoff = now - window_seconds
        for k, ts in list(_DEDUP_CACHE.items()):
            if ts < cutoff:
                _DEDUP_CACHE.pop(k, None)
    return False


def _reset_dedup_cache_for_tests() -> None:
    """Clear the dedup cache. Test-only — don't call in production paths."""
    _DEDUP_CACHE.clear()


# ---------------------------------------------------------------------------
# Destination senders
# ---------------------------------------------------------------------------
#
# Each ``_send_*`` returns ``None`` and never raises. Errors are logged
# and swallowed so the dispatcher's ``asyncio.gather(..., return_exceptions=True)``
# sees a clean future, but more importantly so a single misconfigured
# destination cannot block delivery to the others.


_HTTP_TIMEOUT_SECONDS = 5.0
_PAGERDUTY_EVENTS_URL = "https://events.pagerduty.com/v2/enqueue"


def _pagerduty_severity(alert_severity: AlertSeverity) -> str:
    """Map AlphaDesk severity → PagerDuty Events API v2 severity."""
    return {
        AlertSeverity.P0: "critical",
        AlertSeverity.P1: "error",
        AlertSeverity.P2: "warning",
    }[alert_severity]


async def _send_pagerduty(
    alert: Alert,
    routing_key: str,
    *,
    client_factory: Any | None = None,
) -> None:
    """POST to PagerDuty Events API v2.

    Body matches https://developer.pagerduty.com/docs/events-api-v2/trigger-events/.
    The ``dedup_key`` field is the user-facing dedup primitive — if it
    matches an open incident PagerDuty merges this trigger into that
    incident instead of paging again.
    """
    body: dict[str, Any] = {
        "routing_key": routing_key,
        "event_action": "trigger",
        "payload": {
            "summary": alert.title,
            "source": alert.source,
            "severity": _pagerduty_severity(alert.severity),
            "timestamp": alert.occurred_at.astimezone(timezone.utc).isoformat(),
            "custom_details": {
                "description": alert.description,
                **alert.metadata,
            },
        },
    }
    if alert.deduplication_key:
        body["dedup_key"] = alert.deduplication_key

    factory = client_factory or (lambda **kw: httpx.AsyncClient(**kw))
    try:
        async with factory(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.post(_PAGERDUTY_EVENTS_URL, json=body)
            if resp.status_code >= 400:
                logger.error(
                    "PagerDuty enqueue rejected: status=%s body=%s",
                    resp.status_code,
                    resp.text[:500],
                )
    except Exception:
        logger.error("PagerDuty enqueue failed", exc_info=True)


def _format_text_body(alert: Alert) -> str:
    """Format a human-readable text block for Discord / Slack / generic."""
    sev = alert.severity.value.upper()
    parts = [f"**[{sev}] {alert.title}**", alert.description]
    if alert.metadata:
        # Render metadata as compact key=value lines so the operator sees
        # diagnostic state (equity, ratio, symbol, …) without opening
        # PagerDuty.
        meta_lines = "\n".join(
            f"  {k}={v}" for k, v in sorted(alert.metadata.items())
        )
        parts.append(f"```\n{meta_lines}\n```")
    parts.append(f"_source: {alert.source} • {alert.occurred_at.isoformat()}_")
    return "\n".join(parts)


async def _send_discord(
    alert: Alert,
    webhook_url: str,
    *,
    client_factory: Any | None = None,
) -> None:
    """POST to a Discord incoming webhook."""
    factory = client_factory or (lambda **kw: httpx.AsyncClient(**kw))
    try:
        async with factory(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            await client.post(
                webhook_url,
                json={"content": _format_text_body(alert)[:1900]},
            )
    except Exception:
        logger.error("Discord alert failed", exc_info=True)


async def _send_slack(
    alert: Alert,
    webhook_url: str,
    *,
    client_factory: Any | None = None,
) -> None:
    """POST to a Slack incoming webhook (text-only payload)."""
    factory = client_factory or (lambda **kw: httpx.AsyncClient(**kw))
    try:
        async with factory(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            await client.post(
                webhook_url,
                json={"text": _format_text_body(alert)[:3500]},
            )
    except Exception:
        logger.error("Slack alert failed", exc_info=True)


async def _send_generic(
    alert: Alert,
    webhook_url: str,
    *,
    client_factory: Any | None = None,
) -> None:
    """POST the full alert payload to a custom HTTP endpoint.

    The receiver gets the raw structured alert (severity, title, source,
    metadata, …) so a self-hosted router (Alertmanager, custom on-call
    bot) can transform it however it likes.
    """
    factory = client_factory or (lambda **kw: httpx.AsyncClient(**kw))
    try:
        payload = alert.model_dump(mode="json")
        async with factory(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            await client.post(webhook_url, json=payload)
    except Exception:
        logger.error("Generic webhook alert failed", exc_info=True)


# ---------------------------------------------------------------------------
# Severity routing
# ---------------------------------------------------------------------------
#
# Configurable via ``Settings`` later if operators want different
# routing — the table below is the documented default in
# ``docs/RUNBOOK-alerts.md``.
#
# Note: ``generic_webhook`` always receives the alert if configured —
# it's the "send everything" hook for self-hosted routers.


def _destinations_for_severity(severity: AlertSeverity) -> set[str]:
    if severity == AlertSeverity.P0:
        return {"pagerduty", "discord"}
    if severity == AlertSeverity.P1:
        return {"slack", "discord"}
    return {"discord"}


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def fire_alert(
    alert: Alert,
    *,
    settings_obj: Any | None = None,
    client_factory: Any | None = None,
) -> None:
    """Dispatch ``alert`` to all configured destinations for its severity.

    Fails open — destination errors are logged but never raised back to
    the caller. The caller is in a critical path (pipeline failure,
    kill-switch trip, broker-degradation handler); blocking it on a
    Discord 500 would defeat the purpose.

    ``settings_obj`` and ``client_factory`` are injection points for
    tests; production callers pass nothing and the dispatcher reads
    ``core.config.settings`` and constructs real ``httpx.AsyncClient``
    instances.
    """
    try:
        if settings_obj is None:
            from core.config import settings as _settings
            settings_obj = _settings

        # Dedup window check
        try:
            window = int(getattr(settings_obj, "ALERT_DEDUP_WINDOW_SECONDS", 900) or 900)
        except (TypeError, ValueError):
            window = 900
        if _is_duplicate(alert, window):
            logger.info(
                "alert deduped: severity=%s key=%s window=%ss",
                alert.severity.value,
                alert.deduplication_key,
                window,
            )
            return

        # Resolve destination configs
        def _maybe_secret(attr: str) -> str:
            raw = getattr(settings_obj, attr, "") or ""
            getter = getattr(raw, "get_secret_value", None)
            if callable(getter):
                try:
                    return getter() or ""
                except Exception:
                    return ""
            return str(raw)

        pagerduty_key = _maybe_secret("ALERT_PAGERDUTY_INTEGRATION_KEY")
        discord_url = _maybe_secret("ALERT_DISCORD_WEBHOOK_URL") or _maybe_secret(
            "DISCORD_WEBHOOK_URL"
        )
        slack_url = _maybe_secret("ALERT_SLACK_WEBHOOK_URL")
        generic_url = _maybe_secret("ALERT_GENERIC_WEBHOOK_URL")

        targets = _destinations_for_severity(alert.severity)
        tasks: list[Any] = []

        if "pagerduty" in targets and pagerduty_key:
            tasks.append(
                _send_pagerduty(
                    alert, pagerduty_key, client_factory=client_factory
                )
            )
        if "discord" in targets and discord_url:
            tasks.append(
                _send_discord(alert, discord_url, client_factory=client_factory)
            )
        if "slack" in targets and slack_url:
            tasks.append(
                _send_slack(alert, slack_url, client_factory=client_factory)
            )
        # generic_webhook receives every alert regardless of severity
        if generic_url:
            tasks.append(
                _send_generic(alert, generic_url, client_factory=client_factory)
            )

        if not tasks:
            logger.info(
                "alert dispatch skipped: no destinations configured (severity=%s, source=%s)",
                alert.severity.value,
                alert.source,
            )
            return

        # Fan out concurrently. ``return_exceptions=True`` means a single
        # destination failure won't bubble up — the individual senders
        # already swallow their own errors, this is belt-and-braces.
        await asyncio.gather(*tasks, return_exceptions=True)

    except Exception:
        # Last-ditch fail-open: ANY exception in the dispatcher itself
        # must not propagate — the caller's critical path is more
        # important than alert delivery.
        logger.error("fire_alert dispatcher itself failed", exc_info=True)


__all__ = [
    "Alert",
    "AlertSeverity",
    "fire_alert",
]
