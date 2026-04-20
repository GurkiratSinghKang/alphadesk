"""pytest configuration for storage / models tests."""
from __future__ import annotations

import os


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "integration: test hits a real DB or external API.",
    )
    # pytest-asyncio 1.x requires an explicit mode. ``strict`` keeps
    # parity with backend/data/ingestion/tests/conftest.py so test
    # discovery semantics are uniform across the backend suite.
    config.option.asyncio_mode = "strict"

    # The optimistic-locking test spins up an in-memory SQLite engine and
    # drives the real SQLAlchemy ORM (with ``version_id_col``) through a
    # concurrent-write scenario. Default the URL so importing
    # ``core.config.settings`` doesn't fail on a missing env var.
    os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    os.environ.setdefault("JWT_SECRET", "x" * 32)
