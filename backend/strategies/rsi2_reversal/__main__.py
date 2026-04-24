"""Entry point for ``python -m strategies.rsi2_reversal <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.rsi2_reversal.strategy import RSI2ReversalStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(RSI2ReversalStrategy))
