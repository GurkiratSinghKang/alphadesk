"""CLI scaffolding tests — schema, validate-params, signal, backtest commands."""
from __future__ import annotations

import io
import json
from contextlib import redirect_stdout
from datetime import date
from pathlib import Path

from pydantic import Field

from strategies._core.cli import run_cli
from strategies._core.contracts import (
    OrderType,
    Signal,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy


class CLIParams(StrategyParams):
    threshold: float = Field(
        default=1.5, ge=0, le=5,
        json_schema_extra={"tune": {"low": 0.5, "high": 3.0, "type": "float"}},
    )


class CLITestStrategy(Strategy):
    PARAMS_MODEL = CLIParams
    def universe(self, asof, state): return ["SPY"]
    def run(self, input, params): return StrategyResult()


register_strategy(StrategyMeta(name="cli_test"))(CLITestStrategy)


def test_cli_schema_dumps_params_json_schema(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["x", "schema", "params", "--pretty"])
    exit_code = run_cli(CLITestStrategy)
    assert exit_code == 0
    captured = capsys.readouterr()
    schema = json.loads(captured.out)
    assert "threshold" in schema["properties"]
    assert schema["properties"]["threshold"]["default"] == 1.5


def test_cli_validate_params_ok(tmp_path, monkeypatch, capsys):
    params_file = tmp_path / "p.json"
    params_file.write_text(json.dumps({"threshold": 2.0}))
    monkeypatch.setattr("sys.argv", ["x", "validate-params", str(params_file)])
    exit_code = run_cli(CLITestStrategy)
    assert exit_code == 0


def test_cli_validate_params_bad(tmp_path, monkeypatch, capsys):
    params_file = tmp_path / "p.json"
    params_file.write_text(json.dumps({"threshold": -1}))  # ge=0 violation
    monkeypatch.setattr("sys.argv", ["x", "validate-params", str(params_file)])
    exit_code = run_cli(CLITestStrategy)
    assert exit_code == 2


def test_cli_validate_params_rejects_unknown_field(tmp_path, monkeypatch):
    params_file = tmp_path / "p.json"
    params_file.write_text(json.dumps({"unknown": 99}))
    monkeypatch.setattr("sys.argv", ["x", "validate-params", str(params_file)])
    exit_code = run_cli(CLITestStrategy)
    assert exit_code == 2  # extra="forbid" → ValidationError
