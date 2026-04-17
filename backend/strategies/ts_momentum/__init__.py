"""Time-Series Momentum (TSMOM) — Moskowitz-Ooi-Pedersen 2012.

Importing this package fires the ``@register_strategy`` decorator on
:class:`TSMomentumStrategy`, registering it under ``"ts_momentum"`` in
the strategy registry.

Pre-loads ``backend.strategies.base``/``registry``/``signal`` directly
from file so the sibling ``backend/strategies/__init__.py`` aggregator
does not re-trigger during import. Phase 2 deletes the aggregator and
this shim becomes a no-op — the sibling ``dual_momentum`` and
``rsi2_reversal`` packages do the same dance.
"""

import importlib.util as _util
import os as _os
import sys as _sys


def _preload_foundation() -> None:
    """Force-load ``backend.strategies.{base, registry, signal}`` directly."""

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

from .strategy import TSMomentumStrategy  # noqa: E402

# Legacy alias for backward-compat with the pre-Phase-2 registry dict.
TSMomentumMultiAsset = TSMomentumStrategy

__all__ = ["TSMomentumStrategy", "TSMomentumMultiAsset"]
