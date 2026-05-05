"""Mean Reversion (slow / quality-conditioned) parameter defaults — SOTA shell.

Distinct from rsi2_reversal: this is a slower, fundamentally-aware reversal
book. Find liquid US large-caps that have sold off ≥ z_entry σ below their
60-day moving average, gate on Piotroski F-score quality (require F ≥ 5
to avoid value-trap left-tails), skip names with imminent earnings,
exit when price reaches the 60d MA or after a 30-day timeout.

References:
- De Bondt & Thaler (1985). "Does the Stock Market Overreact?" *Journal of Finance* 40(3).
- Jegadeesh (1990). "Evidence of Predictable Behavior of Security Returns." *Journal of Finance* 45(3).
- Piotroski (2000). "Value Investing: The Use of Historical Financial Statement Information."
- Asness, Frazzini, Israel & Moskowitz (2015). "Fact, Fiction, and Value Investing." *JPM* 42(1).

The slow horizon (~30 trading days) materially differs from Connors RSI(2)
(2-3 day mean reversion); the quality overlay distinguishes this book from
naïve oversold buying that historically suffers in value-trap regimes.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


# --------------------------------------------------------------------------- #
# Universe seed (fallback) — kept small + liquid                              #
# --------------------------------------------------------------------------- #
# Used only when input.fundamentals doesn't include a survivorship-bias-free
# point-in-time membership. Fallback list is a 60-name liquid large-cap set
# spanning all 11 GICS sectors (deliberately broader than the legacy
# 47-name momentum-quality fixed list).
UNIVERSE_SEED: tuple[str, ...] = (
    # Tech
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AMD", "ORCL", "CRM",
    "CSCO", "ADBE", "AVGO",
    # Financials
    "JPM", "BAC", "GS", "MS", "WFC", "C", "BLK", "SCHW", "AXP",
    # Health Care
    "UNH", "JNJ", "LLY", "PFE", "MRK", "ABBV", "TMO", "DHR",
    # Consumer Discretionary / Staples
    "HD", "MCD", "NKE", "SBUX", "WMT", "COST", "PG", "KO", "PEP",
    # Industrials
    "CAT", "BA", "GE", "HON", "UNP", "RTX", "DE",
    # Energy / Materials / Utilities / RE / Comm Services
    "XOM", "CVX", "COP", "LIN", "DD", "DUK", "NEE", "AMT", "PLD", "DIS", "VZ", "T", "CMCSA",
)


# --------------------------------------------------------------------------- #
# Params                                                                      #
# --------------------------------------------------------------------------- #
class MeanReversionParams(StrategyParams):
    """Typed Pydantic-v2 params for the slow / quality-conditioned reversal book."""

    # Lookback for the moving average + z-score denominator.
    ma_lookback_days: int = Field(
        default=60,
        ge=20,
        le=252,
        json_schema_extra={"tune": {"type": "categorical", "choices": [40, 60, 90]}},
    )

    # Z-score entry threshold (negative-side: enter when price < MA - z_entry σ).
    z_entry: float = Field(
        default=2.0,
        ge=1.0,
        le=4.0,
        json_schema_extra={"tune": {"low": 1.5, "high": 3.0, "type": "float"}},
    )

    # Piotroski F-score floor (0–9). 5 is the conservative production setting
    # per Asness-Frazzini-Pedersen (2019); 7 is the strict version used by
    # momentum-quality. Defaults to 5 to keep mean_reversion's universe wider.
    min_f_score: int = Field(
        default=5,
        ge=0,
        le=9,
        json_schema_extra={"tune": {"type": "categorical", "choices": [4, 5, 6, 7]}},
    )

    # Earnings exclusion window (trading sessions). Spec calls for ≤ 7 days.
    earnings_skip_days: int = Field(
        default=7,
        ge=0,
        le=21,
        json_schema_extra={"tune": {"type": "categorical", "choices": [3, 5, 7, 14]}},
    )

    # Number of names to hold concurrently. Caps single-name concentration risk.
    max_positions: int = Field(
        default=10,
        ge=1,
        le=50,
        json_schema_extra={"tune": {"type": "categorical", "choices": [5, 10, 15, 20]}},
    )

    # Per-name weight as a fraction of portfolio NAV.
    target_weight_per_name: float = Field(
        default=0.05,
        gt=0.0,
        le=0.20,
        json_schema_extra={"tune": {"low": 0.02, "high": 0.10, "type": "float"}},
    )

    # Time-stop horizon (trading sessions). Exit at MOC after this many days
    # if the position hasn't already crossed the MA.
    holding_days: int = Field(
        default=30,
        ge=5,
        le=90,
        json_schema_extra={"tune": {"type": "categorical", "choices": [21, 30, 45]}},
    )

    # Liquidity floor (90-day median dollar volume in millions of USD).
    min_adv_millions: float = Field(
        default=50.0,
        gt=0.0,
        json_schema_extra={"tune": {"low": 25.0, "high": 100.0, "type": "float"}},
    )

    rebalance_freq: Literal["weekly", "biweekly"] = Field(
        default="weekly",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["weekly", "biweekly"]}
        },
    )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def required_lookback(params: MeanReversionParams) -> int:
    """How many sessions of bar history the strategy needs (with buffer)."""
    return max(int(params.ma_lookback_days * 2), 252)


__all__ = [
    "MeanReversionParams",
    "UNIVERSE_SEED",
    "required_lookback",
]
