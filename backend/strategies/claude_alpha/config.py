"""Claude Alpha parameter defaults — SOTA shell.

Systematic equity selection where Claude synthesises fundamentals +
technicals + sentiment + catalysts + options-flow into a structured
per-name thesis. Top-quintile scored names get 1-3% conviction-weighted
positions, weekly rebalance.

Status: ``kind="research"`` until the prompt + replay harness are
validated against a 2019-2024 OOS window. The deterministic-replay cache
(see ``strategy.py``) is the foundation that makes that validation
possible without per-trial LLM cost.

References:
- Grossman, S. J., & Stiglitz, J. E. (1980). "On the Impossibility of
  Informationally Efficient Markets." *American Economic Review* 70(3).
- Lopez de Prado, M. (2018). *Advances in Financial Machine Learning.*
  (Walk-forward replay + meta-labeling discipline.)
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


# Curated 80-name liquid-large-cap seed for the v0 universe.
# Production should swap to a point-in-time S&P 500 + market-cap filter via
# fundamentals_provider.sp500_constituents() (Plan B.2) once the prompt path
# is validated.
CLAUDE_ALPHA_UNIVERSE_SEED: tuple[str, ...] = (
    # Tech
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AMD", "AVGO",
    "CRM", "ORCL", "ADBE", "CSCO", "QCOM", "INTC", "TXN", "IBM", "NOW", "PANW",
    # Financials
    "JPM", "BAC", "GS", "MS", "WFC", "C", "AXP", "BLK", "SCHW", "USB", "V", "MA",
    # Health Care
    "UNH", "JNJ", "LLY", "PFE", "MRK", "ABBV", "TMO", "DHR", "ABT", "BMY",
    # Consumer
    "HD", "MCD", "NKE", "SBUX", "WMT", "COST", "PG", "KO", "PEP", "DIS",
    "TGT", "LULU", "BKNG",
    # Industrials / Energy / Materials
    "CAT", "BA", "GE", "HON", "UNP", "DE", "RTX", "LMT", "GD",
    "XOM", "CVX", "COP", "SLB",
    "LIN", "DD",
    # Utilities / Real Estate / Comm
    "DUK", "NEE", "SO",
    "AMT", "PLD", "O",
    "VZ", "T", "CMCSA", "NFLX",
)


class ClaudeAlphaParams(StrategyParams):
    """Typed Pydantic-v2 params for the LLM-driven discretionary book."""

    # Number of concurrent positions. Spec target is 15.
    target_positions: int = Field(
        default=15,
        ge=5,
        le=30,
        json_schema_extra={"tune": {"type": "categorical", "choices": [10, 15, 20]}},
    )

    # Per-name weight cap (1-3% per spec). The actual weight is conviction-
    # scaled: high-score names get max_weight, lower-score names get lower.
    min_weight_per_name: float = Field(
        default=0.01,
        gt=0.0,
        le=0.10,
        json_schema_extra={"tune": {"low": 0.005, "high": 0.02, "type": "float"}},
    )
    max_weight_per_name: float = Field(
        default=0.03,
        gt=0.0,
        le=0.10,
        json_schema_extra={"tune": {"low": 0.02, "high": 0.05, "type": "float"}},
    )

    # Score threshold for entry (top-quintile = >= 0.8 on a [0, 1] scale).
    min_score: float = Field(
        default=0.80,
        ge=0.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.6, "high": 0.9, "type": "float"}},
    )

    # Liquidity floor: 90-day median dollar volume in $M.
    min_adv_millions: float = Field(
        default=10.0,
        gt=0.0,
        json_schema_extra={"tune": {"low": 5.0, "high": 50.0, "type": "float"}},
    )

    # Holding cap: maximum trading sessions to hold a position before forced exit.
    max_holding_days: int = Field(
        default=21,
        ge=5,
        le=120,
        json_schema_extra={"tune": {"type": "categorical", "choices": [10, 21, 42, 90]}},
    )

    # Earnings exclusion: skip names with earnings in the next N sessions.
    earnings_skip_days: int = Field(
        default=3,
        ge=0,
        le=14,
        json_schema_extra={"tune": {"type": "categorical", "choices": [0, 3, 5, 7]}},
    )

    rebalance_freq: Literal["weekly", "biweekly", "monthly"] = Field(
        default="weekly",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": ["weekly", "biweekly", "monthly"]}
        },
    )

    # Prompt versioning — every Claude call carries this id+version, and the
    # replay cache is keyed by (prompt_id, prompt_version, input_hash, asof).
    # Bump prompt_version when the prompt template changes; the cache misses
    # on the new version, forcing fresh inference (which the operator pays for).
    prompt_id: str = Field(default="claude_alpha_v0_baseline")
    prompt_version: int = Field(default=1, ge=1)

    # Cost guard: max USD per session that the strategy will spend on
    # Claude API calls. Beyond this, screen the universe with the deterministic
    # fallback scorer instead. ClaudeClient also has its own daily kill-switch.
    max_session_spend_usd: float = Field(
        default=5.0,
        ge=0.0,
        le=100.0,
    )


__all__ = ["ClaudeAlphaParams", "CLAUDE_ALPHA_UNIVERSE_SEED"]
