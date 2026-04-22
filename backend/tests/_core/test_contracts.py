"""Core contract tests — Pydantic v2 roundtrip + validator behavior.

This file grows through Phase 1 as we add more contracts. Start with
StrategyParams + its tune_space()/param_hash() classmethods."""
from __future__ import annotations

import json

import pytest
from pydantic import Field, ValidationError

from strategies._core.contracts import StrategyParams


class ExampleParams(StrategyParams):
    """Test double — a strategy param model used only in these tests."""
    sue_threshold: float = Field(
        default=1.5, ge=0, le=5,
        json_schema_extra={"tune": {"low": 0.5, "high": 3.0, "type": "float"}},
    )
    holding_days: int = Field(
        default=40, ge=1, le=252,
        json_schema_extra={"tune": {"low": 10, "high": 90, "type": "int"}},
    )
    name: str = Field(default="test", description="Non-tuned field")


def test_params_default_instantiation():
    p = ExampleParams()
    assert p.sue_threshold == 1.5
    assert p.holding_days == 40


def test_params_frozen():
    """`frozen=True` means instances cannot be mutated."""
    p = ExampleParams()
    with pytest.raises(ValidationError):
        p.sue_threshold = 2.0


def test_params_extra_forbidden():
    """`extra=forbid` catches typos in param overrides at construction."""
    with pytest.raises(ValidationError, match="Extra inputs"):
        ExampleParams(sue_treshold=2.0)  # typo: treshold, not threshold


def test_params_validate_default():
    """A subclass that defaults to an invalid value should fail at class-def time,
    because validate_default=True."""
    with pytest.raises(ValidationError):
        class BrokenParams(StrategyParams):
            x: int = Field(default=-1, ge=0)
        BrokenParams()  # instantiation triggers the validation


def test_tune_space_excludes_non_tuned_fields():
    space = ExampleParams.tune_space()
    assert set(space.keys()) == {"sue_threshold", "holding_days"}
    assert "name" not in space  # no `tune` extra → excluded
    assert space["sue_threshold"]["low"] == 0.5
    assert space["holding_days"]["type"] == "int"


def test_param_hash_stable_across_runs():
    """Hash depends only on param values, not on hash random-seed."""
    p1 = ExampleParams(sue_threshold=1.7, holding_days=30)
    p2 = ExampleParams(sue_threshold=1.7, holding_days=30)
    assert ExampleParams.param_hash(p1) == ExampleParams.param_hash(p2)


def test_param_hash_changes_with_values():
    p1 = ExampleParams(sue_threshold=1.5)
    p2 = ExampleParams(sue_threshold=1.6)
    assert ExampleParams.param_hash(p1) != ExampleParams.param_hash(p2)


def test_param_hash_is_16_char_hex():
    p = ExampleParams()
    h = ExampleParams.param_hash(p)
    assert len(h) == 16
    int(h, 16)  # raises if not hex
