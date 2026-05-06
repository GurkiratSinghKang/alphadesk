"""scaled_profit_close exit rule — ladder 25/50/75 of original qty (M-O P)

Revision ID: 0020_exit_rule_scaled_profit_close
Revises: 0018_exit_rule_wing_capture
Create Date: 2026-05-05

M-O P (squeeze more profit out of winners). The single-threshold
``profit_pct`` close at 50% of max credit on iron condors (25% on iron
butterflies) leaves a lot of money on the table. Industry data
(TastyTrade, dough.com on hundreds of thousands of trades) shows scaled
exits beat single-threshold:

* Take 1/3 off at 25% of max profit (lock in some win)
* Take 1/3 off at 50% (the historical sweet spot)
* Leave 1/3 as a runner with a stop-protect (capture more upside)

This migration:

1. Adds ``exit_rules.qty_fraction`` (default 1.0 — the column is
   ignored by every legacy rule_type so existing rows keep behaving
   exactly as before).
2. Adds ``trades.partial_close_log`` (JSONB; idempotency for scaled
   rules) and ``trades.original_qty`` (snapshot of the lot at trade
   open so analytics + the "of REMAINING" math have a stable
   denominator).
3. Widens the ``ck_exit_rules_rule_type`` CHECK constraint to allow
   ``'scaled_profit_close'``.
4. Adds the ``ck_exit_rules_qty_fraction`` CHECK constraint
   (0 < qty_fraction <= 1).
5. SOFT-DISABLES the legacy iron_condor profit_pct=0.50 close and
   iron_butterfly profit_pct=0.25 close (keeps the rows for easy
   revert; ``enabled=FALSE`` so the engine skips them) and INSERTs
   the 6 new scaled rows:

   * iron_condor:    (0.25, 0.33), (0.50, 0.50), (0.75, 1.00)
     — closes 1/3 + 1/3 + 1/3 of the original lot.
   * iron_butterfly: (0.15, 0.33), (0.30, 0.50), (0.50, 1.00)
     — tighter thresholds because iron butterflies have narrower
     wings and worse risk:reward.

Don't delete the legacy ``profit_pct`` rule_type from the CHECK
constraint — it stays valid for back-compat (existing per-strategy
overrides may still use it) and the soft-disabled rows must remain
INSERT-able.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0020_exit_rule_scaled_profit_close"
down_revision = "0018_exit_rule_wing_capture"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ───────────── exit_rules.qty_fraction column ─────────────
    op.add_column(
        "exit_rules",
        sa.Column(
            "qty_fraction",
            sa.Float(),
            nullable=False,
            server_default="1.0",
        ),
    )
    # ───────────── trades.partial_close_log + original_qty ─────────────
    op.add_column(
        "trades",
        sa.Column(
            "partial_close_log",
            sa.dialects.postgresql.JSONB(),
            nullable=True,
            server_default=None,
        ),
    )
    op.add_column(
        "trades",
        sa.Column(
            "original_qty",
            sa.Integer(),
            nullable=True,
        ),
    )

    # ───────────── Update CHECK constraints ─────────────
    # Postgres requires DROP + ADD; there's no ALTER CONSTRAINT for CHECK.
    op.drop_constraint(
        "ck_exit_rules_rule_type", "exit_rules", type_="check"
    )
    op.create_check_constraint(
        "ck_exit_rules_rule_type",
        "exit_rules",
        "rule_type IN ('profit_pct','time_dte','loss_pct','delta_breach','wing_capture','scaled_profit_close')",
    )
    op.create_check_constraint(
        "ck_exit_rules_qty_fraction",
        "exit_rules",
        "qty_fraction > 0 AND qty_fraction <= 1",
    )

    # ───────────── Soft-disable the legacy single-threshold rules ─────────────
    # Keep the rows for easy revert (an operator who wants the old
    # behaviour just flips enabled=true on these and disables the new
    # scaled ladder).
    op.execute(
        """
        UPDATE exit_rules
        SET enabled = FALSE,
            description = COALESCE(description, '') ||
                ' (DISABLED 2026-05-05 by migration 0019 — superseded by scaled_profit_close ladder)'
        WHERE rule_type = 'profit_pct'
          AND structure_type IN ('iron_condor', 'iron_butterfly')
          AND threshold IN (0.50, 0.25)
        """
    )

    # ───────────── Seed the scaled_profit_close ladder ─────────────
    # Iron condor — 25 / 50 / 75 of MAX PROFIT, qty_fractions chosen so
    # 1/3 of the ORIGINAL lot exits at each scale (1/3 + 1/2 of remaining
    # 2/3 + all of remaining 1/3 = 100%). Priority 10 mirrors the legacy
    # take-profit close so wing_capture (15) and time_dte (20) still
    # compose correctly.
    op.execute(
        """
        INSERT INTO exit_rules
            (strategy, structure_type, rule_type, threshold, qty_fraction, action, enabled, priority, description)
        VALUES
            (NULL, 'iron_condor', 'scaled_profit_close', 0.25, 0.33, 'close', TRUE, 10,
             'Scale 1/3: close 1/3 of original at 25%% of max profit'),
            (NULL, 'iron_condor', 'scaled_profit_close', 0.50, 0.50, 'close', TRUE, 10,
             'Scale 2/3: close 1/2 of remaining (= 1/3 of original) at 50%% of max profit'),
            (NULL, 'iron_condor', 'scaled_profit_close', 0.75, 1.00, 'close', TRUE, 10,
             'Scale 3/3 (runner): close all remaining at 75%% of max profit'),
            (NULL, 'iron_butterfly', 'scaled_profit_close', 0.15, 0.33, 'close', TRUE, 10,
             'Iron butterfly scale 1/3: close 1/3 of original at 15%% of max profit (tighter than condor — narrower wings)'),
            (NULL, 'iron_butterfly', 'scaled_profit_close', 0.30, 0.50, 'close', TRUE, 10,
             'Iron butterfly scale 2/3: close 1/2 of remaining at 30%% of max profit'),
            (NULL, 'iron_butterfly', 'scaled_profit_close', 0.50, 1.00, 'close', TRUE, 10,
             'Iron butterfly scale 3/3 (runner): close all remaining at 50%% of max profit')
        """
    )


def downgrade() -> None:
    # 1. Drop the seeded scaled_profit_close rows. Order matters: must
    #    delete BEFORE the CHECK constraint reverts since the constraint
    #    would reject existing rows.
    op.execute(
        "DELETE FROM exit_rules WHERE rule_type = 'scaled_profit_close'"
    )
    # 2. Re-enable the soft-disabled legacy rules.
    op.execute(
        """
        UPDATE exit_rules
        SET enabled = TRUE,
            description = REPLACE(
                COALESCE(description, ''),
                ' (DISABLED 2026-05-05 by migration 0019 — superseded by scaled_profit_close ladder)',
                ''
            )
        WHERE rule_type = 'profit_pct'
          AND structure_type IN ('iron_condor', 'iron_butterfly')
        """
    )
    # 3. Drop the new CHECK constraints.
    op.drop_constraint(
        "ck_exit_rules_qty_fraction", "exit_rules", type_="check"
    )
    op.drop_constraint(
        "ck_exit_rules_rule_type", "exit_rules", type_="check"
    )
    op.create_check_constraint(
        "ck_exit_rules_rule_type",
        "exit_rules",
        "rule_type IN ('profit_pct','time_dte','loss_pct','delta_breach','wing_capture')",
    )
    # 4. Drop the new columns.
    op.drop_column("trades", "original_qty")
    op.drop_column("trades", "partial_close_log")
    op.drop_column("exit_rules", "qty_fraction")
