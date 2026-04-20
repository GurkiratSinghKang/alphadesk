"""pytest fixtures for backend.core tests.

Mirrors backend.api.routes.tests.conftest so the bare ``from core.config
import settings`` imports inside ``trading_gate`` resolve when pytest is
invoked from the backend directory.
"""

from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_BACKEND = _REPO_ROOT / "backend"

for p in (_REPO_ROOT, _BACKEND):
    p_str = str(p)
    if p_str not in sys.path:
        sys.path.insert(0, p_str)
