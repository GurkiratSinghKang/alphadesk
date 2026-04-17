"""RSI(2) Mean-Reversion — production implementation.

Conservative large-cap + liquid-ETF implementation of the Connors / Alvarez
RSI(2) system with post-2015 decay-mitigating refinements:

- 200-day SMA trend filter (kept us out of the 2022 tape).
- ConnorsRSI OR-gate (blend of RSI, streak, and 1-day-return percentile).
- Systemic-regime gate on SPY's own RSI(2) so we don't buy the panic tail.
- Volume surge confirmation.
- Earnings skip when an earnings calendar is available.
- Hard swing-low stop, time stop, and two profit-take exits emitted from
  ``manage()`` — the engine does not auto-trigger STOP/TP on positions, so
  the strategy must evaluate them every bar itself.

Data-fetching, indicator caching, and earnings helpers live in
:mod:`.helpers`. See ``spec.md`` for the academic spec.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Iterable, Mapping, Optional

import numpy as np
import pandas as pd

from backend.strategies.base import Context, cache_of
from backend.strategies.registry import (
    StrategyRegistrationError,
    _STRATEGY_CLASSES,
    register_strategy,
)
from backend.strategies.signal import OrderType, Signal, TimeInForce

from .config import (
    CORE_ETFS,
    DEFAULTS,
    LARGE_CAP_SEED,
    search_space,
)
from .helpers import (
    fetch_bars,
    has_upcoming_earnings,
    indicator_at,
    indicators_for,
    symbol_history,
    trading_days_between,
)


def _safe_register(*args, **kwargs):
    """``@register_strategy`` shim that tolerates double-loading.

    The legacy ``backend/strategies/__init__.py`` imports every strategy
    under the ``strategies.*`` alias. When that same module is subsequently
    loaded through ``backend.strategies.*`` (canonical path) the decorator
    sees a different class object and raises
    :class:`StrategyRegistrationError`. In that case we return the
    already-registered class so callers see a single canonical instance.
    """

    name = kwargs.get("name") or (args[0] if args else None)
    decorator = register_strategy(*args, **kwargs)

    def wrap(cls):
        try:
            return decorator(cls)
        except StrategyRegistrationError:
            existing = _STRATEGY_CLASSES.get(name)
            if existing is None:
                raise
            return existing

    return wrap


# --------------------------------------------------------------------------- #
# Internal constants                                                          #
# --------------------------------------------------------------------------- #
# Warmup required before the strategy's first bar. We need ~200 trading days
# for SMA(200) + extra margin for CRSI(100) percentile rank. In calendar
# days that is ~380 (200 trading days ≈ 290 calendar days, +90 for CRSI is
# comfortable). ``StrategyMeta`` labels the field as *calendar* days.
_REQUIRED_LOOKBACK_DAYS = 380
# Minimum number of *trading days* the strategy needs in a candidate's
# history before evaluating an entry. Stricter than the calendar-days
# lookback above; the latter is a hint to the engine for pre-fetching.
_MIN_TRADING_BARS = 250
# ``ctx.state`` namespace prefix.
_NS = "rsi2_reversal"
_VOL_MIN = 1.0  # guard against div-by-zero when avg_vol = 0
_SPY = "SPY"


# --------------------------------------------------------------------------- #
# Strategy                                                                    #
# --------------------------------------------------------------------------- #
@_safe_register(
    name="rsi2_reversal",
    category="equity",
    required_bars=("daily",),
    required_lookback_days=_REQUIRED_LOOKBACK_DAYS,
    min_universe_size=1,
    supports_shorts=False,
    supports_options=False,
    description=(
        "Connors-style RSI(2) mean reversion on SPY/QQQ/IWM + liquid S&P-500 "
        "mega-caps. 200-SMA trend filter, ConnorsRSI OR-gate, SPY RSI(2) "
        "regime floor, volume confirmation, earnings skip, explicit "
        "RSI/SMA/swing/time exits."
    ),
)
class RSI2ReversalStrategy:
    """Long-only mean-reversion on oversold large-caps in a long-term uptrend."""

    name = "rsi2_reversal"
    required_bars: list[str] = ["daily"]
    required_lookback_days: int = _REQUIRED_LOOKBACK_DAYS

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    def __init__(self) -> None:
        self.params: dict[str, Any] = dict(DEFAULTS)

    def configure(self, params: Mapping[str, Any]) -> None:
        """Merge tuner/user overrides onto the defaults and coerce types."""

        merged = dict(DEFAULTS)
        if params:
            for k, v in params.items():
                merged[k] = v
        for k in (
            "rsi_entry_max",
            "connors_entry_max",
            "rsi_exit_min",
            "allocation_per_trade",
            "volume_surge_min",
            "spy_rsi_regime_floor",
            "adv_usd_min",
        ):
            merged[k] = float(merged[k])
        for k in (
            "rsi_period",
            "trend_sma_period",
            "stop_lookback_bars",
            "time_stop_days",
            "exit_sma_period",
            "max_positions",
            "earnings_skip_days",
            "crsi_rsi_period",
            "crsi_streak_period",
            "crsi_pct_rank_period",
        ):
            merged[k] = int(merged[k])
        self.params = merged

    @classmethod
    def search_space(cls) -> dict[str, Any]:
        return search_space()

    # ------------------------------------------------------------------ #
    # Universe
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        cache = cache_of(ctx)
        universe = cache.get(f"{_NS}.universe")
        if universe is None:
            universe = self._build_universe(asof, ctx)
            cache[f"{_NS}.universe"] = universe
        syms = set(universe)
        syms.add(_SPY)
        for p in ctx.positions:
            syms.add(p.symbol)
        return sorted(syms)

    def _build_universe(self, asof: date, ctx: Context) -> list[str]:
        """Screen the seed list by 90-day dollar ADV > adv_usd_min.

        Runs once at the start of the backtest; result is cached on
        ``ctx.state``.
        """

        adv_min = float(self.params["adv_usd_min"])
        cutoff = asof - timedelta(days=180)  # ~90 trading days
        seed = list(dict.fromkeys([*CORE_ETFS, *LARGE_CAP_SEED]))
        try:
            bars_df = fetch_bars(ctx, seed, cutoff, asof)
        except Exception:
            return list(CORE_ETFS)
        if bars_df is None or bars_df.empty:
            return list(CORE_ETFS)

        survivors = list(CORE_ETFS)
        for sym in seed:
            if sym in CORE_ETFS:
                continue
            sub = bars_df[bars_df["symbol"] == sym]
            if sub.empty or len(sub) < 30:
                continue
            last_90 = sub.tail(90)
            dollar_vol = (
                last_90["close"].astype(float) * last_90["volume"].astype(float)
            )
            adv = float(dollar_vol.mean()) if len(dollar_vol) else 0.0
            if adv >= adv_min:
                survivors.append(sym)

        out: list[str] = []
        seen: set[str] = set()
        for s in survivors:
            if s not in seen:
                out.append(s)
                seen.add(s)
        return out

    # ------------------------------------------------------------------ #
    # Entries
    # ------------------------------------------------------------------ #
    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        p = self.params
        cache = cache_of(ctx)
        universe = cache.get(f"{_NS}.universe") or list(CORE_ETFS)

        # Systemic regime gate on SPY.
        spy_rsi2 = indicator_at(
            ctx, _SPY, asof, "rsi2", int(p["rsi_period"]), self.required_lookback_days
        )
        if spy_rsi2 is None or math.isnan(spy_rsi2):
            return []
        if spy_rsi2 <= float(p["spy_rsi_regime_floor"]):
            return []

        # Capacity check.
        held = [pos for pos in ctx.positions if pos.quantity > 0]
        capacity = int(p["max_positions"]) - len(held)
        if capacity <= 0:
            return []

        held_symbols = {pos.symbol for pos in held}
        pending_symbols: set[str] = set()

        # Rank candidates by CRSI asc (most-oversold first).
        candidates: list[tuple[float, str, float, float, float]] = []
        for sym in universe:
            if sym in held_symbols or sym in pending_symbols:
                continue
            result = self._evaluate_entry(ctx, sym, asof)
            if result is None:
                continue
            crsi_val, close_px, stop_px, sma_exit_px = result
            candidates.append(
                (crsi_val, sym, float(close_px), float(stop_px), float(sma_exit_px))
            )
        candidates.sort(key=lambda row: row[0])

        out: list[Signal] = []
        alloc = float(p["allocation_per_trade"])
        for crsi_val, sym, close_px, stop_px, sma_exit_px in candidates[:capacity]:
            # Floor the take-profit above entry to avoid degenerate brackets
            # on sharp-falling setups where SMA_5 < close.
            tp_px = max(sma_exit_px, close_px * 1.01)
            out.append(
                Signal(
                    symbol=sym,
                    target_weight=alloc,
                    stop_price=Decimal(f"{stop_px:.4f}"),
                    take_profit=Decimal(f"{tp_px:.4f}"),
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag="rsi2-entry",
                    asof=asof,
                )
            )
            pending_symbols.add(sym)
            entries = cache.setdefault(f"{_NS}.entries", {})
            entries[sym] = {
                "queued_on": asof,
                "stop_price": stop_px,
                "entry_close_est": close_px,
            }
        return out

    def _evaluate_entry(
        self, ctx: Context, sym: str, asof: date
    ) -> Optional[tuple[float, float, float, float]]:
        """Return (crsi, close, stop_price, sma_exit_price) if eligible."""

        p = self.params
        bars = symbol_history(ctx, sym, asof, self.required_lookback_days)
        if bars is None or len(bars) < _MIN_TRADING_BARS:
            return None

        ind = indicators_for(ctx, sym, bars, p)
        if ind is None:
            return None
        last_idx = len(bars) - 1
        close_px = float(bars["close"].iloc[-1])

        # Trend filter.
        sma_trend_v = ind["sma_trend"][last_idx]
        if not np.isfinite(sma_trend_v) or close_px <= sma_trend_v:
            return None

        # Oscillator OR-gate.
        rsi_v = ind["rsi"][last_idx]
        if not np.isfinite(rsi_v):
            return None
        crsi_v = ind["crsi"][last_idx]
        if not np.isfinite(crsi_v):
            return None
        if not (rsi_v < float(p["rsi_entry_max"])
                or crsi_v < float(p["connors_entry_max"])):
            return None

        # Volume surge confirmation.
        vols = bars["volume"].astype(float).to_numpy()
        if len(vols) < 22:
            return None
        avg_vol = float(vols[-21:-1].mean())
        if avg_vol < _VOL_MIN:
            return None
        if float(vols[-1]) < float(p["volume_surge_min"]) * avg_vol:
            return None

        # Earnings skip.
        skip_days = int(p["earnings_skip_days"])
        if skip_days > 0 and has_upcoming_earnings(ctx, sym, asof, skip_days):
            return None

        # Stop and SMA-exit.
        lookback = int(p["stop_lookback_bars"])
        lows = bars["low"].astype(float).to_numpy()
        if len(lows) < lookback + 1:
            return None
        stop_px = float(lows[-lookback:].min())
        sma_exit_v = ind["sma_exit"][last_idx]
        if not np.isfinite(sma_exit_v):
            return None
        return (float(crsi_v), close_px, stop_px, float(sma_exit_v))

    # ------------------------------------------------------------------ #
    # Manage / exits
    # ------------------------------------------------------------------ #
    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        p = self.params
        cache = cache_of(ctx)
        entries = cache.get(f"{_NS}.entries", {})

        rsi_period = int(p["rsi_period"])
        exit_sma_len = int(p["exit_sma_period"])
        rsi_exit = float(p["rsi_exit_min"])
        time_stop = int(p["time_stop_days"])

        out: list[Signal] = []
        for pos in list(ctx.positions):
            if pos.quantity <= 0:
                continue
            sym = pos.symbol
            bars = symbol_history(ctx, sym, asof, self.required_lookback_days)
            if bars is None or bars.empty:
                continue
            closes = bars["close"].astype(float)
            if len(closes) < max(rsi_period + 1, exit_sma_len):
                continue

            close_px = float(closes.iloc[-1])
            ind = indicators_for(ctx, sym, bars, p)
            if ind is None:
                continue
            last_idx = len(bars) - 1
            rsi_last: Optional[float] = float(ind["rsi"][last_idx])
            if not np.isfinite(rsi_last):
                rsi_last = None
            sma_last: Optional[float] = float(ind["sma_exit"][last_idx])
            if not np.isfinite(sma_last):
                sma_last = None

            opened = pos.opened_at
            if opened is None:
                meta = entries.get(sym) or {}
                queued = meta.get("queued_on")
                if isinstance(queued, datetime):
                    opened = queued
                elif isinstance(queued, date):
                    opened = datetime.combine(queued, datetime.min.time())
            held_days = trading_days_between(opened, asof)

            stop_px = None
            if pos.stop_price is not None:
                try:
                    stop_px = float(pos.stop_price)
                except Exception:
                    stop_px = None
            if stop_px is None:
                meta = entries.get(sym) or {}
                stop_px = meta.get("stop_price")

            exit_reason: Optional[str] = None
            if rsi_last is not None and rsi_last > rsi_exit:
                exit_reason = "rsi-profit-take"
            elif sma_last is not None and close_px > sma_last:
                exit_reason = "sma-cross"
            elif stop_px is not None and close_px <= stop_px:
                exit_reason = "swing-stop"
            elif held_days >= time_stop:
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

    # ------------------------------------------------------------------ #
    # Fills
    # ------------------------------------------------------------------ #
    def on_fill(self, fill: Any, ctx: Context) -> None:
        cache = cache_of(ctx)
        entries = cache.setdefault(f"{_NS}.entries", {})
        sym = fill.symbol
        try:
            is_buy = fill.side.value == "buy"
        except Exception:
            is_buy = False
        if is_buy:
            entries.setdefault(sym, {})
            entries[sym]["filled_on"] = fill.ts
            entries[sym]["entry_price"] = float(fill.price)
        else:
            entries.pop(sym, None)


__all__ = ["RSI2ReversalStrategy"]
