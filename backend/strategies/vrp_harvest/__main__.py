"""Entry point for ``python -m strategies.vrp_harvest <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.vrp_harvest.strategy import VRPHarvestStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(VRPHarvestStrategy))
