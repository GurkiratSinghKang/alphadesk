"""Momentum + Quality parameter defaults, search space, and universe seed.

Single source of truth for every knob the strategy exposes. Defaults match
the AQR QMJ / Piotroski 2000 / Jegadeesh-Titman 1993 textbook baseline;
search ranges stay close to the literature — a wide search space on a
~24-rebalance-per-window budget is the textbook recipe for false
discoveries.

See :mod:`backend.strategies.momentum_quality.spec` (the ``spec.md`` next to
this file) for the academic rationale for each knob.
"""

from __future__ import annotations

import logging
from typing import Any


_log = logging.getLogger("alphadesk.strategies.momentum_quality.config")


# --------------------------------------------------------------------------- #
# Defaults                                                                    #
# --------------------------------------------------------------------------- #
DEFAULTS: dict[str, Any] = {
    # Momentum lookback in months. Canonical JT 1993 = 12.
    "momentum_lookback_m": 12,
    # Skip the most-recent month to avoid short-term reversal (Lehmann 1990).
    # 1 = skip 21 trading days (default), 0 = no skip.
    "momentum_skip_m": 1,
    # Weight on the quality-rank in the composite; momentum_weight = 1 - q.
    # 0.4 matches the AQR 60/40 convention on a small universe.
    "quality_weight": 0.4,
    # Number of names to hold long on each rebalance.
    "top_n": 15,
    # Rebalance cadence. "monthly" = last trading day each month;
    # "bimonthly" = every other month; "quarterly" = Jan / Apr / Jul / Oct.
    "rebalance_freq": "monthly",
    # Hard Piotroski F-score gate — exclude names below this before ranking.
    "min_f_score": 5,
    # Optional absolute-momentum floor — skip names with 12-1 return < floor.
    "momentum_filter_min": 0.0,
    # Skip names with earnings in the next N days at rebalance time.
    # Fixed (not searched) — 3 days is the Piotroski 2000 / AQR convention.
    "earnings_skip_days": 3,
}


# --------------------------------------------------------------------------- #
# Universe                                                                    #
# --------------------------------------------------------------------------- #
# Fixed seed list of ~50 large-cap US names. Hand-curated mix across major
# GICS sectors (ex-Financials / ex-Utilities per the QMJ convention).
# We keep the list fixed across the backtest window — S&P 500 membership
# changes on this timescale are small and the point of the momentum factor
# is that it picks up leadership rotation within a stable universe.
UNIVERSE_SEED: tuple[str, ...] = (
    # Mega-cap tech
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "META", "AVGO",
    "ORCL", "ADBE", "CRM", "CSCO", "AMD", "INTC", "TXN", "QCOM", "IBM", "NFLX", "ACN",
    # Healthcare
    "LLY", "UNH", "ABBV", "MRK", "TMO", "PFE", "DHR", "ABT", "AMGN", "MDT",
    # Consumer
    "AMZN", "PG", "HD", "COST", "PEP", "KO", "WMT", "NKE", "MCD", "DIS",
    "LOW", "TSLA",
    # Communication / services
    "CMCSA", "VZ",
    # Industrials / energy / materials
    "XOM", "HON", "UPS", "RTX", "CAT",
    # Financials (conservatively flagged for exclusion in SECTOR_MAP below)
    "V", "MA", "JPM", "BAC",
    # Tobacco / misc consumer
    "PM",
)
# Deduplicate while preserving order (AMZN appears twice above on purpose to
# cover both its Consumer Discretionary and Communication Services taxonomy
# — the loader deduplicates).
UNIVERSE_SEED = tuple(dict.fromkeys(UNIVERSE_SEED))


