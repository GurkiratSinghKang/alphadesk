"""Entry point for ``python -m strategies.dividend_capture <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.dividend_capture.strategy import DividendCaptureStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(DividendCaptureStrategy))
