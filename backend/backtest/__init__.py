"""AlphaDesk backtest package — legacy.

The legacy bar-by-bar backtester (``backend.backtest.engine_legacy``) was
retired in Task 19 of the Strategy SOTA Foundation plan. The new shell
lives under :mod:`strategies._core.runners`; each strategy owns its own
``__main__`` CLI.

This package now exists only to support two legacy entry points:

* ``python -m backend.backtest --strategy=NAME ...`` — dispatches to the
  per-strategy ``__main__`` module (see :mod:`backend.backtest.cli`).
* ``backtest.walkforward`` / ``backtest.portfolio`` / ``backtest.execution``
  / ``backtest.costs`` / ``backtest.report`` / ``backtest.metrics`` —
  retained so existing in-package tests can still import them. They are
  **not** part of the post-Task-19 public surface; new code must use the
  ``strategies._core`` shell instead.
"""
