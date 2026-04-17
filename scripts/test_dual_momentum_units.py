#!/usr/bin/env python
"""Run the Dual Momentum unit tests without pytest.

Pytest's conftest discovery currently blows up in this repo because the
legacy ``backend/strategies/__init__.py`` eager-imports Wave A siblings
that are still in-flight. Until Phase 2 deletes that legacy aggregator,
this script is the canonical way to verify the dual_momentum tests pass.

Discovers every ``Test*`` class in
``backend.strategies.dual_momentum.tests.test_strategy``, instantiates
it, and invokes each ``test_*`` method. Prints one line per method and
returns a non-zero exit code if any failed.

Run from the repo root:

    PYTHONPATH=. .venv/bin/python scripts/test_dual_momentum_units.py
"""

from __future__ import annotations

import inspect
import sys
import traceback
import types
from pathlib import Path


def _install_stubs() -> None:
    """Sidestep the broken legacy ``backend.strategies`` aggregator."""

    repo_root = Path(__file__).resolve().parents[1]
    backend = repo_root / "backend"
    sp = str(repo_root)
    if sp not in sys.path:
        sys.path.insert(0, sp)
    if "backend" not in sys.modules:
        b = types.ModuleType("backend")
        b.__path__ = [str(backend)]
        b.__file__ = "(stub)"
        sys.modules["backend"] = b
    if "backend.strategies" not in sys.modules:
        s = types.ModuleType("backend.strategies")
        s.__path__ = [str(backend / "strategies")]
        s.__file__ = "(stub)"
        sys.modules["backend.strategies"] = s
        sys.modules["backend"].strategies = s


_install_stubs()


def main() -> int:
    from backend.strategies.dual_momentum.tests import test_strategy as T

    print("Dual Momentum (GEM) unit tests")
    print("=" * 60)

    passed = 0
    failed: list[tuple[str, str, BaseException]] = []
    for cls_name, cls in inspect.getmembers(T, inspect.isclass):
        if not cls_name.startswith("Test"):
            continue
        for method_name in sorted(dir(cls)):
            if not method_name.startswith("test_"):
                continue
            instance = cls()
            bound = getattr(instance, method_name)
            try:
                bound()
                passed += 1
                print(f"  PASS  {cls_name}::{method_name}")
            except BaseException as e:
                failed.append((cls_name, method_name, e))
                print(f"  FAIL  {cls_name}::{method_name}: {type(e).__name__}: {e}")

    print("-" * 60)
    if failed:
        print(f"{passed} passed, {len(failed)} FAILED")
        for cls_name, method_name, e in failed:
            print(f"\n--- {cls_name}::{method_name} ---")
            try:
                raise e
            except BaseException:
                traceback.print_exc()
        return 1
    print(f"ALL {passed} tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
