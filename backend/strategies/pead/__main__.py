"""Entry point for ``python -m strategies.pead <subcommand>``.

All subcommand logic lives in :mod:`strategies._core.cli` — this module is
a pure dispatch shim. Every strategy on the unified shell uses the same
pattern; see the sibling Phase-2 strategy __main__ modules for analogues.
"""

from strategies._core.cli import run_cli
from strategies.pead.strategy import PEADStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(PEADStrategy))
