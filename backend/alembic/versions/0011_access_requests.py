"""access request intake table

Revision ID: 0011_access_requests
Revises: 0010_trade_filled_qty
Create Date: 2026-05-02
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0011_access_requests"
down_revision = "0010_trade_filled_qty"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "access_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("public_id", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="received", nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("firm", sa.String(length=160), nullable=True),
        sa.Column("role", sa.String(length=120), nullable=True),
        sa.Column("jurisdiction", sa.String(length=80), nullable=False),
        sa.Column("capital_band", sa.String(length=32), nullable=False),
        sa.Column("trading_mode", sa.String(length=32), nullable=False),
        sa.Column("instruments", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("referral", sa.Text(), nullable=True),
        sa.Column("client_ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=256), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index("ix_access_requests_public_id", "access_requests", ["public_id"], unique=False)
    op.create_index("ix_access_requests_status_created", "access_requests", ["status", "created_at"], unique=False)
    op.create_index("ix_access_requests_email", "access_requests", ["email"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_access_requests_email", table_name="access_requests")
    op.drop_index("ix_access_requests_status_created", table_name="access_requests")
    op.drop_index("ix_access_requests_public_id", table_name="access_requests")
    op.drop_table("access_requests")
