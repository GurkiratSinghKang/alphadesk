"""add side column to trades and trade_ledger

Revision ID: 0002_add_side
Revises: 0001_baseline
Create Date: 2026-04-18

Adds the ``side`` column (direction of the position -- "long" or "short")
to both the SQLAlchemy-managed ``trades`` table and the raw-DDL-managed
``trade_ledger`` table.  The column was already declared on the ORM model
(``data/storage/models.py`` -> ``Trade.side``) and already topped up in
production via ``ALTER TABLE trade_ledger ADD COLUMN IF NOT EXISTS side ...``
in ``data/ingestion/trade_ledger.py``.  This revision codifies those changes
as a reproducible migration.

Notes on the two tables:

* ``trades``: SQLAlchemy ORM, ``side VARCHAR(10) NULL``, indexed.
* ``trade_ledger``: raw DDL, ``side VARCHAR(8) NULL DEFAULT 'long'``.

Operators who are running this for the first time on a DB that already has
one or both columns (because ``ADD COLUMN IF NOT EXISTS`` already applied)
should instead stamp straight to head so Alembic doesn't try to add them
again:
    alembic stamp 0002_add_side
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0002_add_side"
down_revision: Union[str, None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- trades.side ---
    op.add_column(
        "trades",
        sa.Column("side", sa.String(length=10), nullable=True),
    )
    op.create_index("ix_trades_side", "trades", ["side"])

    # --- trade_ledger.side ---
    op.add_column(
        "trade_ledger",
        sa.Column(
            "side",
            sa.String(length=8),
            nullable=True,
            server_default="long",
        ),
    )


def downgrade() -> None:
    op.drop_column("trade_ledger", "side")
    op.drop_index("ix_trades_side", table_name="trades")
    op.drop_column("trades", "side")
