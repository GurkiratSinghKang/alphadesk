"""Opening Range Breakout Strategy (Crabel 1990 / Fisher ACD Method).

Defines the opening range as the first 30 minutes of trading (9:30-10:00 ET),
then enters on a breakout above the high or below the low. Uses the opening
range width as the risk unit for position sizing and targets.

Enhanced filters:
- Pre-market gap detection (gap > 2% = higher reversal risk)
- Relative volume check (first 30 min volume > 1.5x typical)
- FOMC / NFP / OpEx day avoidance
- NR7 (Narrow Range 7-day) filter for optimal setups
- Fibonacci extension targets (1.272x and 1.618x OR width)
- Time-of-day filter (no signals after 11:30 AM ET)

Academic source: Toby Crabel "Day Trading with Short Term Price Patterns
and Opening Range Breakout" (1990). Also Mark Fisher "The Logical Trader"
(ACD Method). Supported by Cai, Cen & Li (2006) on intraday momentum.
"""
from __future__ import annotations

from datetime import date, datetime, timezone, timedelta
from typing import Any

from strategies.base import BaseStrategy


# --- Calendar helpers for macro event avoidance ---

def _get_fomc_dates(year: int) -> set[date]:
    """Known FOMC announcement dates. Updated annually.

    Returns the *second day* of each two-day meeting (announcement day).
    For single-day meetings the meeting day itself is returned.
    """
    # 2024-2026 scheduled meetings (announcement days)
    _fomc: dict[int, list[tuple[int, int]]] = {
        2024: [
            (1, 31), (3, 20), (5, 1), (6, 12), (7, 31),
            (9, 18), (11, 7), (12, 18),
        ],
        2025: [
            (1, 29), (3, 19), (5, 7), (6, 18), (7, 30),
            (9, 17), (10, 29), (12, 17),
        ],
        2026: [
            (1, 28), (3, 18), (4, 29), (6, 17), (7, 29),
            (9, 16), (10, 28), (12, 16),
        ],
    }
    return {date(year, m, d) for m, d in _fomc.get(year, [])}


def _get_nfp_dates(year: int) -> set[date]:
    """Non-Farm Payroll dates: first Friday of each month."""
    dates: set[date] = set()
    for month in range(1, 13):
        first_day = date(year, month, 1)
        # weekday(): Monday=0 ... Friday=4
        days_until_friday = (4 - first_day.weekday()) % 7
        first_friday = first_day + timedelta(days=days_until_friday)
        dates.add(first_friday)
    return dates


def _get_opex_dates(year: int) -> set[date]:
    """Monthly options expiration: third Friday of each month."""
    dates: set[date] = set()
    for month in range(1, 13):
        first_day = date(year, month, 1)
        days_until_friday = (4 - first_day.weekday()) % 7
        first_friday = first_day + timedelta(days=days_until_friday)
        third_friday = first_friday + timedelta(weeks=2)
        dates.add(third_friday)
    return dates


def _is_macro_event_day(d: date | None = None) -> tuple[bool, str]:
    """Return (True, reason) if *d* is an FOMC, NFP, or OpEx day."""
    if d is None:
        d = date.today()
    year = d.year
    if d in _get_fomc_dates(year):
        return True, "FOMC announcement day"
    if d in _get_nfp_dates(year):
        return True, "Non-Farm Payrolls day"
    if d in _get_opex_dates(year):
        return True, "Monthly options expiration day"
    return False, ""


def _is_nr7(daily_highs: list[float], daily_lows: list[float]) -> bool:
    """Narrow Range 7: today's range is the narrowest of the last 7 days.

    NR7 days signal compression; ORB breakouts that follow NR7 are
    statistically more reliable (Crabel 1990).
    """
    if len(daily_highs) < 7 or len(daily_lows) < 7:
        return False
    ranges = [daily_highs[-(7 - i)] - daily_lows[-(7 - i)] for i in range(7)]
    today_range = ranges[-1]
    return today_range == min(ranges) and today_range > 0


