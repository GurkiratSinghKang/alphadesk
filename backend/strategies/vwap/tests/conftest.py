"""Test bootstrap for the ``vwap`` package.

Matches the pattern used by other Wave A/B/C strategy test suites: install
a lightweight ``backend`` / ``backend.strategies`` stub before pytest
collection so the legacy eager-import ``__init__.py`` is not executed.
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

    if "backend.strategies.vwap" not in sys.modules:
        importlib.import_module("backend.strategies.vwap")
    pkg = sys.modules["backend.strategies.vwap"]
    strat = importlib.import_module("backend.strategies.vwap.strategy")
    cfg = importlib.import_module("backend.strategies.vwap.config")

    if "strategies" not in sys.modules:
        leg = types.ModuleType("strategies")
        leg.__path__ = [str(_BACKEND / "strategies")]
        leg.__file__ = "(stub)"
        sys.modules["strategies"] = leg
    sys.modules.setdefault("strategies.vwap", pkg)
    sys.modules.setdefault("strategies.vwap.strategy", strat)
    sys.modules.setdefault("strategies.vwap.config", cfg)


_install_stub()
