"""Parameter defaults + Optuna search space for the Earnings Volatility
short-iron-butterfly strategy.

Kept as a module so tuning metadata and default values stay in one place and
can be imported by notebooks / reports without pulling in the engine-heavy
:mod:`.strategy` module.

See :mod:`backend.strategies.earnings_vol.spec` (``spec.md`` next to this
file) for the academic rationale for each knob.
"""

from __future__ import annotations

from typing import Any

from backend.tuner.search import Categorical, FloatRange, IntRange


# --------------------------------------------------------------------------- #
# Defaults                                                                    #
# --------------------------------------------------------------------------- #
DEFAULTS: dict[str, Any] = {
    # Richness filter: implied move / historical median move.
    # 1.2 follows Dubinsky et al. (2019); below ~1.1 the edge is too
    # small to survive slippage.
    "implied_vs_historical_min_ratio": 1.2,
    # Wings at ±N × implied move. Natenberg ch. 19: 1.25-2.0 range.
    "wing_width_multiple": 1.5,
    # Target days to expiration. 7 = front-week; lets vega crush
    # dominate over theta and residual gamma.
    "dte_target": 7,
    # Max loss per trade as fraction of equity. Defined-risk.
    "max_loss_pct_per_trade": 0.02,
    # Exit timing: next_open (pure crush), 1h_after_open (some drift),
    # next_close (hold full session, sacrifices edge).
    "exit_timing": "next_open",
    # after_close_only (strict) or any (accept BMO / AMC).
    "earnings_timing_filter": "after_close_only",
    # Filter low-priced names with chunky percentage moves.
    "min_underlying_price": 30,
    # Cluster-risk cap during earnings weeks.
    "max_concurrent_positions": 5,
    # Historical-move lookback: 8Q = typical cycle.
    "historical_moves_lookback_quarters": 8,
    # Market micro-structure: post-event IV crush used by the synthetic
    # overnight P&L model (fraction of pre-event IV retained after open).
    # 0.55 = a 45% drop, a commonly-cited empirical crush number.
    "iv_crush_retention": 0.55,
    # Risk-free rate used by BS synthetic pricing (annualised, continuous).
    "risk_free_rate": 0.04,
    # Minimum historical events required to compute the ratio.
    "min_historical_events": 4,
}


# --------------------------------------------------------------------------- #
# Fixed universe — 30 names with liquid weekly options                        #
# --------------------------------------------------------------------------- #
# Constrained to keep Polygon bandwidth + cache foot-print tractable. These
# are the names where an event-premium trade has visible size capacity.
UNIVERSE: tuple[str, ...] = (
    # Mega-cap tech (most-optioned single names in the market)
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AMD",
    "NFLX", "CRM", "ORCL", "ADBE", "INTC", "QCOM", "AVGO",
    # Semis / hardware
    "MU", "AMAT", "LRCX",
    # Financials
    "JPM", "BAC", "GS", "MS", "WFC",
    # Energy
    "XOM", "CVX",
    # Healthcare
    "UNH", "LLY", "PFE",
    # Consumer / auto / ride-hail
    "UBER",
)


# --------------------------------------------------------------------------- #
# Search space (for Optuna)                                                   #
# --------------------------------------------------------------------------- #
def search_space() -> dict[str, Any]:
    """Optuna search space.

    Matches the ranges in the design spec. Items without a range are
    treated as fixed (not tuned).
    """

    return {
        "implied_vs_historical_min_ratio": FloatRange(1.0, 1.5),
        "wing_width_multiple": FloatRange(1.0, 2.5),
        "dte_target": Categorical([7, 14, 21]),
        "max_loss_pct_per_trade": FloatRange(0.005, 0.03),
        "exit_timing": Categorical(["next_open", "next_close", "1h_after_open"]),
        "earnings_timing_filter": Categorical(["after_close_only", "any"]),
        "min_underlying_price": Categorical([20, 30, 50]),
        "max_concurrent_positions": Categorical([3, 5, 10]),
        "historical_moves_lookback_quarters": Categorical([4, 8, 12]),
    }


__all__ = [
    "DEFAULTS",
    "UNIVERSE",
    "search_space",
]
