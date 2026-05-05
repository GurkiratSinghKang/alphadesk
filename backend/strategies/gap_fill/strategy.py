"""Gap-Fill — SOTA shell.

Trades the overnight-gap mean-reversion documented by Branch & Ma (2012)
and Akbas-Boehmer-Jiang-Koch (2022): liquid US large-caps that gap on no
material catalyst tend to retrace within the first 30-90 minutes of
regular-session trading.

The strategy fires at 09:35 ET (open + 5 min) and:
- Identifies symbols whose 09:30 open gap (vs prior session close) is
  between min_gap_pct and max_gap_pct (default 1-4%).
- Skips names with imminent earnings (catalyst-driven, not noise).
- Enters fade direction (long for down-gap, short for up-gap if
  ``direction=fade_both``; default is ``fade_down_only`` for safety).
- Closes all positions at exit_at_minutes (default 11:00 ET = open+90).

Infrastructure: consumes ``input.intraday_bars["1min"]`` (already wired
in the BacktestRunner pre-fetch path) and ``input.bars`` for the prior
daily close. No new engine work required — the intraday plumbing
landed in earlier waves.

Paper-only by default. Branch-Ma documents 0.3-0.6 Sharpe on cleanly-
classified non-catalyst gaps; the catalyst-classifier here is a basic
boolean-OR (earnings_skip_days + size cap), so realistic forward Sharpe
is the lower end.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

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

from .config import GAP_FILL_UNIVERSE_SEED, GapFillParams


log = logging.getLogger("alphadesk.strategies.gap_fill")

_NS = "gap_fill"
_REQUIRED_LOOKBACK_DAYS = 5  # only need yesterday's close + today's intraday
_ET = ZoneInfo("America/New_York")
_MARKET_OPEN = time(9, 30)


@register_strategy(
    StrategyMeta(
        name="gap_fill",
        category="intraday",
        kind="autonomous",
        description=(
            "Branch-Ma (2012) overnight-gap fade on liquid US large-caps. "
            "Enter at open+5min on names with 1-4% non-catalyst gaps; close "
            "by 11:00 ET. Long-only on down-gaps by default (fade_down_only); "
            "tunable to fade both directions."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily", "1min"),
        min_universe_size=10,
        paper_only=True,  # paper-first; graduate after live intraday evidence
    )
)
class GapFillStrategy(Strategy):
    """Gap-fill — see module docstring."""

    PARAMS_MODEL = GapFillParams

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return list(GAP_FILL_UNIVERSE_SEED)

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: GapFillParams,
    ) -> StrategyResult:
        asof = input.asof
        diagnostics: dict[str, Any] = {
            "n_universe": 0,
            "n_with_gap": 0,
            "n_passed_size": 0,
            "n_passed_earnings": 0,
            "n_entered": 0,
            "n_exits": 0,
        }
        warnings: list[str] = []
        signals: list[Signal] = []

        intraday = input.intraday_bars.get("1min")
        if intraday is None or getattr(intraday, "empty", True):
            return StrategyResult(
                signals=[],
                diagnostics={
                    "data_ready": False,
                    "reason": "missing 1min intraday bars",
                    **diagnostics,
                },
                warnings=["gap_fill skipped: missing 1min intraday bars"],
            )

        # --- Always-on: time-stop exits at exit_at_minutes -------------- #
        intraday_now = _latest_intraday_minute(intraday, asof)
        if intraday_now is not None:
            mins_since_open = _minutes_since_open(intraday_now)
            if mins_since_open is not None and mins_since_open >= params.exit_at_minutes:
                for pos in input.positions:
                    if pos.quantity == 0:
                        continue
                    if pos.symbol not in GAP_FILL_UNIVERSE_SEED:
                        continue
                    signals.append(
                        Signal(
                            symbol=pos.symbol,
                            target_weight=0.0,
                            order_type=OrderType.MKT,
                            time_in_force=TimeInForce.DAY,
                            tag="gf-exit-time",
                            asof=asof,
                        )
                    )
                    diagnostics["n_exits"] += 1
                # When time-stop fires we don't open new positions.
                return StrategyResult(
                    signals=signals,
                    diagnostics=diagnostics,
                    warnings=warnings,
                )

        # --- Entry path: only at the entry-after window ------------------ #
        if intraday_now is None:
            return StrategyResult(signals=signals, diagnostics=diagnostics, warnings=warnings)

        mins_since_open = _minutes_since_open(intraday_now)
        if mins_since_open is None or mins_since_open < params.entry_after_minutes:
            return StrategyResult(signals=signals, diagnostics=diagnostics, warnings=warnings)
        # Don't fire after the exit window (open new positions only in the
        # entry zone; once we're past exit_at_minutes the time-stop branch
        # handles things).
        if mins_since_open > params.exit_at_minutes:
            return StrategyResult(signals=signals, diagnostics=diagnostics, warnings=warnings)

        # Already-open positions count toward our concurrency cap.
        held = {p.symbol for p in input.positions if p.quantity != 0}
        free_slots = max(0, params.max_positions - len(held))
        if free_slots <= 0:
            return StrategyResult(signals=signals, diagnostics=diagnostics, warnings=warnings)

        candidates = _screen_gaps(
            input.bars, intraday, input.earnings,
            held, params, asof, diagnostics,
        )
        chosen = candidates[:free_slots]
        diagnostics["n_entered"] = len(chosen)

        for cand in chosen:
            sym = cand["symbol"]
            # fade direction: down-gap → long; up-gap → short (if direction
            # allows). target_weight signed accordingly.
            weight = (
                params.target_weight_per_name
                if cand["gap_pct"] < 0
                else -params.target_weight_per_name
            )
            signals.append(
                Signal(
                    symbol=sym,
                    target_weight=weight,
                    order_type=OrderType.MKT,
                    time_in_force=TimeInForce.DAY,
                    tag=f"gf-entry-{sym}",
                    asof=asof,
                )
            )

        return StrategyResult(
            signals=signals,
            diagnostics=diagnostics,
            warnings=warnings,
        )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _latest_intraday_minute(intraday: pd.DataFrame, asof: date) -> Optional[datetime]:
    """Most-recent minute timestamp in the intraday frame for ``asof``.

    The intraday frame is indexed (date, symbol, minute) or has columns
    ``date / symbol / ts / close`` depending on provider shape. This helper
    is provider-shape-agnostic.
    """
    if intraday is None or getattr(intraday, "empty", True):
        return None

    # Preferred: MultiIndex with a minute-level timestamp
    if "ts" in intraday.index.names:
        mins = intraday.index.get_level_values("ts")
    elif "ts" in intraday.columns:
        mins = intraday["ts"]
    elif "minute" in intraday.columns:
        mins = intraday["minute"]
    else:
        return None
    ser = pd.to_datetime(mins, errors="coerce", utc=True)
    if ser.isna().all():
        return None
    asof_ts = pd.Timestamp(asof, tz="UTC")
    today_only = ser[(ser >= asof_ts) & (ser < asof_ts + pd.Timedelta(days=1))]
    if len(today_only) == 0:
        # Fall back to the absolute latest if nothing matches asof's date.
        return ser.dropna().max().to_pydatetime()
    return today_only.max().to_pydatetime()


def _minutes_since_open(now: datetime) -> Optional[int]:
    """Minutes since 09:30 ET on the given timestamp's date.

    Returns None if ``now`` is pre-market or after-hours.
    """
    if now is None:
        return None
    et = now.astimezone(_ET) if now.tzinfo else now.replace(tzinfo=_ET)
    open_dt = datetime.combine(et.date(), _MARKET_OPEN, tzinfo=_ET)
    delta = et - open_dt
    mins = int(delta.total_seconds() / 60)
    if mins < 0:
        return None
    return mins


def _today_open(intraday: pd.DataFrame, sym: str, asof: date) -> Optional[float]:
    """Today's first-bar open price for ``sym`` from the intraday frame."""
    if intraday is None or getattr(intraday, "empty", True):
        return None
    idx_names = tuple(intraday.index.names or ())
    try:
        if "symbol" in idx_names:
            sub = intraday.xs(sym, level="symbol")
        elif "symbol" in intraday.columns:
            sub = intraday[intraday["symbol"] == sym]
        else:
            return None
    except KeyError:
        return None
    if sub.empty or "open" not in sub.columns:
        return None
    sub = sub.sort_index()
    asof_ts = pd.Timestamp(asof, tz="UTC")
    # Find the first bar in today's window (after market open).
    if "ts" in sub.index.names:
        sub_today = sub[
            (sub.index.get_level_values("ts") >= asof_ts)
            & (sub.index.get_level_values("ts") < asof_ts + pd.Timedelta(days=1))
        ]
    else:
        sub_today = sub
    if sub_today.empty:
        return None
    val = sub_today["open"].dropna().iloc[0]
    return float(val) if np.isfinite(val) else None


