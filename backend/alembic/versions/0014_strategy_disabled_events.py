"""strategy disabled events table

Revision ID: 0014_strategy_disabled_events
Revises: 0013_users_broker_reconciliation
Create Date: 2026-05-04
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0014_strategy_disabled_events"
down_revision = "0013_users_broker_reconciliation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "strategy_disabled_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("strategy", sa.String(length=64), nullable=False),
        sa.Column("layer", sa.SmallInteger(), nullable=False),
        sa.Column(
            "triggered_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("peak_nav", sa.Float(), nullable=True),
        sa.Column("current_nav", sa.Float(), nullable=True),
        sa.Column("realized_pnl", sa.Float(), nullable=True),
        sa.Column("alloc_capital", sa.Float(), nullable=True),
        sa.Column("threshold", sa.Float(), nullable=True),
        sa.Column("manual_actor", sa.String(length=120), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.String(length=120), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("layer IN (1, 2, 3)", name="layer_valid"),
    )
    # One unresolved manual event per strategy: enforce via partial unique index.
    op.create_index(
        "ix_sde_strategy_unresolved_manual",
        "strategy_disabled_events",
        ["strategy"],
        unique=True,
        postgresql_where=sa.text("layer = 3 AND resolved_at IS NULL"),
    )
    # Lookup index for the latest unresolved event per strategy across layers.
    op.create_index(
        "ix_sde_strategy_unresolved",
        "strategy_disabled_events",
        ["strategy", "triggered_at"],
        postgresql_where=sa.text("resolved_at IS NULL"),
    )
    op.create_index(
        "ix_sde_strategy_layer",
        "strategy_disabled_events",
        ["strategy", "layer"],
    )


def downgrade() -> None:
    op.drop_index("ix_sde_strategy_layer", table_name="strategy_disabled_events")
    op.drop_index("ix_sde_strategy_unresolved", table_name="strategy_disabled_events")
    op.drop_index("ix_sde_strategy_unresolved_manual", table_name="strategy_disabled_events")
    op.drop_table("strategy_disabled_events")
