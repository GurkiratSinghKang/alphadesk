"""Entry point for ``python -m strategies.regime_adaptive <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.regime_adaptive.strategy import RegimeAdaptiveStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(RegimeAdaptiveStrategy))
