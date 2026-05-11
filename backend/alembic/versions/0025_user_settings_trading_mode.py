"""Persist per-user paper/live trading mode.

Revision ID: 0025_user_settings_trading_mode
Revises: 0024_v2_phase_b
Create Date: 2026-05-11

BUG-057: the frontend paper/live pill was only client state. Persisting
the mode on ``user_settings`` gives order submission a server-side
mode-of-record to validate against before any live-capital wiring lands.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0025_user_settings_trading_mode"
down_revision = "0024_v2_phase_b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "trading_mode",
            sa.String(length=16),
            nullable=False,
            server_default="paper",
        ),
    )
    op.add_column(
        "user_settings",
        sa.Column("trading_mode_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "user_settings",
        sa.Column("live_step_up_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_user_settings_trading_mode",
        "user_settings",
        "trading_mode IN ('paper', 'live')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_user_settings_trading_mode",
        "user_settings",
        type_="check",
    )
    op.drop_column("user_settings", "live_step_up_at")
    op.drop_column("user_settings", "trading_mode_updated_at")
    op.drop_column("user_settings", "trading_mode")
