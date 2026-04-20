"""execution-quality columns + optimistic-locking version on trades

Revision ID: 0004_execution_quality
Revises: 0003_trade_fill_columns
Create Date: 2026-04-19

Wave 2G — persona-79 Race 2 (concurrent fill_reconciler vs
reconcile_on_boot races) + persona-85 gaps 1/2/10 (execution-quality
records for venue analysis, NBBO at fill, price improvement reporting).

Columns added (all on ``trades``):

* ``execution_venue``           VARCHAR(16)    NULL — e.g. ``ARCA`` /
  ``EDGX`` / ``CITADEL_INT``. Captured from the Alpaca fill payload's
  ``order.venue`` / ``execution.venue`` field when present; many retail
  router fills don't expose a venue and stay NULL.
* ``nbbo_bid_at_fill``          NUMERIC(20, 6) NULL — top-of-book bid at
  fill time, snapped from the quote-stream Redis cache. Used to compute
  ``price_improvement_cents`` and to bucket fills against the NBBO mid.
* ``nbbo_ask_at_fill``          NUMERIC(20, 6) NULL — top-of-book ask
  at fill time. Same source / null-semantics as the bid.
* ``price_improvement_cents``   NUMERIC(10, 4) NULL — signed cents the
  fill price beat the NBBO mid (positive = improvement, negative =
  worse than mid). Reconciler computes this when both NBBO sides are
  available.
* ``version``                   INTEGER NOT NULL DEFAULT 0 — optimistic
  concurrency token consumed by SQLAlchemy ``__mapper_args__ =
  {"version_id_col": Trade.version}``. Auto-bumped on every UPDATE; a
  concurrent transition raises ``StaleDataError`` instead of silently
  overwriting the winner. Default 0 so existing rows pass the post-
  migration NOT NULL check without a separate backfill.

Notes:
* No new indexes — these columns are written-once (per fill) and only
  read in batched reports (BI cube, audit export). The cost of an extra
  ``ix_`` on every fill insert outweighs the seq-scan cost of the
  monthly venue-analysis query.
* Downgrade is symmetric: every column drops cleanly because we never
  add NOT NULL constraints without a server default.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0004_execution_quality"
down_revision: Union[str, None] = "0003_trade_fill_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- execution_venue ---
    op.add_column(
        "trades",
        sa.Column("execution_venue", sa.String(length=16), nullable=True),
    )

    # --- NBBO snapshot at fill time ---
    op.add_column(
        "trades",
        sa.Column("nbbo_bid_at_fill", sa.Numeric(precision=20, scale=6), nullable=True),
    )
    op.add_column(
        "trades",
        sa.Column("nbbo_ask_at_fill", sa.Numeric(precision=20, scale=6), nullable=True),
    )

    # --- price_improvement_cents (signed) ---
    op.add_column(
        "trades",
        sa.Column(
            "price_improvement_cents",
            sa.Numeric(precision=10, scale=4),
            nullable=True,
        ),
    )

    # --- version (optimistic locking token) ---
    # server_default '0' so the NOT NULL constraint applies cleanly to the
    # rows written before this migration. SQLAlchemy's
    # ``version_id_col`` mapping bumps the column on every UPDATE.
    op.add_column(
        "trades",
        sa.Column(
            "version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("trades", "version")
    op.drop_column("trades", "price_improvement_cents")
    op.drop_column("trades", "nbbo_ask_at_fill")
    op.drop_column("trades", "nbbo_bid_at_fill")
    op.drop_column("trades", "execution_venue")
