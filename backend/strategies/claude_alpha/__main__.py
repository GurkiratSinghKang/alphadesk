"""Entry point for ``python -m strategies.claude_alpha <subcommand>``."""

from strategies._core.cli import run_cli
from strategies.claude_alpha.strategy import ClaudeAlphaStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(ClaudeAlphaStrategy))
