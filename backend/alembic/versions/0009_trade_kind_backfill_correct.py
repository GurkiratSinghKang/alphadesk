"""trade_kind backfill correctness fix — closed rows → *_close

Revision ID: 0009_trade_kind_backfill_correct
Revises: 0008_trade_ledger_perf_indexes
Create Date: 2026-04-19

Wave 6β Fix 3 (from Round-5 deferred + persona 106).

Problem
-------
Migration ``0007_halt_state_and_trade_kind`` introduced the
``trades.trade_kind`` column and seeded every historical row as
``long_open`` / ``short_open`` based on ``trades.side``.  That was the
conservative choice at the time (rather than leaving it NULL), but it
MIS-CLASSIFIES every already-closed trade in the ledger:

    * A row with ``side='long'`` AND ``exit_time IS NOT NULL`` is a
      LONG-EXIT (we've already sold to close) — ``trade_kind`` should
      be ``long_close``, not ``long_open``.
    * A row with ``side='short'`` AND ``exit_time IS NOT NULL`` is a
      SHORT-COVER — ``trade_kind`` should be ``short_close``.

Every downstream consumer that groups by ``trade_kind`` (P&L by open
direction, position-snapshot diagnostics, fill-reconciler trade-kind
inference) therefore sees a completely inaccurate breakdown: every
closed trade in the ledger appears as an "open" trade with a non-null
``exit_time``.

Fix
---
This migration runs a SINGLE UPDATE pass that flips the trade_kind on
every row where ``exit_time IS NOT NULL`` — those are the CLOSED rows
from the 0007 backfill that must now show a ``*_close`` classification.

Rows with ``exit_time IS NULL`` are left alone:
    * ``trade_kind='long_open'`` / ``'short_open'`` stays correct —
      these are still-open rows.
    * ``trade_kind IS NULL`` stays NULL — pre-0007 fixture rows
      without a classification.

We deliberately use a SINGLE UPDATE statement (with CASE WHEN) rather
than two separate UPDATEs so the migration is atomic on the database
side — no in-between state where half the closed rows have been
flipped and the other half haven't.

Downgrade
---------
Reverts closed rows back to their post-0007 ``*_open`` classification
so the schema version is recoverable without data loss beyond what 0007
itself imposed.  Anyone rolling back will land on the (still wrong, but
compatible) 0007 state.

Safety
------
* Only touches rows where ``exit_time IS NOT NULL``; still-open trades
  are never modified.
* Condition on ``trade_kind IN ('long_open','short_open')`` so if some
  production rows already carry the correct ``*_close`` value (e.g.
  freshly-classified via the fill reconciler between 0007 landing and
  this migration running) they are not clobbered.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "0009_trade_kind_backfill_correct"
# Chain off 0008 (Wave 6α perf indexes) — both 0008 and 0009 originally
# branched from 0007 in parallel waves; resolved by re-chaining 0009
# onto 0008 (neither migration depends on the other's content).
down_revision: Union[str, None] = "0008_trade_ledger_perf_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Single UPDATE: flip the two *_open classifications on closed rows
    # to the matching *_close.  The CASE expression lets us do both
    # legs in one statement instead of two back-to-back UPDATEs, which
    # keeps the migration atomic and avoids a partial-backfill state if
    # the DB is interrupted mid-way.
    #
    # WHERE filter:
    #   * exit_time IS NOT NULL  — only closed trades.
    #   * trade_kind IN ('long_open','short_open') — don't clobber rows
    #     that already carry a correct *_close classification (e.g.
    #     freshly-reconciled fills between 0007 and 0009).
    op.execute(
        """
        UPDATE trades
           SET trade_kind = CASE
               WHEN side = 'long'  OR trade_kind = 'long_open'  THEN 'long_close'
               WHEN side = 'short' OR trade_kind = 'short_open' THEN 'short_close'
               ELSE trade_kind
           END
         WHERE exit_time IS NOT NULL
           AND trade_kind IN ('long_open', 'short_open')
        """
    )


def downgrade() -> None:
    # Reverse: closed rows we flipped above go back to *_open so the
    # row state matches the immediately-post-0007 baseline.  Anyone who
    # rolls this migration back ends up in the same state 0007 left
    # them, which is compatible with any code that does NOT depend on
    # the Fix-3 correctness of trade_kind.
    op.execute(
        """
        UPDATE trades
           SET trade_kind = CASE
               WHEN side = 'long'  OR trade_kind = 'long_close'  THEN 'long_open'
               WHEN side = 'short' OR trade_kind = 'short_close' THEN 'short_open'
               ELSE trade_kind
           END
         WHERE exit_time IS NOT NULL
           AND trade_kind IN ('long_close', 'short_close')
        """
    )
