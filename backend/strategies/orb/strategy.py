"""Opening Range Breakout (ORB) — production intraday simulator.

Canonical references:

- Crabel (1990) "Day Trading with Short Term Price Patterns and Opening
  Range Breakout" — 30-min OR; long/short on break of extreme.
- Fisher (2002) "The Logical Trader" / ACD Method — formalised the 5/15/30
  window choice and the failure-reversal levels.
- Zarattini & Aziz (2023) "A Profitable Day Trading Strategy For The US
  Equity Market" — 5-min OR on TQQQ, long-only, EOD close, Sharpe > 2
  in-sample (2016-2023).

Engine note
-----------

The AlphaDesk :class:`BacktestEngine` is a daily engine. It has no native
same-day intraday round-trip, so we implement ORB as a custom simulator
driven by a standalone harness. ``ORBStrategy`` registers with the strategy
registry (so ``get_strategy('orb')`` works and Phase 2 pipeline wiring can
discover it) but emits no engine-level signals. See ``spec.md`` §4.

The real decision loop lives in :meth:`ORBStrategy.simulate_day` which
fetches 1-minute bars via ``ctx.bar_provider``, scans for the first qualifying
breakout, simulates the position life (stop / TPs / trailing / EOD flat) at
1-minute granularity, and returns a per-trade P&L record. The harness in
``scripts/smoke_orb.py`` iterates trading sessions, calls ``simulate_day``,
compounds returns, and computes the final metrics.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
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
from backend.strategies.signal import Signal

from .config import DEFAULTS, UNIVERSE_PROFILES, search_space

log = logging.getLogger("alphadesk.strategies.orb")


# --------------------------------------------------------------------------- #
# Safe-register shim: tolerate double-loading via legacy alias                #
# --------------------------------------------------------------------------- #
def _safe_register(*args, **kwargs):
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
# Constants                                                                   #
# --------------------------------------------------------------------------- #
# 1-minute RTH window (UTC). US equity RTH is 9:30-16:00 ET; the UTC offset
# is -5 in winter (EST) and -4 in summer (EDT). We filter using the ET local
# clock (derived from the bar's UTC timestamp) rather than hard-coded UTC
# times so DST transitions are handled correctly.
_ET_OPEN_HOUR, _ET_OPEN_MIN = 9, 30
_ET_CLOSE_HOUR, _ET_CLOSE_MIN = 16, 0

# Warmup not required: ORB is pure intraday.
_REQUIRED_LOOKBACK_DAYS = 0


# --------------------------------------------------------------------------- #
# Per-day result                                                              #
# --------------------------------------------------------------------------- #
@dataclass
class OrbDayResult:
    """Outcome of :meth:`ORBStrategy.simulate_day` for one (date, symbol)."""

    asof: date
    symbol: str
    direction: Optional[str] = None  # "long" / "short" / None (no trade)
    entry_ts: Optional[datetime] = None
    entry_price: Optional[float] = None
    exit_ts: Optional[datetime] = None
    exit_price: Optional[float] = None
    shares: int = 0
    # Return fraction on the starting equity (i.e. trade P&L / starting equity)
    pnl_pct_of_equity: float = 0.0
    exit_reason: str = ""
    # Count of TPs that triggered (0, 1, or 2)
    tp_hits: int = 0
    # OR levels (for diagnostics)
    or_high: Optional[float] = None
    or_low: Optional[float] = None
    or_range: Optional[float] = None
    # True if the strategy evaluated bars for this day (vs skipped / missing data)
    evaluated: bool = False


# --------------------------------------------------------------------------- #
# Strategy                                                                    #
# --------------------------------------------------------------------------- #
@_safe_register(
    name="orb",
    category="intraday",
    required_bars=("1min",),
    required_lookback_days=_REQUIRED_LOOKBACK_DAYS,
    min_universe_size=1,
    supports_shorts=True,
    supports_options=False,
    description=(
        "Zarattini/Crabel 5-min Opening Range Breakout on SPY/QQQ/TQQQ. "
        "First-break rule, OR-low hard stop, Fib 1.272/1.618 take-profit "
        "scale-outs, optional OR-midpoint trail, mandatory 15:55 ET EOD flat. "
        "Long-only by default; tuner may enable shorts."
    ),
)
class ORBStrategy:
    """Intraday opening-range breakout on a curated leveraged-ETF basket."""

    name = "orb"
    required_bars: list[str] = ["1min"]
    required_lookback_days: int = _REQUIRED_LOOKBACK_DAYS

    # ------------------------------------------------------------------ #
    # Lifecycle                                                          #
    # ------------------------------------------------------------------ #
    def __init__(self) -> None:
        self.params: dict[str, Any] = dict(DEFAULTS)

    def configure(self, params: Mapping[str, Any]) -> None:
        """Merge overrides onto defaults and coerce types."""

        merged = dict(DEFAULTS)
        if params:
            for k, v in params.items():
                merged[k] = v

        # Type coercion
        int_keys = (
            "or_minutes",
            "entry_cutoff_hour_et",
            "session_end_hour_et",
            "session_end_minute_et",
        )
        float_keys = (
            "volume_confirm_min",
            "tp1_fib",
            "tp2_fib",
            "risk_per_trade",
            "commission_bps",
            "slippage_bps",
            "max_notional_pct",
            "tp_scale_fraction",
        )
        for k in int_keys:
            if k in merged:
                merged[k] = int(merged[k])
        for k in float_keys:
            if k in merged:
                merged[k] = float(merged[k])

        # Booleans from JSON-serialised categorical ("True"/"False") → bool
        shorts = merged.get("allow_shorts", False)
        if isinstance(shorts, str):
            merged["allow_shorts"] = shorts.lower() in ("true", "1", "yes")
        else:
            merged["allow_shorts"] = bool(shorts)

        # Sanity: tp2 must be >= tp1
        if merged["tp2_fib"] < merged["tp1_fib"]:
            merged["tp2_fib"] = merged["tp1_fib"]

        self.params = merged

    @classmethod
    def search_space(cls) -> dict[str, Any]:
        return search_space()

    # ------------------------------------------------------------------ #
    # Engine protocol (minimal: ORB runs via custom harness, not engine) #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        profile = self.params.get("universe_profile", "qqq_tqqq")
        return list(UNIVERSE_PROFILES.get(profile, UNIVERSE_PROFILES["qqq_tqqq"]))

    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        # ORB does all its work in the custom harness via simulate_day().
        # The daily-resolution engine cannot model same-session intraday
        # round-trips faithfully — see spec.md §4.
        return []

    def on_fill(self, fill: Any, ctx: Context) -> None:  # pragma: no cover
        return None

    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        return []

    # ------------------------------------------------------------------ #
    # Custom harness entry-point                                         #
    # ------------------------------------------------------------------ #
    def simulate_day(
        self,
        asof: date,
        ctx: Context,
        *,
        equity: float,
    ) -> list[OrbDayResult]:
        """Simulate a single trading day across the configured universe.

        Returns one :class:`OrbDayResult` per symbol in the universe. Days
        on which no breakout fires return a result with ``direction=None``
        and ``pnl_pct_of_equity=0``.

        The caller (usually ``scripts/smoke_orb.py`` or a tuner harness)
        is responsible for compounding returns into an equity curve and
        aggregating metrics.
        """

        results: list[OrbDayResult] = []
        universe = list(self.universe(asof, ctx))
        p = self.params

        # Fetch 1-min bars for the whole day for the whole universe in one
        # shot. The harness-level cache in InMemoryIntradayProvider serves
        # these from memory after the first call.
        try:
            df = ctx.bar_provider.bars(universe, asof, asof, tf="1Min")
        except Exception as exc:  # pragma: no cover - data outage path
            log.warning("orb.simulate_day: bar fetch failed for %s: %s", asof, exc)
            for sym in universe:
                results.append(OrbDayResult(asof=asof, symbol=sym))
            return results

        if df is None or df.empty:
            for sym in universe:
                results.append(OrbDayResult(asof=asof, symbol=sym))
            return results

        # Normalise timestamp column to tz-aware UTC pd.Timestamp.
        df = df.copy()
        if "ts" not in df.columns:
            for c in df.columns:
                if c.lower() in ("timestamp", "date"):
                    df = df.rename(columns={c: "ts"})
                    break
        df["ts"] = pd.to_datetime(df["ts"], utc=True)

        # Each symbol's risk-per-trade and max-notional caps reference TOTAL
        # portfolio equity (not a per-symbol slice). Cross-symbol concentration
        # is controlled by the per-symbol ``max_notional_pct`` cap (default
        # 20%), which keeps combined exposure below ~80% even when all
        # universe members fire at once.
        for sym in universe:
            sub = df[df["symbol"].str.upper() == sym.upper()]
            if sub.empty:
                results.append(OrbDayResult(asof=asof, symbol=sym))
                continue
            sub = sub.sort_values("ts").reset_index(drop=True)
            # Filter to RTH (ET). Alpaca returns UTC timestamps; we convert to
            # America/New_York and keep 9:30 <= local_time < 16:00.
            rth = self._filter_rth(sub)
            if rth.empty or len(rth) < int(p["or_minutes"]) + 2:
                # Not enough bars to form an OR + one post-window bar.
                results.append(OrbDayResult(asof=asof, symbol=sym))
                continue
            result = self._simulate_symbol_day(
                rth, sym, asof, equity=equity
            )
            results.append(result)

        return results

    # ------------------------------------------------------------------ #
    # Core intraday simulation                                           #
    # ------------------------------------------------------------------ #
    def _simulate_symbol_day(
        self,
        rth: pd.DataFrame,
        symbol: str,
        asof: date,
        *,
        equity: float,
    ) -> OrbDayResult:
        p = self.params
        or_minutes = int(p["or_minutes"])
        entry_cutoff_hour = int(p["entry_cutoff_hour_et"])
        session_end_hour = int(p["session_end_hour_et"])
        session_end_minute = int(p["session_end_minute_et"])
        volume_confirm_min = float(p["volume_confirm_min"])
        allow_shorts = bool(p["allow_shorts"])
        tp1_fib = float(p["tp1_fib"])
        tp2_fib = float(p["tp2_fib"])
        risk_per_trade = float(p["risk_per_trade"])
        commission_bps = float(p["commission_bps"])
        slippage_bps = float(p["slippage_bps"])
        max_notional_pct = float(p["max_notional_pct"])
        tp_scale = float(p["tp_scale_fraction"])
        stop_method = str(p["stop_method"])

        result = OrbDayResult(asof=asof, symbol=symbol, evaluated=True)

        # Opening-range bars = first or_minutes consecutive 1-min bars AT OR
        # AFTER 9:30 ET. `rth` is already filtered to that window.
        or_df = rth.head(or_minutes)
        if len(or_df) < or_minutes:
            return result

        or_high = float(or_df["high"].max())
        or_low = float(or_df["low"].min())
        or_range = or_high - or_low
        if or_range <= 0:
            # Degenerate OR — skip (first 5 minutes had no range; rare).
            return result
        or_volume_mean = float(or_df["volume"].mean())

        result.or_high = or_high
        result.or_low = or_low
        result.or_range = or_range

        # Walk forward one bar at a time looking for the first-break bar.
        post_or = rth.iloc[or_minutes:].reset_index(drop=True)
        if post_or.empty:
            return result

        entry_idx = None
        direction: Optional[str] = None
        entry_raw_price: Optional[float] = None

        for i, row in post_or.iterrows():
            bar_ts = row["ts"]
            local_dt = self._to_et(bar_ts)

            # Entry cutoff: no new entries at or after `entry_cutoff_hour_et`.
            if local_dt.hour >= entry_cutoff_hour:
                break

            close_px = float(row["close"])
            high_px = float(row["high"])
            low_px = float(row["low"])
            vol = float(row["volume"])

            # Volume confirmation
            if (
                or_volume_mean > 0
                and volume_confirm_min > 0
                and vol < volume_confirm_min * or_volume_mean
            ):
                continue

            if close_px > or_high:
                direction = "long"
                entry_idx = i
                entry_raw_price = close_px
                break
            if allow_shorts and close_px < or_low:
                direction = "short"
                entry_idx = i
                entry_raw_price = close_px
                break

        if direction is None or entry_idx is None or entry_raw_price is None:
            return result

        # We fill on the NEXT bar's open (market-on-open style) to honour
        # the no-look-ahead rule (we observed the breakout on bar i's close,
        # fill on bar i+1 open).
        fill_idx = entry_idx + 1
        if fill_idx >= len(post_or):
            # Breakout happened on the last tradable bar; no fill possible.
            return result
        fill_row = post_or.iloc[fill_idx]
        raw_fill_price = float(fill_row["open"])

        # Slippage baked into the fill price; commission accounted separately.
        slip_frac = slippage_bps / 10_000.0
        if direction == "long":
            entry_price = raw_fill_price * (1.0 + slip_frac)
            stop_price = or_low
        else:
            entry_price = raw_fill_price * (1.0 - slip_frac)
            stop_price = or_high

        risk_per_share = abs(entry_price - stop_price)
        if risk_per_share <= 0:
            return result

        # Position sizing
        dollar_risk = risk_per_trade * equity
        shares = int(dollar_risk // risk_per_share)
        # Cap at max notional
        max_notional = max_notional_pct * equity
        max_shares_by_notional = int(max_notional // entry_price) if entry_price > 0 else 0
        if max_shares_by_notional > 0:
            shares = min(shares, max_shares_by_notional)
        if shares <= 0:
            return result

        entry_ts = fill_row["ts"].to_pydatetime() if hasattr(fill_row["ts"], "to_pydatetime") else fill_row["ts"]
        result.direction = direction
        result.entry_ts = entry_ts
        result.entry_price = entry_price
        result.shares = shares

        # Take-profit levels (Fibonacci extensions of OR range)
        if direction == "long":
            tp1_px = or_high + tp1_fib * or_range
            tp2_px = or_high + tp2_fib * or_range
        else:
            tp1_px = or_low - tp1_fib * or_range
            tp2_px = or_low - tp2_fib * or_range

        # Position state
        remaining = shares
        realised_cash = 0.0  # running sum of proceeds minus costs
        commission_frac = commission_bps / 10_000.0
        realised_cash -= commission_frac * entry_price * shares  # entry commission

        # Scale-out sizes: default 1/3 each at TP1 and TP2; remainder (the
        # "runner") rides to EOD. For very small positions (≤2 shares), the
        # scale-outs degenerate and the whole position is the runner.
        if shares >= 3:
            tp1_shares = max(1, int(round(shares * tp_scale)))
            tp2_shares = max(1, int(round(shares * tp_scale)))
            # Never scale out the whole position — keep at least one share
            # as the runner.
            tp1_shares = min(tp1_shares, shares - 2)
            tp2_shares = min(tp2_shares, shares - tp1_shares - 1)
            if tp1_shares < 1:
                tp1_shares = 0
            if tp2_shares < 1:
                tp2_shares = 0
        else:
            tp1_shares = 0
            tp2_shares = 0

        # Trailing state for "or_midpoint_trail"
        or_mid = (or_high + or_low) / 2.0
        trail_armed = False
        trail_stop = stop_price
        highest_high = float(fill_row["high"])
        lowest_low = float(fill_row["low"])

        # Walk forward through the rest of the day
        exit_ts = None
        exit_price: Optional[float] = None
        exit_reason = ""
        tp_hits = 0

        remaining_bars = post_or.iloc[fill_idx:].reset_index(drop=True)
        for _, rbar in remaining_bars.iterrows():
            if remaining <= 0:
                break

            local_dt = self._to_et(rbar["ts"])
            high_px = float(rbar["high"])
            low_px = float(rbar["low"])
            close_px = float(rbar["close"])

            # Update extremes for trailing stop logic
            if direction == "long":
                highest_high = max(highest_high, high_px)
            else:
                lowest_low = min(lowest_low, low_px)

            # EOD hard close: if local time >= session_end, flatten at this bar's open.
            if (
                local_dt.hour > session_end_hour
                or (
                    local_dt.hour == session_end_hour
                    and local_dt.minute >= session_end_minute
                )
            ):
                raw_exit = float(rbar["open"])
                exit_price = self._apply_exit_slippage(raw_exit, direction, slip_frac)
                exit_ts = rbar["ts"].to_pydatetime() if hasattr(rbar["ts"], "to_pydatetime") else rbar["ts"]
                realised_cash += self._realise_scale_out(
                    entry_price, exit_price, remaining, direction, commission_frac
                )
                exit_reason = "eod_flat"
                remaining = 0
                break

            # Stop check (intrabar)
            if direction == "long" and low_px <= trail_stop:
                raw_exit = trail_stop  # filled at stop
                exit_price = self._apply_exit_slippage(raw_exit, direction, slip_frac)
                exit_ts = rbar["ts"].to_pydatetime() if hasattr(rbar["ts"], "to_pydatetime") else rbar["ts"]
                exit_reason = "stop"
                remaining = 0
                break
            if direction == "short" and high_px >= trail_stop:
                raw_exit = trail_stop
                exit_price = self._apply_exit_slippage(raw_exit, direction, slip_frac)
                exit_ts = rbar["ts"].to_pydatetime() if hasattr(rbar["ts"], "to_pydatetime") else rbar["ts"]
                exit_reason = "stop"
                remaining = 0
                break

            # Take-profit checks — scale out 1/3 at TP1 then 1/3 at TP2
            if direction == "long":
                if tp_hits < 1 and high_px >= tp1_px and tp1_shares > 0:
                    fill_px = self._apply_exit_slippage(tp1_px, direction, slip_frac)
                    realised_cash += self._realise_scale_out(
                        entry_price, fill_px, tp1_shares, direction, commission_frac
                    )
                    remaining -= tp1_shares
                    tp_hits = 1
                if tp_hits < 2 and high_px >= tp2_px and tp2_shares > 0 and remaining > 0:
                    fill_px = self._apply_exit_slippage(tp2_px, direction, slip_frac)
                    tp_fill_shares = min(tp2_shares, remaining)
                    realised_cash += self._realise_scale_out(
                        entry_price, fill_px, tp_fill_shares, direction, commission_frac
                    )
                    remaining -= tp_fill_shares
                    tp_hits = 2
            else:  # short
                if tp_hits < 1 and low_px <= tp1_px and tp1_shares > 0:
                    fill_px = self._apply_exit_slippage(tp1_px, direction, slip_frac)
                    realised_cash += self._realise_scale_out(
                        entry_price, fill_px, tp1_shares, direction, commission_frac
                    )
                    remaining -= tp1_shares
                    tp_hits = 1
                if tp_hits < 2 and low_px <= tp2_px and tp2_shares > 0 and remaining > 0:
                    fill_px = self._apply_exit_slippage(tp2_px, direction, slip_frac)
                    tp_fill_shares = min(tp2_shares, remaining)
                    realised_cash += self._realise_scale_out(
                        entry_price, fill_px, tp_fill_shares, direction, commission_frac
                    )
                    remaining -= tp_fill_shares
                    tp_hits = 2

            # Trailing stop migration (only when method = or_midpoint_trail)
            if stop_method == "or_midpoint_trail" and not trail_armed:
                if direction == "long" and high_px >= or_high + or_range:
                    # Moved 1× OR-range in favour → migrate stop to OR midpoint
                    trail_stop = or_mid
                    trail_armed = True
                elif direction == "short" and low_px <= or_low - or_range:
                    trail_stop = or_mid
                    trail_armed = True
            if stop_method == "or_midpoint_trail" and trail_armed:
                # Migrate stop with the high/low (trailing by 0.5×OR_range)
                if direction == "long":
                    candidate = highest_high - 0.5 * or_range
                    if candidate > trail_stop:
                        trail_stop = candidate
                else:
                    candidate = lowest_low + 0.5 * or_range
                    if candidate < trail_stop:
                        trail_stop = candidate

        # If we fell off the loop without flattening, close at the last bar's close.
        if remaining > 0:
            last_bar = remaining_bars.iloc[-1]
            raw_exit = float(last_bar["close"])
            exit_price = self._apply_exit_slippage(raw_exit, direction, slip_frac)
            exit_ts = last_bar["ts"].to_pydatetime() if hasattr(last_bar["ts"], "to_pydatetime") else last_bar["ts"]
            realised_cash += self._realise_scale_out(
                entry_price, exit_price, remaining, direction, commission_frac
            )
            remaining = 0
            if exit_reason == "":
                exit_reason = "eod_flat"

        # Recompute realised cash cleanly: sum per-lot P&L minus round-trip commissions.
        # The running realised_cash above tracks scale-out legs correctly; the
        # final-close leg's P&L is already included above. We now compute an
        # overall PnL-per-share verification.
        # For return reporting we just need the aggregate realised_cash.
        pnl_pct_of_equity = realised_cash / equity if equity > 0 else 0.0

        result.exit_ts = exit_ts
        result.exit_price = exit_price
        result.exit_reason = exit_reason
        result.pnl_pct_of_equity = pnl_pct_of_equity
        result.tp_hits = tp_hits
        return result

    # ------------------------------------------------------------------ #
    # Helpers                                                            #
    # ------------------------------------------------------------------ #
    @staticmethod
    def _filter_rth(df: pd.DataFrame) -> pd.DataFrame:
        """Filter to regular-session bars (9:30–15:59 ET).

        Alpaca ``1Min`` data is UTC. We compute the local ET time for each bar
        and keep the ones within the 9:30-16:00 RTH window.
        """

        try:
            local = df["ts"].dt.tz_convert("America/New_York")
        except TypeError:
            # Already tz-naive; assume UTC
            local = pd.to_datetime(df["ts"], utc=True).dt.tz_convert(
                "America/New_York"
            )
        local_time = local.dt.time
        open_t = time(_ET_OPEN_HOUR, _ET_OPEN_MIN)
        close_t = time(_ET_CLOSE_HOUR, _ET_CLOSE_MIN)
        mask = (local_time >= open_t) & (local_time < close_t)
        return df.loc[mask].reset_index(drop=True)

    @staticmethod
    def _to_et(ts: Any) -> datetime:
        """Return the ET-local wall clock for a pd.Timestamp/datetime."""

        if isinstance(ts, pd.Timestamp):
            if ts.tzinfo is None:
                ts = ts.tz_localize("UTC")
            return ts.tz_convert("America/New_York").to_pydatetime()
        if isinstance(ts, datetime):
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            return pd.Timestamp(ts).tz_convert("America/New_York").to_pydatetime()
        return pd.Timestamp(ts, tz="UTC").tz_convert("America/New_York").to_pydatetime()

    @staticmethod
    def _apply_exit_slippage(
        price: float, direction: str, slip_frac: float
    ) -> float:
        """Apply adverse slippage to an exit price.

        Long exits slip down; short exits (buy-to-cover) slip up.
        """

        if direction == "long":
            return price * (1.0 - slip_frac)
        return price * (1.0 + slip_frac)

    @staticmethod
    def _realise_scale_out(
        entry_price: float,
        fill_price: float,
        shares: int,
        direction: str,
        commission_frac: float,
    ) -> float:
        """Return the cash P&L for a partial close.

        P&L = (fill - entry) × shares for longs, (entry - fill) × shares for
        shorts. Subtract commission on the exit leg.
        """

        if shares <= 0:
            return 0.0
        if direction == "long":
            pnl = (fill_price - entry_price) * shares
        else:
            pnl = (entry_price - fill_price) * shares
        pnl -= commission_frac * fill_price * shares
        return pnl

__all__ = ["ORBStrategy", "OrbDayResult"]
