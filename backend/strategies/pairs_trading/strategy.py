"""Cointegration-gated Pairs Trading — production implementation.

Dollar-neutral long/short equity stat-arb on a 49-ticker sector-grouped
mega-cap universe. The strategy's non-negotiable invariant is that every
pair trades both legs — each entry emits two coincident MOO signals with
opposite target_weight signs, and every exit emits two MOC closures. This
directly fixes the biggest audit finding (single-leg long-only live runner).

See ``spec.md`` for the academic spec and citations (Engle-Granger 1987,
Vidyamurthy 2004, Avellaneda-Lee 2010, Chan 2013).

Pipeline per bar::

    1. (rescreen if due) scan all within-sector pairs in the universe;
       Engle-Granger ADF + Hurst + OU half-life gate; keep up to max_pairs.
    2. (watchdog if due) re-test cointegration on active pairs; close any
       whose p-value exceeds watchdog_pvalue.
    3. Compute z_t for each active pair using rolling window of spread.
    4. manage() emits two-leg exit signals when |z| < z_exit or |z| > z_stop.
    5. generate_signals() emits two-leg entry signals when no position is
       open for a pair and |z| >= z_entry.

State in ``ctx.state["pairs_trading.*"]``:

- ``active`` — list[dict]: {pair_id, sector, y, x, beta, last_screen_date,
  last_watchdog_date}. Rewritten on each rescreen.
- ``positions`` — dict[pair_id -> dict]: {y, x, beta, entry_z, direction,
  entry_date}. Written by on_fill; cleared on exit.
- ``last_screen`` — date of most recent rescreen.
- ``bars_cache`` — symbol -> pd.Series of closes (built lazily per bar).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Iterable, Mapping, Optional

import numpy as np
import pandas as pd

from indicators.stats import (
    engle_granger_adf,
    hurst,
    kalman_hedge_ratio,
    ols_hedge_ratio,
    ou_half_life,
)
from strategies.base import Context, cache_of
from strategies.registry import (
    StrategyRegistrationError,
    _STRATEGY_CLASSES,
    register_strategy,
)
from strategies.signal import OrderType, Signal, TimeInForce

from .config import (
    DEFAULTS,
    UNIVERSE,
    UNIVERSE_BY_SECTOR,
    all_within_sector_pairs,
    search_space,
)


log = logging.getLogger("alphadesk.strategies.pairs_trading")


def _safe_register(*args, **kwargs):
    """``@register_strategy`` shim tolerant of double-loading.

    Same pattern as other Phase 1 packages (rsi2_reversal, kama_breakout, ...).
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
# Namespace + constants                                                       #
# --------------------------------------------------------------------------- #
# Lookback must cover the E-G formation window (252) plus the longest z window
# (90) plus a buffer. 400 calendar days ~ 280 trading days — enough headroom
# so the first rescreen after warmup has a full formation window.
_REQUIRED_LOOKBACK_DAYS = 400

_NS = "pairs_trading"

# Minimum overlapping bars needed for a pair to be evaluated on a given bar.
# Smaller than formation_days so early-backtest universes with short history
# can still trade once warmup clears.
_MIN_BARS_FOR_SCREEN = 180
_MIN_BARS_FOR_TRADE = 60


# --------------------------------------------------------------------------- #
# Helper dataclasses                                                          #
# --------------------------------------------------------------------------- #
@dataclass
class ActivePair:
    """An admitted pair from the most-recent rescreen.

    ``pair_id`` is ``f"{y}-{x}"``; unique within the active set because we
    dedupe on overlapping tickers.

    ``kalman_betas`` is an optional pre-computed pd.Series (indexed by date)
    of Kalman-filtered beta at each bar in the formation window — filled in
    by the rescreen step when ``hedge_method="kalman"``. This lets
    ``_spread_and_z`` reuse the precomputed filter across bars instead of
    recomputing it on every bar (the Kalman loop is pure-Python and
    quadratic in total bars; precomputing amortises it over one rescreen
    window). When ``hedge_method="ols"`` this field stays ``None``.
    """

    pair_id: str
    sector: str
    y: str
    x: str
    beta: float
    screen_pvalue: float
    screen_halflife: float
    last_screen_date: date
    last_watchdog_date: date
    kalman_betas: Any = None  # pd.Series or None


