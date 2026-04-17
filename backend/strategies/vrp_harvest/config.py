"""Parameter defaults + Optuna search space for the VRP Harvest strategy.

Kept as a module so tuning metadata and default values stay in one place
and can be imported by notebooks / reports without pulling in the
engine-heavy :mod:`.strategy` module.

See :mod:`backend.strategies.vrp_harvest.spec` (the ``spec.md`` next to
this file) for the academic rationale for each knob.
"""

from __future__ import annotations

from typing import Any

from backend.tuner.search import Categorical, FloatRange, IntRange


# --------------------------------------------------------------------------- #
# Defaults                                                                    #
# --------------------------------------------------------------------------- #
DEFAULTS: dict[str, Any] = {
    # Underlying
    "underlying": "SPY",
    # --- Signal gates --------------------------------------------------- #
    # VRP gate — IV_30 - HV_20 must exceed this before we sell premium.
    "vrp_entry_threshold": 0.02,
    # Absolute IV floor — don't sell vol when IV is crushed.
    "min_iv_30": 0.08,
    # Term-structure gate on/off. When True, refuse to sell premium if the
    # front > back IV (backwardation).
    "term_structure_gate": True,
    # --- Position definition -------------------------------------------- #
    # Target |delta| for each short leg (strangle).
    "strangle_delta": 0.16,
    # Target days to expiry for new positions (chain match closest to this).
    "target_dte": 30,
    # --- Sizing --------------------------------------------------------- #
    # Daily-theta target expressed as a fraction of portfolio equity.
    "theta_target_pct": 0.003,
    # Hard cap on # of spreads per single entry (safety rail).
    "max_spreads_per_entry": 20,
    # --- Exits ---------------------------------------------------------- #
    # Close at this fraction of max profit (credit received).
    "tp_pct": 0.50,
    # Close at this multiple of credit on the loss side.
    "sl_pct": 2.0,
    # Force-close at this DTE regardless of P&L.
    "exit_dte": 21,
    # --- Crisis overrides ------------------------------------------------ #
    # Flat book immediately when IV_30 (or VIX proxy) crosses this level.
    "vix_kill_switch": 0.35,
    # --- Tail hedge ----------------------------------------------------- #
    # 0 = no hedge. Otherwise: 1 long put per N strangles.
    "tail_hedge_ratio": 5,
    # Target delta of the tail-hedge put leg.
    "tail_hedge_delta": 0.05,
    # --- Cadence -------------------------------------------------------- #
    # Minimum trading days between entries (avoids over-trading weekly).
    "entry_cooldown_days": 3,
    # --- BS model inputs ------------------------------------------------ #
    # Risk-free rate (continuously compounded). Moderate over 2022-2024.
    "risk_free_rate": 0.045,
    # SPY dividend yield (continuous).
    "dividend_yield": 0.013,
    # --- HV lookback ---------------------------------------------------- #
    "hv_period": 20,
}


# --------------------------------------------------------------------------- #
# Universe — underlying is static                                             #
# --------------------------------------------------------------------------- #
UNDERLYING: str = "SPY"


# --------------------------------------------------------------------------- #
# Search space (for Optuna)                                                   #
# --------------------------------------------------------------------------- #
def search_space() -> dict[str, Any]:
    """Optuna search space. Matches the ranges in the design spec §3."""

    return {
        "vrp_entry_threshold": FloatRange(0.005, 0.05),
        "strangle_delta": Categorical([0.10, 0.16, 0.25]),
        "target_dte": Categorical([30, 45, 60]),
        "theta_target_pct": FloatRange(0.001, 0.01),
        "tp_pct": FloatRange(0.3, 0.7),
        "sl_pct": FloatRange(1.5, 3.0),
        "exit_dte": Categorical([14, 21, 30]),
        "vix_kill_switch": FloatRange(0.25, 0.40),
        "tail_hedge_ratio": Categorical([0, 5, 10]),
        "tail_hedge_delta": Categorical([0.03, 0.05, 0.10]),
        "term_structure_gate": Categorical([True, False]),
    }


__all__ = [
    "DEFAULTS",
    "UNDERLYING",
    "search_space",
]
