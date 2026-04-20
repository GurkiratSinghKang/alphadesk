"""halt_state singleton table + trades.trade_kind column

Revision ID: 0007_halt_state_and_trade_kind
Revises: 0006_compliance_retention
Create Date: 2026-04-19

Wave 4P — two P0 safety-critical schema changes rolled into a single
revision so operators don't have to coordinate two back-to-back downtime
windows.

1. ``halt_state`` (Fix 1, P96)
   --------------------------
   Before this migration the emergency kill-switch flag lived only in
   Redis under ``trading:halted``.  A ``FLUSHALL`` (or a cold Redis
   restart with no persistence) silently un-halted trading — the next
   pipeline tick would see an absent key, classify the system as
   NOT-halted (``_is_trading_halted()`` returns False when the key is
   missing), and auto-resume live orders without operator intent.

   The new table makes Postgres the SOURCE OF TRUTH for the halt flag.
   Redis is relegated to a cache-only role (0.5s timeout + re-read from
   DB on miss).  Because we only ever want ONE row in this table, we
   enforce the singleton via a CHECK (id = 1) constraint — every INSERT
   / UPDATE goes through id = 1 and a defensive second row insert will
   fail the CHECK.

   Columns:
   * ``id``               INTEGER PRIMARY KEY DEFAULT 1 — singleton
     surrogate.  CHECK (id = 1) below makes a second row impossible.
   * ``is_halted``        BOOLEAN NOT NULL DEFAULT FALSE — the flag.
   * ``halted_by``        VARCHAR(128) NULL — username of the operator
     who last flipped the state (NULL for the seed row).
   * ``halted_at``        TIMESTAMPTZ NULL — when the flag last flipped
     to TRUE.  NULL when ``is_halted = FALSE``.
   * ``reason``           VARCHAR(256) NULL — free-form halt reason
     captured at halt time.
   * ``pending_flatten``  BOOLEAN NOT NULL DEFAULT FALSE — Wave 4P Fix 2
     (P104): when the operator requests ``flatten=True`` but the market
     is closed, we queue the intent here so the next-open reconciler
     can fire the close orders.

   Seed: ``INSERT INTO halt_state (id, is_halted) VALUES (1, FALSE) ON
   CONFLICT (id) DO NOTHING;`` so the read path always finds a row.

2. ``trades.trade_kind`` (Fix 3, P97)
   ----------------------------------
   Adds a classification column to the trades table:
       ``long_open`` | ``long_close`` | ``short_open`` | ``short_close``

   Before this column the ``trades.side`` column was derived from the
   broker order's SIDE (``buy`` → ``long``, ``sell`` → ``short``). That
   is wrong for closing orders: selling TO CLOSE a long position is a
   LONG-EXIT, not a NEW SHORT.  The fill reconciler now computes
   ``trade_kind`` against the pre-fill position state and persists the
   correct classification here.

   Existing rows are backfilled with a best-effort inspection of the
   ``legs`` JSON + the legacy ``side`` column:
       * ``side = 'long'``  → ``long_open``
       * ``side = 'short'`` → ``short_open``
       * NULL               → NULL (don't guess)

Downgrade drops both changes cleanly.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0007_halt_state_and_trade_kind"
down_revision: Union[str, None] = "0006_compliance_retention"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- Fix 1 (P96): halt_state singleton table -----------------------
    op.create_table(
        "halt_state",
        sa.Column("id", sa.Integer(), primary_key=True, server_default=sa.text("1")),
        sa.Column(
            "is_halted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("FALSE"),
        ),
        sa.Column("halted_by", sa.String(length=128), nullable=True),
        sa.Column("halted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.String(length=256), nullable=True),
        sa.Column(
            "pending_flatten",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("FALSE"),
        ),
        sa.CheckConstraint("id = 1", name="ck_halt_state_singleton"),
    )

    # Seed the singleton row so the read path always finds id=1. ON
    # CONFLICT is a no-op if some hot-fix script already created the row.
    op.execute(
        "INSERT INTO halt_state (id, is_halted, pending_flatten) "
        "VALUES (1, FALSE, FALSE) ON CONFLICT (id) DO NOTHING"
    )

    # ---- Fix 3 (P97): trades.trade_kind column -------------------------
    op.add_column(
        "trades",
        sa.Column("trade_kind", sa.String(length=16), nullable=True),
    )
    op.create_index(
        "ix_trades_trade_kind",
        "trades",
        ["trade_kind"],
    )

    # Best-effort backfill: map the legacy ``side`` column onto the new
    # ``trade_kind`` assuming all existing rows are OPENING trades.  This
    # is the conservative choice — a mis-classified close becomes a
    # worse-but-still-meaningful ``long_open``/``short_open`` rather than
    # an incorrect NULL on an already-settled row.  The true-classifying
    # fill reconciler will overwrite on any future transition.
    op.execute(
        "UPDATE trades SET trade_kind = 'long_open'  WHERE side = 'long'  AND trade_kind IS NULL"
    )
    op.execute(
        "UPDATE trades SET trade_kind = 'short_open' WHERE side = 'short' AND trade_kind IS NULL"
    )


def downgrade() -> None:
    # Reverse order of creation.
    op.drop_index("ix_trades_trade_kind", table_name="trades")
    op.drop_column("trades", "trade_kind")

    op.drop_table("halt_state")
