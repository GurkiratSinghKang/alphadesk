"""Test bootstrap for the ``dual_momentum`` package.

Pytest's conftest loader climbs every ``__init__.py`` when computing a
test module's import name. Because ``backend/`` has no ``__init__.py``,
pytest treats ``strategies`` as the root package and imports our conftest
as ``strategies.dual_momentum.tests.conftest``. That forces
initialisation of ``strategies`` (the legacy
``backend/strategies/__init__.py`` aggregator) which eagerly imports
every sibling strategy package. Several Wave A siblings are in-flight
and break the legacy init, which poisons our whole collection.

We cannot modify the legacy file (Wave A constraint). What we *can* do
is sniff whichever import path the strategy loaded under first —
``strategies.dual_momentum`` (from the legacy aggregator) or
``backend.strategies.dual_momentum`` (canonical) — and alias the same
module object under both names in ``sys.modules``. The decorator's
``existing is cls`` branch in :func:`register_strategy` then short-
circuits any duplicate registration that a second import would otherwise
trigger.

Phase 2 will delete the legacy ``backend/strategies/__init__.py`` body,
at which point this conftest becomes a no-op.
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

    # At this point pytest has either already imported ``strategies.*`` or
    # not. If it hasn't, kick off the canonical path ourselves — the
    # ``backend.strategies`` stub (or real package, if present) lets us do
    # it without re-triggering the legacy aggregator.
    if ("strategies.dual_momentum" not in sys.modules
            and "backend.strategies.dual_momentum" not in sys.modules):
        try:
            importlib.import_module("backend.strategies.dual_momentum")
        except Exception:
            # Fall back to the legacy path; one of them has to work or
            # pytest already exploded before reaching us.
            importlib.import_module("strategies.dual_momentum")

    for mod in (
        "dual_momentum",
        "dual_momentum.strategy",
        "dual_momentum.config",
        "dual_momentum.tests",
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
