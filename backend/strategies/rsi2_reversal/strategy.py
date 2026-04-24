"""RSI(2) Mean-Reversion — SOTA shell.

Conservative large-cap + liquid-ETF implementation of the Connors / Alvarez
RSI(2) system. See ``spec.md`` for rules and academic references.

Key behaviors preserved from legacy hooks:
- 200-day SMA trend filter, ConnorsRSI OR-gate, SPY RSI(2) regime floor,
  volume surge confirmation, earnings skip, explicit RSI/SMA/swing/time exits.
- Per-symbol entry metadata in state (stop_price, queued_on) survives across
  bars via ``StrategyResult.state_update``.
"""

from __future__ import annotations

import logging
import math
from datetime import date
from decimal import Decimal
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

from .config import CORE_ETFS, LARGE_CAP_SEED, RSI2Params
from .helpers import (
    adv_dollar_mean,
    flat_bars,
    has_upcoming_earnings,
    indicators_for,
    rsi_of_series,
    symbol_history,
    trading_days_between,
)


log = logging.getLogger("alphadesk.strategies.rsi2_reversal")

_NS = "rsi2_reversal"
_REQUIRED_LOOKBACK_DAYS = 380
_MIN_TRADING_BARS = 250
_VOL_MIN = 1.0
_SPY = "SPY"


@register_strategy(
    StrategyMeta(
        name="rsi2_reversal",
        category="equity",
        description=(
            "Connors-style RSI(2) mean reversion on SPY/QQQ/IWM + liquid S&P-500 "
            "mega-caps. 200-SMA trend filter, ConnorsRSI OR-gate, SPY RSI(2) "
            "regime floor, volume confirmation, earnings skip, explicit "
            "RSI/SMA/swing/time exits."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=1,
    )
)
class RSI2ReversalStrategy(Strategy):
    """Long-only mean-reversion on oversold large-caps in a long-term uptrend."""

    PARAMS_MODEL = RSI2Params

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        cached = state.get(f"{_NS}.universe")
        if cached is None:
            cached = list(dict.fromkeys([*CORE_ETFS, *LARGE_CAP_SEED]))
        syms = set(cached)
        syms.add(_SPY)
        held = state.get(f"{_NS}.held_symbols") or []
        syms.update(held)
        return sorted(syms)

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: RSI2Params,
    ) -> StrategyResult:
        asof = input.asof
        state = input.state
        diagnostics: dict[str, Any] = {}
        warnings: list[str] = []
        state_update: dict[str, Any] = {}

        flat = flat_bars(input.bars)
        if flat is None:
            return StrategyResult(
                signals=[], diagnostics={"bars_empty": True}, warnings=warnings,
            )

        # Build the eligible universe once, cache it in state.
        universe_list = state.get(f"{_NS}.universe")
        if universe_list is None:
            universe_list = _build_universe(flat, params)
            state_update[f"{_NS}.universe"] = universe_list

        entries_state: dict[str, dict[str, Any]] = dict(
            state.get(f"{_NS}.entries", {})
        )
        held_symbols: set[str] = set(state.get(f"{_NS}.held_symbols") or set())

        signals: list[Signal] = []

        # ---------------- Exits (same bar as entries) ---------------- #
        signals.extend(
            _compute_exits(flat, input.positions, entries_state, params, asof)
        )
        exit_syms = {sig.symbol for sig in signals}

        # ---------------- Entries ---------------- #
        # Systemic regime gate on SPY.
        spy_hist = symbol_history(flat, _SPY, asof)
        spy_rsi = rsi_of_series(spy_hist["close"], params.rsi_period) if spy_hist is not None else None
        regime_open = (
            spy_rsi is not None
            and math.isfinite(spy_rsi)
            and spy_rsi > params.spy_rsi_regime_floor
        )
        diagnostics["spy_rsi"] = spy_rsi
        diagnostics["regime_open"] = regime_open

        held_active = [p for p in input.positions if p.quantity > 0 and p.symbol not in exit_syms]
        capacity = params.max_positions - len(held_active)
        diagnostics["capacity"] = capacity

        if regime_open and capacity > 0:
            held_active_syms = {p.symbol for p in held_active}
            candidates: list[tuple[float, str, float, float, float]] = []
            for sym in universe_list:
                if sym in held_active_syms:
                    continue
                result = _evaluate_entry(flat, input.earnings, sym, asof, params)
                if result is None:
                    continue
                crsi_val, close_px, stop_px, sma_exit_px = result
                candidates.append((crsi_val, sym, close_px, stop_px, sma_exit_px))
            candidates.sort(key=lambda row: row[0])

            for crsi_val, sym, close_px, stop_px, sma_exit_px in candidates[:capacity]:
                tp_px = max(sma_exit_px, close_px * 1.01)
                signals.append(
                    Signal(
                        symbol=sym,
                        target_weight=params.allocation_per_trade,
                        stop_price=stop_px,
                        order_type=OrderType.MOO,
                        time_in_force=TimeInForce.DAY,
                        tag=f"rsi2-entry-tp{tp_px:.4f}",
                        asof=asof,
                    )
                )
                entries_state[sym] = {
                    "queued_on": asof,
                    "stop_price": stop_px,
                    "entry_close_est": close_px,
                    "take_profit": tp_px,
                }
                held_symbols.add(sym)
            diagnostics["entries_emitted"] = min(capacity, len(candidates))

        state_update[f"{_NS}.entries"] = entries_state
        state_update[f"{_NS}.held_symbols"] = held_symbols - exit_syms
        return StrategyResult(
            signals=signals,
            state_update=state_update,
            diagnostics=diagnostics,
            warnings=warnings,
        )

    def on_fill(self, fill: Fill, state: dict[str, Any]) -> dict[str, Any]:
        entries = dict(state.get(f"{_NS}.entries", {}))
        held_symbols = set(state.get(f"{_NS}.held_symbols") or set())

        sym = fill.symbol
        is_close = fill.quantity < 0 or (fill.signal_tag or "").startswith("rsi2-exit")
        if is_close:
            entries.pop(sym, None)
            held_symbols.discard(sym)
        else:
            meta = entries.setdefault(sym, {})
            meta["filled_on"] = fill.asof
            meta["entry_price"] = float(fill.price)
            held_symbols.add(sym)

        return {
            f"{_NS}.entries": entries,
            f"{_NS}.held_symbols": held_symbols,
        }


