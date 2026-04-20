"""pytest fixtures for backend.agents tests.

Mirrors the pattern in ``backend/api/routes/tests/conftest.py`` — makes
the repo root and ``backend/`` resolvable so ``core.config`` imports
cleanly during test collection and provides the minimal env so
``Settings`` constructs without a real ``.env``.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
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
