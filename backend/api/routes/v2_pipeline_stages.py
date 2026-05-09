"""B.1 — Per-stage pipeline pause/resume.

Replaces the global halt-only model with per-stage controls. The 5
stages (ingest / enrich / score / risk / execute) are seeded by the
0024_v2_phase_b migration.

Endpoints:
  GET  /api/v1/pipeline/stages
  POST /api/v1/pipeline/stages/{stage}/pause   (admin)
  POST /api/v1/pipeline/stages/{stage}/resume  (admin)
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.routes.auth import require_admin, require_auth
from core.audit import write_audit
from core.database import get_db


router = APIRouter(prefix="/pipeline/stages", tags=["pipeline-stages"])

CANONICAL_STAGES = {"ingest", "enrich", "score", "risk", "execute"}


class StageOut(BaseModel):
    stage: str
    is_paused: bool
    paused_by: str | None = None
    paused_at: str | None = None
    reason: str | None = None
    last_run_started_at: str | None = None
    last_run_finished_at: str | None = None
    last_run_status: str | None = None
    queue_depth: int = 0


class StagePauseRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=500)


def _row_to_out(row: Any) -> StageOut:
    return StageOut(
        stage=row.stage,
        is_paused=bool(row.is_paused),
        paused_by=row.paused_by,
        paused_at=row.paused_at.isoformat() if row.paused_at else None,
        reason=row.reason,
        last_run_started_at=row.last_run_started_at.isoformat() if row.last_run_started_at else None,
        last_run_finished_at=row.last_run_finished_at.isoformat() if row.last_run_finished_at else None,
        last_run_status=row.last_run_status,
        queue_depth=int(row.queue_depth or 0),
    )


@router.get("", response_model=list[StageOut])
async def list_stages(
    _: str = Depends(require_auth),
    db=Depends(get_db),
) -> list[StageOut]:
    from data.storage.models import PipelineStageState

    result = await db.execute(
        select(PipelineStageState).order_by(PipelineStageState.id.asc())
    )
    return [_row_to_out(r) for r in result.scalars().all()]


@router.post("/{stage}/pause", response_model=StageOut)
async def pause_stage(
    stage: str,
    payload: StagePauseRequest,
    actor: str = Depends(require_admin),
    db=Depends(get_db),
) -> StageOut:
    if stage not in CANONICAL_STAGES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown stage: {stage}")
    from data.storage.models import PipelineStageState
    from datetime import datetime, timezone

    result = await db.execute(
        select(PipelineStageState).where(PipelineStageState.stage == stage)
    )
    row = result.scalars().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Stage row missing: {stage}")
    if row.is_paused:
        return _row_to_out(row)
    row.is_paused = True
    row.paused_by = actor
    row.paused_at = datetime.now(timezone.utc)
    row.reason = payload.reason
    await db.commit()
    await db.refresh(row)
    await write_audit(
        event="pipeline_stage_paused",
        username=actor,
        ip=None,
        request_id=None,
        details={"stage": stage, "reason": payload.reason},
    )
    return _row_to_out(row)


@router.post("/{stage}/resume", response_model=StageOut)
async def resume_stage(
    stage: str,
    actor: str = Depends(require_admin),
    db=Depends(get_db),
) -> StageOut:
    if stage not in CANONICAL_STAGES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown stage: {stage}")
    from data.storage.models import PipelineStageState

    result = await db.execute(
        select(PipelineStageState).where(PipelineStageState.stage == stage)
    )
    row = result.scalars().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Stage row missing: {stage}")
    if not row.is_paused:
        return _row_to_out(row)
    row.is_paused = False
    row.paused_by = None
    row.paused_at = None
    row.reason = None
    await db.commit()
    await db.refresh(row)
    await write_audit(
        event="pipeline_stage_resumed",
        username=actor,
        ip=None,
        request_id=None,
        details={"stage": stage},
    )
    return _row_to_out(row)
