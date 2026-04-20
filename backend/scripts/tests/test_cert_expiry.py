"""Unit tests for ``backend/scripts/check_cert_expiry.py`` (Wave 4R Fix 4).

Covers the parse + threshold logic. The socket / TLS handshake path is
not exercised here — that's an integration concern with live infra. We
feed ``check_once`` a stubbed ``fetch_peer_cert`` so the pure logic
(days-remaining math + return-code mapping) is verified without
dependency on the network.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


# ---------------------------------------------------------------------------
# parse_cert_expiry
# ---------------------------------------------------------------------------

def test_parse_cert_expiry_valid() -> None:
    from scripts.check_cert_expiry import parse_cert_expiry

    cert = {"notAfter": "Mar  1 12:00:00 2026 GMT"}
    dt = parse_cert_expiry(cert)
    assert dt.tzinfo is timezone.utc
    assert dt.year == 2026 and dt.month == 3 and dt.day == 1
    assert dt.hour == 12 and dt.minute == 0


def test_parse_cert_expiry_missing_not_after_raises() -> None:
    from scripts.check_cert_expiry import parse_cert_expiry

    with pytest.raises(ValueError):
        parse_cert_expiry({})


def test_parse_cert_expiry_malformed_raises() -> None:
    from scripts.check_cert_expiry import parse_cert_expiry

    with pytest.raises(ValueError):
        parse_cert_expiry({"notAfter": "not a valid date"})


# ---------------------------------------------------------------------------
# check_once — threshold + return code
# ---------------------------------------------------------------------------

def _stub_cert(days_from_now: float) -> dict[str, str]:
    """Build a ``getpeercert()``-shaped dict with ``notAfter`` ``days`` from now."""
    not_after = datetime.now(timezone.utc) + timedelta(days=days_from_now)
    # Match the parser's expected format: ``%b %d %H:%M:%S %Y %Z``.
    fmt = not_after.strftime("%b %d %H:%M:%S %Y GMT")
    return {"notAfter": fmt}


def _run(coro):
    return asyncio.run(coro)


def test_check_once_healthy_cert_returns_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    from scripts import check_cert_expiry as mod

    monkeypatch.setattr(mod, "fetch_peer_cert", lambda *a, **kw: _stub_cert(60))
    # Swallow the audit side-effect.
    called: list[tuple[str, dict]] = []

    async def _fake_audit(event, details):
        called.append((event, details))

    monkeypatch.setattr(mod, "_write_audit", _fake_audit)

    rc = _run(mod.check_once("example.test", warn_days=14))
    assert rc == 0
    assert called == []  # healthy cert writes no audit entry


def test_check_once_warns_when_close_to_expiry(monkeypatch: pytest.MonkeyPatch) -> None:
    from scripts import check_cert_expiry as mod

    monkeypatch.setattr(mod, "fetch_peer_cert", lambda *a, **kw: _stub_cert(7))
    called: list[tuple[str, dict]] = []

    async def _fake_audit(event, details):
        called.append((event, details))

    monkeypatch.setattr(mod, "_write_audit", _fake_audit)

    rc = _run(mod.check_once("example.test", warn_days=14))
    assert rc == 0  # WARN is not a process-level failure
    assert called and called[0][0] == "cert_expiring_soon"
    details = called[0][1]
    assert details["domain"] == "example.test"
    assert details["warn_threshold_days"] == 14
    assert 6.5 <= details["days_remaining"] <= 7.5


def test_check_once_reports_expired(monkeypatch: pytest.MonkeyPatch) -> None:
    from scripts import check_cert_expiry as mod

    monkeypatch.setattr(mod, "fetch_peer_cert", lambda *a, **kw: _stub_cert(-1))
    called: list[tuple[str, dict]] = []

    async def _fake_audit(event, details):
        called.append((event, details))

    monkeypatch.setattr(mod, "_write_audit", _fake_audit)

    rc = _run(mod.check_once("example.test", warn_days=14))
    assert rc == 1
    assert called and called[0][0] == "cert_expired"


def test_check_once_handles_fetch_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    from scripts import check_cert_expiry as mod

    def _boom(*a, **kw):
        raise ConnectionError("tls handshake failed")

    monkeypatch.setattr(mod, "fetch_peer_cert", _boom)
    called: list[tuple[str, dict]] = []

    async def _fake_audit(event, details):
        called.append((event, details))

    monkeypatch.setattr(mod, "_write_audit", _fake_audit)

    rc = _run(mod.check_once("example.test", warn_days=14))
    assert rc == 2
    assert called and called[0][0] == "cert_check_error"
