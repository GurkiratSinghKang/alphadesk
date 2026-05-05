"""Gap-Fill parameter defaults — SOTA shell.

Trades the Branch & Ma (2012) overnight-gap mean-reversion: stocks that
gap meaningfully on no material catalyst tend to retrace within the
first 30-90 minutes of regular-session trading. Paper-only until live
intraday paper evidence graduates the strategy.

References:
- Branch, B., & Ma, A. (2012). "The Overnight Return, One More Anomaly."
  *Journal of Banking & Finance* 36(12).
- Akbas, F., Boehmer, E., Jiang, D., & Koch, P. D. (2022). "Overnight
  Returns, Daytime Reversals, and Future Stock Returns." *Journal of
  Financial and Quantitative Analysis* 57(4).

See ``spec.md`` for the academic + microstructure background.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


# A 60-name large-cap universe with consistent intraday liquidity.
# Conservatively-weighted toward names where 1-min Alpaca bars are dense
# and overnight-gap statistics are stable (mega-caps + S&P leaders).
GAP_FILL_UNIVERSE_SEED: tuple[str, ...] = (
    # Mega-cap tech
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AMD", "AVGO",
    "CRM", "ORCL", "ADBE", "CSCO", "QCOM",
    # Financials
    "JPM", "BAC", "WFC", "GS", "MS", "C", "AXP",
    # Health Care
    "JNJ", "LLY", "UNH", "PFE", "MRK", "ABBV", "TMO",
    # Consumer
    "AMZN", "HD", "MCD", "NKE", "SBUX", "WMT", "COST", "PG", "KO", "PEP",
    # Industrials / Materials
    "CAT", "BA", "GE", "HON", "UNP", "DE", "RTX",
    # Energy
    "XOM", "CVX", "COP",
    # Index ETFs (tradeable)
    "SPY", "QQQ", "IWM", "DIA",
)


class GapFillParams(StrategyParams):
    """Typed Pydantic-v2 params for the gap-fill strategy."""

    # Minimum gap size to enter (absolute %). Below this, microstructure noise
    # dominates and the fade isn't economical.
    min_gap_pct: float = Field(
        default=0.010,  # 1.0%
        gt=0.0,
        le=0.10,
        json_schema_extra={"tune": {"low": 0.005, "high": 0.025, "type": "float"}},
    )

    # Maximum gap size to enter. Above this, the gap likely reflects a real
    # catalyst (earnings, M&A, FDA) and shouldn't be faded.
    max_gap_pct: float = Field(
        default=0.040,  # 4.0%
        gt=0.0,
        le=0.20,
        json_schema_extra={"tune": {"low": 0.025, "high": 0.080, "type": "float"}},
    )

    # Entry trigger: minutes after the open before we accept a fade signal.
    # 5 minutes lets the opening auction settle; per Branch-Ma the bulk of
    # the fade plays out from 09:35 ET onward.
    entry_after_minutes: int = Field(
        default=5,
        ge=1,
        le=30,
        json_schema_extra={"tune": {"type": "categorical", "choices": [3, 5, 10, 15]}},
    )

    # Exit time: close all positions by this minute-after-open (default 11:00 ET
    # = 90 minutes after the 09:30 open). Gap fades that haven't played out
    # by mid-morning are usually catalyst-driven.
    exit_at_minutes: int = Field(
        default=90,
        ge=15,
        le=240,
        json_schema_extra={"tune": {"type": "categorical", "choices": [60, 90, 120, 180]}},
    )

    # Per-name target weight as fraction of NAV. Defensive cap given the
    # short holding window and binary-tail nature of catalyst gaps.
    target_weight_per_name: float = Field(
        default=0.05,
        gt=0.0,
        le=0.20,
        json_schema_extra={"tune": {"low": 0.02, "high": 0.10, "type": "float"}},
    )

    # Cap concurrent positions.
    max_positions: int = Field(
        default=4,
        ge=1,
        le=15,
        json_schema_extra={"tune": {"type": "categorical", "choices": [3, 4, 6, 8]}},
    )

    # Earnings exclusion: any gap on a name with earnings today or next
    # session is treated as catalyst-driven (skip).
    earnings_skip_days: int = Field(
        default=2,
        ge=0,
        le=7,
        json_schema_extra={"tune": {"type": "categorical", "choices": [1, 2, 3, 5]}},
    )

    # Direction: "fade_both" trades both up-gaps (short) and down-gaps (long);
    # "fade_down_only" is long-only on down-gaps (the safer half).
    direction: Literal["fade_both", "fade_down_only"] = Field(
        default="fade_down_only",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["fade_both", "fade_down_only"]}
        },
    )


__all__ = ["GapFillParams", "GAP_FILL_UNIVERSE_SEED"]
