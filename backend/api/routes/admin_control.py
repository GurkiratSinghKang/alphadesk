"""Admin Control Center — runtime config management.

Endpoints (all admin-only except where noted):
  GET    /api/v1/admin/control-center/keys      → masked status of supported backend keys
  PATCH  /api/v1/admin/control-center/keys      → set/clear keys
  GET    /api/v1/admin/control-center/layout    → current layout config (PUBLIC read; the dashboard fetches this on mount)
  PATCH  /api/v1/admin/control-center/layout    → update layout config
  POST   /api/v1/admin/control-center/deploy    → trigger GitHub workflow_dispatch deploy
  GET    /api/v1/admin/control-center/deploy/last → last triggered deploy run summary

The layout GET is intentionally NOT admin-gated: every authenticated
user needs to read the layout to render the dashboard. Writes (PATCH)
and the keys endpoints + deploy trigger are admin-only.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.routes.auth import require_admin, require_auth
from services import app_config

logger = logging.getLogger("alphadesk.api.admin_control")

router = APIRouter(prefix="/admin/control-center", tags=["admin-control-center"])
DEPLOY_UNAVAILABLE_DETAIL = "GitHub deploy service is temporarily unavailable"
DEPLOY_REJECTED_DETAIL = "GitHub deploy service rejected the request"


# --------------------------------------------------------------------- #
# Backend keys                                                            #
# --------------------------------------------------------------------- #


@router.get("/keys")
async def list_keys(_: str = Depends(require_admin)) -> dict[str, Any]:
    """Return the masked status of every supported backend key."""
    return {"keys": await app_config.list_backend_keys()}


class KeyPatch(BaseModel):
    set: dict[str, str] = Field(default_factory=dict)
    clear: list[str] = Field(default_factory=list)


@router.patch("/keys")
async def patch_keys(
    body: KeyPatch,
    actor: str = Depends(require_admin),
) -> dict[str, Any]:
    for canonical_key, value in body.set.items():
        try:
            await app_config.set_backend_key(canonical_key, value, actor=actor)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    for canonical_key in body.clear:
        try:
            await app_config.clear_backend_key(canonical_key, actor=actor)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True, "keys": await app_config.list_backend_keys()}


# --------------------------------------------------------------------- #
# Layout config                                                           #
# --------------------------------------------------------------------- #


@router.get("/layout")
async def get_layout(_: str = Depends(require_auth)) -> dict[str, Any]:
    """Public-to-authenticated-users layout payload.

    The dashboard reads this on mount to know which sections to render
    and in what order. Editing requires admin (see PATCH below).
    """
    return await app_config.get_layout_config()


class LayoutSectionPatch(BaseModel):
    id: str
    visible: bool = True
    order: int = 0


class LayoutPatch(BaseModel):
    dashboard_sections: list[LayoutSectionPatch] = Field(default_factory=list)


@router.patch("/layout")
async def patch_layout(
    body: LayoutPatch,
    actor: str = Depends(require_admin),
) -> dict[str, Any]:
    config = {
        "dashboard_sections": [
            {"id": s.id, "visible": s.visible, "order": s.order}
            for s in body.dashboard_sections
        ]
    }
    return await app_config.set_layout_config(config, actor=actor)


# --------------------------------------------------------------------- #
# Push to prod — trigger GitHub workflow_dispatch                         #
# --------------------------------------------------------------------- #


_LAST_DEPLOY: dict[str, Any] = {"triggered_at": None, "actor": None, "ok": None, "html_url": None}


def _gh_token_and_repo() -> tuple[str, str]:
    """Resolve the GitHub token + ``owner/repo`` slug for the deploy.

    ``GH_TOKEN`` is preferred over ``GITHUB_TOKEN`` because the former is
    the convention used by the ``gh`` CLI and we already have it set in
    the deploy environment. ``GH_REPO`` overrides the auto-detected
    ``owner/repo`` (defaults to ``GurkiratSinghKang/alphadesk``).
    """
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        raise HTTPException(
            status_code=500,
            detail="Server is not configured with a GitHub deploy token",
        )
    repo = os.environ.get("GH_REPO", "GurkiratSinghKang/alphadesk")
    return token, repo


@router.post("/deploy")
async def trigger_deploy(actor: str = Depends(require_admin)) -> dict[str, Any]:
    """Trigger the ``Deploy AlphaDesk`` GitHub Action via workflow_dispatch.

    The action's ``ref`` defaults to ``feature/deployment`` because that's
    the operational main branch on this repo. Override via the ``GH_REF``
    env var if/when the operational branch changes.
    """
    import datetime

    token, repo = _gh_token_and_repo()
    workflow = os.environ.get("GH_DEPLOY_WORKFLOW", "deploy.yml")
    ref = os.environ.get("GH_REF", "feature/deployment")
    api_url = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    triggered_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(api_url, headers=headers, json={"ref": ref})
    except httpx.HTTPError as exc:
        logger.exception("Deploy dispatch failed (network)")
        _LAST_DEPLOY.update({"triggered_at": triggered_at, "actor": actor, "ok": False, "html_url": None})
        raise HTTPException(status_code=502, detail=DEPLOY_UNAVAILABLE_DETAIL) from exc

    if resp.status_code != 204:
        # GitHub returns 204 No Content on success.
        logger.warning(
            "Deploy dispatch non-success",
            extra={"status": resp.status_code, "body": resp.text[:512]},
        )
        _LAST_DEPLOY.update({"triggered_at": triggered_at, "actor": actor, "ok": False, "html_url": None})
        raise HTTPException(
            status_code=502,
            detail=DEPLOY_REJECTED_DETAIL,
        )

    # Best-effort: fetch the most recent run for this workflow so we can
    # link the operator to it. Non-fatal if this side call fails.
    html_url: str | None = None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            runs = await client.get(
                f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/runs?per_page=1",
                headers=headers,
            )
        if runs.status_code == 200:
            payload = runs.json()
            run0 = (payload.get("workflow_runs") or [None])[0]
            if isinstance(run0, dict):
                html_url = run0.get("html_url")
    except Exception:
        logger.debug("Deploy follow-up runs fetch failed", exc_info=True)

    _LAST_DEPLOY.update(
        {"triggered_at": triggered_at, "actor": actor, "ok": True, "html_url": html_url}
    )
    return {"ok": True, "ref": ref, "triggered_at": triggered_at, "html_url": html_url}


@router.get("/deploy/last")
async def last_deploy(_: str = Depends(require_admin)) -> dict[str, Any]:
    return dict(_LAST_DEPLOY)
