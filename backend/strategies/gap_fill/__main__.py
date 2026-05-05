"""Entry point for ``python -m strategies.gap_fill <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.gap_fill.strategy import GapFillStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(GapFillStrategy))
