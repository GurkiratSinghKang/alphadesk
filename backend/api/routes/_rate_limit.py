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

Round-4 CLUSTER 2 #8 / CLUSTER 6 #23: a second bucket protects /detail
(looser cap — Sonnet-tier calls cost less but a hot-looping client can
still rack up bills). A periodic background sweep clears empty buckets
even when callers don't hit the cap (the prior code's pruning only
fired at saturation, so a slow scan that never hit cap left empty
deques accumulating in the dict — slowloris-resistant fix).
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException

from core.config import settings

logger = logging.getLogger(__name__)


# Full-research uses Opus for deep reasoning — each call costs ~$0.05–$0.30
# and takes 20–60s. Five per ten minutes is loose enough for a human
# exploring symbols but tight enough that a stuck client or a hostile
# script can't burn $100 in a minute.
#
# Batch U (A-6 through A-9): defaults live in core.config.settings.
# Module-level constants populated at import time from settings values.
_BUCKET_MAX: int = int(settings.RATE_LIMIT_FULL_RESEARCH_MAX)
_BUCKET_WINDOW_S: float = float(settings.RATE_LIMIT_FULL_RESEARCH_WINDOW_SECONDS)

# Round-4 CLUSTER 2 #8: /detail is a Sonnet-tier call (cheaper) but the
# detail endpoint also fans out to FMP/Alpaca/Newsdata so we want a
# looser cap that still bounds the abuse case.
_DETAIL_BUCKET_MAX: int = int(settings.RATE_LIMIT_DETAIL_MAX)
_DETAIL_BUCKET_WINDOW_S: float = float(settings.RATE_LIMIT_DETAIL_WINDOW_SECONDS)

# Batch S: /earnings/{symbol}/analysis triggers a Claude lookup if the
# pre-warm cache is cold ($0.30 per uncached call) and orchestrates 6
# upstream services. Cap at 30 / minute per IP — generous enough for an
# analyst rapid-cycling symbols, tight enough to bound the cost of a
# stuck client. The 100/min global cap below protects the daily budget.
_ANALYSIS_BUCKET_MAX: int = int(settings.RATE_LIMIT_ANALYSIS_PER_IP)
_ANALYSIS_BUCKET_WINDOW_S: float = float(settings.RATE_LIMIT_ANALYSIS_PER_IP_WINDOW_SECONDS)
_ANALYSIS_GLOBAL_MAX: int = int(settings.RATE_LIMIT_ANALYSIS_GLOBAL)
_ANALYSIS_GLOBAL_WINDOW_S: float = float(settings.RATE_LIMIT_ANALYSIS_GLOBAL_WINDOW_SECONDS)

# PM-C: per-contract NBBO snapshot. The frontend polls this endpoint every
# ~2 seconds per open row, so the per-IP cap has to leave headroom for a
# user with ~20 open rows (20 rows × 30 calls/min/row = 600 calls/min in the
# uncached worst case — but the 2s service-layer cache keeps the realistic
# per-row upstream rate around 1-2 calls/min). 60/min/IP is the abuse
# ceiling for the route, not the steady-state load.
_CONTRACT_SNAPSHOT_BUCKET_MAX: int = int(getattr(settings, "RATE_LIMIT_CONTRACT_SNAPSHOT_PER_IP", 60))
_CONTRACT_SNAPSHOT_BUCKET_WINDOW_S: float = float(
    getattr(settings, "RATE_LIMIT_CONTRACT_SNAPSHOT_PER_IP_WINDOW_SECONDS", 60.0)
)

_history: Dict[str, Deque[float]] = defaultdict(deque)
_detail_history: Dict[str, Deque[float]] = defaultdict(deque)
_analysis_history: Dict[str, Deque[float]] = defaultdict(deque)
_analysis_global_history: Deque[float] = deque()
_contract_snapshot_history: Dict[str, Deque[float]] = defaultdict(deque)
_lock: asyncio.Lock = asyncio.Lock()
_detail_lock: asyncio.Lock = asyncio.Lock()
_analysis_lock: asyncio.Lock = asyncio.Lock()
_analysis_global_lock: asyncio.Lock = asyncio.Lock()
_contract_snapshot_lock: asyncio.Lock = asyncio.Lock()


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
    await _check_bucket(
        client_host,
        _history,
        _lock,
        _BUCKET_MAX,
        _BUCKET_WINDOW_S,
        bucket_label="full-research",
    )


