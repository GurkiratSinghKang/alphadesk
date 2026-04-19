"""Time-Series Momentum (TSMOM) — Moskowitz-Ooi-Pedersen 2012.

Equity-accessible multi-asset ETF implementation. See ``spec.md`` for the
academic lineage (Moskowitz-Ooi-Pedersen 2012, Hurst-Ooi-Pedersen 2013).

Rule summary
------------

On the last trading day of each (bi)month, for every asset in the chosen
universe:

1. Compute the sign of the N-month return (or the 1/3/6/12-month ensemble).
2. Estimate realized vol over the last ``realized_vol_window`` trading days.
3. Build raw weights ``w_raw_i = dir_i * target_vol / max(sigma_i, vol_floor)``.
4. Normalize gross exposure to ``target_vol_gross_mul`` (default 1.0).
5. Cap any single-asset weight at ``max_weight_per_asset`` and renormalize.
6. If portfolio drawdown from peak exceeds ``drawdown_delever_threshold``,
   halve every weight before emitting.

The strategy emits:

* ``manage()`` — close any position whose asset is no longer held or whose
  sign has flipped. Emits a ``target_weight=0.0`` MOO exit.
* ``generate_signals()`` — emit target-weight MOO entries/resizes for
  every asset whose new weight differs from the existing position.

Both hooks are no-ops on non-rebalance days. The Moskowitz 2012 spec
explicitly forbids intra-month hard stops (they destroy the signal), so
we emit none.
"""

from __future__ import annotations

import logging
import math
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Iterable, Mapping, Optional

import numpy as np
import pandas as pd

from strategies.base import Context, cache_of
from strategies.registry import (
    StrategyRegistrationError,
    _STRATEGY_CLASSES,
    register_strategy,
)
from strategies.signal import OrderType, Signal

from .config import (
    DEFAULT_PARAMS,
    TSMomentumConfig,
    build_search_space,
)


# --------------------------------------------------------------------------- #
# Internals                                                                   #
# --------------------------------------------------------------------------- #
_NS = "ts_momentum"
# ~252 trading days for the 12m signal + ~90 for the 60d vol window + buffer.
_REQUIRED_LOOKBACK_DAYS = 540


