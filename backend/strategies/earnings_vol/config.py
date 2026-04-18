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
    # v2 defaults (2026-04) — tuned against real Polygon contract bars +
    # half-spread slippage. OOS Sharpe 1.43 (2023-2024). See
    # ``audit-reports/phase1-earnings_vol.md`` for full rationale.
    #
    # Richness filter: implied move / historical median move. Stricter
    # 1.76 (vs v1's 1.2) so only the most over-priced events get traded —
    # the edge must exceed the engine's per-leg half-spread slippage.
    "implied_vs_historical_min_ratio": 1.7555,
    # Wings at ±0.81x the implied move — tighter than the textbook 1.25-2.0
    # Natenberg range. Keeping max loss per spread small lets sizing stay
    # aggressive without blowing up on the left tail.
    "wing_width_multiple": 0.8072,
    # 21 DTE (not the 7-DTE front-weekly the literature prefers) because
    # real-options mids on front-weeks are too thin to absorb half-spread
    # slippage; 3-week contracts have fatter premia that survive fills.
    "dte_target": 21,
    # Max loss per trade as fraction of equity. Defined-risk, sized up
    # because max_concurrent_positions=1 lets us concentrate into high
    # conviction events.
    "max_loss_pct_per_trade": 0.02865,
    # Exit 1h after open: captures most of the overnight IV crush but
    # allows a little post-event drift to settle (v1's "next_open" was
    # too aggressive given fill-price uncertainty).
    "exit_timing": "1h_after_open",
    # Accept both BMO/AMC earnings timings (v1's after_close_only
    # was overly restrictive given the strict richness filter already
    # rejects most candidates).
    "earnings_timing_filter": "any",
    # Low underlying price threshold — the richness filter does the
    # selection work, not a dollar-price cut.
    "min_underlying_price": 20,
    # Single concurrent position: concentrate size into one high-
    # conviction event rather than diluting across marginal ones.
    "max_concurrent_positions": 1,
    # Historical-move lookback: 8Q = typical cycle.
    "historical_moves_lookback_quarters": 8,
    # Legacy: post-event IV crush retention used by the deprecated
    # synthetic BS exit-pricing path (``_synthetic_exit_net_premium``).
    # The engine now prices each leg from Polygon contract bars so
    # this knob is no longer on the P&L path, but we keep it so the
    # strategy's init-time type coercion still finds the key.
    "iv_crush_retention": 0.55,
    # Risk-free rate for BS inversion at entry.
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

    v2 (2026-04) — widened to rescue the strategy against the new real-options
    engine path. The 0.55 IV-crush-retention factor in the synthetic ledger was
    inflating Sharpe to 6.10; with real Polygon contract_bars + half-spread
    slippage, the richness-ratio filter must be stricter (only trade the
    biggest vol overpricing) and wings can go tighter to reduce max loss.

    Items without a range are treated as fixed (not tuned).
    """

    return {
        # Stricter than v1: only trade names where implied move is
        # 1.3x–2.0x richer than historical — bigger edge absorbs the
        # real half-spread slippage.
        "implied_vs_historical_min_ratio": FloatRange(1.3, 2.0),
        # Tighter wings reduce max loss per spread; widen the lower
        # bound slightly so we can still harvest credit.
        "wing_width_multiple": FloatRange(0.8, 2.0),
        "dte_target": Categorical([7, 14, 21]),
        "max_loss_pct_per_trade": FloatRange(0.005, 0.03),
        "exit_timing": Categorical(["next_open", "next_close", "1h_after_open"]),
        "earnings_timing_filter": Categorical(["after_close_only", "any"]),
        "min_underlying_price": Categorical([20, 30, 50]),
        # Fewer concurrent positions — event-week risk cluster mitigation.
        "max_concurrent_positions": Categorical([1, 2, 3]),
        "historical_moves_lookback_quarters": Categorical([4, 8, 12]),
    }


__all__ = [
    "DEFAULTS",
    "UNIVERSE",
    "search_space",
]
