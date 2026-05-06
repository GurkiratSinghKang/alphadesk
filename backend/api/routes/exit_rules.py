"""Admin CRUD for the exit_rules table (PM-5).

Wave 5A. Minimal surface — list, toggle, create, delete. The frontend
admin form (``frontend/src/app/(dashboard)/settings/page.tsx`` →
"Position Management Rules" section) talks to these endpoints. We
deliberately keep the API minimal so the engine evaluator
(``services.exit_rules.evaluate_exit_rules``) is the canonical source
of behaviour — the admin route is just glass for editing the rule
table.

All endpoints require auth; rule edits are sensitive (an enabled
21-DTE rule will close every position one Friday before opex).
"""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from core.database import get_db

logger = logging.getLogger("alphadesk.exit_rules")

router = APIRouter()


RuleType = Literal["profit_pct", "time_dte", "loss_pct", "delta_breach"]
RuleAction = Literal["close", "roll", "alert"]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ExitRuleOut(BaseModel):
    """Outbound row for the admin UI."""

    id: int
    strategy: str | None
    structure_type: str | None
    rule_type: RuleType
    threshold: float
    action: RuleAction
    enabled: bool
    priority: int
    description: str | None


class ExitRuleCreate(BaseModel):
    """Inbound payload for ``POST /api/v1/exit-rules``."""

    strategy: str | None = Field(default=None, max_length=60)
    structure_type: str | None = Field(default=None, max_length=40)
    rule_type: RuleType
    threshold: float = Field(gt=-1000.0, lt=1000.0)
    action: RuleAction
    enabled: bool = True
    priority: int = Field(default=100, ge=0, le=10_000)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("threshold")
    @classmethod
    def _threshold_range(cls, value: float) -> float:
        if value <= 0 and value != 0:
            # Negative thresholds make no sense for any current rule_type.
            raise ValueError("threshold must be > 0")
        return value


class ExitRulePatch(BaseModel):
    """Inbound payload for ``PATCH /api/v1/exit-rules/{id}``.

    Every field is optional — caller sends only the fields they want
    changed. Used by the per-row enable/disable toggle in the admin UI.
    """

    strategy: str | None = None
    structure_type: str | None = None
    rule_type: RuleType | None = None
    threshold: float | None = None
    action: RuleAction | None = None
    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=10_000)
    description: str | None = Field(default=None, max_length=500)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


def _row_to_out(row) -> ExitRuleOut:
    return ExitRuleOut(
        id=row.id,
        strategy=row.strategy,
        structure_type=row.structure_type,
        rule_type=row.rule_type,  # type: ignore[arg-type]
        threshold=float(row.threshold),
        action=row.action,  # type: ignore[arg-type]
        enabled=bool(row.enabled),
        priority=int(row.priority),
        description=row.description,
    )


@router.get("", response_model=list[ExitRuleOut])
async def list_exit_rules(db=Depends(get_db)) -> list[ExitRuleOut]:
    """List all exit rules — both enabled and disabled.

    The admin UI renders disabled rules in a muted style so the
    operator can re-enable them without re-creating from scratch.
    """
    from data.storage.models import ExitRule

    result = await db.execute(
        select(ExitRule).order_by(ExitRule.priority.asc(), ExitRule.id.asc())
    )
    return [_row_to_out(r) for r in result.scalars().all()]


@router.post("", response_model=ExitRuleOut, status_code=status.HTTP_201_CREATED)
async def create_exit_rule(payload: ExitRuleCreate, db=Depends(get_db)) -> ExitRuleOut:
    """Insert a new rule. Returns the canonical row including server id."""
    from data.storage.models import ExitRule

    row = ExitRule(
        strategy=payload.strategy or None,
        structure_type=payload.structure_type or None,
        rule_type=payload.rule_type,
        threshold=float(payload.threshold),
        action=payload.action,
        enabled=bool(payload.enabled),
        priority=int(payload.priority),
        description=payload.description,
    )
    try:
        db.add(row)
        await db.flush()
    except Exception:
        logger.exception("exit_rules: create failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not save exit rule. Check threshold/action values.",
        )

    return _row_to_out(row)


@router.patch("/{rule_id}", response_model=ExitRuleOut)
async def update_exit_rule(
    rule_id: int,
    payload: ExitRulePatch,
    db=Depends(get_db),
) -> ExitRuleOut:
    """Patch an existing rule (toggle enable/disable, edit threshold, …)."""
    from data.storage.models import ExitRule

    row = await db.get(ExitRule, rule_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        # Translate empty-string → NULL for nullable fields.
        if key in {"strategy", "structure_type", "description"} and value == "":
            value = None
        setattr(row, key, value)

    try:
        await db.flush()
    except Exception:
        logger.exception("exit_rules: patch failed for id=%s", rule_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not update exit rule. Check submitted values.",
        )

    return _row_to_out(row)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exit_rule(rule_id: int, db=Depends(get_db)) -> None:
    """Permanently remove a rule. The seed rules CAN be deleted —
    operators may want to drop the iron_condor 50% take-profit if their
    book runs different discipline. Re-create via POST if needed."""
    from data.storage.models import ExitRule

    row = await db.get(ExitRule, rule_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")

    try:
        await db.delete(row)
        await db.flush()
    except Exception:
        logger.exception("exit_rules: delete failed for id=%s", rule_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not delete exit rule.",
        )

    return None
