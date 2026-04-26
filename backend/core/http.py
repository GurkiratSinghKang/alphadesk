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

    Returns ``request.client.host`` and trusts uvicorn's
    :class:`ProxyHeadersMiddleware` (configured in ``main.py`` with the
    trusted-proxy CIDR list) to have already rewritten that field to the
    ``X-Forwarded-For`` first hop *only* when the connecting peer is
    actually a trusted proxy.

    Round-7 / BE-1: the previous implementation re-read the raw
    ``X-Forwarded-For`` header unconditionally and returned its first
    hop, completely ignoring the trust gate the middleware enforces.
    A direct caller (or one going through Caddy with their own forged
    XFF) could rotate spoofed first-hop IPs every request and never
    trip the per-IP rate-limit ceiling. By delegating to
    ``request.client.host`` we inherit the middleware's policy: when
    the TCP peer is in ``_TRUSTED_PROXY_HOSTS`` (Caddy on the bridge
    network, loopback) the host has already been replaced with the
    real client IP from XFF; otherwise it stays the direct peer's
    address and XFF is ignored.

    Returns ``"unknown"`` if no client info is available so rate-limit
    buckets still key on a stable string instead of ``None``.
    """
    if request.client is not None:
        return request.client.host or "unknown"
    return "unknown"
