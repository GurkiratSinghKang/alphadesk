"""Reproducibility helpers — git SHA, param hashing, RUNNER_VERSION wiring.

Every BacktestResult carries ReproMeta stamped from these helpers. A bug
here silently breaks replay for every strategy; these tests lock in the
invariants."""
from __future__ import annotations

import subprocess
from pathlib import Path

from strategies._core.reproducibility import get_git_sha


def test_get_git_sha_returns_head_commit():
    """Returns 40-char SHA of the current HEAD commit, matching git rev-parse."""
    expected = subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=Path(__file__).parents[3],
    ).decode().strip()
    assert get_git_sha() == expected


def test_get_git_sha_idempotent():
    """Calling twice yields the same result (tests any caching doesn't misbehave)."""
    assert get_git_sha() == get_git_sha()
