"""Global Equities Momentum (GEM) — Antonacci's Dual Momentum.

Importing this module fires the ``@register_strategy`` decorator on
:class:`DualMomentumStrategy`, registering it under ``"dual_momentum"``
in the strategy registry.

Uses a relative import so the package can be loaded either as
``backend.strategies.dual_momentum`` (the canonical path used by the
registry's ``load_all()``) or as ``strategies.dual_momentum`` (the legacy
alias from ``backend/strategies/__init__.py``) without a circular import.

Pre-loads ``backend.strategies.base`` and ``backend.strategies.registry``
into ``sys.modules`` so ``strategy.py``'s absolute imports don't
re-trigger the legacy ``backend/strategies/__init__.py`` on the way down
the import stack. (This is the same fix the sibling ``rsi2_reversal``
package applies — both will become no-ops once Phase 2 deletes the
legacy aggregator.)
"""

import importlib.util as _util
import os as _os
import sys as _sys


def _preload_foundation() -> None:
    """Force-load ``backend.strategies.{base, registry, signal}`` directly.

    When this package is loaded via the legacy ``strategies.dual_momentum``
    alias (from ``backend/strategies/__init__.py``), the root
    ``backend.strategies`` module is mid-init. Resolving any
    ``backend.strategies.*`` submodule by name would re-enter the legacy
    init and circular-fault. We work around this by loading each
    foundation submodule directly from its file, bypassing the parent
    package's ``__init__.py``.
    """

    pkg_dir = _os.path.dirname(_os.path.dirname(__file__))
    for _submod in ("base", "registry", "signal"):
        full = f"backend.strategies.{_submod}"
        if full in _sys.modules:
            continue
        spec = _util.spec_from_file_location(
            full, _os.path.join(pkg_dir, f"{_submod}.py")
        )
        if spec is None or spec.loader is None:
            continue
        mod = _util.module_from_spec(spec)
        _sys.modules[full] = mod
        try:
            spec.loader.exec_module(mod)
        except Exception:
            _sys.modules.pop(full, None)
            raise


_preload_foundation()

from .strategy import DualMomentumStrategy, DualMomentumGEM  # noqa: E402

__all__ = ["DualMomentumStrategy", "DualMomentumGEM"]
