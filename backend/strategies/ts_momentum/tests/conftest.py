"""Test bootstrap for the ``ts_momentum`` package.

Mirrors the sibling ``dual_momentum`` / ``rsi2_reversal`` conftests so
pytest can collect these tests whether the legacy aggregator at
``backend/strategies/__init__.py`` has been imported or not. Phase 2
deletes that aggregator and this conftest becomes a no-op.
"""

from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[4]
_BACKEND = _REPO_ROOT / "backend"


def _cross_alias(mod_base_name: str) -> None:
    """Mirror a submodule under both ``strategies.*`` and ``backend.strategies.*``."""

    full_legacy = f"strategies.{mod_base_name}"
    full_canon = f"backend.strategies.{mod_base_name}"
    legacy = sys.modules.get(full_legacy)
    canon = sys.modules.get(full_canon)
    if legacy is not None and canon is None:
        sys.modules[full_canon] = legacy
    elif canon is not None and legacy is None:
        sys.modules[full_legacy] = canon


def _install() -> None:
    sp = str(_REPO_ROOT)
    if sp not in sys.path:
        sys.path.insert(0, sp)

    if "backend" not in sys.modules:
        b = types.ModuleType("backend")
        b.__path__ = [str(_BACKEND)]
        b.__file__ = "(stub)"
        sys.modules["backend"] = b

    if ("strategies.ts_momentum" not in sys.modules
            and "backend.strategies.ts_momentum" not in sys.modules):
        try:
            importlib.import_module("backend.strategies.ts_momentum")
        except Exception:
            importlib.import_module("strategies.ts_momentum")

    for mod in (
        "ts_momentum",
        "ts_momentum.strategy",
        "ts_momentum.config",
        "ts_momentum.tests",
        "base",
        "registry",
        "signal",
    ):
        _cross_alias(mod)

    if "backend.strategies" in sys.modules:
        b = sys.modules.get("backend")
        if b is not None:
            b.strategies = sys.modules["backend.strategies"]


_install()
