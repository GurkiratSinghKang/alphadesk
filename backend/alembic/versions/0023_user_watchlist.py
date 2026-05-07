"""Replace dead global ``watchlists`` table with per-user ``user_watchlist``.

Revision ID: 0023_user_watchlist
Revises: 0022_trade_max_loss_at_submit
Create Date: 2026-05-07

Iter 17 of the find-fix-repeat loop: persisted user-scoped watchlist
replaces the ``/api/v1/symbols/watchlist`` stub. The legacy
``watchlists`` table (model in ``data.storage.models.Watchlist``) was a
dead global single-row table — ``name UNIQUE`` and a ``symbols`` JSONB
array, never referenced by any shipping code path. We drop it and stand
up a per-user row table keyed on ``(username, symbol)``.

Naming: the new table is ``user_watchlist`` (singular) so the migration
can DROP the old ``watchlists`` plural without colliding. ``username`` is
a string (not an FK to ``users.id``) because the existing auth surface
keys on usernames per ``backend/api/routes/user.py:70`` — every
authenticated handler reads ``username: str = Depends(require_auth)``
and the rows downstream all use that string. Adding an FK would force a
join on every read for no real integrity benefit (require_auth gates
every write).

Downgrade restores nothing — the dropped ``watchlists`` table was dead
code with no live rows in any environment, so a downgrade only needs to
remove ``user_watchlist`` and the old global table stays gone.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0023_user_watchlist"
down_revision = "0022_trade_max_loss_at_submit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Drop the dead global ``watchlists`` table. The legacy ORM model
    #    declared ``name UNIQUE`` + a ``symbols`` JSONB array but no shipping
    #    code path ever read or wrote rows from it — confirmed by
    #    ``grep -rn "Watchlist\\b" backend/`` returning only the model
    #    definition, the export/erase boilerplate (which we update in this
    #    iteration), and the isolation test (also updated).
    #
    #    ``IF EXISTS`` so a re-run on a DB where 0023 partially applied is
    #    idempotent.
    op.execute("DROP TABLE IF EXISTS watchlists CASCADE")

    # 2. Create the new per-user table. (username, symbol) is unique so a
    #    second POST of the same symbol becomes a no-op INSERT (caught by
    #    the constraint and handled in the route as idempotent). The
    #    ``username`` index covers the GET path which scans by user.
    op.create_table(
        "user_watchlist",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("username", "symbol", name="user_watchlist_unique"),
    )
    op.create_index(
        "user_watchlist_username_idx",
        "user_watchlist",
        ["username"],
    )


def downgrade() -> None:
    # Drop the new table. Do NOT recreate the legacy global ``watchlists``
    # table — it was dead code, removing it permanently is intentional.
    op.drop_index("user_watchlist_username_idx", table_name="user_watchlist")
    op.drop_table("user_watchlist")
