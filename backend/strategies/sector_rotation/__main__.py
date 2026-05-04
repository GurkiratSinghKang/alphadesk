"""Entry point for ``python -m strategies.sector_rotation <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.sector_rotation.strategy import SectorRotationStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(SectorRotationStrategy))
