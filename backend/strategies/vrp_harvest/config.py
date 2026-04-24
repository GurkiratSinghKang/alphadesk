"""Parameter defaults for the VRP Harvest strategy — SOTA shell.

Currently registered as ``kind="research"`` pending options-chain integration
in ``StrategyInput``. Params preserved so the full strategy can be restored
later with a one-line registration flip.

See ``spec.md`` for the academic rationale for each knob.
"""

from __future__ import annotations

from pydantic import Field, field_validator

from strategies._core.contracts import StrategyParams


UNDERLYING: str = "SPY"


# Minimum permitted tail_hedge_ratio (audit P0-10). Below this value the
# strategy is economically equivalent to the XIV template that blew up on
# 5 Feb 2018 (volmageddon).
_MIN_TAIL_HEDGE_RATIO = 5


class VRPHarvestParams(StrategyParams):
    """Typed Pydantic-v2 params model for vrp_harvest."""

    underlying: str = Field(default="SPY")
    vrp_entry_threshold: float = Field(
        default=0.02, ge=0.0,
        json_schema_extra={"tune": {"low": 0.005, "high": 0.05, "type": "float"}},
    )
    min_iv_30: float = Field(default=0.08, ge=0.0)
    term_structure_gate: bool = Field(
        default=True,
        json_schema_extra={"tune": {"type": "categorical", "choices": [True, False]}},
    )
    strangle_delta: float = Field(
        default=0.16, gt=0.0, le=1.0,
        json_schema_extra={"tune": {"type": "categorical", "choices": [0.10, 0.16, 0.25]}},
    )
    target_dte: int = Field(
        default=30, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [30, 45, 60]}},
    )
    theta_target_pct: float = Field(
        default=0.003, gt=0.0,
        json_schema_extra={"tune": {"low": 0.001, "high": 0.01, "type": "float"}},
    )
    max_spreads_per_entry: int = Field(default=20, ge=1)
    tp_pct: float = Field(
        default=0.50, gt=0.0, le=1.0,
        json_schema_extra={"tune": {"low": 0.3, "high": 0.7, "type": "float"}},
    )
    sl_pct: float = Field(
        default=2.0, gt=0.0,
        json_schema_extra={"tune": {"low": 1.5, "high": 3.0, "type": "float"}},
    )
    exit_dte: int = Field(
        default=21, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [14, 21, 30]}},
    )
    vix_kill_switch: float = Field(
        default=0.35, gt=0.0,
        json_schema_extra={"tune": {"low": 0.25, "high": 0.40, "type": "float"}},
    )
    tail_hedge_ratio: int = Field(
        default=_MIN_TAIL_HEDGE_RATIO,
        ge=_MIN_TAIL_HEDGE_RATIO,  # audit P0-10 safety floor
        json_schema_extra={"tune": {"type": "categorical", "choices": [5, 10]}},
    )
    tail_hedge_delta: float = Field(
        default=0.05, gt=0.0, le=1.0,
        json_schema_extra={"tune": {"type": "categorical", "choices": [0.03, 0.05, 0.10]}},
    )
    entry_cooldown_days: int = Field(default=3, ge=0)
    risk_free_rate: float = Field(default=0.045, ge=0.0)
    dividend_yield: float = Field(default=0.013, ge=0.0)
    hv_period: int = Field(default=20, ge=2)


__all__ = ["VRPHarvestParams", "UNDERLYING"]
