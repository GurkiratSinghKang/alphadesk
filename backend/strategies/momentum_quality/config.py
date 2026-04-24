"""Momentum + Quality parameter defaults, search space, and universe seed.

Defaults match the AQR QMJ / Piotroski 2000 / Jegadeesh-Titman 1993 textbook
baseline; search ranges stay close to the literature. See ``spec.md``.
"""

from __future__ import annotations

import logging
from typing import Literal

from pydantic import Field

from strategies._core.contracts import StrategyParams


_log = logging.getLogger("alphadesk.strategies.momentum_quality.config")


# --------------------------------------------------------------------------- #
# Universe                                                                    #
# --------------------------------------------------------------------------- #
UNIVERSE_SEED: tuple[str, ...] = tuple(dict.fromkeys((
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "META", "AVGO",
    "ORCL", "ADBE", "CRM", "CSCO", "AMD", "INTC", "TXN", "QCOM", "IBM", "NFLX", "ACN",
    "LLY", "UNH", "ABBV", "MRK", "TMO", "PFE", "DHR", "ABT", "AMGN", "MDT",
    "AMZN", "PG", "HD", "COST", "PEP", "KO", "WMT", "NKE", "MCD", "DIS",
    "LOW", "TSLA",
    "CMCSA", "VZ",
    "XOM", "HON", "UPS", "RTX", "CAT",
    "V", "MA", "JPM", "BAC",
    "PM",
)))

SECTOR_MAP: dict[str, str] = {
    "AAPL": "Information Technology", "MSFT": "Information Technology",
    "GOOGL": "Communication Services", "GOOG": "Communication Services",
    "AMZN": "Consumer Discretionary", "NVDA": "Information Technology",
    "META": "Communication Services", "AVGO": "Information Technology",
    "ORCL": "Information Technology", "ADBE": "Information Technology",
    "CRM": "Information Technology", "CSCO": "Information Technology",
    "AMD": "Information Technology", "INTC": "Information Technology",
    "TXN": "Information Technology", "QCOM": "Information Technology",
    "IBM": "Information Technology", "NFLX": "Communication Services",
    "ACN": "Information Technology", "LLY": "Health Care",
    "UNH": "Health Care", "ABBV": "Health Care", "MRK": "Health Care",
    "TMO": "Health Care", "PFE": "Health Care", "DHR": "Health Care",
    "ABT": "Health Care", "AMGN": "Health Care", "MDT": "Health Care",
    "PG": "Consumer Staples", "HD": "Consumer Discretionary",
    "COST": "Consumer Staples", "PEP": "Consumer Staples",
    "KO": "Consumer Staples", "WMT": "Consumer Staples",
    "NKE": "Consumer Discretionary", "MCD": "Consumer Discretionary",
    "DIS": "Communication Services", "LOW": "Consumer Discretionary",
    "TSLA": "Consumer Discretionary", "CMCSA": "Communication Services",
    "VZ": "Communication Services", "XOM": "Energy",
    "HON": "Industrials", "UPS": "Industrials",
    "RTX": "Industrials", "CAT": "Industrials",
    "V": "Financials", "MA": "Financials",
    "JPM": "Financials", "BAC": "Financials",
    "PM": "Consumer Staples",
}

EXCLUDED_SECTORS: frozenset[str] = frozenset({"Financials", "Utilities"})

REBALANCE_FREQS: tuple[str, ...] = ("monthly", "bimonthly", "quarterly")


# --------------------------------------------------------------------------- #
# Params                                                                      #
# --------------------------------------------------------------------------- #
class MomentumQualityParams(StrategyParams):
    """Typed Pydantic-v2 params model for momentum_quality."""

    momentum_lookback_m: int = Field(
        default=12,
        ge=1,
        le=24,
        json_schema_extra={"tune": {"type": "categorical", "choices": [6, 9, 12]}},
    )
    momentum_skip_m: int = Field(
        default=1,
        ge=0,
        le=3,
        json_schema_extra={"tune": {"type": "categorical", "choices": [0, 1]}},
    )
    quality_weight: float = Field(
        default=0.4,
        ge=0.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.2, "high": 0.6, "type": "float"}},
    )
    top_n: int = Field(
        default=15,
        ge=1,
        json_schema_extra={"tune": {"type": "categorical", "choices": [10, 15, 20, 25]}},
    )
    rebalance_freq: Literal["monthly", "bimonthly", "quarterly"] = Field(
        default="monthly",
        json_schema_extra={
            "tune": {"type": "categorical", "choices": list(REBALANCE_FREQS)}
        },
    )
    min_f_score: int = Field(
        default=5,
        ge=0,
        le=9,
        json_schema_extra={"tune": {"low": 4, "high": 7, "type": "int"}},
    )
    momentum_filter_min: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.0, "high": 0.1, "type": "float"}},
    )
    earnings_skip_days: int = Field(default=3, ge=0, le=30)


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def eligible_universe() -> list[str]:
    """Return the seed list with Financials/Utilities removed."""
    out: list[str] = []
    missing: list[str] = []
    for s in UNIVERSE_SEED:
        sector = SECTOR_MAP.get(s)
        if sector is None:
            missing.append(s)
            continue
        if sector in EXCLUDED_SECTORS:
            continue
        out.append(s)
    if missing:
        _log.warning(
            "momentum_quality: %d UNIVERSE_SEED symbols silently dropped "
            "(missing from SECTOR_MAP): %s",
            len(missing), ",".join(sorted(set(missing))),
        )
    return out


__all__ = [
    "MomentumQualityParams",
    "UNIVERSE_SEED", "SECTOR_MAP", "EXCLUDED_SECTORS",
    "REBALANCE_FREQS", "eligible_universe",
]
