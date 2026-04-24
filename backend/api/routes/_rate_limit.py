"""In-process per-IP rate limiter for expensive Claude endpoints.

Why in-process (no Redis): AlphaDesk runs as a single uvicorn worker in
production; a deque-per-IP memory structure is the simplest thing that
works and has no new infra dependencies. The backing store is private —
if we ever scale to multi-worker (gunicorn --workers N) we swap this for
Redis. See B-50 follow-up.

Thread safety: FastAPI endpoints execute in the running asyncio loop, so
we guard the shared dict with an ``asyncio.Lock`` rather than
``threading.Lock``. Avoids the risk of two concurrent calls both seeing
``len(bucket) == _BUCKET_MAX - 1`` and both appending.
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException


# Full-research uses Opus for deep reasoning — each call costs ~$0.05–$0.30
# and takes 20–60s. Five per ten minutes is loose enough for a human
# exploring symbols but tight enough that a stuck client or a hostile
# script can't burn $100 in a minute.
_BUCKET_MAX: int = 5
_BUCKET_WINDOW_S: float = 600.0

_history: Dict[str, Deque[float]] = defaultdict(deque)
_lock: asyncio.Lock = asyncio.Lock()


async def check_full_research_rate(client_host: str) -> None:
    """Raises HTTPException(429) if client exceeds 5 calls per 10 minutes.

    Uses an in-process deque-per-IP; good enough for a single-worker deploy.
    For multi-worker deploys we'd swap the backing store to Redis — see
    B-50 follow-up.

    Keyspace hygiene: every call evicts the callers' own expired entries.
    When a caller's deque empties, we drop the dict key too so the
    ``_history`` dict can't grow unboundedly across scanner/botnet IPs
    (simplify-review follow-up — at 1M unique IPs the un-pruned dict
    would sit around 200 MB RSS).
    """
    now = time.monotonic()
    cutoff = now - _BUCKET_WINDOW_S
    async with _lock:
        bucket = _history[client_host]
        # Evict timestamps older than the window.
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= _BUCKET_MAX:
            # Retry-After in whole seconds until the oldest in-window call
            # rolls off the edge. Clamp at 1 so we never advertise "0s".
            retry_after = max(1, int(bucket[0] + _BUCKET_WINDOW_S - now) + 1)
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Too many full-research requests — max {_BUCKET_MAX} "
                    f"per {int(_BUCKET_WINDOW_S)}s. Retry in {retry_after}s."
                ),
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)
        # If *another* caller's bucket is empty after their own eviction
        # sweep (or this caller's bucket was empty and the append above
        # just seeded it — ignored here), they'd linger in ``_history``
        # forever. Periodic pruning: every time the current caller's
        # bucket crosses the max threshold, drop any empty buckets in
        # the dict. O(n) per prune, bounded by how often we hit the cap.
        if len(bucket) == _BUCKET_MAX:
            empty_keys = [k for k, q in _history.items() if not q]
            for k in empty_keys:
                del _history[k]


def _reset_for_tests() -> None:
    """Test-only helper: wipe all per-IP history between test cases so they
    don't bleed state into each other. NOT exposed as a public API."""
    _history.clear()
