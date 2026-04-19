"""Alembic environment for AlphaDesk.

This file is the seam between Alembic's migration machinery and AlphaDesk's
SQLAlchemy models.  A few notes on how it works:

* The DATABASE_URL is NOT read from ``alembic.ini`` -- that file contains a
  placeholder ``driver://user:pass@...`` on purpose, so secrets never live in
  version control.  We override the URL at runtime from ``core.config``
  (which in turn reads env vars / .env).
* ``target_metadata`` points at the declarative ``Base.metadata`` used by the
  ORM models so ``alembic revision --autogenerate`` can diff the live schema
  against the model declarations.
* The async DATABASE_URL (``postgresql+asyncpg://...``) is converted to its
  sync equivalent (``postgresql://...``) for Alembic -- Alembic's default
  migration runner is synchronous and asyncpg would break ``op.execute``.
  ``settings.sync_database_url`` already does this conversion for us.
"""
from __future__ import annotations

import logging
import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# ---------------------------------------------------------------------------
# Ensure the backend/ directory is on sys.path so that ``from core.config
# import settings`` and ``from data.storage.models import ...`` resolve the
# same way they do when the app runs under gunicorn / uvicorn.
# ---------------------------------------------------------------------------
_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from core.config import settings  # noqa: E402  (import after sys.path edit)
from core.database import get_base  # noqa: E402

# Force the model definitions to register on Base.metadata.  The models are
# defined lazily inside ``_define_models`` so that importing
# ``data.storage.models`` at module top-level does not trigger sqlalchemy
# unexpectedly.  We explicitly trigger it here.
from data.storage import models as _storage_models  # noqa: E402

_storage_models._define_models()
target_metadata = get_base().metadata

# Alembic Config object, which provides access to values within the .ini file.
config = context.config

# Override the sqlalchemy.url from alembic.ini with the runtime DATABASE_URL.
# We use the sync URL (postgresql://... rather than postgresql+asyncpg://...)
# because Alembic's standard runner is synchronous.
config.set_main_option("sqlalchemy.url", settings.sync_database_url)

# Interpret the config file for Python logging, unless the caller asked us
# not to (``alembic --quiet`` style invocations skip this).
if config.config_file_name is not None:
    try:
        fileConfig(config.config_file_name)
    except Exception:
        # Non-fatal: don't break migrations because of a logging config quirk.
        logging.basicConfig(level=logging.INFO)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emits SQL to stdout, no DB connection).

    Useful for generating a raw SQL file that a DBA can review before apply.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode against a real database connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
