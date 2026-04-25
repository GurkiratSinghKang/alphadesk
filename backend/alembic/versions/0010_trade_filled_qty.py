"""add filled_qty column to trades

Revision ID: 0010_trade_filled_qty
Revises: 0009_trade_kind_backfill_correct
Create Date: 2026-04-24

J-17 (Round-6 persona-J P2 #15) — record the actually-filled quantity
on every Trade row.

Until this column landed the only authoritative qty for a trade row was
the SUBMITTED qty stamped on the leg JSON at order-creation time.
Partial fills updated ``status`` to ``partial`` and ``filled_avg_price``
to the volume-weighted average across the partial fills, but never
recorded HOW MANY shares had actually filled. Downstream consumers
(``backend/api/routes/pipeline.py::pipeline_positions``, the report
builders, and P&L attribution) all read leg.qty and silently assumed a
100%-filled order — every partial fill therefore showed the wrong size
in the dashboard.

The column is populated by ``backend/data/ingestion/fill_reconciler.py``
when a ``fill`` or ``partial_fill`` event arrives from Alpaca's
``trade_updates`` WebSocket. Existing rows stay NULL until the next
fill event lands; the schema is designed so a NULL value is treated by
``pipeline_positions`` as "fall back to leg-level qty" (the legacy
behaviour pre-J-17). This keeps the migration backward-safe.

Schema choice
-------------
* ``Numeric(20, 4)`` matches Alpaca's qty precision. Four decimals
  accommodate fractional-share orders without binary-float drift on
  downstream P&L. The 20-digit overall precision is overkill but
  matches the existing ``filled_avg_price`` precision so the table's
  numeric columns are consistent.
* NULLABLE so legacy / pre-fill rows pass post-migration validation.

Rollback
--------
``downgrade()`` simply drops the column. No data loss beyond
fill-quantity records that the application can re-derive on the next
fill event.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0010_trade_filled_qty"
down_revision: Union[str, None] = "0009_trade_kind_backfill_correct"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "trades",
        sa.Column("filled_qty", sa.Numeric(precision=20, scale=4), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("trades", "filled_qty")
