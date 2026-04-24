"""Entry point for ``python -m strategies.kama_breakout <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.kama_breakout.strategy import KamaBreakoutStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(KamaBreakoutStrategy))
