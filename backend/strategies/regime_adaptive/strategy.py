"""Regime-Adaptive asset allocation (4-regime, monthly rebalance).

Textbook rules (see ``spec.md`` for citations):

1. On each bar classify the market into one of four regimes from SPY,
   SMA_50, SMA_200 and VIX (via VIXY fallback). See §2 of ``spec.md``.
2. Require ``confirmation_days`` consecutive trading days of the new
   label before accepting it as the confirmed regime. See §3.
3. On the last trading session of each (bi)month, if the confirmed
   regime differs from the regime the current allocation was built for,
   rebalance to the target weights from :func:`config.allocation_for`.
   See §4 for the allocation table.
4. Between rebalance days, do nothing — allowed drift.

The strategy stands alone: it does **not** rotate over other
strategies. It is a diversified ETF allocator with a regime-aware
allocation table.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Iterable, Mapping, Optional

import numpy as np
import pandas as pd

from indicators.trend import sma
from indicators.volatility import realized_vol
from strategies.base import Context, cache_of
from strategies.registry import register_strategy
from strategies.signal import OrderType, Signal

from .config import (
    REGIME_REFERENCE,
    REGIMES,
    SIGNAL_ONLY,
    UNIVERSE,
    VIX_PROXY,
    DEFAULT_PARAMS,
    RegimeAdaptiveConfig,
    allocation_for,
    build_search_space,
)


# --------------------------------------------------------------------------- #
# Strategy                                                                    #
# --------------------------------------------------------------------------- #
@register_strategy(
    name="regime_adaptive",
    category="macro",
    required_bars=("daily",),
    # SMA_200 + 20d slow-trigger + 20d confirmation + buffer.
    required_lookback_days=400,
    min_universe_size=8,
    supports_shorts=False,
    supports_options=False,
    description=(
        "Regime-aware asset allocation across 8 ETFs. Classifies the "
        "market daily into TrendUp / MeanRevert / HighVol / Crisis "
        "from SPY trend and VIX level (via VIXY proxy), requires 10 "
        "days of confirmation before switching, and rebalances on "
        "monthly cadence to a pre-defined weight vector for the regime."
    ),
)
class RegimeAdaptiveStrategy:
    """4-regime, monthly ETF allocator — see module docstring.

    The class carries no long-lived model state; regime labels and the
    confirmation streak live on ``ctx.state`` so two concurrent
    backtests of the same class do not clobber each other's state.
    """

    name = "regime_adaptive"
    required_bars: list[str] = ["daily"]
    required_lookback_days: int = 400

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def __init__(self) -> None:
        self.config: RegimeAdaptiveConfig = RegimeAdaptiveConfig.from_params(
            DEFAULT_PARAMS
        )

    def configure(self, params: Mapping[str, Any]) -> None:
        self.config = RegimeAdaptiveConfig.from_params(params)
        self.required_lookback_days = self.config.warmup_days()

    # ------------------------------------------------------------------
    # Universe
    # ------------------------------------------------------------------
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        # Tradable universe + VIX proxy (data-only).
        return list(UNIVERSE) + list(SIGNAL_ONLY)

    # ------------------------------------------------------------------
    # Exits (called BEFORE generate_signals each bar)
    # ------------------------------------------------------------------
    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        """Update daily regime label; emit exits only on rebalance days.

        ``manage()`` is the right place to update the confirmation
        streak because it runs on every bar, not just rebalance days.
        """

        cache = cache_of(ctx)

        # 1. Update the instantaneous + confirmed regime label.
        self._update_regime_state(asof, ctx, cache)

        # 2. On rebalance days, decide whether to rotate.
        if not self._is_rebalance_day(asof, ctx):
            return []

        confirmed = cache.get("ra_confirmed_regime")
        if confirmed is None:
            # Still in warmup — cannot act.
            return []

        current_alloc = cache.get("ra_current_alloc_regime")
        if current_alloc == confirmed:
            # Confirmed regime matches what we're already allocated to.
            return []

        # Queue the target for the same bar; store it so generate_signals
        # can read it.
        cache["ra_pending_target"] = confirmed

        # Exit any position whose new target weight is zero (or that is
        # VIXY, which should never carry a position even transiently).
        target_weights = allocation_for(confirmed, self.config)
        exits: list[Signal] = []
        for pos in ctx.positions:
            if pos.quantity == 0:
                continue
            tw = target_weights.get(pos.symbol, 0.0)
            if pos.symbol in SIGNAL_ONLY or tw <= 0.0:
                exits.append(
                    Signal(
                        symbol=pos.symbol,
                        target_weight=0.0,
                        order_type=OrderType.MOO,
                        tag=f"ra-exit-{confirmed}",
                        asof=asof,
                    )
                )
        return exits

    # ------------------------------------------------------------------
    # Entries
    # ------------------------------------------------------------------
    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        """Emit target_weight signals for each allocated ticker.

        Signals are only emitted on rebalance days when the confirmed
        regime differs from the allocation regime the book is currently
        built against. Between rebalance days, nothing is emitted and
        positions are allowed to drift.
        """

        if not self._is_rebalance_day(asof, ctx):
            return []

        cache = cache_of(ctx)
        target_regime = cache.pop("ra_pending_target", None)
        if target_regime is None:
            return []

        target_weights = allocation_for(target_regime, self.config)

        entries: list[Signal] = []
        for sym in UNIVERSE:
            w = target_weights.get(sym, 0.0)
            if w <= 0.0:
                continue
            entries.append(
                Signal(
                    symbol=sym,
                    target_weight=float(w),
                    order_type=OrderType.MOO,
                    tag=f"ra-entry-{target_regime}",
                    asof=asof,
                )
            )

        # Remember the regime we allocated to.
        cache["ra_current_alloc_regime"] = target_regime
        return entries

    def on_fill(self, fill: Any, ctx: Context) -> None:
        # No per-fill bookkeeping needed.
        return None

    # ------------------------------------------------------------------
    # Regime classifier + hysteresis (operates on ctx.state)
    # ------------------------------------------------------------------
    def _update_regime_state(
        self, asof: date, ctx: Context, cache: dict
    ) -> None:
        """Classify the regime for ``asof`` and advance the streak.

        Writes to ``cache``:
          - ``ra_instant_regime``    (last instantaneous label)
          - ``ra_streak``            (consecutive days of instant_regime)
          - ``ra_confirmed_regime``  (the streak-accepted label)
          - ``ra_regime_history``    (per-day history for reporting)
        """

        instant = self._classify_instantaneous(asof, ctx, cache)
        if instant is None:
            return  # warmup / missing data; do nothing

        # Update streak.
        prev_instant = cache.get("ra_instant_regime")
        if instant == prev_instant:
            cache["ra_streak"] = int(cache.get("ra_streak", 0)) + 1
        else:
            cache["ra_streak"] = 1
        cache["ra_instant_regime"] = instant

        # Promote to confirmed when the streak crosses the threshold.
        conf = cache.get("ra_confirmed_regime")
        if cache["ra_streak"] >= self.config.confirmation_days:
            cache["ra_confirmed_regime"] = instant
        elif conf is None:
            # Bootstrap: the first time we hit confirmation_days of any
            # label, that is our confirmed regime. Until then ``conf`` is
            # None and the strategy does not rebalance.
            pass
        # else: keep previous confirmed regime

        # Track per-day history for reporting.
        hist = cache.setdefault("ra_regime_history", {})
        hist[asof] = {
            "instant": instant,
            "confirmed": cache.get("ra_confirmed_regime"),
            "streak": cache["ra_streak"],
        }

    def _classify_instantaneous(
        self, asof: date, ctx: Context, cache: dict
    ) -> Optional[str]:
        """Return the instantaneous regime label on ``asof``, or None.

        Rule-based classifier — priorities:
          1. Crisis  (slow-grind-bear OR vol-spike-with-downtrend)
          2. HighVol (vol-spike with intact uptrend)
          3. TrendUp (price + fast-MA confirmation + low vol)
          4. MeanRevert (default)

        Reads SPY + VIX-proxy via the cached close panel. Returns None
        during warmup when history is too short.
        """

        panel = self._ensure_panel(asof, ctx, cache)
        if panel is None or panel.empty:
            return None

        # Slice to as-of (inclusive) — never peek forward.
        today_ts = pd.Timestamp(asof, tz="UTC")
        df = panel[panel.index <= today_ts]
        if df.empty:
            return None
        # Need enough history for the slow SMA + crisis slow trigger.
        min_hist = self.config.sma_slow + self.config.crisis_slow_trigger_days
        if len(df) < min_hist:
            return None

        spy = df.get(REGIME_REFERENCE)
        if spy is None or spy.dropna().empty:
            return None

        fast = sma(spy, self.config.sma_fast).iloc[-1]
        slow = sma(spy, self.config.sma_slow).iloc[-1]
        if pd.isna(fast) or pd.isna(slow):
            return None
        spy_close = float(spy.iloc[-1])

        vix_level = self._vix_level(df, asof)
        if vix_level is None:
            return None

        # Grind-bear trigger: SPY below SMA_200 for crisis_slow_trigger_days.
        grind_bear = False
        if len(df) >= self.config.crisis_slow_trigger_days:
            slow_series = sma(spy, self.config.sma_slow)
            window = spy.iloc[-self.config.crisis_slow_trigger_days:]
            window_slow = slow_series.iloc[-self.config.crisis_slow_trigger_days:]
            if not window_slow.isna().any():
                grind_bear = bool((window < window_slow).all())

        vix_low = self.config.vix_low_threshold
        vix_high = self.config.vix_high_threshold

        # 1. Crisis
        if (vix_level > vix_high and spy_close < slow) or grind_bear:
            return "Crisis"
        # 2. HighVol
        if vix_level > vix_high and spy_close >= slow:
            return "HighVol"
        # 3. TrendUp
        if spy_close > slow and fast > slow and vix_level < vix_low:
            return "TrendUp"
        # 4. MeanRevert (default)
        return "MeanRevert"

    # ------------------------------------------------------------------
    # Data helpers
    # ------------------------------------------------------------------
    def _ensure_panel(
        self, asof: date, ctx: Context, cache: dict
    ) -> Optional[pd.DataFrame]:
        """Fetch a wide close-price panel for SPY + VIXY, cache in ctx.state.

        Only refetches when asof advances past the cached panel's end.
        """

        panel = cache.get("ra_close_panel")
        need_refresh = (
            panel is None
            or panel.empty
            or panel.index.max() < pd.Timestamp(asof, tz="UTC")
        )
        if not need_refresh:
            return panel

        # Fetch a wide calendar window so we have plenty of SMA history.
        start = asof - timedelta(days=int(self.config.warmup_days() * 1.2) + 30)
        # Extend forward a bit so we avoid refetching every bar. 180 cal
        # days of buffer -> on average we refetch once per ~120 trading days.
        end = asof + timedelta(days=180)
        symbols = [REGIME_REFERENCE] + list(SIGNAL_ONLY)
        df = _fetch_close_panel(ctx, symbols, start, end)
        if df is None or df.empty:
            return None
        cache["ra_close_panel"] = df
        # Track which VIX path we use for reporting.
        if VIX_PROXY in df.columns and df[VIX_PROXY].dropna().any():
            cache.setdefault("ra_vix_source", "VIXY_x10")
        return df

    def _vix_level(self, df: pd.DataFrame, asof: date) -> Optional[float]:
        """Return a VIX-equivalent level (in VIX points) on or before ``asof``.

        Fallback chain (see ``spec.md`` §5):
          1. ``VIX`` column if a provider ever populates it.
          2. ``I:VIX`` column (Polygon index-prefix).
          3. Fallback: SPY 20-day annualised realized volatility, scaled.

        The VIXY ETN was the originally-intended proxy, but VIXY has
        undergone multiple reverse splits and carries heavy contango
        decay, so its level is not a stable linear function of VIX.
        We therefore compute an "implied VIX" from SPY itself: VIX
        historically trades at ~1.0-1.2× the 20-day realized volatility
        of SPY (realized vol × 100). For regime-threshold purposes this
        is a faithful stand-in. The mapping used here is
        ``vix_equiv = realized_vol_20(SPY) * 100``. This is documented
        in ``spec.md``.
        """

        today_ts = pd.Timestamp(asof, tz="UTC")
        prev = df[df.index <= today_ts]
        if prev.empty:
            return None

        # Direct VIX series (if ever populated).
        for col in ("VIX", "I:VIX"):
            if col in prev.columns:
                v = prev[col].dropna()
                if len(v) > 0:
                    return float(v.iloc[-1])

        # Fallback: 20-day realized vol of SPY, annualised, expressed
        # in VIX points (i.e. percent). Requires >= 21 rows of SPY.
        spy = prev.get(REGIME_REFERENCE)
        if spy is None:
            return None
        spy = spy.dropna()
        if len(spy) < 22:
            return None
        rets = spy.pct_change().dropna()
        rv = realized_vol(rets, period=20, annualize=True)
        last = rv.dropna()
        if last.empty:
            return None
        # rv is a decimal (0.15 = 15%). Convert to a VIX-equivalent using
        # the historical volatility-risk-premium multiplier of ~1.15
        # (VIX has averaged 1.15× realised SPY vol over the post-1990
        # sample). Multiplying by a flat 1.0 (the previous behaviour)
        # under-states the VIX and made the HighVol/Crisis regime gates
        # trigger ~15% more aggressively than spec — audit P0 #7.
        return float(last.iloc[-1]) * 115.0

    # ------------------------------------------------------------------
    # Calendar
    # ------------------------------------------------------------------
    def _is_rebalance_day(self, asof: date, ctx: Context) -> bool:
        """True iff ``asof`` is the last trading day of the (bi)month."""

        freq = self.config.rebalance_freq
        if freq == "monthly":
            return _is_last_trading_day_of_month(asof, ctx)
        if freq == "bimonthly":
            if not _is_last_trading_day_of_month(asof, ctx):
                return False
            return asof.month % 2 == 1
        raise AssertionError(
            f"unexpected rebalance_freq {freq!r}"
        )


# --------------------------------------------------------------------------- #
# Tuner hook                                                                  #
# --------------------------------------------------------------------------- #
@classmethod
def _search_space(cls) -> dict[str, Any]:
    return build_search_space()


RegimeAdaptiveStrategy.search_space = _search_space  # type: ignore[attr-defined]


# --------------------------------------------------------------------------- #
# Pure helpers (no engine coupling — unit-testable standalone)                #
# --------------------------------------------------------------------------- #
def _is_last_trading_day_of_month(asof: date, ctx: Context) -> bool:
    """True iff ``asof`` is the last trading day in its calendar month.

    Uses the calendar provider's ``next_session`` when available;
    otherwise falls back to a Mon-Fri approximation.
    """

    cal = getattr(ctx, "calendar_provider", None) or getattr(
        ctx, "calendar", None
    )
    try:
        if cal is not None and hasattr(cal, "next_session"):
            nxt = cal.next_session(asof)
            nxt_d = (
                nxt if isinstance(nxt, date) else pd.Timestamp(nxt).date()
            )
            return nxt_d.month != asof.month
    except Exception:
        pass

    # Fallback: any later weekday in the same month means we're NOT last.
    probe = asof + timedelta(days=1)
    for _ in range(7):
        if probe.month != asof.month:
            break
        if probe.weekday() < 5:
            return False
        probe += timedelta(days=1)
    return asof.weekday() < 5


def _fetch_close_panel(
    ctx: Context,
    symbols: list[str],
    start: date,
    end: date,
) -> Optional[pd.DataFrame]:
    """Return a wide DataFrame of close prices indexed by date (UTC).

    Columns are tickers; rows are trading-session dates. Missing values
    are forward-filled within each column — we intentionally do NOT
    backfill (that would peek forward).
    """

    provider = getattr(ctx, "bar_provider", None)
    if provider is None:
        return None

    try:
        df = provider.bars(symbols, start, end, tf="1D")
    except Exception:
        return None
    if df is None:
        return None
    df = pd.DataFrame(df)
    if df.empty:
        return None

    cols = {c.lower(): c for c in df.columns}
    sym_c = cols.get("symbol") or cols.get("ticker")
    ts_c = cols.get("ts") or cols.get("timestamp") or cols.get("date")
    close_c = cols.get("close")
    if not (sym_c and ts_c and close_c):
        return None

    long = df[[sym_c, ts_c, close_c]].copy()
    long.columns = ["symbol", "ts", "close"]
    long["ts"] = (
        pd.to_datetime(long["ts"], utc=True)
        .dt.tz_convert("UTC")
        .dt.normalize()
    )
    long = long.dropna(subset=["close"])
    wide = (
        long.pivot_table(
            index="ts", columns="symbol", values="close", aggfunc="last"
        )
        .sort_index()
    )
    wide = wide.ffill()
    return _drop_halted_symbols(wide)


# --------------------------------------------------------------------------- #
# Halt detection (audit P0 #10 cross-cutting fix)                             #
# --------------------------------------------------------------------------- #
# After ffill, a halted name's tail is a flat run of identical closes;
# the realised-vol regime classifier reads that as zero-vol and slots
# the name into a Trend regime, which then sizes into an untradable
# name. Drop halted symbols before any regime computation runs.
_RA_HALT_BARS = 5
_ra_log = logging.getLogger("alphadesk.strategies.regime_adaptive.fetch")


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
        _ra_log.warning(
            "regime_adaptive: dropping %d halted symbols (>=%d flat closes): %s",
            len(flat),
            _RA_HALT_BARS,
            ",".join(sorted(flat)),
        )
        wide = wide.drop(columns=flat)
    return wide


__all__ = ["RegimeAdaptiveStrategy"]
