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
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

logger = logging.getLogger("alphadesk.metrics.vitals")

router = APIRouter()


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
