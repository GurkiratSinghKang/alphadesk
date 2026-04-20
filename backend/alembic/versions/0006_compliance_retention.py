"""compliance retention flag + compliance_tickets table (Wave 4Q)

Revision ID: 0006_compliance_retention
Revises: 0005_audit_log
Create Date: 2026-04-19

Wave 4Q — GDPR / CCPA rights scaffolding (persona 103 P1s).

Two schema changes land together because they share the same concern
(regulatory rights / retention obligations):

1. ``audit_log.retained_for_compliance`` (BOOLEAN, default FALSE).
   When a user invokes the GDPR Art. 17 erasure endpoint the backend
   deletes their audit rows — EXCEPT those whose ``event`` is on the
   SEC 17a-4 / FINRA minimum-retention list (``halt_trading``,
   ``resume_trading``, ``wash_trade_reject``, ``restricted_symbol_reject``,
   ``live_gate_reject``). Those rows remain but are flagged so downstream
   exports and admin UIs can render them as "retained for regulatory
   compliance — not user-initiated data". This column is effectively a
   tombstone marker: it tells a future auditor "this row survived an
   erasure request because the retention rule dominates".

2. ``compliance_tickets`` (new table) — audit trail for Subject Access
   Requests (SARs) handled via ``docs/SAR_WORKFLOW.md``. One row per
   ticket:

   * ``request_type``    VARCHAR(32) — ``access``, ``erasure``,
     ``rectification``, ``portability``, ``objection``, ``restriction``.
     The six canonical GDPR rights; CCPA ``know``/``delete`` map onto
     ``access`` / ``erasure`` respectively so we don't double the
     enum.
   * ``status``          VARCHAR(32) — ``received``, ``verifying``,
     ``in_progress``, ``completed``, ``denied``, ``withdrawn``.
   * ``requester_email`` VARCHAR(255) — the email address the request
     arrived from. Used for identity verification + response routing.
   * ``identity_verified`` BOOLEAN — flipped to TRUE only after the
     requester confirms via the email + password-retry flow in the
     SAR workflow doc.
   * ``denial_reason``   TEXT — populated when ``status='denied'``.
     Rare on a single-admin deployment (admin is always the data
     subject) but codified so the schema is multi-tenant ready.
   * ``received_at``     TIMESTAMPTZ — when the SAR arrived. Drives
     the 30-day GDPR / 45-day CCPA countdown.
   * ``completed_at``    TIMESTAMPTZ NULL — when status became
     ``completed``/``denied``. NULL while the ticket is open.
   * ``notes``           JSONB — free-form workflow notes
     (verification attempts, export filenames, escalations, …).

Both changes are safe on an empty audit_log / non-existent
compliance_tickets — the retention flag defaults FALSE so existing
rows keep their current meaning, and the new table is unreferenced
by any prior migration. Downgrade is symmetric.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "0006_compliance_retention"
down_revision: Union[str, None] = "0005_audit_log"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Flag column on audit_log.  ``server_default=sa.false()`` means
    #    every existing row becomes ``retained_for_compliance=False``
    #    immediately — they were all user-originated actions at the time
    #    they were logged.  A later erasure will flip the flag on the
    #    rows that survive the delete.
    op.add_column(
        "audit_log",
        sa.Column(
            "retained_for_compliance",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # 2. New table for SAR / rights-request tracking.
    op.create_table(
        "compliance_tickets",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("request_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="received"),
        sa.Column("requester_email", sa.String(length=255), nullable=True),
        sa.Column("requester_username", sa.String(length=128), nullable=True),
        sa.Column(
            "identity_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("denial_reason", sa.Text(), nullable=True),
        sa.Column("notes", JSONB(), nullable=True),
    )

    # Drive the "what's still open" dashboard query efficiently.
    op.create_index(
        "ix_compliance_tickets_status_received",
        "compliance_tickets",
        ["status", sa.text("received_at DESC")],
    )
    op.create_index(
        "ix_compliance_tickets_requester_email",
        "compliance_tickets",
        ["requester_email"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_compliance_tickets_requester_email",
        table_name="compliance_tickets",
    )
    op.drop_index(
        "ix_compliance_tickets_status_received",
        table_name="compliance_tickets",
    )
    op.drop_table("compliance_tickets")
    op.drop_column("audit_log", "retained_for_compliance")
