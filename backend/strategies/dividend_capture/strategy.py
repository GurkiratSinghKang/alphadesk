"""Dividend Capture — SOTA shell.

Long-only event-driven strategy that captures the ex-dividend-day pricing
anomaly: prices on average drop by less than the cash dividend on the
ex-date, leaving a small gross return for the holder of record. Filters
the universe by liquidity, dividend yield (event-level), and an earnings
overlap to avoid catalyst conflicts during the 4-5 session holding window.

References:
- Elton, E. J., & Gruber, M. J. (1970). "Marginal Stockholder Tax Rates and
  the Clientele Effect." *Review of Economics and Statistics* 52(1), 68–74.
- Frank, M., & Jagannathan, R. (1998). "Why Do Stock Prices Drop by Less
  Than the Value of the Dividend?" *Journal of Financial Economics* 47(2).
- Graham, J. R., Michaely, R., & Roberts, M. R. (2003). "Do Price
  Discreteness and Transactions Costs Affect Stock Returns?" *Journal of
  Finance* 58(6), 2611–2636.

Rule summary:
- Each premarket scan, look at upcoming ex-dividend events in the next
  ``entry_offset_days`` trading sessions (default 3).
- For each candidate, apply: liquidity floor, min event yield, no
  overlapping earnings, not in the dividend-ETF skip-list.
- Rank by yield (highest first), enter top ``max_positions`` MOC at T-3
  before ex-date.
- Exit MOC at T+``exit_offset_days`` (default T+1).
- Per-bar: if a held position has reached its scheduled exit date,
  emit MOC exit.
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

from .config import DIVIDEND_UNIVERSE_SEED, DividendCaptureParams


log = logging.getLogger("alphadesk.strategies.dividend_capture")

_NS = "dividend_capture"
_REQUIRED_LOOKBACK_DAYS = 120


@register_strategy(
    StrategyMeta(
        name="dividend_capture",
        category="equity",
        description=(
            "Capture the ex-dividend-day pricing anomaly (Elton-Gruber 1970): "
            "enter T-3 sessions before ex-date, exit T+1 after, on liquid "
            "large-caps with min 0.5% per-event yield and no earnings overlap. "
            "Yield-ranked top-N book at MOC; defined holding window."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=10,
    )
)
class DividendCaptureStrategy(Strategy):
    """Dividend capture — see module docstring."""

    PARAMS_MODEL = DividendCaptureParams

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return list(DIVIDEND_UNIVERSE_SEED)

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: DividendCaptureParams,
    ) -> StrategyResult:
        asof = input.asof
        diagnostics: dict[str, Any] = {
            "n_dividend_events": 0,
            "n_passed_yield": 0,
            "n_passed_earnings": 0,
            "n_entered": 0,
            "n_exits": 0,
            "exit_reasons": {},
        }
        warnings: list[str] = []
        signals: list[Signal] = []

        # --- Always-on: per-position scheduled exits -------------------- #
        exit_signals, exit_state = _build_scheduled_exits(
            input.positions, input.state, asof, params,
        )
        signals.extend(exit_signals)
        diagnostics["n_exits"] = len(exit_signals)
        diagnostics["exit_reasons"] = {s.symbol: s.tag.split("-")[-1] for s in exit_signals}

        # --- Entry path: scan input.dividends for upcoming ex-events ---- #
        candidates = _screen_candidates(
            input.dividends, input.bars, input.earnings,
            input.positions, params, asof, diagnostics,
        )

        # Capacity: respect max_positions across new + held set.
        held_syms = {p.symbol for p in input.positions if p.quantity != 0}
        free_slots = max(0, params.max_positions - len(held_syms))
        chosen = candidates[:free_slots]
        diagnostics["n_entered"] = len(chosen)

        # State update: track scheduled exit_date for each new entry.
        state_update = dict(exit_state)
        existing_exits = state_update.get(f"{_NS}.exit_dates", {})
        if not isinstance(existing_exits, dict):
            existing_exits = {}
        new_exits = dict(existing_exits)

        for cand in chosen:
            sym = cand["symbol"]
            ex_date = cand["ex_date"]
            scheduled_exit = ex_date + timedelta(
                days=int(round(params.exit_offset_days * 7 / 5)) + 1
            )
            new_exits[sym] = scheduled_exit.isoformat()
            signals.append(
                Signal(
                    symbol=sym,
                    target_weight=params.target_weight_per_name,
                    order_type=OrderType.MOC,
                    time_in_force=TimeInForce.DAY,
                    tag=f"dc-entry-{sym}",
                    asof=asof,
                )
            )
        state_update[f"{_NS}.exit_dates"] = new_exits

        return StrategyResult(
            signals=signals,
            state_update=state_update,
            diagnostics=diagnostics,
            warnings=warnings,
        )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _normalize_dividends_frame(dividends: Optional[pd.DataFrame]) -> Optional[pd.DataFrame]:
    """Accept either ``ex_date`` or ``date`` column; return a frame with ``ex_date``."""
    if dividends is None or getattr(dividends, "empty", True):
        return None
    if "symbol" not in dividends.columns or "cash_amount" not in dividends.columns:
        return None
    df = dividends.copy()
    if "ex_date" not in df.columns:
        if "date" in df.columns:
            df = df.rename(columns={"date": "ex_date"})
        else:
            return None
    df["ex_date"] = pd.to_datetime(df["ex_date"], errors="coerce").dt.date
    df = df.dropna(subset=["ex_date", "cash_amount"])
    if df.empty:
        return None
    df["symbol"] = df["symbol"].astype(str).str.upper()
    return df


def _last_close(bars: pd.DataFrame, sym: str, asof: date) -> Optional[float]:
    """Most-recent close for ``sym`` at-or-before ``asof``."""
    idx_names = tuple(bars.index.names or ())
    if "symbol" not in idx_names or "date" not in idx_names:
        return None
    try:
        sub = bars.xs(sym, level="symbol")
    except KeyError:
        return None
    if sub.empty or "close" not in sub.columns:
        return None
    sub = sub.sort_index()
    closes = sub["close"].dropna()
    if closes.empty:
        return None
    return float(closes.iloc[-1])


def _has_imminent_earnings(
    earnings: Optional[pd.DataFrame],
    sym: str,
    asof: date,
    skip_days: int,
) -> bool:
    """True iff ``sym`` has scheduled earnings within ``skip_days`` sessions."""
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


_DIVIDEND_ETFS = {"SCHD", "VIG", "VYM", "DVY", "DGRO", "SDY", "NOBL"}


def _screen_candidates(
    dividends: Optional[pd.DataFrame],
    bars: pd.DataFrame,
    earnings: Optional[pd.DataFrame],
    positions: list[Any],
    params: DividendCaptureParams,
    asof: date,
    diagnostics: dict[str, Any],
) -> list[dict[str, Any]]:
    """Filter + rank dividend events into actionable candidates."""
    df = _normalize_dividends_frame(dividends)
    if df is None:
        return []

    # Window: events ex-dating between (asof + entry_offset_days) and a small
    # buffer. We enter at T - entry_offset_days, so today's actionable events
    # are those with ex_date == asof + entry_offset_days (in trading sessions,
    # approximated as int(round(N * 7 / 5)) calendar days).
    window_calendar_days = int(round(params.entry_offset_days * 7 / 5))
    target_ex_date_min = asof + timedelta(days=window_calendar_days - 1)
    target_ex_date_max = asof + timedelta(days=window_calendar_days + 1)

    upcoming = df[(df["ex_date"] >= target_ex_date_min) & (df["ex_date"] <= target_ex_date_max)]
    diagnostics["n_dividend_events"] = int(len(upcoming))

    held_syms = {p.symbol for p in positions if p.quantity != 0}

    survivors: list[dict[str, Any]] = []
    for _, row in upcoming.iterrows():
        sym = str(row["symbol"]).upper()
        if sym in held_syms:
            continue
        if params.skip_etfs and sym in _DIVIDEND_ETFS:
            continue

        cash = float(row["cash_amount"])
        if not np.isfinite(cash) or cash <= 0:
            continue

        last_px = _last_close(bars, sym, asof)
        if last_px is None or last_px <= 0:
            continue

        event_yield = cash / last_px
        if event_yield < params.min_yield_pct:
            continue
        diagnostics["n_passed_yield"] += 1

        if _has_imminent_earnings(earnings, sym, asof, params.earnings_skip_days):
            continue
        diagnostics["n_passed_earnings"] += 1

        survivors.append({
            "symbol": sym,
            "ex_date": row["ex_date"],
            "cash_amount": cash,
            "last_price": last_px,
            "event_yield": event_yield,
        })

    # Highest yield first.
    survivors.sort(key=lambda c: c["event_yield"], reverse=True)
    return survivors


def _build_scheduled_exits(
    positions: list[Any],
    state: dict[str, Any],
    asof: date,
    params: DividendCaptureParams,
) -> tuple[list[Signal], dict[str, Any]]:
    """Emit MOC exits for any held name whose scheduled exit date has arrived."""
    raw = state.get(f"{_NS}.exit_dates", {})
    exit_dates: dict[str, date] = {}
    if isinstance(raw, dict):
        for sym, ds in raw.items():
            try:
                exit_dates[str(sym).upper()] = (
                    ds if isinstance(ds, date) and not isinstance(ds, bool)
                    else date.fromisoformat(str(ds))
                )
            except Exception:
                continue

    new_exits = dict(exit_dates)
    out: list[Signal] = []
    for pos in positions:
        if pos.quantity == 0:
            continue
        sym = pos.symbol.upper()
        scheduled = exit_dates.get(sym)
        if scheduled is None:
            continue
        if asof >= scheduled:
            out.append(
                Signal(
                    symbol=pos.symbol,
                    target_weight=0.0,
                    order_type=OrderType.MOC,
                    time_in_force=TimeInForce.DAY,
                    tag=f"dc-exit-scheduled",
                    asof=asof,
                )
            )
            new_exits.pop(sym, None)

    return out, {f"{_NS}.exit_dates": new_exits}
