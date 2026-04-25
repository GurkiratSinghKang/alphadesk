"""Round-6 / I-23: cross-strategy CLI conformance test.

Every strategy under ``backend/strategies/<name>/`` is required to ship
a ``__main__.py`` that delegates to :func:`strategies._core.cli.run_cli`,
giving operators a uniform ``python -m strategies.<name> <subcommand>``
interface. The most basic and load-bearing of the seven subcommands is
``schema params --pretty`` — it returns the params model's JSON schema
and is the path the frontend tuner / param-editor reads at boot.

This test invokes the CLI as a real subprocess (process boundary so a
broken `__main__.py` import is caught the way the operator would
encounter it) and asserts:

* exit code 0
* stdout is valid JSON
* the JSON parses as a Pydantic JSON schema (``"type"`` is set, or a
  ``$defs`` block is present for nested models)

Strategies registered with a hyphenated name (currently only
``earnings-options-play``) are addressable via the underscore form on
the filesystem; we map back to the package directory name before
spawning the subprocess.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from strategies.registry import list_strategies, load_all

# Trigger registration so the parametrize list reflects the real registry.
load_all()


_REPO_BACKEND = Path(__file__).resolve().parents[3]


def _package_dir_for(name: str) -> Path:
    """Map a registry name to the on-disk package directory."""
    # Hyphen→underscore for ``earnings-options-play`` etc.
    pkg = name.replace("-", "_")
    return _REPO_BACKEND / "strategies" / pkg


@pytest.mark.parametrize(
    "name",
    sorted(meta.name for meta in list_strategies()),
)
def test_strategy_cli_schema_params(name: str, tmp_path: Path) -> None:
    """``python -m strategies.<name> schema params --pretty`` exits 0
    and emits valid JSON-Schema-shaped JSON.

    Round-6 / I-23: the CLI is the contract the operator runs in a
    crash. A broken ``__main__.py`` import (typo in the strategy class
    name, missing ``run_cli`` import, etc.) only surfaces when the CLI
    fires — the in-process registration tests cannot catch it because
    they import the package directly.
    """
    pkg_dir = _package_dir_for(name)
    if not pkg_dir.exists():
        pytest.skip(f"{name}: package directory {pkg_dir} not found")
    if not (pkg_dir / "__main__.py").exists():
        pytest.skip(f"{name}: no __main__.py shipped")

    # Module path uses the on-disk package name (underscores) regardless
    # of registry name.
    module_path = f"strategies.{pkg_dir.name}"
    proc = subprocess.run(
        [sys.executable, "-m", module_path, "schema", "params", "--pretty"],
        cwd=str(_REPO_BACKEND),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 0, (
        f"{name}: CLI exit code = {proc.returncode}\n"
        f"stdout: {proc.stdout[:500]}\n"
        f"stderr: {proc.stderr[:500]}"
    )

    # stdout must be parseable JSON.
    try:
        schema = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        pytest.fail(
            f"{name}: schema params output is not valid JSON: {exc}\n"
            f"stdout: {proc.stdout[:500]}"
        )

    # Pydantic JSON-Schema contract: the top-level object always has
    # either ``type`` set or a ``$defs`` block (for models with nested
    # references). One of those must exist.
    assert isinstance(schema, dict), f"{name}: schema is not a JSON object"
    assert "type" in schema or "$defs" in schema or "properties" in schema, (
        f"{name}: schema lacks ``type`` / ``$defs`` / ``properties`` — "
        f"keys present: {list(schema.keys())}"
    )
