"""Test bootstrap for the ``pairs_trading`` package.

Mirrors the conftest pattern used by other Phase 1 packages (rsi2_reversal,
kama_breakout, …). Legacy ``backend/strategies/__init__.py`` eagerly imports
every sibling strategy; installing a lightweight stub in ``sys.modules``
bypasses that path so tests run in isolation.
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

    if "backend.strategies.pairs_trading" not in sys.modules:
        importlib.import_module("backend.strategies.pairs_trading")
    pkg = sys.modules["backend.strategies.pairs_trading"]
    strat = importlib.import_module("backend.strategies.pairs_trading.strategy")
    cfg = importlib.import_module("backend.strategies.pairs_trading.config")
    tests_mod = importlib.import_module("backend.strategies.pairs_trading.tests")

    if "strategies" not in sys.modules:
        leg = types.ModuleType("strategies")
        leg.__path__ = [str(_BACKEND / "strategies")]
        leg.__file__ = "(stub)"
        sys.modules["strategies"] = leg
    sys.modules.setdefault("strategies.pairs_trading", pkg)
    sys.modules.setdefault("strategies.pairs_trading.strategy", strat)
    sys.modules.setdefault("strategies.pairs_trading.config", cfg)
    sys.modules.setdefault("strategies.pairs_trading.tests", tests_mod)


_install_stub()
