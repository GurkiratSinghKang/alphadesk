"""pytest fixtures for backend.api.routes tests.

Sets up ``sys.path`` so both ``backend.api.routes.strategies`` (the full
dotted import) and the route's own shorter imports (``from core.config
import settings`` etc.) resolve without a running FastAPI app.
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
    # Mirrors the broker test conftest so the auth tests (which import
    # ``core.config.settings`` at module load) don't 500 on missing JWT
    # secret.
    os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
    os.environ.setdefault("JWT_SECRET", "x" * 32)
    os.environ.setdefault("SKIP_DB_INIT", "true")
    # strict mode matches the rest of the backend suite — asyncio tests must
    # carry an explicit @pytest.mark.asyncio.
    config.option.asyncio_mode = "strict"
