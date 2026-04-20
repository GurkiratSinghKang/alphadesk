"""pytest fixtures for backend.api.websocket tests.

Mirrors the sibling ``backend.api.routes.tests.conftest`` so imports inside
``handler`` (``from core.redis import ...``, ``from core.config import
settings``) resolve when pytest is invoked either from the repo root or
from ``backend/``.
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
    # Minimal env so ``core.config.Settings`` boots without a real .env.
    os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    os.environ.setdefault("JWT_SECRET", "x" * 32)
    os.environ.setdefault("SKIP_DB_INIT", "true")
    config.option.asyncio_mode = "strict"
