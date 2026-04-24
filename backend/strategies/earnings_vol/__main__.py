"""Entry point for ``python -m strategies.earnings_vol <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.earnings_vol.strategy import EarningsVolStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(EarningsVolStrategy))
