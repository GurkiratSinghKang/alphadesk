"""VWAP session-pullback — params and universe (SOTA shell).

Currently registered as ``kind="research"`` pending 5-min intraday
integration with the daily-first BacktestRunner.
"""

from __future__ import annotations

from pydantic import Field

from strategies._core.contracts import StrategyParams


UNIVERSE: tuple[str, ...] = (
    "SPY", "QQQ", "AAPL", "MSFT", "NVDA",
    "AMZN", "META", "TSLA", "GOOGL", "AMD",
)
SPY: str = "SPY"


class VWAPParams(StrategyParams):
    """Typed Pydantic-v2 params model for vwap."""

    pullback_pct_max: float = Field(
        default=0.0015, gt=0.0,
        json_schema_extra={"tune": {"low": 0.0005, "high": 0.0030, "type": "float"}},
    )
    rsi_period: int = Field(
        default=2, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [2, 3, 5]}},
    )
    rsi_entry_max: float = Field(
        default=15.0, gt=0.0, le=100.0,
        json_schema_extra={"tune": {"low": 10.0, "high": 25.0, "type": "float"}},
    )
    stop_bps_or_atr_max: float = Field(
        default=50.0, gt=0.0,
        json_schema_extra={"tune": {"low": 30.0, "high": 80.0, "type": "float"}},
    )
    tp_sigma_band: float = Field(
        default=1.0, gt=0.0,
        json_schema_extra={"tune": {"low": 0.5, "high": 2.0, "type": "float"}},
    )
    trend_sma_daily: int = Field(
        default=100, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [50, 100, 200]}},
    )
    allow_shorts: bool = Field(
        default=False,
        json_schema_extra={"tune": {"type": "categorical", "choices": [True, False]}},
    )
    max_positions: int = Field(
        default=3, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [2, 3, 5]}},
    )
    max_allocation: float = Field(
        default=0.15, gt=0.0, le=1.0,
        json_schema_extra={"tune": {"low": 0.10, "high": 0.25, "type": "float"}},
    )


__all__ = ["VWAPParams", "UNIVERSE", "SPY"]
