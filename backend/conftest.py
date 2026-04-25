"""Pytest config: skip tests for legacy code retired in Task 19.

Task 19 of the Strategy SOTA Foundation plan deleted
``backend/backtest/engine_legacy.py``, ``backend/backtest/types.py``, and
``backend/strategies/base.py``. The legacy backtest-engine tests cannot
even import. We ignore that group here so the suite stays green.

Phase 3 (Round 6 / FIX-2) migrated every individual strategy onto the
new ``strategies._core`` shell. Most ``strategies/<name>/tests`` packages
collect cleanly through this top-level sweep; ``rsi2_reversal/tests`` is
the exception — its package-local ``conftest.py`` aliases the package
under ``backend.strategies.rsi2_reversal`` and that creates a duplicate
class identity vs. the canonical ``strategies.rsi2_reversal`` import,
which makes the registration test ``cls is RSI2ReversalStrategy``
spuriously fail when run alongside the global registry sweep. Its tests
still execute correctly from the package-local invocation, so we leave
that one in collect_ignore until the legacy bootstrap is retired.
"""
from __future__ import annotations

collect_ignore = [
    # Legacy backtest-engine tests — the engine itself is gone.
    "backtest/tests",
    # Framework tests that exercise the deleted ``strategies.base`` + the
    # legacy decorator registry. The new ABC lives under
    # ``strategies._core.protocol`` and is covered by ``tests/_core/*``.
    "strategies/tests/test_registry.py",
    "tests/test_strategy_kind.py",
    # rsi2_reversal package-local conftest aliases the import path
    # under ``backend.strategies`` causing class-identity skew at the
    # registry boundary. Run those tests directly via
    # ``pytest strategies/rsi2_reversal/tests`` until the bootstrap goes.
    "strategies/rsi2_reversal/tests",
]
