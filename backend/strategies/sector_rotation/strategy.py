"""Sector Rotation — SOTA shell.

Long-only monthly rotation across 11 GICS sector ETFs (XLK, XLV, XLF, XLY,
XLP, XLE, XLI, XLB, XLRE, XLU, XLC), ranked by a 6m + 12m composite total
return, top-N held with a SPY-based risk-off rule that flips the book to
the bond fallback (AGG by default) when SPY's intermediate-term return
is negative.

References:
- Stangl, J., Jacobsen, B., & Visaltanachoti, N. (2009). "Sector Rotation
  Across the Business Cycle." *Journal of Portfolio Management* 35(3).
- Moskowitz, T., & Grinblatt, M. (1999). "Do Industries Explain Momentum?"
  *Journal of Finance* 54(4).
- Faber, M. T. (2013). *A Quantitative Approach to Tactical Asset
  Allocation.* (Bond-fallback risk-off rule.)

Rule summary (preserved from spec):
- On the last trading session of each calendar month, compute the
  6-month + 12-month equal-weighted composite total return for each of
  the 11 sector ETFs.
- If `risk_off_enabled` and SPY's `risk_off_lookback_days` return is
  negative → hold 100% bond fallback (AGG).
- Otherwise → rank the 11 sectors, hold top_n equal-weighted at MOO.
- Between rebalance days: no-op.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Optional

import numpy as np
import pandas as pd

from strategies._core.contracts import (
    OrderType,
    Signal,
    StrategyInput,
    StrategyResult,
    TimeInForce,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import (
    SECTOR_ETFS,
    SectorRotationParams,
    composite_lookbacks,
    max_lookback,
)


log = logging.getLogger("alphadesk.strategies.sector_rotation")

_NS = "sector_rotation"
_REQUIRED_LOOKBACK_DAYS = 400  # 12-month lookback + buffer


@register_strategy(
    StrategyMeta(
        name="sector_rotation",
        category="macro",
        description=(
            "Sector rotation across 11 GICS sector ETFs (XLK/XLV/XLF/XLY/XLP/"
            "XLE/XLI/XLB/XLRE/XLU/XLC), ranked by 6m+12m composite total "
            "return, top-N held monthly with SPY-based risk-off bond fallback."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=11,
    )
)
class SectorRotationStrategy(Strategy):
    """Sector rotation — see module docstring."""

    PARAMS_MODEL = SectorRotationParams

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        """All sector ETFs + bond-fallback choices + the SPY risk-off probe."""
        syms: set[str] = set(SECTOR_ETFS)
        syms.update({"AGG", "IEF", "TLT", "BIL"})
        syms.add("SPY")
        return sorted(syms)

    # T11 reverse-lookup: the user-facing universe is the 11 GICS sector
    # SPDR ETFs only — the bond-fallback / SPY-probe symbols ride along
    # for runtime needs but they're not "we trade these" candidates that
    # belong on a symbol-page card.
    def is_in_universe(self, symbol: str) -> bool:
        return symbol.upper() in set(SECTOR_ETFS)

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: SectorRotationParams,
    ) -> StrategyResult:
        asof = input.asof
        diagnostics: dict[str, Any] = {"rebalance": False}
        warnings: list[str] = []

        if not _is_rebalance_day(asof, params.rebalance_freq):
            return StrategyResult(
                signals=[], diagnostics=diagnostics, warnings=warnings,
            )
        diagnostics["rebalance"] = True

        targets, decision = _compute_targets_with_diagnostics(
            params, input.bars, asof,
        )
        diagnostics["targets"] = targets
        diagnostics["decision"] = decision

        if not targets:
            warnings.append(
                "sector_rotation: no targets computed (insufficient data); "
                "holding existing book."
            )
            return StrategyResult(
                signals=[], diagnostics=diagnostics, warnings=warnings,
            )

        signals: list[Signal] = []
        target_set = set(targets)

        # Close anything that isn't in the new target set.
        for pos in input.positions:
            if pos.quantity == 0 or pos.symbol in target_set:
                continue
            signals.append(
                Signal(
                    symbol=pos.symbol,
                    target_weight=0.0,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag="sr-exit",
                    asof=asof,
                )
            )

        # Equal-weight entries for every target.
        weight_each = 1.0 / float(len(targets))
        for sym in targets:
            signals.append(
                Signal(
                    symbol=sym,
                    target_weight=weight_each,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag=f"sr-entry-{sym}",
                    asof=asof,
                )
            )

        return StrategyResult(
            signals=signals,
            state_update={f"{_NS}.last_targets": list(targets)},
            diagnostics=diagnostics,
            warnings=warnings,
        )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _is_rebalance_day(asof: date, freq: str) -> bool:
    """True iff ``asof`` is the last trading day in its calendar month."""
    try:
        from data.calendar import is_trading_day
    except Exception:
        is_trading_day = lambda d: getattr(d, "weekday", lambda: 5)() < 5  # noqa: E731
    if not is_trading_day(asof):
        return False
    probe = asof + timedelta(days=1)
    for _ in range(10):
        if is_trading_day(probe):
            if probe.month == asof.month:
                return False
            break
        probe += timedelta(days=1)
    if freq == "bimonthly":
        return asof.month % 2 == 1
    return True


def _close_panel(bars: pd.DataFrame, asof: date) -> Optional[pd.DataFrame]:
    """Pivot ``input.bars`` into a wide (date × ticker) close panel,
    truncated to ``asof`` to prevent right-edge look-ahead leakage."""
    if bars is None or getattr(bars, "empty", True):
        return None

    idx_names = tuple(bars.index.names or ())
    if "symbol" in idx_names and "date" in idx_names:
        frame = bars.reset_index().rename(columns={"date": "ts"})
    else:
        frame = bars.copy()
        if "ts" not in frame.columns and "ts_date" in frame.columns:
            frame = frame.rename(columns={"ts_date": "ts"})

    if "symbol" not in frame.columns or "close" not in frame.columns or "ts" not in frame.columns:
        return None

    frame["ts"] = pd.to_datetime(frame["ts"], utc=True, errors="coerce").dt.tz_convert("UTC").dt.normalize()
    frame = frame.dropna(subset=["ts", "close"])
    if frame.empty:
        return None

    wide = (
        frame.pivot_table(index="ts", columns="symbol", values="close", aggfunc="last")
        .sort_index()
    )
    cutoff = pd.Timestamp(asof, tz="UTC")
    wide = wide[wide.index <= cutoff]
    if wide is None or wide.empty:
        return None
    return wide.ffill()


def _composite_return(
    closes: pd.DataFrame,
    sym: str,
    components: tuple[tuple[int, float], ...],
) -> Optional[float]:
    """Weighted sum of n-day total returns. Returns None if any component
    is missing data (e.g., XLRE before 2015 or XLC before 2018)."""
    if sym not in closes.columns:
        return None
    s = closes[sym].dropna()
    if s.empty:
        return None
    last = s.iloc[-1]
    if not np.isfinite(last) or last <= 0:
        return None

    total = 0.0
    total_w = 0.0
    for days, weight in components:
        if len(s) <= days:
            return None
        prior = s.iloc[-1 - days]
        if not np.isfinite(prior) or prior <= 0:
            return None
        r = (last / prior) - 1.0
        total += float(r) * float(weight)
        total_w += float(weight)
    if total_w <= 0:
        return None
    return total / total_w


def _trailing_return(closes: pd.DataFrame, sym: str, days: int) -> Optional[float]:
    """Single-window trailing return for the SPY risk-off probe."""
    if sym not in closes.columns:
        return None
    s = closes[sym].dropna()
    if len(s) <= days:
        return None
    last = s.iloc[-1]
    prior = s.iloc[-1 - days]
    if not np.isfinite(last) or not np.isfinite(prior) or last <= 0 or prior <= 0:
        return None
    return float(last / prior - 1.0)


def _compute_targets_with_diagnostics(
    params: SectorRotationParams,
    bars: pd.DataFrame,
    asof: date,
) -> tuple[list[str], dict[str, Any]]:
    """Compute the rebalance targets and a structured decision record.

    Returns ``(targets, diagnostics)``. ``targets`` is a list of ETF symbols
    to hold (length 1 = bond fallback, length top_n = sector basket, length 0
    = insufficient data).
    """
    diagnostics: dict[str, Any] = {
        "panel_rows": 0,
        "panel_symbols": 0,
        "sector_scores": {},
        "missing_sectors": [],
        "risk_off_return": None,
        "risk_off_triggered": False,
        "reason": None,
    }
    closes = _close_panel(bars, asof)
    if closes is None or closes.empty:
        diagnostics["reason"] = "bars_unavailable"
        return [], diagnostics

    diagnostics["panel_rows"] = int(len(closes))
    diagnostics["panel_symbols"] = int(len(closes.columns))

    # Step 1: risk-off probe. If SPY's lookback return is negative, hold bonds.
    if params.risk_off_enabled:
        spy_r = _trailing_return(
            closes, params.risk_off_probe, params.risk_off_lookback_days
        )
        diagnostics["risk_off_return"] = spy_r
        if spy_r is None:
            # Probe data missing → fall back to bonds (defensive).
            diagnostics["reason"] = "risk_off_probe_unavailable"
            diagnostics["risk_off_triggered"] = True
            return [params.bond_fallback], diagnostics
        if spy_r < 0.0:
            diagnostics["reason"] = "risk_off_triggered"
            diagnostics["risk_off_triggered"] = True
            return [params.bond_fallback], diagnostics

    # Step 2: rank sectors by composite return.
    components = composite_lookbacks(params)
    sector_scores: dict[str, float] = {}
    for sym in SECTOR_ETFS:
        r = _composite_return(closes, sym, components)
        if r is None:
            diagnostics["missing_sectors"].append(sym)
            continue
        sector_scores[sym] = r
    diagnostics["sector_scores"] = {
        sym: float(score) for sym, score in sector_scores.items()
    }

    # Need enough sectors with valid returns to fill top_n. If we don't
    # have at least top_n viable sectors, fall back to bonds rather than
    # over-weighting a thin basket.
    if len(sector_scores) < params.top_n:
        diagnostics["reason"] = "insufficient_sector_data"
        return [params.bond_fallback], diagnostics

    # Step 3: pick top_n by composite score.
    ranked = sorted(sector_scores.items(), key=lambda kv: kv[1], reverse=True)
    targets = [sym for sym, _ in ranked[: params.top_n]]
    diagnostics["reason"] = "rotation_active"
    return targets, diagnostics
