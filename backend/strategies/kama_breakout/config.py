"""Default parameters and tuner search space for the KAMA Breakout strategy.

See ``spec.md`` for the academic rationale behind each default. Numeric
choices follow Kaufman's textbook values ("Trading Systems and Methods",
5th ed., ch. 17) and the original Turtle system (Faith, 2007).
"""

from __future__ import annotations

from pydantic import Field

from strategies._core.contracts import StrategyParams


DEFAULT_UNIVERSE: tuple[str, ...] = (
    "SPY", "QQQ", "IWM",
    "XLE", "XLF", "XLK", "XLV", "XLI", "XLP", "XLU",
    "XLY", "XLB", "XLRE", "XLC",
)


class KamaBreakoutParams(StrategyParams):
    """Typed Pydantic-v2 params model for kama_breakout."""

    # KAMA
    kama_er_period: int = Field(
        default=10, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [8, 10, 14]}},
    )
    kama_fast: int = Field(
        default=2, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [2, 3]}},
    )
    kama_slow: int = Field(
        default=30, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [20, 30]}},
    )

    # Donchian
    donchian_period: int = Field(
        default=20, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [15, 20, 30, 55]}},
    )

    # ATR
    atr_period: int = Field(
        default=22, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [14, 22]}},
    )
    chandelier_atr_mult: float = Field(
        default=3.0, gt=0.0,
        json_schema_extra={"tune": {"low": 2.0, "high": 4.0, "type": "float"}},
    )

    # Trend filter
    trend_sma_period: int = Field(
        default=200, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [100, 150, 200]}},
    )

    # ER gate
    er_min_trend: float = Field(
        default=0.30, ge=0.0, le=1.0,
        json_schema_extra={"tune": {"low": 0.2, "high": 0.5, "type": "float"}},
    )

    # Sizing
    risk_per_trade: float = Field(
        default=0.01, gt=0.0, le=1.0,
        json_schema_extra={"tune": {"low": 0.005, "high": 0.02, "type": "float"}},
    )
    max_positions: int = Field(
        default=8, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [5, 8, 12]}},
    )
    max_allocation: float = Field(
        default=0.15, gt=0.0, le=1.0,
        json_schema_extra={"tune": {"low": 0.08, "high": 0.20, "type": "float"}},
    )

    # Volume surge
    volume_surge_enabled: bool = Field(default=False)
    volume_surge_min: float = Field(
        default=1.2, gt=0.0,
        json_schema_extra={"tune": {"low": 1.0, "high": 1.5, "type": "float"}},
    )
    volume_sma_period: int = Field(default=20, ge=1)

    # Pyramiding — REMOVED Round-6 / I-6. The pyramid path was never
    # wired into ``run()`` (no second-leg signal emission, no fill-driven
    # state mutation), so the params, the description's "1/2 size pyramid
    # at +1 ATR" claim, and the ``atr_at_entry`` field on PosState were
    # all dead code. Keeping the strategy simpler is the audit's
    # documented preference; reinstating pyramiding requires a fresh OOS
    # validation pass per ``spec.md``.

    # Earnings skip
    earnings_skip_days: int = Field(default=2, ge=0)


__all__ = ["KamaBreakoutParams", "DEFAULT_UNIVERSE"]
