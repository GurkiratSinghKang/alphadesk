"""pytest configuration for backend/tests/.

Adds the repo root and backend/ directory to sys.path so that
``import strategies`` resolves without a package prefix. Also provides
the ``authed_client`` fixture used by route-level tests — see
simplify-review for the dedup rationale (three files used to build
`_fake_user` + `app.dependency_overrides[require_auth]` + `TestClient`
themselves at import time).
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_BACKEND = _REPO_ROOT / "backend"

for p in (_REPO_ROOT, _BACKEND):
    p_str = str(p)
    if p_str not in sys.path:
        sys.path.insert(0, p_str)


# ───────────────────── Shared route-test fixtures ─────────────────────
# Imported lazily so the sys.path additions above run first.

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


async def _fake_user() -> str:
    """Stable user-id stand-in for ``require_auth``."""
    return "test_user"


@pytest.fixture(scope="session", autouse=True)
def _auth_override():
    """Install the fake-auth override for every test, clean up on exit."""
    from main import app  # deferred import — avoid side effects at collect time
    from core.auth import require_auth

    app.dependency_overrides[require_auth] = _fake_user
    try:
        yield
    finally:
        app.dependency_overrides.pop(require_auth, None)


@pytest.fixture
def authed_client() -> TestClient:
    """``TestClient(app)`` with auth pre-stubbed via the session override.

    Prefer this fixture over constructing ``client = TestClient(app)`` at
    module scope — that pattern installs the override at import time as
    a side effect, and three route-test files used to all do it.
    """
    from main import app  # deferred — see _auth_override

    return TestClient(app)