@dataclass
class OpenPosition:
    """An open pair position (both legs on the books).

    ``direction`` is +1 when we went long-y/short-x (entry |z| <= -z_entry),
    -1 when we went short-y/long-x (entry |z| >= +z_entry).
    """

    pair_id: str
    y: str
    x: str
    beta: float
    direction: int
    entry_z: float
    entry_date: date
    long_sym: str
    short_sym: str
    long_weight: float
    short_weight: float


# --------------------------------------------------------------------------- #
# Strategy                                                                    #
# --------------------------------------------------------------------------- #
@_safe_register(
    name="pairs_trading",
    category="pairs",
    required_bars=("daily",),
    required_lookback_days=_REQUIRED_LOOKBACK_DAYS,
    min_universe_size=40,
    supports_shorts=True,
    supports_options=False,
    description=(
        "Cointegration-gated dollar-neutral pairs trading. Engle-Granger ADF "
        "selects within-sector pairs from a 49-ticker mega-cap universe every "
        "63 trading days. Trades |z| >= 2.0 (entry) / |z| < 0.5 (exit) / "
        "|z| > 3.5 (stop). OLS or Kalman hedge ratio. 21-day structural-"
        "break watchdog. Every pair emits two coincident signals — the "
        "audit's non-negotiable market-neutrality fix."
    ),
)
class PairsTradingStrategy:
    """Dollar-neutral, cointegration-gated pairs trading."""

    name = "pairs_trading"
    required_bars: list[str] = ["daily"]
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
        # Coerce types so tuner-suggested values (sometimes float/str) are
        # normalised.
        for k in (
            "z_entry", "z_exit", "z_stop", "pair_weight",
            "ou_halflife_max_days", "adf_pvalue_max", "hurst_max",
            "watchdog_pvalue", "kalman_delta", "kalman_r",
        ):
            merged[k] = float(merged[k])
        for k in (
            "z_window", "max_pairs", "rescreen_days",
            "formation_days", "watchdog_days",
        ):
            merged[k] = int(merged[k])
        merged["hedge_method"] = str(merged["hedge_method"]).lower()
        if merged["hedge_method"] not in ("ols", "kalman"):
            merged["hedge_method"] = "ols"
        # Audit P0-4: the spec §3.3 calls for log-prices on the
        # Engle-Granger path. ``prices_in_log_space`` defaults to True
        # in config.DEFAULTS; coerce from tuner-supplied strings.
        log_flag = merged.get("prices_in_log_space", True)
        if isinstance(log_flag, str):
            merged["prices_in_log_space"] = log_flag.strip().lower() in ("true", "1", "yes")
        else:
            merged["prices_in_log_space"] = bool(log_flag)
        self.params = merged

    @classmethod
    def search_space(cls) -> dict[str, Any]:
        return search_space()

    # ------------------------------------------------------------------ #
    # Universe
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        # Strategy always wants bars for every ticker in the universe plus
        # any symbol currently held (defensive — positions should already
        # be universe members).
        syms = set(UNIVERSE)
        for p in ctx.positions:
            syms.add(p.symbol)
        return sorted(syms)

    # ------------------------------------------------------------------ #
    # Bar fetch helper (cached per-bar in ctx.state)
    # ------------------------------------------------------------------ #
    def _fetch_close_matrix(
        self, ctx: Context, asof: date, lookback_days: int
    ) -> Optional[pd.DataFrame]:
        """Return a wide DataFrame indexed by date with one column per symbol.

        Implementation note: the bar provider is assumed to be deterministic
        across a backtest run. We fetch the full universe's bars ONCE on the
        first call with a generous lookback (the strategy's
        ``required_lookback_days`` plus the backtest horizon), pivot once,
        and then every subsequent call slices that cached matrix up to
        ``asof``. This amortises the pivot across the full backtest instead
        of paying ~O(universe × lookback) every bar. Strict no-look-ahead is
        preserved at the row level: the slice never includes data strictly
        after ``asof``.
        """

        cache = cache_of(ctx)
        full_key = f"{_NS}.full_wide"
        wide_full = cache.get(full_key)

        if wide_full is None:
            if ctx.bar_provider is None:
                return None
            # Fetch a generous window (required_lookback_days calendar days
            # before ``asof`` to cover the formation+z window, extending
            # ``+2 years`` forward so the same cached frame serves every
            # subsequent bar in the backtest).
            fetch_start = asof - timedelta(
                days=int(self.required_lookback_days * 1.5) + 30
            )
            fetch_end = asof + timedelta(days=365 * 2 + 60)
            try:
                df = ctx.bar_provider.bars(
                    list(UNIVERSE), fetch_start, fetch_end, tf="1D"
                )
            except Exception as exc:
                log.warning(
                    "bar_provider.bars failed on %s: %s", asof, exc,
                )
                return None
            if df is None:
                return None
            df = pd.DataFrame(df)
            if df.empty:
                return None

            cols = {c.lower(): c for c in df.columns}
            sym_col = cols.get("symbol") or cols.get("ticker")
            ts_col = cols.get("timestamp") or cols.get("ts") or cols.get("date")
            close_col = cols.get("close")
            if sym_col is None or ts_col is None or close_col is None:
                return None

            wide_full = df.pivot_table(
                index=ts_col, columns=sym_col, values=close_col,
                aggfunc="last",
            ).sort_index()
            if hasattr(wide_full.index, "tz") and wide_full.index.tz is not None:
                wide_full.index = wide_full.index.tz_convert(None)
            cache[full_key] = wide_full

        # Slice up to asof (strict no-look-ahead) and trim to lookback_days
        # of history so the returned frame is compact.
        try:
            mask = wide_full.index.date <= asof
        except Exception:
            mask = wide_full.index <= pd.Timestamp(asof)
        sliced = wide_full.loc[mask]
        if sliced.empty:
            return None
        # Keep only the trailing ``lookback_days`` bars (plus ~1.5x buffer
        # for weekends).
        tail_n = int(lookback_days * 1.6) + 10
        if len(sliced) > tail_n:
            sliced = sliced.tail(tail_n)
        return sliced

    def _closes_for(self, closes: pd.DataFrame, sym: str) -> Optional[pd.Series]:
        if closes is None or closes.empty or sym not in closes.columns:
            return None
        s = closes[sym].astype("float64").dropna()
        if s.empty:
            return None
        return s

    def _price_transform(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply the configured price transform (log or identity).

        Audit P0-4 / spec §3.3: the Engle-Granger OLS, Kalman hedge,
        spread and z-score must all operate on the SAME price space;
        otherwise the "stationary" residual carries level-dependent
        heteroskedasticity. We transform here, once, and every downstream
        call site (``engle_granger_adf``, ``kalman_hedge_ratio``, the
        spread subtraction in ``_spread_and_z``) sees the same space.

        Positive closes are expected (equity prices); guard against
        non-positive values by dropping those rows before log.
        """

        if not bool(self.params.get("prices_in_log_space", True)):
            return df
        # Drop rows with non-positive closes (defensive — should never
        # happen for the equity universe but np.log would produce -inf).
        safe = df[(df > 0).all(axis=1)]
        if safe.empty:
            return safe
        return np.log(safe)

    # ------------------------------------------------------------------ #
    # Pair screen
    # ------------------------------------------------------------------ #
    def _rescreen(self, asof: date, ctx: Context) -> list[ActivePair]:
        p = self.params
        formation_days = int(p["formation_days"])
        halflife_max = float(p["ou_halflife_max_days"])
        pvalue_max = float(p["adf_pvalue_max"])
        hurst_max = float(p["hurst_max"])
        max_pairs = int(p["max_pairs"])

        closes = self._fetch_close_matrix(ctx, asof, formation_days)
        if closes is None or closes.empty:
            return []

        candidates: list[tuple[float, ActivePair]] = []
        for sector, y_sym, x_sym in all_within_sector_pairs():
            y_ser = self._closes_for(closes, y_sym)
            x_ser = self._closes_for(closes, x_sym)
            if y_ser is None or x_ser is None:
                continue
            # Align and take the last ``formation_days`` rows.
            df = pd.concat(
                [y_ser.rename("y"), x_ser.rename("x")], axis=1
            ).dropna()
            if len(df) < _MIN_BARS_FOR_SCREEN:
                continue
            df = df.tail(formation_days)
            # Apply price transform (log-prices by default; audit P0-4).
            df = self._price_transform(df)
            if len(df) < _MIN_BARS_FOR_SCREEN:
                continue
            # Engle-Granger on the transformed series (so ``beta`` is the
            # log-space hedge ratio that matches the spread computed in
            # ``_spread_and_z``).
            try:
                pvalue, _adf, beta, residuals = engle_granger_adf(df["y"], df["x"])
            except Exception:
                continue
            if not np.isfinite(pvalue) or pvalue > pvalue_max:
                continue
            if not np.isfinite(beta) or abs(beta) < 1e-9 or abs(beta) > 10.0:
                # guard against pathological regressions
                continue
            # OU half-life on residuals.
            hl = ou_half_life(residuals)
            if not np.isfinite(hl) or hl <= 0 or hl > halflife_max:
                continue
            # Hurst.
            try:
                h = hurst(residuals, min_lag=2, max_lag=min(40, len(residuals) // 4))
            except Exception:
                h = float("nan")
            if not np.isfinite(h) or h >= hurst_max:
                continue

            pair_id = f"{y_sym}-{x_sym}"
            candidates.append(
                (pvalue, ActivePair(
                    pair_id=pair_id,
                    sector=sector,
                    y=y_sym,
                    x=x_sym,
                    beta=float(beta),
                    screen_pvalue=float(pvalue),
                    screen_halflife=float(hl),
                    last_screen_date=asof,
                    last_watchdog_date=asof,
                    kalman_betas=None,  # populated below if Kalman
                ))
            )

        # Rank by p-value ascending; dedupe on tickers so no two active pairs
        # share an underlying (avoids signal collisions on the same symbol).
        candidates.sort(key=lambda row: row[0])
        seen_syms: set[str] = set()
        active: list[ActivePair] = []
        for _pv, pair in candidates:
            if pair.y in seen_syms or pair.x in seen_syms:
                continue
            active.append(pair)
            seen_syms.add(pair.y)
            seen_syms.add(pair.x)
            if len(active) >= max_pairs:
                break

        # If Kalman hedging is enabled, precompute the filtered beta series
        # over the full formation window once per rescreen. Per-bar calls
        # to ``_spread_and_z`` then reuse this series instead of rerunning
        # the pure-Python Kalman loop.
        if self.params.get("hedge_method") == "kalman":
            for pair in active:
                y_ser = self._closes_for(closes, pair.y)
                x_ser = self._closes_for(closes, pair.x)
                if y_ser is None or x_ser is None:
                    continue
                df = pd.concat(
                    [y_ser.rename("y"), x_ser.rename("x")], axis=1
                ).dropna().tail(formation_days)
                # Kalman must run in the same price space as OLS beta / the
                # spread subtraction downstream (audit P0-4).
                df = self._price_transform(df)
                if df.empty:
                    pair.kalman_betas = None
                    continue
                try:
                    pair.kalman_betas = kalman_hedge_ratio(
                        df["y"], df["x"],
                        delta=float(self.params["kalman_delta"]),
                        r=float(self.params["kalman_r"]),
                    )
                except Exception:
                    pair.kalman_betas = None

        log.debug(
            "pairs_trading: rescreen %s -> %d candidates, %d active",
            asof, len(candidates), len(active),
        )
        return active

    def _maybe_rescreen(
        self, asof: date, ctx: Context
    ) -> list[ActivePair]:
        cache = cache_of(ctx)
        active: list[ActivePair] = cache.get(f"{_NS}.active", [])
        last_screen: Optional[date] = cache.get(f"{_NS}.last_screen")
        rescreen_days = int(self.params["rescreen_days"])

        do_screen = (
            last_screen is None
            or (asof - last_screen).days >= rescreen_days
        )
        if do_screen:
            active = self._rescreen(asof, ctx)
            cache[f"{_NS}.active"] = active
            cache[f"{_NS}.last_screen"] = asof
        return active

    # ------------------------------------------------------------------ #
    # Watchdog
    # ------------------------------------------------------------------ #
    def _watchdog(
        self, asof: date, ctx: Context, active: list[ActivePair]
    ) -> set[str]:
        """Re-test cointegration on active pairs that are due for watchdog.

        Returns the set of pair_ids that failed and should be force-closed.
        """

        p = self.params
        watchdog_days = int(p["watchdog_days"])
        watchdog_pvalue = float(p["watchdog_pvalue"])
        formation_days = int(p["formation_days"])

        due = [
            pair for pair in active
            if (asof - pair.last_watchdog_date).days >= watchdog_days
        ]
        if not due:
            return set()

        closes = self._fetch_close_matrix(ctx, asof, formation_days)
        if closes is None or closes.empty:
            return set()

        failed: set[str] = set()
        for pair in due:
            y_ser = self._closes_for(closes, pair.y)
            x_ser = self._closes_for(closes, pair.x)
            if y_ser is None or x_ser is None:
                failed.add(pair.pair_id)
                continue
            df = pd.concat(
                [y_ser.rename("y"), x_ser.rename("x")], axis=1
            ).dropna().tail(formation_days)
            if len(df) < _MIN_BARS_FOR_SCREEN:
                failed.add(pair.pair_id)
                continue
            # Watchdog re-runs E-G on the SAME price space as the original
            # screen; otherwise the p-value test compares two different
            # residual distributions (audit P0-4).
            df = self._price_transform(df)
            if len(df) < _MIN_BARS_FOR_SCREEN:
                failed.add(pair.pair_id)
                continue
            try:
                pvalue, _adf, _beta, _res = engle_granger_adf(df["y"], df["x"])
            except Exception:
                failed.add(pair.pair_id)
                continue
            if not np.isfinite(pvalue) or pvalue > watchdog_pvalue:
                failed.add(pair.pair_id)
            # Update the watchdog date even if the pair survived.
            pair.last_watchdog_date = asof
        return failed

    # ------------------------------------------------------------------ #
    # Spread + z-score
    # ------------------------------------------------------------------ #
    def _spread_and_z(
        self,
        pair: ActivePair,
        closes: pd.DataFrame,
    ) -> Optional[tuple[float, float, float, float, float]]:
        """Return (z_today, beta_today, spread_today, price_y, price_x).

        For z we compute rolling mean/std on *prior* bars only (strict no
        look-ahead). If the ``hedge_method`` is Kalman, beta_today is the
        filtered slope at the most recent bar — we use the precomputed
        ``pair.kalman_betas`` series (built once per rescreen to keep per-bar
        cost O(z_window) rather than O(formation_days)).
        """

        p = self.params
        z_window = int(p["z_window"])
        method = p["hedge_method"]

        y_ser = self._closes_for(closes, pair.y)
        x_ser = self._closes_for(closes, pair.x)
        if y_ser is None or x_ser is None:
            return None
        df = pd.concat(
            [y_ser.rename("y"), x_ser.rename("x")], axis=1
        ).dropna()
        if len(df) < max(_MIN_BARS_FOR_TRADE, z_window + 2):
            return None
        # Trim to the last ~z_window + a small buffer so rolling stats are
        # cheap; we only need enough tail to compute today's z.
        need = z_window + 5
        df_trim = df.tail(need)

        # Audit P0-4: all hedge-ratio estimation and spread / z-score
        # arithmetic runs on the configured price space (log by default;
        # spec §3.3). ``df_trim`` keeps the raw-price last-row for the
        # returned ``price_y`` / ``price_x`` (used only for positivity
        # guards downstream); ``df_trim_est`` is the series fed into the
        # Kalman fit and the spread subtraction.
        df_trim_est = self._price_transform(df_trim)
        if df_trim_est.empty or len(df_trim_est) < z_window + 2:
            return None

        if method == "kalman" and pair.kalman_betas is not None:
            betas = pair.kalman_betas.reindex(df_trim_est.index).ffill()
            # Fall back to the screen beta where Kalman hasn't updated yet.
            betas = betas.fillna(pair.beta)
            last = betas.dropna()
            beta_today = float(last.iloc[-1]) if not last.empty else pair.beta
        elif method == "kalman":
            # Rescreen hasn't populated kalman_betas — run a one-shot
            # fit on the trimmed window so we can still trade. Much cheaper
            # than fitting on the full formation window every bar. Runs
            # on the log-space series so it matches the OLS beta.
            beta_series = kalman_hedge_ratio(
                df_trim_est["y"], df_trim_est["x"],
                delta=float(p["kalman_delta"]),
                r=float(p["kalman_r"]),
            )
            last = beta_series.dropna()
            beta_today = float(last.iloc[-1]) if not last.empty else pair.beta
            betas = beta_series.ffill().fillna(pair.beta)
        else:
            beta_today = pair.beta
            betas = pd.Series(pair.beta, index=df_trim_est.index)

        # Spread = log(y) - beta * log(x) when prices_in_log_space=True
        # (default); else raw-price spread. beta is consistent with the
        # space because ``_rescreen`` / watchdog / Kalman all estimated
        # it on the same transform.
        spread = df_trim_est["y"] - betas * df_trim_est["x"]
        # Rolling mean / std on [t-N, t-1] — strict no look-ahead.
        mean = spread.shift(1).rolling(window=z_window, min_periods=z_window).mean()
        std = spread.shift(1).rolling(window=z_window, min_periods=z_window).std(ddof=1)
        z = (spread - mean) / std.replace(0.0, np.nan)
        z_today = float(z.iloc[-1]) if len(z) else float("nan")
        spread_today = float(spread.iloc[-1])
        # Return raw prices for the positivity / sizing guards downstream.
        price_y = float(df_trim["y"].iloc[-1])
        price_x = float(df_trim["x"].iloc[-1])
        if not np.isfinite(z_today):
            return None
        return (z_today, float(beta_today), spread_today, price_y, price_x)

    # ------------------------------------------------------------------ #
    # Manage / exits
    # ------------------------------------------------------------------ #
    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        """Emit two-leg exit signals for open pairs.

        Exit conditions per the spec: |z| < z_exit (mean revert),
        |z| > z_stop (break), or watchdog cointegration failure.
        """

        p = self.params
        cache = cache_of(ctx)
        positions: dict[str, OpenPosition] = cache.get(f"{_NS}.positions", {})
        if not positions:
            return []
        active: list[ActivePair] = cache.get(f"{_NS}.active", [])
        by_id = {pair.pair_id: pair for pair in active}

        # Determine which pairs should be force-closed by the watchdog.
        # Only run the watchdog on pair-ids we still hold.
        watchdog_failures = self._watchdog(asof, ctx, active)

        z_exit = float(p["z_exit"])
        z_stop = float(p["z_stop"])
        formation_days = int(p["formation_days"])
        closes = self._fetch_close_matrix(ctx, asof, formation_days)

        exit_signals: list[Signal] = []
        to_close: list[tuple[str, str]] = []  # (pair_id, reason)

        for pair_id, pos in list(positions.items()):
            # If the pair was retired on a prior rescreen we never cleaned
            # up, still close on a best-effort basis at market close.
            if pair_id in watchdog_failures:
                to_close.append((pair_id, "watchdog"))
                continue
            pair = by_id.get(pair_id)
            if pair is None:
                # Pair was de-listed by a rescreen — close immediately.
                to_close.append((pair_id, "delisted"))
                continue
            if closes is None or closes.empty:
                continue
            zinfo = self._spread_and_z(pair, closes)
            if zinfo is None:
                continue
            z_today, _beta, _spread, _py, _px = zinfo
            if abs(z_today) >= z_stop:
                to_close.append((pair_id, "stop"))
            elif abs(z_today) < z_exit:
                to_close.append((pair_id, "mean-revert"))
            # Additional flip-side rule: if the spread has passed through
            # zero to the opposite sign of the entry, close. This is
            # a tighter exit than |z| < z_exit on volatile pairs.
            elif (pos.direction > 0 and z_today > 0) or (
                pos.direction < 0 and z_today < 0
            ):
                # Cross through zero past entry direction — exit at mean.
                # But we already capture this when |z| < z_exit; we leave
                # this branch commented for future extension.
                pass

        for pair_id, reason in to_close:
            pos = positions.get(pair_id)
            if pos is None:
                continue
            # Two closing signals — always both legs.
            exit_signals.append(
                Signal(
                    symbol=pos.y,
                    target_weight=0.0,
                    order_type=OrderType.MOC,
                    time_in_force=TimeInForce.DAY,
                    tag=f"pairs-exit-{reason}-{pair_id}-y",
                    asof=asof,
                )
            )
            exit_signals.append(
                Signal(
                    symbol=pos.x,
                    target_weight=0.0,
                    order_type=OrderType.MOC,
                    time_in_force=TimeInForce.DAY,
                    tag=f"pairs-exit-{reason}-{pair_id}-x",
                    asof=asof,
                )
            )
            # Remove from state immediately so generate_signals doesn't
            # try to re-evaluate on the same bar.
            positions.pop(pair_id, None)

        cache[f"{_NS}.positions"] = positions
        return exit_signals

    # ------------------------------------------------------------------ #
    # Entries
    # ------------------------------------------------------------------ #
    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        """Emit two-leg entry signals when a pair crosses |z| >= z_entry.

        Every entry emits exactly two coincident MOO signals with opposite
        target_weight signs (dollar-neutral). This is the audit's
        non-negotiable invariant — enforced here by construction.
        """

        p = self.params
        cache = cache_of(ctx)

        active = self._maybe_rescreen(asof, ctx)
        if not active:
            return []

        positions: dict[str, OpenPosition] = cache.setdefault(
            f"{_NS}.positions", {}
        )
        max_pairs = int(p["max_pairs"])
        if len(positions) >= max_pairs:
            return []

        formation_days = int(p["formation_days"])
        closes = self._fetch_close_matrix(ctx, asof, formation_days)
        if closes is None or closes.empty:
            return []

        z_entry = float(p["z_entry"])
        z_stop = float(p["z_stop"])
        pair_weight = float(p["pair_weight"])
        held_syms = {pos.y for pos in positions.values()} | {
            pos.x for pos in positions.values()
        }

        # Rank candidate entries by |z| descending so strongest dislocations
        # trade first if capacity is limited.
        candidates: list[tuple[float, ActivePair, float, float, float, float]] = []
        for pair in active:
            if pair.pair_id in positions:
                continue
            if pair.y in held_syms or pair.x in held_syms:
                continue
            zinfo = self._spread_and_z(pair, closes)
            if zinfo is None:
                continue
            z_today, beta_today, _spread, price_y, price_x = zinfo
            if not np.isfinite(z_today):
                continue
            if abs(z_today) < z_entry:
                continue
            if abs(z_today) >= z_stop:
                # Already past stop territory — don't open at the very tail.
                continue
            if not np.isfinite(beta_today) or abs(beta_today) < 1e-9:
                continue
            if price_y <= 0 or price_x <= 0:
                continue
            candidates.append((abs(z_today), pair, beta_today, price_y, price_x, z_today))

        candidates.sort(key=lambda row: row[0], reverse=True)

        entry_signals: list[Signal] = []
        remaining_capacity = max_pairs - len(positions)
        for _mag, pair, beta_today, price_y, price_x, z_today in candidates:
            if remaining_capacity <= 0:
                break
            # Dollar-neutral leg sizing (Chan 2013 §3.3, Avellaneda-Lee 2010):
            # Each leg gets equal dollar notional = pair_weight * equity.
            # Hedge ratio `beta` enters the spread computation only; sizing
            # is symmetric by dollars so absolute exposure is $0 at entry.
            # Using beta * py/px as a sizing scalar (as some references
            # suggest for "cointegration-neutral" hedging) breaks dollar
            # neutrality when py/px differs by >3x — e.g. BAC(~34) vs
            # GS(~400) would short a 0-share x-leg at pair_weight=10%.
            long_weight = pair_weight
            short_weight = -pair_weight

            if z_today <= -z_entry:
                # Spread too low: long y, short x (y is cheap)
                direction = +1
                y_weight, x_weight = long_weight, short_weight
                long_sym, short_sym = pair.y, pair.x
                long_w_val, short_w_val = long_weight, short_weight
            else:
                # Spread too high: short y, long x (y is rich)
                direction = -1
                y_weight, x_weight = short_weight, long_weight
                long_sym, short_sym = pair.x, pair.y
                long_w_val, short_w_val = long_weight, short_weight

            tag_base = f"pairs-entry-{pair.pair_id}-dir{direction:+d}"

            sig_y = Signal(
                symbol=pair.y,
                target_weight=float(y_weight),
                order_type=OrderType.MOO,
                time_in_force=TimeInForce.DAY,
                tag=f"{tag_base}-y",
                asof=asof,
            )
            sig_x = Signal(
                symbol=pair.x,
                target_weight=float(x_weight),
                order_type=OrderType.MOO,
                time_in_force=TimeInForce.DAY,
                tag=f"{tag_base}-x",
                asof=asof,
            )
            entry_signals.append(sig_y)
            entry_signals.append(sig_x)

            # Book the logical position. We book eagerly at signal time so
            # subsequent bars don't double-enter. The on_fill hook will
            # update with actual fill prices if needed.
            positions[pair.pair_id] = OpenPosition(
                pair_id=pair.pair_id,
                y=pair.y,
                x=pair.x,
                beta=float(beta_today),
                direction=direction,
                entry_z=float(z_today),
                entry_date=asof,
                long_sym=long_sym,
                short_sym=short_sym,
                long_weight=float(long_w_val),
                short_weight=float(short_w_val),
            )
            held_syms.add(pair.y)
            held_syms.add(pair.x)
            remaining_capacity -= 1

        cache[f"{_NS}.positions"] = positions
        return entry_signals

    # ------------------------------------------------------------------ #
    # Fills
    # ------------------------------------------------------------------ #
    def on_fill(self, fill: Any, ctx: Context) -> None:
        # We rely on the logical pair state in ctx.state rather than tracking
        # fills directly. The engine already updates portfolio positions.
        # This hook is reserved for future per-pair P&L attribution.
        return None


__all__ = ["PairsTradingStrategy", "ActivePair", "OpenPosition"]
