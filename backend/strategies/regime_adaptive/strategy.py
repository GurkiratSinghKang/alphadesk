"""Regime-Adaptive asset allocation — SOTA shell.

4-regime ETF allocator with monthly rebalance. See ``spec.md`` for rules.

State (all on ``input.state``):
- ``ra_instant_regime`` — last instantaneous label
- ``ra_streak`` — consecutive days of the current label
- ``ra_confirmed_regime`` — label promoted from the streak buffer
- ``ra_current_alloc_regime`` — regime the book is currently allocated to
- ``ra_regime_history`` — per-day history for reporting
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Optional

import numpy as np
import pandas as pd

from indicators.trend import sma
from indicators.volatility import realized_vol

from strategies._core.contracts import (
    OrderType,
    Signal,
    StrategyInput,
    StrategyResult,
    TimeInForce,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import (
    REGIME_REFERENCE,
    REGIMES,
    SIGNAL_ONLY,
    UNIVERSE,
    VIX_PROXY,
    RegimeAdaptiveParams,
    allocation_for,
)


log = logging.getLogger("alphadesk.strategies.regime_adaptive")

_NS = "regime_adaptive"
_REQUIRED_LOOKBACK_DAYS = 400
_MAX_REGIME_HISTORY_DAYS = 260


@register_strategy(
    StrategyMeta(
        name="regime_adaptive",
        category="macro",
        description=(
            "Regime-aware asset allocation across 8 ETFs. Classifies the "
            "market daily into TrendUp / MeanRevert / HighVol / Crisis "
            "from SPY trend and VIX level (via VIXY proxy), requires 10 "
            "days of confirmation before switching, and rebalances on "
            "monthly cadence to a pre-defined weight vector for the regime."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=8,
    )
)
class RegimeAdaptiveStrategy(Strategy):
    """4-regime, monthly ETF allocator."""

    PARAMS_MODEL = RegimeAdaptiveParams

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return list(UNIVERSE) + list(SIGNAL_ONLY)

    # T11 reverse-lookup: tradable universe is the fixed 8-name asset bucket
    # (SPY/QQQ/EFA/IEF/TLT/GLD/BIL/VXX). VIXY is signal-only and not a
    # candidate, so it's excluded from the user-facing universe filter.
    def is_in_universe(self, symbol: str) -> bool:
        return symbol.upper() in set(UNIVERSE)

    def run(
        self,
        input: StrategyInput,
        params: RegimeAdaptiveParams,
    ) -> StrategyResult:
        asof = input.asof
        state = input.state
        diagnostics: dict[str, Any] = {"rebalance": False}
        warnings: list[str] = []
        state_update: dict[str, Any] = {}

        panel = _close_panel(input.bars, asof)
        instant = _classify_instantaneous(panel, params)
        diagnostics["instant_regime"] = instant

        # --- Advance streak + confirmed regime ------------------------ #
        prev_instant = state.get("ra_instant_regime")
        prev_streak = int(state.get("ra_streak", 0))
        prev_confirmed = state.get("ra_confirmed_regime")

        if instant is None:
            new_instant = prev_instant
            new_streak = prev_streak
            new_confirmed = prev_confirmed
        else:
            new_instant = instant
            # P1-S (consolidation §3): a 1-day instant-flip used to wipe the
            # streak back to 1, throwing away accumulated confirmation of the
            # confirmed regime. Soft-decrement instead — same-as-prev increments,
            # disagreement decrements (floored at 1). New regime confirmation
            # still requires `confirmation_days` of consecutive matching bars,
            # but a single noisy classifier read no longer wipes 10 days of
            # accumulated trust in the confirmed regime.
            if instant == prev_instant:
                new_streak = prev_streak + 1
            else:
                new_streak = max(1, prev_streak - 1)
            new_confirmed = (
                instant if new_streak >= params.confirmation_days else prev_confirmed
            )
            state_update["ra_instant_regime"] = new_instant
            state_update["ra_streak"] = new_streak
            state_update["ra_confirmed_regime"] = new_confirmed

        diagnostics["confirmed_regime"] = new_confirmed
        diagnostics["streak"] = new_streak

        # --- Per-day regime history ---------------------------------- #
        history = {
            (k.isoformat() if hasattr(k, "isoformat") else str(k)): v
            for k, v in dict(state.get("ra_regime_history", {})).items()
        }
        history[asof.isoformat()] = {
            "instant": new_instant,
            "confirmed": new_confirmed,
            "streak": new_streak,
        }
        if len(history) > _MAX_REGIME_HISTORY_DAYS:
            keep_keys = sorted(history)[-_MAX_REGIME_HISTORY_DAYS:]
            history = {key: history[key] for key in keep_keys}
        state_update["ra_regime_history"] = history

        # --- Rebalance? ---------------------------------------------- #
        if not _is_rebalance_day(asof, params.rebalance_freq):
            return StrategyResult(
                signals=[], state_update=state_update,
                diagnostics=diagnostics, warnings=warnings,
            )
        if new_confirmed is None:
            return StrategyResult(
                signals=[], state_update=state_update,
                diagnostics=diagnostics, warnings=warnings,
            )

        current_alloc = state.get("ra_current_alloc_regime")
        diagnostics["rebalance"] = True
        diagnostics["allocation_changed"] = current_alloc != new_confirmed

        target_weights = allocation_for(new_confirmed, params)
        diagnostics["target_regime"] = new_confirmed
        diagnostics["target_weight_count"] = sum(
            1 for w in target_weights.values() if w > 0.0
        )
        signals: list[Signal] = []

        # Exits: any position whose new weight is 0 (or VIXY which should
        # never carry a position even transiently).
        for pos in input.positions:
            if pos.quantity == 0:
                continue
            tw = target_weights.get(pos.symbol, 0.0)
            if pos.symbol in SIGNAL_ONLY or tw <= 0.0:
                signals.append(Signal(
                    symbol=pos.symbol,
                    target_weight=0.0,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag=f"ra-exit-{new_confirmed}",
                    asof=asof,
                ))

        # Entries: every allocation with non-zero weight.
        for sym in UNIVERSE:
            w = target_weights.get(sym, 0.0)
            if w <= 0.0:
                continue
            signals.append(Signal(
                symbol=sym,
                target_weight=float(w),
                order_type=OrderType.MOO,
                time_in_force=TimeInForce.DAY,
                tag=f"ra-entry-{new_confirmed}",
                asof=asof,
            ))

        state_update["ra_current_alloc_regime"] = new_confirmed
        return StrategyResult(
            signals=signals,
            state_update=state_update,
            diagnostics=diagnostics,
            warnings=warnings,
        )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _is_rebalance_day(asof: date, freq: str) -> bool:
    """True when ``asof`` is the last TRADING day of its month.

    Round-21 / persona-C P0 fix: the previous version used ``weekday()``
    arithmetic which silently dropped the rebalance any month whose
    final calendar day was a weekend AND whose final Friday wasn't in
    the runner's bar set (or any month with a holiday on the last
    weekday — Christmas Day, MLK Monday, etc.). Now defers to the
    real US market calendar via ``data.calendar`` so holidays /
    half-days are correctly handled.
    """
    try:
        from data.calendar import is_trading_day
    except Exception:
        # Calendar unavailable (test environment) — fall back to the
        # naive Mon-Fri heuristic. Better than crashing the runner.
        is_trading_day = lambda d: getattr(d, "weekday", lambda: 5)() < 5  # noqa: E731
    if not is_trading_day(asof):
        return False
    # Walk forward a generous window (~10 calendar days covers 4-day
    # weekends + Christmas-NYE clusters) to find the next trading day.
    probe = asof + timedelta(days=1)
    for _ in range(10):
        if is_trading_day(probe):
            # Same month → asof isn't the month's last trading day.
            if probe.month == asof.month:
                return False
            break
        probe += timedelta(days=1)
    # Either the next trading day is in a different month, OR the
    # probe window exhausted (very long holiday — month-end is the
    # safer bet). Either way, asof is the last trading day.
    return _bimonthly_gate(asof, freq)


def _bimonthly_gate(asof: date, freq: str) -> bool:
    if freq == "bimonthly":
        return asof.month % 2 == 1
    return True


def _close_panel(
    bars: pd.DataFrame,
    asof: date,
) -> Optional[pd.DataFrame]:
    """Pivot input.bars into wide (date × symbol) close panel, truncated to asof."""
    if bars is None or getattr(bars, "empty", True):
        return None
    idx_names = tuple(bars.index.names or ())
    if "symbol" in idx_names and "date" in idx_names:
        frame = bars.reset_index().drop(columns=["ts"], errors="ignore").rename(columns={"date": "ts"})
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

    # Round-6 / I-20: truncate to ``asof`` BEFORE forward-filling. Filling
    # first would have leaked future closes back into earlier bars on
    # any symbol with a stale tail, biasing the regime classifier and
    # backtest replay. The order is: pivot → sort → truncate → ffill.
    wide = (
        frame.pivot_table(index="ts", columns="symbol", values="close", aggfunc="last")
        .sort_index()
    )
    cutoff = pd.Timestamp(asof, tz="UTC")
    wide = wide[wide.index <= cutoff]
    if wide is None or wide.empty:
        return wide
    wide = wide.ffill()
    wide = _drop_halted_symbols(wide)
    return wide


def _classify_instantaneous(
    panel: Optional[pd.DataFrame],
    params: RegimeAdaptiveParams,
) -> Optional[str]:
    """Return the instantaneous regime label for the last bar of ``panel``."""
    if panel is None or panel.empty:
        return None
    min_hist = params.sma_slow + params.crisis_slow_trigger_days
    if len(panel) < min_hist:
        return None

    spy = panel.get(REGIME_REFERENCE)
    if spy is None or spy.dropna().empty:
        return None

    fast_series = sma(spy, params.sma_fast)
    slow_series = sma(spy, params.sma_slow)
    if fast_series.empty or slow_series.empty:
        return None
    fast = fast_series.iloc[-1]
    slow = slow_series.iloc[-1]
    if pd.isna(fast) or pd.isna(slow):
        return None
    spy_close = float(spy.iloc[-1])

    vix_level = _vix_level(panel, params)
    if vix_level is None:
        return None

    grind_bear = False
    if len(panel) >= params.crisis_slow_trigger_days:
        window = spy.iloc[-params.crisis_slow_trigger_days:]
        window_slow = slow_series.iloc[-params.crisis_slow_trigger_days:]
        if not window_slow.isna().any():
            grind_bear = bool((window < window_slow).all())

    # Priority: Crisis > HighVol > TrendUp > MeanRevert.
    if (vix_level > params.vix_high_threshold and spy_close < slow) or grind_bear:
        return "Crisis"
    if vix_level > params.vix_high_threshold and spy_close >= slow:
        return "HighVol"
    if spy_close > slow and fast > slow and vix_level < params.vix_low_threshold:
        return "TrendUp"
    return "MeanRevert"


def _vix_level(
    panel: pd.DataFrame,
    params: RegimeAdaptiveParams,
) -> Optional[float]:
    """Return a VIX-equivalent level. Direct VIX > I:VIX > SPY realized × 1.15."""
    for col in ("VIX", "I:VIX"):
        if col in panel.columns:
            v = panel[col].dropna()
            if len(v) > 0:
                return float(v.iloc[-1])
    spy = panel.get(REGIME_REFERENCE)
    if spy is None:
        return None
    spy = spy.dropna()
    if len(spy) < 22:
        return None
    rets = spy.pct_change().dropna()
    rv = realized_vol(rets, period=20, annualize=True).dropna()
    if rv.empty:
        return None
    return float(rv.iloc[-1]) * 115.0


_RA_HALT_BARS = 5


def _drop_halted_symbols(wide: Optional[pd.DataFrame]) -> Optional[pd.DataFrame]:
    if wide is None or wide.empty:
        return wide
    if len(wide.index) < _RA_HALT_BARS + 1:
        return wide
    tail = wide.tail(_RA_HALT_BARS + 1)
    flat: list[str] = []
    for col in wide.columns:
        vals = tail[col].dropna().values
        if len(vals) < _RA_HALT_BARS + 1:
            continue
        if np.all(vals == vals[0]):
            flat.append(str(col))
    if flat:
        log.warning(
            "regime_adaptive: dropping %d halted symbols (>=%d flat closes): %s",
            len(flat), _RA_HALT_BARS, ",".join(sorted(flat)),
        )
        wide = wide.drop(columns=flat)
    return wide


__all__ = ["RegimeAdaptiveStrategy"]
