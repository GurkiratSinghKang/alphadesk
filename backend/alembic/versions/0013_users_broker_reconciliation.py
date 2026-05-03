"""users broker connections reconciliation issues

Revision ID: 0013_users_broker_reconciliation
Revises: 0012_ticker_intelligence
Create Date: 2026-05-03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0013_users_broker_reconciliation"
down_revision = "0012_ticker_intelligence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("role", sa.String(length=32), server_default="user", nullable=False),
        sa.Column("status", sa.String(length=32), server_default="active", nullable=False),
        sa.Column("display_name", sa.String(length=160), nullable=True),
        sa.Column("profile", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("username"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=False)
    op.create_index("ix_users_email", "users", ["email"], unique=False)
    op.create_index("ix_users_role", "users", ["role"], unique=False)
    op.create_index("ix_users_status", "users", ["status"], unique=False)
    op.create_index("ix_users_status_role", "users", ["status", "role"], unique=False)

    op.create_table(
        "broker_connections",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("account_env", sa.String(length=16), server_default="paper", nullable=False),
        sa.Column("display_name", sa.String(length=160), nullable=True),
        sa.Column("api_key_ciphertext", sa.Text(), nullable=False),
        sa.Column("secret_key_ciphertext", sa.Text(), nullable=False),
        sa.Column("key_last4", sa.String(length=8), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="active", nullable=False),
        sa.Column("is_default", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("broker_account_id", sa.String(length=128), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username", "provider", "account_env", name="uq_broker_conn_user_provider_env"),
    )
    op.create_index("ix_broker_connections_username", "broker_connections", ["username"], unique=False)
    op.create_index("ix_broker_connections_provider", "broker_connections", ["provider"], unique=False)
    op.create_index("ix_broker_connections_account_env", "broker_connections", ["account_env"], unique=False)
    op.create_index("ix_broker_connections_status", "broker_connections", ["status"], unique=False)
    op.create_index(
        "ix_broker_conn_user_provider",
        "broker_connections",
        ["username", "provider", "status"],
        unique=False,
    )

    op.create_table(
        "reconciliation_issues",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("issue_key", sa.String(length=160), nullable=False),
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("broker_connection_id", sa.BigInteger(), nullable=True),
        sa.Column("provider", sa.String(length=32), server_default="alpaca", nullable=False),
        sa.Column("account_env", sa.String(length=16), server_default="paper", nullable=False),
        sa.Column("issue_type", sa.String(length=48), nullable=False),
        sa.Column("severity", sa.String(length=16), server_default="warning", nullable=False),
        sa.Column("status", sa.String(length=24), server_default="open", nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=True),
        sa.Column("broker_order_id", sa.String(length=128), nullable=True),
        sa.Column("client_order_id", sa.String(length=128), nullable=True),
        sa.Column("local_trade_id", sa.BigInteger(), nullable=True),
        sa.Column("broker_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("local_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("proposed_action", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.String(length=128), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("issue_key"),
    )
    op.create_index("ix_reconciliation_issues_issue_key", "reconciliation_issues", ["issue_key"], unique=False)
    op.create_index("ix_reconciliation_issues_username", "reconciliation_issues", ["username"], unique=False)
    op.create_index("ix_reconciliation_issues_broker_connection_id", "reconciliation_issues", ["broker_connection_id"], unique=False)
    op.create_index("ix_reconciliation_issues_provider", "reconciliation_issues", ["provider"], unique=False)
    op.create_index("ix_reconciliation_issues_account_env", "reconciliation_issues", ["account_env"], unique=False)
    op.create_index("ix_reconciliation_issues_issue_type", "reconciliation_issues", ["issue_type"], unique=False)
    op.create_index("ix_reconciliation_issues_severity", "reconciliation_issues", ["severity"], unique=False)
    op.create_index("ix_reconciliation_issues_status", "reconciliation_issues", ["status"], unique=False)
    op.create_index("ix_reconciliation_issues_symbol", "reconciliation_issues", ["symbol"], unique=False)
    op.create_index("ix_reconciliation_issues_broker_order_id", "reconciliation_issues", ["broker_order_id"], unique=False)
    op.create_index("ix_reconciliation_issues_client_order_id", "reconciliation_issues", ["client_order_id"], unique=False)
    op.create_index("ix_reconciliation_issues_local_trade_id", "reconciliation_issues", ["local_trade_id"], unique=False)
    op.create_index("ix_reconciliation_issues_detected_at", "reconciliation_issues", ["detected_at"], unique=False)
    op.create_index(
        "ix_recon_issues_user_status",
        "reconciliation_issues",
        ["username", "status", "detected_at"],
        unique=False,
    )
    op.create_index(
        "ix_recon_issues_type_status",
        "reconciliation_issues",
        ["issue_type", "status"],
        unique=False,
    )

    op.add_column("trades", sa.Column("username", sa.String(length=128), nullable=True))
    op.create_index("ix_trades_username", "trades", ["username"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_trades_username", table_name="trades")
    op.drop_column("trades", "username")

    op.drop_index("ix_recon_issues_type_status", table_name="reconciliation_issues")
    op.drop_index("ix_recon_issues_user_status", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_detected_at", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_local_trade_id", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_client_order_id", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_broker_order_id", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_symbol", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_status", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_severity", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_issue_type", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_account_env", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_provider", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_broker_connection_id", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_username", table_name="reconciliation_issues")
    op.drop_index("ix_reconciliation_issues_issue_key", table_name="reconciliation_issues")
    op.drop_table("reconciliation_issues")

    op.drop_index("ix_broker_conn_user_provider", table_name="broker_connections")
    op.drop_index("ix_broker_connections_status", table_name="broker_connections")
    op.drop_index("ix_broker_connections_account_env", table_name="broker_connections")
    op.drop_index("ix_broker_connections_provider", table_name="broker_connections")
    op.drop_index("ix_broker_connections_username", table_name="broker_connections")
    op.drop_table("broker_connections")

    op.drop_index("ix_users_status_role", table_name="users")
    op.drop_index("ix_users_status", table_name="users")
    op.drop_index("ix_users_role", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