# --------------------------------------------------------------------------- #
# Universe building                                                           #
# --------------------------------------------------------------------------- #
def _build_universe(flat: pd.DataFrame, params: RSI2Params) -> list[str]:
    """Screen the seed list by 90-day dollar ADV >= params.adv_usd_min."""
    seed = list(dict.fromkeys([*CORE_ETFS, *LARGE_CAP_SEED]))
    survivors = list(CORE_ETFS)
    for sym in seed:
        if sym in CORE_ETFS:
            continue
        sub = flat[flat["symbol"] == sym]
        if sub.empty or len(sub) < 30:
            continue
        adv = adv_dollar_mean(sub, 90)
        if adv is not None and adv >= params.adv_usd_min:
            survivors.append(sym)
    seen: set[str] = set()
    out: list[str] = []
    for s in survivors:
        if s not in seen:
            out.append(s)
            seen.add(s)
    return out


# --------------------------------------------------------------------------- #
# Entry evaluation                                                            #
# --------------------------------------------------------------------------- #
def _evaluate_entry(
    flat: pd.DataFrame,
    earnings: Optional[pd.DataFrame],
    sym: str,
    asof: date,
    params: RSI2Params,
) -> Optional[tuple[float, float, float, float]]:
    """Return (crsi, close, stop_price, sma_exit_price) if eligible."""
    bars = symbol_history(flat, sym, asof)
    if bars is None or len(bars) < _MIN_TRADING_BARS:
        return None

    ind = indicators_for(bars, params)
    if ind is None:
        return None

    last_idx = len(bars) - 1
    close_px = float(bars["close"].iloc[-1])

    sma_trend_v = ind["sma_trend"][last_idx]
    if not np.isfinite(sma_trend_v) or close_px <= sma_trend_v:
        return None

    rsi_v = ind["rsi"][last_idx]
    crsi_v = ind["crsi"][last_idx]
    if not np.isfinite(rsi_v) or not np.isfinite(crsi_v):
        return None
    if not (rsi_v < params.rsi_entry_max or crsi_v < params.connors_entry_max):
        return None

    vols = bars["volume"].astype(float).to_numpy()
    if len(vols) < 22:
        return None
    avg_vol = float(vols[-21:-1].mean())
    if avg_vol < _VOL_MIN:
        return None
    if float(vols[-1]) < params.volume_surge_min * avg_vol:
        return None

    if params.earnings_skip_days > 0 and has_upcoming_earnings(
        earnings, sym, asof, params.earnings_skip_days
    ):
        return None

    lookback = params.stop_lookback_bars
    lows = bars["low"].astype(float).to_numpy()
    if len(lows) < lookback + 1:
        return None
    stop_px = float(lows[-lookback:].min())
    sma_exit_v = ind["sma_exit"][last_idx]
    if not np.isfinite(sma_exit_v):
        return None
    return (float(crsi_v), close_px, stop_px, float(sma_exit_v))


