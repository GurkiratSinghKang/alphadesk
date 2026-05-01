"""VWAP session-pullback — paper-first intraday strategy.

Intraday 5-min strategy. It remains ``paper_only`` until live-fill and
paper evidence are sufficient, but it now consumes StrategyInput 5-minute
bars and emits paper signals when trend, VWAP, and RSI gates align.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from strategies._core.contracts import (
    OrderType,
    Signal,
    StrategyInput,
    StrategyResult,
    TimeInForce,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import UNIVERSE, VWAPParams


log = logging.getLogger("alphadesk.strategies.vwap")

_NS = "vwap"
_REQUIRED_LOOKBACK_DAYS = 150
_ET = ZoneInfo("America/New_York")


@register_strategy(
    StrategyMeta(
        name="vwap",
        category="intraday",
        kind="autonomous",
        description=(
            "VWAP session-pullback on liquid single-names: enter on a "
            "pullback toward session VWAP when trend + RSI gates align. "
            "Paper-only until intraday paper evidence graduates it."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("5min",),
        min_universe_size=1,
        paper_only=True,
    )
)
class VWAPStrategy(Strategy):
    """VWAP pullback, paper-first."""

    PARAMS_MODEL = VWAPParams

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return list(UNIVERSE)

    def run(
        self,
        input: StrategyInput,
        params: VWAPParams,
    ) -> StrategyResult:
        intraday = input.intraday_bars.get("5min")
        if intraday is None or intraday.empty:
            return StrategyResult(
                signals=[],
                diagnostics={
                    "data_ready": False,
                    "reason": "missing 5min intraday bars",
                    "required_bar_interval": "5min",
                    "active_symbols": list(UNIVERSE),
                },
                warnings=["VWAP skipped: missing 5min intraday bars"],
            )

        frame = _flatten_intraday(intraday)
        last_signal_dates = dict(input.state.get(f"{_NS}.last_signal_dates", {}))
        next_signal_dates = dict(last_signal_dates)
        signals: list[Signal] = []
        diagnostics: dict[str, Any] = {
            "data_ready": True,
            "required_bar_interval": "5min",
            "active_symbols": list(UNIVERSE),
            "evaluated": {},
            "lifecycle_exits": {},
        }
        target_weight = float(min(params.max_allocation / params.max_positions, params.max_allocation))
        entry_count = 0

        for symbol in list(UNIVERSE):
            session = _session_bars(frame, symbol, input.asof)
            exit_signal = _lifecycle_exit_signal(
                symbol=symbol,
                input=input,
                params=params,
                session=session,
            )
            if exit_signal is not None:
                signals.append(exit_signal)
                diagnostics["lifecycle_exits"][symbol] = exit_signal.tag
                diagnostics["evaluated"][symbol] = {"exit": exit_signal.tag}
                continue

            if entry_count >= params.max_positions:
                break
            if last_signal_dates.get(symbol) == input.asof.isoformat():
                diagnostics["evaluated"][symbol] = {"skipped": "already_signalled_today"}
                continue
            if not _daily_trend_ok(input.bars, symbol, params.trend_sma_daily):
                diagnostics["evaluated"][symbol] = {"skipped": "daily_trend_filter"}
                continue

            if len(session) < max(params.rsi_period + 2, 4):
                diagnostics["evaluated"][symbol] = {
                    "skipped": "not_enough_completed_bars",
                    "bars": int(len(session)),
                }
                continue
            enriched = _with_vwap(session)
            latest = enriched.iloc[-1]
            close = float(latest["close"])
            vwap = float(latest["session_vwap"])
            rsi = _rsi(enriched["close"], params.rsi_period)
            dist_to_vwap = (close - vwap) / vwap if vwap > 0 else float("inf")
            diagnostics["evaluated"][symbol] = {
                "close": close,
                "vwap": vwap,
                "dist_to_vwap": dist_to_vwap,
                "rsi": rsi,
            }

            if not (0 <= dist_to_vwap <= params.pullback_pct_max):
                continue
            if rsi is None or rsi > params.rsi_entry_max:
                continue

            signals.append(
                Signal(
                    symbol=symbol,
                    asof=input.asof,
                    order_type=OrderType.MKT,
                    time_in_force=TimeInForce.DAY,
                    target_weight=target_weight,
                    stop_price=max(0.01, close * (1 - params.stop_bps_or_atr_max / 10_000.0)),
                    tag=(
                        f"vwap-entry:{symbol}:pullback "
                        f"close={close:.2f} vwap={vwap:.2f} rsi={rsi:.1f}"
                    ),
                )
            )
            next_signal_dates[symbol] = input.asof.isoformat()
            entry_count += 1

        return StrategyResult(
            signals=signals,
            state_update={f"{_NS}.last_signal_dates": next_signal_dates},
            diagnostics={
                **diagnostics,
                "signals": len(signals),
            },
            warnings=[],
        )


def _flatten_intraday(frame: pd.DataFrame) -> pd.DataFrame:
    df = frame.reset_index() if isinstance(frame.index, pd.MultiIndex) else frame.copy()
    if "symbol" not in df.columns:
        return pd.DataFrame(columns=["symbol", "ts", "open", "high", "low", "close", "volume"])
    if "ts" not in df.columns:
        source = "date" if "date" in df.columns else None
        df["ts"] = pd.to_datetime(df[source], utc=True, errors="coerce") if source else pd.NaT
    else:
        df["ts"] = pd.to_datetime(df["ts"], utc=True, errors="coerce")
    df["symbol"] = df["symbol"].astype(str).str.upper()
    return df.dropna(subset=["symbol", "ts"]).sort_values(["symbol", "ts"])


def _session_bars(frame: pd.DataFrame, symbol: str, asof: date) -> pd.DataFrame:
    df = frame.loc[frame["symbol"] == symbol.upper()].copy()
    if df.empty:
        return df
    ts = pd.to_datetime(df["ts"], utc=True, errors="coerce")
    et = ts.dt.tz_convert(_ET)
    rth = (
        (et.dt.date == asof)
        & ((et.dt.hour > 9) | ((et.dt.hour == 9) & (et.dt.minute >= 30)))
        & (et.dt.hour < 16)
    )
    return df.loc[rth].sort_values("ts").reset_index(drop=True)


def _with_vwap(session: pd.DataFrame) -> pd.DataFrame:
    df = session.copy()
    if "vwap" in df.columns and df["vwap"].notna().any():
        df["session_vwap"] = pd.to_numeric(df["vwap"], errors="coerce")
        df["session_vwap"] = df["session_vwap"].ffill()
        return df
    typical = (
        pd.to_numeric(df["high"], errors="coerce")
        + pd.to_numeric(df["low"], errors="coerce")
        + pd.to_numeric(df["close"], errors="coerce")
    ) / 3.0
    volume = pd.to_numeric(df.get("volume", 0), errors="coerce").fillna(0)
    numerator = (typical * volume).cumsum()
    denominator = volume.cumsum().replace(0, pd.NA)
    df["session_vwap"] = (numerator / denominator).ffill()
    return df


def _rsi(closes: pd.Series, period: int) -> float | None:
    series = pd.to_numeric(closes, errors="coerce").dropna()
    if len(series) <= period:
        return None
    delta = series.diff().dropna()
    recent = delta.tail(period)
    gains = recent.clip(lower=0).mean()
    losses = (-recent.clip(upper=0)).mean()
    if losses == 0:
        return 100.0
    rs = gains / losses
    return float(100.0 - (100.0 / (1.0 + rs)))


def _daily_trend_ok(bars: pd.DataFrame, symbol: str, period: int) -> bool:
    if bars is None or bars.empty:
        return False
    df = bars.reset_index() if isinstance(bars.index, pd.MultiIndex) else bars.copy()
    if "symbol" not in df.columns or "close" not in df.columns:
        return False
    df["symbol"] = df["symbol"].astype(str).str.upper()
    closes = pd.to_numeric(
        df.loc[df["symbol"] == symbol.upper(), "close"],
        errors="coerce",
    ).dropna()
    if len(closes) < period:
        return False
    return float(closes.iloc[-1]) >= float(closes.tail(period).mean())


def _lifecycle_exit_signal(
    *,
    symbol: str,
    input: StrategyInput,
    params: VWAPParams,
    session: pd.DataFrame,
) -> Signal | None:
    """Emit protective VWAP exits for existing paper positions."""
    if session.empty:
        return None
    position = next(
        (
            p for p in input.positions
            if p.symbol.upper() == symbol.upper()
            and p.quantity != 0
            and str(p.tag or "").startswith("vwap-entry:")
        ),
        None,
    )
    if position is None:
        return None

    enriched = _with_vwap(session)
    latest = enriched.iloc[-1]
    latest_ts = pd.Timestamp(latest["ts"])
    latest_et = (
        latest_ts.tz_convert(_ET)
        if latest_ts.tzinfo
        else latest_ts.tz_localize("UTC").tz_convert(_ET)
    )
    close = float(latest["close"])
    vwap = float(latest["session_vwap"])
    entry = float(position.avg_entry_price)
    is_long = position.quantity > 0
    stop_fraction = float(params.stop_bps_or_atr_max) / 10_000.0
    reason: str | None = None
    trigger: float | None = None

    if is_long and close <= entry * (1.0 - stop_fraction):
        reason, trigger = "stop", entry * (1.0 - stop_fraction)
    elif not is_long and close >= entry * (1.0 + stop_fraction):
        reason, trigger = "stop", entry * (1.0 + stop_fraction)

    session_end = (
        latest_et.hour > 15
        or (latest_et.hour == 15 and latest_et.minute >= 55)
    )
    if reason is None and session_end:
        reason, trigger = "session_end", close
    elif reason is None and vwap > 0:
        if is_long and close >= vwap:
            reason, trigger = "vwap_reclaim", vwap
        elif not is_long and close <= vwap:
            reason, trigger = "vwap_reclaim", vwap

    if reason is None:
        return None

    return Signal(
        symbol=symbol,
        asof=input.asof,
        order_type=OrderType.MKT,
        time_in_force=TimeInForce.DAY,
        quantity=-int(position.quantity),
        tag=(
            f"vwap-exit:{symbol}:{reason} "
            f"trigger={trigger:.2f} close={close:.2f}"
        ),
    )


__all__ = ["VWAPStrategy"]