def _prior_close(bars: pd.DataFrame, sym: str, asof: date) -> Optional[float]:
    """Most-recent daily close STRICTLY BEFORE ``asof`` for ``sym``."""
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
    asof_ts = pd.Timestamp(asof, tz="UTC")
    prior = sub[sub.index < asof_ts]
    if prior.empty:
        return None
    val = prior["close"].dropna().iloc[-1]
    return float(val) if np.isfinite(val) else None


def _has_imminent_earnings(
    earnings: Optional[pd.DataFrame], sym: str, asof: date, skip_days: int,
) -> bool:
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
        & (frame_dates >= asof - timedelta(days=1))  # also catch this morning's
        & (frame_dates <= horizon)
    )
    return bool(mask.any())


def _screen_gaps(
    bars: pd.DataFrame,
    intraday: pd.DataFrame,
    earnings: Optional[pd.DataFrame],
    held: set[str],
    params: GapFillParams,
    asof: date,
    diagnostics: dict[str, Any],
) -> list[dict[str, Any]]:
    """Find universe symbols with a tradeable non-catalyst overnight gap."""
    survivors: list[dict[str, Any]] = []
    for sym in GAP_FILL_UNIVERSE_SEED:
        diagnostics["n_universe"] += 1
        if sym in held:
            continue
        prev_close = _prior_close(bars, sym, asof)
        today_open = _today_open(intraday, sym, asof)
        if prev_close is None or today_open is None or prev_close <= 0:
            continue
        gap = (today_open - prev_close) / prev_close
        if abs(gap) < params.min_gap_pct:
            continue
        diagnostics["n_with_gap"] += 1
        if abs(gap) > params.max_gap_pct:
            continue  # likely catalyst-driven
        diagnostics["n_passed_size"] += 1

        # Direction filter
        if params.direction == "fade_down_only" and gap > 0:
            continue

        if _has_imminent_earnings(earnings, sym, asof, params.earnings_skip_days):
            continue
        diagnostics["n_passed_earnings"] += 1

        survivors.append({
            "symbol": sym,
            "gap_pct": float(gap),
            "prev_close": prev_close,
            "today_open": today_open,
        })

    # Rank by absolute gap size (larger fades first, capped by max_gap_pct).
    survivors.sort(key=lambda c: abs(c["gap_pct"]), reverse=True)
    return survivors