async def check_detail_rate(client_host: str) -> None:
    """Round-4 CLUSTER 2 #8: per-IP rate limit on the /detail endpoint.

    Detail fires a Claude (Sonnet) structured call on cache miss and a
    fan-out of FMP/Alpaca/Newsdata; without a cap a hot-loop can still
    ring up real cost. 30 per 10min is generous for a human exploring
    symbols and tight enough to bound the abuse case.
    """
    await _check_bucket(
        client_host,
        _detail_history,
        _detail_lock,
        _DETAIL_BUCKET_MAX,
        _DETAIL_BUCKET_WINDOW_S,
        bucket_label="detail",
    )


async def check_analysis_rate(client_host: str) -> None:
    """Batch S: per-IP + global rate limit on the /analysis endpoint.

    The analysis endpoint orchestrates 6 upstream services and triggers
    a Claude lookup on cache miss ($0.30 per uncached call). Cap each IP
    at 30/min to prevent any single client from burning the daily budget
    while leaving plenty of headroom for an analyst exploring symbols.
    The global 100/min cap protects the shared Claude budget when
    multiple analysts hit the endpoint simultaneously.
    """
    # Per-IP bucket first — cheaper to reject before touching the global
    # bucket lock, and keeps the per-IP error message specific.
    await _check_bucket(
        client_host,
        _analysis_history,
        _analysis_lock,
        _ANALYSIS_BUCKET_MAX,
        _ANALYSIS_BUCKET_WINDOW_S,
        bucket_label="analysis",
    )
    # Global bucket — single shared deque, no per-key dict.
    now = time.monotonic()
    cutoff = now - _ANALYSIS_GLOBAL_WINDOW_S
    async with _analysis_global_lock:
        while _analysis_global_history and _analysis_global_history[0] < cutoff:
            _analysis_global_history.popleft()
        if len(_analysis_global_history) >= _ANALYSIS_GLOBAL_MAX:
            retry_after = max(
                1, int(_analysis_global_history[0] + _ANALYSIS_GLOBAL_WINDOW_S - now) + 1
            )
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Global analysis rate limit hit ({_ANALYSIS_GLOBAL_MAX}/"
                    f"{int(_ANALYSIS_GLOBAL_WINDOW_S)}s) — protecting Claude "
                    f"daily budget. Retry in {retry_after}s."
                ),
                headers={"Retry-After": str(retry_after)},
            )
        _analysis_global_history.append(now)


async def check_contract_snapshot_rate(client_host: str) -> None:
    """PM-C: per-IP rate limit on the contract-snapshot endpoint.

    The endpoint is hit by the frontend NBBO display at ~2s per open row.
    A user with one open row generates 30 calls / minute; the cap at 60/min
    leaves headroom for two simultaneously-open rows (the realistic upper
    bound for a focused trading session). Past that, the service-layer
    2s cache absorbs the load — but the rate limit guards against a stuck
    or hostile client polling without throttling.
    """
    await _check_bucket(
        client_host,
        _contract_snapshot_history,
        _contract_snapshot_lock,
        _CONTRACT_SNAPSHOT_BUCKET_MAX,
        _CONTRACT_SNAPSHOT_BUCKET_WINDOW_S,
        bucket_label="contract-snapshot",
    )


async def _check_bucket(
    client_host: str,
    history: Dict[str, Deque[float]],
    lock: asyncio.Lock,
    max_calls: int,
    window_s: float,
    *,
    bucket_label: str,
) -> None:
    """Shared rate-limit core. Same eviction + empty-bucket-pruning logic
    as the legacy full-research path, parameterised over the bucket cap
    and window."""
    now = time.monotonic()
    cutoff = now - window_s
    async with lock:
        bucket = history[client_host]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= max_calls:
            retry_after = max(1, int(bucket[0] + window_s - now) + 1)
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Too many {bucket_label} requests — max {max_calls} "
                    f"per {int(window_s)}s. Retry in {retry_after}s."
                ),
                headers={"Retry-After": str(retry_after)},
            )
        bucket.append(now)
        if len(bucket) == max_calls:
            empty_keys = [k for k, q in history.items() if not q]
            for k in empty_keys:
                del history[k]


