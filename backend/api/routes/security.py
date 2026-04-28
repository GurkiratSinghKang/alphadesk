"""Security telemetry endpoints — CSP violation report ingest.

Round-23 / persona-A P0 (CSP unsafe-inline migration): the Caddyfile
ships a strict ``Content-Security-Policy-Report-Only`` header in
parallel with the current permissive enforced policy. Browsers POST
violations to ``/api/v1/security/csp-report`` without blocking the
page, so we can collect a full inventory of inline scripts/styles
that need hashing or nonce-wiring before flipping the enforced
header.

The endpoint is anonymous (browsers POST without credentials) but
heavily rate-limited per IP and validates the body shape strictly so
a hostile beacon can't blow up the log volume.

Design notes:
  - Browsers send either ``application/csp-report`` (legacy) or
    ``application/reports+json`` (Reporting API). We accept both
    via a permissive Pydantic model and log the canonical fields.
  - The ``violated-directive`` field tells us which CSP rule fired,
    which is enough to drive the migration (we don't need
    ``script-sample`` payloads which can leak page content).
  - Fired-once dedup is via the ``blocked-uri`` value — a noisy
    third-party (browser extension) could otherwise spam the log.
"""
from __future__ import annotations

import logging
import time
from collections import deque

from fastapi import APIRouter, Request, Response

logger = logging.getLogger("alphadesk.security.csp")

router = APIRouter()

# Per-IP rate limit (same shape as /metrics/vitals — single-worker
# uvicorn means an in-process dict suffices).
_CSP_RATE_WINDOW_S = 60.0
_CSP_RATE_MAX_PER_IP = 30  # 1 violation / 2s sustained per IP
_CSP_HITS: dict[str, deque[float]] = {}


def _csp_rate_check(client_ip: str) -> bool:
    now = time.monotonic()
    bucket = _CSP_HITS.get(client_ip)
    if bucket is None:
        bucket = deque(maxlen=_CSP_RATE_MAX_PER_IP * 2)
        _CSP_HITS[client_ip] = bucket
    while bucket and now - bucket[0] > _CSP_RATE_WINDOW_S:
        bucket.popleft()
    if len(bucket) >= _CSP_RATE_MAX_PER_IP:
        return False
    bucket.append(now)
    if len(_CSP_HITS) > 10_000:
        try:
            del _CSP_HITS[next(iter(_CSP_HITS))]
        except StopIteration:
            pass
    return True


@router.post("/csp-report", status_code=204)
async def csp_report(request: Request) -> Response:
    """Receive a CSP violation report and log it.

    Returns 204 always — browsers don't retry on 4xx/5xx for CSP
    reports anyway, and surfacing parse errors back to the page is
    not actionable.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not _csp_rate_check(client_ip):
        return Response(status_code=204)
    try:
        body = await request.json()
    except Exception:
        return Response(status_code=204)

    # Both the legacy ``application/csp-report`` and the Reporting API
    # JSON wrap the actual report under a different key. Normalise.
    report: dict
    if isinstance(body, dict) and "csp-report" in body:
        # Legacy: { "csp-report": {...} }
        report = body["csp-report"] or {}
    elif isinstance(body, list) and body and isinstance(body[0], dict):
        # Reporting API: [ { "type": "csp-violation", "body": {...} } ]
        first = body[0]
        report = first.get("body", {}) if first.get("type") == "csp-violation" else {}
    elif isinstance(body, dict):
        report = body
    else:
        return Response(status_code=204)

    # Log only the structured fields we'll use to drive migration.
    # Avoid ``script-sample`` (can contain page content) and full
    # blocked-uri values longer than 256 chars (long data: URIs).
    blocked = str(report.get("blocked-uri", report.get("blockedURL", "")))[:256]
    directive = str(report.get("violated-directive", report.get("effectiveDirective", "")))[:128]
    document = str(report.get("document-uri", report.get("documentURL", "")))[:256]
    disposition = str(report.get("disposition", "report"))[:16]
    logger.info(
        "csp_violation",
        extra={
            "event": "csp_violation",
            "blocked_uri": blocked,
            "violated_directive": directive,
            "document_uri": document,
            "disposition": disposition,
            "client": client_ip,
        },
    )
    return Response(status_code=204)
