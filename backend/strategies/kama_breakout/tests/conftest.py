"""Test bootstrap for the ``kama_breakout`` package.

The legacy ``backend/strategies/__init__.py`` imports every sibling strategy
package eagerly. Several sibling packages are in-flight during Wave A and
break the legacy init; that in turn prevents any module under
``backend.strategies`` from being imported during test collection.

To keep our own tests runnable in isolation we:

1. Put ``/Users/GK/...`` (repo root) on ``sys.path``.
2. Install a *lightweight stub* for the ``backend`` and
   ``backend.strategies`` modules in ``sys.modules`` so Python does NOT run
   the legacy ``__init__.py``. The stubs expose ``__path__`` so normal
   submodule imports still work.
3. Pre-load ``backend.strategies.kama_breakout`` *and* alias it under the
   legacy ``strategies.kama_breakout`` name so that when pytest's default
   ``prepend`` import mode adds ``backend/`` to ``sys.path`` and imports
   this test module as ``strategies.kama_breakout.tests.test_strategy``
   the decorator sees the identical class object (``existing is cls``)
   and re-registers idempotently instead of raising.

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
    sp = str(_REPO_ROOT)
    if sp not in sys.path:
        sys.path.insert(0, sp)

    # ``backend`` namespace stub (no legacy __init__ to run).
    if "backend" not in sys.modules:
        b = types.ModuleType("backend")
        b.__path__ = [str(_BACKEND)]
        b.__file__ = "(stub)"
        sys.modules["backend"] = b

    # Bypass the broken legacy ``backend/strategies/__init__.py``.
    if (
        "backend.strategies" not in sys.modules
        or getattr(sys.modules["backend.strategies"], "__file__", None)
        != "(stub)"
    ):
        s = types.ModuleType("backend.strategies")
        s.__path__ = [str(_BACKEND / "strategies")]
        s.__file__ = "(stub)"
        sys.modules["backend.strategies"] = s

    # ------------------------------------------------------------------ #
    # Alias the ``kama_breakout`` modules under both ``backend.strategies.*``
    # and ``strategies.*`` names BEFORE any import re-loads them, so that
    # whichever name pytest decides to use at collection time picks up the
    # *same* module objects (and the same class) and the decorator's
    # ``existing is cls`` idempotent check succeeds.
    # ------------------------------------------------------------------ #
    if "strategies" not in sys.modules:
        leg = types.ModuleType("strategies")
        leg.__path__ = [str(_BACKEND / "strategies")]
        leg.__file__ = "(stub)"
        sys.modules["strategies"] = leg

    legacy_kb = sys.modules.get("strategies.kama_breakout")
    legacy_kb_strat = sys.modules.get("strategies.kama_breakout.strategy")
    if legacy_kb is not None:
        # Legacy pytest path already loaded it. Alias under backend.*.
        sys.modules.setdefault("backend.strategies.kama_breakout", legacy_kb)
        if legacy_kb_strat is not None:
            sys.modules.setdefault(
                "backend.strategies.kama_breakout.strategy",
                legacy_kb_strat,
            )
        return

    # Neither name loaded yet; load via backend.* and alias back.
    kb = importlib.import_module("backend.strategies.kama_breakout")
    kb_strat = importlib.import_module("backend.strategies.kama_breakout.strategy")
    kb_conf = importlib.import_module("backend.strategies.kama_breakout.config")
    kb_tests = importlib.import_module("backend.strategies.kama_breakout.tests")
    sys.modules.setdefault("strategies.kama_breakout", kb)
    sys.modules.setdefault("strategies.kama_breakout.strategy", kb_strat)
    sys.modules.setdefault("strategies.kama_breakout.config", kb_conf)
    sys.modules.setdefault("strategies.kama_breakout.tests", kb_tests)


_install_stub()
