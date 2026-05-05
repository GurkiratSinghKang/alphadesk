"""Bulk re-encrypt broker_connections rows under the v3 KDF.

Audit fix-D (2026-05-05): the broker-credential ciphertext format was
upgraded from v1 (single sha256) → v2 (PBKDF2 200k iters, per-row salt)
→ v3 (scrypt N=2^14, r=8, p=1, per-row salt). ``encrypt_secret`` writes
v3 going forward, but pre-existing v1/v2 rows persist on disk until
their next interactive update. This script lifts every row that is not
already at the target version by:

  1. Reading the row's ``api_key_ciphertext`` and ``secret_key_ciphertext``
  2. Decrypting under the ciphertext's embedded version (v1/v2/v3)
  3. Re-encrypting under v3 (``encrypt_secret``)
  4. Writing back + setting ``crypto_version = 3``

Idempotent: rows already at ``crypto_version >= 3`` are skipped.

Usage:

    # Dry run (default — counts work, performs no writes)
    python -m scripts.migrate_broker_credential_encryption --dry-run

    # Live execution
    python -m scripts.migrate_broker_credential_encryption --live

Run inside the backend container or with ``backend/`` on PYTHONPATH so
``core.config`` and ``data.storage.models`` resolve.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from typing import Any

logger = logging.getLogger("migrate_broker_credential_encryption")


async def _run(*, dry_run: bool) -> dict[str, int]:
    """Walk ``broker_connections`` and re-encrypt v1/v2 rows as v3.

    Returns a counts dict so callers (and tests) can assert progress.
    """
    # Imports here so ``--help`` works without a configured DB.
    from sqlalchemy import select

    from core.crypto import (
        CURRENT_CRYPTO_VERSION,
        crypto_version_of,
        decrypt_secret,
        encrypt_secret,
    )
    from core.database import _get_session_factory
    from data.storage.models import BrokerConnection

    counts: dict[str, int] = {
        "total": 0,
        "skipped_current": 0,
        "migrated": 0,
        "failed": 0,
    }

    factory = _get_session_factory()
    async with factory() as db:
        rows = (await db.execute(select(BrokerConnection))).scalars().all()
        counts["total"] = len(rows)

        for row in rows:
            row_version = max(
                int(getattr(row, "crypto_version", 1) or 1),
                crypto_version_of(row.api_key_ciphertext),
                crypto_version_of(row.secret_key_ciphertext),
            )
            if row_version >= CURRENT_CRYPTO_VERSION:
                counts["skipped_current"] += 1
                continue

            try:
                api_plain = decrypt_secret(row.api_key_ciphertext)
                secret_plain = decrypt_secret(row.secret_key_ciphertext)
            except Exception as exc:  # noqa: BLE001  — log + count, don't abort
                logger.error(
                    "decrypt failed id=%s username=%s provider=%s account_env=%s: %s",
                    row.id,
                    row.username,
                    row.provider,
                    row.account_env,
                    exc,
                )
                counts["failed"] += 1
                continue

            if dry_run:
                counts["migrated"] += 1
                logger.info(
                    "[dry-run] would re-encrypt id=%s username=%s provider=%s "
                    "account_env=%s from v%d → v%d",
                    row.id,
                    row.username,
                    row.provider,
                    row.account_env,
                    row_version,
                    CURRENT_CRYPTO_VERSION,
                )
                continue

            try:
                row.api_key_ciphertext = encrypt_secret(api_plain)
                row.secret_key_ciphertext = encrypt_secret(secret_plain)
                row.crypto_version = CURRENT_CRYPTO_VERSION
                await db.commit()
                counts["migrated"] += 1
                logger.info(
                    "re-encrypted id=%s username=%s provider=%s account_env=%s",
                    row.id,
                    row.username,
                    row.provider,
                    row.account_env,
                )
            except Exception as exc:  # noqa: BLE001
                await db.rollback()
                logger.error(
                    "re-encrypt failed id=%s username=%s provider=%s account_env=%s: %s",
                    row.id,
                    row.username,
                    row.provider,
                    row.account_env,
                    exc,
                )
                counts["failed"] += 1

    return counts


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="migrate_broker_credential_encryption",
        description=__doc__,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        help="Plan-only. Decrypts + counts but never writes (default).",
    )
    mode.add_argument(
        "--live",
        dest="dry_run",
        action="store_false",
        help="Execute writes against the live DB.",
    )
    parser.set_defaults(dry_run=True)
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
    )
    counts: dict[str, int] = asyncio.run(_run(dry_run=args.dry_run))
    logger.info(
        "summary mode=%s total=%d migrated=%d skipped_current=%d failed=%d",
        "dry-run" if args.dry_run else "live",
        counts["total"],
        counts["migrated"],
        counts["skipped_current"],
        counts["failed"],
    )
    # Non-zero exit on any failure so CI/operators notice.
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
