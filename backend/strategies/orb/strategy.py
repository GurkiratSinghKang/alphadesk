"""Opening Range Breakout (ORB) — paper-first intraday strategy.

1-minute intraday strategy. It remains ``paper_only`` until the intraday
runner has enough paper evidence, but it now consumes StrategyInput
1-minute bars and can emit paper signals.

Canonical references: Crabel (1990), Fisher (2002), Zarattini-Aziz (2023).
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

from .config import ORBParams, UNIVERSE_PROFILES


log = logging.getLogger("alphadesk.strategies.orb")

_NS = "orb"
_REQUIRED_LOOKBACK_DAYS = 30
_ET = ZoneInfo("America/New_York")


@register_strategy(
    StrategyMeta(
        name="orb",
        category="intraday",
        kind="autonomous",
        description=(
            "Opening Range Breakout (Zarattini-Aziz 2023) on SPY/QQQ. "
            "1-min OR window then intraday breakout; paper-only until "
            "intraday paper evidence graduates it."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("1min",),
        min_universe_size=1,
        paper_only=True,
    )
)
class ORBStrategy(Strategy):
    """Opening Range Breakout, paper-first."""

    PARAMS_MODEL = ORBParams

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        symbols: set[str] = set()
        for profile_symbols in UNIVERSE_PROFILES.values():
            symbols.update(profile_symbols)
        return sorted(symbols)

    def run(
        self,
        input: StrategyInput,
        params: ORBParams,
    ) -> StrategyResult:
        profile_symbols = list(UNIVERSE_PROFILES[params.universe_profile])
        intraday = input.intraday_bars.get("1min")
        if intraday is None or intraday.empty:
            return StrategyResult(
                signals=[],
                state_update={f"{_NS}.profile": params.universe_profile},
                diagnostics={
                    "data_ready": False,
                    "reason": "missing 1min intraday bars",
                    "active_profile": params.universe_profile,
                    "active_symbols": profile_symbols,
                },
                warnings=["ORB skipped: missing 1min intraday bars"],
            )

        frame = _flatten_intraday(intraday)
        last_signal_dates = dict(input.state.get(f"{_NS}.last_signal_dates", {}))
        next_signal_dates = dict(last_signal_dates)
        signals: list[Signal] = []
        diagnostics: dict[str, Any] = {
            "data_ready": True,
            "active_profile": params.universe_profile,
            "active_symbols": profile_symbols,
            "evaluated": {},
        }

        for symbol in profile_symbols:
            if last_signal_dates.get(symbol) == input.asof.isoformat():
                diagnostics["evaluated"][symbol] = {"skipped": "already_signalled_today"}
                continue
            session = _session_bars(frame, symbol, input.asof)
            if len(session) <= params.or_minutes:
                diagnostics["evaluated"][symbol] = {
                    "skipped": "not_enough_completed_bars",
                    "bars": int(len(session)),
                }
                continue

            latest_ts = pd.Timestamp(session.iloc[-1]["ts"])
            latest_et = latest_ts.tz_convert(_ET) if latest_ts.tzinfo else latest_ts.tz_localize("UTC").tz_convert(_ET)
            if latest_et.hour >= params.entry_cutoff_hour_et:
                diagnostics["evaluated"][symbol] = {"skipped": "past_entry_cutoff"}
                continue

            opening_range = session.iloc[: params.or_minutes]
            after_or = session.iloc[params.or_minutes :]
            latest = after_or.iloc[-1]
            or_high = float(opening_range["high"].max())
            or_low = float(opening_range["low"].min())
            or_mid = (or_high + or_low) / 2.0
            latest_close = float(latest["close"])
            avg_or_volume = float(opening_range["volume"].mean() or 0)
            latest_volume = float(latest.get("volume", 0) or 0)
            volume_ok = (
                avg_or_volume <= 0
                or latest_volume >= avg_or_volume * float(params.volume_confirm_min)
            )
            diagnostics["evaluated"][symbol] = {
                "or_high": or_high,
                "or_low": or_low,
                "latest_close": latest_close,
                "volume_ok": volume_ok,
            }
            if not volume_ok:
                continue

            target_weight = float(min(params.risk_per_trade, params.max_notional_pct))
            if latest_close > or_high:
                stop_price = or_low if params.stop_method == "or_bound" else or_mid
                signals.append(
                    Signal(
                        symbol=symbol,
                        asof=input.asof,
                        order_type=OrderType.MKT,
                        time_in_force=TimeInForce.DAY,
                        target_weight=target_weight,
                        stop_price=max(0.01, float(stop_price)),
                        tag=(
                            f"orb-entry:{symbol}:breakout "
                            f"or={or_low:.2f}-{or_high:.2f} close={latest_close:.2f}"
                        ),
                    )
                )
                next_signal_dates[symbol] = input.asof.isoformat()
            elif params.allow_shorts and latest_close < or_low:
                stop_price = or_high if params.stop_method == "or_bound" else or_mid
                signals.append(
                    Signal(
                        symbol=symbol,
                        asof=input.asof,
                        order_type=OrderType.MKT,
                        time_in_force=TimeInForce.DAY,
                        target_weight=-target_weight,
                        stop_price=max(0.01, float(stop_price)),
                        tag=(
                            f"orb-entry:{symbol}:breakdown "
                            f"or={or_low:.2f}-{or_high:.2f} close={latest_close:.2f}"
                        ),
                    )
                )
                next_signal_dates[symbol] = input.asof.isoformat()

        return StrategyResult(
            signals=signals,
            state_update={
                f"{_NS}.profile": params.universe_profile,
                f"{_NS}.last_signal_dates": next_signal_dates,
            },
            diagnostics=diagnostics,
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
        & ((et.dt.hour < 16))
    )
    return df.loc[rth].sort_values("ts").reset_index(drop=True)


__all__ = ["ORBStrategy"]
