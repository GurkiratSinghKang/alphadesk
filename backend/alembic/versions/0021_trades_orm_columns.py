"""Add ORM-only columns to trades that were missing alembic migrations

Revision ID: 0021_trades_orm_columns
Revises: 0019_exit_rule_adverse_momentum
Create Date: 2026-05-06

Bug discovered 2026-05-06: ``/api/v1/analytics/slippage`` returned 500
because ``trades.stop_loss_combo_mark`` column didn't exist on prod
even though the ORM declared it. Combo-exits commit (Wave 8 ``9d42bb48``)
added the field via ``ALTER TABLE IF NOT EXISTS`` on the legacy
``trade_ledger`` table but never wrote an alembic migration for the
``trades`` table that the ORM actually uses. Same gap applied to the
M-O F-1 patient-mid columns (``target_price``, ``actual_fill_price``,
``slippage_pct``).

This migration adds the four columns to ``trades``. All NULLABLE so
legacy rows keep loading.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0021_trades_orm_columns"
down_revision = "0019_exit_rule_adverse_momentum"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Wave 8 OE-1: combo-mark stop threshold (signed combo P&L below
    # which the auto-close fires). NULL on legacy rows means "no combo
    # stop wired" — engine falls through to the per-leg paths.
    op.add_column(
        "trades",
        sa.Column("stop_loss_combo_mark", sa.Float(), nullable=True),
    )

    # M-O F-1 (patient mid-pricing): per-trade fill-quality columns.
    # ``target_price`` is the combo mid at submit time; ``actual_fill_price``
    # is the broker's reported fill; ``slippage_pct`` is the signed
    # ``(actual - target) / |target|`` (positive = trader did worse than
    # mid). All NULLABLE — legacy + immediate-fill paths leave them NULL,
    # patient-mid stamps them at INSERT.
    op.add_column(
        "trades",
        sa.Column("target_price", sa.Float(), nullable=True),
    )
    op.add_column(
        "trades",
        sa.Column("actual_fill_price", sa.Float(), nullable=True),
    )
    op.add_column(
        "trades",
        sa.Column("slippage_pct", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("trades", "slippage_pct")
    op.drop_column("trades", "actual_fill_price")
    op.drop_column("trades", "target_price")
    op.drop_column("trades", "stop_loss_combo_mark")
