"""Add max_loss_at_submit column to trades table.

Revision ID: 0022_trade_max_loss_at_submit
Revises: 0021_trades_orm_columns
Create Date: 2026-05-06

Stores the per-trade max-loss computed at submission time so the
aggregate-position max-loss gate doesn't have to reprice open trades.
NULL on rows submitted before this migration; the aggregate sum treats
NULL as 0 (conservative — those legacy rows simply don't contribute,
and most pre-migration positions are stale anyway).

Closes the per-trade vs portfolio gap: a trader could previously stack
four 4.9%-of-equity defined-risk trades for ~20% aggregate exposure
because the gate fired only on each new request in isolation.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0022_trade_max_loss_at_submit"
down_revision = "0021_trades_orm_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "trades",
        sa.Column("max_loss_at_submit", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("trades", "max_loss_at_submit")
