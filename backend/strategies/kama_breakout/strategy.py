"""KAMA Breakout — Kaufman adaptive MA + Donchian breakout + ER gate.

See ``spec.md`` for the academic lineage and full rule set. This module
implements the :class:`backend.strategies.base.Strategy` protocol.

Design-spec section references:

* Entry: ``close > KAMA`` AND ``close > Donchian_upper`` AND ``ER >= er_min_trend``
  AND ``close > SMA_200`` (rising). Signals fire MOO so they fill at T+1 open.
* Exit: chandelier trailing stop (``HH_22 - 3*ATR``) OR KAMA crossunder.
  No hard take-profit — trend strategies must let winners run.
* Sizing: volatility parity at 1% of equity per trade,
  ``shares = risk * equity / stop_distance`` (fixes the legacy 3%-instead-of-1%
  bug the audit flagged).
* Pyramiding: add 1/2 size at +1 ATR advance. Cap total allocation 15%.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Iterable, Mapping, Optional

import numpy as np
import pandas as pd

from backend.indicators.trend import donchian, kama, sma
from backend.indicators.volatility import atr
from backend.strategies.base import Context, cache_of
from backend.strategies.registry import register_strategy
from backend.strategies.signal import OrderType, Signal

from .config import DEFAULTS, DEFAULT_UNIVERSE, search_space as _cfg_search_space

log = logging.getLogger("alphadesk.strategies.kama_breakout")


# ----------------------------------------------------------------------------
# Per-position state carried in ctx.cache["positions"] — keyed by symbol.
# ----------------------------------------------------------------------------
@dataclass
class _PosState:
    """State the strategy tracks per open position (not by the engine)."""

    entry_ts: Optional[date] = None
    entry_price: float = 0.0
    atr_at_entry: float = 0.0
    highest_high: float = 0.0          # ratchets up each bar the pos is open
    pyramid_count: int = 0             # how many add-ons we've done
    shares_initial: int = 0            # from the first entry (for pyramid sizing)


# ----------------------------------------------------------------------------
# Registered strategy class
# ----------------------------------------------------------------------------
@register_strategy(
    name="kama_breakout",
    category="equity",
    # Need KAMA + Donchian + ATR + 200-SMA warmup, plus slack for ER & volume.
    required_bars=("daily",),
    required_lookback_days=260,
    min_universe_size=1,
    supports_shorts=False,
    supports_options=False,
    description=(
        "Kaufman adaptive MA + Donchian 20 breakout, gated by Efficiency "
        "Ratio and 200-SMA trend filter. Chandelier trailing stop, "
        "volatility-parity sizing, 1/2 size pyramid at +1 ATR."
    ),
)
class KamaBreakout:
    """Long-only adaptive-MA trend-following strategy."""

    name = "kama_breakout"
    required_bars: list[str] = ["daily"]
    required_lookback_days: int = 260

    # ---------- construction + configuration ---------------------------------
    def __init__(self) -> None:
        # Copy defaults; overridden by configure().
        self._p: dict[str, Any] = dict(DEFAULTS)
        self._universe_cache: Optional[list[str]] = None

    def configure(self, params: Mapping[str, Any]) -> None:
        """Coerce / validate parameter overrides."""

        merged = dict(DEFAULTS)
        merged.update(params or {})
        # Integer coercions
        for k in (
            "kama_er_period",
            "kama_fast",
            "kama_slow",
            "donchian_period",
            "atr_period",
            "trend_sma_period",
            "max_positions",
            "volume_sma_period",
            "earnings_skip_days",
        ):
            merged[k] = int(merged[k])
        # Float coercions
        for k in (
            "chandelier_atr_mult",
            "er_min_trend",
            "risk_per_trade",
            "max_allocation",
            "volume_surge_min",
            "pyramid_trigger_atr",
            "pyramid_size_fraction",
        ):
            merged[k] = float(merged[k])
        # Bool coercions
        for k in ("volume_surge_enabled", "pyramid_enabled"):
            merged[k] = bool(merged[k])

        # Universe normalisation
        syms = merged.get("universe_symbols") or DEFAULT_UNIVERSE
        if isinstance(syms, str):
            merged["universe_symbols"] = (syms,)
        else:
            merged["universe_symbols"] = tuple(str(s).upper() for s in syms)

        # Sanity checks
        if merged["kama_fast"] >= merged["kama_slow"]:
            raise ValueError(
                f"kama_fast ({merged['kama_fast']}) must be < kama_slow "
                f"({merged['kama_slow']})"
            )
        if not (0.0 < merged["risk_per_trade"] < 0.1):
            raise ValueError(
                f"risk_per_trade={merged['risk_per_trade']} out of (0, 0.1]"
            )
        if not (0.0 < merged["max_allocation"] <= 1.0):
            raise ValueError(
                f"max_allocation={merged['max_allocation']} out of (0, 1]"
            )

        self._p = merged
        self._universe_cache = list(merged["universe_symbols"])
        log.debug("kama_breakout configured with %s", self._p)

    # ---------- lifecycle hooks ---------------------------------------------
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        return self._universe_cache or list(DEFAULT_UNIVERSE)

    def generate_signals(
        self, asof: date, ctx: Context
    ) -> Iterable[Signal]:
        """Emit entry signals for names whose rules all fire on bar ``asof``.

        All signals are MOO -> fill at next bar's open.
        """

        cache = cache_of(ctx)
        pos_state: dict[str, _PosState] = cache.setdefault("positions", {})

        # Count currently-open positions (after engine mark-to-market).
        open_positions = [p for p in ctx.positions if p.quantity != 0]
        n_open = len(open_positions)

        max_pos = int(self._p["max_positions"])
        if n_open >= max_pos:
            return []

        open_symbols = {p.symbol for p in open_positions}
        candidates: list[tuple[str, Signal, float]] = []  # (symbol, signal, er)

        for sym in self._universe_cache or []:
            if sym in open_symbols:
                continue
            try:
                sig, er = self._entry_signal(sym, asof, ctx)
            except Exception:  # pragma: no cover - defensive
                log.exception("entry evaluation failed for %s", sym)
                continue
            if sig is not None:
                candidates.append((sym, sig, er))

        if not candidates:
            return []

        # Rank by ER descending so we take the strongest trend signals first.
        candidates.sort(key=lambda t: t[2], reverse=True)
        slots = max_pos - n_open
        picked = candidates[:slots]

        # Record pending entry state so on_fill can populate _PosState fields.
        pending = cache.setdefault("pending_entries", {})
        for sym, sig, _er in picked:
            pending[sym] = {
                "atr": float(sig.stop_price or 0.0),  # will be overwritten
                "asof": asof,
            }

        return [sig for _, sig, _ in picked]

    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        """Update trailing stops, exit on KAMA crossunder, handle pyramids."""

        cache = cache_of(ctx)
        pos_state: dict[str, _PosState] = cache.setdefault("positions", {})
        pending = cache.setdefault("pending_entries", {})

        out: list[Signal] = []
        for pos in list(ctx.positions):
            if pos.quantity <= 0:  # long-only
                continue
            sym = pos.symbol
            st = pos_state.get(sym)
            if st is None:
                # Filled but on_fill didn't stash state (e.g. first bar after
                # restart). Seed a best-effort entry record from the position.
                st = _PosState(
                    entry_ts=asof,
                    entry_price=float(pos.avg_price),
                    atr_at_entry=0.0,
                    highest_high=float(pos.last_price or pos.avg_price),
                    shares_initial=pos.quantity,
                )
                pos_state[sym] = st

            # Pull recent bars to evaluate exits / pyramids.
            df = self._history(sym, asof, ctx)
            if df is None or len(df) < self._min_history():
                continue

            close = float(df["close"].iloc[-1])
            high = float(df["high"].iloc[-1])

            # Ratchet highest_high.
            if high > st.highest_high:
                st.highest_high = high

            # KAMA / ATR recomputed on the full history.
            kama_series = kama(
                df["close"],
                er_period=self._p["kama_er_period"],
                fast=self._p["kama_fast"],
                slow=self._p["kama_slow"],
            )
            kama_last = float(kama_series.iloc[-1]) if not pd.isna(
                kama_series.iloc[-1]
            ) else None
            atr_series = atr(
                df["high"], df["low"], df["close"], period=self._p["atr_period"]
            )
            atr_last = float(atr_series.iloc[-1]) if not pd.isna(
                atr_series.iloc[-1]
            ) else None

            # --- Exit conditions ---
            # 1) Chandelier trailing stop.
            if atr_last and atr_last > 0:
                chandelier_stop = (
                    st.highest_high - float(self._p["chandelier_atr_mult"]) * atr_last
                )
                if close <= chandelier_stop:
                    out.append(
                        Signal(
                            symbol=sym,
                            target_weight=0.0,
                            order_type=OrderType.MOO,
                            tag="chandelier",
                        )
                    )
                    continue

            # 2) KAMA crossunder.
            if kama_last is not None and close < kama_last:
                out.append(
                    Signal(
                        symbol=sym,
                        target_weight=0.0,
                        order_type=OrderType.MOO,
                        tag="kama_crossunder",
                    )
                )
                continue

            # --- Pyramiding ---
            if (
                self._p["pyramid_enabled"]
                and st.pyramid_count == 0
                and st.atr_at_entry > 0
                and close - st.entry_price
                >= float(self._p["pyramid_trigger_atr"]) * st.atr_at_entry
            ):
                # Add half the initial shares, respecting max_allocation cap.
                pyramid_shares = int(
                    round(
                        st.shares_initial * float(self._p["pyramid_size_fraction"])
                    )
                )
                if pyramid_shares > 0:
                    max_alloc = float(self._p["max_allocation"])
                    equity = float(ctx.equity)
                    cur_notional = abs(pos.quantity) * close
                    max_notional = max_alloc * equity
                    max_add_shares = int(
                        max(0, (max_notional - cur_notional) // close)
                    )
                    add_qty = min(pyramid_shares, max_add_shares)
                    if add_qty > 0:
                        out.append(
                            Signal(
                                symbol=sym,
                                quantity=pos.quantity + add_qty,
                                order_type=OrderType.MOO,
                                tag="pyramid",
                            )
                        )
                        st.pyramid_count += 1

        # Clean out stale pending entries (older than 2 sessions).
        stale = [
            s
            for s, info in pending.items()
            if (asof - info["asof"]).days > 3
        ]
        for s in stale:
            pending.pop(s, None)

        return out

    def on_fill(self, fill: Any, ctx: Context) -> None:
        """Record per-position state after an entry fill."""

        cache = cache_of(ctx)
        pos_state: dict[str, _PosState] = cache.setdefault("positions", {})
        pending: dict[str, dict] = cache.setdefault("pending_entries", {})
        sym = fill.symbol

        # If the fill closes the position (exit), wipe state.
        pos_after = ctx.position(sym)
        if pos_after is None or pos_after.quantity == 0:
            pos_state.pop(sym, None)
            pending.pop(sym, None)
            return

        # This is an entry or pyramid add. First-time entry: seed state.
        st = pos_state.get(sym)
        if st is None:
            # Pull a few bars to derive ATR at entry if we can.
            df = self._history(sym, ctx.asof, ctx)
            atr_entry = 0.0
            if df is not None and len(df) >= self._p["atr_period"] + 2:
                a = atr(
                    df["high"],
                    df["low"],
                    df["close"],
                    period=self._p["atr_period"],
                )
                if not pd.isna(a.iloc[-1]):
                    atr_entry = float(a.iloc[-1])
            price = float(fill.price)
            pos_state[sym] = _PosState(
                entry_ts=ctx.asof,
                entry_price=price,
                atr_at_entry=atr_entry,
                highest_high=price,
                shares_initial=abs(int(fill.quantity)),
                pyramid_count=0,
            )
        else:
            # Pyramid add: just leave the original entry_price / shares_initial
            # alone; ATR and pyramid_count are already set in manage().
            pass

        pending.pop(sym, None)

    # ---------- tuner --------------------------------------------------------
    @classmethod
    def search_space(cls) -> dict[str, Any]:
        """Defer to :func:`config.search_space`."""

        return _cfg_search_space()

    # ---------- internals ----------------------------------------------------
    def _entry_signal(
        self, sym: str, asof: date, ctx: Context
    ) -> tuple[Optional[Signal], float]:
        """Evaluate the entry gates for one symbol. Return (signal | None, ER)."""

        df = self._history(sym, asof, ctx)
        if df is None or len(df) < self._min_history():
            return None, 0.0

        # ------- indicators -------------------------------------------------
        close = df["close"].astype("float64")
        high = df["high"].astype("float64")
        low = df["low"].astype("float64")

        kama_series = kama(
            close,
            er_period=self._p["kama_er_period"],
            fast=self._p["kama_fast"],
            slow=self._p["kama_slow"],
        )
        if pd.isna(kama_series.iloc[-1]):
            return None, 0.0

        # Donchian using bars up to and *excluding* today, so we compare
        # today's close to yesterday's channel (no same-bar lookahead).
        donch = donchian(high.shift(1), low.shift(1), period=int(self._p["donchian_period"]))
        donch_upper = donch["upper"].iloc[-1]
        if pd.isna(donch_upper):
            return None, 0.0

        sma_trend = sma(close, period=int(self._p["trend_sma_period"]))
        sma_last = sma_trend.iloc[-1]
        if pd.isna(sma_last):
            return None, 0.0
        sma_lookback = 10
        if len(sma_trend) > sma_lookback:
            sma_prev = sma_trend.iloc[-1 - sma_lookback]
            sma_rising = (not pd.isna(sma_prev)) and float(sma_last) > float(sma_prev)
        else:
            sma_rising = False

        atr_series = atr(high, low, close, period=int(self._p["atr_period"]))
        atr_last = atr_series.iloc[-1]
        if pd.isna(atr_last) or float(atr_last) <= 0:
            return None, 0.0

        # Efficiency ratio over the same window as KAMA.
        er = _efficiency_ratio(close, int(self._p["kama_er_period"]))

        # ------- gates ------------------------------------------------------
        c_last = float(close.iloc[-1])
        kama_last = float(kama_series.iloc[-1])

        # 1. Price above KAMA
        if c_last <= kama_last:
            return None, er
        # 2. Donchian breakout
        if c_last <= float(donch_upper):
            return None, er
        # 3. ER gate — THE FIX.
        if er < float(self._p["er_min_trend"]):
            return None, er
        # 4. Secular trend filter.
        if c_last <= float(sma_last):
            return None, er
        if not sma_rising:
            return None, er
        # 5. Volume surge (optional).
        if bool(self._p["volume_surge_enabled"]):
            vol_sma = (
                df["volume"]
                .astype("float64")
                .rolling(int(self._p["volume_sma_period"]))
                .mean()
            )
            if pd.isna(vol_sma.iloc[-1]) or vol_sma.iloc[-1] <= 0:
                return None, er
            if float(df["volume"].iloc[-1]) < float(
                self._p["volume_surge_min"]
            ) * float(vol_sma.iloc[-1]):
                return None, er
        # 6. Earnings window (graceful degradation).
        if self._has_earnings_soon(sym, asof, ctx):
            return None, er

        # ------- sizing: volatility-parity, 1% risk per trade --------------
        stop_distance = float(self._p["chandelier_atr_mult"]) * float(atr_last)
        if stop_distance <= 0:
            return None, er
        risk_dollars = float(self._p["risk_per_trade"]) * float(ctx.equity)
        shares = int(risk_dollars // stop_distance)

        # Cap by max_allocation.
        max_notional = float(self._p["max_allocation"]) * float(ctx.equity)
        cap_shares = int(max_notional // c_last) if c_last > 0 else 0
        shares = min(shares, cap_shares)
        if shares <= 0:
            return None, er

        sig = Signal(
            symbol=sym,
            quantity=shares,
            order_type=OrderType.MOO,
            asof=asof,
            tag=f"entry er={er:.2f}",
        )
        return sig, er

    # -- history ------------------------------------------------------------
    def _history(
        self, sym: str, asof: date, ctx: Context
    ) -> Optional[pd.DataFrame]:
        """Pull the indicator-window history for one symbol up to ``asof``.

        We fetch the *entire* historical window once per symbol on the first
        call and then slice it on each subsequent ``asof``. This avoids the
        N^2 HTTP load that would otherwise hit the provider with one fetch
        per (symbol, session) pair. Returns ``None`` on provider failure or
        insufficient data.
        """

        cache = cache_of(ctx)
        full_cache: dict[str, Optional[pd.DataFrame]] = cache.setdefault(
            "_bars_full", {}
        )

        full = full_cache.get(sym)
        if full is None and sym not in full_cache:
            # Fetch a generous upper-bound window.
            lookback = int(self._p["trend_sma_period"]) + 90
            fetch_start = asof - timedelta(days=int(lookback * 1.8))
            fetch_end = asof + timedelta(days=2)
            try:
                df = ctx.bar_provider.bars([sym], fetch_start, fetch_end, tf="1D")
            except Exception:  # pragma: no cover - provider surface varies
                full_cache[sym] = None
                return None
            if df is None or len(df) == 0:
                full_cache[sym] = None
                return None
            full = self._normalise_bars(df, sym)
            full_cache[sym] = full

        if full is None or full.empty:
            return None

        asof_ts = pd.Timestamp(asof).tz_localize("UTC")
        # Keep bars whose timestamp is on or before end-of-day asof.
        cutoff = asof_ts + pd.Timedelta(hours=23, minutes=59)
        sliced = full[full.index <= cutoff]

        # If the last cached bar is behind asof, refetch (live backtests or
        # forward-walk tests). We refetch at most once per symbol per 30-day
        # window to stay cheap.
        last_cached = full.index.max() if not full.empty else None
        if last_cached is None or (asof_ts - last_cached) > pd.Timedelta(days=30):
            try:
                fetch_end = asof_ts + pd.Timedelta(days=2)
                fetch_start = (last_cached or (asof_ts - pd.Timedelta(days=60)))
                extra = ctx.bar_provider.bars(
                    [sym], fetch_start.date(), fetch_end.date(), tf="1D"
                )
                extra_df = self._normalise_bars(extra, sym)
                if extra_df is not None and not extra_df.empty:
                    full = pd.concat([full, extra_df])
                    full = full[~full.index.duplicated(keep="last")].sort_index()
                    full_cache[sym] = full
                    sliced = full[full.index <= cutoff]
            except Exception:
                pass

        if sliced is None or sliced.empty:
            return None
        return sliced

    @staticmethod
    def _normalise_bars(df: Any, sym: str) -> Optional[pd.DataFrame]:
        """Turn a raw provider DataFrame into the indicator-ready shape."""

        if df is None:
            return None
        df = pd.DataFrame(df)
        if df.empty:
            return None
        cols = {c.lower(): c for c in df.columns}
        sym_col = cols.get("symbol") or cols.get("ticker")
        if sym_col is not None:
            df = df[df[sym_col] == sym]
        if df.empty:
            return None
        ts_col = cols.get("timestamp") or cols.get("date") or cols.get("ts")
        if ts_col is None:
            return None
        df = df.copy()
        df["_ts"] = pd.to_datetime(df[ts_col], utc=True, errors="coerce")
        df = df.dropna(subset=["_ts"])
        df = df.sort_values("_ts").drop_duplicates("_ts", keep="last")
        df = df.rename(
            columns={
                cols.get("open", "open"): "open",
                cols.get("high", "high"): "high",
                cols.get("low", "low"): "low",
                cols.get("close", "close"): "close",
                cols.get("volume", "volume"): "volume",
            }
        )
        for c in ("open", "high", "low", "close", "volume"):
            if c in df.columns:
                df[c] = pd.to_numeric(df[c], errors="coerce")
        df = df.dropna(subset=["open", "high", "low", "close"])
        df = df.set_index("_ts")
        return df

    def _min_history(self) -> int:
        # Need enough bars for the 200-SMA plus a little slack.
        return int(self._p["trend_sma_period"]) + 15

    # -- earnings gate ------------------------------------------------------
    def _has_earnings_soon(
        self, sym: str, asof: date, ctx: Context
    ) -> bool:
        """Return True if ``sym`` reports within ``earnings_skip_days`` days.

        Degrades to False if the provider is unavailable / raises.
        """

        provider = getattr(ctx, "earnings_provider", None)
        if provider is None or not hasattr(provider, "calendar"):
            return False
        days = int(self._p["earnings_skip_days"])
        start = asof - timedelta(days=days)
        end = asof + timedelta(days=days)
        try:
            cal = provider.calendar(start, end, symbols=[sym])
        except Exception:
            return False
        if cal is None:
            return False
        try:
            df = pd.DataFrame(cal)
        except Exception:
            return False
        return not df.empty


# ---------------------------------------------------------------------------
# Efficiency Ratio helper (standalone; not in indicators library currently)
# ---------------------------------------------------------------------------
def _efficiency_ratio(close: pd.Series, period: int) -> float:
    """Kaufman's Efficiency Ratio at the last bar.

    ER = |close_t - close_{t-N}| / sum(|Δclose|)   over the same N bars.
    Returns 0.0 when the denominator is zero (flat market) or when there
    aren't enough bars.
    """

    if period <= 0 or len(close) <= period:
        return 0.0
    vals = close.astype("float64").to_numpy()
    change = abs(float(vals[-1] - vals[-1 - period]))
    diffs = np.abs(np.diff(vals[-1 - period:]))
    vol = float(diffs.sum())
    if vol <= 0:
        return 0.0
    return change / vol


__all__ = ["KamaBreakout"]
