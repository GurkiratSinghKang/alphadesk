"""adverse_momentum_close exit rule + Trade.expected_move_pct snapshot column

Revision ID: 0019_exit_rule_adverse_momentum
Revises: 0020_exit_rule_scaled_profit_close
Create Date: 2026-05-05

M-O A. The wing_capture rule (priority 15) only fires once a defined-
risk credit position has reached 80% of max loss — but momentum-aware
traders cut losers earlier when the underlying gaps strongly INTO a
wing. The AMD postmortem 2026-05 case had AMD running +21% overnight
on an iron condor whose snapshotted ATM-straddle expected move was
8.55%, a ~2.46σ shock. The position was already 30%+ underwater at the
open and the writing was on the wall hours before the 80% threshold
hit. ``adverse_momentum_close`` (priority 12) fires earlier in that
sequence — at >=1.5σ adverse + >=30% loss — so the engine can cut
before the day's open hammers the position deeper.

This migration adds:

1. ``trades.expected_move_pct`` (Float, NULLABLE). Stamped at trade
   entry from the recommender's ATM-straddle 1-σ implied move (PERCENT
   units — 8.55 means 8.55%). NULL on legacy rows pre-this-migration;
   the engine treats NULL as "abstain" rather than zero.

2. CHECK-constraint widening on ``exit_rules.rule_type`` to allow
   ``'adverse_momentum_close'`` (Postgres rejects rows whose rule_type
   isn't in the constraint list).

3. A new seed rule:

   * ``structure_type='*'`` — engine filters per-structure via
     ``ADVERSE_DIRECTION_BY_STRUCTURE`` (in ``services.exit_rules``):
     short-vol structures (iron_condor / iron_butterfly /
     short_strangle / short_straddle) treat any large move as adverse;
     bear-side spreads gate on +moves; bull-side spreads gate on
     -moves; long-vol structures (long_call / long_put /
     long_straddle / long_strangle) NEVER fire.
   * ``threshold=1.5`` — fire at 1.5σ adverse move (σ = expected_move_pct).
   * ``priority=12`` — between profit_pct take-profit (10) and
     wing_capture (15). Profit-take scales win first; if a profit-take
     has already fired and we're now adverse-momentum, the residual
     gets cut before the deeper-loss wing_capture would fire.
   * ``action='close'`` — full close (qty_fraction default 1.0).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0019_exit_rule_adverse_momentum"
down_revision = "0020_exit_rule_scaled_profit_close"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ───────────── trades.expected_move_pct ─────────────
    # NULLABLE — every legacy row needs to keep loading. The engine
    # interprets NULL as "abstain": adverse_momentum_close will not fire
    # on a trade that lacks the snapshot, so wing_capture (priority 15)
    # still catches the position once it bleeds to 80%.
    op.add_column(
        "trades",
        sa.Column("expected_move_pct", sa.Float(), nullable=True),
    )

    # ───────────── widen exit_rules.rule_type CHECK constraint ─────────────
    # Postgres requires DROP + ADD; there's no ALTER CONSTRAINT for CHECK.
    # The current constraint already includes scaled_profit_close (added
    # in M-O P). Re-list the full set so this migration is self-contained.
    op.drop_constraint(
        "ck_exit_rules_rule_type", "exit_rules", type_="check"
    )
    op.create_check_constraint(
        "ck_exit_rules_rule_type",
        "exit_rules",
        "rule_type IN ("
        "'profit_pct','time_dte','loss_pct','delta_breach',"
        "'wing_capture','scaled_profit_close','adverse_momentum_close'"
        ")",
    )

    # ───────────── Seed the adverse_momentum_close rule ─────────────
    # structure_type='*' — engine filters per-structure via
    # ADVERSE_DIRECTION_BY_STRUCTURE at evaluation time. Threshold 1.5
    # is the σ multiplier; priority 12 sits between profit-take (10)
    # and wing_capture (15).
    op.execute(
        """
        INSERT INTO exit_rules
            (strategy, structure_type, rule_type, threshold, action,
             qty_fraction, enabled, priority, description)
        VALUES
            (NULL, '*', 'adverse_momentum_close', 1.5, 'close',
             1.0, TRUE, 12,
             'Cut losing trades fast when momentum confirms direction. Fires when (a) the underlying has moved >= 1.5σ adverse to the position (σ = trade.expected_move_pct snapshot from the ATM-straddle implied move at entry), AND (b) loss is already >= 30%% of max_loss. Long-vol structures (long_call / long_put / long_straddle / long_strangle) never fire — any move is favourable for them. AMD postmortem 2026-05.')
        """
    )


def downgrade() -> None:
    # Remove the seeded rule first, then revert the CHECK constraint —
    # Postgres would reject the constraint downgrade if an
    # adverse_momentum_close row still existed.
    op.execute(
        "DELETE FROM exit_rules WHERE rule_type = 'adverse_momentum_close'"
    )
    op.drop_constraint(
        "ck_exit_rules_rule_type", "exit_rules", type_="check"
    )
    op.create_check_constraint(
        "ck_exit_rules_rule_type",
        "exit_rules",
        "rule_type IN ("
        "'profit_pct','time_dte','loss_pct','delta_breach',"
        "'wing_capture','scaled_profit_close'"
        ")",
    )

    # Drop the column. The default for ``trades.expected_move_pct`` was
    # NULL so dropping doesn't lose any non-null user data on rollback
    # within the migration window.
    op.drop_column("trades", "expected_move_pct")
