"""app_config table for runtime admin overrides

Stores admin-controlled runtime config: API keys (encrypted), UI
layout configuration, and any future runtime-tunable settings. The
key/value pair model supports any JSON-serialisable value; sensitive
keys (e.g. API keys) MUST be encrypted via core.crypto before write.

Revision ID: 0017_app_config
Revises: 0016_exit_rules
Create Date: 2026-05-06
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0017_app_config"
down_revision = "0016_exit_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_config",
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value_json", sa.Text(), nullable=False),
        sa.Column("encrypted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.String(length=120), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_config")
