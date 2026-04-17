"""Test bootstrap for the pead package.

Same approach as the sibling rsi2_reversal / momentum_quality / dual_momentum
test packages: alias the strategy module under both
``strategies.pead`` and ``backend.strategies.pead`` so pytest's conftest
loader doesn't trigger a duplicate registration.
"""

from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[4]
_BACKEND = _REPO_ROOT / "backend"


def _cross_alias(mod_base_name: str) -> None:
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

    if ("strategies.pead" not in sys.modules
            and "backend.strategies.pead" not in sys.modules):
        try:
            importlib.import_module("backend.strategies.pead")
        except Exception:
            importlib.import_module("strategies.pead")

    for mod in (
        "pead",
        "pead.strategy",
        "pead.config",
        "pead.helpers",
        "pead.tests",
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
