"""Entry point for ``python -m strategies.earnings_options_play <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.earnings_options_play.strategy import EarningsOptionsPlay


if __name__ == "__main__":
    raise SystemExit(run_cli(EarningsOptionsPlay))
