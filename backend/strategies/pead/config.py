"""Parameter defaults, search space, and universe seed for PEAD.

Single source of truth for every knob the strategy exposes. Defaults track
the Bernard-Thomas 1989 canonical specification with Livnat-Mendenhall 2006
analyst-consensus SUE; search ranges stay close to the literature.

The ``PEADParams`` model is a Pydantic-v2 :class:`StrategyParams` subclass;
tunable fields declare their Optuna distribution via ``json_schema_extra``
so :meth:`StrategyParams.tune_space` auto-derives the search space.

See :mod:`backend.strategies.pead.spec` (the ``spec.md`` next to this file)
for the academic rationale for each knob.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Optional

from pydantic import Field

from strategies._core.contracts import StrategyParams


log = logging.getLogger("alphadesk.strategies.pead.config")


# Module-level flag flipped to True by :func:`load_universe` whenever the
# survivorship-biased static seed is used in place of a point-in-time loader.
# OOS reporting and the strategy runtime consult this flag so an honest
# bias-disclosure can be propagated to the artefact JSON without the caller
# having to remember to plumb the warning through manually.
UNIVERSE_HAS_SURVIVORSHIP_BIAS: bool = False


# --------------------------------------------------------------------------- #
# Params                                                                      #
# --------------------------------------------------------------------------- #
class PEADParams(StrategyParams):
    """Typed Pydantic-v2 params model for the PEAD strategy.

    Every field in this model is the single source of truth for its
    default value and (where applicable) its Optuna search range. The
    ``json_schema_extra={"tune": {...}}`` descriptors are consumed by
    :meth:`StrategyParams.tune_space` at tuner launch; fields without a
    ``tune`` descriptor are held fixed across all trials.

    Defaults match the historical ``DEFAULTS`` dict byte-for-byte so the
    parity harness in Task 16 can verify no alpha drift.
    """

    # |SUE| threshold for entry. Bernard-Thomas used 1.5-2.0 for deciles.
    sue_threshold: float = Field(
        default=1.5,
        gt=0.0,
        json_schema_extra={"tune": {"low": 1.0, "high": 3.0, "type": "float"}},
    )
    # Holding period in trading days. Canonical Bernard-Thomas = 60; we
    # default to 40 which is the Chordia-et-al post-liquidity midpoint.
    holding_days: int = Field(
        default=40,
        gt=0,
        json_schema_extra={
            "tune": {"type": "categorical", "choices": [20, 30, 40, 60]}
        },
    )
    # Trailing quarterly count for the SUE-σ denominator.
    sue_lookback_quarters: int = Field(
        default=8,
        gt=0,
        json_schema_extra={
            "tune": {"type": "categorical", "choices": [4, 8, 12]}
        },
    )
    # Max simultaneous positions (long + short combined).
    max_concurrent_positions: int = Field(
        default=10,
        gt=0,
        json_schema_extra={
            "tune": {"type": "categorical", "choices": [5, 10, 15, 20]}
        },
    )
    # Fraction of initial equity per position.
    allocation_per_position: float = Field(
        default=0.05,
        gt=0.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.03, "high": 0.10, "type": "float"}},
    )
    # Trade both directions. False = long-only.
    allow_shorts: bool = Field(
        default=True,
        json_schema_extra={
            "tune": {"type": "categorical", "choices": [True, False]}
        },
    )
    # Market-cap floor in $B (proxy via the curated universe seed list).
    universe_min_mcap_bn: int = Field(
        default=5,
        ge=0,
        json_schema_extra={
            "tune": {"type": "categorical", "choices": [2, 5, 10]}
        },
    )
    # Keep only the top-X percent of |SUE| per announcement day. 1.0 = no filter.
    sue_universe_rank_top_pct: float = Field(
        default=1.0,
        gt=0.0,
        le=1.0,
        json_schema_extra={"tune": {"low": 0.05, "high": 0.20, "type": "float"}},
    )
    # Liquidity floors — fixed, not searched.
    adv_usd_min: float = Field(default=20_000_000.0, ge=0.0)
    price_min: float = Field(default=10.0, ge=0.0)
    # Minimum trailing quarters required to compute σ (< lookback is allowed
    # but we require at least this many to generate a SUE).
    min_quarters_for_sue: int = Field(default=4, gt=0)


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
    "PEADParams",
    "UNIVERSE_SEED",
    "UNIVERSE_HAS_SURVIVORSHIP_BIAS",
    "load_universe",
]
