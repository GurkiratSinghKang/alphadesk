"""Legacy compatibility dispatcher. Forwards ``--strategy=NAME`` to
``python -m strategies.NAME`` so existing shell scripts keep working.

New code should invoke per-strategy CLIs directly::

    python -m strategies.pead backtest --from ... --to ...

This module used to host the monolithic ``BacktestEngine``-driven CLI. That
engine (``backend/backtest/engine_legacy.py``) was retired in Task 19 of the
Strategy SOTA Foundation plan; each strategy now owns its own ``__main__``
module and drives the shared :class:`strategies._core.runners.BacktestRunner`
directly. This file survives only to keep the ``python -m backend.backtest
--strategy=X ...`` invocation working during the transition.
"""
from __future__ import annotations

import argparse
import importlib
import sys


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m backend.backtest",
        description="Legacy compat dispatcher — forwards to strategies.<name>.",
    )
    parser.add_argument("--strategy", required=True)
    args, remaining = parser.parse_known_args()

    # Each migrated strategy ships its own ``__main__.py`` wired to the
    # shared CLI helper in ``strategies._core.cli``. Importing the
    # ``__main__`` module triggers strategy registration as a side effect;
    # we then resolve ``run_cli`` + the concrete strategy class and invoke
    # the ``backtest`` subcommand with the forwarded args.
    try:
        main_module = importlib.import_module(
            f"strategies.{args.strategy}.__main__"
        )
    except ModuleNotFoundError as exc:
        print(
            f"error: strategy {args.strategy!r} has no __main__ module — "
            f"has it been migrated onto the new shell? ({exc})",
            file=sys.stderr,
        )
        return 2

    run_cli = getattr(main_module, "run_cli", None)
    strategy_cls_name = None
    strategy_cls = None
    # Each strategy's __main__ imports exactly one Strategy subclass from
    # its sibling ``strategy`` module. Find it by scanning the module
    # namespace for the first class with a ``META`` attribute matching the
    # CLI-requested name.
    for attr in vars(main_module).values():
        meta = getattr(attr, "META", None)
        if meta is not None and getattr(meta, "name", None) == args.strategy:
            strategy_cls = attr
            strategy_cls_name = attr.__name__
            break
    if strategy_cls is None or run_cli is None:
        print(
            f"error: could not resolve run_cli + strategy class from "
            f"strategies.{args.strategy}.__main__. This dispatcher expects "
            "each strategy's __main__ to import its class + run_cli.",
            file=sys.stderr,
        )
        return 2

    sys.argv = [f"strategies.{args.strategy}", "backtest", *remaining]
    return run_cli(strategy_cls)


if __name__ == "__main__":
    raise SystemExit(main())
