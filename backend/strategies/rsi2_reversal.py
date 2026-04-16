"""RSI-2 Short-Term Mean Reversion Strategy (Connors & Alvarez 2009).

Buys when RSI(2) drops below 10 with price above 200-day SMA (trade
with the trend), exits when RSI(2) rises above 90 or price crosses
above the 5-day SMA.

Academic source: Connors & Alvarez "Short Term Trading Strategies That Work".
Grounded in DeBondt & Thaler (1985) "Does the Stock Market Overreact?"
and Jegadeesh (1990) overreaction/reversal literature.

Enhancements:
- ConnorsRSI (blends price RSI, streak RSI, percent-rank) for signal quality
- Volume spike detection on the oversold day (capitulation confirmation)
- Stop at recent swing low instead of fixed 5%
- Market breadth filter: skip when SPY is also deeply oversold (systemic risk)
"""
from __future__ import annotations

from typing import Any

from strategies.base import BaseStrategy


def _compute_rsi(closes: list[float], period: int = 2) -> float:
    """Compute RSI for a given period using Wilder's smoothing."""
    if len(closes) < period + 1:
        return 50.0

    gains, losses = [], []
    for i in range(-period, 0):
        change = closes[i] - closes[i - 1]
        gains.append(max(change, 0))
        losses.append(max(-change, 0))

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _percent_rank(value: float, history: list[float]) -> float:
    """Compute percent-rank of value within history (0-100)."""
    if not history:
        return 50.0
    count_below = sum(1 for v in history if v < value)
    return (count_below / len(history)) * 100


def _compute_connors_rsi(
    closes: list[float],
    rsi_period: int = 2,
    streak_period: int = 3,
    pctrank_period: int = 100,
) -> float:
    """ConnorsRSI = avg(RSI(2), RSI(streak,3), PercentRank(returns,100)).

    Blends price RSI, streak RSI, and magnitude rank for a
    higher-quality mean-reversion signal (Connors Research).
    """
    if len(closes) < max(rsi_period + 1, streak_period + 2):
        return 50.0

    # Component 1: standard RSI on price
    rsi_price = _compute_rsi(closes, rsi_period)

    # Component 2: RSI on the consecutive up/down streak series
    def _streak_at(idx: int) -> float:
        if idx < 1:
            return 0.0
        s, direction = 0, 1 if closes[idx] >= closes[idx - 1] else -1
        for k in range(idx, 0, -1):
            if (closes[k] >= closes[k - 1]) == (direction > 0):
                s += 1
            else:
                break
        return float(s * direction)

    n_streak = max(streak_period + 2, 10)
    streaks = [
        _streak_at(len(closes) - 1 - j)
        for j in range(n_streak - 1, -1, -1)
    ]
    rsi_streak = (
        _compute_rsi(streaks, streak_period)
        if len(streaks) > streak_period
        else 50.0
    )

    # Component 3: percent-rank of today's return over last N days
    start = max(1, len(closes) - pctrank_period)
    daily_rets = [
        (closes[i] / closes[i - 1] - 1)
        for i in range(start, len(closes))
        if closes[i - 1] > 0
    ]
    if daily_rets:
        pct_rank = _percent_rank(daily_rets[-1], daily_rets)
    else:
        pct_rank = 50.0

    return (rsi_price + rsi_streak + pct_rank) / 3.0