# Round-4 CLUSTER 6 #23: slowloris-resistant periodic sweep. The previous
# pruning only fired when a caller saturated their bucket; a stream of
# callers each making a single request and never coming back left the
# dict growing unboundedly (each abandoned deque was empty after the
# window passed but never cleaned up). Drive a sweep every 60s from the
# app lifespan.
_SWEEP_INTERVAL_S = 60.0
_sweep_task: asyncio.Task | None = None


async def _periodic_sweep_once() -> None:
    """Walk both rate-limit dicts, drop any deque whose newest entry is
    older than the bucket window. The newest entry's age is the right
    metric: even if the deque is non-empty, we can drop it once every
    timestamp has aged out (so the next caller from that IP sees a
    fresh, empty deque)."""
    now = time.monotonic()
    for label, dct, lock, window in (
        ("full-research", _history, _lock, _BUCKET_WINDOW_S),
        ("detail", _detail_history, _detail_lock, _DETAIL_BUCKET_WINDOW_S),
    ):
        async with lock:
            cutoff = now - window
            stale = [
                k for k, q in dct.items() if not q or q[-1] < cutoff
            ]
            for k in stale:
                dct.pop(k, None)
            if stale:
                logger.debug(
                    "rate-limit: swept %d stale %s buckets", len(stale), label,
                )


async def _periodic_sweep_loop() -> None:
    """Background loop driver — keeps sweeping every _SWEEP_INTERVAL_S.

    Run for the lifetime of the app; cancel from the lifespan shutdown
    hook. Catches and logs all exceptions so a single sweep failure
    doesn't kill the loop forever.

    Round-5 Cluster D H-6/H-7: every 60th iteration emits an
    ``ops_heartbeat`` INFO line carrying the current sizes of the
    rate-limit dicts AND the screener's module-level dedup dicts so a
    memory-leak pattern shows up in Loki/CloudWatch dashboards before
    the worker hits OOM.
    """
    iter_count = 0
    while True:
        try:
            await asyncio.sleep(_SWEEP_INTERVAL_S)
            await _periodic_sweep_once()
            iter_count += 1
            # Emit ops heartbeat hourly (60 iterations × 60s = ~1h).
            if iter_count % 60 == 0:
                try:
                    from services.earnings_screener import (
                        _FMP_UPCOMING_LOCKS,
                        _inflight_structured,
                    )
                    fmp_locks_size = len(_FMP_UPCOMING_LOCKS)
                    inflight_size = len(_inflight_structured)
                except Exception:
                    fmp_locks_size = -1
                    inflight_size = -1
                logger.info(
                    "rate-limit.sweep.heartbeat",
                    extra={
                        "event": "ops_heartbeat",
                        "iterations_since_last": 60,
                        "rl_history_size": len(_history),
                        "rl_detail_history_size": len(_detail_history),
                        "fmp_upcoming_locks_size": fmp_locks_size,
                        "inflight_structured_size": inflight_size,
                    },
                )
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.warning("rate-limit periodic sweep raised", exc_info=True)


def start_periodic_sweep() -> asyncio.Task:
    """Boot the background sweep task. Call from main.py's lifespan
    startup hook. Returns the task handle so the caller can cancel it
    on shutdown."""
    global _sweep_task
    if _sweep_task is not None and not _sweep_task.done():
        return _sweep_task
    _sweep_task = asyncio.create_task(_periodic_sweep_loop())
    return _sweep_task


async def stop_periodic_sweep() -> None:
    global _sweep_task
    if _sweep_task is None:
        return
    _sweep_task.cancel()
    try:
        await _sweep_task
    except (asyncio.CancelledError, Exception):
        pass
    _sweep_task = None


def _reset_for_tests() -> None:
    """Test-only helper: wipe all per-IP history between test cases so they
    don't bleed state into each other. NOT exposed as a public API."""
    _history.clear()
    _detail_history.clear()
    _analysis_history.clear()
    _analysis_global_history.clear()
    _contract_snapshot_history.clear()
