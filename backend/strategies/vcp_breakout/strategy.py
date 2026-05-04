"""VCP Breakout — SOTA shell.

Mark Minervini's Volatility Contraction Pattern: identify Stage-2 uptrend
stocks forming progressively tighter consolidation bases on declining
volume, then enter on breakout above the final pivot with volume
confirmation. Exits on chandelier-style risk-stop, profit-take, or time-stop.

References:
- Minervini, M. (2013). *Trade Like a Stock Market Wizard.* McGraw-Hill.
- Weinstein, S. (1988). *Secrets for Profiting in Bull and Bear Markets.*
- Karpoff (1987); Lo & Wang (2000) — volume + price information theory.

Status: ``paper_only=True`` until live intraday paper evidence graduates
the strategy. The v0 detector uses simplified contraction logic on weekly
bars; production should ideally use intraday breakout confirmation via
``realtime_scanner.py`` (the ``vcp_pivot`` setup type already enumerated
there). Adding the realtime extension is a follow-on plan.

Rule summary:
- Weekly screen identifies Stage-2 stocks forming a VCP base.
- Entry on breakout: latest close > final-base high AND volume >= 1.5×
  50-day average. MOC entry the same session.
- Exits run every bar:
  - Risk-stop: close <= entry_price × (1 − stop_pct_below_pivot)
  - Profit-take: close >= entry_price × (1 + profit_take_pct)
  - Time-stop: max_holding_days sessions elapsed
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

from .config import VCP_UNIVERSE_SEED, VCPBreakoutParams


log = logging.getLogger("alphadesk.strategies.vcp_breakout")

_NS = "vcp_breakout"
_REQUIRED_LOOKBACK_DAYS = 252  # need 12 months for 200-SMA + 52-week-low gates


@register_strategy(
    StrategyMeta(
        name="vcp_breakout",
        category="equity",
        kind="autonomous",
        description=(
            "Mark Minervini's Volatility Contraction Pattern: Stage-2 uptrend "
            "stocks forming progressively tighter consolidation bases on "
            "declining volume; entry on breakout above final pivot with "
            "volume ≥ 1.5× average. 8% risk-stop + 20% profit-take + "
            "60-session time-stop."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=20,
        paper_only=True,
    )
)
class VCPBreakoutStrategy(Strategy):
    """VCP breakout — see module docstring."""

    PARAMS_MODEL = VCPBreakoutParams

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return list(VCP_UNIVERSE_SEED)

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: VCPBreakoutParams,
    ) -> StrategyResult:
        asof = input.asof
        diagnostics: dict[str, Any] = {
            "rebalance": False,
            "n_universe": 0,
            "n_passed_stage2": 0,
            "n_passed_base": 0,
            "n_breakouts": 0,
            "n_entered": 0,
            "n_exits": 0,
            "exit_reasons": {},
            "candidates": [],
        }
        warnings: list[str] = []
        signals: list[Signal] = []

        bars = input.bars

        # --- Always-on per-bar exits ----------------------------------- #
        exit_signals, exit_state = _build_exits(
            input.positions, bars, input.state, asof, params,
        )
        signals.extend(exit_signals)
        diagnostics["n_exits"] = len(exit_signals)
        for s in exit_signals:
            tag = s.tag or ""
            reason = tag.rsplit("-", 1)[-1] if tag else "unknown"
            diagnostics["exit_reasons"][s.symbol] = reason

        if not _is_rebalance_day(asof, params.rebalance_freq):
            return StrategyResult(
                signals=signals,
                state_update=exit_state,
                diagnostics=diagnostics,
                warnings=warnings,
            )
        diagnostics["rebalance"] = True

        # --- Entry path ------------------------------------------------- #
        held = {p.symbol for p in input.positions if p.quantity != 0}
        free_slots = max(0, params.max_positions - len(held))
        if free_slots <= 0:
            return StrategyResult(
                signals=signals,
                state_update=exit_state,
                diagnostics=diagnostics,
                warnings=warnings,
            )

        candidates = _screen_breakouts(
            VCP_UNIVERSE_SEED, bars, held, params, asof, diagnostics,
        )
        diagnostics["candidates"] = [c["symbol"] for c in candidates]

        chosen = candidates[:free_slots]
        diagnostics["n_entered"] = len(chosen)

        new_entries = dict(exit_state.get(f"{_NS}.entry_dates", {}))
        new_entry_prices = dict(exit_state.get(f"{_NS}.entry_prices", {}))

        for cand in chosen:
            sym = cand["symbol"]
            new_entries[sym] = asof.isoformat()
            new_entry_prices[sym] = float(cand["last_close"])
            signals.append(
                Signal(
                    symbol=sym,
                    target_weight=params.target_weight_per_name,
                    order_type=OrderType.MOC,
                    time_in_force=TimeInForce.DAY,
                    tag=f"vcp-entry-{sym}",
                    asof=asof,
                )
            )

        return StrategyResult(
            signals=signals,
            state_update={
                **exit_state,
                f"{_NS}.entry_dates": new_entries,
                f"{_NS}.entry_prices": new_entry_prices,
            },
            diagnostics=diagnostics,
            warnings=warnings,
        )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _is_rebalance_day(asof: date, freq: str) -> bool:
    """Friday for weekly, alternating for biweekly."""
    try:
        from data.calendar import is_trading_day
    except Exception:
        is_trading_day = lambda d: getattr(d, "weekday", lambda: 5)() < 5  # noqa: E731
    if not is_trading_day(asof):
        return False
    if asof.weekday() != 4:
        return False  # Mon=0, Fri=4
    if freq == "biweekly":
        return (asof.isocalendar().week % 2) == 0
    return True


def _stage2_check(closes: pd.Series, params: VCPBreakoutParams) -> bool:
    """True iff price is in Stage-2 uptrend per Weinstein/Minervini."""
    if len(closes) < 252:
        return False

    # 200-day SMA must be rising over the last N sessions.
    sma200 = closes.rolling(window=200, min_periods=200).mean()
    if sma200.dropna().empty:
        return False
    rising_window = params.stage2_min_sma200_rising_days
    if len(sma200.dropna()) < rising_window + 1:
        return False
    sma_now = float(sma200.iloc[-1])
    sma_then = float(sma200.iloc[-1 - rising_window])
    if not np.isfinite(sma_now) or not np.isfinite(sma_then) or sma_now <= sma_then:
        return False

    # Price ≥ stage2_min_above_52w_low above 52-week low.
    last = float(closes.iloc[-1])
    low_52w = float(closes.tail(252).min())
    if not np.isfinite(last) or not np.isfinite(low_52w) or low_52w <= 0:
        return False
    if (last - low_52w) / low_52w < params.stage2_min_above_52w_low:
        return False

    # Price must be above 200-day SMA (a Stage-2 prerequisite).
    if last <= sma_now:
        return False

    return True


def _vcp_base_check(
    closes: pd.Series,
    params: VCPBreakoutParams,
) -> tuple[bool, Optional[float]]:
    """True iff a VCP base is present + return the breakout pivot.

    Simplified v0: require the current ``min_base_days`` to have a tighter
    peak-to-trough range than the same window ``min_base_days`` ago — a
    rough proxy for "progressive contraction". The breakout pivot is the
    high of the most recent base.
    """
    n = params.min_base_days
    if len(closes) < n * 2 + 5:
        return False, None

    base_recent = closes.iloc[-n:]
    base_prior = closes.iloc[-2 * n:-n]
    range_recent = float(base_recent.max() - base_recent.min())
    range_prior = float(base_prior.max() - base_prior.min())
    last = float(base_recent.iloc[-1])

    if range_prior <= 0 or last <= 0:
        return False, None
    # Each successive contraction must be tighter than the prior; v0 just
    # checks the recent vs prior. min_contractions=2 → already two halves.
    if range_recent >= range_prior:
        return False, None
    # Final-base tightness gate: range_recent / last <= final_base_max_range_pct
    if range_recent / last > params.final_base_max_range_pct:
        return False, None

    pivot = float(base_recent.max())
    return True, pivot


def _adv_dollars(bars_sub: pd.DataFrame, days: int) -> Optional[float]:
    """N-day median dollar volume from a per-symbol bar slice."""
    if "close" not in bars_sub.columns or "volume" not in bars_sub.columns:
        return None
    tail = bars_sub.tail(days)
    if len(tail) < min(20, days):
        return None
    dv = (tail["close"] * tail["volume"]).dropna()
    if dv.empty:
        return None
    return float(dv.median())


def _screen_breakouts(
    universe: tuple[str, ...] | list[str],
    bars: pd.DataFrame,
    held: set[str],
    params: VCPBreakoutParams,
    asof: date,
    diagnostics: dict[str, Any],
) -> list[dict[str, Any]]:
    """Return list of breakout candidates ranked by volume-confirmation strength."""
    survivors: list[dict[str, Any]] = []

    if bars is None or getattr(bars, "empty", True):
        return []

    idx_names = tuple(bars.index.names or ())
    if "symbol" not in idx_names or "date" not in idx_names:
        return []

    for sym in universe:
        diagnostics["n_universe"] += 1
        if sym in held:
            continue
        try:
            sub = bars.xs(sym, level="symbol")
        except KeyError:
            continue
        if sub.empty or "close" not in sub.columns:
            continue
        sub = sub.sort_index()

        # Liquidity floor
        adv_dollars = _adv_dollars(sub, days=90)
        if adv_dollars is None or adv_dollars / 1_000_000.0 < params.min_adv_millions:
            continue

        closes = sub["close"].dropna()
        if len(closes) < 252:
            continue

        # Stage-2 gate
        if not _stage2_check(closes, params):
            continue
        diagnostics["n_passed_stage2"] += 1

        # VCP base pattern + pivot
        passes_base, pivot = _vcp_base_check(closes, params)
        if not passes_base or pivot is None:
            continue
        diagnostics["n_passed_base"] += 1

        last_close = float(closes.iloc[-1])
        if last_close <= pivot:
            continue  # not yet broken out

        # Volume confirmation
        if "volume" not in sub.columns:
            continue
        volumes = sub["volume"].dropna()
        if len(volumes) < 51:
            continue
        avg_vol_50d = float(volumes.iloc[-51:-1].mean())  # exclude today
        today_vol = float(volumes.iloc[-1])
        if avg_vol_50d <= 0:
            continue
        vol_multiple = today_vol / avg_vol_50d
        if vol_multiple < params.breakout_volume_multiple:
            continue
        diagnostics["n_breakouts"] += 1

        survivors.append({
            "symbol": sym,
            "pivot": pivot,
            "last_close": last_close,
            "volume_multiple": float(vol_multiple),
            "breakout_strength": float((last_close - pivot) / pivot),
        })

    # Rank by breakout strength × volume multiple
    survivors.sort(
        key=lambda c: c["breakout_strength"] * c["volume_multiple"],
        reverse=True,
    )
    return survivors


def _build_exits(
    positions: list[Any],
    bars: pd.DataFrame,
    state: dict[str, Any],
    asof: date,
    params: VCPBreakoutParams,
) -> tuple[list[Signal], dict[str, Any]]:
    """Per-bar exits: stop-loss, profit-take, or time-stop."""
    raw_dates = state.get(f"{_NS}.entry_dates", {})
    raw_prices = state.get(f"{_NS}.entry_prices", {})
    entry_dates: dict[str, date] = {}
    entry_prices: dict[str, float] = {}
    if isinstance(raw_dates, dict):
        for sym, ds in raw_dates.items():
            try:
                entry_dates[str(sym).upper()] = (
                    ds if isinstance(ds, date) and not isinstance(ds, bool)
                    else date.fromisoformat(str(ds))
                )
            except Exception:
                continue
    if isinstance(raw_prices, dict):
        for sym, p in raw_prices.items():
            try:
                entry_prices[str(sym).upper()] = float(p)
            except (TypeError, ValueError):
                continue

    new_dates = dict(entry_dates)
    new_prices = dict(entry_prices)
    out: list[Signal] = []
    max_calendar_days = int(round(params.max_holding_days * 7 / 5))

    for pos in positions:
        if pos.quantity == 0:
            continue
        sym = pos.symbol.upper()
        entry_d = entry_dates.get(sym)
        entry_p = entry_prices.get(sym)

        # If state is missing (state corruption / first migration), skip the
        # check — we don't want to force-exit a known position with no anchor.
        if entry_d is None or entry_p is None or entry_p <= 0:
            continue

        # Pull last close
        last_close: Optional[float] = None
        if bars is not None and not getattr(bars, "empty", True):
            idx_names = tuple(bars.index.names or ())
            if "symbol" in idx_names and "date" in idx_names:
                try:
                    sub = bars.xs(pos.symbol, level="symbol")
                    closes = sub["close"].dropna()
                    if not closes.empty:
                        last_close = float(closes.iloc[-1])
                except (KeyError, AttributeError):
                    pass

        reason: Optional[str] = None
        if last_close is not None:
            if last_close <= entry_p * (1.0 - params.stop_pct_below_pivot):
                reason = "stop"
            elif last_close >= entry_p * (1.0 + params.profit_take_pct):
                reason = "profittake"

        if reason is None and (asof - entry_d).days >= max_calendar_days:
            reason = "timestop"

        if reason is None:
            continue

        out.append(
            Signal(
                symbol=pos.symbol,
                target_weight=0.0,
                order_type=OrderType.MOC,
                time_in_force=TimeInForce.DAY,
                tag=f"vcp-exit-{reason}",
                asof=asof,
            )
        )
        new_dates.pop(sym, None)
        new_prices.pop(sym, None)

    return out, {
        f"{_NS}.entry_dates": new_dates,
        f"{_NS}.entry_prices": new_prices,
    }
