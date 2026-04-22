"""Git SHA, param hashing, deterministic seed helpers. Used by runners
to stamp reproducibility metadata on every result."""
from __future__ import annotations

import functools
import subprocess
from pathlib import Path


@functools.lru_cache(maxsize=1)
def get_git_sha() -> str:
    """Return the 40-char SHA of the current HEAD commit.

    Cached because the repo HEAD doesn't change during a single process
    lifetime for any reasonable workflow (backtest/tuner/CLI). Caller
    expectation: this value is paired with params+data hash to enable
    deterministic replay.
    """
    try:
        sha = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=_repo_root(),
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Non-git environments (e.g. Docker image without .git/) fall back
        # to a placeholder. The RUNNER_VERSION gives coarse reproducibility
        # still, and operators should treat "unknown" as a signal to check
        # their deployment setup.
        return "unknown"
    return sha


def _repo_root() -> Path:
    """Walk up from this file to find the repository root (directory containing .git/)."""
    p = Path(__file__).resolve()
    while p != p.parent:
        if (p / ".git").exists():
            return p
        p = p.parent
    # Fallback: assume the current working dir is the repo root
    return Path.cwd()