# GICS sector map for the QMJ exclusions. "Financials" + "Utilities" are
# excluded per the Asness-Frazzini-Pedersen 2014 convention (Piotroski
# F-score behaves pathologically on banks and utilities).
SECTOR_MAP: dict[str, str] = {
    "AAPL": "Information Technology",
    "MSFT": "Information Technology",
    "GOOGL": "Communication Services",
    "GOOG": "Communication Services",
    "AMZN": "Consumer Discretionary",
    "NVDA": "Information Technology",
    "META": "Communication Services",
    "AVGO": "Information Technology",
    "ORCL": "Information Technology",
    "ADBE": "Information Technology",
    "CRM": "Information Technology",
    "CSCO": "Information Technology",
    "AMD": "Information Technology",
    "INTC": "Information Technology",
    "TXN": "Information Technology",
    "QCOM": "Information Technology",
    "IBM": "Information Technology",
    "NFLX": "Communication Services",
    "ACN": "Information Technology",
    "LLY": "Health Care",
    "UNH": "Health Care",
    "ABBV": "Health Care",
    "MRK": "Health Care",
    "TMO": "Health Care",
    "PFE": "Health Care",
    "DHR": "Health Care",
    "ABT": "Health Care",
    "AMGN": "Health Care",
    "MDT": "Health Care",
    "PG": "Consumer Staples",
    "HD": "Consumer Discretionary",
    "COST": "Consumer Staples",
    "PEP": "Consumer Staples",
    "KO": "Consumer Staples",
    "WMT": "Consumer Staples",
    "NKE": "Consumer Discretionary",
    "MCD": "Consumer Discretionary",
    "DIS": "Communication Services",
    "LOW": "Consumer Discretionary",
    "TSLA": "Consumer Discretionary",
    "CMCSA": "Communication Services",
    "VZ": "Communication Services",
    "XOM": "Energy",
    "HON": "Industrials",
    "UPS": "Industrials",
    "RTX": "Industrials",
    "CAT": "Industrials",
    "V": "Financials",
    "MA": "Financials",
    "JPM": "Financials",
    "BAC": "Financials",
    "PM": "Consumer Staples",
}

# QMJ-style sector exclusions.
EXCLUDED_SECTORS: frozenset[str] = frozenset({"Financials", "Utilities"})


# --------------------------------------------------------------------------- #
# Rebalance helpers                                                           #
# --------------------------------------------------------------------------- #
REBALANCE_FREQS: tuple[str, ...] = ("monthly", "bimonthly", "quarterly")


# --------------------------------------------------------------------------- #
# Search space                                                                #
# --------------------------------------------------------------------------- #
def search_space() -> dict[str, Any]:
    """Optuna search space. Matches the ranges in the Wave B design brief."""

    # Deferred import: keeps this module importable without optuna.
    from tuner.search import Categorical, FloatRange, IntRange

    return {
        "momentum_lookback_m": Categorical([6, 9, 12]),
        "momentum_skip_m": Categorical([0, 1]),
        # 0.6*momentum + quality_weight*quality, re-normalized inside the
        # strategy so the sum is 1.
        "quality_weight": FloatRange(0.2, 0.6),
        "top_n": Categorical([10, 15, 20, 25]),
        "rebalance_freq": Categorical(["monthly", "bimonthly", "quarterly"]),
        # filter out low-quality before ranking
        "min_f_score": IntRange(4, 7),
        # optional absolute-momentum floor on each name
        "momentum_filter_min": FloatRange(0.0, 0.1),
    }


def eligible_universe() -> list[str]:
    """Return the seed list with the excluded-sector names removed.

    Symbols with no entry in ``SECTOR_MAP`` are conservatively dropped
    (unknown sector → not eligible). When that happens we log a single
    WARNING so future drift between :data:`UNIVERSE_SEED` and
    :data:`SECTOR_MAP` is caught at run-time instead of being absorbed
    silently (audit P0 #8 — silent universe shrinkage).
    """

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
            len(missing),
            ",".join(sorted(set(missing))),
        )
    return out


__all__ = [
    "DEFAULTS",
    "UNIVERSE_SEED",
    "SECTOR_MAP",
    "EXCLUDED_SECTORS",
    "REBALANCE_FREQS",
    "eligible_universe",
    "search_space",
]
