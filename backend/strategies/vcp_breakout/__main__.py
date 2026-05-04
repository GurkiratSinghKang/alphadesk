"""Entry point for ``python -m strategies.vcp_breakout <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.vcp_breakout.strategy import VCPBreakoutStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(VCPBreakoutStrategy))
