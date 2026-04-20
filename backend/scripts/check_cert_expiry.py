"""Certificate-expiry monitor (Wave 4R Fix 4).

Caddy auto-renews every certificate it issued via ACME, but a silent
renewal failure (ACME-rate-limited, ACME-server-down, DNS drift) is
invisible to the operator until the cert actually expires and Chrome
starts popping the interstitial.  This script closes the gap:

1. Opens a TLS connection to ``https://{domain}:443`` and reads the
   leaf certificate out of the peer chain.
2. Computes days-until-expiry from ``notAfter``.
3. On less than 14 days: emits a WARN log line AND writes an entry to
   the durable ``audit_log`` Postgres table via :func:`core.audit.write_audit`
   so the event is visible to compliance regardless of log-aggregator
   retention.
4. Exits non-zero when the check could not be completed (network error,
   TLS handshake failure, cert parse failure).  This lets a systemd
   ``OnFailure=`` hook or a monitoring tool key off the exit code.

The domain is read from ``$ALPHADESK_CERT_DOMAIN`` (falling back to
``tradingalpha.net`` because that's the deployed hostname — never hit a
hardcoded IP for this check; the cert is bound to the name, not the IP).

The script is intentionally stdlib-only (``ssl`` + ``socket``) so it
keeps working if the backend venv is mid-migration or the prod image
hasn't been rebuilt since the last dependency drift.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import socket
import ssl
import sys
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("alphadesk.cert_check")

# X.509 uses an ASN.1 GeneralizedTime string like ``Mar  1 12:00:00 2026 GMT``.
# ``ssl.getpeercert`` gives us that string back unchanged.
_CERT_TIME_FORMAT = "%b %d %H:%M:%S %Y %Z"


def parse_cert_expiry(cert: dict[str, Any]) -> datetime:
    """Return the UTC ``notAfter`` datetime from a ``getpeercert()`` dict.

    Exposed (and kept side-effect-free) so the unit tests in
    ``backend/scripts/tests/test_cert_expiry.py`` can feed it a stubbed
    response without opening a real socket.
    """
    not_after_raw = cert.get("notAfter")
    if not not_after_raw:
        raise ValueError("peer certificate has no notAfter field")
    not_after = datetime.strptime(not_after_raw, _CERT_TIME_FORMAT)
    # %Z in strptime doesn't attach tzinfo reliably on Python — stamp UTC.
    return not_after.replace(tzinfo=timezone.utc)


def fetch_peer_cert(domain: str, port: int = 443, timeout: float = 5.0) -> dict[str, Any]:
    """Open a TLS handshake to ``(domain, port)`` and return ``getpeercert()``.

    Kept synchronous + stdlib-only so this script can run from a systemd
    timer unit without dragging in the FastAPI stack.
    """
    ctx = ssl.create_default_context()
    with socket.create_connection((domain, port), timeout=timeout) as sock:
        with ctx.wrap_socket(sock, server_hostname=domain) as tls:
            cert = tls.getpeercert()
    if not cert:
        raise RuntimeError(f"no peer cert returned for {domain}:{port}")
    return cert


async def _write_audit(event: str, details: dict[str, Any]) -> None:
    """Fire an audit-log entry; never raise."""
    try:
        from core.audit import write_audit

        await write_audit(
            event,
            username=None,
            ip=None,
            request_id=None,
            details=details,
        )
    except Exception:
        logger.warning("audit write failed for event=%s", event, exc_info=True)


async def check_once(domain: str, warn_days: int = 14) -> int:
    """Run one check.  Returns a POSIX exit code (0 = green, non-zero = problem)."""
    try:
        cert = fetch_peer_cert(domain)
    except Exception as exc:
        logger.error("cert fetch failed for %s: %s", domain, exc)
        await _write_audit(
            "cert_check_error",
            {"domain": domain, "error": str(exc), "error_type": type(exc).__name__},
        )
        return 2

    try:
        not_after = parse_cert_expiry(cert)
    except Exception as exc:
        logger.error("cert parse failed for %s: %s", domain, exc)
        await _write_audit(
            "cert_check_error",
            {"domain": domain, "error": str(exc), "error_type": type(exc).__name__},
        )
        return 2

    now = datetime.now(timezone.utc)
    days_remaining = (not_after - now).total_seconds() / 86400.0

    if days_remaining < 0:
        logger.error(
            "CERT EXPIRED for %s (notAfter=%s, %.1f days ago)",
            domain, not_after.isoformat(), abs(days_remaining),
        )
        await _write_audit(
            "cert_expired",
            {
                "domain": domain,
                "not_after": not_after.isoformat(),
                "days_remaining": round(days_remaining, 2),
            },
        )
        return 1

    if days_remaining < warn_days:
        logger.warning(
            "CERT expiring soon for %s: %.1f days remaining (notAfter=%s)",
            domain, days_remaining, not_after.isoformat(),
        )
        await _write_audit(
            "cert_expiring_soon",
            {
                "domain": domain,
                "not_after": not_after.isoformat(),
                "days_remaining": round(days_remaining, 2),
                "warn_threshold_days": warn_days,
            },
        )
        return 0  # Still green from a process-exit perspective; WARN log + audit is the alert.

    logger.info(
        "cert ok for %s: %.1f days remaining (notAfter=%s)",
        domain, days_remaining, not_after.isoformat(),
    )
    return 0


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    import os

    parser = argparse.ArgumentParser(description="Check TLS cert expiry for a domain.")
    parser.add_argument(
        "--domain",
        default=os.environ.get("ALPHADESK_CERT_DOMAIN", "tradingalpha.net"),
        help="Hostname to check (default: $ALPHADESK_CERT_DOMAIN or tradingalpha.net).",
    )
    parser.add_argument(
        "--warn-days",
        type=int,
        default=14,
        help="Log a WARN + audit entry when less than this many days remain (default: 14).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = _parse_args(argv)
    return asyncio.run(check_once(args.domain, warn_days=args.warn_days))


if __name__ == "__main__":
    sys.exit(main())
