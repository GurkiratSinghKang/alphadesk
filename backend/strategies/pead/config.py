"""Parameter defaults, search space, and universe seed for PEAD.

Single source of truth for every knob the strategy exposes. Defaults track
the Bernard-Thomas 1989 canonical specification with Livnat-Mendenhall 2006
analyst-consensus SUE; search ranges stay close to the literature.

See :mod:`backend.strategies.pead.spec` (the ``spec.md`` next to this file)
for the academic rationale for each knob.
"""

from __future__ import annotations

from typing import Any


# --------------------------------------------------------------------------- #
# Defaults                                                                    #
# --------------------------------------------------------------------------- #
DEFAULTS: dict[str, Any] = {
    # |SUE| threshold for entry. Bernard-Thomas used 1.5-2.0 for deciles.
    "sue_threshold": 1.5,
    # Holding period in trading days. Canonical Bernard-Thomas = 60; we
    # default to 40 which is the Chordia-et-al post-liquidity midpoint.
    "holding_days": 40,
    # Trailing quarterly count for the SUE-σ denominator.
    "sue_lookback_quarters": 8,
    # Max simultaneous positions (long + short combined).
    "max_concurrent_positions": 10,
    # Fraction of initial equity per position.
    "allocation_per_position": 0.05,
    # Trade both directions. False = long-only.
    "allow_shorts": True,
    # Market-cap floor in $B (proxy via the curated universe seed list).
    "universe_min_mcap_bn": 5,
    # Keep only the top-X percent of |SUE| per announcement day. 1.0 = no filter.
    "sue_universe_rank_top_pct": 1.0,
    # Liquidity floors — fixed, not searched.
    "adv_usd_min": 20_000_000.0,
    "price_min": 10.0,
    # Minimum trailing quarters required to compute σ (< lookback is allowed
    # but we require at least this many to generate a SUE).
    "min_quarters_for_sue": 4,
}


# --------------------------------------------------------------------------- #
# Universe                                                                    #
# --------------------------------------------------------------------------- #
# Curated ~200-name S&P 500 subset spanning all 11 GICS sectors. This is
# the candidate pool *before* daily liquidity / mcap / overlap filtering.
# S&P 500 membership is stable enough over 2019-2024 that a fixed list
# captures >95% of the tradable PEAD opportunity. A dynamic-constituent
# loader is deferred to Phase 2.
UNIVERSE_SEED: tuple[str, ...] = (
    # Mega-cap tech
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA",
    "AVGO", "ORCL", "CRM", "ADBE", "AMD", "INTC", "CSCO", "QCOM",
    "TXN", "IBM", "NFLX", "PYPL", "ACN", "NOW", "INTU", "IBM",
    "AMAT", "MU", "LRCX", "KLAC", "SNPS", "CDNS", "MRVL", "ADI",
    "ANET", "PANW", "CRWD", "FTNT", "WDAY", "DDOG", "SNOW",
    # Communication services
    "CMCSA", "DIS", "VZ", "T", "TMUS", "CHTR",
    # Consumer discretionary
    "HD", "LOW", "MCD", "SBUX", "NKE", "TGT", "TJX", "BKNG",
    "AMZN", "LULU", "YUM", "ROST", "ORLY", "AZO", "DRI", "CMG",
    "HLT", "MAR", "F", "GM",
    # Consumer staples
    "WMT", "COST", "KO", "PEP", "PG", "CL", "MDLZ", "PM",
    "MO", "STZ", "KR", "SYY", "GIS", "KMB", "HSY",
    # Healthcare
    "UNH", "JNJ", "PFE", "MRK", "ABBV", "LLY", "TMO", "ABT",
    "AMGN", "BMY", "CVS", "ELV", "DHR", "GILD", "CI", "MDT",
    "BSX", "ISRG", "SYK", "VRTX", "REGN", "HCA", "ZTS", "HUM",
    # Financials
    "JPM", "BAC", "WFC", "GS", "MS", "C", "BLK", "SCHW", "AXP",
    "V", "MA", "SPGI", "MMC", "ICE", "CME", "AON", "PNC", "USB",
    "TFC", "COF", "ALL", "PGR", "MET", "PRU", "TRV", "AIG",
    # Industrials
    "CAT", "BA", "HON", "UPS", "DE", "GE", "LMT", "RTX",
    "UNP", "NOC", "GD", "ETN", "EMR", "ITW", "CSX", "NSC",
    "FDX", "MMM", "PH", "WM", "RSG",
    # Energy
    "XOM", "CVX", "COP", "OXY", "SLB", "EOG", "PSX", "VLO",
    "MPC", "HES", "FANG", "DVN", "KMI", "BKR",
    # Materials
    "LIN", "APD", "SHW", "FCX", "NUE", "DOW", "DD", "ECL",
    "CTVA", "VMC", "MLM",
    # Utilities
    "NEE", "DUK", "SO", "AEP", "SRE", "EXC", "XEL", "PEG",
    "ED", "WEC", "ES",
    # Real estate (REITs)
    "PLD", "AMT", "CCI", "EQIX", "PSA", "SPG", "O", "WELL",
    "DLR", "SBAC",
)

# Deduplicate preserving order. AMZN appears twice on purpose to cover both
# its taxonomies; we filter duplicates here so the universe has unique names.
UNIVERSE_SEED = tuple(dict.fromkeys(UNIVERSE_SEED))


# --------------------------------------------------------------------------- #
# Search space                                                                #
# --------------------------------------------------------------------------- #
def search_space() -> dict[str, Any]:
    """Optuna search space. Matches the Wave D brief."""

    # Deferred import so this module is importable without optuna.
    from tuner.search import Categorical, FloatRange

    return {
        "sue_threshold": FloatRange(1.0, 3.0),
        "holding_days": Categorical([20, 30, 40, 60]),
        "sue_lookback_quarters": Categorical([4, 8, 12]),
        "max_concurrent_positions": Categorical([5, 10, 15, 20]),
        "allocation_per_position": FloatRange(0.03, 0.10),
        "allow_shorts": Categorical([True, False]),
        "universe_min_mcap_bn": Categorical([2, 5, 10]),
        "sue_universe_rank_top_pct": FloatRange(0.05, 0.20),
    }


__all__ = [
    "DEFAULTS",
    "UNIVERSE_SEED",
    "search_space",
]
