"""Dividend Capture parameter defaults — SOTA shell.

Trades the ex-dividend-day pricing anomaly documented by Elton & Gruber
(1970): stock prices on average drop by less than the cash dividend on
the ex-date, leaving a small gross return for traders who can hold across
the event. Combined with sustainability + liquidity + earnings filters
to avoid the edge being eroded by adverse selection (Frank & Jagannathan
1998; Graham, Michaely & Roberts 2003).

See ``spec.md`` for the academic + tax background.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


# Static fallback universe — large-caps with sustained dividend programs.
# The strategy applies its own liquidity + sustainability filters at run time;
# this seed just bounds candidate fetches when ``input.dividends`` is empty.
DIVIDEND_UNIVERSE_SEED: tuple[str, ...] = (
    # Dividend ETFs (often skipped in selection but included for completeness)
    "SCHD", "VIG", "VYM", "DVY", "DGRO",
    # Large-cap consistent dividend payers
    "JPM", "BAC", "WFC", "GS", "MS",
    "AAPL", "MSFT", "JNJ", "PG", "KO", "PEP", "WMT", "HD", "MCD",
    "XOM", "CVX", "COP",
    "PFE", "MRK", "ABBV", "LLY", "UNH",
    "VZ", "T", "CMCSA", "DIS",
    "CAT", "DE", "HON", "GE", "RTX",
    "DUK", "NEE", "SO", "AEP",
    "AMT", "PLD", "O",
)


class DividendCaptureParams(StrategyParams):
    """Typed Pydantic-v2 params for the dividend-capture strategy."""

    # Entry timing: ``entry_offset_days`` trading sessions BEFORE ex-date.
    # Default 3 — Elton-Gruber's empirical work focuses on the ex-day price
    # drop; entering 3 sessions ahead lets the price absorb the upcoming-event
    # premium and still gives the holder a positive expected ex-day return.
    entry_offset_days: int = Field(
        default=3,
        ge=1,
        le=10,
        json_schema_extra={"tune": {"type": "categorical", "choices": [1, 2, 3, 5]}},
    )

    # Exit timing: ``exit_offset_days`` trading sessions AFTER ex-date.
    # Default 1 — close the day after the ex-event. T+1 captures the typical
    # partial-recovery rebound documented by Frank-Jagannathan (1998).
    exit_offset_days: int = Field(
        default=1,
        ge=0,
        le=5,
        json_schema_extra={"tune": {"type": "categorical", "choices": [0, 1, 2, 3]}},
    )

    # Minimum dividend-yield-on-this-event (cash_amount / current_price).
    # Filters tiny dividends where transaction costs dominate.
    min_yield_pct: float = Field(
        default=0.005,  # 0.5% per event
        ge=0.0,
        le=0.10,
        json_schema_extra={"tune": {"low": 0.002, "high": 0.020, "type": "float"}},
    )

    # Liquidity: 90-day median dollar volume floor (USD millions).
    min_adv_millions: float = Field(
        default=50.0,
        gt=0.0,
        json_schema_extra={"tune": {"low": 25.0, "high": 200.0, "type": "float"}},
    )

    # Earnings exclusion: skip if the symbol has earnings within the
    # entry-to-exit holding window (prevents catalyst-overlap blow-up).
    earnings_skip_days: int = Field(
        default=10,
        ge=0,
        le=21,
        json_schema_extra={"tune": {"type": "categorical", "choices": [5, 7, 10, 14]}},
    )

    # Per-name target weight (fraction of NAV). Capture trades are short-
    # duration so concentration is the main risk; default 5%.
    target_weight_per_name: float = Field(
        default=0.05,
        gt=0.0,
        le=0.20,
        json_schema_extra={"tune": {"low": 0.02, "high": 0.10, "type": "float"}},
    )

    # Cap on concurrent positions to bound book exposure.
    max_positions: int = Field(
        default=8,
        ge=1,
        le=30,
        json_schema_extra={"tune": {"type": "categorical", "choices": [5, 8, 12, 15]}},
    )

    # ETF filter: skip dividend ETFs in selection (they're in the seed for
    # completeness but their ex-day microstructure is different from
    # underlyings; default True so we trade the underlying anomaly only).
    skip_etfs: bool = Field(
        default=True,
        json_schema_extra={"tune": {"type": "categorical", "choices": [True, False]}},
    )


__all__ = ["DividendCaptureParams", "DIVIDEND_UNIVERSE_SEED"]
