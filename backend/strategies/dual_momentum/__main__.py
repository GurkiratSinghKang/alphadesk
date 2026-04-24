"""Entry point for ``python -m strategies.dual_momentum <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.dual_momentum.strategy import DualMomentumStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(DualMomentumStrategy))
