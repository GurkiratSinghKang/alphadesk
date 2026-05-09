"""v2 Phase B miscellaneous read-mostly routes.

Bundles the lighter-weight v2 backend extensions so the routes
module count stays manageable. Each section is independent; the
underlying models live in models.py and the migration in
0024_v2_phase_b.

Sections:
  - B.5  Applicant approval workflow templates (read)
  - B.9  Strategy playbook (read current; create version)
  - B.10 Backtest workbench (queue run; list runs)
  - B.11 Onboarding questionnaire (read/patch state)
  - B.12 Reports (list runs)
  - B.13 Tax / lots (list lots; list wash sales)
  - B.14 Impersonation (start/stop session — feature-flag-gated)
  - B.15 Bulk user actions (suspend / message)
  - B.17 Billing (list plans; current subscription)
  - B.18 Documentation (list categories; list articles)
  - B.7  Jarvis intent log (read)

Heavier compute (Stripe webhook signing, backtest orchestration,
wash-sale rule engine, recommendation engine, PDF report generation)
remains a Phase 1.x follow-up — these stubs return correctly-shaped
data backed by the v2 model layer.
"""
from __future__ import annotations

from datetime import datetime, date, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.routes.auth import require_admin, require_auth
from core.audit import write_audit
from core.database import get_db


# ── B.5 Templates (read) ────────────────────────────────────────────
templates_router = APIRouter(prefix="/access-requests/templates", tags=["access-requests"])


class TemplateOut(BaseModel):
    slug: str
    title: str
    body: str


@templates_router.get("/reject-reasons", response_model=list[TemplateOut])
async def list_reject_reasons(
    _: str = Depends(require_admin), db=Depends(get_db)
) -> list[TemplateOut]:
    from data.storage.models import RejectReasonTemplate

    result = await db.execute(select(RejectReasonTemplate).order_by(RejectReasonTemplate.id.asc()))
    return [TemplateOut(slug=r.slug, title=r.title, body=r.body) for r in result.scalars().all()]


@templates_router.get("/welcome", response_model=list[TemplateOut])
async def list_welcome_templates(
    _: str = Depends(require_admin), db=Depends(get_db)
) -> list[TemplateOut]:
    from data.storage.models import WelcomeTemplate

    result = await db.execute(select(WelcomeTemplate).order_by(WelcomeTemplate.id.asc()))
    return [TemplateOut(slug=r.slug, title=r.title, body=r.body) for r in result.scalars().all()]


# ── B.9 Strategy playbook ───────────────────────────────────────────
playbook_router = APIRouter(prefix="/strategies", tags=["strategy-playbook-v2"])


class PlaybookOut(BaseModel):
    strategy: str
    current_version: int
    content: dict | None = None


@playbook_router.get("/{strategy}/playbook", response_model=PlaybookOut)
async def get_playbook(
    strategy: str, _: str = Depends(require_auth), db=Depends(get_db)
) -> PlaybookOut:
    from data.storage.models import StrategyPlaybook, StrategyPlaybookVersion

    pb = (
        await db.execute(select(StrategyPlaybook).where(StrategyPlaybook.strategy == strategy))
    ).scalars().first()
    if pb is None:
        return PlaybookOut(strategy=strategy, current_version=0, content=None)
    version = (
        await db.execute(
            select(StrategyPlaybookVersion).where(
                StrategyPlaybookVersion.playbook_id == pb.id,
                StrategyPlaybookVersion.version == pb.current_version,
            )
        )
    ).scalars().first()
    return PlaybookOut(
        strategy=strategy,
        current_version=int(pb.current_version),
        content=version.content if version else None,
    )


# ── B.10 Backtest workbench (list + create) ─────────────────────────
backtest_router = APIRouter(prefix="/backtest/runs", tags=["backtest-v2"])


class BacktestRunOut(BaseModel):
    id: int
    strategy: str
    status: str
    progress: float
    start_date: str
    end_date: str
    metrics: dict | None = None
    created_at: str


