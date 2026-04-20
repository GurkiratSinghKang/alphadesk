"""pytest configuration for ingestion tests."""
from __future__ import annotations

import os


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "integration: test hits a real DB or external API.",
    )
    # pytest-asyncio 1.x requires an explicit mode. ``strict`` means we
    # must decorate coroutine tests with @pytest.mark.asyncio (which we
    # do in test_fill_reconciler.py); ``auto`` would pick them up by
    # naming convention. Go with ``strict`` so the existing sync tests
    # are not accidentally run as coroutines.
    config.option.asyncio_mode = "strict"

    # Ensure the fill_reconciler can import cleanly even when the
    # developer hasn't populated a .env — the tests patch around the
    # actual DB so these are just boot-time guardrails.
    os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    os.environ.setdefault("JWT_SECRET", "x" * 32)
