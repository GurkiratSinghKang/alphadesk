"""Ticker intelligence context endpoints."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import ValidationError

from services.ticker_context import (
    TickerContextRequest,
    TickerContextResponse,
    get_ticker_context,
)

router = APIRouter()


@router.get("/context", response_model=TickerContextResponse)
async def get_context(
    symbols: str = Query(..., description="Comma-separated ticker symbols."),
    needs: str = Query(
        "quote,options_summary,earnings,research",
        description="Comma-separated fact needs: quote, options_summary, earnings, research, news, market_regime.",
    ),
    max_age_seconds: int | None = Query(None, ge=1, le=7 * 24 * 3600),
    on_stale: Literal["allow", "refresh", "reject", "allow_with_warning"] = Query("allow_with_warning"),
) -> TickerContextResponse:
    try:
        request = TickerContextRequest(
            symbols=symbols,
            needs=needs,
            max_age_seconds=max_age_seconds,
            on_stale=on_stale,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_context=False)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await get_ticker_context(
        request.symbols,
        needs=request.needs,
        max_age_seconds=request.max_age_seconds,
        on_stale=request.on_stale,
    )
