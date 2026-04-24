"""Entry point for ``python -m strategies.ts_momentum <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.ts_momentum.strategy import TSMomentumStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(TSMomentumStrategy))
