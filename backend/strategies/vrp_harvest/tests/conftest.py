"""Test bootstrap for the ``vrp_harvest`` package.

Same shape as the other Wave packages — it installs a lightweight stub
for ``backend`` and ``backend.strategies`` so Python does *not* run the
legacy ``backend/strategies/__init__.py`` eager imports and we can
collect tests with pytest without the rest of the strategy packages
needing to be importable.
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

    if "backend.strategies.vrp_harvest" not in sys.modules:
        importlib.import_module("backend.strategies.vrp_harvest")


_install_stub()
