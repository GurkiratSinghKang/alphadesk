"""Earnings Volatility — SOTA shell (research stub pending options-chain).

Short-iron-butterfly entered before earnings, exited at post-event IV crush.
See ``spec.md`` for the academic spec.

Current integration status:
  ``StrategyInput.options_chains`` is available, so the shell now verifies
  candidate chain quality and identifies tradable expiries/ATM IV. It still
  emits diagnostics only until the multi-leg options execution bridge is
  proven in paper.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Optional

import numpy as np
import pandas as pd

from strategies._core.contracts import (
    Signal,
    StrategyInput,
    StrategyResult,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import EarningsVolParams, UNIVERSE


log = logging.getLogger("alphadesk.strategies.earnings_vol")

_NS = "earnings_vol"
_REQUIRED_LOOKBACK_DAYS = 900  # ~3 years for historical-moves lookback


@register_strategy(
    StrategyMeta(
        name="earnings_vol",
        category="options",
        kind="research",  # options chain not yet in StrategyInput
        description=(
            "Short iron butterfly before earnings; exit at post-event IV "
            "crush. Research shell emits diagnostics (candidate symbols, "
            "historical-move proxy); full options-chain integration "
            "deferred."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=10,
    )
)
class EarningsVolStrategy(Strategy):
    """Earnings short-iron-butterfly (research shell)."""

    PARAMS_MODEL = EarningsVolParams

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return list(UNIVERSE)

    def run(
        self,
        input: StrategyInput,
        params: EarningsVolParams,
    ) -> StrategyResult:
        diagnostics: dict[str, Any] = {}
        warnings: list[str] = []

        upcoming = _upcoming_earnings(
            input.earnings,
            input.asof,
            params.dte_target,
            timing_filter=params.earnings_timing_filter,
        )
        diagnostics["upcoming_events"] = len(upcoming)
        diagnostics["options_chains_loaded"] = len(input.options_chains)

        latest_prices = _latest_close_by_symbol(input.bars, input.asof)
        filtered_low_price = 0
        missing_price = 0
        missing_chain = 0
        candidates: list[dict[str, Any]] = []
        for sym, event_date in upcoming:
            latest_price = latest_prices.get(sym)
            if latest_price is None:
                missing_price += 1
                continue
            if latest_price < params.min_underlying_price:
                filtered_low_price += 1
                continue
            hist_median = _historical_move_median(
                input.earnings, sym, params.historical_moves_lookback_quarters,
            )
            chain = _chain_for_symbol(input.options_chains, sym)
            chain_summary = _options_chain_summary(chain, latest_price, event_date)
            if not chain_summary["available"]:
                missing_chain += 1
            candidates.append({
                "symbol": sym,
                "event_date": event_date.isoformat() if event_date else None,
                "latest_price": latest_price,
                "hist_move_median": hist_median,
                "options_chain": chain_summary,
            })
        diagnostics["candidates"] = candidates
        diagnostics["filtered_below_min_price"] = filtered_low_price
        diagnostics["missing_price"] = missing_price
        diagnostics["missing_chain"] = missing_chain
        diagnostics["execution_bridge_ready"] = False
        if candidates and missing_chain:
            warnings.append(
                "Earnings vol candidates exist but at least one options chain is missing; "
                "no option signals are emitted."
            )

        return StrategyResult(
            signals=[],
            diagnostics=diagnostics,
            warnings=warnings,
        )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _upcoming_earnings(
    earnings: Optional[pd.DataFrame],
    asof: date,
    dte_target: int,
    *,
    timing_filter: str = "any",
) -> list[tuple[str, Optional[date]]]:
    """Return (symbol, event_date) pairs with upcoming earnings."""
    if earnings is None or getattr(earnings, "empty", True):
        return []
    if "symbol" not in earnings.columns:
        return []
    date_col = next(
        (c for c in ("date", "report_date", "ts") if c in earnings.columns),
        None,
    )
    if date_col is None:
        return []
    frame_dates = pd.to_datetime(earnings[date_col], errors="coerce").dt.date
    window_end = asof + timedelta(days=dte_target * 2)
    mask = (frame_dates >= asof) & (frame_dates <= window_end)
    if timing_filter == "after_close_only":
        timing_col = next(
            (c for c in ("report_time", "time", "timing") if c in earnings.columns),
            None,
        )
        if timing_col is None:
            return []
        timing = earnings[timing_col].astype(str).str.upper().str.strip()
        mask &= timing.isin({"AMC", "AFTER_CLOSE", "AFTER CLOSE", "AFTER_MARKET"})
    sub = earnings[mask]
    if sub.empty:
        return []
    sub = sub.assign(_event_date=frame_dates[mask])
    sub = sub.sort_values(["_event_date", "symbol"])
    out: list[tuple[str, Optional[date]]] = []
    seen: set[str] = set()
    for _, row in sub.iterrows():
        sym = str(row["symbol"]).upper()
        if sym not in UNIVERSE or sym in seen:
            continue
        seen.add(sym)
        raw_date = row[date_col]
        try:
            ev_date = pd.Timestamp(raw_date).date()
        except (TypeError, ValueError):
            ev_date = None
        out.append((sym, ev_date))
    return out


def _latest_close_by_symbol(
    bars: Optional[pd.DataFrame],
    asof: date,
) -> dict[str, float]:
    """Latest close at or before ``asof`` keyed by symbol."""
    if bars is None or getattr(bars, "empty", True):
        return {}
    if "close" not in bars.columns:
        return {}

    idx_names = tuple(bars.index.names or ())
    if "symbol" in idx_names and "date" in idx_names:
        frame = bars.reset_index()
    else:
        frame = bars.copy()
    if "symbol" not in frame.columns:
        return {}
    date_col = next((c for c in ("date", "ts", "timestamp", "ts_date") if c in frame.columns), None)
    if date_col is None:
        return {}

    frame = frame.assign(
        _symbol=frame["symbol"].astype(str).str.upper(),
        _bar_date=pd.to_datetime(frame[date_col], errors="coerce").dt.date,
        _close=pd.to_numeric(frame["close"], errors="coerce"),
    )
    frame = frame[(frame["_bar_date"] <= asof) & (frame["_close"] > 0)]
    if frame.empty:
        return {}
    frame = frame.sort_values(["_symbol", "_bar_date"])
    latest = frame.groupby("_symbol", sort=False).tail(1)
    return {
        str(row["_symbol"]): float(row["_close"])
        for _, row in latest.iterrows()
    }


def _historical_move_median(
    earnings: Optional[pd.DataFrame],
    symbol: str,
    lookback_quarters: int,
) -> Optional[float]:
    """Median post-earnings absolute move from historical rows."""
    if earnings is None or getattr(earnings, "empty", True):
        return None
    move_col = next(
        (c for c in ("abs_move", "move_pct", "surprise") if c in earnings.columns),
        None,
    )
    if move_col is None:
        return None
    sub = earnings[earnings["symbol"].astype(str).str.upper() == symbol.upper()]
    sub = sub.dropna(subset=[move_col])
    if sub.empty:
        return None
    date_col = next(
        (c for c in ("date", "report_date", "ts") if c in sub.columns),
        None,
    )
    if date_col is not None:
        sub = sub.assign(_event_date=pd.to_datetime(sub[date_col], errors="coerce"))
        sub = sub.sort_values(["_event_date"])
    tail = sub.tail(lookback_quarters)
    return float(tail[move_col].abs().median())


def _chain_for_symbol(
    chains: dict[str, pd.DataFrame],
    symbol: str,
) -> pd.DataFrame | None:
    chain = chains.get(symbol.upper())
    if chain is None:
        chain = chains.get(symbol)
    if chain is None or getattr(chain, "empty", True):
        return None
    return chain


def _options_chain_summary(
    chain: pd.DataFrame | None,
    spot: float,
    event_date: date | None,
) -> dict[str, Any]:
    if chain is None or getattr(chain, "empty", True):
        return {"available": False}
    frame = chain.copy()
    for col in ("expiry", "strike", "bid", "ask", "iv"):
        if col not in frame.columns:
            return {"available": False, "reason": f"missing_{col}"}
    frame["_expiry"] = pd.to_datetime(frame["expiry"], errors="coerce").dt.date
    frame["_strike"] = pd.to_numeric(frame["strike"], errors="coerce")
    frame["_bid"] = pd.to_numeric(frame["bid"], errors="coerce")
    frame["_ask"] = pd.to_numeric(frame["ask"], errors="coerce")
    frame["_iv"] = pd.to_numeric(frame["iv"], errors="coerce")
    frame = frame.dropna(subset=["_expiry", "_strike"])
    if frame.empty:
        return {"available": False, "reason": "no_valid_contracts"}
    target = event_date or min(frame["_expiry"])
    expiries = sorted({d for d in frame["_expiry"] if d >= target})
    target_expiry = expiries[0] if expiries else None
    expiry_frame = frame[frame["_expiry"] == target_expiry] if target_expiry else frame
    atm = expiry_frame.iloc[(expiry_frame["_strike"] - float(spot)).abs().argsort()[:4]]
    spreads = (expiry_frame["_ask"] - expiry_frame["_bid"]).clip(lower=0)
    mids = ((expiry_frame["_ask"] + expiry_frame["_bid"]) / 2.0).replace(0, pd.NA)
    spread_pct = (spreads / mids).replace([np.inf, -np.inf], pd.NA).dropna()
    is_demo = bool(frame.get("is_demo", pd.Series([False])).fillna(False).astype(bool).any())
    return {
        "available": True,
        "contracts": int(len(frame)),
        "is_demo": is_demo,
        "target_expiry": target_expiry.isoformat() if target_expiry else None,
        "target_expiry_contracts": int(len(expiry_frame)),
        "atm_iv": float(atm["_iv"].dropna().mean()) if atm["_iv"].notna().any() else None,
        "median_spread_pct": float(spread_pct.median()) if not spread_pct.empty else None,
    }


__all__ = ["EarningsVolStrategy"]