class RSI2ReversalStrategy(BaseStrategy):
    """Short-term countertrend: buy extreme RSI(2) dips in uptrending stocks."""

    name = "rsi2_reversal"
    description = (
        "RSI-2 mean reversion: buys when RSI(2) < 10 with price above "
        "200-day SMA, exits on RSI(2) > 90 or 5-day SMA cross. 3-7 day holds. "
        "Uses ConnorsRSI, volume spike detection, and swing-low stops."
    )
    default_timeframe = "day"

    # Parameters (Connors defaults)
    RSI_PERIOD = 2
    ENTRY_THRESHOLD = 10       # RSI(2) < 10 to enter
    EXIT_THRESHOLD = 90        # RSI(2) > 90 to exit
    TREND_SMA = 200            # Must be above 200-day SMA
    EXIT_SMA = 5               # Alt exit: close > 5-day SMA
    MAX_HOLD_DAYS = 10         # Time-based stop
    CATASTROPHIC_STOP = 0.07   # -7% hard stop (widened from 5% for swing-low)
    SCALE_IN_THRESHOLD = 5     # RSI(2) < 5 for second entry
    VOLUME_SPIKE_MULT = 1.5    # volume must be 1.5x the 20-day average
    SWING_LOW_LOOKBACK = 10    # days to find recent swing low for stop
    SPY_RSI2_SYSTEMIC = 5      # skip entries if SPY RSI(2) < this

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Screen for liquid uptrending stocks with extreme RSI(2) readings."""
        candidates = []
        for t in universe:
            if (t.get("avg_volume", 0) or 0) < 1_000_000:
                continue
            if (t.get("market_cap", 0) or 0) < 5_000_000_000:
                continue
            # Need price above 200-day SMA (uptrend filter)
            closes = t.get("closes", [])
            if len(closes) >= self.TREND_SMA:
                sma200 = sum(closes[-self.TREND_SMA:]) / self.TREND_SMA
                if closes[-1] <= sma200:
                    continue
            candidates.append(t)

        candidates.sort(key=lambda x: x.get("avg_volume", 0) or 0, reverse=True)
        return candidates[:50]

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Compute RSI(2), ConnorsRSI, volume spike, SMA filters, and signal strength."""
        price = data.get("price", 0) or data.get("current_price", 0)
        closes = data.get("closes", [])
        volumes = data.get("volumes", [])
        lows = data.get("lows", [])

        if len(closes) < self.TREND_SMA:
            return {"symbol": symbol, "score": 0, "conviction": "low",
                    "signal": "no_data"}

        # --- Market breadth filter via SPY data (if available) ---
        spy_closes = data.get("spy_closes", [])
        if len(spy_closes) >= 3:
            spy_rsi2 = _compute_rsi(spy_closes, 2)
            if spy_rsi2 < self.SPY_RSI2_SYSTEMIC:
                return {"symbol": symbol, "score": 0, "conviction": "low",
                        "signal": "systemic_risk",
                        "reason": f"SPY RSI(2)={spy_rsi2:.0f} — systemic selloff"}

        rsi2 = _compute_rsi(closes, self.RSI_PERIOD)
        connors_rsi = _compute_connors_rsi(closes)
        sma200 = sum(closes[-self.TREND_SMA:]) / self.TREND_SMA
        sma5 = sum(closes[-5:]) / 5 if len(closes) >= 5 else price
        above_trend = price > sma200
        below_exit_sma = price < sma5

        # Volume spike detection (capitulation confirmation)
        volume_spike = False
        vol_ratio = 1.0
        if len(volumes) >= 21:
            avg_vol_20 = sum(volumes[-21:-1]) / 20
            if avg_vol_20 > 0:
                vol_ratio = volumes[-1] / avg_vol_20
                volume_spike = vol_ratio >= self.VOLUME_SPIKE_MULT

        # Score: lower RSI(2) = stronger buy signal (inverted)
        if above_trend and rsi2 < self.ENTRY_THRESHOLD:
            # Deeper oversold = higher score
            score = min(90, 50 + (self.ENTRY_THRESHOLD - rsi2) * 5)
            # ConnorsRSI bonus: both indicators agreeing
            if connors_rsi < 10:
                score = min(95, score + 5)
            # Volume spike bonus
            if volume_spike:
                score = min(95, score + 3)
        elif above_trend and rsi2 < 20:
            score = 30
        else:
            score = 0

        conviction = "high" if rsi2 < 5 else "medium" if rsi2 < 10 else "low"

        # Swing-low stop calculation
        if len(lows) >= self.SWING_LOW_LOOKBACK:
            swing_low = min(lows[-self.SWING_LOW_LOOKBACK:])
        elif lows:
            swing_low = min(lows)
        else:
            swing_low = price * (1 - self.CATASTROPHIC_STOP)
        swing_low_stop = round(swing_low * 0.995, 2)  # 0.5% buffer
        # Floor: never risk more than CATASTROPHIC_STOP from entry
        swing_low_stop = max(swing_low_stop, round(price * (1 - self.CATASTROPHIC_STOP), 2))

        return {
            "symbol": symbol,
            "score": round(score, 1),
            "conviction": conviction,
            "price": price,
            "rsi2": round(rsi2, 2),
            "connors_rsi": round(connors_rsi, 2),
            "sma200": round(sma200, 2),
            "sma5": round(sma5, 2),
            "above_trend": above_trend,
            "below_exit_sma": below_exit_sma,
            "volume_spike": volume_spike,
            "vol_ratio": round(vol_ratio, 2),
            "swing_low_stop": swing_low_stop,
        }

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        if analysis.get("signal") in ("no_data", "systemic_risk"):
            return None
        if not analysis.get("above_trend", False):
            return None
        if analysis.get("rsi2", 50) >= self.ENTRY_THRESHOLD:
            return None
        if analysis.get("score", 0) < 40:
            return None

        return {
            "symbol": analysis["symbol"],
            "direction": "bullish",
            "strength": analysis["score"],
            "conviction": analysis["conviction"],
            "timeframe": "day",
            "holding_period_days": 5,
            "analysis": analysis,
        }

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        symbol = signal["symbol"]
        analysis = signal.get("analysis", {})
        equity = portfolio.get("equity", 100_000)
        price = analysis.get("price", 100)
        rsi2 = analysis.get("rsi2", 10)

        # Use swing-low stop instead of fixed percentage
        stop_loss = analysis.get("swing_low_stop", round(price * (1 - self.CATASTROPHIC_STOP), 2))
        stop_distance = max(0.01, price - stop_loss)

        # Fixed fractional: risk 1-2% per trade
        risk_pct = 0.015 if rsi2 < 5 else 0.01  # Scale in deeper
        risk_dollar = equity * risk_pct
        shares = max(1, int(risk_dollar / stop_distance)) if stop_distance > 0 else 1

        notional = shares * price
        max_notional = equity * 0.06
        if notional > max_notional:
            shares = max(1, int(max_notional / price))
            notional = shares * price

        take_profit = round(analysis.get("sma5", price * 1.04), 2)

        return {
            "symbol": symbol,
            "strategy": self.name,
            "structure": "long_equity",
            "direction": "bullish",
            "shares": shares,
            "notional": round(notional, 2),
            "entry_price": price,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
            "exit_rules": {
                "rsi2_exit": self.EXIT_THRESHOLD,
                "sma5_exit": True,
                "max_hold_days": self.MAX_HOLD_DAYS,
                "catastrophic_stop_pct": self.CATASTROPHIC_STOP * 100,
                "stop_type": "swing_low",
            },
        }

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        price = market_data.get("price", 0)
        rsi2 = market_data.get("rsi2", 50)
        sma5 = market_data.get("sma5", 0)
        pnl_pct = position.get("pnl_pct", 0)
        days_held = position.get("days_held", 0)

        # Primary exit: RSI(2) > 90
        if rsi2 > self.EXIT_THRESHOLD:
            return {"action": "close", "reason": f"RSI(2) overbought at {rsi2:.0f}"}

        # Alt exit: price crosses above 5-day SMA
        if sma5 > 0 and price > sma5 and days_held >= 2:
            return {"action": "close", "reason": "Price crossed above 5-day SMA"}

        # Time stop
        if days_held >= self.MAX_HOLD_DAYS:
            return {"action": "close", "reason": f"Max hold period ({self.MAX_HOLD_DAYS} days)"}

        # Catastrophic stop (swing-low or hard percentage)
        if pnl_pct <= -(self.CATASTROPHIC_STOP * 100):
            return {"action": "close", "reason": f"Hard stop hit ({pnl_pct:.1f}%)"}

        return {"action": "hold", "reason": "Awaiting RSI(2) reversion"}
