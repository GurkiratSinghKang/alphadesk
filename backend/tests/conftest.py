"""pytest configuration for backend/tests/.

Adds the repo root and backend/ directory to sys.path so that
``import strategies`` resolves without a package prefix. Also provides
the ``authed_client`` fixture used by route-level tests — see
simplify-review for the dedup rationale (three files used to build
`_fake_user` + `app.dependency_overrides[require_auth]` + `TestClient`
themselves at import time).
"""
from __future__ import annotations

import importlib
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


# ───────────────────── Earnings cache isolation ─────────────────────
# Round-4 CLUSTER 5 added a 5-min Redis cache for ``_fmp_upcoming``
# results. In CI Redis is shared across the whole pytest run; the cache
# itself is bypassed in tests via ``settings.SKIP_EARNINGS_FMP_CACHE``
# (Round-5 Cluster E E-6 — replaces the older PYTEST_CURRENT_TEST env
# heuristic). This fixture additionally clears the per-window
# ``asyncio.Lock`` dict so locks created against a prior test's event
# loop don't raise ``RuntimeError: <Lock... is bound to a different
# loop>`` in async tests later in the run.

@pytest.fixture(autouse=True)
def _clear_earnings_locks():
    yield
    try:
        from services import earnings_screener as svc  # type: ignore[import-not-found]
        svc._FMP_UPCOMING_LOCKS.clear()
    except Exception:  # pragma: no cover — defensive
        pass


# Round-5 Cluster E E-6: flip the FMP-cache-bypass flag for the whole
# pytest session so concurrent tests don't share stale FMP responses.
# Settings-driven instead of the previous env-var heuristic; the env
# could leak cache-skip behaviour into prod via a sourced .env.
@pytest.fixture(autouse=True, scope="session")
def _disable_earnings_cache_in_tests():
    from core.config import settings

    original = settings.SKIP_EARNINGS_FMP_CACHE
    settings.SKIP_EARNINGS_FMP_CACHE = True
    yield
    settings.SKIP_EARNINGS_FMP_CACHE = original


# Round-5 Cluster D H-13: best-effort reset of known module-level state
# between tests. Anyone introducing new module-level dicts/lists MUST
# add the dotted path here — anything that survives across tests can
# leak shared state between concurrent fixtures and produce flaky
# failures that appear only under specific test ordering.
_MODULE_STATE_REGISTRY = [
    "services.earnings_screener._inflight_structured",
    # Add new module-level state paths here.
]


@pytest.fixture(autouse=True)
def _clear_module_state():
    yield
    for path in _MODULE_STATE_REGISTRY:
        try:
            mod_path, attr = path.rsplit(".", 1)
            mod = importlib.import_module(mod_path)
            obj = getattr(mod, attr, None)
            if hasattr(obj, "clear"):
                obj.clear()
        except Exception:
            pass
