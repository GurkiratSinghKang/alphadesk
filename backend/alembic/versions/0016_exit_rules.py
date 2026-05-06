"""exit-rules engine for position-management automation

Revision ID: 0016_exit_rules
Revises: 0015_broker_creds_crypto_version
Create Date: 2026-05-05

P2 (STRATEGY-HARDENING-AUDIT) — adds the ``exit_rules`` table that
``services.exit_rules.evaluate_exit_rules`` walks on every
``daily_pipeline._check_exits`` tick. Seeds four default rules:

* iron_condor profit-take at 50% of max credit (close)
* iron_butterfly profit-take at 25% (close)
* time-based exit at 21 DTE for any structure (close)
* loss alert at 2x max-credit lost for any structure (alert)

These mirror standard short-vol discipline. The user reported a max-loss
AMD iron condor that would have been profitable mid-week if a
50%-of-max-credit auto-close had fired; the seed set fixes that gap on
day one.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0016_exit_rules"
down_revision = "0015_broker_creds_crypto_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exit_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("strategy", sa.String(length=60), nullable=True),
        sa.Column("structure_type", sa.String(length=40), nullable=True),
        sa.Column("rule_type", sa.String(length=32), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("action", sa.String(length=16), server_default="close", nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("priority", sa.Integer(), server_default="100", nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "rule_type IN ('profit_pct','time_dte','loss_pct','delta_breach')",
            name="ck_exit_rules_rule_type",
        ),
        sa.CheckConstraint(
            "action IN ('close','roll','alert')",
            name="ck_exit_rules_action",
        ),
    )
    op.create_index("ix_exit_rules_strategy", "exit_rules", ["strategy"], unique=False)
    op.create_index(
        "ix_exit_rules_structure_type", "exit_rules", ["structure_type"], unique=False
    )
    op.create_index("ix_exit_rules_rule_type", "exit_rules", ["rule_type"], unique=False)
    op.create_index("ix_exit_rules_enabled", "exit_rules", ["enabled"], unique=False)
    op.create_index("ix_exit_rules_priority", "exit_rules", ["priority", "enabled"], unique=False)
    op.create_index(
        "ix_exit_rules_scope",
        "exit_rules",
        ["strategy", "structure_type", "enabled"],
        unique=False,
    )

    # ───────────── Seed default rules ─────────────
    # Priority ordering: 5 (loss alert — fire FIRST so the operator sees the
    # bleed before any close action), 10 (take-profit on short vol), 20
    # (time-based exit at 21 DTE).
    op.execute(
        """
        INSERT INTO exit_rules
            (strategy, structure_type, rule_type, threshold, action, enabled, priority, description)
        VALUES
            (NULL, 'iron_condor',     'profit_pct',  0.50, 'close', TRUE, 10,
             'Close iron condor at 50%% of max credit (Tasty / short-vol discipline)'),
            (NULL, 'iron_butterfly',  'profit_pct',  0.25, 'close', TRUE, 10,
             'Close iron butterfly at 25%% of max credit (tighter than condor — narrower wings)'),
            (NULL, '*',               'time_dte',   21.0, 'close', TRUE, 20,
             'Close any short-vol position at 21 DTE to avoid gamma cliff'),
            (NULL, '*',               'loss_pct',    2.0, 'alert', TRUE,  5,
             'Alert when loss reaches 2x max credit (200%%) — operator should review immediately')
        """
    )


def downgrade() -> None:
    op.drop_index("ix_exit_rules_scope", table_name="exit_rules")
    op.drop_index("ix_exit_rules_priority", table_name="exit_rules")
    op.drop_index("ix_exit_rules_enabled", table_name="exit_rules")
    op.drop_index("ix_exit_rules_rule_type", table_name="exit_rules")
    op.drop_index("ix_exit_rules_structure_type", table_name="exit_rules")
    op.drop_index("ix_exit_rules_strategy", table_name="exit_rules")
    op.drop_table("exit_rules")
