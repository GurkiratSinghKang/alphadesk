"""wing_capture exit rule — early-close defined-risk credits to harvest long-wing time value

Revision ID: 0018_exit_rule_wing_capture
Revises: 0017_app_config
Create Date: 2026-05-05

AMD postmortem 2026-05: an iron condor gapped to max-loss territory
overnight. The assistant advised "hold to expiry — letting it ride is
cheaper" based on flawed intrinsic-value math. The user actually closed
at market open, capturing ~$200 of residual time value on the protective
long wing. Holding to expiration would have locked in max loss and
zeroed that residual.

This migration adds:

1. Updated CHECK constraint on ``exit_rules.rule_type`` to allow
   ``'wing_capture'`` (Postgres rejects rows whose rule_type isn't in
   the constraint list).
2. A new seed rule:

   * ``structure_type='*'`` — engine filters by structure_type list at
     evaluation time (DEFINED_RISK_CREDIT_STRUCTURES in
     ``services.exit_rules``); the seed must be wildcard so it scopes
     across iron_condor, iron_butterfly, vertical_spread,
     bull_put_spread, bear_call_spread.
   * ``threshold=0.80`` — fire at 80% of max_loss.
   * ``priority=15`` — between the take-profit close (10) and the
     time-based close (20). The loss alert (priority 5) still fires
     first if both match — that's intentional: alert the operator
     before any close.
   * ``action='close'`` — auto-harvest. Operators who want
     alert-then-manual can disable this rule and rely on ``loss_pct``
     (priority 5, alert).
"""
from __future__ import annotations

from alembic import op


revision = "0018_exit_rule_wing_capture"
down_revision = "0017_app_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ───────────── Update CHECK constraint to allow 'wing_capture' ─────────────
    # Postgres requires DROP + ADD; there's no ALTER CONSTRAINT for CHECK.
    op.drop_constraint(
        "ck_exit_rules_rule_type", "exit_rules", type_="check"
    )
    op.create_check_constraint(
        "ck_exit_rules_rule_type",
        "exit_rules",
        "rule_type IN ('profit_pct','time_dte','loss_pct','delta_breach','wing_capture')",
    )

    # ───────────── Seed the wing_capture rule ─────────────
    # structure_type='*' — the engine's _rule_fires checks the
    # DEFINED_RISK_CREDIT_STRUCTURES set at evaluation time, so the row
    # itself is a wildcard. Threshold 0.80 = 80% of max_loss. Priority 15
    # sits between the take-profit close (10) and the time-based close (20).
    op.execute(
        """
        INSERT INTO exit_rules
            (strategy, structure_type, rule_type, threshold, action, enabled, priority, description)
        VALUES
            (NULL, '*', 'wing_capture', 0.80, 'close', TRUE, 15,
             'Close defined-risk credit (iron_condor / iron_butterfly / vertical_spread / bull_put_spread / bear_call_spread) at 80%% of max loss when DTE > 1 — harvests residual long-wing time value instead of holding to expiration max loss (AMD postmortem 2026-05)')
        """
    )


def downgrade() -> None:
    # Remove the seeded rule first, then revert the CHECK constraint —
    # Postgres would reject the constraint downgrade if a wing_capture
    # row still existed.
    op.execute(
        "DELETE FROM exit_rules WHERE rule_type = 'wing_capture'"
    )
    op.drop_constraint(
        "ck_exit_rules_rule_type", "exit_rules", type_="check"
    )
    op.create_check_constraint(
        "ck_exit_rules_rule_type",
        "exit_rules",
        "rule_type IN ('profit_pct','time_dte','loss_pct','delta_breach')",
    )
