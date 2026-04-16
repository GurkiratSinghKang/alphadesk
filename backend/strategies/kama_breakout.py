"""KAMA + ATR Breakout Strategy (Kaufman 1998).

Combines Kaufman's Adaptive Moving Average for trend detection with
ATR-based Keltner Channel breakouts and volatility-normalized position
sizing (Turtle-style).

Academic source: Kaufman "Trading Systems and Methods". Volatility
clustering framework from Engle (1982) ARCH, Bollerslev (1986) GARCH.
Breakout validation from Turtle Trading (Dennis & Eckhardt 1983).
"""
from __future__ import annotations

import math
from typing import Any

from strategies.base import BaseStrategy


def _compute_kama(
    closes: list[float],
    er_period: int = 10,
    fast_sc: int = 2,
    slow_sc: int = 30,
) -> list[float]:
    """Compute Kaufman Adaptive Moving Average.

    KAMA adapts speed based on the Efficiency Ratio:
    - High ER (trending) -> fast smoothing
    - Low ER (choppy) -> slow smoothing
    """
    if len(closes) < er_period + 1:
        return closes[:]

    fast_alpha = 2 / (fast_sc + 1)
    slow_alpha = 2 / (slow_sc + 1)

    kama_values = [closes[er_period]]  # seed with first valid close

    for i in range(er_period + 1, len(closes)):
        # Efficiency Ratio = direction / volatility
        direction = abs(closes[i] - closes[i - er_period])
        volatility = sum(
            abs(closes[j] - closes[j - 1])
            for j in range(i - er_period + 1, i + 1)
        )

        er = direction / volatility if volatility > 0 else 0

        # Smoothing constant adapts between fast and slow
        sc = (er * (fast_alpha - slow_alpha) + slow_alpha) ** 2

        # KAMA = previous_kama + sc * (close - previous_kama)
        prev_kama = kama_values[-1]
        kama = prev_kama + sc * (closes[i] - prev_kama)
        kama_values.append(kama)

    return kama_values


def _compute_atr(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    period: int = 20,
) -> float:
    """Compute Average True Range."""
    if len(closes) < period + 1:
        return 0

    true_ranges = []
    for i in range(-period, 0):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        true_ranges.append(tr)

    return sum(true_ranges) / len(true_ranges)


def _compute_keltner(
    closes: list[float],
    highs: list[float],
    lows: list[float],
    ema_period: int = 20,
    atr_mult: float = 2.0,
) -> tuple[float, float, float, float]:
    """Compute Keltner Channel: (ema, upper, lower, atr).

    Channel = EMA(20) +/- 2.0 * ATR(20).
    """
    if len(closes) < ema_period + 1:
        return closes[-1], closes[-1], closes[-1], 0

    # EMA
    ema = sum(closes[:ema_period]) / ema_period
    mult = 2 / (ema_period + 1)
    for c in closes[ema_period:]:
        ema = c * mult + ema * (1 - mult)

    atr = _compute_atr(highs, lows, closes, ema_period)

    upper = ema + atr_mult * atr
    lower = ema - atr_mult * atr

    return ema, upper, lower, atr


