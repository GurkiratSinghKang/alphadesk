"""Entry point for ``python -m strategies.vwap <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.vwap.strategy import VWAPStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(VWAPStrategy))
