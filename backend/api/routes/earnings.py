"""/api/v1/earnings/* routes — thin wrappers over services.earnings_screener."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from api.schemas.earnings import CalendarResponse, EarningsDetail, ClaudeFullResearch
from services import earnings_screener

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/earnings", tags=["earnings"])


@router.get("/calendar", response_model=CalendarResponse)
async def get_calendar(
    window: str = Query("both", pattern="^(current|next|both)$"),
    min_iv_rank: float = Query(0, ge=0, le=100),
    market_cap: str = Query("all", pattern="^(mega|large|mid|small|all)$"),
    bmo_amc: str = Query("both", pattern="^(bmo|amc|both)$"),
    watchlist_only: bool = False,
    sort: str = Query("date", pattern="^(date|iv_rank|yield|claude_confidence)$"),
) -> CalendarResponse:
    return await earnings_screener.list_upcoming(
        window=window, min_iv_rank=min_iv_rank, market_cap=market_cap,
        bmo_amc=bmo_amc, watchlist_only=watchlist_only, sort=sort,
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
