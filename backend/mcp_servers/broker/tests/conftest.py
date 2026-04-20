"""pytest configuration for broker MCP tests.

Mirrors the sys.path bootstrap other backend test suites use so ``from
core.*`` and ``from mcp_servers.*`` imports resolve without a running
FastAPI app.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[3]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))


def pytest_configure(config):
    # Minimal env so ``core.config.Settings`` boots without a real .env.
    os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    os.environ.setdefault("JWT_SECRET", "x" * 32)
    os.environ.setdefault("SKIP_DB_INIT", "true")
    config.option.asyncio_mode = "strict"
