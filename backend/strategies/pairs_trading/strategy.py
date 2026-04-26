"""Cointegration-gated Pairs Trading — SOTA shell.

Dollar-neutral long/short equity stat-arb on a 49-ticker sector-grouped
mega-cap universe. Every pair trades both legs — each entry emits two
coincident MOO signals with opposite ``target_weight`` signs. See
``spec.md`` for academic references (Engle-Granger 1987, Vidyamurthy 2004,
Avellaneda-Lee 2010, Chan 2013).

Pipeline per bar:
  1. Rescreen within-sector pairs every ``rescreen_days`` — E-G ADF, Hurst,
     OU half-life gate; keep up to ``max_pairs``.
  2. Watchdog — re-test cointegration on active pairs every ``watchdog_days``;
     close any whose p-value exceeds ``watchdog_pvalue``.
  3. Compute z_t for each active pair using rolling window of spread.
  4. Emit two-leg exits on |z| < z_exit or |z| > z_stop.
  5. Emit two-leg entries when no position is open for a pair and |z| >= z_entry.

State keys:
- ``active``: list of ActivePair — rewritten on each rescreen.
- ``positions``: dict[pair_id -> OpenPosition] — written on entry, cleared on exit.
- ``last_screen``: date of most recent rescreen.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Optional

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict

from indicators.stats import (
    engle_granger_adf,
    hurst,
    kalman_hedge_ratio,
    ou_half_life,
)

from strategies._core.contracts import (
    Fill,
    OrderType,
    Signal,
    StrategyInput,
    StrategyResult,
    TimeInForce,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import (
    PairsTradingParams,
    UNIVERSE,
    UNIVERSE_BY_SECTOR,
    all_within_sector_pairs,
)


log = logging.getLogger("alphadesk.strategies.pairs_trading")

_NS = "pairs_trading"
_REQUIRED_LOOKBACK_DAYS = 400
_MIN_BARS_FOR_SCREEN = 180
_MIN_BARS_FOR_TRADE = 60


class ActivePair(BaseModel):
    """Frozen Pydantic model for an active cointegration-screened pair.

    Round-6 / I-3 + I-19: was a mutable ``@dataclass``; mutation by
    ``_run_watchdog`` (``pair.last_watchdog_date = asof``) violated the
    purity invariant on ``Strategy.run`` (no mutation of state inputs)
    and silently leaked across replays. Frozen model + ``model_copy(update=...)``
    surface the mutation explicitly at the call site.
    """

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    pair_id: str
    sector: str
    y: str
    x: str
    beta: float
    screen_pvalue: float
    screen_halflife: float
    last_screen_date: date
    last_watchdog_date: date
    kalman_betas: Any = None


class OpenPosition(BaseModel):
    """Frozen Pydantic model for an open pair position.

    Round-6 / I-3 + I-19: previously a mutable dataclass written eagerly
    inside ``_compute_entries`` BEFORE the broker filled. The on_fill /
    on_cancel paths now own the canonical ledger; this model carries the
    pre-fill *intent* between bars only.
    """

    model_config = ConfigDict(frozen=True)

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


@register_strategy(
    StrategyMeta(
        name="pairs_trading",
        category="pairs",
        description=(
            "Cointegration-gated dollar-neutral pairs trading. Engle-Granger ADF "
            "selects within-sector pairs from a 49-ticker mega-cap universe every "
            "63 trading days. Trades |z| >= 2.0 (entry) / |z| < 0.5 (exit) / "
            "|z| > 3.5 (stop). OLS or Kalman hedge ratio. 21-day structural-"
            "break watchdog. Every pair emits two coincident signals — the "
            "audit's non-negotiable market-neutrality fix."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=40,
    )
)
class PairsTradingStrategy(Strategy):
    """Dollar-neutral, cointegration-gated pairs trading."""

    PARAMS_MODEL = PairsTradingParams

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        syms = set(UNIVERSE)
        held = state.get(f"{_NS}.held_symbols") or set()
        syms.update(held)
        return sorted(syms)

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: PairsTradingParams,
    ) -> StrategyResult:
        asof = input.asof
        state = input.state
        diagnostics: dict[str, Any] = {}
        warnings: list[str] = []

        closes = _close_matrix(input.bars, asof, params.formation_days)
        if closes is None or closes.empty:
            return StrategyResult(
                signals=[], diagnostics={"bars_empty": True}, warnings=warnings,
            )

        # ---------------- Rescreen (if due) ---------------- #
        active: list[ActivePair] = list(state.get(f"{_NS}.active") or [])
        last_screen: Optional[date] = state.get(f"{_NS}.last_screen")
        do_screen = (
            last_screen is None
            or (asof - last_screen).days >= params.rescreen_days
        )
        if do_screen:
            active = _rescreen(closes, params, asof)

        # ---------------- Positions state ---------------- #
        positions: dict[str, OpenPosition] = dict(
            state.get(f"{_NS}.positions") or {}
        )
        # ``pending`` is the pre-fill intent ledger — entries land here on
        # signal emission and migrate to ``positions`` only when on_fill
        # confirms the broker filled. Round-6 / I-4: previously
        # ``_compute_entries`` wrote directly into ``positions`` before the
        # broker round-tripped, which double-counted capacity if a signal
        # was canceled or unfilled.
        pending: dict[str, OpenPosition] = dict(
            state.get(f"{_NS}.pending") or {}
        )

        exits, active = _compute_exits(closes, positions, active, params, asof)
        diagnostics["exits_emitted"] = len(exits)

        # Drop closed pair ids from the positions dict before entries, and
        # track which pair ids closed this bar so we don't same-bar re-enter.
        closed_pair_ids: set[str] = set()
        for sig in exits:
            for pid, pos in list(positions.items()):
                if sig.symbol in (pos.y, pos.x):
                    closed_pair_ids.add(pid)
        for pid in closed_pair_ids:
            positions.pop(pid, None)
            pending.pop(pid, None)

        # ---------------- Entries ---------------- #
        entries, new_pending = _compute_entries(
            closes, positions, pending, active, params, asof,
            exclude_pair_ids=closed_pair_ids,
        )
        diagnostics["entries_emitted"] = len(entries)

        # Merge new pending intents — these will move to ``positions`` in
        # ``on_fill`` once the broker confirms.
        pending.update(new_pending)

        held_symbols = (
            {p.y for p in positions.values()} | {p.x for p in positions.values()}
            | {p.y for p in pending.values()} | {p.x for p in pending.values()}
        )

        state_update: dict[str, Any] = {
            f"{_NS}.active": active,
            f"{_NS}.positions": positions,
            f"{_NS}.pending": pending,
            f"{_NS}.held_symbols": held_symbols,
        }
        if do_screen:
            state_update[f"{_NS}.last_screen"] = asof

        return StrategyResult(
            signals=exits + entries,
            state_update=state_update,
            diagnostics=diagnostics,
            warnings=warnings,
        )

    # ------------------------------------------------------------------ #
    # on_fill — promote pending intents to confirmed positions           #
    # ------------------------------------------------------------------ #
    def on_fill(self, fill: Fill, state: dict[str, Any]) -> dict[str, Any]:
        """Confirm a pending pair position once both legs fill.

        Round-6 / I-4: pairs_trading was the only multi-leg strategy still
        eagerly writing positions during signal emission. The new flow:

        1. ``_compute_entries`` records the intent in ``state.pending``.
        2. The broker fills both legs over T+0/T+1.
        3. ``on_fill`` matches the fill against the pending intent and
           moves it into ``state.positions``.

        Each pending intent has TWO legs (y + x); both must fill before
        we count the pair open. Partial fills are tolerated — the intent
        stays in ``pending`` until both legs land or it ages out via the
        ``positions`` watchdog on a later bar.

        Tag-driven matching (``pairs-entry-{pair_id}-...``) is used so that
        an unrelated rebalance fill doesn't accidentally promote a pending
        pair.
        """
        positions: dict[str, OpenPosition] = dict(state.get(f"{_NS}.positions", {}))
        pending: dict[str, OpenPosition] = dict(state.get(f"{_NS}.pending", {}))
        partials: dict[str, set[str]] = dict(state.get(f"{_NS}.pending_partials", {}))

        tag = fill.signal_tag or ""
        # Entry tag format: pairs-entry-<pair_id>-dir<sign><digit>-<leg>
        if tag.startswith("pairs-entry-"):
            for pair_id, intent in list(pending.items()):
                if pair_id not in tag:
                    continue
                legs_seen = set(partials.get(pair_id, set()))
                if fill.symbol == intent.y:
                    legs_seen.add("y")
                elif fill.symbol == intent.x:
                    legs_seen.add("x")
                else:
                    break
                partials[pair_id] = legs_seen
                if {"y", "x"}.issubset(legs_seen):
                    positions[pair_id] = intent
                    pending.pop(pair_id, None)
                    partials.pop(pair_id, None)
                break
        elif tag.startswith("pairs-exit-"):
            # Exit fills clear any pending intent for the same pair_id and
            # drop the position from the confirmed ledger.
            for pair_id in list(positions.keys()):
                if pair_id in tag:
                    positions.pop(pair_id, None)
                    pending.pop(pair_id, None)
                    partials.pop(pair_id, None)
                    break

        held_symbols = (
            {p.y for p in positions.values()} | {p.x for p in positions.values()}
            | {p.y for p in pending.values()} | {p.x for p in pending.values()}
        )
        return {
            f"{_NS}.positions": positions,
            f"{_NS}.pending": pending,
            f"{_NS}.pending_partials": partials,
            f"{_NS}.held_symbols": held_symbols,
        }


# --------------------------------------------------------------------------- #
# Close-matrix derivation                                                     #
# --------------------------------------------------------------------------- #
def _close_matrix(
    bars: pd.DataFrame,
    asof: date,
    formation_days: int,
) -> Optional[pd.DataFrame]:
    """Pivot input.bars into wide (date × symbol) closes, truncated to asof."""
    if bars is None or getattr(bars, "empty", True):
        return None

    idx_names = tuple(bars.index.names or ())
    if "symbol" in idx_names and "date" in idx_names:
        frame = bars.reset_index().rename(columns={"date": "ts"})
    else:
        frame = bars.copy()
        if "ts" not in frame.columns and "ts_date" in frame.columns:
            frame = frame.rename(columns={"ts_date": "ts"})

    if "symbol" not in frame.columns or "close" not in frame.columns or "ts" not in frame.columns:
        return None

    # Round-6 / I-24: ``utc=True`` matches the peer-strategy pattern
    # (regime_adaptive, dual_momentum, ts_momentum, momentum_quality) so
    # mixed-tz inputs from different providers normalise consistently.
    frame["ts"] = pd.to_datetime(frame["ts"], utc=True, errors="coerce")
    frame = frame.dropna(subset=["ts", "close"])
    if frame.empty:
        return None

    wide = (
        frame.pivot_table(index="ts", columns="symbol", values="close", aggfunc="last")
        .sort_index()
    )
    if hasattr(wide.index, "tz") and wide.index.tz is not None:
        wide.index = wide.index.tz_convert(None)
    # Round-6 / I-20: truncate to ``asof`` BEFORE any forward-fill / tail.
    # The cointegration / spread math operates row-wise; ffilling first
    # would have leaked future closes back into earlier dates and biased
    # the screen's residual series.
    cutoff = pd.Timestamp(asof)
    wide = wide[wide.index <= cutoff]
    if wide.empty:
        return None

    # Trim to recent history for efficiency.
    tail_n = int(formation_days * 1.6) + 10
    if len(wide) > tail_n:
        wide = wide.tail(tail_n)
    return wide


def _closes_for(closes: pd.DataFrame, sym: str) -> Optional[pd.Series]:
    if closes is None or closes.empty or sym not in closes.columns:
        return None
    s = closes[sym].astype("float64").dropna()
    return s if not s.empty else None


def _price_transform(df: pd.DataFrame, in_log_space: bool) -> pd.DataFrame:
    """Apply log transform if configured; guard against non-positive values."""
    if not in_log_space:
        return df
    safe = df[(df > 0).all(axis=1)]
    if safe.empty:
        return safe
    return np.log(safe)


# --------------------------------------------------------------------------- #
# Pair screen                                                                 #
# --------------------------------------------------------------------------- #
def _rescreen(
    closes: pd.DataFrame,
    params: PairsTradingParams,
    asof: date,
) -> list[ActivePair]:
    candidates: list[tuple[float, ActivePair]] = []
    for sector, y_sym, x_sym in all_within_sector_pairs():
        y_ser = _closes_for(closes, y_sym)
        x_ser = _closes_for(closes, x_sym)
        if y_ser is None or x_ser is None:
            continue
        df = pd.concat(
            [y_ser.rename("y"), x_ser.rename("x")], axis=1
        ).dropna()
        if len(df) < _MIN_BARS_FOR_SCREEN:
            continue
        df = df.tail(params.formation_days)
        df = _price_transform(df, params.prices_in_log_space)
        if len(df) < _MIN_BARS_FOR_SCREEN:
            continue
        try:
            pvalue, _adf, beta, residuals = engle_granger_adf(df["y"], df["x"])
        except Exception:
            continue
        if not np.isfinite(pvalue) or pvalue > params.adf_pvalue_max:
            continue
        if not np.isfinite(beta) or abs(beta) < 1e-9 or abs(beta) > 10.0:
            continue
        hl = ou_half_life(residuals)
        if not np.isfinite(hl) or hl <= 0 or hl > params.ou_halflife_max_days:
            continue
        try:
            h = hurst(residuals, min_lag=2, max_lag=min(40, len(residuals) // 4))
        except Exception:
            h = float("nan")
        if not np.isfinite(h) or h >= params.hurst_max:
            continue
        candidates.append((pvalue, ActivePair(
            pair_id=f"{y_sym}-{x_sym}",
            sector=sector,
            y=y_sym, x=x_sym,
            beta=float(beta),
            screen_pvalue=float(pvalue),
            screen_halflife=float(hl),
            last_screen_date=asof,
            last_watchdog_date=asof,
            kalman_betas=None,
        )))

    candidates.sort(key=lambda row: row[0])
    seen_syms: set[str] = set()
    active: list[ActivePair] = []
    for _pv, pair in candidates:
        if pair.y in seen_syms or pair.x in seen_syms:
            continue
        active.append(pair)
        seen_syms.update({pair.y, pair.x})
        if len(active) >= params.max_pairs:
            break

    if params.hedge_method == "kalman":
        for pair in active:
            y_ser = _closes_for(closes, pair.y)
            x_ser = _closes_for(closes, pair.x)
            if y_ser is None or x_ser is None:
                continue
            df = pd.concat(
                [y_ser.rename("y"), x_ser.rename("x")], axis=1
            ).dropna().tail(params.formation_days)
            df = _price_transform(df, params.prices_in_log_space)
            # Round-11 / AA-1.1 (P0): ``ActivePair`` is ``frozen=True``
            # (Round-6/I-19 froze it for replay determinism) so direct
            # field assignment raises ``ValidationError: instance is
            # frozen``. The exception escaped ``_rescreen``'s caller
            # and the Kalman branch was permanently broken — every
            # rescreen with ``hedge_method == "kalman"`` aborted before
            # ``state.last_screen`` could advance. Swap to
            # ``model_copy(update=...)`` and rebuild the active list
            # below the loop.
            if df.empty:
                new_betas: Any = None
            else:
                try:
                    new_betas = kalman_hedge_ratio(
                        df["y"], df["x"],
                        delta=params.kalman_delta, r=params.kalman_r,
                    )
                except Exception:
                    new_betas = None
            updated_pair = pair.model_copy(update={"kalman_betas": new_betas})
            # Replace the original entry in ``active`` so the rest of
            # the function (and downstream callers) see the updated
            # betas without mutating the frozen instance.
            for j, p in enumerate(active):
                if p is pair:
                    active[j] = updated_pair
                    break

    return active


# --------------------------------------------------------------------------- #
# Spread + z-score                                                            #
# --------------------------------------------------------------------------- #
def _spread_and_z(
    pair: ActivePair,
    closes: pd.DataFrame,
    params: PairsTradingParams,
) -> Optional[tuple[float, float, float, float, float]]:
    """Return (z_today, beta_today, spread_today, price_y, price_x)."""
    y_ser = _closes_for(closes, pair.y)
    x_ser = _closes_for(closes, pair.x)
    if y_ser is None or x_ser is None:
        return None
    df = pd.concat(
        [y_ser.rename("y"), x_ser.rename("x")], axis=1
    ).dropna()
    if len(df) < max(_MIN_BARS_FOR_TRADE, params.z_window + 2):
        return None
    need = params.z_window + 5
    df_trim = df.tail(need)
    df_trim_est = _price_transform(df_trim, params.prices_in_log_space)
    if df_trim_est.empty or len(df_trim_est) < params.z_window + 2:
        return None

    if params.hedge_method == "kalman" and pair.kalman_betas is not None:
        betas = pair.kalman_betas.reindex(df_trim_est.index).ffill()
        betas = betas.fillna(pair.beta)
        last = betas.dropna()
        beta_today = float(last.iloc[-1]) if not last.empty else pair.beta
    elif params.hedge_method == "kalman":
        try:
            beta_series = kalman_hedge_ratio(
                df_trim_est["y"], df_trim_est["x"],
                delta=params.kalman_delta, r=params.kalman_r,
            )
            last = beta_series.dropna()
            beta_today = float(last.iloc[-1]) if not last.empty else pair.beta
            betas = beta_series.ffill().fillna(pair.beta)
        except Exception:
            beta_today = pair.beta
            betas = pd.Series(pair.beta, index=df_trim_est.index)
    else:
        beta_today = pair.beta
        betas = pd.Series(pair.beta, index=df_trim_est.index)

    spread = df_trim_est["y"] - betas * df_trim_est["x"]
    mean = spread.shift(1).rolling(window=params.z_window, min_periods=params.z_window).mean()
    std = spread.shift(1).rolling(window=params.z_window, min_periods=params.z_window).std(ddof=1)
    z = (spread - mean) / std.replace(0.0, np.nan)
    z_today = float(z.iloc[-1]) if len(z) else float("nan")
    spread_today = float(spread.iloc[-1])
    price_y = float(df_trim["y"].iloc[-1])
    price_x = float(df_trim["x"].iloc[-1])
    if not np.isfinite(z_today):
        return None
    return (z_today, float(beta_today), spread_today, price_y, price_x)


# --------------------------------------------------------------------------- #
# Watchdog                                                                    #
# --------------------------------------------------------------------------- #
def _run_watchdog(
    closes: pd.DataFrame,
    active: list[ActivePair],
    params: PairsTradingParams,
    asof: date,
) -> tuple[set[str], list[ActivePair]]:
    """Re-test cointegration on active pairs due for watchdog.

    Returns ``(failed_pair_ids, refreshed_active)`` where ``refreshed_active``
    has the same ordering as the input but with ``last_watchdog_date``
    bumped to ``asof`` for every pair we examined this bar. Round-6 / I-19:
    ``ActivePair`` is now a frozen Pydantic model, so the previous in-place
    ``pair.last_watchdog_date = asof`` mutation no longer compiles; the
    caller must thread the refreshed list back into state.
    """
    due_ids = {
        pair.pair_id for pair in active
        if (asof - pair.last_watchdog_date).days >= params.watchdog_days
    }
    if not due_ids:
        return set(), list(active)
    failed: set[str] = set()
    refreshed: list[ActivePair] = []
    for pair in active:
        if pair.pair_id not in due_ids:
            refreshed.append(pair)
            continue
        y_ser = _closes_for(closes, pair.y)
        x_ser = _closes_for(closes, pair.x)
        if y_ser is None or x_ser is None:
            failed.add(pair.pair_id)
            refreshed.append(pair.model_copy(update={"last_watchdog_date": asof}))
            continue
        df = pd.concat(
            [y_ser.rename("y"), x_ser.rename("x")], axis=1
        ).dropna().tail(params.formation_days)
        if len(df) < _MIN_BARS_FOR_SCREEN:
            failed.add(pair.pair_id)
            refreshed.append(pair.model_copy(update={"last_watchdog_date": asof}))
            continue
        df = _price_transform(df, params.prices_in_log_space)
        if len(df) < _MIN_BARS_FOR_SCREEN:
            failed.add(pair.pair_id)
            refreshed.append(pair.model_copy(update={"last_watchdog_date": asof}))
            continue
        try:
            pvalue, _adf, _beta, _res = engle_granger_adf(df["y"], df["x"])
        except Exception:
            failed.add(pair.pair_id)
            refreshed.append(pair.model_copy(update={"last_watchdog_date": asof}))
            continue
        if not np.isfinite(pvalue) or pvalue > params.watchdog_pvalue:
            failed.add(pair.pair_id)
        refreshed.append(pair.model_copy(update={"last_watchdog_date": asof}))
    return failed, refreshed


# --------------------------------------------------------------------------- #
# Exits / entries                                                             #
# --------------------------------------------------------------------------- #
def _compute_exits(
    closes: pd.DataFrame,
    positions: dict[str, OpenPosition],
    active: list[ActivePair],
    params: PairsTradingParams,
    asof: date,
) -> tuple[list[Signal], list[ActivePair]]:
    """Compute exit signals plus the refreshed active-pair list.

    Returns ``(signals, refreshed_active)`` so the caller can write back
    the watchdog-bumped ``last_watchdog_date`` values to state. Round-6 /
    I-19: required because ``ActivePair`` is frozen.
    """
    if not positions:
        return [], list(active)
    by_id = {pair.pair_id: pair for pair in active}
    watchdog_failures, refreshed_active = _run_watchdog(closes, active, params, asof)

    exits: list[Signal] = []
    to_close: list[tuple[str, str]] = []
    for pair_id, pos in positions.items():
        if pair_id in watchdog_failures:
            to_close.append((pair_id, "watchdog"))
            continue
        pair = by_id.get(pair_id)
        if pair is None:
            to_close.append((pair_id, "delisted"))
            continue
        zinfo = _spread_and_z(pair, closes, params)
        if zinfo is None:
            continue
        z_today = zinfo[0]
        if abs(z_today) >= params.z_stop:
            to_close.append((pair_id, "stop"))
        elif abs(z_today) < params.z_exit:
            to_close.append((pair_id, "mean-revert"))

    for pair_id, reason in to_close:
        pos = positions.get(pair_id)
        if pos is None:
            continue
        exits.append(Signal(
            symbol=pos.y, target_weight=0.0,
            order_type=OrderType.MOC, time_in_force=TimeInForce.DAY,
            tag=f"pairs-exit-{reason}-{pair_id}-y", asof=asof,
        ))
        exits.append(Signal(
            symbol=pos.x, target_weight=0.0,
            order_type=OrderType.MOC, time_in_force=TimeInForce.DAY,
            tag=f"pairs-exit-{reason}-{pair_id}-x", asof=asof,
        ))
    return exits, refreshed_active


def _compute_entries(
    closes: pd.DataFrame,
    positions: dict[str, OpenPosition],
    pending: dict[str, OpenPosition],
    active: list[ActivePair],
    params: PairsTradingParams,
    asof: date,
    exclude_pair_ids: set[str] | None = None,
) -> tuple[list[Signal], dict[str, OpenPosition]]:
    """Compute entry signals and the pending-intent dict to merge into state.

    Round-6 / I-4: returns ``(signals, new_pending_intents)`` instead of
    mutating ``positions`` in-place. ``positions`` is the broker-confirmed
    ledger; intents only graduate into it via ``on_fill``. Same-bar
    capacity also accounts for ``pending`` so a stuck unfilled pair from
    yesterday doesn't let us re-arm beyond ``max_pairs``.
    """
    occupied = len(positions) + len(pending)
    if occupied >= params.max_pairs:
        return [], {}
    held_syms = (
        {pos.y for pos in positions.values()} | {pos.x for pos in positions.values()}
        | {pos.y for pos in pending.values()} | {pos.x for pos in pending.values()}
    )
    exclude = exclude_pair_ids or set()

    candidates: list[tuple[float, ActivePair, float, float, float, float]] = []
    for pair in active:
        if pair.pair_id in positions or pair.pair_id in pending or pair.pair_id in exclude:
            continue
        if pair.y in held_syms or pair.x in held_syms:
            continue
        zinfo = _spread_and_z(pair, closes, params)
        if zinfo is None:
            continue
        z_today, beta_today, _spread, price_y, price_x = zinfo
        if not np.isfinite(z_today):
            continue
        if abs(z_today) < params.z_entry or abs(z_today) >= params.z_stop:
            continue
        if not np.isfinite(beta_today) or abs(beta_today) < 1e-9:
            continue
        if price_y <= 0 or price_x <= 0:
            continue
        candidates.append((abs(z_today), pair, beta_today, price_y, price_x, z_today))
    candidates.sort(key=lambda row: row[0], reverse=True)

    entries: list[Signal] = []
    new_pending: dict[str, OpenPosition] = {}
    remaining = params.max_pairs - occupied
    for _mag, pair, beta_today, _py, _px, z_today in candidates:
        if remaining <= 0:
            break

        long_w = params.pair_weight
        short_w = -params.pair_weight
        if z_today <= -params.z_entry:
            direction = +1
            y_weight, x_weight = long_w, short_w
            long_sym, short_sym = pair.y, pair.x
        else:
            direction = -1
            y_weight, x_weight = short_w, long_w
            long_sym, short_sym = pair.x, pair.y

        tag_base = f"pairs-entry-{pair.pair_id}-dir{direction:+d}"
        entries.append(Signal(
            symbol=pair.y, target_weight=float(y_weight),
            order_type=OrderType.MOO, time_in_force=TimeInForce.DAY,
            tag=f"{tag_base}-y", asof=asof,
        ))
        entries.append(Signal(
            symbol=pair.x, target_weight=float(x_weight),
            order_type=OrderType.MOO, time_in_force=TimeInForce.DAY,
            tag=f"{tag_base}-x", asof=asof,
        ))

        new_pending[pair.pair_id] = OpenPosition(
            pair_id=pair.pair_id,
            y=pair.y, x=pair.x,
            beta=float(beta_today),
            direction=direction,
            entry_z=float(z_today),
            entry_date=asof,
            long_sym=long_sym, short_sym=short_sym,
            long_weight=float(long_w), short_weight=float(short_w),
        )
        held_syms.update({pair.y, pair.x})
        remaining -= 1
    return entries, new_pending


__all__ = ["PairsTradingStrategy", "ActivePair", "OpenPosition"]
