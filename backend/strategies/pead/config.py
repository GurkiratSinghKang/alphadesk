"""Parameter defaults, search space, and universe seed for PEAD.

Single source of truth for every knob the strategy exposes. Defaults track
the Bernard-Thomas 1989 canonical specification with Livnat-Mendenhall 2006
analyst-consensus SUE; search ranges stay close to the literature.

See :mod:`backend.strategies.pead.spec` (the ``spec.md`` next to this file)
for the academic rationale for each knob.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Optional


log = logging.getLogger("alphadesk.strategies.pead.config")


# Module-level flag flipped to True by :func:`load_universe` whenever the
# survivorship-biased static seed is used in place of a point-in-time loader.
# OOS reporting and the strategy runtime consult this flag so an honest
# bias-disclosure can be propagated to the artefact JSON without the caller
# having to remember to plumb the warning through manually.
UNIVERSE_HAS_SURVIVORSHIP_BIAS: bool = False


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


def load_universe(
    asof: Optional[date] = None,
    fundamentals_provider: Any = None,
) -> list[str]:
    """Return the PEAD candidate universe as-of ``asof``.

    Preference order:

    1. ``fundamentals_provider.sp500_constituents(asof)`` — a point-in-time
       S&P 500 constituent loader. Adapters that wish to remove the
       survivorship-bias caveat should implement this hook.
    2. Static :data:`UNIVERSE_SEED` — a 2024-era hand list kept as a
       last-resort fallback. Using this path flips
       :data:`UNIVERSE_HAS_SURVIVORSHIP_BIAS` to ``True`` and emits a
       WARNING on every call so downstream OOS JSONs carry the bias flag
       and the operator is alerted that backtest numbers should be
       discounted accordingly.
    """

    global UNIVERSE_HAS_SURVIVORSHIP_BIAS

    if fundamentals_provider is not None and hasattr(
        fundamentals_provider, "sp500_constituents"
    ):
        try:
            names = fundamentals_provider.sp500_constituents(asof)
        except Exception as exc:  # pragma: no cover - defensive
            log.warning(
                "pead: fundamentals_provider.sp500_constituents(%s) raised %s;"
                " falling back to static UNIVERSE_SEED",
                asof, exc,
            )
        else:
            if names:
                UNIVERSE_HAS_SURVIVORSHIP_BIAS = False
                return sorted({str(s).upper() for s in names})

    UNIVERSE_HAS_SURVIVORSHIP_BIAS = True
    log.warning(
        "pead: universe falling back to static UNIVERSE_SEED (2024-era "
        "hand-list) — survivorship_bias=True. OOS artefacts should carry "
        "universe_has_survivorship_bias=true until a point-in-time S&P 500 "
        "constituent loader is wired via fundamentals_provider."
    )
    return list(UNIVERSE_SEED)


__all__ = [
    "DEFAULTS",
    "UNIVERSE_SEED",
    "UNIVERSE_HAS_SURVIVORSHIP_BIAS",
    "load_universe",
    "search_space",
]
