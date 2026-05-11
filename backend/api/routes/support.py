"""Support/feedback ticket intake.

BUG-088 (audit 2026-05-11): the contact page was mailto-only and there
was no in-app support surface. The frontend `HelpMenu` popover (commit
92eaaa57) added a UI affordance + pre-filled mailto. This module adds
the in-app POST counterpart so a logged-in operator can submit a
ticket without leaving the desk for their mail client.

Storage scope: this is the minimum-viable intake — tickets are
appended to the structured log + the audit trail with the operator's
username, IP, request_id, the page they were on, and the message
body. A proper ticket-queue with a status/assignee model is a
follow-up. For today, support team subscribes to the log stream and
acts on `event=support_ticket` entries.

Privacy: bodies are NOT redacted by `redact_secrets` because users
may include their own context (e.g. an order id) that contains
account-scoped data. Audit-log policy already requires limiting log
access to ops + compliance — same posture as the existing
`wash_trade_rejected` events.
"""
from __future__ import annotations

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from core.auth import require_auth
from core.audit import write_audit
from core.logging import CLIENT_IP, REQUEST_ID

logger = logging.getLogger("alphadesk.support")

router = APIRouter()


TicketCategory = Literal["support", "legal", "security", "feedback"]


class TicketRequest(BaseModel):
    """Minimal contract — keep small so the form stays one screen."""

    category: TicketCategory = Field(
        default="support",
        description="Routing hint; mirrors the four HelpMenu addresses.",
    )
    subject: str = Field(..., max_length=200, min_length=3)
    body: str = Field(..., max_length=10_000, min_length=5)
    page_url: str = Field(
        default="",
        max_length=500,
        description="Optional client-side `window.location.href` so the support "
        "team sees the operator's context.",
    )
    # ``user_agent`` is captured server-side from the Request headers
    # rather than the client body so it can't be spoofed cheaply.


class TicketResponse(BaseModel):
    ok: bool
    ticket_id: str
    received_at: str


@router.post("/tickets", response_model=TicketResponse, status_code=201)
async def create_support_ticket(
    payload: TicketRequest,
    request: Request,
    username: Annotated[str, Depends(require_auth)],
) -> TicketResponse:
    """Accept a support/feedback message from an authenticated operator.

    Wires a structured log entry + an audit-trail row keyed off
    `event=support_ticket`. The request_id is the ticket id — operators
    can quote it back to support to look up the original entry.
    """
    import uuid
    from datetime import datetime, timezone

    rid = REQUEST_ID.get()
    ticket_id = rid if rid and rid != "-" else uuid.uuid4().hex
    received_at = datetime.now(timezone.utc).isoformat()
    user_agent = request.headers.get("user-agent", "")
    client_ip = CLIENT_IP.get()

    logger.info(
        "support_ticket received",
        extra={
            "event": "support_ticket",
            "ticket_id": ticket_id,
            "category": payload.category,
            "subject": payload.subject,
            # `body` truncated in the log to 500 chars for grep-friendliness;
            # the full body lands in the audit_log details column.
            "body_preview": payload.body[:500],
            "page_url": payload.page_url,
            "user": username,
            "ip": client_ip,
            "user_agent": user_agent[:200],
        },
    )

    try:
        await write_audit(
            "support_ticket",
            username=username,
            ip=client_ip,
            request_id=rid if rid and rid != "-" else None,
            details={
                "ticket_id": ticket_id,
                "category": payload.category,
                "subject": payload.subject,
                "body": payload.body,
                "page_url": payload.page_url,
                "user_agent": user_agent[:500],
            },
        )
    except Exception:
        # Audit write failure is non-fatal — the log entry above is the
        # primary durable record. Don't let a DB hiccup silently drop the
        # user's feedback request.
        logger.warning(
            "support_ticket: audit-log write failed",
            extra={"ticket_id": ticket_id, "event": "support_ticket_audit_fail"},
            exc_info=True,
        )

    return TicketResponse(ok=True, ticket_id=ticket_id, received_at=received_at)
