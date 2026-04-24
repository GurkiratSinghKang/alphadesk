"""HTTP request utilities shared across routes.

Consolidates helpers that were previously duplicated in ``auth.py``,
``market.py``, and (implicitly) ``_rate_limit.py``. See Batch 2 simplify
review — the inline ``request.client.host`` pattern in ``_rate_limit.py``
was silently bucketing every caller under Caddy's IP in production,
defeating the per-IP rate limit entirely.
"""
from __future__ import annotations

from fastapi import Request


def client_ip(request: Request) -> str:
    """Best-effort resolve the caller's IP for rate-limit / audit keying.

    Honours the trusted-proxy header ``X-Forwarded-For`` set by Caddy
    (we control the edge so spoofing would require bypassing Caddy).
    Falls back to the direct connection address — covers tests and the
    dev-runner path where no proxy is in front of uvicorn.

    Returns ``"unknown"`` if neither source yields a usable value so
    rate-limit buckets still key on a stable string instead of ``None``.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # ``X-Forwarded-For: client, proxy1, proxy2`` — take the first hop.
        first = xff.split(",", 1)[0].strip()
        if first:
            return first
    if request.client is not None:
        return request.client.host or "unknown"
    return "unknown"
