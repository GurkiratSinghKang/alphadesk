"""Entry point for ``python -m strategies.momentum_quality <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.momentum_quality.strategy import MomentumQualityStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(MomentumQualityStrategy))
