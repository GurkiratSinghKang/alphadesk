from __future__ import annotations

import logging
import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from core.auth import require_auth
from core.config import settings
from services.tradingagents_research import (
    ADVISORY_DISCLAIMER,
    TradingAgentsRunError,
    list_tradingagents_runs,
    normalize_provider,
    normalize_symbol,
    normalize_trade_date,
    get_tradingagents_runtime_status,
    start_tradingagents_run,
    get_tradingagents_run,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_RATE_LIMIT_WINDOW_SECONDS = 60 * 60
_INMEM_HITS: dict[str, list[float]] = {}
_INMEM_MAX_KEYS = 10_000


class TradingAgentsRunRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=12)
    trade_date: str | None = Field(
        None,
        description="Research date in YYYY-MM-DD. Defaults to today.",
    )
    provider: str | None = Field(
        None,
        description="LLM provider override. Defaults to TRADINGAGENTS_PROVIDER.",
    )
    deep_model: str | None = Field(None, max_length=80)
    quick_model: str | None = Field(None, max_length=80)
    research_depth: int = Field(1, ge=1, le=3)
    reason: str | None = Field(None, max_length=500)

    @field_validator("symbol")
    @classmethod
    def _validate_symbol(cls, value: str) -> str:
        return normalize_symbol(value)

    @field_validator("trade_date")
    @classmethod
    def _validate_trade_date(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        return normalize_trade_date(value)

    @field_validator("provider")
    @classmethod
    def _validate_provider(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        return normalize_provider(value)


class TradingAgentsRunErrorPayload(BaseModel):
    code: str
    message: str


class TradingAgentsRunResponse(BaseModel):
    run_id: str
    symbol: str
    trade_date: str
    status: Literal["queued", "running", "succeeded", "failed"]
    provider: str
    deep_model: str
    quick_model: str
    research_depth: int
    summary_lines: list[str] = Field(default_factory=list)
    decision_text: str | None = None
    artifact_files: list[str] = Field(default_factory=list)
    error: TradingAgentsRunErrorPayload | None = None
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None
    advisory_disclaimer: str = ADVISORY_DISCLAIMER


class TradingAgentsRuntimeStatus(BaseModel):
    enabled: bool
    ready: bool
    script_path: str
    script_exists: bool
    script_runnable: bool
    skill_home: str
    runtime_python_exists: bool
    upstream_checkout_exists: bool
    installed_ref: str | None = None
    bootstrap_required: bool
    provider: str
    provider_env: str | None = None
    provider_key_configured: bool
    deep_model: str
    quick_model: str
    output_language: str
    timeout_s: int
    runs_per_hour: int
    history_limit: int
    warnings: list[str] = Field(default_factory=list)


def _inmem_incr(key: str) -> int:
    now = time.time()
    window_start = now - _RATE_LIMIT_WINDOW_SECONDS
    if len(_INMEM_HITS) > _INMEM_MAX_KEYS:
        _INMEM_HITS.clear()
    hits = _INMEM_HITS.setdefault(key, [])
    hits[:] = [t for t in hits if t >= window_start]
    hits.append(now)
    return len(hits)


async def _enforce_run_rate_limit(username: str) -> None:
    key = f"tradingagents_runs:{username}"
    limit = max(settings.TRADINGAGENTS_RUNS_PER_HOUR, 1)
    count: int
    try:
        from core.redis import get_redis

        redis = await get_redis()
        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, _RATE_LIMIT_WINDOW_SECONDS, nx=True)
        incr_result, _ = await pipe.execute()
        count = int(incr_result)
    except Exception as exc:
        logger.warning(
            "TradingAgents run rate limit using in-memory fallback: %s",
            exc,
            exc_info=True,
        )
        count = _inmem_incr(key)
    if count > limit:
        raise HTTPException(
            status_code=429,
            detail=(
                "TradingAgents run limit exceeded. Max "
                f"{limit} research runs per hour per user."
            ),
            headers={"Retry-After": str(_RATE_LIMIT_WINDOW_SECONDS)},
        )


@router.get("/runtime", response_model=TradingAgentsRuntimeStatus)
async def get_runtime_status(
    username: str = Depends(require_auth),
) -> dict[str, Any]:
    _ = username
    return get_tradingagents_runtime_status()


@router.post("/runs", response_model=TradingAgentsRunResponse, status_code=202)
async def create_tradingagents_run(
    request: TradingAgentsRunRequest,
    username: str = Depends(require_auth),
) -> dict[str, Any]:
    await _enforce_run_rate_limit(username)
    try:
        return await start_tradingagents_run(username, request.model_dump())
    except TradingAgentsRunError as exc:
        raise HTTPException(status_code=503, detail=exc.message) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/runs", response_model=list[TradingAgentsRunResponse])
async def list_runs(
    limit: int = Query(20, ge=1, le=100),
    username: str = Depends(require_auth),
) -> list[dict[str, Any]]:
    return await list_tradingagents_runs(username, limit=limit)


@router.get("/runs/{run_id}", response_model=TradingAgentsRunResponse)
async def get_run(
    run_id: str,
    username: str = Depends(require_auth),
) -> dict[str, Any]:
    record = await get_tradingagents_run(username, run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="TradingAgents run not found")
    return record
