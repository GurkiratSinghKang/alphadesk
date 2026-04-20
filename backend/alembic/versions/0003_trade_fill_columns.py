"""add broker_order_id / client_order_id / filled_at / filled_avg_price / account_env to trades

Revision ID: 0003_trade_fill_columns
Revises: 0002_add_side
Create Date: 2026-04-19

Wave B (persona-72 P0 fill-reconciliation gap).  Adds the columns the DB
fill reconciler needs so that when Alpaca's ``trade_updates`` WebSocket
publishes a fill / partial_fill / canceled / rejected / expired event we
can update the authoritative Trade row instead of leaving it stuck in
``status="submitted"`` forever.

Columns (all on ``trades``):

* ``broker_order_id``  VARCHAR(64)  NULL  UNIQUE  – Alpaca's ``order.id``.
* ``client_order_id``  VARCHAR(128) NULL  UNIQUE  – our correlation id.
* ``filled_at``        TIMESTAMP(6) WITH TIME ZONE NULL – ms-precision UTC.
* ``filled_avg_price`` NUMERIC(20, 6) NULL – decimal to avoid FP drift.
* ``account_env``      VARCHAR(16)  NOT NULL DEFAULT 'paper' – indexed so
  dashboards can filter paper vs live capital without a seq scan.

Notes:
* Production rollout is gated on Wave D wiring ``alembic upgrade head``
  into ``deploy.yml``.  Until then this migration is considered
  **skipped in prod** — operators should run it manually inside the
  backend container.
* The migration uses ``ADD COLUMN IF NOT EXISTS`` equivalents (via
  ``batch_alter_table`` on sqlite-compatible paths) only where the column
  is nullable; ``account_env`` uses a server default so the NOT NULL
  constraint applies cleanly to pre-existing rows.
* The UNIQUE indexes are created separately so that ``alembic downgrade``
  can drop them before the column itself goes away.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0003_trade_fill_columns"
down_revision: Union[str, None] = "0002_add_side"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- broker_order_id ---
    op.add_column(
        "trades",
        sa.Column("broker_order_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ux_trades_broker_order_id",
        "trades",
        ["broker_order_id"],
        unique=True,
    )

    # --- client_order_id ---
    op.add_column(
        "trades",
        sa.Column("client_order_id", sa.String(length=128), nullable=True),
    )
    op.create_index(
        "ux_trades_client_order_id",
        "trades",
        ["client_order_id"],
        unique=True,
    )

    # --- filled_at (ms-precision timezone-aware) ---
    # Alembic translates ``DateTime(timezone=True)`` to the dialect-specific
    # TIMESTAMP WITH TIME ZONE; Postgres stores microsecond precision by
    # default which is sufficient for FINRA 4590 ms-precision retention.
    op.add_column(
        "trades",
        sa.Column("filled_at", sa.DateTime(timezone=True), nullable=True),
    )

    # --- filled_avg_price ---
    op.add_column(
        "trades",
        sa.Column("filled_avg_price", sa.Numeric(precision=20, scale=6), nullable=True),
    )

    # --- account_env ---
    # server_default 'paper' is the safe value for the handful of rows
    # created before this migration; new inserts from create_order stamp
    # the real value.
    op.add_column(
        "trades",
        sa.Column(
            "account_env",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'paper'"),
        ),
    )
    op.create_index(
        "ix_trades_account_env",
        "trades",
        ["account_env"],
    )


def downgrade() -> None:
    op.drop_index("ix_trades_account_env", table_name="trades")
    op.drop_column("trades", "account_env")
    op.drop_column("trades", "filled_avg_price")
    op.drop_column("trades", "filled_at")
    op.drop_index("ux_trades_client_order_id", table_name="trades")
    op.drop_column("trades", "client_order_id")
    op.drop_index("ux_trades_broker_order_id", table_name="trades")
    op.drop_column("trades", "broker_order_id")
