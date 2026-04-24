"""Time-Series Momentum (TSMOM) — unified-shell implementation.

Moskowitz-Ooi-Pedersen 2012 / Hurst-Ooi-Pedersen 2013 multi-asset TSMOM on
6-11 ETFs. See ``spec.md`` for the academic lineage.

Rule summary (preserved byte-for-byte from the legacy engine hooks):

1. On the last trading day of each (bi)month, compute sign-of-return over
   the lookback horizon(s) per asset.
2. Estimate realized vol over ``realized_vol_window`` trading days.
3. Build raw weights ``w_raw = dir * target_vol / max(sigma, vol_floor)``.
4. Normalize gross exposure to ``target_vol_gross_mul``.
5. Cap per-asset |w| at ``max_weight_per_asset`` and renormalize.
6. Halve weights if portfolio drawdown exceeds ``drawdown_delever_threshold``.

Non-rebalance bars: no-op. Moskowitz 2012 explicitly forbids intra-month
hard stops.
"""

from __future__ import annotations

import logging
import math
from datetime import date, timedelta
from typing import Any, Optional

import numpy as np
import pandas as pd

from strategies._core.contracts import (
    Fill,
    OrderType,
    Signal,
    StrategyInput,
    StrategyResult,
    TimeInForce,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import (
    TSMomentumParams,
    max_lookback_days,
    signal_lookback_days,
    universe_tickers,
)


log = logging.getLogger("alphadesk.strategies.ts_momentum")


_NS = "ts_momentum"
_REQUIRED_LOOKBACK_DAYS = 540


@register_strategy(
    StrategyMeta(
        name="ts_momentum",
        category="macro",
        description=(
            "Moskowitz-Ooi-Pedersen 2012 Time-Series Momentum on a 6-11 ETF "
            "multi-asset universe. Sign-of-12m-return signal, inverse-vol "
            "weighting, portfolio vol targeting, monthly rebalance, drawdown "
            "de-lever. Long-short enabled — crisis alpha comes from the "
            "short leg."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=3,
    )
)
class TSMomentumStrategy(Strategy):
    """Multi-asset TSMOM — see module docstring for rules."""

    PARAMS_MODEL = TSMomentumParams

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        # Universe is static per-params, but universe() runs before run()
        # and doesn't have params available. Return the union of both
        # configurable universes so the runner pre-fetches everything we
        # might need; run() filters to the active subset.
        return sorted(set(_ALL_UNIVERSE_TICKERS))

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: TSMomentumParams,
    ) -> StrategyResult:
        asof = input.asof
        state = input.state
        diagnostics: dict[str, Any] = {}
        warnings: list[str] = []
        state_update: dict[str, Any] = {}

        # Refresh peak-equity every bar so drawdown gate catches intra-month
        # highs that recover before the next rebalance (audit P0 #4).
        peak_key = f"{_NS}.peak_equity"
        peak = state.get(peak_key)
        cur_equity = float(input.equity)
        if math.isfinite(cur_equity):
            if peak is None or cur_equity > peak:
                peak = cur_equity
                state_update[peak_key] = peak

        if not _is_rebalance_day(asof, params.rebalance_freq):
            return StrategyResult(
                signals=[], state_update=state_update,
                diagnostics={"rebalance": False}, warnings=warnings,
            )

        tickers = list(universe_tickers(params))
        closes = _close_panel(input.bars, tickers, asof)
        if closes is None or closes.empty:
            warnings.append("ts_momentum: empty close panel; skipping rebalance")
            return StrategyResult(
                signals=[], state_update=state_update,
                diagnostics={"rebalance": True, "close_panel_empty": True},
                warnings=warnings,
            )

        weights = _compute_target_weights(params, closes, tickers, peak, cur_equity)
        state_update[f"{_NS}.last_weights"] = dict(weights)

        signals: list[Signal] = []

        # Exits — positions dropping to ~0 weight.
        held = {p.symbol: p for p in input.positions if p.quantity != 0}
        for sym in list(held):
            new_w = weights.get(sym, 0.0)
            if abs(new_w) < 1e-6:
                signals.append(
                    Signal(
                        symbol=sym,
                        target_weight=0.0,
                        order_type=OrderType.MOO,
                        time_in_force=TimeInForce.DAY,
                        tag="tsm-exit",
                        asof=asof,
                    )
                )

        # Entries / resizes — every non-zero weight.
        for sym, w in weights.items():
            if abs(w) < 1e-6:
                continue
            signals.append(
                Signal(
                    symbol=sym,
                    target_weight=float(w),
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag=f"tsm-entry-{'long' if w > 0 else 'short'}",
                    asof=asof,
                )
            )

        diagnostics["rebalance"] = True
        diagnostics["target_weight_count"] = len([w for w in weights.values() if abs(w) >= 1e-6])
        return StrategyResult(
            signals=signals,
            state_update=state_update,
            diagnostics=diagnostics,
            warnings=warnings,
        )


_ALL_UNIVERSE_TICKERS: tuple[str, ...] = tuple(
    sorted(set(universe_tickers(TSMomentumParams(universe_size="minimal_6"))) | set(
        universe_tickers(TSMomentumParams(universe_size="full_11"))
    ))
)


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _is_rebalance_day(asof: date, freq: str) -> bool:
    """True iff ``asof`` is the last trading day in its calendar month.

    Mon-Fri fallback since pure-function run() has no calendar provider.
    """
    probe = asof + timedelta(days=1)
    for _ in range(7):
        if probe.month != asof.month:
            break
        if probe.weekday() < 5:
            return False
        probe += timedelta(days=1)
    is_last = asof.weekday() < 5
    if freq == "bimonthly":
        return is_last and (asof.month % 2 == 1)
    return is_last


def _close_panel(
    bars: pd.DataFrame,
    tickers: list[str],
    asof: date,
) -> Optional[pd.DataFrame]:
    """Pivot ``input.bars`` into a wide (date × ticker) close panel.

    Accepts either a multi-index ``(date, symbol)`` frame (canonical runner
    shape) or a flat frame with ``symbol`` + ``ts_date`` / ``ts`` columns
    (legacy test fixture shape).
    """
    if bars is None or getattr(bars, "empty", True):
        return None

    idx_names = tuple(bars.index.names or ())
    if "symbol" in idx_names and "date" in idx_names:
        frame = bars.reset_index()
        frame = frame.rename(columns={"date": "ts"})
    else:
        frame = bars.copy()
        if "ts" not in frame.columns and "ts_date" in frame.columns:
            frame = frame.rename(columns={"ts_date": "ts"})

    if "symbol" not in frame.columns or "close" not in frame.columns or "ts" not in frame.columns:
        return None

    frame["ts"] = pd.to_datetime(frame["ts"], utc=True, errors="coerce").dt.tz_convert("UTC").dt.normalize()
    frame = frame.dropna(subset=["ts", "close"])
    frame = frame[frame["symbol"].isin(tickers)]
    if frame.empty:
        return None

    wide = (
        frame.pivot_table(index="ts", columns="symbol", values="close", aggfunc="last")
        .sort_index()
        .ffill()
    )
    wide = _drop_halted_symbols(wide)
    if wide is None or wide.empty:
        return None
    cutoff = pd.Timestamp(asof, tz="UTC")
    return wide[wide.index <= cutoff]


def _compute_signals(
    closes: pd.DataFrame,
    tickers: list[str],
    lookback_days: tuple[int, ...],
) -> dict[str, float]:
    """Average sign-of-return across ``lookback_days``."""
    out: dict[str, float] = {}
    for sym in tickers:
        if sym not in closes.columns:
            continue
        series = closes[sym].dropna()
        n = len(series)
        if n <= max(lookback_days):
            continue
        now = float(series.iloc[-1])
        if now <= 0:
            continue
        signs: list[float] = []
        for L in lookback_days:
            if n <= L:
                signs = []
                break
            then = float(series.iloc[-(L + 1)])
            if then <= 0:
                signs = []
                break
            r = now / then - 1.0
            signs.append(1.0 if r > 0 else (-1.0 if r < 0 else 0.0))
        if not signs:
            continue
        mean_sign = sum(signs) / len(signs)
        if mean_sign > 0.01:
            out[sym] = 1.0
        elif mean_sign < -0.01:
            out[sym] = -1.0
        else:
            out[sym] = 0.0
    return out


def _compute_realized_vols(
    closes: pd.DataFrame, tickers: list[str], window: int
) -> dict[str, float]:
    """Annualized realized vol over the last ``window`` trading days."""
    out: dict[str, float] = {}
    for sym in tickers:
        if sym not in closes.columns:
            continue
        series = closes[sym].dropna()
        if len(series) < window + 2:
            continue
        returns = series.pct_change().dropna()
        if len(returns) < window:
            continue
        recent = returns.iloc[-window:]
        sigma = float(recent.std(ddof=1) * (252 ** 0.5))
        if math.isfinite(sigma) and sigma >= 0:
            out[sym] = sigma
    return out


def _cap_and_renormalize(
    weights: dict[str, float],
    cap: float,
    target_gross: float,
) -> dict[str, float]:
    """Apply per-asset |w| cap and renormalize uncapped legs."""
    if target_gross <= 0 or not weights:
        return {}

    w = dict(weights)
    pinned: dict[str, float] = {}
    for _ in range(len(w) + 1):
        unpinned = {k: v for k, v in w.items() if k not in pinned}
        if not unpinned:
            break
        gross_pinned = sum(abs(v) for v in pinned.values())
        budget = max(target_gross - gross_pinned, 0.0)
        gross_unpin = sum(abs(v) for v in unpinned.values())
        if gross_unpin <= 0:
            break
        scale = budget / gross_unpin
        scaled = {k: v * scale for k, v in unpinned.items()}
        new_pins: dict[str, float] = {}
        for k, v in scaled.items():
            if abs(v) > cap + 1e-9:
                new_pins[k] = cap if v > 0 else -cap
        if not new_pins:
            return {**pinned, **scaled}
        pinned.update(new_pins)
        for k in new_pins:
            w.pop(k, None)
    return dict(pinned)


def _compute_target_weights(
    params: TSMomentumParams,
    closes: pd.DataFrame,
    tickers: list[str],
    peak_equity: Optional[float],
    cur_equity: float,
) -> dict[str, float]:
    """Signal + inverse-vol + cap + drawdown de-lever."""
    lookback = signal_lookback_days(params)
    signals = _compute_signals(closes, tickers, lookback)
    if not params.shorts_enabled:
        signals = {sym: max(s, 0.0) for sym, s in signals.items()}

    vols = _compute_realized_vols(closes, tickers, params.realized_vol_window)

    raw: dict[str, float] = {}
    for sym in tickers:
        s = signals.get(sym, 0.0)
        sigma = vols.get(sym, float("nan"))
        if s == 0.0 or not math.isfinite(sigma) or sigma <= 0:
            continue
        sigma_eff = max(sigma, params.vol_floor)
        raw[sym] = s * (params.target_vol / sigma_eff)

    if not raw:
        return {}

    gross = sum(abs(v) for v in raw.values())
    if gross <= 0:
        return {}
    scale = params.target_vol_gross_mul / gross
    weights = {sym: v * scale for sym, v in raw.items()}

    weights = _cap_and_renormalize(
        weights, params.max_weight_per_asset, params.target_vol_gross_mul
    )

    dd = 0.0
    if peak_equity and peak_equity > 0:
        dd = (peak_equity - cur_equity) / peak_equity
    if dd > params.drawdown_delever_threshold and params.drawdown_delever_threshold > 0:
        weights = {k: v * 0.5 for k, v in weights.items()}

    weights = _cap_and_renormalize(
        weights, params.max_weight_per_asset, sum(abs(v) for v in weights.values())
    )
    return weights


_TS_HALT_BARS = 5


def _drop_halted_symbols(wide: Optional[pd.DataFrame]) -> Optional[pd.DataFrame]:
    """Drop symbols with ≥5 consecutive flat closes (halted/delisted).

    Audit P0 #10 cross-cutting fix — a flat tail fools the vol denominator
    into sizing absurd positions.
    """
    if wide is None or wide.empty:
        return wide
    if len(wide.index) < _TS_HALT_BARS + 1:
        return wide
    tail = wide.tail(_TS_HALT_BARS + 1)
    flat: list[str] = []
    for col in wide.columns:
        vals = tail[col].dropna().values
        if len(vals) < _TS_HALT_BARS + 1:
            continue
        if np.all(vals == vals[0]):
            flat.append(str(col))
    if flat:
        log.warning(
            "ts_momentum: dropping %d halted symbols (>=%d flat closes): %s",
            len(flat), _TS_HALT_BARS, ",".join(sorted(flat)),
        )
        wide = wide.drop(columns=flat)
    return wide


__all__ = ["TSMomentumStrategy"]