class BacktestRunCreate(BaseModel):
    strategy: str = Field(..., min_length=1, max_length=60)
    start_date: date
    end_date: date
    universe: dict | None = None
    cost_model: dict | None = None
    sweep_params: dict | None = None


@backtest_router.get("", response_model=list[BacktestRunOut])
async def list_backtest_runs(
    strategy: str | None = None,
    limit: int = 50,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> list[BacktestRunOut]:
    from data.storage.models import BacktestRun

    stmt = select(BacktestRun).where(BacktestRun.username == username)
    if strategy:
        stmt = stmt.where(BacktestRun.strategy == strategy)
    stmt = stmt.order_by(BacktestRun.created_at.desc()).limit(min(limit, 200))
    result = await db.execute(stmt)
    return [
        BacktestRunOut(
            id=int(r.id),
            strategy=r.strategy,
            status=r.status,
            progress=float(r.progress),
            start_date=r.start_date.isoformat(),
            end_date=r.end_date.isoformat(),
            metrics=r.metrics,
            created_at=r.created_at.isoformat(),
        )
        for r in result.scalars().all()
    ]


@backtest_router.post("", response_model=BacktestRunOut, status_code=status.HTTP_202_ACCEPTED)
async def queue_backtest_run(
    payload: BacktestRunCreate,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> BacktestRunOut:
    from data.storage.models import BacktestRun

    row = BacktestRun(
        username=username,
        strategy=payload.strategy,
        start_date=payload.start_date,
        end_date=payload.end_date,
        universe=payload.universe,
        cost_model=payload.cost_model,
        sweep_params=payload.sweep_params,
        status="queued",
        progress=0.0,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await write_audit(
        event="backtest_started",
        username=username,
        ip=None,
        request_id=None,
        details={"run_id": row.id, "strategy": payload.strategy},
    )
    return BacktestRunOut(
        id=int(row.id),
        strategy=row.strategy,
        status=row.status,
        progress=float(row.progress),
        start_date=row.start_date.isoformat(),
        end_date=row.end_date.isoformat(),
        metrics=row.metrics,
        created_at=row.created_at.isoformat(),
    )


# ── B.11 Onboarding state ───────────────────────────────────────────
onboarding_router = APIRouter(prefix="/onboarding", tags=["onboarding-v2"])


class OnboardingState(BaseModel):
    step: str
    answers: dict | None = None
    submitted_at: str | None = None


class OnboardingPatch(BaseModel):
    step: str | None = None
    answers: dict | None = None


@onboarding_router.get("/state", response_model=OnboardingState)
async def get_onboarding_state(
    username: str = Depends(require_auth), db=Depends(get_db)
) -> OnboardingState:
    from data.storage.models import OnboardingQuestionnaire

    row = (
        await db.execute(
            select(OnboardingQuestionnaire).where(OnboardingQuestionnaire.username == username)
        )
    ).scalars().first()
    if row is None:
        return OnboardingState(step="not_started", answers=None, submitted_at=None)
    return OnboardingState(
        step=row.step,
        answers=row.answers,
        submitted_at=row.submitted_at.isoformat() if row.submitted_at else None,
    )


@onboarding_router.patch("/answers", response_model=OnboardingState)
async def patch_onboarding(
    payload: OnboardingPatch,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> OnboardingState:
    from data.storage.models import OnboardingQuestionnaire

    row = (
        await db.execute(
            select(OnboardingQuestionnaire).where(OnboardingQuestionnaire.username == username)
        )
    ).scalars().first()
    if row is None:
        row = OnboardingQuestionnaire(username=username)
        db.add(row)
    if payload.answers is not None:
        existing = row.answers if isinstance(row.answers, dict) else {}
        existing.update(payload.answers)
        row.answers = existing
    if payload.step is not None:
        row.step = payload.step
    await db.commit()
    await db.refresh(row)
    return OnboardingState(
        step=row.step,
        answers=row.answers,
        submitted_at=row.submitted_at.isoformat() if row.submitted_at else None,
    )


# ── B.12 Reports list ───────────────────────────────────────────────
reports_v2_router = APIRouter(prefix="/reports/runs", tags=["reports-v2"])


class ReportRunOut(BaseModel):
    id: int
    report_type: str
    status: str
    period_start: str
    period_end: str
    pdf_uri: str | None = None
    ai_summary: str | None = None
    created_at: str


@reports_v2_router.get("", response_model=list[ReportRunOut])
async def list_report_runs(
    report_type: str | None = None,
    limit: int = 50,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> list[ReportRunOut]:
    from data.storage.models import ReportRun

    stmt = select(ReportRun).where(ReportRun.username == username)
    if report_type:
        stmt = stmt.where(ReportRun.report_type == report_type)
    stmt = stmt.order_by(ReportRun.created_at.desc()).limit(min(limit, 200))
    result = await db.execute(stmt)
    return [
        ReportRunOut(
            id=int(r.id),
            report_type=r.report_type,
            status=r.status,
            period_start=r.period_start.isoformat(),
            period_end=r.period_end.isoformat(),
            pdf_uri=r.pdf_uri,
            ai_summary=r.ai_summary,
            created_at=r.created_at.isoformat(),
        )
        for r in result.scalars().all()
    ]


# ── B.13 Tax / lots (list) ──────────────────────────────────────────
tax_router = APIRouter(prefix="/tax", tags=["tax-v2"])


class LotOut(BaseModel):
    id: int
    symbol: str
    acquisition_date: str
    acquisition_qty: float
    acquisition_price: float
    disposed_qty: float
    holding_period_classification: str | None = None


class WashSaleOut(BaseModel):
    id: int
    loss_lot_id: int
    replacement_lot_id: int
    disallowed_loss_amount: float
    rule_window_days: int
    applied_at: str


@tax_router.get("/lots", response_model=list[LotOut])
async def list_lots(
    symbol: str | None = None,
    open_only: bool = False,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> list[LotOut]:
    from data.storage.models import Lot

    stmt = select(Lot).where(Lot.username == username)
    if symbol:
        stmt = stmt.where(Lot.symbol == symbol.upper())
    result = await db.execute(stmt.order_by(Lot.acquisition_date.desc()))
    rows = result.scalars().all()
    if open_only:
        rows = [r for r in rows if (r.disposed_qty or 0) < (r.acquisition_qty or 0)]
    return [
        LotOut(
            id=int(r.id),
            symbol=r.symbol,
            acquisition_date=r.acquisition_date.isoformat(),
            acquisition_qty=float(r.acquisition_qty),
            acquisition_price=float(r.acquisition_price),
            disposed_qty=float(r.disposed_qty or 0),
            holding_period_classification=r.holding_period_classification,
        )
        for r in rows
    ]


@tax_router.get("/wash-sales", response_model=list[WashSaleOut])
async def list_wash_sales(
    _: str = Depends(require_auth), db=Depends(get_db)
) -> list[WashSaleOut]:
    from data.storage.models import WashSaleAdjustment

    result = await db.execute(
        select(WashSaleAdjustment).order_by(WashSaleAdjustment.applied_at.desc())
    )
    return [
        WashSaleOut(
            id=int(r.id),
            loss_lot_id=int(r.loss_lot_id),
            replacement_lot_id=int(r.replacement_lot_id),
            disallowed_loss_amount=float(r.disallowed_loss_amount),
            rule_window_days=int(r.rule_window_days),
            applied_at=r.applied_at.isoformat(),
        )
        for r in result.scalars().all()
    ]


# ── B.14 Impersonation (gated) ─────────────────────────────────────
impersonation_router = APIRouter(prefix="/admin/impersonate", tags=["impersonation"])


class ImpersonationStart(BaseModel):
    target_username: str
    reason: str = Field(..., min_length=4, max_length=500)


class ImpersonationOut(BaseModel):
    session_id: int
    operator: str
    target: str
    started_at: str


@impersonation_router.post("/start", response_model=ImpersonationOut, status_code=status.HTTP_201_CREATED)
async def start_impersonation(
    payload: ImpersonationStart,
    actor: str = Depends(require_admin),
    db=Depends(get_db),
) -> ImpersonationOut:
    from data.storage.models import ImpersonationSession

    # Phase 1 gate: feature-flagged off by default. Operators must enable
    # via /admin/feature-flags/admin.impersonation. The middleware that
    # enforces read-only mode + sticky banner ships in the Phase 1.6h
    # follow-up cycle (see plan §1.6h + B.14 risk register).
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        "Impersonation is feature-flagged off until consent flow ships",
    )


@impersonation_router.get("/active")
async def active_impersonation(
    actor: str = Depends(require_admin), db=Depends(get_db)
) -> dict[str, Any]:
    from data.storage.models import ImpersonationSession

    result = await db.execute(
        select(ImpersonationSession)
        .where(
            ImpersonationSession.operator_username == actor,
            ImpersonationSession.ended_at.is_(None),
        )
        .order_by(ImpersonationSession.started_at.desc())
        .limit(1)
    )
    row = result.scalars().first()
    if row is None:
        return {"active": False}
    return {
        "active": True,
        "session_id": int(row.id),
        "target": row.target_username,
        "started_at": row.started_at.isoformat(),
    }


# ── B.17 Billing ────────────────────────────────────────────────────
billing_router = APIRouter(prefix="/billing", tags=["billing"])


class PlanOut(BaseModel):
    tier_slug: str
    display_name: str
    monthly_price_usd: float
    max_brokers: int
    paper_only: bool


class SubscriptionOut(BaseModel):
    plan_slug: str
    status: str
    started_at: str
    current_period_end: str | None = None


@billing_router.get("/plans", response_model=list[PlanOut])
async def list_plans(db=Depends(get_db)) -> list[PlanOut]:
    """Public — no auth required."""
    from data.storage.models import Plan

    result = await db.execute(
        select(Plan).where(Plan.is_active == True).order_by(Plan.monthly_price_usd.asc())
    )
    return [
        PlanOut(
            tier_slug=r.tier_slug,
            display_name=r.display_name,
            monthly_price_usd=float(r.monthly_price_usd),
            max_brokers=int(r.max_brokers),
            paper_only=bool(r.paper_only),
        )
        for r in result.scalars().all()
    ]


@billing_router.get("/subscription", response_model=SubscriptionOut | None)
async def get_subscription(
    username: str = Depends(require_auth), db=Depends(get_db)
) -> SubscriptionOut | None:
    from data.storage.models import Subscription, Plan

    result = await db.execute(
        select(Subscription).where(Subscription.username == username)
        .order_by(Subscription.started_at.desc())
        .limit(1)
    )
    sub = result.scalars().first()
    if sub is None:
        return None
    plan = (await db.execute(select(Plan).where(Plan.id == sub.plan_id))).scalars().first()
    return SubscriptionOut(
        plan_slug=plan.tier_slug if plan else "unknown",
        status=sub.status,
        started_at=sub.started_at.isoformat(),
        current_period_end=sub.current_period_end.isoformat() if sub.current_period_end else None,
    )


# ── B.18 Documentation ──────────────────────────────────────────────
docs_router = APIRouter(prefix="/docs", tags=["docs-v2"])


class DocCategoryOut(BaseModel):
    slug: str
    title: str
    position: int


class DocArticleOut(BaseModel):
    slug: str
    title: str
    body_markdown: str
    body_html: str | None = None
    published_at: str | None = None


@docs_router.get("/categories", response_model=list[DocCategoryOut])
async def list_doc_categories(db=Depends(get_db)) -> list[DocCategoryOut]:
    from data.storage.models import DocCategory

    result = await db.execute(select(DocCategory).order_by(DocCategory.position.asc()))
    return [
        DocCategoryOut(slug=r.slug, title=r.title, position=int(r.position))
        for r in result.scalars().all()
    ]


@docs_router.get("/articles", response_model=list[DocArticleOut])
async def list_doc_articles(
    category: str | None = None, db=Depends(get_db)
) -> list[DocArticleOut]:
    from data.storage.models import DocArticle, DocCategory

    stmt = select(DocArticle).where(DocArticle.published_at.is_not(None))
    if category:
        cat = (
            await db.execute(select(DocCategory).where(DocCategory.slug == category))
        ).scalars().first()
        if cat is None:
            return []
        stmt = stmt.where(DocArticle.category_id == cat.id)
    stmt = stmt.order_by(DocArticle.published_at.desc())
    result = await db.execute(stmt)
    return [
        DocArticleOut(
            slug=r.slug,
            title=r.title,
            body_markdown=r.body_markdown,
            body_html=r.body_html,
            published_at=r.published_at.isoformat() if r.published_at else None,
        )
        for r in result.scalars().all()
    ]


# ── B.7 Jarvis intent log (read) ────────────────────────────────────
jarvis_router = APIRouter(prefix="/jarvis", tags=["jarvis"])


class JarvisIntentOut(BaseModel):
    id: int
    prompt: str
    parsed_intent: dict | None = None
    confirmed_at: str | None = None
    executed_at: str | None = None
    error: str | None = None
    created_at: str


@jarvis_router.get("/history", response_model=list[JarvisIntentOut])
async def list_jarvis_intents(
    limit: int = 50,
    username: str = Depends(require_auth),
    db=Depends(get_db),
) -> list[JarvisIntentOut]:
    from data.storage.models import JarvisIntent

    result = await db.execute(
        select(JarvisIntent)
        .where(JarvisIntent.username == username)
        .order_by(JarvisIntent.created_at.desc())
        .limit(min(limit, 200))
    )
    return [
        JarvisIntentOut(
            id=int(r.id),
            prompt=r.prompt,
            parsed_intent=r.parsed_intent,
            confirmed_at=r.confirmed_at.isoformat() if r.confirmed_at else None,
            executed_at=r.executed_at.isoformat() if r.executed_at else None,
            error=r.error,
            created_at=r.created_at.isoformat(),
        )
        for r in result.scalars().all()
    ]


# ── B.15 Bulk user actions ──────────────────────────────────────────
bulk_router = APIRouter(prefix="/admin/users/bulk", tags=["admin-bulk"])


class BulkActionRequest(BaseModel):
    usernames: list[str] = Field(..., min_length=1, max_length=200)
    reason: str | None = Field(default=None, max_length=500)


class BulkActionResult(BaseModel):
    success: list[str]
    failed: list[dict[str, str]]


@bulk_router.post("/suspend", response_model=BulkActionResult)
async def bulk_suspend(
    payload: BulkActionRequest,
    actor: str = Depends(require_admin),
    db=Depends(get_db),
) -> BulkActionResult:
    """B.15 — bulk suspend. Phase 1 stub: validates payload, audits the
    bulk-action intent, defers per-user state updates to follow-up."""
    await write_audit(
        event="bulk_action_started",
        username=actor,
        ip=None,
        request_id=None,
        details={
            "action": "suspend",
            "count": len(payload.usernames),
            "reason": payload.reason,
        },
    )
    return BulkActionResult(success=[], failed=[
        {"username": u, "error": "bulk-suspend handler ships in Phase 1.6h follow-up"}
        for u in payload.usernames
    ])


# Aggregate router for main.py mounting.
ALL_V2_MISC_ROUTERS = (
    templates_router,
    playbook_router,
    backtest_router,
    onboarding_router,
    reports_v2_router,
    tax_router,
    impersonation_router,
    billing_router,
    docs_router,
    jarvis_router,
    bulk_router,
)
