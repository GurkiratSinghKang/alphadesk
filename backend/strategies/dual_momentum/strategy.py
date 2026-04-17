"""Dual Momentum (GEM) — Antonacci's Global Equities Momentum.

Textbook rules (see ``spec.md`` for the full citation):

1. On the last trading session of each month, compute the 12-month excess
   return of the US-equity sleeve vs. a T-bill proxy. If excess > 0, the
   equity gate passes and we go to step 2; otherwise go to step 3.
2. Rank the equity universe (US + ex-US) by 12-month return. Hold 100%
   of the top-ranked sleeve. MOO at next bar's open.
3. Hold 100% of the bond fallback (default AGG). MOO at next bar's open.
4. Between rebalance days do nothing. No stops, no take-profits.

Implementation is a simple state machine: ``manage()`` on the rebalance
day closes the prior sleeve, and ``generate_signals()`` on the same day
emits the next sleeve's MOO. All other bars are no-ops.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Iterable, Mapping, Optional

import pandas as pd

from backend.strategies.base import Context, cache_of
from backend.strategies.registry import register_strategy
from backend.strategies.signal import OrderType, Signal

from .config import DEFAULT_PARAMS, DualMomentumConfig, build_search_space


# --------------------------------------------------------------------------- #
# Strategy                                                                     #
# --------------------------------------------------------------------------- #
@register_strategy(
    name="dual_momentum",
    category="macro",
    required_bars=("daily",),
    # Engine warmup in *calendar* days. 252 trading days ~= 365+14 cal days.
    required_lookback_days=400,
    min_universe_size=3,
    supports_shorts=False,
    supports_options=False,
    description=(
        "Antonacci's Global Equities Momentum (GEM): rotate between US "
        "equity (VOO), ex-US equity (VEU) and aggregate bonds (AGG) on a "
        "monthly cadence using a 12-month absolute + relative momentum "
        "signal. Single asset, no stops, month-end-only rebalances."
    ),
)
class DualMomentumStrategy:
    """Antonacci's GEM — see module docstring.

    The class name ``DualMomentumStrategy`` matches the legacy class from
    ``backend/strategies/dual_momentum.py`` so the legacy
    ``backend/strategies/__init__.py`` import-aggregator keeps working
    during the Phase 1 → Phase 2 migration window. A descriptive alias
    ``DualMomentumGEM`` is exported alongside for code that wants to make
    the strategy-family intent explicit at the import site.
    """

    name = "dual_momentum"
    required_bars: list[str] = ["daily"]
    required_lookback_days: int = 400  # calendar days; see decorator comment

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def __init__(self) -> None:
        self.config: DualMomentumConfig = DualMomentumConfig.from_params(
            DEFAULT_PARAMS
        )
        # _target is the ticker we want to be holding after today's
        # rebalance decision. The engine closes whatever else we hold via
        # ``manage()`` and opens _target via ``generate_signals()``.
        self._target: Optional[str] = None

    def configure(self, params: Mapping[str, Any]) -> None:
        self.config = DualMomentumConfig.from_params(params)
        # Propagate warmup to the engine. The engine only reads this once
        # at construction so in practice the default (400) is what wins,
        # but we still keep the attribute in sync for clarity.
        self.required_lookback_days = self.config.warmup_days()
        self._target = None

    # ------------------------------------------------------------------
    # Universe
    # ------------------------------------------------------------------
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        cfg = self.config
        syms: list[str] = list(cfg.relative_universe)
        if cfg.bond_fallback not in syms:
            syms.append(cfg.bond_fallback)
        if cfg.risk_free_symbol not in syms:
            syms.append(cfg.risk_free_symbol)
        return syms

    # ------------------------------------------------------------------
    # Exits  (called BEFORE generate_signals each bar)
    # ------------------------------------------------------------------
    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        """Close any position that isn't the selected target.

        We only compute and apply the target on rebalance days; on other
        bars we leave existing positions alone.
        """

        if not self._is_rebalance_day(asof, ctx):
            return []

        cache = cache_of(ctx)
        target = self._compute_target(asof, ctx)
        cache["dm_last_target"] = target
        self._target = target

        # Close everything that isn't the target. (Usually at most one
        # non-target equity position.)
        exits: list[Signal] = []
        for pos in ctx.positions:
            if pos.quantity == 0:
                continue
            if pos.symbol == target:
                continue
            exits.append(
                Signal(
                    symbol=pos.symbol,
                    target_weight=0.0,
                    order_type=OrderType.MOO,
                    tag="dm-exit",
                    asof=asof,
                )
            )
        return exits

    # ------------------------------------------------------------------
    # Entries
    # ------------------------------------------------------------------
    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        """Open the target sleeve at 100% on rebalance days."""

        if self._target is None:
            return []
        if not self._is_rebalance_day(asof, ctx):
            return []

        # If we're already holding the target at ~100%, skip — the engine
        # computes deltas, but skipping avoids a no-op audit trail.
        for pos in ctx.positions:
            if pos.symbol == self._target and pos.quantity > 0:
                return []

        sig = Signal(
            symbol=self._target,
            target_weight=1.0,
            order_type=OrderType.MOO,
            tag=f"dm-entry-{self._target}",
            asof=asof,
        )
        return [sig]

    def on_fill(self, fill: Any, ctx: Context) -> None:
        # Nothing to stash — Antonacci's GEM is stateless between bars.
        return None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _is_rebalance_day(self, asof: date, ctx: Context) -> bool:
        """True iff ``asof`` is the last trading day of the (bi)month."""

        freq = self.config.rebalance_freq
        if freq == "monthly":
            return _is_last_trading_day_of_month(asof, ctx)
        if freq == "bimonthly":
            # Rebalance at the end of every odd month (Jan/Mar/May/...).
            if not _is_last_trading_day_of_month(asof, ctx):
                return False
            return asof.month % 2 == 1
        raise AssertionError(  # pragma: no cover
            f"unexpected rebalance_freq {freq!r}"
        )

    def _compute_target(self, asof: date, ctx: Context) -> str:
        """Run the GEM decision logic and return the ticker to hold.

        Returns the bond-fallback ticker if the equity gate fails or if
        data is insufficient to score the signal.
        """

        cfg = self.config
        us_sym = cfg.relative_universe[0]
        rf_sym = cfg.risk_free_symbol
        symbols = list(cfg.relative_universe) + [cfg.bond_fallback, rf_sym]

        # Fetch once per (universe, backtest) and extend forward as the
        # backtest advances. ``ctx.state`` is preserved across bars, so
        # caching the full-history panel here turns N rebalance-day
        # fetches per backtest into ~1 per universe change.
        cache = cache_of(ctx)
        panel = cache.get("dm_close_panel") or {}
        need = (
            panel.get("symbols") != tuple(symbols)
            or (panel.get("end") or date.min) < asof
        )
        if need:
            hist_start = asof - timedelta(days=int(cfg.max_lookback() * 1.55) + 21)
            hist_end = asof + timedelta(days=400)
            try:
                closes = _fetch_close_panel(ctx, symbols, hist_start, hist_end)
            except Exception:
                closes = None
            panel = {"symbols": tuple(symbols), "data": closes, "end": hist_end}
            cache["dm_close_panel"] = panel

        closes = panel["data"]
        if closes is None or closes.empty:
            return cfg.bond_fallback

        # Slice to ``asof`` — do not leak future bars into today's signal.
        closes = closes[closes.index <= pd.Timestamp(asof, tz="UTC")]
        if closes.empty:
            return cfg.bond_fallback

        components = cfg.lookback_components()
        eq_scores: dict[str, float] = {}
        for sym in cfg.relative_universe:
            r = _composite_return(closes, sym, components)
            if r is None:
                return cfg.bond_fallback       # missing history → bonds
            eq_scores[sym] = r

        rf_r = _composite_return(closes, rf_sym, components)
        if rf_r is None:
            return cfg.bond_fallback

        # Absolute-momentum gate.
        if eq_scores[us_sym] - rf_r <= cfg.excess_return_floor:
            return cfg.bond_fallback

        # Relative-momentum: highest-scoring equity sleeve wins.
        return max(eq_scores.items(), key=lambda kv: kv[1])[0]


# --------------------------------------------------------------------------- #
# Tuner hook                                                                   #
# --------------------------------------------------------------------------- #
@classmethod
def _search_space(cls) -> dict[str, Any]:
    return build_search_space()


# Attach as a classmethod after definition to keep the class body readable.
DualMomentumStrategy.search_space = _search_space  # type: ignore[attr-defined]

# Descriptive alias — same class, clearer intent at the import site.
DualMomentumGEM = DualMomentumStrategy


# --------------------------------------------------------------------------- #
# Pure helpers (no engine coupling — unit-testable standalone)                 #
# --------------------------------------------------------------------------- #
def _is_last_trading_day_of_month(asof: date, ctx: Context) -> bool:
    """True iff ``asof`` is the last trading day in its calendar month.

    Uses ``ctx.calendar_provider.next_session`` when available; otherwise
    falls back to a Mon-Fri approximation.
    """

    cal = getattr(ctx, "calendar_provider", None) or getattr(ctx, "calendar", None)
    try:
        if cal is not None and hasattr(cal, "next_session"):
            nxt = cal.next_session(asof)
            nxt_d = nxt if isinstance(nxt, date) else pd.Timestamp(nxt).date()
            return nxt_d.month != asof.month
    except Exception:
        pass

    # Fallback: any later weekday in the same month means we're NOT last.
    probe = asof + timedelta(days=1)
    for _ in range(7):                 # cap lookahead at one week
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
    """Return a wide DataFrame of close prices indexed by date.

    Columns are tickers; rows are trading-session dates. Missing values
    are forward-filled within each column and then dropped at the head.
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
    long["ts"] = pd.to_datetime(long["ts"], utc=True).dt.tz_convert("UTC").dt.normalize()
    long = long.dropna(subset=["close"])
    wide = (
        long.pivot_table(index="ts", columns="symbol", values="close", aggfunc="last")
        .sort_index()
    )
    # Forward-fill small gaps (holidays aligned between tickers). We
    # intentionally do NOT backfill — that would peek forward.
    wide = wide.ffill()
    return wide


def _composite_return(
    closes: pd.DataFrame,
    symbol: str,
    components: tuple[tuple[int, float], ...],
) -> Optional[float]:
    """Weighted total-return composite over multiple lookbacks.

    ``components`` is ``((L1, w1), (L2, w2), ...)`` with ``sum(w) == 1``.
    Returns ``None`` when any single component cannot be computed (e.g.
    not enough history).
    """

    if symbol not in closes.columns:
        return None
    series = closes[symbol].dropna()
    n = len(series)
    total = 0.0
    total_w = 0.0
    for L, w in components:
        # We need L+1 observations (today + L trading days ago).
        if n < L + 1:
            return None
        now = float(series.iloc[-1])
        then = float(series.iloc[-(L + 1)])
        if then <= 0:
            return None
        r = now / then - 1.0
        total += w * r
        total_w += w
    if total_w <= 0:
        return None
    return total / total_w


__all__ = ["DualMomentumStrategy", "DualMomentumGEM"]
