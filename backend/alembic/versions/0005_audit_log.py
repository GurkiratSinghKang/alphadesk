"""audit_log table for compliance-trail persistence

Revision ID: 0005_audit_log
Revises: 0004_execution_quality
Create Date: 2026-04-19

Wave 3K — persona-87 P1 #1. Every ``_audit(...)`` callsite in
``backend/api/routes/auth.py``, ``backend/api/routes/trades.py`` and
``backend/core/trading_gate.py`` was stdout-only. On container rotation the
compliance trail disappeared with the log buffer — regulators auditing a
FINRA 4530 / SEC 17a-4 event would find nothing beyond whatever the
aggregator had already shipped. This migration adds the durable backing
store.

Columns on ``audit_log``:

* ``id``         BIGSERIAL PRIMARY KEY — monotonically increasing surrogate
  so pagination cursors ("give me rows since id=12345") are stable even as
  concurrent inserts race. BIGINT because at 100 events/s this fills a
  regular INT in ~2 years.
* ``ts``         TIMESTAMPTZ NOT NULL DEFAULT NOW() — server-side clock so
  a caller with a skewed laptop doesn't corrupt the timeline. TZ-aware
  storage so we never have to re-interpret "did this mean UTC or America/
  New_York?" in a postmortem.
* ``event``      VARCHAR(64) NOT NULL — short identifier
  (``login`` / ``logout`` / ``change_password`` / ``halt_trading`` /
  ``wash_trade_rejected`` / ``live_gate_reject`` / …). Constrained to 64
  chars because the callers use short snake_case names and anything longer
  is almost certainly a bug.
* ``username``   VARCHAR(128) NULL — acting principal when resolvable;
  NULL for pre-auth events (e.g. failed login against a non-existent
  user). 128 is intentionally generous — our admin username is single-
  digit chars, but a future multi-tenant world might embed tenant id.
* ``ip``         INET NULL — caller IP when available. Uses Postgres's
  native INET type so we can index and query against CIDR blocks natively
  ("every event from 10.0.0.0/8 in the last hour").
* ``request_id`` VARCHAR(64) NULL — the request-correlation id plumbed
  through from ``request.state.request_id`` / ``REQUEST_ID.get()``. Lets
  investigators pivot from an audit row to every structured log line emitted
  during the same request.
* ``details``    JSONB NULL — free-form kwargs captured by the helper
  (``new_password_version``, ``reason``, ``symbol``, ``prev_price`` etc.).
  JSONB so we can query with ``details->>'reason' = 'password_changed'``.

Indexes:

* ``ix_audit_log_ts``              — ``(ts DESC)``: the default query
  shape is "show me the last N events across all users / events"; this
  index makes that a single index-only scan.
* ``ix_audit_log_event_ts``        — ``(event, ts DESC)``: the
  "everything that happened to `login` in the last day" query.
* ``ix_audit_log_username_ts``     — ``(username, ts DESC)``: the
  "everything user X did in the last hour" query.

Downgrade drops the table and all indexes cleanly — this is a new table,
no upstream references.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import INET, JSONB


# revision identifiers, used by Alembic.
revision: str = "0005_audit_log"
down_revision: Union[str, None] = "0004_execution_quality"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("event", sa.String(length=64), nullable=False),
        sa.Column("username", sa.String(length=128), nullable=True),
        # INET is the native Postgres type for IPv4/IPv6 addresses; it
        # accepts both "203.0.113.5" and "2001:db8::1" and supports CIDR
        # containment queries in pg_hba-style tooling.
        sa.Column("ip", INET(), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("details", JSONB(), nullable=True),
    )

    # --- Indexes ---
    # Index names use the project naming convention (``ix_<table>_<col>``)
    # so alembic autogenerate picks them up on future revisions.
    op.create_index(
        "ix_audit_log_ts",
        "audit_log",
        [sa.text("ts DESC")],
    )
    op.create_index(
        "ix_audit_log_event_ts",
        "audit_log",
        ["event", sa.text("ts DESC")],
    )
    op.create_index(
        "ix_audit_log_username_ts",
        "audit_log",
        ["username", sa.text("ts DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_log_username_ts", table_name="audit_log")
    op.drop_index("ix_audit_log_event_ts", table_name="audit_log")
    op.drop_index("ix_audit_log_ts", table_name="audit_log")
    op.drop_table("audit_log")
