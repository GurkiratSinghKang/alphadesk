"""pytest configuration for alembic migration tests.

Boots a minimal sqlite DB and installs a fake ``op`` object that routes
``op.execute(sql)`` calls to the sqlite connection so the migrations
(which are otherwise tied to the live Postgres binding) can run against
the throw-away DB for semantics testing.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[4]
_BACKEND = _REPO_ROOT / "backend"

for p in (_REPO_ROOT, _BACKEND):
    p_str = str(p)
    if p_str not in sys.path:
        sys.path.insert(0, p_str)


def pytest_configure(config):
    os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    os.environ.setdefault("JWT_SECRET", "x" * 32)
    os.environ.setdefault("SKIP_DB_INIT", "true")
    config.option.asyncio_mode = "strict"
