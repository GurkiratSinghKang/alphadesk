"""Test bootstrap for the ``earnings_vol`` package.

Mirrors the conftest in other Phase 1 strategy packages: installs
lightweight stubs for ``backend`` and ``backend.strategies`` so the legacy
``__init__.py`` does not eagerly import sibling strategies, and pre-imports
this package under both ``backend.strategies.earnings_vol`` and the legacy
``strategies.earnings_vol`` alias so the registry decorator's idempotent
re-registration fires.
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

    if "backend" not in sys.modules:
        b = types.ModuleType("backend")
        b.__path__ = [str(_BACKEND)]
        b.__file__ = "(stub)"
        sys.modules["backend"] = b

    if "backend.strategies" not in sys.modules or getattr(
        sys.modules["backend.strategies"], "__file__", None
    ) != "(stub)":
        s = types.ModuleType("backend.strategies")
        s.__path__ = [str(_BACKEND / "strategies")]
        s.__file__ = "(stub)"
        sys.modules["backend.strategies"] = s

    if "backend.strategies.earnings_vol" not in sys.modules:
        importlib.import_module("backend.strategies.earnings_vol")
    pkg = sys.modules["backend.strategies.earnings_vol"]
    strat = importlib.import_module("backend.strategies.earnings_vol.strategy")
    cfg = importlib.import_module("backend.strategies.earnings_vol.config")

    if "strategies" not in sys.modules:
        leg = types.ModuleType("strategies")
        leg.__path__ = [str(_BACKEND / "strategies")]
        leg.__file__ = "(stub)"
        sys.modules["strategies"] = leg
    sys.modules.setdefault("strategies.earnings_vol", pkg)
    sys.modules.setdefault("strategies.earnings_vol.strategy", strat)
    sys.modules.setdefault("strategies.earnings_vol.config", cfg)


_install_stub()
