"""Parameter defaults for the Earnings Volatility short-iron-butterfly
strategy — SOTA shell.

Currently registered as ``kind="research"`` pending options-chain
integration in ``StrategyInput``. Params + universe preserved so the full
strategy can be restored later with a one-line registration flip.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


# --------------------------------------------------------------------------- #
# Fixed universe — 29 names with liquid weekly options                        #
# --------------------------------------------------------------------------- #
UNIVERSE: tuple[str, ...] = (
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AMD",
    "NFLX", "CRM", "ORCL", "ADBE", "INTC", "QCOM", "AVGO",
    "MU", "AMAT", "LRCX",
    "JPM", "BAC", "GS", "MS", "WFC",
    "XOM", "CVX",
    "UNH", "LLY", "PFE",
    "UBER",
)


# --------------------------------------------------------------------------- #
# Params                                                                      #
# --------------------------------------------------------------------------- #
class EarningsVolParams(StrategyParams):
    """Typed Pydantic-v2 params model for earnings_vol."""

    implied_vs_historical_min_ratio: float = Field(
        default=1.7555, gt=0.0,
        json_schema_extra={"tune": {"low": 1.3, "high": 2.0, "type": "float"}},
    )
    wing_width_multiple: float = Field(
        default=0.8072, gt=0.0,
        json_schema_extra={"tune": {"low": 0.8, "high": 2.0, "type": "float"}},
    )
    dte_target: int = Field(
        default=21, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [7, 14, 21]}},
    )
    max_loss_pct_per_trade: float = Field(
        default=0.02865, gt=0.0, le=1.0,
        json_schema_extra={"tune": {"low": 0.005, "high": 0.03, "type": "float"}},
    )
    exit_timing: Literal["next_open", "next_close", "1h_after_open"] = Field(
        default="1h_after_open",
        json_schema_extra={
            "tune": {
                "type": "categorical",
                "choices": ["next_open", "next_close", "1h_after_open"],
            }
        },
    )
    earnings_timing_filter: Literal["after_close_only", "any"] = Field(
        default="any",
        json_schema_extra={
            "tune": {
                "type": "categorical",
                "choices": ["after_close_only", "any"],
            }
        },
    )
    min_underlying_price: float = Field(
        default=20,
        json_schema_extra={"tune": {"type": "categorical", "choices": [20, 30, 50]}},
    )
    max_concurrent_positions: int = Field(
        default=1, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [1, 2, 3]}},
    )
    historical_moves_lookback_quarters: int = Field(
        default=8, ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [4, 8, 12]}},
    )
    iv_crush_retention: float = Field(default=0.55, ge=0.0, le=1.0)
    risk_free_rate: float = Field(default=0.04, ge=0.0)
    min_historical_events: int = Field(default=4, ge=1)


__all__ = ["EarningsVolParams", "UNIVERSE"]
