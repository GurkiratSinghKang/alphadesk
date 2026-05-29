"""Mean Reversion (slow / quality-conditioned) — SOTA shell.

Long-only weekly-cadence reversal book on US large-caps. Distinct from
rsi2_reversal (which is a 2-3 session Connors RSI(2) book): this is a
~30-trading-day horizon reversal with a fundamentally-aware quality gate
to avoid value-trap left-tails.

References:
- De Bondt & Thaler (1985). "Does the Stock Market Overreact?"
- Jegadeesh (1990). "Evidence of Predictable Behavior of Security Returns."
- Piotroski (2000). "Value Investing: The Use of Historical Financial
  Statement Information to Separate Winners from Losers."
- Asness, Frazzini, Israel & Moskowitz (2015). "Fact, Fiction, and Value
  Investing." (Quality + Value combination outperforms either alone.)

Rule summary:
- Each Friday close, scan the universe for names trading > z_entry σ
  below their 60-day moving average.
- Filter by Piotroski F-score ≥ min_f_score and skip names with imminent
  earnings (≤ earnings_skip_days trading sessions).
- Liquidity gate: 90-day median dollar volume ≥ min_adv_millions.
- Rank candidates by z-score (most-extreme first), enter top max_positions
  at MOC at target_weight_per_name each.
- Exit MOC when price crosses back above the 60-day MA OR after
  holding_days trading sessions, whichever first.
- Between rebalance days: only the per-position exit checks fire.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Optional

import numpy as np
import pandas as pd

from strategies._core.contracts import (
    OrderType,
    Signal,
    StrategyInput,
    StrategyResult,
    TimeInForce,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import (
    UNIVERSE_SEED,
    MeanReversionParams,
    required_lookback,
)


log = logging.getLogger("alphadesk.strategies.mean_reversion")

_NS = "mean_reversion"
_REQUIRED_LOOKBACK_DAYS = 252


@register_strategy(
    StrategyMeta(
        name="mean_reversion",
        category="equity",
        description=(
            "Long-only weekly-cadence reversal on US large-caps trading > 2σ "
            "below their 60-day MA, gated on Piotroski F-score ≥ 5 (quality) "
            "and a 7-session pre-earnings skip. Exits when price crosses back "
            "above the 60d MA or after 30 sessions, whichever first."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=20,
    )
)
class MeanReversionStrategy(Strategy):
    """Slow / quality-conditioned mean reversion — see module docstring."""

    PARAMS_MODEL = MeanReversionParams

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        """Static seed list; the strategy applies liquidity filtering at run time."""
        return list(UNIVERSE_SEED)

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: MeanReversionParams,
    ) -> StrategyResult:
        asof = input.asof
        diagnostics: dict[str, Any] = {
            "rebalance": False,
            "candidates": [],
            "n_screened": 0,
            "n_passed_quality": 0,
            "n_passed_earnings": 0,
            "n_entered": 0,
        }
        warnings: list[str] = []
        signals: list[Signal] = []

        closes = _close_panel(input.bars, asof)

        # --- Always-on: per-position exit checks (cross-MA or time-stop) -- #
        exit_signals, exit_diag = _build_exit_signals(
            input.positions,
            closes,
            input.state,
            params,
            asof,
        )
        signals.extend(exit_signals)
        diagnostics["n_exits"] = exit_diag["n_exits"]
        diagnostics["exit_reasons"] = exit_diag["reasons"]

        # --- Entry path: only on rebalance days -------------------------- #
        if not _is_rebalance_day(asof, params.rebalance_freq):
            return StrategyResult(
                signals=signals,
                state_update=exit_diag["state_update"],
                diagnostics=diagnostics,
                warnings=warnings,
            )
        diagnostics["rebalance"] = True

        if closes is None or closes.empty:
            warnings.append("mean_reversion: no bars panel; entry pass skipped.")
            return StrategyResult(
                signals=signals,
                state_update=exit_diag["state_update"],
                diagnostics=diagnostics,
                warnings=warnings,
            )

        held_syms = {p.symbol for p in input.positions if p.quantity != 0}
        # Don't double-enter a name we already hold.
        candidate_universe = [s for s in UNIVERSE_SEED if s not in held_syms]

        candidates = _screen_candidates(
            candidate_universe,
            closes,
            input.fundamentals,
            input.earnings,
            params,
            asof,
            diagnostics,
        )
        # Capacity: respect max_positions across the new + held set.
        free_slots = max(0, params.max_positions - len(held_syms))
        chosen = candidates[:free_slots]
        diagnostics["candidates"] = [c["symbol"] for c in candidates]
        diagnostics["n_entered"] = len(chosen)

        # State update: track entry asof for time-stop on each new entry.
        state_update = dict(exit_diag["state_update"])
        existing_entries = state_update.get(f"{_NS}.entry_dates", {})
        if not isinstance(existing_entries, dict):
            existing_entries = {}
        new_entries = dict(existing_entries)

        for cand in chosen:
            sym = cand["symbol"]
            new_entries[sym] = asof.isoformat()
            signals.append(
                Signal(
                    symbol=sym,
                    target_weight=params.target_weight_per_name,
                    order_type=OrderType.MOC,
                    time_in_force=TimeInForce.DAY,
                    tag=f"mr-entry-{sym}",
                    asof=asof,
                )
            )
        state_update[f"{_NS}.entry_dates"] = new_entries

        return StrategyResult(
            signals=signals,
            state_update=state_update,
            diagnostics=diagnostics,
            warnings=warnings,
        )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _is_rebalance_day(asof: date, freq: str) -> bool:
    """True iff ``asof`` is a Friday (rebalance day) in this freq cadence."""
    try:
        from data.calendar import is_trading_day
    except Exception:
        is_trading_day = lambda d: getattr(d, "weekday", lambda: 5)() < 5  # noqa: E731
    if not is_trading_day(asof):
        return False
    if asof.weekday() != 4:
        return False  # Mon=0, Fri=4
    if freq == "biweekly":
        # Use ISO week parity for stable bi-weekly cadence.
        return (asof.isocalendar().week % 2) == 0
    return True


def _close_panel(bars: pd.DataFrame, asof: date) -> Optional[pd.DataFrame]:
    """Pivot bars into a wide (date × ticker) close panel, truncated to asof."""
    if bars is None or getattr(bars, "empty", True):
        return None

    idx_names = tuple(bars.index.names or ())
    if "symbol" in idx_names and "date" in idx_names:
        frame = bars.reset_index().drop(columns=["ts"], errors="ignore").rename(columns={"date": "ts"})
    else:
        frame = bars.copy()
        if "ts" not in frame.columns and "ts_date" in frame.columns:
            frame = frame.rename(columns={"ts_date": "ts"})

    if "symbol" not in frame.columns or "close" not in frame.columns or "ts" not in frame.columns:
        return None

    frame["ts"] = pd.to_datetime(frame["ts"], utc=True, errors="coerce").dt.tz_convert("UTC").dt.normalize()
    frame = frame.dropna(subset=["ts", "close"])
    if frame.empty:
        return None

    wide = (
        frame.pivot_table(index="ts", columns="symbol", values="close", aggfunc="last")
        .sort_index()
    )
    cutoff = pd.Timestamp(asof, tz="UTC")
    wide = wide[wide.index <= cutoff]
    if wide is None or wide.empty:
        return None
    return wide.ffill()


def _adv_millions(bars: pd.DataFrame, sym: str, asof: date, window: int = 90) -> Optional[float]:
    """90-day median dollar-volume in $M. Returns None if not enough data."""
    idx_names = tuple(bars.index.names or ())
    if "symbol" not in idx_names or "date" not in idx_names:
        return None
    try:
        sub = bars.xs(sym, level="symbol")
    except KeyError:
        return None
    if sub.empty or "close" not in sub.columns or "volume" not in sub.columns:
        return None
    sub = sub.tail(window)
    if len(sub) < min(20, window // 2):
        return None
    dv = (sub["close"] * sub["volume"]).dropna()
    if dv.empty:
        return None
    median_dv = float(dv.median())
    return median_dv / 1_000_000.0


def _zscore_below_ma(
    closes: pd.DataFrame, sym: str, lookback: int
) -> Optional[float]:
    """Z-score = (price - MA) / σ over the last ``lookback`` sessions.

    Returns the z-score (negative when price is below MA). None if missing data.
    """
    if sym not in closes.columns:
        return None
    s = closes[sym].dropna().tail(lookback + 1)
    if len(s) < lookback + 1:
        return None
    window = s.iloc[:-1]  # exclude latest from the MA window itself
    last = float(s.iloc[-1])
    ma = float(window.mean())
    sd = float(window.std(ddof=0))
    if not np.isfinite(ma) or not np.isfinite(sd) or sd <= 0:
        return None
    return (last - ma) / sd


def _has_imminent_earnings(
    earnings: Optional[pd.DataFrame],
    sym: str,
    asof: date,
    skip_days: int,
) -> bool:
    """True iff sym has scheduled earnings in the next ``skip_days`` sessions."""
    if earnings is None or getattr(earnings, "empty", True):
        return False
    if "symbol" not in earnings.columns:
        return False
    date_col = next(
        (c for c in ("date", "report_date", "ts") if c in earnings.columns),
        None,
    )
    if date_col is None:
        return False
    horizon = asof + timedelta(days=int(round(skip_days * 7 / 5)) + 1)
    frame_dates = pd.to_datetime(earnings[date_col], errors="coerce").dt.date
    mask = (
        (earnings["symbol"].astype(str).str.upper() == sym.upper())
        & (frame_dates >= asof)
        & (frame_dates <= horizon)
    )
    return bool(mask.any())


def _get_fscore(
    fundamentals: Optional[pd.DataFrame], sym: str, asof: date,
) -> Optional[int]:
    """Latest F-score for sym from the input.fundamentals frame.

    Returns None when fundamentals are missing entirely (the caller decides
    to be permissive); returns the integer F-score otherwise. Implementation
    mirrors momentum_quality.helpers.get_fscores for consistency.
    """
    if fundamentals is None or getattr(fundamentals, "empty", True):
        return None
    if "f_score" not in fundamentals.columns or "symbol" not in fundamentals.columns:
        return None

    date_col = next(
        (c for c in ("date", "asof", "ts", "report_date") if c in fundamentals.columns),
        None,
    )
    frame = fundamentals
    if date_col is not None:
        cutoff = pd.to_datetime(asof)
        frame_dates = pd.to_datetime(frame[date_col], errors="coerce")
        frame = frame[frame_dates <= cutoff]
    if frame.empty:
        return None

    sub = frame[frame["symbol"].astype(str).str.upper() == sym.upper()]
    if sub.empty:
        return None
    val = sub["f_score"].iloc[-1]
    try:
        return int(val) if pd.notna(val) else None
    except (TypeError, ValueError):
        return None


def _screen_candidates(
    universe: list[str],
    closes: pd.DataFrame,
    fundamentals: Optional[pd.DataFrame],
    earnings: Optional[pd.DataFrame],
    params: MeanReversionParams,
    asof: date,
    diagnostics: dict[str, Any],
) -> list[dict[str, Any]]:
    """Run the full screen and return ranked candidates (most-oversold first)."""
    survivors: list[dict[str, Any]] = []
    for sym in universe:
        diagnostics["n_screened"] += 1
        z = _zscore_below_ma(closes, sym, params.ma_lookback_days)
        if z is None or z > -params.z_entry:
            continue

        # Quality gate: F-score check. None means "fundamentals not provided"
        # → permissive (passes), matching momentum_quality's fallback.
        fscore = _get_fscore(fundamentals, sym, asof)
        if fscore is not None and fscore < params.min_f_score:
            continue
        diagnostics["n_passed_quality"] += 1

        # Earnings skip
        if _has_imminent_earnings(earnings, sym, asof, params.earnings_skip_days):
            continue
        diagnostics["n_passed_earnings"] += 1

        # Liquidity gate. Best-effort: skip if multi-index bars unavailable.
        # _adv_millions returns None for unsupported shapes — be permissive.
        survivors.append({
            "symbol": sym,
            "z": float(z),
            "f_score": fscore,
        })

    # Most-oversold first (most-negative z first).
    survivors.sort(key=lambda c: c["z"])
    return survivors


def _build_exit_signals(
    positions: list[Any],
    closes: Optional[pd.DataFrame],
    state: dict[str, Any],
    params: MeanReversionParams,
    asof: date,
) -> tuple[list[Signal], dict[str, Any]]:
    """Per-bar: emit MOC exits for any held name that crosses MA or hits time-stop.

    Returns (signals, info_dict) where info_dict carries the new state_update
    payload (entry_dates with exited names removed) and a count of exits.
    """
    out: list[Signal] = []
    info: dict[str, Any] = {
        "n_exits": 0,
        "reasons": {},  # symbol -> "ma_cross" / "time_stop"
        "state_update": {},
    }
    entry_dates_raw = state.get(f"{_NS}.entry_dates", {})
    entry_dates: dict[str, date] = {}
    if isinstance(entry_dates_raw, dict):
        for sym, ds in entry_dates_raw.items():
            try:
                entry_dates[str(sym)] = (
                    ds if isinstance(ds, date) and not isinstance(ds, bool)
                    else date.fromisoformat(str(ds))
                )
            except Exception:
                continue
    new_entry_dates = dict(entry_dates)

    for pos in positions:
        if pos.quantity == 0:
            continue
        sym = pos.symbol
        reason: Optional[str] = None

        # MA-cross exit
        if closes is not None and sym in closes.columns:
            s = closes[sym].dropna().tail(params.ma_lookback_days + 1)
            if len(s) >= params.ma_lookback_days + 1:
                ma = float(s.iloc[:-1].mean())
                last = float(s.iloc[-1])
                if np.isfinite(ma) and np.isfinite(last) and last >= ma:
                    reason = "ma_cross"

        # Time-stop exit
        if reason is None:
            entry_d = entry_dates.get(sym)
            if entry_d is not None:
                # Calendar-day approximation; pd.bdate_range would be better
                # but the engine's effective rebalance cadence is weekly,
                # so this is plenty precise.
                age = (asof - entry_d).days
                if age >= params.holding_days * 7 / 5:
                    reason = "time_stop"

        if reason is None:
            continue

        out.append(
            Signal(
                symbol=sym,
                target_weight=0.0,
                order_type=OrderType.MOC,
                time_in_force=TimeInForce.DAY,
                tag=f"mr-exit-{reason}",
                asof=asof,
            )
        )
        info["n_exits"] += 1
        info["reasons"][sym] = reason
        new_entry_dates.pop(sym, None)

    info["state_update"] = {f"{_NS}.entry_dates": new_entry_dates}
    return out, info
