"""ticker intelligence facts and research runs

Revision ID: 0012_ticker_intelligence
Revises: 0011_access_requests
Create Date: 2026-05-03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0012_ticker_intelligence"
down_revision = "0011_access_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ticker_profiles",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("exchange", sa.String(length=64), nullable=True),
        sa.Column("sector", sa.String(length=120), nullable=True),
        sa.Column("industry", sa.String(length=160), nullable=True),
        sa.Column("currency", sa.String(length=16), nullable=True),
        sa.Column("cik", sa.String(length=32), nullable=True),
        sa.Column("figi", sa.String(length=64), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("symbol"),
    )
    op.create_index("ix_ticker_profiles_symbol", "ticker_profiles", ["symbol"], unique=False)

    op.create_table(
        "ticker_facts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("namespace", sa.String(length=40), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source", sa.String(length=80), nullable=False),
        sa.Column("source_ref", sa.String(length=128), nullable=True),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stale_after_seconds", sa.Integer(), nullable=True),
        sa.Column("quality", sa.String(length=20), server_default="fresh", nullable=False),
        sa.Column("is_demo", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("schema_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("lineage_hash", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticker_facts_symbol", "ticker_facts", ["symbol"], unique=False)
    op.create_index("ix_ticker_facts_namespace", "ticker_facts", ["namespace"], unique=False)
    op.create_index("ix_ticker_facts_key", "ticker_facts", ["key"], unique=False)
    op.create_index("ix_ticker_facts_source", "ticker_facts", ["source"], unique=False)
    op.create_index("ix_ticker_facts_source_ref", "ticker_facts", ["source", "source_ref"], unique=False)
    op.create_index("ix_ticker_facts_as_of", "ticker_facts", ["as_of"], unique=False)
    op.create_index("ix_ticker_facts_observed_at", "ticker_facts", ["observed_at"], unique=False)
    op.create_index("ix_ticker_facts_expires_at", "ticker_facts", ["expires_at"], unique=False)
    op.create_index("ix_ticker_facts_quality", "ticker_facts", ["quality"], unique=False)
    op.create_index("ix_ticker_facts_lineage_hash", "ticker_facts", ["lineage_hash"], unique=False)
    op.create_index("ix_ticker_facts_latest", "ticker_facts", ["symbol", "namespace", "key", "observed_at"], unique=False)

    op.create_table(
        "ticker_research_runs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("username", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=True),
        sa.Column("deep_model", sa.String(length=120), nullable=True),
        sa.Column("quick_model", sa.String(length=120), nullable=True),
        sa.Column("analysts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("research_depth", sa.Integer(), nullable=True),
        sa.Column("trade_date", sa.Date(), nullable=True),
        sa.Column("summary_lines", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("decision_text", sa.Text(), nullable=True),
        sa.Column("artifact_files", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("request_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("persisted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id"),
    )
    op.create_index("ix_ticker_research_runs_run_id", "ticker_research_runs", ["run_id"], unique=False)
    op.create_index("ix_ticker_research_runs_symbol", "ticker_research_runs", ["symbol"], unique=False)
    op.create_index("ix_ticker_research_runs_username", "ticker_research_runs", ["username"], unique=False)
    op.create_index("ix_ticker_research_runs_status", "ticker_research_runs", ["status"], unique=False)
    op.create_index("ix_ticker_research_runs_completed_at", "ticker_research_runs", ["completed_at"], unique=False)
    op.create_index(
        "ix_ticker_research_symbol_completed",
        "ticker_research_runs",
        ["symbol", "completed_at"],
        unique=False,
    )
    op.create_index(
        "ix_ticker_research_username_symbol",
        "ticker_research_runs",
        ["username", "symbol"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_ticker_research_username_symbol", table_name="ticker_research_runs")
    op.drop_index("ix_ticker_research_symbol_completed", table_name="ticker_research_runs")
    op.drop_index("ix_ticker_research_runs_completed_at", table_name="ticker_research_runs")
    op.drop_index("ix_ticker_research_runs_status", table_name="ticker_research_runs")
    op.drop_index("ix_ticker_research_runs_username", table_name="ticker_research_runs")
    op.drop_index("ix_ticker_research_runs_symbol", table_name="ticker_research_runs")
    op.drop_index("ix_ticker_research_runs_run_id", table_name="ticker_research_runs")
    op.drop_table("ticker_research_runs")

    op.drop_index("ix_ticker_facts_latest", table_name="ticker_facts")
    op.drop_index("ix_ticker_facts_lineage_hash", table_name="ticker_facts")
    op.drop_index("ix_ticker_facts_quality", table_name="ticker_facts")
    op.drop_index("ix_ticker_facts_expires_at", table_name="ticker_facts")
    op.drop_index("ix_ticker_facts_observed_at", table_name="ticker_facts")
    op.drop_index("ix_ticker_facts_as_of", table_name="ticker_facts")
    op.drop_index("ix_ticker_facts_source_ref", table_name="ticker_facts")
    op.drop_index("ix_ticker_facts_source", table_name="ticker_facts")
    op.drop_index("ix_ticker_facts_key", table_name="ticker_facts")
    op.drop_index("ix_ticker_facts_namespace", table_name="ticker_facts")
    op.drop_index("ix_ticker_facts_symbol", table_name="ticker_facts")
    op.drop_table("ticker_facts")

    op.drop_index("ix_ticker_profiles_symbol", table_name="ticker_profiles")
    op.drop_table("ticker_profiles")
