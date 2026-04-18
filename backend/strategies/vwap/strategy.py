"""VWAP Session-Anchored Pullback — production implementation.

Session-anchored intraday VWAP on 5-min bars, with a daily backtest shell:

- Daily trend filter (SPY + name > SMA_N) gates participation at session open.
- 5-min intraday scan of prior-session data detects a pullback-to-VWAP setup:
  price within `pullback_pct_max` of session VWAP from above AND RSI(p) < max
  AND close > prior-bar VWAP. Shorts mirror (opt-in via `allow_shorts`).
- When a setup is detected on day T-1's intraday tape, we queue an MOO for
  day T with stop = max(bps, 1xATR) and take-profit = entry + k*sigma_band.
- `manage()` emits an MOC exit every bar to enforce the EOD-flat rule.
- Max simultaneous positions and per-trade allocation are tunable.

Academic thesis: see `spec.md`. Signal math follows Connors (2009) style
RSI(2) timing on 5-min bars plus the session-VWAP pullback-in-trend
interpretation favoured by day-trading literature.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Iterable, Mapping, Optional

import numpy as np
import pandas as pd

from indicators.momentum import rsi
from indicators.trend import sma
from indicators.volatility import atr as atr_indicator
from indicators.volume import vwap_session
from strategies.base import Context, cache_of
from strategies.registry import (
    StrategyRegistrationError,
    _STRATEGY_CLASSES,
    register_strategy,
)
from strategies.signal import OrderType, Signal, TimeInForce

from .config import DEFAULTS, SPY, UNIVERSE, search_space as _search_space


# --------------------------------------------------------------------------- #
# Internal constants                                                          #
# --------------------------------------------------------------------------- #
# Daily lookback for the trend-SMA + SPY regime filter.
_REQUIRED_LOOKBACK_DAYS = 300
_NS = "vwap"
_MIN_INTRADAY_BARS = 20  # at least 20 bars of 5-min data required before a signal


def _safe_register(*args, **kwargs):
    """``@register_strategy`` shim that tolerates double-loading.

    Same pattern as other Wave strategies: lets both the legacy and
    canonical import paths import this module without raising.
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
# Strategy                                                                    #
# --------------------------------------------------------------------------- #
@_safe_register(
    name="vwap",
    category="intraday",
    required_bars=("daily", "5Min"),
    required_lookback_days=_REQUIRED_LOOKBACK_DAYS,
    min_universe_size=1,
    supports_shorts=True,
    supports_options=False,
    description=(
        "Session-anchored intraday VWAP pullback-in-trend on 10 deep-liquidity "
        "US names. 5-min intraday RSI(2) timing, daily SMA trend gate, "
        "ATR-widened bps stop, sigma-band take-profit, EOD-flat MOC exit."
    ),
)
class VWAPSessionStrategy:
    """Intraday VWAP pullback on liquid large caps, EOD-flat."""

    name = "vwap"
    required_bars: list[str] = ["daily", "5Min"]
    required_lookback_days: int = _REQUIRED_LOOKBACK_DAYS

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    def __init__(self) -> None:
        self.params: dict[str, Any] = dict(DEFAULTS)

    def configure(self, params: Mapping[str, Any]) -> None:
        merged = dict(DEFAULTS)
        if params:
            for k, v in params.items():
                merged[k] = v
        # Coerce numeric types to their canonical shapes.
        for k in (
            "pullback_pct_max",
            "rsi_entry_max",
            "stop_bps_or_atr_max",
            "tp_sigma_band",
            "max_allocation",
        ):
            merged[k] = float(merged[k])
        for k in (
            "rsi_period",
            "trend_sma_daily",
            "max_positions",
        ):
            merged[k] = int(merged[k])
        merged["allow_shorts"] = bool(merged["allow_shorts"])
        self.params = merged

    @classmethod
    def search_space(cls) -> dict[str, Any]:
        return _search_space()

    # ------------------------------------------------------------------ #
    # Universe
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        """Fixed universe plus SPY (systemic filter) and any open positions."""

        syms = set(UNIVERSE)
        syms.add(SPY)
        for p in ctx.positions:
            syms.add(p.symbol)
        return sorted(syms)

    # ------------------------------------------------------------------ #
    # Entries
    # ------------------------------------------------------------------ #
    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        p = self.params
        cache = cache_of(ctx)

        # Systemic trend gate: SPY > SPY.SMA(100).
        spy_trend_ok = self._spy_trend_ok(ctx, asof)
        if not spy_trend_ok:
            return []

        # Capacity check.
        held = [pos for pos in ctx.positions if pos.quantity != 0]
        capacity = int(p["max_positions"]) - len(held)
        if capacity <= 0:
            return []

        held_symbols = {pos.symbol for pos in held}
        allow_shorts = bool(p["allow_shorts"])
        pullback_pct_max = float(p["pullback_pct_max"])
        rsi_period = int(p["rsi_period"])
        rsi_entry_max = float(p["rsi_entry_max"])
        rsi_entry_min_short = 100.0 - rsi_entry_max

        # Scan the prior trading session's 5-min tape for each universe
        # name. The engine's asof is today's session-end; we use today's
        # intraday tape since it's available at the daily close, and fill
        # tomorrow at MOO. No look-ahead: today's tape is known at today's
        # close.
        intraday_asof = asof

        candidates: list[tuple[float, str, str, float, float, float]] = []
        #        (priority_score, symbol, direction, entry_est, stop_px, tp_px)

        for sym in UNIVERSE:
            if sym in held_symbols:
                continue
            if not self._name_trend_ok(ctx, sym, asof):
                continue

            intra = self._intraday_bars(ctx, sym, intraday_asof)
            if intra is None or len(intra) < _MIN_INTRADAY_BARS:
                continue

            # Compute the signal on the last (closed) 5-min bar of the
            # session. We require at least 20 bars so the sigma band is
            # meaningful.
            signal = self._evaluate_pullback(
                intra,
                pullback_pct_max=pullback_pct_max,
                rsi_period=rsi_period,
                rsi_entry_max=rsi_entry_max,
                rsi_entry_min_short=rsi_entry_min_short,
                allow_shorts=allow_shorts,
                stop_bps_or_atr_max=float(p["stop_bps_or_atr_max"]),
                tp_sigma_band=float(p["tp_sigma_band"]),
            )
            if signal is None:
                continue
            direction, entry_est, stop_px, tp_px, score = signal
            candidates.append((score, sym, direction, entry_est, stop_px, tp_px))

        # Rank by score: most extreme oversold / most extended pullback first.
        candidates.sort(key=lambda row: row[0])

        alloc = float(p["max_allocation"])
        out: list[Signal] = []
        for score, sym, direction, entry_est, stop_px, tp_px in candidates[:capacity]:
            weight = alloc if direction == "long" else -alloc
            out.append(
                Signal(
                    symbol=sym,
                    target_weight=weight,
                    stop_price=Decimal(f"{stop_px:.4f}"),
                    take_profit=Decimal(f"{tp_px:.4f}"),
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag=f"vwap-entry-{direction}",
                    asof=asof,
                )
            )
            entries = cache.setdefault(f"{_NS}.entries", {})
            entries[sym] = {
                "queued_on": asof,
                "direction": direction,
                "entry_est": entry_est,
                "stop_px": stop_px,
                "tp_px": tp_px,
            }
        return out

    def _evaluate_pullback(
        self,
        intra: pd.DataFrame,
        *,
        pullback_pct_max: float,
        rsi_period: int,
        rsi_entry_max: float,
        rsi_entry_min_short: float,
        allow_shorts: bool,
        stop_bps_or_atr_max: float,
        tp_sigma_band: float,
    ) -> Optional[tuple[str, float, float, float, float]]:
        """Scan intraday bars for a VWAP pullback setup.

        The strategy fires one round-trip per session, so we look for the
        *best* (lowest-RSI-long or highest-RSI-short) bar in the session
        where all three entry gates (pullback, RSI, trend persistence)
        are satisfied. Using only the very last closed bar systematically
        misses setups that fire mid-session.

        Returns (direction, entry_est, stop_px, tp_px, score) or None.
        Lower score == stronger long signal; a short signal's score is
        negated so long and short candidates can be compared in one list.
        """

        if len(intra) < _MIN_INTRADAY_BARS:
            return None

        # Session VWAP from the first bar of today's session up to bar t.
        try:
            vwap = vwap_session(intra)
        except Exception:
            return None
        if vwap is None or vwap.empty or vwap.isna().all():
            return None

        closes = intra["close"].astype(float)
        highs = intra["high"].astype(float)
        lows = intra["low"].astype(float)

        # RSI on 5-min closes within the session. Short series; use SMA
        # smoothing (Cutler's) which has a smaller warmup than Wilder's.
        rsi_series = rsi(closes, period=rsi_period, smoothing="sma")
        if rsi_series is None or rsi_series.empty or rsi_series.isna().all():
            return None

        # ATR(14) on 5-min bars.
        atr5 = atr_indicator(highs, lows, closes, period=14)
        if atr5 is None or atr5.empty:
            return None

        # Sigma band on (close − VWAP), rolling 20-bar std.
        dev = (closes - vwap).astype(float)
        sigma20 = dev.rolling(window=20, min_periods=10).std(ddof=1)

        # Scan all bars from warmup onwards for a signal. Pick the
        # strongest.
        best: Optional[tuple[str, float, float, float, float]] = None
        # Need RSI + sigma warmup → start at bar index 20 at earliest.
        start_idx = max(_MIN_INTRADAY_BARS, rsi_period + 1)
        for i in range(start_idx, len(intra)):
            px = float(closes.iloc[i])
            vwap_t = float(vwap.iloc[i])
            vwap_prev = float(vwap.iloc[i - 1])
            if not (np.isfinite(px) and np.isfinite(vwap_t) and np.isfinite(vwap_prev)):
                continue
            if vwap_t <= 0:
                continue

            rsi_t = float(rsi_series.iloc[i])
            if not np.isfinite(rsi_t):
                continue
            atr_t_val = atr5.iloc[i]
            atr_t = float(atr_t_val) if np.isfinite(atr_t_val) else 0.0
            sigma_val = sigma20.iloc[i]
            sigma_t = float(sigma_val) if np.isfinite(sigma_val) else 0.0

            dev_pct = (px - vwap_t) / vwap_t

            # -------- LONG evaluation --------
            long_ok = (
                0.0 <= dev_pct <= pullback_pct_max
                and rsi_t < rsi_entry_max
                and px > vwap_prev
            )
            if long_ok:
                bps_stop = vwap_t * (1.0 - stop_bps_or_atr_max / 10000.0)
                atr_stop = px - 1.0 * atr_t if atr_t > 0 else bps_stop
                stop_px = min(bps_stop, atr_stop)
                if stop_px <= 0 or stop_px >= px:
                    stop_px = px * (1.0 - 0.005)
                if sigma_t > 0:
                    tp_px = px + tp_sigma_band * sigma_t
                else:
                    tp_px = px * (1.0 + 0.005)
                score = float(rsi_t)
                cand = ("long", px, float(stop_px), float(tp_px), score)
                if best is None or cand[4] < best[4]:
                    best = cand
                continue  # don't double-count with short

            # -------- SHORT evaluation (mirror) --------
            if allow_shorts:
                short_ok = (
                    -pullback_pct_max <= dev_pct <= 0.0
                    and rsi_t > rsi_entry_min_short
                    and px < vwap_prev
                )
                if short_ok:
                    bps_stop = vwap_t * (1.0 + stop_bps_or_atr_max / 10000.0)
                    atr_stop = px + 1.0 * atr_t if atr_t > 0 else bps_stop
                    stop_px = max(bps_stop, atr_stop)
                    if stop_px <= px:
                        stop_px = px * (1.0 + 0.005)
                    if sigma_t > 0:
                        tp_px = px - tp_sigma_band * sigma_t
                    else:
                        tp_px = px * (1.0 - 0.005)
                    # Score: negate so smaller = stronger (higher RSI),
                    # comparable to longs via a shifted sign.
                    score = -float(rsi_t)
                    cand = ("short", px, float(stop_px), float(tp_px), score)
                    if best is None or cand[4] < best[4]:
                        best = cand

        return best

    # ------------------------------------------------------------------ #
    # Manage / exits — enforce EOD-flat rule
    # ------------------------------------------------------------------ #
    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        """Emit an MOC exit for every held position so we never go overnight.

        The engine's executor will fire the embedded stop / take-profit
        intraday-equivalent against the daily bar high/low during the
        same session; any surviving position is flattened at that
        session's close.
        """

        out: list[Signal] = []
        for pos in list(ctx.positions):
            if pos.quantity == 0:
                continue
            out.append(
                Signal(
                    symbol=pos.symbol,
                    target_weight=0.0,
                    order_type=OrderType.MOC,
                    time_in_force=TimeInForce.DAY,
                    tag="vwap-exit-eod",
                    asof=asof,
                )
            )
        return out

    # ------------------------------------------------------------------ #
    # Fills — track realized entry for reconciliation only
    # ------------------------------------------------------------------ #
    def on_fill(self, fill: Any, ctx: Context) -> None:
        cache = cache_of(ctx)
        entries = cache.setdefault(f"{_NS}.entries", {})
        sym = fill.symbol
        try:
            is_buy = fill.side.value == "buy"
        except Exception:
            is_buy = False
        if is_buy and sym in entries:
            entries[sym]["filled_on"] = fill.ts
            entries[sym]["entry_price"] = float(fill.price)
        # On sell/exit, wipe the record so the name is eligible again
        # tomorrow.
        if not is_buy:
            entries.pop(sym, None)

    # ------------------------------------------------------------------ #
    # Helpers                                                             #
    # ------------------------------------------------------------------ #
    def _intraday_bars(
        self, ctx: Context, sym: str, asof: date
    ) -> Optional[pd.DataFrame]:
        """Fetch today's 5-min bars for `sym`, normalised with a DatetimeIndex.

        Returns a DataFrame with columns ``open, high, low, close, volume``
        indexed by a DatetimeIndex in UTC. Empty / failed fetches return
        None.

        We cache intraday pulls per (symbol, date) on ``ctx.state`` so a
        given session is fetched exactly once per backtest, even if the
        engine calls generate_signals + manage in the same bar.
        """

        cache = cache_of(ctx)
        intra_cache: dict[tuple, pd.DataFrame] = cache.setdefault(
            f"{_NS}.intra", {}
        )
        key = (sym, asof)
        if key in intra_cache:
            return intra_cache[key]

        provider = getattr(ctx, "bar_provider", None)
        if provider is None:
            intra_cache[key] = None
            return None

        try:
            df = provider.bars([sym], asof, asof, tf="5Min")
        except Exception:
            intra_cache[key] = None
            return None
        if df is None or len(df) == 0:
            intra_cache[key] = None
            return None

        df = pd.DataFrame(df)
        cols = {c.lower(): c for c in df.columns}
        sym_col = cols.get("symbol") or cols.get("ticker")
        ts_col = cols.get("ts") or cols.get("timestamp") or cols.get("date")
        if sym_col is not None:
            df = df[df[sym_col].astype(str).str.upper() == sym.upper()].copy()
        if df.empty or ts_col is None:
            intra_cache[key] = None
            return None

        ts = pd.to_datetime(df[ts_col], utc=True, errors="coerce")
        # Build the frame via explicit .values arrays so pandas doesn't
        # reindex off the source frame's RangeIndex when the DatetimeIndex
        # we construct happens to share numeric labels.
        frame = pd.DataFrame(
            {
                "open": pd.to_numeric(df[cols.get("open", "open")], errors="coerce").to_numpy(),
                "high": pd.to_numeric(df[cols.get("high", "high")], errors="coerce").to_numpy(),
                "low": pd.to_numeric(df[cols.get("low", "low")], errors="coerce").to_numpy(),
                "close": pd.to_numeric(df[cols.get("close", "close")], errors="coerce").to_numpy(),
                "volume": (
                    pd.to_numeric(
                        df[cols.get("volume", "volume")] if "volume" in cols else 0,
                        errors="coerce",
                    )
                    .fillna(0.0)
                    .to_numpy()
                ),
            },
            index=pd.DatetimeIndex(ts.to_numpy(), tz="UTC"),
        )
        frame = frame.dropna(subset=["close"])
        if frame.empty:
            intra_cache[key] = None
            return None

        # Keep regular-trading-hours only (14:30-21:00 UTC = 9:30-16:00 ET
        # during EDT; 14:30-21:00 UTC is wide enough to cover most bars
        # during both EDT and EST sessions — for the latter 13:30-20:00
        # UTC; we accept a slight cutoff to avoid pre-market / after-hours
        # noise that breaks VWAP accumulation).
        # We use a conservative window 13:30 <= t < 21:00 UTC to capture
        # both EDT (14:30 - 21:00) and EST (13:30 - 20:00) cleanly.
        utc_hour_min = frame.index.hour * 60 + frame.index.minute
        keep = (utc_hour_min >= 13 * 60 + 30) & (utc_hour_min < 21 * 60 + 0)
        frame = frame[keep]
        if frame.empty:
            intra_cache[key] = None
            return None

        frame = frame.sort_index()
        intra_cache[key] = frame
        return frame

    def _daily_series(
        self, ctx: Context, sym: str, asof: date, lookback: int
    ) -> Optional[pd.Series]:
        """Fetch a daily close series ending at `asof`, length ~lookback."""

        cache = cache_of(ctx)
        daily_cache: dict[str, pd.Series] = cache.setdefault(f"{_NS}.daily", {})
        # Cache per-symbol; re-fetch only if asof has moved past the last
        # cached entry.
        existing = daily_cache.get(sym)
        need_fetch = (
            existing is None
            or existing.empty
            or existing.index[-1].date() < asof
        )
        if need_fetch:
            provider = getattr(ctx, "bar_provider", None)
            if provider is None:
                return None
            start = asof - timedelta(days=lookback + 30)
            end = asof + timedelta(days=5)
            try:
                df = provider.bars([sym], start, end, tf="1D")
            except Exception:
                return None
            if df is None or len(df) == 0:
                return None
            df = pd.DataFrame(df)
            cols = {c.lower(): c for c in df.columns}
            sym_col = cols.get("symbol") or cols.get("ticker")
            ts_col = cols.get("ts") or cols.get("timestamp") or cols.get("date")
            if sym_col is not None:
                df = df[df[sym_col].astype(str).str.upper() == sym.upper()].copy()
            if df.empty or ts_col is None:
                return None
            idx = pd.to_datetime(df[ts_col], utc=True, errors="coerce")
            closes = pd.to_numeric(
                df[cols.get("close", "close")], errors="coerce"
            )
            ser = pd.Series(closes.values, index=idx).dropna().sort_index()
            if ser.empty:
                return None
            daily_cache[sym] = ser
            existing = ser

        # Slice up-to-asof.
        series = existing[existing.index.date <= asof]
        if series.empty or len(series) < 5:
            return None
        return series

    def _name_trend_ok(self, ctx: Context, sym: str, asof: date) -> bool:
        p = self.params
        trend_n = int(p["trend_sma_daily"])
        series = self._daily_series(ctx, sym, asof, self.required_lookback_days)
        if series is None or len(series) < trend_n:
            return False
        sm = sma(series, trend_n)
        if sm is None or sm.empty:
            return False
        last_close = float(series.iloc[-1])
        last_sm = float(sm.iloc[-1]) if np.isfinite(sm.iloc[-1]) else None
        if last_sm is None:
            return False
        return last_close > last_sm

    def _spy_trend_ok(self, ctx: Context, asof: date) -> bool:
        """SPY > SPY.SMA(100) systemic filter."""

        series = self._daily_series(ctx, SPY, asof, self.required_lookback_days)
        if series is None or len(series) < 100:
            return False
        sm = sma(series, 100)
        if sm is None or sm.empty:
            return False
        last_close = float(series.iloc[-1])
        last_sm = float(sm.iloc[-1]) if np.isfinite(sm.iloc[-1]) else None
        if last_sm is None:
            return False
        return last_close > last_sm


__all__ = ["VWAPSessionStrategy"]
