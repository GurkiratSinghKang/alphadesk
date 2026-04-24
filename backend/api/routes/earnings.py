"""/api/v1/earnings/* routes — thin wrappers over services.earnings_screener."""
from __future__ import annotations

import logging
import time
import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Request

from api.routes._rate_limit import check_full_research_rate
from api.schemas.earnings import CalendarResponse, EarningsDetail, ClaudeFullResearch
from services import earnings_screener

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/earnings", tags=["earnings"])

# Symbol must be 1-6 uppercase letters, optionally followed by a
# dot-letter suffix (BRK.B, BF.B, RDS.A). Anything with slashes, control
# chars, URL-encoded traversal sequences, lowercase, digits, or unusual
# punctuation fails the pattern with a 422 — before the string ever
# touches Redis cache keys or Claude prompts (B-51).
_SYMBOL_PATTERN = r"^[A-Z]{1,6}(\.[A-Z])?$"


@router.get("/calendar", response_model=CalendarResponse)
async def get_calendar(
    request: Request,
    window: str = Query("both", pattern="^(current|next|both)$"),
    min_iv_rank: float = Query(0, ge=0, le=100),
    bmo_amc: str = Query("both", pattern="^(bmo|amc|both)$"),
    watchlist_only: bool = False,
    sort: str = Query("date", pattern="^(date|iv_rank|yield|claude_confidence)$"),
) -> CalendarResponse:
    # B-33: propagate the real client IP so per-IP rate limiters downstream
    # see the caller instead of loopback.
    # B-66: `market_cap` query param removed — curated-universe filter is
    # always applied now. Frontend callers need to drop the param too.
    # B-68: emit structured request-boundary logs so Loki / CloudWatch can
    # compute p50/p95 latency, rows-returned distribution, and partial rate
    # without a full metrics library. ``request_id`` short-form so it's
    # greppable in oneliners. The request-id middleware in main.py sets a
    # proper X-Request-ID ContextVar that JsonFormatter picks up
    # automatically; this local id is the structured-log correlation key
    # in case the call is invoked outside a request (tests, bg tasks).
    client_host = request.client.host if request.client else None
    request_id = uuid.uuid4().hex[:8]
    t0 = time.perf_counter()
    logger.info(
        "calendar.request.start",
        extra={
            "event": "calendar",
            "stage": "start",
            "request_id": request_id,
            "window": window,
            "bmo_amc": bmo_amc,
            "sort": sort,
            "min_iv_rank": min_iv_rank,
        },
    )
    r = await earnings_screener.list_upcoming(
        window=window, min_iv_rank=min_iv_rank,
        bmo_amc=bmo_amc, watchlist_only=watchlist_only, sort=sort,
        client_host=client_host,
    )
    logger.info(
        "calendar.request.end",
        extra={
            "event": "calendar",
            "stage": "end",
            "request_id": request_id,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            "rows_returned": len(r.earnings),
            "partial": r.partial,
        },
    )
    return r


@router.get("/{symbol}/detail", response_model=EarningsDetail)
async def get_detail(
    symbol: Annotated[str, Path(pattern=_SYMBOL_PATTERN)],
) -> EarningsDetail:
    try:
        return await earnings_screener.get_detail(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{symbol}/full-research", response_model=ClaudeFullResearch)
async def post_full_research(
    symbol: Annotated[str, Path(pattern=_SYMBOL_PATTERN)],
    request: Request,
) -> ClaudeFullResearch:
    # Per-IP rate limit (B-50) — /full-research invokes Opus and costs
    # real money; 5 calls per 10 min is the cap. Runs BEFORE the service
    # so a stream of requests from a stuck client can't queue up Claude
    # calls waiting on the shared client lock.
    client_host = request.client.host if request.client else "unknown"
    await check_full_research_rate(client_host)
    try:
        return await earnings_screener.run_full_research(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
