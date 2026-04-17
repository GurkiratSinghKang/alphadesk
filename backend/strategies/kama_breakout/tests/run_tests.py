"""Stand-alone pytest runner for the ``kama_breakout`` tests.

Use this when you need to run the suite in isolation from the other Wave A
strategy packages while the legacy ``backend/strategies/__init__.py``
sibling-import chain is still broken by work-in-progress packages.

Usage::

    .venv/bin/python backend/strategies/kama_breakout/tests/run_tests.py

It installs an in-memory stub for ``backend.strategies`` and aliases the
``kama_breakout`` modules under both the ``backend.strategies.*`` and
legacy ``strategies.*`` names so the registry decorator's idempotent
re-registration kicks in regardless of which module path pytest uses.

Phase 2 will delete the legacy ``backend/strategies/__init__.py`` body;
once that lands this runner script is no longer needed.
"""

from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[4]
_BACKEND = _REPO_ROOT / "backend"


def _install_stub() -> None:
    sp = str(_REPO_ROOT)
    if sp not in sys.path:
        sys.path.insert(0, sp)

    # ``backend`` namespace stub (we do NOT want the legacy init).
    b = types.ModuleType("backend")
    b.__path__ = [str(_BACKEND)]
    b.__file__ = "(stub)"
    sys.modules["backend"] = b

    # Skip the eager-import legacy ``backend/strategies/__init__.py``.
    s = types.ModuleType("backend.strategies")
    s.__path__ = [str(_BACKEND / "strategies")]
    s.__file__ = "(stub)"
    sys.modules["backend.strategies"] = s

    # Pre-load and dual-alias kama_breakout.
    kb = importlib.import_module("backend.strategies.kama_breakout")
    kb_strat = importlib.import_module("backend.strategies.kama_breakout.strategy")
    kb_conf = importlib.import_module("backend.strategies.kama_breakout.config")
    kb_tests = importlib.import_module("backend.strategies.kama_breakout.tests")

    leg = types.ModuleType("strategies")
    leg.__path__ = [str(_BACKEND / "strategies")]
    leg.__file__ = "(stub)"
    sys.modules["strategies"] = leg
    sys.modules["strategies.kama_breakout"] = kb
    sys.modules["strategies.kama_breakout.strategy"] = kb_strat
    sys.modules["strategies.kama_breakout.config"] = kb_conf
    sys.modules["strategies.kama_breakout.tests"] = kb_tests


if __name__ == "__main__":
    _install_stub()
    import pytest

    argv = sys.argv[1:]
    if not argv:
        argv = [str(Path(__file__).parent / "test_strategy.py"), "-v"]
    sys.exit(pytest.main(argv))