# --------------------------------------------------------------------------- #
# Exits                                                                       #
# --------------------------------------------------------------------------- #
def _compute_exits(
    flat: pd.DataFrame,
    positions: list,
    entries_state: dict[str, dict[str, Any]],
    params: RSI2Params,
    asof: date,
) -> list[Signal]:
    """Emit MOC exits for held positions whose exit criteria have fired."""
    out: list[Signal] = []
    for pos in positions:
        if pos.quantity <= 0:
            continue
        sym = pos.symbol
        bars = symbol_history(flat, sym, asof)
        if bars is None or bars.empty:
            continue
        closes = bars["close"].astype(float)
        if len(closes) < max(params.rsi_period + 1, params.exit_sma_period):
            continue

        close_px = float(closes.iloc[-1])
        ind = indicators_for(bars, params)
        if ind is None:
            continue
        last_idx = len(bars) - 1

        rsi_last = float(ind["rsi"][last_idx])
        if not np.isfinite(rsi_last):
            rsi_last = None
        sma_last = float(ind["sma_exit"][last_idx])
        if not np.isfinite(sma_last):
            sma_last = None

        opened = pos.entry_date
        meta = entries_state.get(sym) or {}
        if opened is None and meta.get("queued_on"):
            opened = meta["queued_on"]
        held_days = trading_days_between(opened, asof)

        stop_px = meta.get("stop_price")
        if stop_px is None:
            # Fall back to derived stop from recent lows.
            lows = bars["low"].astype(float).to_numpy()
            if len(lows) >= params.stop_lookback_bars:
                stop_px = float(lows[-params.stop_lookback_bars:].min())

        exit_reason: Optional[str] = None
        if rsi_last is not None and rsi_last > params.rsi_exit_min:
            exit_reason = "rsi-profit-take"
        elif sma_last is not None and close_px > sma_last:
            exit_reason = "sma-cross"
        elif stop_px is not None and close_px <= stop_px:
            exit_reason = "swing-stop"
        elif held_days >= params.time_stop_days:
            exit_reason = "time-stop"
        if exit_reason is None:
            continue

        out.append(
            Signal(
                symbol=sym,
                target_weight=0.0,
                order_type=OrderType.MOC,
                time_in_force=TimeInForce.DAY,
                tag=f"rsi2-exit-{exit_reason}",
                asof=asof,
            )
        )
    return out


__all__ = ["RSI2ReversalStrategy"]
