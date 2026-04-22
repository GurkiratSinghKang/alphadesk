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


# ---------------------------------------------------------------------------
# Task 3: Signal, OptionLeg, OrderType, TimeInForce
# ---------------------------------------------------------------------------

from datetime import date

from strategies._core.contracts import (
    OptionLeg,
    OrderType,
    Signal,
    TimeInForce,
)


def test_signal_requires_exactly_one_sizing():
    """target_weight and quantity are mutually exclusive — exactly one must be set."""
    # Both set → error
    with pytest.raises(ValidationError, match="exactly one"):
        Signal(symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT,
               target_weight=0.5, quantity=10)
    # Neither set → error
    with pytest.raises(ValidationError, match="exactly one"):
        Signal(symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT)
    # Only weight → OK
    s = Signal(symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT, target_weight=0.5)
    assert s.target_weight == 0.5
    # Only quantity → OK
    s = Signal(symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT, quantity=10)
    assert s.quantity == 10


def test_signal_frozen():
    s = Signal(symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT, quantity=10)
    with pytest.raises(ValidationError):
        s.symbol = "AAPL"


def test_signal_with_option_legs():
    """Multi-leg option orders pack into a single Signal via `legs`."""
    s = Signal(
        symbol="NVDA",
        asof=date(2024, 1, 1),
        order_type=OrderType.LMT,
        target_weight=0.0,           # opens a risk-neutral position
        legs=[
            OptionLeg(occ_symbol="NVDA260425P00195000", side="sell", quantity=1),
            OptionLeg(occ_symbol="NVDA260425C00210000", side="sell", quantity=1),
        ],
    )
    assert len(s.legs) == 2
    assert s.legs[0].side == "sell"


def test_signal_tag_max_length():
    """tag caps at 256 chars so audit ledger entries stay bounded."""
    with pytest.raises(ValidationError, match="at most 256"):
        Signal(
            symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT,
            quantity=10, tag="x" * 257,
        )


def test_order_type_values():
    assert OrderType.MKT.value == "MKT"
    assert OrderType.MOO.value == "MOO"


def test_time_in_force_values():
    assert TimeInForce.DAY.value == "DAY"
    assert TimeInForce.GTC.value == "GTC"
