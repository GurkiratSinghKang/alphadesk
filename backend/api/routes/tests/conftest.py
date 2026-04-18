"""pytest fixtures for backend.api.routes tests.

Sets up ``sys.path`` so both ``backend.api.routes.strategies`` (the full
dotted import) and the route's own shorter imports (``from core.config
import settings`` etc.) resolve without a running FastAPI app.
"""

from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[4]
_BACKEND = _REPO_ROOT / "backend"

for p in (_REPO_ROOT, _BACKEND):
    p_str = str(p)
    if p_str not in sys.path:
        sys.path.insert(0, p_str)
