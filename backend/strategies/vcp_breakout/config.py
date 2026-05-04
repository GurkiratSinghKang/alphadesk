"""VCP Breakout (Volatility Contraction Pattern) parameter defaults — SOTA shell.

Identifies Stage-2-uptrend stocks forming progressively tighter consolidation
bases on declining volume, then enters on breakout above the final pivot
with volume confirmation. Methodology popularized by Mark Minervini's
*Trade Like a Stock Market Wizard* (2013) and Stan Weinstein's stage analysis.

Status: ``paper_only=True`` until live intraday paper evidence graduates
the strategy. The detector is structurally complex (multi-leg pattern
recognition); the v0 implementation uses simple closing-price contractions
on weekly bars and may produce different breakout timestamps than a
tick-by-tick implementation.

References:
- Minervini, M. (2013). *Trade Like a Stock Market Wizard.* McGraw-Hill.
- Weinstein, S. (1988). *Secrets for Profiting in Bull and Bear Markets.*
- Karpoff, J. M. (1987). "The Relation Between Price Changes and Trading
  Volume: A Survey." *Journal of Financial and Quantitative Analysis* 22(1).
- Lo, A. W., & Wang, J. (2000). "Trading Volume: Definitions, Data
  Analysis, and Implications of Portfolio Theory."
  *Review of Financial Studies* 13(2).

See ``spec.md`` for the full pattern-detection rules.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


# Russell-1000-style growth-name universe — bigger than S&P 500's 500-name
# set because VCP works best on growth stocks not in the S&P 500 yet.
# Curated 100-name seed; production should swap to a real Russell 1000
# constituent loader (similar to PEAD's sp500_constituents path).
VCP_UNIVERSE_SEED: tuple[str, ...] = (
    # Mega-cap growth (overlap with S&P 500, included for breakout-from-Stage-1)
    "NVDA", "META", "GOOGL", "AMZN", "AAPL", "MSFT", "TSLA", "AMD", "AVGO",
    "CRM", "ORCL", "ADBE", "NOW", "PANW", "CRWD", "DDOG", "SNOW", "MDB",
    "NET", "ZS", "OKTA", "SHOP", "SQ", "PYPL", "COIN", "PLTR", "SMCI",
    # Growth mid-caps and Russell-1000 staples
    "ANET", "FTNT", "WDAY", "TEAM", "ZM", "DOCU", "ROKU", "RBLX", "U",
    "ASML", "AMAT", "LRCX", "KLAC", "MU", "MRVL", "ON", "QCOM", "QRVO", "SWKS",
    "ABNB", "DASH", "UBER", "LYFT", "SPOT", "NFLX", "DIS", "PINS",
    "MRNA", "LLY", "REGN", "VRTX", "BMY", "GILD", "BIIB",
    "JPM", "BAC", "GS", "MS", "BLK", "V", "MA",
    "NKE", "LULU", "SBUX", "MCD",
    "DE", "CAT", "BA", "RTX", "GE",
    "XOM", "CVX",
    # Index ETFs (tradeable; included for breakout-from-base on broad indices)
    "SPY", "QQQ", "IWM", "DIA", "IWB", "MDY", "VTI",
)


class VCPBreakoutParams(StrategyParams):
    """Typed Pydantic-v2 params for the VCP Breakout strategy."""

    # Stage-2 uptrend gate: how many sessions the 200-day SMA must be rising.
    # Minervini calls for ≥30 weeks; default 150 trading sessions ≈ 30 weeks.
    stage2_min_sma200_rising_days: int = Field(
        default=150,
        ge=20,
        le=252,
        json_schema_extra={"tune": {"type": "categorical", "choices": [60, 100, 150, 200]}},
    )

    # Minimum % above 52-week low (Stage-2 confirmation; default 25%).
    stage2_min_above_52w_low: float = Field(
        default=0.25,
        ge=0.0,
        le=2.0,
        json_schema_extra={"tune": {"low": 0.10, "high": 0.50, "type": "float"}},
    )

    # Base length: minimum sessions the consolidation has been forming.
    # Minervini's archetype is 8-15 weeks; default 40 trading sessions ≈ 8 weeks.
    min_base_days: int = Field(
        default=40,
        ge=10,
        le=130,
        json_schema_extra={"tune": {"type": "categorical", "choices": [25, 40, 60, 90]}},
    )

    # Number of progressive contractions required (each successive low ≥ prior).
    # Minervini's "VCP" archetype has 3+ contractions of decreasing magnitude.
    # v0 uses a simpler proxy: peak-to-trough range of the most recent ``min_base_days``
    # must be tighter than the same window ``min_base_days`` ago.
    min_contractions: int = Field(
        default=2,
        ge=1,
        le=5,
        json_schema_extra={"tune": {"type": "categorical", "choices": [2, 3, 4]}},
    )

    # Final-base-tightness: peak-to-trough range over the last ``min_base_days // 2``
    # must be ≤ this fraction of the price.
    final_base_max_range_pct: float = Field(
        default=0.10,
        gt=0.0,
        le=0.30,
        json_schema_extra={"tune": {"low": 0.05, "high": 0.15, "type": "float"}},
    )

    # Volume confirmation: breakout day's volume must be at least this multiple
    # of the trailing 50-day average.
    breakout_volume_multiple: float = Field(
        default=1.5,
        ge=1.0,
        le=5.0,
        json_schema_extra={"tune": {"low": 1.2, "high": 2.5, "type": "float"}},
    )

    # Risk-stop: percentage below the breakout pivot for the chandelier-equivalent
    # stop. Minervini's classical 7-8% rule.
    stop_pct_below_pivot: float = Field(
        default=0.08,
        gt=0.0,
        le=0.20,
        json_schema_extra={"tune": {"low": 0.05, "high": 0.10, "type": "float"}},
    )

    # Time stop: max trading sessions to hold a position before forced exit
    # if it hasn't reached profit-take threshold.
    max_holding_days: int = Field(
        default=60,
        ge=10,
        le=250,
        json_schema_extra={"tune": {"type": "categorical", "choices": [30, 60, 90, 120]}},
    )

    # Profit-take: trailing chandelier exit triggered at this % above pivot.
    # Minervini suggests selling 1/3 at 8% gain, 1/3 at 16%, etc; v0 uses a
    # single 20% take-profit for simplicity.
    profit_take_pct: float = Field(
        default=0.20,
        gt=0.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.10, "high": 0.30, "type": "float"}},
    )

    # Per-name target weight (fraction of NAV).
    target_weight_per_name: float = Field(
        default=0.05,
        gt=0.0,
        le=0.20,
        json_schema_extra={"tune": {"low": 0.02, "high": 0.10, "type": "float"}},
    )

    # Cap on concurrent positions.
    max_positions: int = Field(
        default=8,
        ge=1,
        le=20,
        json_schema_extra={"tune": {"type": "categorical", "choices": [5, 8, 12, 15]}},
    )

    # Liquidity floor (90-day median dollar volume in $M).
    min_adv_millions: float = Field(
        default=20.0,
        gt=0.0,
        json_schema_extra={"tune": {"low": 10.0, "high": 100.0, "type": "float"}},
    )

    rebalance_freq: Literal["weekly", "biweekly"] = Field(
        default="weekly",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["weekly", "biweekly"]}
        },
    )


__all__ = ["VCPBreakoutParams", "VCP_UNIVERSE_SEED"]
