"""KAMA Breakout — SOTA shell.

Kaufman adaptive MA + Donchian breakout + ER gate + 200-SMA filter.
See ``spec.md`` for the academic spec.

Registered with ``meta.paper_only=True``: the strategy backtests + paper-
trades normally, but the DailyPipelineRunner blocks live-mode emission
until OOS track record is established.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

import numpy as np
import pandas as pd

from indicators.trend import donchian, kama, sma
from indicators.volatility import atr

from strategies._core.contracts import (
    Fill,
    OrderType,
    Signal,
    StrategyInput,
    StrategyResult,
    TimeInForce,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import DEFAULT_UNIVERSE, KamaBreakoutParams


log = logging.getLogger("alphadesk.strategies.kama_breakout")

_NS = "kama_breakout"
_REQUIRED_LOOKBACK_DAYS = 260


@dataclass
class PosState:
    """State per open position. Serialisable via dict-like conversion."""
    entry_date: Optional[date] = None
    entry_price: float = 0.0
    atr_at_entry: float = 0.0
    highest_high: float = 0.0
    pyramid_count: int = 0
    shares_initial: int = 0


@register_strategy(
    StrategyMeta(
        name="kama_breakout",
        category="equity",
        paper_only=True,  # audit: OOS track record not yet established
        description=(
            "Kaufman adaptive MA + Donchian 20 breakout, gated by Efficiency "
            "Ratio and 200-SMA trend filter. Chandelier trailing stop, "
            "volatility-parity sizing, 1/2 size pyramid at +1 ATR."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=1,
    )
)
class KamaBreakoutStrategy(Strategy):
    """Long-only adaptive-MA trend-following strategy."""

    PARAMS_MODEL = KamaBreakoutParams

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return list(DEFAULT_UNIVERSE)

    def run(
        self,
        input: StrategyInput,
        params: KamaBreakoutParams,
    ) -> StrategyResult:
        asof = input.asof
        state = input.state
        diagnostics: dict[str, Any] = {}
        warnings: list[str] = []
        state_update: dict[str, Any] = {}

        positions_state: dict[str, dict] = dict(state.get(f"{_NS}.positions", {}))

        signals: list[Signal] = []

        # --- Exits (chandelier + KAMA crossunder) --------------------- #
        closed_syms: set[str] = set()
        for pos in input.positions:
            if pos.quantity <= 0:
                continue
            sym = pos.symbol
            st_dict = positions_state.get(sym)
            if st_dict is None:
                st = PosState(
                    entry_date=pos.entry_date,
                    entry_price=float(pos.avg_entry_price),
                    atr_at_entry=0.0,
                    highest_high=float(pos.avg_entry_price),
                    shares_initial=int(pos.quantity),
                )
            else:
                st = PosState(**st_dict)

            hist = _symbol_history(input.bars, sym, asof)
            if hist is None or len(hist) < params.trend_sma_period + 15:
                positions_state[sym] = _pos_state_to_dict(st)
                continue

            close = float(hist["close"].iloc[-1])
            high = float(hist["high"].iloc[-1])
            if high > st.highest_high:
                st.highest_high = high

            kama_series = kama(
                hist["close"],
                er_period=params.kama_er_period,
                fast=params.kama_fast,
                slow=params.kama_slow,
            )
            kama_last = float(kama_series.iloc[-1]) if not pd.isna(kama_series.iloc[-1]) else None
            atr_series = atr(hist["high"], hist["low"], hist["close"], period=params.atr_period)
            atr_last = float(atr_series.iloc[-1]) if not pd.isna(atr_series.iloc[-1]) else None

            # 1. Chandelier trailing stop.
            if atr_last and atr_last > 0:
                chandelier_stop = st.highest_high - params.chandelier_atr_mult * atr_last
                if close <= chandelier_stop:
                    signals.append(Signal(
                        symbol=sym, target_weight=0.0,
                        order_type=OrderType.MOO,
                        time_in_force=TimeInForce.DAY,
                        tag="kama-exit-chandelier", asof=asof,
                    ))
                    closed_syms.add(sym)
                    positions_state.pop(sym, None)
                    continue

            # 2. KAMA crossunder.
            if kama_last is not None and close < kama_last:
                signals.append(Signal(
                    symbol=sym, target_weight=0.0,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag="kama-exit-crossunder", asof=asof,
                ))
                closed_syms.add(sym)
                positions_state.pop(sym, None)
                continue

            positions_state[sym] = _pos_state_to_dict(st)

        # --- Entries --------------------------------------------------- #
        open_positions = [p for p in input.positions if p.quantity > 0 and p.symbol not in closed_syms]
        n_open = len(open_positions)

        if n_open < params.max_positions:
            open_symbols = {p.symbol for p in open_positions}
            candidates: list[tuple[str, float, int, float]] = []  # (sym, er, shares, atr)
            for sym in DEFAULT_UNIVERSE:
                if sym in open_symbols:
                    continue
                evaluation = _evaluate_entry(
                    input.bars, input.earnings, sym, asof, params, float(input.equity),
                )
                if evaluation is not None:
                    candidates.append(evaluation)

            candidates.sort(key=lambda t: t[1], reverse=True)
            slots = params.max_positions - n_open
            for sym, er, shares, atr_val in candidates[:slots]:
                signals.append(Signal(
                    symbol=sym, quantity=shares,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag=f"kama-entry er={er:.2f}", asof=asof,
                ))
                # Record atr-at-entry so pyramid logic can use it later.
                positions_state[sym] = _pos_state_to_dict(PosState(
                    entry_date=asof,
                    entry_price=0.0,  # populated by on_fill
                    atr_at_entry=atr_val,
                    highest_high=0.0,
                    shares_initial=shares,
                    pyramid_count=0,
                ))
            diagnostics["entries_emitted"] = len(candidates[:slots])

        state_update[f"{_NS}.positions"] = positions_state

        return StrategyResult(
            signals=signals,
            state_update=state_update,
            diagnostics=diagnostics,
            warnings=warnings,
        )

    def on_fill(self, fill: Fill, state: dict[str, Any]) -> dict[str, Any]:
        positions = dict(state.get(f"{_NS}.positions", {}))
        sym = fill.symbol
        st_dict = positions.get(sym)
        if st_dict is None:
            # Closing fill on a position we never recorded — no-op.
            return {f"{_NS}.positions": positions}

        if fill.quantity < 0 or (fill.signal_tag or "").startswith("kama-exit"):
            positions.pop(sym, None)
        else:
            # Entry fill: stamp the real entry price and seed highest_high.
            st_dict["entry_price"] = float(fill.price)
            if st_dict.get("highest_high", 0.0) <= 0:
                st_dict["highest_high"] = float(fill.price)
            positions[sym] = st_dict

        return {f"{_NS}.positions": positions}


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _pos_state_to_dict(st: PosState) -> dict:
    return {
        "entry_date": st.entry_date,
        "entry_price": st.entry_price,
        "atr_at_entry": st.atr_at_entry,
        "highest_high": st.highest_high,
        "pyramid_count": st.pyramid_count,
        "shares_initial": st.shares_initial,
    }


def _symbol_history(
    bars: pd.DataFrame,
    sym: str,
    asof: date,
) -> Optional[pd.DataFrame]:
    """Return per-symbol OHLCV history up to ``asof``."""
    if bars is None or getattr(bars, "empty", True):
        return None

    idx_names = tuple(bars.index.names or ())
    if "symbol" in idx_names and "date" in idx_names:
        try:
            sub = bars.xs(sym, level="symbol")
        except KeyError:
            return None
        sub = sub.reset_index().rename(columns={"date": "ts"})
    else:
        frame = bars.copy()
        if "ts" not in frame.columns and "ts_date" in frame.columns:
            frame = frame.rename(columns={"ts_date": "ts"})
        if "symbol" not in frame.columns:
            return None
        sub = frame[frame["symbol"].astype(str).str.upper() == sym.upper()]
        if sub.empty:
            return None

    required = {"open", "high", "low", "close", "volume", "ts"}
    if not required.issubset(set(sub.columns)):
        return None

    sub["ts"] = pd.to_datetime(sub["ts"], errors="coerce")
    sub = sub.dropna(subset=["ts", "close"]).sort_values("ts").reset_index(drop=True)
    cutoff = pd.Timestamp(asof)
    sub = sub[pd.to_datetime(sub["ts"]).dt.date <= asof]
    return sub if not sub.empty else None


def _evaluate_entry(
    bars: pd.DataFrame,
    earnings: Optional[pd.DataFrame],
    sym: str,
    asof: date,
    params: KamaBreakoutParams,
    equity: float,
) -> Optional[tuple[str, float, int, float]]:
    """Return (symbol, ER, shares, atr_value) if the entry gate passes."""
    hist = _symbol_history(bars, sym, asof)
    if hist is None or len(hist) < params.trend_sma_period + 15:
        return None

    close = hist["close"].astype("float64")
    high = hist["high"].astype("float64")
    low = hist["low"].astype("float64")

    kama_series = kama(
        close,
        er_period=params.kama_er_period,
        fast=params.kama_fast,
        slow=params.kama_slow,
    )
    if pd.isna(kama_series.iloc[-1]):
        return None

    donch = donchian(high.shift(1), low.shift(1), period=params.donchian_period)
    donch_upper = donch["upper"].iloc[-1]
    if pd.isna(donch_upper):
        return None

    sma_trend = sma(close, period=params.trend_sma_period)
    sma_last = sma_trend.iloc[-1]
    if pd.isna(sma_last):
        return None
    sma_lookback = 10
    if len(sma_trend) > sma_lookback:
        sma_prev = sma_trend.iloc[-1 - sma_lookback]
        sma_rising = not pd.isna(sma_prev) and float(sma_last) > float(sma_prev)
    else:
        sma_rising = False

    atr_series = atr(high, low, close, period=params.atr_period)
    atr_last = atr_series.iloc[-1]
    if pd.isna(atr_last) or float(atr_last) <= 0:
        return None

    er = _efficiency_ratio(close, params.kama_er_period)

    c_last = float(close.iloc[-1])
    kama_last = float(kama_series.iloc[-1])

    if c_last <= kama_last:
        return None
    if c_last <= float(donch_upper):
        return None
    if er < params.er_min_trend:
        return None
    if c_last <= float(sma_last) or not sma_rising:
        return None

    if params.volume_surge_enabled:
        vol_sma = hist["volume"].astype("float64").rolling(params.volume_sma_period).mean()
        if pd.isna(vol_sma.iloc[-1]) or vol_sma.iloc[-1] <= 0:
            return None
        if float(hist["volume"].iloc[-1]) < params.volume_surge_min * float(vol_sma.iloc[-1]):
            return None

    if params.earnings_skip_days > 0 and _has_earnings_soon(
        earnings, sym, asof, params.earnings_skip_days,
    ):
        return None

    atr_val = float(atr_last)
    stop_distance = params.chandelier_atr_mult * atr_val
    if stop_distance <= 0:
        return None
    risk_dollars = params.risk_per_trade * equity
    shares = int(risk_dollars // stop_distance)

    max_notional = params.max_allocation * equity
    cap_shares = int(max_notional // c_last) if c_last > 0 else 0
    shares = min(shares, cap_shares)
    if shares <= 0:
        return None

    return (sym, er, shares, atr_val)


def _efficiency_ratio(close: pd.Series, period: int) -> float:
    """Kaufman's Efficiency Ratio at the last bar."""
    if period <= 0 or len(close) <= period:
        return 0.0
    vals = close.astype("float64").to_numpy()
    change = abs(float(vals[-1] - vals[-1 - period]))
    diffs = np.abs(np.diff(vals[-1 - period:]))
    vol = float(diffs.sum())
    if vol <= 0:
        return 0.0
    return change / vol


def _has_earnings_soon(
    earnings: Optional[pd.DataFrame],
    sym: str,
    asof: date,
    skip_days: int,
) -> bool:
    if earnings is None or getattr(earnings, "empty", True):
        return False
    if "symbol" not in earnings.columns:
        return False
    date_col = next(
        (c for c in ("date", "report_date", "ts") if c in earnings.columns),
        None,
    )
    if date_col is None:
        return False
    start = asof - timedelta(days=skip_days)
    end = asof + timedelta(days=skip_days)
    frame_dates = pd.to_datetime(earnings[date_col], errors="coerce").dt.date
    mask = (
        (earnings["symbol"].astype(str).str.upper() == sym.upper())
        & (frame_dates >= start)
        & (frame_dates <= end)
    )
    return bool(mask.any())


__all__ = ["KamaBreakoutStrategy"]
