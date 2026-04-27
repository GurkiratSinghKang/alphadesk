"""Public metrics endpoints — Web Vitals beacon landing.

Round-7 / M-8 (K-1 follow-up): the frontend's
``frontend/src/lib/web-vitals.ts`` beacons each Core Web Vital
(LCP, CLS, INP, FCP, TTFB) to ``/api/v1/metrics/vitals`` via
``navigator.sendBeacon`` on page hide. The endpoint hadn't been
wired on the backend, so every page load fired a 404 (silent in
the browser but noisy in access logs and worth no observability).

This module exposes a deliberately minimal POST handler: validate
the payload shape, log it as a structured INFO line, and return
204 No Content. Logging is enough for now — operators can grep
``vital=LCP`` out of the JSON access log and aggregate offline.
A future iteration can push to Prometheus / OTLP if real-time
dashboards become useful.

Auth posture: the beacon fires from any browser session including
unauthenticated landing pages, and ``sendBeacon`` does not retry
on 4xx — gating this with ``require_auth`` would silently drop a
material fraction of vitals samples (precisely the cohort that
matters for landing-page LCP). Instead the endpoint is public,
rate-limited per source IP, and validates the body strictly so a
hostile beacon can't blow up the log volume.
"""
from __future__ import annotations

import logging
import time
from collections import deque
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

logger = logging.getLogger("alphadesk.metrics.vitals")

router = APIRouter()

# Round-16 / persona-7 + Round-24 / persona-C P0: the docstring above
# claimed the endpoint is "rate-limited per source IP" but the handler
# never actually enforced it — a botnet looping ``navigator.sendBeacon``
# could trivially flood the JSON-log stream and burn disk + log-bill
# costs. Lightweight per-IP token-bucket here — single-worker uvicorn
# means an in-process dict suffices for the scale we ship at.
_VITALS_RATE_WINDOW_S = 60.0
_VITALS_RATE_MAX_PER_IP = 60  # 1/sec sustained per IP, fits ~5 vitals/page-load
_VITALS_HITS: dict[str, deque[float]] = {}


def _vitals_rate_check(client_ip: str) -> bool:
    """Return True if the IP is under the rate limit, False if blocked."""
    now = time.monotonic()
    bucket = _VITALS_HITS.get(client_ip)
    if bucket is None:
        bucket = deque(maxlen=_VITALS_RATE_MAX_PER_IP * 2)
        _VITALS_HITS[client_ip] = bucket
    # Trim entries older than the window.
    while bucket and now - bucket[0] > _VITALS_RATE_WINDOW_S:
        bucket.popleft()
    if len(bucket) >= _VITALS_RATE_MAX_PER_IP:
        return False
    bucket.append(now)
    # Bound the master dict so a flood of distinct IPs can't OOM us.
    if len(_VITALS_HITS) > 10_000:
        # Evict the oldest IP entry — best-effort, doesn't need ordering precision.
        try:
            del _VITALS_HITS[next(iter(_VITALS_HITS))]
        except StopIteration:
            pass
    return True


# Web-Vitals v4 names. Fixed enum so a typo'd beacon can't pollute the log.
_VITAL_NAMES = Literal["LCP", "CLS", "INP", "FCP", "TTFB"]
_RATINGS = Literal["good", "needs-improvement", "poor"]


class _VitalsPayload(BaseModel):
    """Shape mirrors web-vitals@4 ``Metric`` — only the fields we log.

    ``model_config.extra='ignore'`` lets the library add fields in
    future versions without breaking existing clients while still
    rejecting wildly-shaped payloads (Pydantic still type-checks
    every declared field).
    """

    name: _VITAL_NAMES
    value: float = Field(ge=0, le=1e7)
    rating: _RATINGS
    delta: float = Field(ge=-1e7, le=1e7)
    id: str = Field(min_length=1, max_length=128)
    navigationType: str | None = Field(default=None, max_length=32)
    url: str | None = Field(default=None, max_length=2048)


@router.post("/vitals", status_code=204)
async def log_vital(payload: _VitalsPayload, request: Request) -> Response:
    """Receive one Core Web Vital sample and log it.

    Returns 204 No Content because ``navigator.sendBeacon`` discards
    the response body anyway and a 200-with-body costs more bytes on
    the wire for no benefit. Errors return 400 so the browser can
    drop the malformed sample without crashing the page (the beacon
    swallows non-2xx in ``frontend/src/lib/web-vitals.ts``).
    """
    client_host = request.client.host if request.client else "unknown"
    if not _vitals_rate_check(client_host):
        # Quietly accept-then-drop so a flood doesn't trigger client retries.
        return Response(status_code=204)
    logger.info(
        "web_vital",
        extra={
            "event": "web_vital",
            "vital": payload.name,
            "value": payload.value,
            "rating": payload.rating,
            "delta": payload.delta,
            "metric_id": payload.id,
            "nav_type": payload.navigationType,
            "url": payload.url,
            "client": client_host,
        },
    )
    return Response(status_code=204)
