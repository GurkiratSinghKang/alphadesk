"""Test bootstrap for the ``rsi2_reversal`` package.

The legacy ``backend/strategies/__init__.py`` imports every sibling strategy
package eagerly. Several sibling packages are in-flight during Wave A and
break the legacy init; that in turn prevents any module under
``backend.strategies`` from being imported during test collection.

To keep our own tests runnable in isolation we:

1. Put the repo root on ``sys.path``.
2. Install a *lightweight stub* for the ``backend`` and
   ``backend.strategies`` modules in ``sys.modules`` so Python does NOT run
   the legacy ``__init__.py``. The stubs expose ``__path__`` so normal
   submodule imports still work.
3. Pre-load ``backend.strategies.rsi2_reversal`` and alias it under the
   legacy ``strategies.rsi2_reversal`` name so that if pytest re-imports
   this test module via its legacy-rooted path, Python picks up the *same*
   module object and the decorator's idempotent re-registration kicks in
   (``existing is cls`` branch in
   :func:`backend.strategies.registry.register_strategy`).

This is a *test-time* workaround. Phase 2 will delete the legacy body of
``backend/strategies/__init__.py`` at which point this bootstrap becomes a
no-op. We keep it local to this package so we don't destabilise shared
fixtures while other Wave A agents' packages are still being debugged.
"""

from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[4]
_BACKEND = _REPO_ROOT / "backend"


def _install_stub() -> None:
    # sys.path
    sp = str(_REPO_ROOT)
    if sp not in sys.path:
        sys.path.insert(0, sp)

    # backend (empty namespace package).
    if "backend" not in sys.modules:
        b = types.ModuleType("backend")
        b.__path__ = [str(_BACKEND)]
        b.__file__ = "(stub)"
        sys.modules["backend"] = b

    # backend.strategies stub — bypass the broken eager-import __init__.py.
    if "backend.strategies" not in sys.modules or getattr(
        sys.modules["backend.strategies"], "__file__", None
    ) != "(stub)":
        s = types.ModuleType("backend.strategies")
        s.__path__ = [str(_BACKEND / "strategies")]
        s.__file__ = "(stub)"
        sys.modules["backend.strategies"] = s

    # Pre-import rsi2_reversal and alias it under the legacy name
    # ``strategies.rsi2_reversal`` so that if pytest re-imports the test
    # file via its legacy-rooted path, Python picks up the *same* module
    # object and the decorator's idempotent re-registration kicks in.
    if "backend.strategies.rsi2_reversal" not in sys.modules:
        importlib.import_module("backend.strategies.rsi2_reversal")
    pkg = sys.modules["backend.strategies.rsi2_reversal"]
    strat = importlib.import_module("backend.strategies.rsi2_reversal.strategy")
    cfg = importlib.import_module("backend.strategies.rsi2_reversal.config")
    tests_mod = importlib.import_module("backend.strategies.rsi2_reversal.tests")

    if "strategies" not in sys.modules:
        leg = types.ModuleType("strategies")
        leg.__path__ = [str(_BACKEND / "strategies")]
        leg.__file__ = "(stub)"
        sys.modules["strategies"] = leg
    sys.modules.setdefault("strategies.rsi2_reversal", pkg)
    sys.modules.setdefault("strategies.rsi2_reversal.strategy", strat)
    sys.modules.setdefault("strategies.rsi2_reversal.config", cfg)
    sys.modules.setdefault("strategies.rsi2_reversal.tests", tests_mod)


_install_stub()
