"""Entry point for ``python -m strategies.mean_reversion <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.mean_reversion.strategy import MeanReversionStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(MeanReversionStrategy))
