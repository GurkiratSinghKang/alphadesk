"""trade_ledger perf indexes + audit_log default-cleanup partial index

Revision ID: 0008_trade_ledger_perf_indexes
Revises: 0007_halt_state_and_trade_kind
Create Date: 2026-04-19

Wave 6α — persona-124 DBA scale-killer query paths. Three indexes that
turn three different seq-scan-at-50M-rows queries into bounded range scans:

1. ``ix_trade_ledger_status_exit_time``  (Fix 1 + prerequisite for Fix 3)
   ``(status, exit_time DESC)`` on ``trade_ledger``

   Serves:
   * ``/portfolio/summary``'s new ``SUM(pnl) WHERE status='closed' AND
     exit_time >= date_trunc('day', NOW())`` aggregate — the index prefix
     on ``status`` isolates the closed rows; the ``exit_time DESC`` suffix
     lets Postgres stop scanning at the day-boundary.
   * ``/strategies/leaderboard``'s ``GROUP BY strategy`` aggregate — same
     prefix on ``status`` means the planner only touches closed rows.

2. ``ix_trade_ledger_entry_time``
   ``(entry_time DESC)`` on ``trade_ledger``

   Serves ``/trades/history``'s new ``list_paginated(order_by='entry_time',
   descending=True)`` path. Without this index the ``ORDER BY entry_time
   DESC LIMIT n OFFSET m`` requires a full sort of the ledger, which
   dominates page cost at scale. The index is the exact sort order the
   query asks for, so the planner delivers the page via an index scan.

3. ``ix_audit_log_default_cleanup``  (Fix 4)
   Partial index ``(ts)`` on ``audit_log`` WHERE retained_for_compliance IS FALSE

   Serves ``scripts/audit_log_cleanup.sweep_once``'s default-tier DELETE
   (``WHERE event NOT IN (…) AND ts < cutoff AND retained_for_compliance
   IS FALSE``). A full ``(event, ts DESC)`` index can't serve ``event NOT
   IN`` — the anti-match forces a seq scan on today's hot table. This
   partial index narrows to the compliance-eligible-to-delete subset
   ordered by ``ts``, so the cutoff DELETE is a bounded range.

All three indexes are built with ``postgresql_concurrently=True`` so
creation doesn't take the tables' ACCESS EXCLUSIVE lock — the prod
``trade_ledger`` is hot 24/7 (fills, pipeline sync) and blocking it for
the CREATE INDEX duration would drop orders on the floor.

Downgrade drops all three indexes cleanly (also concurrently).
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0008_trade_ledger_perf_indexes"
down_revision: Union[str, None] = "0007_halt_state_and_trade_kind"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ``CREATE INDEX CONCURRENTLY`` can't run inside a transaction block;
    # alembic wraps every migration in one by default, so we have to
    # explicitly commit out of the open txn and then drive the CONCURRENTLY
    # statements against the bound connection directly.
    with op.get_context().autocommit_block():
        # --- Fix 1 + Fix 3 prerequisite --------------------------------
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_trade_ledger_status_exit_time "
            "ON trade_ledger (status, exit_time DESC)"
        )

        # --- Fix 2 prerequisite: /trades/history paginated sort --------
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_trade_ledger_entry_time "
            "ON trade_ledger (entry_time DESC)"
        )

        # --- Fix 4: audit_log default-tier cleanup ---------------------
        # Partial predicate matches the script's DELETE exactly. Planner
        # will pick this up for both the default-tier and the explicit
        # per-event tier deletes (those already carry the
        # retained_for_compliance IS FALSE guard in their WHERE clause).
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_audit_log_default_cleanup "
            "ON audit_log (ts) "
            "WHERE retained_for_compliance IS FALSE"
        )


def downgrade() -> None:
    # Same reason as upgrade — DROP INDEX CONCURRENTLY is preferred so
    # the prod ledger isn't locked during rollback.
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS ix_audit_log_default_cleanup"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS ix_trade_ledger_entry_time"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS ix_trade_ledger_status_exit_time"
        )
