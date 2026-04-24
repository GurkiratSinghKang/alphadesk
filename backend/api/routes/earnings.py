"""/api/v1/earnings/* routes — thin wrappers over services.earnings_screener."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, Request

from api.schemas.earnings import CalendarResponse, EarningsDetail, ClaudeFullResearch
from services import earnings_screener

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/earnings", tags=["earnings"])


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
    client_host = request.client.host if request.client else None
    return await earnings_screener.list_upcoming(
        window=window, min_iv_rank=min_iv_rank,
        bmo_amc=bmo_amc, watchlist_only=watchlist_only, sort=sort,
        client_host=client_host,
    )


@router.get("/{symbol}/detail", response_model=EarningsDetail)
async def get_detail(symbol: str) -> EarningsDetail:
    try:
        return await earnings_screener.get_detail(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{symbol}/full-research", response_model=ClaudeFullResearch)
async def post_full_research(symbol: str) -> ClaudeFullResearch:
    try:
        return await earnings_screener.run_full_research(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
