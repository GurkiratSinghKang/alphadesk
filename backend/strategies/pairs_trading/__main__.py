"""Entry point for ``python -m strategies.pairs_trading <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.pairs_trading.strategy import PairsTradingStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(PairsTradingStrategy))
