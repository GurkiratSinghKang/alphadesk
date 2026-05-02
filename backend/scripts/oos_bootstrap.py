"""Compatibility shim for ``scripts.oos_bootstrap`` during backend pytest.

Some backend tests put ``backend/`` on ``sys.path`` first, where
``backend/scripts`` is also importable as the top-level ``scripts`` package.
Load the repo-root implementation so both import layouts use one source.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_IMPL = Path(__file__).resolve().parents[2] / "scripts" / "oos_bootstrap.py"
_SPEC = importlib.util.spec_from_file_location("_alphadesk_oos_bootstrap", _IMPL)
if _SPEC is None or _SPEC.loader is None:  # pragma: no cover
    raise ImportError(f"cannot load {_IMPL}")
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)

for _name in getattr(_MOD, "__all__", ()):
    globals()[_name] = getattr(_MOD, _name)

__all__ = list(getattr(_MOD, "__all__", ()))
