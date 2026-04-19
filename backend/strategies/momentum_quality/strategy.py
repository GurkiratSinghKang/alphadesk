"""Momentum + Quality — production implementation.

Cross-sectional long-only factor strategy combining Jegadeesh-Titman 12-1
month momentum with the Piotroski F-score quality signal. Monthly rebalance
into the top-N composite-ranked names from a fixed ~50-name S&P 500-style
universe (ex-Financials / ex-Utilities per AFP 2014 QMJ).

See ``spec.md`` for the full academic reference. Data / ranking helpers live
in :mod:`.helpers` to keep this module under the 500-line cap.

Lifecycle summary
-----------------

- ``universe()``        -- returns the full eligible seed list plus any open
                           positions so the engine can mark them.
- ``manage()``          -- on rebalance days only, closes positions not in the
                           new target set.
- ``generate_signals()``-- on rebalance days only, emits MOO buys / rebalances
                           for the new target top-N.

On non-rebalance days the strategy does nothing. There are no stops, no
trailing exits — the signal is monthly and stops destroy it.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Iterable, Mapping, Optional

import numpy as np
import pandas as pd

from strategies.base import Context, cache_of
from strategies.registry import (
    StrategyRegistrationError,
    _STRATEGY_CLASSES,
    register_strategy,
)
from strategies.signal import OrderType, Signal, TimeInForce

from .config import (
    DEFAULTS,
    REBALANCE_FREQS,
    eligible_universe,
    search_space,
)
from .helpers import (
    earnings_blocked,
    fetch_close_panel,
    get_fscores,
    is_last_trading_day_of_month,
    rank_01,
)


log = logging.getLogger("alphadesk.strategies.momentum_quality")


# --------------------------------------------------------------------------- #
# Registration shim (tolerates double-loading during Phase 1)                 #
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
_REQUIRED_LOOKBACK_DAYS = 420  # ~280 trading days
_NS = "momentum_quality"
_TRADING_DAYS_PER_MONTH = 21


# --------------------------------------------------------------------------- #
# Strategy                                                                    #
# --------------------------------------------------------------------------- #
@_safe_register(
    name="momentum_quality",
    category="equity",
    required_bars=("daily",),
    required_lookback_days=_REQUIRED_LOOKBACK_DAYS,
    min_universe_size=10,
    supports_shorts=False,
    supports_options=False,
    description=(
        "Long-only cross-sectional momentum + quality (Jegadeesh-Titman 1993 "
        "12-1 month momentum + Piotroski 2000 F-score). Top-N composite rank "
        "from a fixed ~50-name S&P-500-style universe, monthly rebalance, "
        "equal-weighted, ex-Financials / ex-Utilities (QMJ convention)."
    ),
)
class MomentumQualityStrategy:
    """Monthly-rotated long-only momentum+quality on a compact US large-cap book."""

    name = "momentum_quality"
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

        for k in ("momentum_lookback_m", "momentum_skip_m", "top_n",
                  "min_f_score", "earnings_skip_days"):
            merged[k] = int(merged[k])
        for k in ("quality_weight", "momentum_filter_min"):
            merged[k] = float(merged[k])

        freq = str(merged["rebalance_freq"])
        if freq not in REBALANCE_FREQS:
            raise ValueError(
                f"rebalance_freq must be one of {REBALANCE_FREQS}, got {freq!r}"
            )
        merged["rebalance_freq"] = freq

        if not (0.0 <= merged["quality_weight"] <= 1.0):
            raise ValueError(
                f"quality_weight must be in [0, 1], got {merged['quality_weight']}"
            )
        if merged["top_n"] <= 0:
            raise ValueError(f"top_n must be > 0, got {merged['top_n']}")
        if not (0 <= merged["min_f_score"] <= 9):
            raise ValueError(
                f"min_f_score must be in [0, 9], got {merged['min_f_score']}"
            )

        self.params = merged

    @classmethod
    def search_space(cls) -> dict[str, Any]:
        return search_space()

    # ------------------------------------------------------------------ #
    # Universe
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        cache = cache_of(ctx)
        syms = cache.get(f"{_NS}.universe")
        if syms is None:
            syms = eligible_universe()
            cache[f"{_NS}.universe"] = syms
        out = set(syms)
        for p in ctx.positions:
            out.add(p.symbol)
        return sorted(out)

    # ------------------------------------------------------------------ #
    # Exits (called BEFORE generate_signals)
    # ------------------------------------------------------------------ #
    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        if not self._is_rebalance_day(asof, ctx):
            return []

        target_names = self._compute_target(asof, ctx)
        cache = cache_of(ctx)
        cache[f"{_NS}.target"] = target_names
        cache[f"{_NS}.target_asof"] = asof

        target_set = set(target_names)
        exits: list[Signal] = []
        for pos in ctx.positions:
            if pos.quantity == 0:
                continue
            if pos.symbol in target_set:
                continue
            exits.append(
                Signal(
                    symbol=pos.symbol,
                    target_weight=0.0,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag="mq-exit",
                    asof=asof,
                )
            )
        return exits

    # ------------------------------------------------------------------ #
    # Entries
    # ------------------------------------------------------------------ #
    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        if not self._is_rebalance_day(asof, ctx):
            return []

        cache = cache_of(ctx)
        target_names: Optional[list[str]] = cache.get(f"{_NS}.target")
        target_asof = cache.get(f"{_NS}.target_asof")
        if target_names is None or target_asof != asof:
            target_names = self._compute_target(asof, ctx)
            cache[f"{_NS}.target"] = target_names
            cache[f"{_NS}.target_asof"] = asof

        if not target_names:
            return []

        weight = 1.0 / float(len(target_names))
        return [
            Signal(
                symbol=sym,
                target_weight=weight,
                order_type=OrderType.MOO,
                time_in_force=TimeInForce.DAY,
                tag="mq-entry",
                asof=asof,
            )
            for sym in target_names
        ]

    def on_fill(self, fill: Any, ctx: Context) -> None:
        return None

    # ------------------------------------------------------------------ #
    # Core decision logic
    # ------------------------------------------------------------------ #
    def _compute_target(self, asof: date, ctx: Context) -> list[str]:
        """Return the ranked top-N symbol list for ``asof``.

        Returns ``[]`` if insufficient data (engine treats as "hold nothing").
        """

        p = self.params
        cache = cache_of(ctx)
        syms = cache.get(f"{_NS}.universe") or eligible_universe()

        panel = self._get_close_panel(ctx, syms, asof)
        if panel is None or panel.empty:
            return []

        lookback_days = int(p["momentum_lookback_m"]) * _TRADING_DAYS_PER_MONTH
        skip_days = int(p["momentum_skip_m"]) * _TRADING_DAYS_PER_MONTH
        min_bars = lookback_days + skip_days + 2

        panel = panel[panel.index <= pd.Timestamp(asof, tz="UTC")]
        if len(panel) < min_bars:
            return []

        mom = _compute_momentum(panel, syms, lookback_days, skip_days)
        if not mom:
            return []

        mom_filter_min = float(p["momentum_filter_min"])
        eligible_syms = [s for s, r in mom.items() if r >= mom_filter_min]
        if not eligible_syms:
            return []

        fscores = get_fscores(ctx, eligible_syms, asof, _NS)
        min_f = int(p["min_f_score"])
        eligible_syms = [
            s for s in eligible_syms
            if (f := fscores.get(s)) is not None and f >= min_f
        ]
        if not eligible_syms:
            return []

        skip = int(p["earnings_skip_days"])
        if skip > 0:
            blocked = earnings_blocked(ctx, eligible_syms, asof, skip)
            eligible_syms = [s for s in eligible_syms if s not in blocked]
            if not eligible_syms:
                return []

        q_weight = float(p["quality_weight"])
        m_weight = 1.0 - q_weight

        mom_vals = np.array([mom[s] for s in eligible_syms], dtype=float)
        f_vals = np.array([float(fscores[s]) for s in eligible_syms], dtype=float)
        score = m_weight * rank_01(mom_vals) + q_weight * rank_01(f_vals)

        top_n = int(p["top_n"])
        order = np.argsort(-score, kind="stable")
        return [eligible_syms[i] for i in order[:top_n]]

    # ------------------------------------------------------------------ #
    # Cached close-panel fetch
    # ------------------------------------------------------------------ #
    def _get_close_panel(
        self,
        ctx: Context,
        symbols: list[str],
        asof: date,
    ) -> Optional[pd.DataFrame]:
        cache = cache_of(ctx)
        meta = cache.get(f"{_NS}.close_panel")
        symbols_tuple = tuple(sorted(symbols))

        need = (
            meta is None
            or meta.get("symbols") != symbols_tuple
            or (meta.get("end") or date.min) < asof
        )
        if need:
            warmup = self.required_lookback_days + 30
            start = asof - timedelta(days=warmup)
            end = asof + timedelta(days=400)
            try:
                # Pass ``asof`` so halt-detection uses bars <= asof only
                # (P0-8: the ffill window extends 400 cal days past asof,
                # and tailing the full window was a silent look-ahead).
                panel = fetch_close_panel(
                    ctx,
                    list(symbols_tuple),
                    start,
                    end,
                    asof=asof,
                )
            except Exception as exc:
                log.warning("mq: close-panel fetch failed: %s", exc)
                panel = None
            cache[f"{_NS}.close_panel"] = {
                "symbols": symbols_tuple,
                "data": panel,
                "end": end,
            }
            meta = cache[f"{_NS}.close_panel"]

        return meta.get("data")

    # ------------------------------------------------------------------ #
    # Rebalance calendar
    # ------------------------------------------------------------------ #
    def _is_rebalance_day(self, asof: date, ctx: Context) -> bool:
        freq = self.params["rebalance_freq"]
        if not is_last_trading_day_of_month(asof, ctx):
            return False
        if freq == "monthly":
            return True
        if freq == "bimonthly":
            return asof.month % 2 == 1
        if freq == "quarterly":
            return asof.month in (3, 6, 9, 12)
        raise AssertionError(f"unexpected rebalance_freq {freq!r}")


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _compute_momentum(
    panel: pd.DataFrame,
    symbols: list[str],
    lookback_days: int,
    skip_days: int,
) -> dict[str, float]:
    """Compute the 12-1 (or equivalent) momentum return per symbol."""

    mom: dict[str, float] = {}
    for sym in symbols:
        if sym not in panel.columns:
            continue
        series = panel[sym].dropna()
        min_bars = lookback_days + skip_days + 2
        if len(series) < min_bars:
            continue
        end_val = (
            float(series.iloc[-(skip_days + 1)])
            if skip_days > 0
            else float(series.iloc[-1])
        )
        start_idx = -(lookback_days + skip_days + 1)
        if -start_idx > len(series):
            continue
        start_val = float(series.iloc[start_idx])
        if start_val <= 0:
            continue
        mom[sym] = end_val / start_val - 1.0
    return mom


# Re-export for tests / scripts that import these names off the strategy module.
_is_last_trading_day_of_month = is_last_trading_day_of_month
_rank_01 = rank_01


__all__ = ["MomentumQualityStrategy"]
