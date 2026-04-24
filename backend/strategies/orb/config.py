"""Opening Range Breakout — params (SOTA shell).

Registered as ``kind="research"`` pending 1-min intraday integration with
the daily-first BacktestRunner.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


UNIVERSE_PROFILES: dict[str, tuple[str, ...]] = {
    "spy_qqq": ("SPY", "QQQ"),
    "qqq_tqqq": ("QQQ",),
}


class ORBParams(StrategyParams):
    """Typed Pydantic-v2 params model for orb."""

    or_minutes: int = Field(
        default=5, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [5, 15, 30]}},
    )
    entry_cutoff_hour_et: int = Field(
        default=14, ge=1, le=23,
        json_schema_extra={"tune": {"low": 11, "high": 15, "type": "int"}},
    )
    stop_method: Literal["or_bound", "or_midpoint_trail"] = Field(
        default="or_bound",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["or_bound", "or_midpoint_trail"]}
        },
    )
    volume_confirm_min: float = Field(
        default=1.2, ge=1.0,
        json_schema_extra={"tune": {"low": 1.0, "high": 1.5, "type": "float"}},
    )
    universe_profile: Literal["spy_qqq", "qqq_tqqq"] = Field(
        default="qqq_tqqq",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["spy_qqq", "qqq_tqqq"]}
        },
    )
    allow_shorts: bool = Field(
        default=False,
        json_schema_extra={"tune": {"type": "categorical", "choices": [True, False]}},
    )
    tp1_fib: float = Field(
        default=1.272, gt=0.0,
        json_schema_extra={"tune": {"low": 1.0, "high": 1.5, "type": "float"}},
    )
    tp2_fib: float = Field(
        default=1.618, gt=0.0,
        json_schema_extra={"tune": {"low": 1.5, "high": 2.5, "type": "float"}},
    )
    risk_per_trade: float = Field(
        default=0.01, gt=0.0, le=1.0,
        json_schema_extra={"tune": {"low": 0.005, "high": 0.02, "type": "float"}},
    )
    session_end_hour_et: int = Field(default=15, ge=0, le=23)
    session_end_minute_et: int = Field(default=55, ge=0, le=59)
    commission_bps: float = Field(default=0.5, ge=0.0)
    slippage_bps: float = Field(default=2.0, ge=0.0)
    max_notional_pct: float = Field(default=1.0, gt=0.0, le=1.0)
    tp_scale_fraction: float = Field(default=1.0 / 3.0, gt=0.0, le=1.0)


__all__ = ["ORBParams", "UNIVERSE_PROFILES"]