class ORBStrategy(BaseStrategy):
    """Opening Range Breakout: trade the first directional move of the day."""

    name = "orb"
    description = (
        "Opening Range Breakout: enters when price breaks above/below the "
        "first 30 minutes' high/low. Uses Fibonacci extension targets "
        "(1.272x / 1.618x OR width) with gap, volume, NR7, calendar, "
        "and time-of-day filters."
    )
    default_timeframe = "day"

    # Parameters
    OR_MINUTES = 30             # opening range window (minutes)
    BREAKOUT_BUFFER_PCT = 0.001 # 0.1% buffer above OR high
    TARGET_MULT_1 = 1.272       # first target = 1.272x OR width (Fib)
    TARGET_MULT_2 = 1.618       # runner target = 1.618x OR width (Fib)
    STOP_MULT = 0.5             # stop = 0.5x OR width beyond entry
    MIN_OR_WIDTH_PCT = 0.3      # skip if OR < 0.3% (too narrow)
    MAX_OR_WIDTH_PCT = 3.0      # skip if OR > 3% (too volatile)
    MAX_HOLD_MINUTES = 300      # exit by 2:30 PM (5 hours after open)
    RISK_PER_TRADE = 0.01       # 1% of portfolio
    GAP_REVERSAL_PCT = 2.0      # gap > 2% triggers reversal warning
    RVOL_THRESHOLD = 1.5        # relative volume floor for first 30 min
    SIGNAL_CUTOFF_HOUR = 11     # no new signals after 11:30 AM ET
    SIGNAL_CUTOFF_MIN = 30

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Screen for liquid large-caps suitable for ORB."""
        candidates = []
        for t in universe:
            if (t.get("avg_volume", 0) or 0) < 2_000_000:
                continue
            if (t.get("market_cap", 0) or 0) < 5_000_000_000:
                continue
            candidates.append(t)
        candidates.sort(key=lambda x: x.get("avg_volume", 0) or 0, reverse=True)
        return candidates[:30]

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Compute opening range and check for breakout.

        Enhanced with gap detection, relative volume, NR7, macro-day
        avoidance, Fibonacci targets, and time-of-day filter.
        """
        price = data.get("price", 0) or data.get("current_price", 0)
        or_high = data.get("or_high", 0)
        or_low = data.get("or_low", 0)
        or_vwap = data.get("or_vwap", 0)

        if or_high == 0 or or_low == 0:
            return {"symbol": symbol, "score": 0, "conviction": "low",
                    "signal": "no_data"}

        or_width = or_high - or_low
        or_width_pct = (or_width / or_low) * 100

        # Filter: opening range must be within reasonable bounds
        if or_width_pct < self.MIN_OR_WIDTH_PCT or or_width_pct > self.MAX_OR_WIDTH_PCT:
            return {"symbol": symbol, "score": 0, "conviction": "low",
                    "signal": "filtered", "or_width_pct": or_width_pct}

        # ---- NEW FILTER 1: FOMC / NFP / OpEx day avoidance ----
        is_macro, macro_reason = _is_macro_event_day()
        if is_macro:
            return {"symbol": symbol, "score": 0, "conviction": "low",
                    "signal": "filtered_macro", "reason": macro_reason}

        # ---- NEW FILTER 2: Time-of-day cutoff (no signals after 11:30 ET) ----
        from zoneinfo import ZoneInfo
        now_et = datetime.now(ZoneInfo("America/New_York"))
        if (now_et.hour > self.SIGNAL_CUTOFF_HOUR
                or (now_et.hour == self.SIGNAL_CUTOFF_HOUR
                    and now_et.minute >= self.SIGNAL_CUTOFF_MIN)):
            return {"symbol": symbol, "score": 0, "conviction": "low",
                    "signal": "filtered_time",
                    "reason": f"ORB signal after {self.SIGNAL_CUTOFF_HOUR}:{self.SIGNAL_CUTOFF_MIN:02d} ET"}

        # ---- NEW FILTER 3: Pre-market gap detection ----
        prev_close = data.get("prev_close", 0)
        gap_pct = 0.0
        gap_warning = False
        if prev_close > 0:
            gap_pct = ((or_low - prev_close) / prev_close) * 100
            # Large gap-up > 2% signals potential gap reversal
            if gap_pct > self.GAP_REVERSAL_PCT:
                gap_warning = True

        # ---- NEW FILTER 4: Relative volume check (first 30 min) ----
        or_volume = data.get("or_volume", 0)
        avg_or_volume = data.get("avg_or_volume", 0)
        rvol = (or_volume / avg_or_volume) if avg_or_volume > 0 else 1.0
        rvol_pass = rvol >= self.RVOL_THRESHOLD

        if not rvol_pass:
            return {"symbol": symbol, "score": 0, "conviction": "low",
                    "signal": "filtered_volume",
                    "rvol": round(rvol, 2),
                    "reason": f"Relative volume {rvol:.2f}x below {self.RVOL_THRESHOLD}x threshold"}

        # ---- NEW FILTER 5: NR7 (Narrow Range 7-day) bonus ----
        daily_highs = data.get("daily_highs", [])
        daily_lows = data.get("daily_lows", [])
        nr7 = _is_nr7(daily_highs, daily_lows)

        # ---- Breakout detection ----
        buffer = price * self.BREAKOUT_BUFFER_PCT
        breakout_long = price > (or_high + buffer)
        breakout_short = price < (or_low - buffer)

        # VWAP confirmation: breakout should be in direction of VWAP slope
        vwap_confirm = True
        if or_vwap > 0:
            if breakout_long and price < or_vwap:
                vwap_confirm = False
            if breakout_short and price > or_vwap:
                vwap_confirm = False

        score = 0
        direction = "none"
        if breakout_long:
            breakout_dist = (price - or_high) / or_width * 100
            score = min(85, 45 + breakout_dist * 2)
            if vwap_confirm:
                score += 10
            direction = "bullish"
        elif breakout_short:
            breakout_dist = (or_low - price) / or_width * 100
            score = min(85, 45 + breakout_dist * 2)
            if vwap_confirm:
                score += 10
            direction = "bearish"

        # Apply gap reversal penalty
        if gap_warning:
            score -= 15

        # NR7 bonus: breakouts after narrow-range days are stronger
        if nr7:
            score += 10

        score = max(0, min(100, score))
        conviction = "high" if score > 60 else "medium" if score > 40 else "low"

        return {
            "symbol": symbol,
            "score": round(score, 1),
            "conviction": conviction,
            "price": price,
            "or_high": or_high,
            "or_low": or_low,
            "or_width": round(or_width, 2),
            "or_width_pct": round(or_width_pct, 2),
            "or_vwap": or_vwap,
            "breakout_long": breakout_long,
            "breakout_short": breakout_short,
            "vwap_confirm": vwap_confirm,
            "direction": direction,
            # New fields
            "gap_pct": round(gap_pct, 2),
            "gap_warning": gap_warning,
            "rvol": round(rvol, 2),
            "nr7": nr7,
        }

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        if analysis.get("signal") in ("no_data", "filtered", "filtered_macro",
                                      "filtered_time", "filtered_volume"):
            return None
        if analysis.get("direction") == "none":
            return None
        if analysis.get("score", 0) < 40:
            return None

        return {
            "symbol": analysis["symbol"],
            "direction": analysis["direction"],
            "strength": analysis["score"],
            "conviction": analysis["conviction"],
            "timeframe": "day",
            "holding_period_days": 1,
            "analysis": analysis,
        }

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        symbol = signal["symbol"]
        analysis = signal.get("analysis", {})
        equity = portfolio.get("equity", 100_000)
        price = analysis.get("price", 100)
        or_width = analysis.get("or_width", price * 0.01)
        direction = signal.get("direction", "bullish")

        # Risk = STOP_MULT * OR width
        risk_per_share = self.STOP_MULT * or_width
        risk_dollar = equity * self.RISK_PER_TRADE
        shares = max(1, int(risk_dollar / risk_per_share)) if risk_per_share > 0 else 1

        notional = shares * price
        max_notional = equity * 0.06
        if notional > max_notional:
            shares = max(1, int(max_notional / price))
            notional = shares * price

        # Fibonacci extension targets instead of fixed 1.5x
        if direction == "bullish":
            stop_loss = round(price - self.STOP_MULT * or_width, 2)
            take_profit_1 = round(price + self.TARGET_MULT_1 * or_width, 2)
            take_profit_2 = round(price + self.TARGET_MULT_2 * or_width, 2)
        else:
            stop_loss = round(price + self.STOP_MULT * or_width, 2)
            take_profit_1 = round(price - self.TARGET_MULT_1 * or_width, 2)
            take_profit_2 = round(price - self.TARGET_MULT_2 * or_width, 2)

        return {
            "symbol": symbol,
            "strategy": self.name,
            "structure": "long_equity" if direction == "bullish" else "short_equity",
            "direction": direction,
            "shares": shares,
            "notional": round(notional, 2),
            "entry_price": price,
            "stop_loss": stop_loss,
            "take_profit": take_profit_1,
            "take_profit_runner": take_profit_2,
            "exit_rules": {
                "time_exit": "14:30_ET",
                "or_midpoint_trail": True,
                "max_hold_minutes": self.MAX_HOLD_MINUTES,
                "scale_out": {
                    "at_fib_1272": {"pct_of_position": 50, "target": take_profit_1},
                    "at_fib_1618": {"pct_of_position": 50, "target": take_profit_2},
                },
            },
        }

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        pnl_pct = position.get("pnl_pct", 0)
        days_held = position.get("days_held", 0)

        # Must close by end of day (intraday strategy)
        if days_held >= 1:
            return {"action": "close", "reason": "End of day — ORB is intraday only"}

        # Stop loss
        if pnl_pct <= -3:
            return {"action": "close", "reason": f"Stop loss ({pnl_pct:.1f}%)"}

        # Target
        if pnl_pct >= 5:
            return {"action": "close", "reason": f"Target reached ({pnl_pct:.1f}%)"}

        return {"action": "hold", "reason": "Within intraday parameters"}
