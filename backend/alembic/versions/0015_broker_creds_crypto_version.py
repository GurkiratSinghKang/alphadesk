"""broker_connections crypto_version column

Revision ID: 0015_broker_creds_crypto_version
Revises: 0014_strategy_disabled_events
Create Date: 2026-05-05

Audit fix-D (2026-05-05): adds ``crypto_version`` to ``broker_connections``
so ``scripts/migrate_broker_credential_encryption.py`` can be re-run
idempotently. Existing rows default to 1 (the v1 ciphertext format that
predated the v2 PBKDF2 + per-encryption-salt upgrade); the migration
script bumps each row to 3 (v3 scrypt) after re-encrypting the
ciphertexts in place.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0015_broker_creds_crypto_version"
down_revision = "0014_strategy_disabled_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "broker_connections",
        sa.Column(
            "crypto_version",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )
    # Best-effort backfill — for the rare row whose ciphertext column
    # already contains a v3 prefix (e.g. created by an out-of-order test
    # fixture), set crypto_version to match what's actually on disk.
    # The bulk-migration script handles the remainder.
    op.execute(
        "UPDATE broker_connections SET crypto_version = 3 "
        "WHERE api_key_ciphertext LIKE 'v3:%' "
        "  AND secret_key_ciphertext LIKE 'v3:%'"
    )
    op.execute(
        "UPDATE broker_connections SET crypto_version = 2 "
        "WHERE crypto_version = 1 "
        "  AND api_key_ciphertext LIKE 'v2:%' "
        "  AND secret_key_ciphertext LIKE 'v2:%'"
    )


def downgrade() -> None:
    op.drop_column("broker_connections", "crypto_version")