class KAMABreakoutStrategy(BaseStrategy):
    """Volatility-adaptive trend following with Keltner Channel breakouts."""

    name = "kama_breakout"
    description = (
        "KAMA + ATR breakout: enters on Keltner Channel breakouts confirmed "
        "by KAMA trend direction. ATR-based position sizing and trailing stops."
    )
    default_timeframe = "swing"

    # Parameters
    KAMA_ER_PERIOD = 10
    KAMA_FAST = 2
    KAMA_SLOW = 30
    KELTNER_EMA = 20
    KELTNER_ATR_MULT = 2.0
    ATR_PERIOD = 20
    TRAILING_ATR_MULT = 2.0
    RISK_PER_TRADE = 0.01      # 1% of portfolio per trade

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Screen for stocks showing volatility compression (squeeze setup)."""
        candidates = []
        for t in universe:
            if (t.get("avg_volume", 0) or 0) < 500_000:
                continue
            if (t.get("market_cap", 0) or 0) < 1_000_000_000:
                continue
            candidates.append(t)
        candidates.sort(key=lambda x: x.get("avg_volume", 0) or 0, reverse=True)
        return candidates[:40]

    # Additional filter thresholds
    RSI_OVERBOUGHT = 80       # skip breakouts when RSI(14) > 80
    BB_PERIOD = 20
    BB_STD_MULT = 2.0
    VOLUME_SURGE_MULT = 1.5   # breakout bar volume > 1.5x 20-day average

    @staticmethod
    def _compute_rsi(closes: list[float], period: int = 14) -> float:
        """Compute RSI(period) from close prices."""
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

    @staticmethod
    def _bb_inside_keltner(
        closes: list[float],
        keltner_upper: float,
        keltner_lower: float,
        bb_period: int = 20,
        bb_mult: float = 2.0,
    ) -> bool:
        """True if Bollinger Bands are inside the Keltner Channel (TTM Squeeze)."""
        if len(closes) < bb_period:
            return False
        recent = closes[-bb_period:]
        bb_mid = sum(recent) / len(recent)
        bb_std = math.sqrt(sum((c - bb_mid) ** 2 for c in recent) / len(recent))
        bb_upper = bb_mid + bb_mult * bb_std
        bb_lower = bb_mid - bb_mult * bb_std
        return bb_upper < keltner_upper and bb_lower > keltner_lower

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Compute KAMA slope, Keltner breakout, BB squeeze, RSI, and volume confirmation."""
        price = data.get("price", 0) or data.get("current_price", 0)
        closes = data.get("closes", [])
        highs = data.get("highs", closes[:])
        lows = data.get("lows", closes[:])
        volumes = data.get("volumes", [])

        if len(closes) < 50:
            return {"symbol": symbol, "score": 0, "conviction": "low",
                    "signal": "no_data"}

        # KAMA + Efficiency Ratio logging
        kama = _compute_kama(closes, self.KAMA_ER_PERIOD, self.KAMA_FAST, self.KAMA_SLOW)
        kama_current = kama[-1] if kama else price
        kama_prev = kama[-2] if len(kama) >= 2 else kama_current
        kama_slope_up = kama_current > kama_prev
        above_kama = price > kama_current

        # Compute and log the current Efficiency Ratio for debugging
        er_period = self.KAMA_ER_PERIOD
        if len(closes) > er_period:
            er_direction = abs(closes[-1] - closes[-1 - er_period])
            er_volatility = sum(
                abs(closes[j] - closes[j - 1])
                for j in range(len(closes) - er_period, len(closes))
            )
            efficiency_ratio = er_direction / er_volatility if er_volatility > 0 else 0
        else:
            efficiency_ratio = 0

        # Keltner Channel
        ema, upper, lower, atr = _compute_keltner(
            closes, highs, lows, self.KELTNER_EMA, self.KELTNER_ATR_MULT
        )

        breakout_up = price > upper
        breakout_down = price < lower

        # RSI(14) for overbought filter
        rsi = self._compute_rsi(closes, 14)

        # Volume surge check on latest bar
        vol_surge = False
        if len(volumes) >= 21:
            avg_vol = sum(volumes[-21:-1]) / 20
            vol_surge = avg_vol > 0 and volumes[-1] > avg_vol * self.VOLUME_SURGE_MULT

        # Squeeze detection: BB inside Keltner (TTM Squeeze)
        bb_squeeze = self._bb_inside_keltner(
            closes, upper, lower, self.BB_PERIOD, self.BB_STD_MULT
        )
        # Also check ATR compression as secondary squeeze signal
        if len(closes) >= 40:
            atr_now = _compute_atr(highs, lows, closes, 20)
            atr_prev = _compute_atr(highs[:-20], lows[:-20], closes[:-20], 20) if len(closes) >= 60 else atr_now
            atr_squeeze = atr_prev > 0 and atr_now / atr_prev < 0.75
        else:
            atr_squeeze = False
            atr_now = atr
        squeeze = bb_squeeze or atr_squeeze

        # Score
        score = 0
        direction = "none"

        if kama_slope_up and above_kama and breakout_up:
            # Skip if RSI overbought (mean reversion filter)
            if rsi > self.RSI_OVERBOUGHT:
                score = 10  # signal noted but too overbought to act
                direction = "overbought"
            else:
                # Bullish breakout confirmed by KAMA
                score = min(85, 50 + (price - upper) / price * 500)
                if squeeze:
                    score += 15  # breakout from squeeze is stronger
                if bb_squeeze:
                    score += 5   # extra for proper BB squeeze
                if vol_surge:
                    score += 5   # volume confirmation
                direction = "bullish"
        elif not kama_slope_up and not above_kama and breakout_down:
            # Bearish breakout (for short or exit)
            score = max(-85, -50 - (lower - price) / price * 500)
            direction = "bearish"
        elif squeeze:
            score = 20  # watching for breakout from squeeze
            direction = "watching"

        score = max(-100, min(100, score))
        conviction = "high" if score > 55 else "medium" if score > 30 else "low"

        return {
            "symbol": symbol,
            "score": round(score, 1),
            "conviction": conviction,
            "price": price,
            "kama": round(kama_current, 2),
            "kama_prev": round(kama_prev, 2),
            "kama_slope_up": kama_slope_up,
            "above_kama": above_kama,
            "efficiency_ratio": round(efficiency_ratio, 4),
            "keltner_ema": round(ema, 2),
            "keltner_upper": round(upper, 2),
            "keltner_lower": round(lower, 2),
            "atr": round(atr_now, 2) if atr_now else 0,
            "rsi": round(rsi, 1),
            "breakout_up": breakout_up,
            "breakout_down": breakout_down,
            "squeeze": squeeze,
            "bb_squeeze": bb_squeeze,
            "vol_surge": vol_surge,
            "direction": direction,
        }

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        if analysis.get("signal") == "no_data":
            return None
        if analysis.get("direction") not in ("bullish",):
            return None
        if analysis.get("score", 0) < 40:
            return None
        if not analysis.get("breakout_up", False):
            return None
        # RSI overbought filter
        if analysis.get("rsi", 50) > self.RSI_OVERBOUGHT:
            return None
        # Volume surge confirmation required
        if not analysis.get("vol_surge", False):
            return None

        return {
            "symbol": analysis["symbol"],
            "direction": "bullish",
            "strength": analysis["score"],
            "conviction": analysis["conviction"],
            "timeframe": "swing",
            "holding_period_days": 20,
            "analysis": analysis,
        }

    # Pyramiding parameters
    MAX_PYRAMID_UNITS = 3         # max total position units (initial + 2 adds)
    PYRAMID_ATR_STEP = 0.5        # add when price moves 0.5 ATR in our favor
    CHANDELIER_ATR_MULT = 3.0     # chandelier exit: highest high - 3x ATR

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        symbol = signal["symbol"]
        analysis = signal.get("analysis", {})
        equity = portfolio.get("equity", 100_000)
        price = analysis.get("price", 100)
        atr = analysis.get("atr", price * 0.02)

        # Turtle-style ATR sizing: 1 unit = (1% of equity) / ATR
        if atr > 0:
            shares = max(1, int((equity * self.RISK_PER_TRADE) / atr))
        else:
            shares = max(1, int(equity * 0.03 / price))

        notional = shares * price
        max_notional = equity * 0.08
        if notional > max_notional:
            shares = max(1, int(max_notional / price))
            notional = shares * price

        # Chandelier exit: highest high - 3x ATR (replaces simple 2x ATR stop)
        stop_distance = self.CHANDELIER_ATR_MULT * atr
        stop_loss = round(price - stop_distance, 2)
        take_profit = round(price + stop_distance * 3, 2)  # 3:1 R/R

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
            "pyramid_unit": 1,           # initial unit
            "unit_shares": shares,       # shares per pyramid unit
            "exit_rules": {
                "chandelier_atr_mult": self.CHANDELIER_ATR_MULT,
                "kama_exit": "close_below_kama",
                "squeeze_exit": True,
                "max_hold_days": 20,
                "max_pyramid_units": self.MAX_PYRAMID_UNITS,
            },
        }

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        """Manage open position with chandelier exit and pyramiding logic.

        Chandelier exit: trail stop at highest_high - 3x ATR (tighter than
        simple ATR trailing stop, anchored to the high watermark).

        Pyramiding: if KAMA slope is strengthening and price has moved
        favorably by 0.5 ATR since last add, scale into the position
        (up to MAX_PYRAMID_UNITS total units).
        """
        price = market_data.get("price", 0)
        kama = market_data.get("kama", 0)
        kama_prev = market_data.get("kama_prev", kama)
        atr = market_data.get("atr", 0)
        highest_high = market_data.get("highest_high", price)
        pnl_pct = position.get("pnl_pct", 0)
        days_held = position.get("days_held", 0)
        entry_price = position.get("entry_price", price)
        pyramid_unit = position.get("pyramid_unit", 1)
        last_add_price = position.get("last_add_price", entry_price)

        # Primary exit: price crosses below KAMA
        if kama > 0 and price < kama:
            return {"action": "close", "reason": "Price crossed below KAMA (trend weakening)"}

        # Chandelier exit: highest high - 3x ATR (replaces simple trailing stop)
        if atr > 0 and highest_high > 0:
            chandelier_stop = highest_high - self.CHANDELIER_ATR_MULT * atr
            if price < chandelier_stop:
                return {
                    "action": "close",
                    "reason": (
                        f"Chandelier stop hit: price ${price:.2f} < "
                        f"${chandelier_stop:.2f} (HH ${highest_high:.2f} - "
                        f"{self.CHANDELIER_ATR_MULT}x ATR ${atr:.2f}) "
                        f"P&L {pnl_pct:.1f}%"
                    ),
                }

        # Time exit
        if days_held >= 20:
            return {"action": "close", "reason": "Max holding period (20 days)"}

        # Hard stop
        if pnl_pct <= -10:
            return {"action": "close", "reason": f"Hard stop hit ({pnl_pct:.1f}%)"}

        # --- Pyramiding: add to winning positions when KAMA slope strengthens ---
        if (
            pyramid_unit < self.MAX_PYRAMID_UNITS
            and atr > 0
            and price > kama > 0
            and kama > kama_prev                         # KAMA slope strengthening
            and (kama - kama_prev) > (kama_prev * 0.001) # slope is material
            and price > last_add_price + self.PYRAMID_ATR_STEP * atr  # moved favorably
            and pnl_pct > 0                              # only add to winners
        ):
            return {
                "action": "add",
                "reason": (
                    f"Pyramid unit {pyramid_unit + 1}/{self.MAX_PYRAMID_UNITS}: "
                    f"KAMA slope strengthening ({kama:.2f} > {kama_prev:.2f}), "
                    f"price moved +{self.PYRAMID_ATR_STEP} ATR since last add"
                ),
                "pyramid_unit": pyramid_unit + 1,
                "last_add_price": price,
            }

        return {"action": "hold", "reason": f"Trend intact, above KAMA (P&L {pnl_pct:.1f}%, unit {pyramid_unit})"}
