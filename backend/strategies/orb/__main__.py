"""Entry point for ``python -m strategies.orb <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.orb.strategy import ORBStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(ORBStrategy))