def _safe_register(*args, **kwargs):
    """``@register_strategy`` shim that tolerates double-loading.

    When the package is imported once via the canonical path and once via
    the legacy aggregator, the decorator sees a different class object
    and raises :class:`StrategyRegistrationError`. In that case we return
    the already-registered class.
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
    name="ts_momentum",
    category="macro",
    required_bars=("daily",),
    required_lookback_days=_REQUIRED_LOOKBACK_DAYS,
    min_universe_size=3,
    supports_shorts=True,
    supports_options=False,
    description=(
        "Moskowitz-Ooi-Pedersen 2012 Time-Series Momentum on a 6-11 ETF "
        "multi-asset universe (equities, Treasuries, credit, gold, "
        "commodities, USD, REITs). Sign-of-12m-return signal, "
        "inverse-vol weighting, portfolio vol targeting, monthly "
        "rebalance, drawdown de-lever. Long-short enabled — crisis "
        "alpha comes from the short leg."
    ),
)
class TSMomentumStrategy:
    """Multi-asset TSMOM — see module docstring for rules."""

    name = "ts_momentum"
    required_bars: list[str] = ["daily"]
    required_lookback_days: int = _REQUIRED_LOOKBACK_DAYS

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    def __init__(self) -> None:
        self.config: TSMomentumConfig = TSMomentumConfig.from_params(DEFAULT_PARAMS)
        # Weights computed on the most recent rebalance — the engine reads
        # these out via generate_signals() on the same bar.
        self._target_weights: dict[str, float] = {}

    def configure(self, params: Mapping[str, Any]) -> None:
        self.config = TSMomentumConfig.from_params(params)
        self.required_lookback_days = self.config.warmup_days()
        self._target_weights = {}

    @classmethod
    def search_space(cls) -> dict[str, Any]:
        return build_search_space()

    # ------------------------------------------------------------------ #
    # Universe
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        return list(self.config.universe_tickers())

    # ------------------------------------------------------------------ #
    # Manage (exits first; called before generate_signals)
    # ------------------------------------------------------------------ #
    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        """On a rebalance day, compute the new target weights and close
        any position whose weight has flipped to ~zero.

        On non-rebalance days we still update the running drawdown peak
        so the de-lever gate sees intra-month equity drawdowns. The
        previous behaviour anchored ``peak`` only on rebalance days,
        which made intra-month drawdowns that recovered by month-end
        invisible to the risk-control gate (audit P0 #4).
        """

        # Daily peak tracking — runs every bar regardless of rebalance.
        self._update_drawdown_peak(ctx)

        if not self._is_rebalance_day(asof, ctx):
            return []

        cache = cache_of(ctx)
        weights = self._compute_target_weights(asof, ctx)
        self._target_weights = weights
        cache[f"{_NS}.last_weights"] = dict(weights)

        exits: list[Signal] = []
        for pos in ctx.positions:
            if pos.quantity == 0:
                continue
            sym = pos.symbol
            # If asset dropped out of the universe, or its new weight is
            # ~zero, close it. The engine's target_weight path already
            # handles "new weight differs from old weight" in
            # generate_signals; we emit an explicit exit here only for
            # assets that are leaving the book entirely.
            new_w = weights.get(sym, 0.0)
            if abs(new_w) < 1e-6:
                exits.append(
                    Signal(
                        symbol=sym,
                        target_weight=0.0,
                        order_type=OrderType.MOO,
                        tag="tsm-exit",
                        asof=asof,
                    )
                )
        return exits

    # ------------------------------------------------------------------ #
    # Entries / resizes
    # ------------------------------------------------------------------ #
    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        """Emit the new target-weight MOO orders."""

        if not self._is_rebalance_day(asof, ctx):
            return []

        weights = self._target_weights
        if not weights:
            return []

        out: list[Signal] = []
        for sym, w in weights.items():
            if abs(w) < 1e-6:
                continue
            out.append(
                Signal(
                    symbol=sym,
                    target_weight=float(w),
                    order_type=OrderType.MOO,
                    tag=f"tsm-entry-{('long' if w > 0 else 'short')}",
                    asof=asof,
                )
            )
        return out

    def on_fill(self, fill: Any, ctx: Context) -> None:
        return None

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _update_drawdown_peak(self, ctx: Context) -> None:
        """Refresh the running peak-equity high-water mark.

        Called from ``manage()`` on every bar (not just rebalance days)
        so the drawdown gate inside :meth:`_compute_target_weights` sees
        the true peak — including intra-month highs that recover before
        the next rebalance. The peak is stored on ``ctx.state`` so it
        survives across bars in the same backtest run.
        """

        cache = cache_of(ctx)
        peak_key = f"{_NS}.peak_equity"
        try:
            cur_equity = float(ctx.equity)
        except Exception:
            return
        if not math.isfinite(cur_equity):
            return
        prev = cache.get(peak_key)
        if prev is None or cur_equity > prev:
            cache[peak_key] = cur_equity

    def _is_rebalance_day(self, asof: date, ctx: Context) -> bool:
        freq = self.config.rebalance_freq
        if freq == "monthly":
            return _is_last_trading_day_of_month(asof, ctx)
        if freq == "bimonthly":
            if not _is_last_trading_day_of_month(asof, ctx):
                return False
            return asof.month % 2 == 1
        raise AssertionError(  # pragma: no cover
            f"unexpected rebalance_freq {freq!r}"
        )

    def _compute_target_weights(
        self, asof: date, ctx: Context
    ) -> dict[str, float]:
        """Signal + inverse-vol + cap + drawdown de-lever.

        Returns a dict of ``{symbol: signed_weight}``; sum of |weights| is
        at most ``target_vol_gross_mul`` times the drawdown-de-lever factor.
        """

        cfg = self.config
        tickers = list(cfg.universe_tickers())
        closes = self._fetch_close_panel(asof, ctx, tickers)
        if closes is None or closes.empty:
            return {}

        # Per-asset sign-of-return.
        lookback_days = cfg.signal_lookback_days()
        signals = self._compute_signals(closes, tickers, lookback_days)
        if cfg.shorts_enabled is False:
            for sym, s in list(signals.items()):
                if s < 0:
                    signals[sym] = 0.0

        # Per-asset realized vol (annualized).
        vols = self._compute_realized_vols(closes, tickers, cfg.realized_vol_window)

        # Build raw inverse-vol weights.
        raw: dict[str, float] = {}
        for sym in tickers:
            s = signals.get(sym, 0.0)
            sigma = vols.get(sym, float("nan"))
            if s == 0.0 or not math.isfinite(sigma) or sigma <= 0:
                continue
            sigma_eff = max(sigma, cfg.vol_floor)
            raw[sym] = s * (cfg.target_vol / sigma_eff)

        if not raw:
            return {}

        # Normalize by sum of absolute raw weights so gross == gross_mul
        # before the cap step.
        gross = sum(abs(v) for v in raw.values())
        if gross <= 0:
            return {}
        scale = cfg.target_vol_gross_mul / gross
        weights = {sym: v * scale for sym, v in raw.items()}

        # Cap per-asset weight and renormalize the uncapped legs so the
        # sum of |weights| still equals target_vol_gross_mul.
        weights = self._cap_and_renormalize(
            weights, cfg.max_weight_per_asset, cfg.target_vol_gross_mul
        )

        # Drawdown de-lever. The peak is now refreshed on every bar by
        # ``_update_drawdown_peak`` (see ``manage``) so the dd reading
        # reflects the highest equity seen since inception, not just the
        # last rebalance-day equity. This catches intra-month drawdowns
        # that recover by month-end which the previous code missed.
        cache = cache_of(ctx)
        self._update_drawdown_peak(ctx)
        peak = cache.get(f"{_NS}.peak_equity")
        try:
            cur_equity = float(ctx.equity)
        except Exception:
            cur_equity = float(DEFAULT_PARAMS.get("target_vol_gross_mul", 1.0))
        dd = 0.0
        if peak and peak > 0:
            dd = (peak - cur_equity) / peak
        if dd > cfg.drawdown_delever_threshold and cfg.drawdown_delever_threshold > 0:
            weights = {k: v * 0.5 for k, v in weights.items()}

        # Apply cap one more time (post de-lever caps are always <= pre-delever).
        weights = self._cap_and_renormalize(
            weights, cfg.max_weight_per_asset, sum(abs(v) for v in weights.values())
        )
        return weights

    # ------------------------------------------------------------------ #
    # Bar fetch (cached on ctx.state)
    # ------------------------------------------------------------------ #
    def _fetch_close_panel(
        self, asof: date, ctx: Context, tickers: list[str]
    ) -> Optional[pd.DataFrame]:
        """Return a wide DataFrame of close prices indexed by (asof date).

        Caches the panel on ``ctx.state`` for the life of the backtest;
        re-fetches in a single call whenever the cached panel is stale.
        """

        cache = cache_of(ctx)
        key = f"{_NS}.close_panel"
        panel = cache.get(key) or {}
        need = (
            panel.get("symbols") != tuple(tickers)
            or (panel.get("end") or date.min) < asof
        )
        if need:
            cfg = self.config
            hist_start = asof - timedelta(days=int(cfg.warmup_days() * 1.1))
            hist_end = asof + timedelta(days=400)
            try:
                closes = _fetch_close_panel_raw(
                    ctx.bar_provider, tickers, hist_start, hist_end
                )
            except Exception:
                closes = None
            panel = {
                "symbols": tuple(tickers),
                "data": closes,
                "end": hist_end,
            }
            cache[key] = panel

        closes = panel.get("data")
        if closes is None or closes.empty:
            return None
        closes = closes[closes.index <= pd.Timestamp(asof, tz="UTC")]
        return closes

    @staticmethod
    def _compute_signals(
        closes: pd.DataFrame,
        tickers: list[str],
        lookback_days: tuple[int, ...],
    ) -> dict[str, float]:
        """Average sign-of-return across ``lookback_days``.

        For each symbol, compute ``(close_t / close_{t-L} - 1)`` for each
        ``L`` in ``lookback_days`` and take the mean of the signs. Return
        ``+1`` if mean > 0, ``-1`` if < 0, ``0`` if 0 or any lookback has
        insufficient history.
        """

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
                if r > 0:
                    signs.append(1.0)
                elif r < 0:
                    signs.append(-1.0)
                else:
                    signs.append(0.0)
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

    @staticmethod
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

    @staticmethod
    def _cap_and_renormalize(
        weights: dict[str, float],
        cap: float,
        target_gross: float,
    ) -> dict[str, float]:
        """Apply a per-asset |weight| cap and renormalize the uncapped legs.

        Repeatedly: identify legs whose |w| exceeds ``cap``, pin them at the
        cap (keeping sign), and rescale the remaining legs so the sum of
        |weights| is ``target_gross`` (or lower if cap * N < target_gross).
        Converges in at most N iterations.
        """

        if target_gross <= 0 or not weights:
            return {}

        w = dict(weights)
        pinned: dict[str, float] = {}
        for _ in range(len(w) + 1):
            # Total gross of unpinned legs
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
            # Any new caps?
            new_pins = {}
            for k, v in scaled.items():
                if abs(v) > cap + 1e-9:
                    new_pins[k] = cap if v > 0 else -cap
            if not new_pins:
                # Converged.
                out = {**pinned, **scaled}
                return out
            pinned.update(new_pins)
            for k in new_pins:
                w.pop(k, None)
            # Continue: re-rescale the remaining unpinned legs.
        # Loop guard (should not reach here)
        out: dict[str, float] = dict(pinned)
        return out


# --------------------------------------------------------------------------- #
# Pure helpers (unit-testable; no engine coupling)                            #
# --------------------------------------------------------------------------- #
def _is_last_trading_day_of_month(asof: date, ctx: Context) -> bool:
    """True iff ``asof`` is the last trading day in its calendar month."""

    cal = getattr(ctx, "calendar_provider", None) or getattr(ctx, "calendar", None)
    try:
        if cal is not None and hasattr(cal, "next_session"):
            nxt = cal.next_session(asof)
            nxt_d = nxt if isinstance(nxt, date) else pd.Timestamp(nxt).date()
            return nxt_d.month != asof.month
    except Exception:
        pass

    probe = asof + timedelta(days=1)
    for _ in range(7):
        if probe.month != asof.month:
            break
        if probe.weekday() < 5:
            return False
        probe += timedelta(days=1)
    return asof.weekday() < 5


def _fetch_close_panel_raw(
    provider: Any,
    symbols: list[str],
    start: date,
    end: date,
) -> Optional[pd.DataFrame]:
    """Return a wide DataFrame ``(date × ticker) -> close``."""

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
    wide = wide.ffill()
    return _drop_halted_symbols(wide)


# --------------------------------------------------------------------------- #
# Halt detection (audit P0 #10 cross-cutting fix)                             #
# --------------------------------------------------------------------------- #
# A symbol whose ffilled close panel ends in a long flat tail is almost
# certainly halted (BBBY/SIVB/FRC pattern). The momentum sign + realised
# vol pipeline reads such a tail as a tradable zero-vol / zero-return
# signal, which sizes positions to absurd levels (vol denominator -> 0)
# or treats the name as flat-and-tradable when in reality nothing prints.
_TS_HALT_BARS = 5
_ts_log = logging.getLogger("alphadesk.strategies.ts_momentum")


def _drop_halted_symbols(wide: Optional[pd.DataFrame]) -> Optional[pd.DataFrame]:
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
        _ts_log.warning(
            "ts_momentum: dropping %d halted symbols (>=%d flat closes): %s",
            len(flat),
            _TS_HALT_BARS,
            ",".join(sorted(flat)),
        )
        wide = wide.drop(columns=flat)
    return wide


__all__ = ["TSMomentumStrategy"]
