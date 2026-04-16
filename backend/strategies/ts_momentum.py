"""Time-Series Momentum Strategy (Moskowitz, Ooi & Pedersen 2012).

Trend-following strategy that goes long when 12-month return > 0
(price above 200-day SMA) and exits to cash when the trend reverses.
Uses inverse-volatility position sizing for risk parity.

Enhanced with:
- EMA 50/200 crossover for trend confirmation
- ADX-like directional strength filter (skip sideways markets)
- ATR-based stop/target sizing
- Adaptive trailing stop logic in manage()

Academic source: "Time Series Momentum", Journal of Financial Economics.
Extended by Hurst, Ooi & Pedersen (2017) "A Century of Evidence on
Trend-Following Investing" and Faber (2007) "A Quantitative Approach
to Tactical Asset Allocation".
"""
from __future__ import annotations

import math
from typing import Any

from strategies.base import BaseStrategy


class TSMomentumStrategy(BaseStrategy):
    """200-day SMA trend following with volatility-scaled sizing."""

    name = "ts_momentum"
    description = (
        "Time-series momentum: goes long when price > 200-day SMA with "
        "EMA crossover confirmation and ADX trend filter. "
        "Inverse-vol position sizing, ATR-based stops."
    )
    default_timeframe = "position"

    # Parameters (Moskowitz et al. defaults)
    SMA_PERIOD = 200
    EMA_FAST = 50
    EMA_SLOW = 200
    VOL_LOOKBACK = 60          # days for realized vol
    TARGET_VOL = 0.12          # 12% annualized target
    REBALANCE_THRESHOLD = 0.02 # 2% drift before rebalance
    TRAILING_ATR_MULT = 2.5    # trailing stop = 2.5x ATR
    ATR_PERIOD = 20
    ADX_PERIOD = 14
    ADX_THRESHOLD = 20         # skip stocks below this ADX

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _ema(values: list[float], period: int) -> float:
        """Compute EMA of the last *period* values.  Seeds with SMA."""
        if not values:
            return 0.0
        if len(values) < period:
            return sum(values) / len(values)
        ema = sum(values[:period]) / period
        mult = 2 / (period + 1)
        for v in values[period:]:
            ema = v * mult + ema * (1 - mult)
        return ema

    @staticmethod
    def _compute_atr(closes: list[float], highs: list[float],
                     lows: list[float], period: int = 20) -> float:
        """Compute Average True Range over *period* bars."""
        if len(closes) < period + 1:
            if closes:
                return (max(closes) - min(closes)) / max(len(closes), 1)
            return 0.0
        true_ranges: list[float] = []
        for i in range(-period, 0):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
            true_ranges.append(tr)
        return sum(true_ranges) / len(true_ranges) if true_ranges else 0.0

    @staticmethod
    def _compute_adx(closes: list[float], highs: list[float],
                     lows: list[float], period: int = 14) -> float:
        """Approximate ADX using Wilder smoothing.  Returns 0-100."""
        n = len(closes)
        if n < period + 2:
            return 0.0

        plus_dm_list: list[float] = []
        minus_dm_list: list[float] = []
        tr_list: list[float] = []

        start = max(0, n - 2 * period - 1)
        for i in range(start + 1, n):
            up_move = highs[i] - highs[i - 1]
            down_move = lows[i - 1] - lows[i]
            plus_dm_list.append(max(up_move, 0) if up_move > down_move else 0.0)
            minus_dm_list.append(max(down_move, 0) if down_move > up_move else 0.0)
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
            tr_list.append(tr)

        if len(tr_list) < period:
            return 0.0

        atr_s = sum(tr_list[:period])
        plus_dm_s = sum(plus_dm_list[:period])
        minus_dm_s = sum(minus_dm_list[:period])

        dx_values: list[float] = []
        for i in range(period, len(tr_list)):
            atr_s = atr_s - atr_s / period + tr_list[i]
            plus_dm_s = plus_dm_s - plus_dm_s / period + plus_dm_list[i]
            minus_dm_s = minus_dm_s - minus_dm_s / period + minus_dm_list[i]
            plus_di = (plus_dm_s / atr_s * 100) if atr_s > 0 else 0
            minus_di = (minus_dm_s / atr_s * 100) if atr_s > 0 else 0
            di_sum = plus_di + minus_di
            dx = abs(plus_di - minus_di) / di_sum * 100 if di_sum > 0 else 0
            dx_values.append(dx)

        if not dx_values:
            return 0.0
        adx = (sum(dx_values[:period]) / period
               if len(dx_values) >= period
               else sum(dx_values) / len(dx_values))
        for i in range(period, len(dx_values)):
            adx = (adx * (period - 1) + dx_values[i]) / period
        return adx

    # ------------------------------------------------------------------
    # Pipeline methods
    # ------------------------------------------------------------------

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Screen for liquid stocks with sufficient price history."""
        candidates = []
        for t in universe:
            if (t.get("avg_volume", 0) or 0) < 500_000:
                continue
            if (t.get("market_cap", 0) or 0) < 2_000_000_000:
                continue
            candidates.append(t)
        candidates.sort(key=lambda x: x.get("avg_volume", 0) or 0, reverse=True)
        return candidates[:40]

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Compute trend signal: price vs 200-day SMA + EMA crossover + ADX."""
        price = data.get("price", 0) or data.get("current_price", 0)
        closes = data.get("closes", [])
        highs = data.get("highs", closes)      # fallback to closes
        lows = data.get("lows", closes)

        if len(closes) < self.SMA_PERIOD:
            return {"symbol": symbol, "score": 0, "conviction": "low",
                    "signal": "no_data"}

        sma_200 = sum(closes[-self.SMA_PERIOD:]) / self.SMA_PERIOD
        above_sma = price > sma_200
        distance_pct = ((price - sma_200) / sma_200) * 100

        # ------ EMA crossover (50/200) ------
        ema_50 = self._ema(closes, self.EMA_FAST)
        ema_200 = self._ema(closes, self.EMA_SLOW)
        ema_bullish = ema_50 > ema_200  # golden cross state

        # ------ 12-month return ------
        ret_12m = (closes[-1] / closes[0] - 1) * 100 if closes[0] > 0 else 0

        # ------ Realized volatility (60-day, annualized) ------
        vol_lookback = min(self.VOL_LOOKBACK, len(closes) - 1)
        if vol_lookback >= 10:
            daily_returns = [
                (closes[i] / closes[i - 1] - 1)
                for i in range(-vol_lookback + 1, 0)
                if closes[i - 1] > 0
            ]
            if daily_returns:
                mean_ret = sum(daily_returns) / len(daily_returns)
                var = sum((r - mean_ret) ** 2 for r in daily_returns) / len(daily_returns)
                realized_vol = math.sqrt(var * 252)
            else:
                realized_vol = 0.20
        else:
            realized_vol = 0.20

        # ------ ADX trend strength ------
        adx = self._compute_adx(closes, highs, lows, self.ADX_PERIOD)
        trending = adx >= self.ADX_THRESHOLD

        # ------ ATR ------
        atr = self._compute_atr(closes, highs, lows, self.ATR_PERIOD)

        # ------ Trend slope: slope of 50-day SMA over last 20 days ------
        if len(closes) >= 70:
            sma50_now = sum(closes[-50:]) / 50
            sma50_20ago = sum(closes[-70:-20]) / 50
            trend_slope = (sma50_now - sma50_20ago) / sma50_20ago * 100
        else:
            trend_slope = 0

        # ------ Score ------
        score = 0.0
        if above_sma:
            score = 40 + abs(distance_pct) * 3 + trend_slope * 2
            # EMA crossover bonus
            if ema_bullish:
                score += 10
            # ADX bonus
            if trending:
                score += min(10, (adx - self.ADX_THRESHOLD) * 0.5)
            score = min(95, score)
        else:
            score = -40 - abs(distance_pct) * 3
            if not ema_bullish:
                score -= 5
            score = max(-95, score)

        conviction = "high" if score > 55 else "medium" if score > 25 else "low"

        return {
            "symbol": symbol,
            "score": round(score, 1),
            "conviction": conviction,
            "price": price,
            "sma_200": round(sma_200, 2),
            "above_sma": above_sma,
            "distance_pct": round(distance_pct, 2),
            "ema_50": round(ema_50, 2),
            "ema_200": round(ema_200, 2),
            "ema_bullish": ema_bullish,
            "adx": round(adx, 1),
            "trending": trending,
            "atr": round(atr, 2),
            "return_12m": round(ret_12m, 2),
            "realized_vol": round(realized_vol, 4),
            "trend_slope": round(trend_slope, 2),
        }

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        if analysis.get("signal") == "no_data":
            return None
        if not analysis.get("above_sma", False):
            return None
        if analysis.get("score", 0) < 25:
            return None
        # Require ADX trending to avoid whipsaw in sideways markets
        if not analysis.get("trending", False):
            return None

        return {
            "symbol": analysis["symbol"],
            "direction": "bullish",
            "strength": analysis["score"],
            "conviction": analysis["conviction"],
            "timeframe": "position",
            "holding_period_days": 60,
            "analysis": analysis,
        }

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        symbol = signal["symbol"]
        analysis = signal.get("analysis", {})
        equity = portfolio.get("equity", 100_000)
        price = analysis.get("price", 100)
        realized_vol = analysis.get("realized_vol", 0.20)
        atr = analysis.get("atr", 0)

        # Inverse-volatility sizing: allocate so each position contributes
        # TARGET_VOL / sqrt(N) to portfolio vol
        if realized_vol > 0:
            vol_target_notional = (equity * self.TARGET_VOL) / (realized_vol * math.sqrt(252))
            notional = min(vol_target_notional, equity * 0.08)
        else:
            notional = equity * 0.05

        shares = max(1, int(notional / price)) if price > 0 else 0
        actual_notional = shares * price

        # ATR-based stop and target (preferred over daily vol estimate)
        if atr > 0:
            stop_distance = self.TRAILING_ATR_MULT * atr
        else:
            # Fallback to daily vol estimate
            daily_vol_dollar = price * realized_vol / math.sqrt(252)
            stop_distance = self.TRAILING_ATR_MULT * daily_vol_dollar

        stop_loss = round(price - stop_distance, 2)
        take_profit = round(price + stop_distance * 3, 2)  # 3:1 R/R

        return {
            "symbol": symbol,
            "strategy": self.name,
            "structure": "long_equity",
            "direction": "bullish",
            "shares": shares,
            "notional": round(actual_notional, 2),
            "entry_price": price,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
            "atr": round(atr, 2) if atr else None,
            "exit_rules": {
                "trailing_stop_atr_mult": self.TRAILING_ATR_MULT,
                "trend_exit": "close_below_sma200",
                "ema_exit": "ema50_crosses_below_ema200",
                "max_hold_days": 60,
            },
        }

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        """Manage an existing position with adaptive trailing stop logic.

        Exit hierarchy (checked in order):
        1. Hard stop: price hit original stop loss
        2. Trend exit: price crosses below 200-day SMA
        3. EMA death cross: EMA-50 crosses below EMA-200
        4. Adaptive trailing stop: tightens as profit grows
        5. Time exit: max holding period
        """
        price = market_data.get("price", 0)
        sma_200 = market_data.get("sma_200", 0)
        pnl_pct = position.get("pnl_pct", 0)
        days_held = position.get("days_held", 0)
        entry_price = position.get("entry_price", price)
        highest_price = position.get("highest_price", price)

        closes = market_data.get("closes", [])
        highs = market_data.get("highs", closes)
        lows = market_data.get("lows", closes)

        # Track the high-water mark for trailing stop
        if price > highest_price:
            highest_price = price

        # 1. Hard stop from original trade
        original_stop = position.get("stop_loss", 0)
        if original_stop > 0 and price <= original_stop:
            return {"action": "close", "reason": f"Hard stop hit at ${original_stop:.2f}"}

        # 2. Trend exit: price crosses below 200-day SMA
        if sma_200 > 0 and price < sma_200:
            return {"action": "close", "reason": "Price crossed below 200-day SMA (trend reversal)"}

        # 3. EMA death cross exit
        if len(closes) >= self.EMA_SLOW:
            ema_50 = self._ema(closes, self.EMA_FAST)
            ema_200 = self._ema(closes, self.EMA_SLOW)
            if ema_50 < ema_200:
                return {"action": "close",
                        "reason": f"EMA death cross: EMA-50 ({ema_50:.2f}) < EMA-200 ({ema_200:.2f})"}

        # 4. Adaptive trailing stop
        # - In profit < 10%: use 2.5x ATR trailing from high-water mark
        # - In profit 10-20%: tighten to 2.0x ATR
        # - In profit > 20%: tighten to 1.5x ATR (lock in gains)
        atr = 0.0
        if len(closes) >= self.ATR_PERIOD + 1 and len(highs) >= self.ATR_PERIOD + 1:
            atr = self._compute_atr(closes, highs, lows, self.ATR_PERIOD)

        if atr > 0:
            if pnl_pct > 20:
                trail_mult = 1.5
            elif pnl_pct > 10:
                trail_mult = 2.0
            else:
                trail_mult = self.TRAILING_ATR_MULT

            trailing_stop = highest_price - trail_mult * atr
            if price <= trailing_stop:
                return {"action": "close",
                        "reason": (f"Adaptive trailing stop hit: "
                                   f"${trailing_stop:.2f} ({trail_mult}x ATR "
                                   f"from HWM ${highest_price:.2f}), "
                                   f"P&L {pnl_pct:+.1f}%")}
        else:
            # Fallback: percentage-based trailing stop
            if pnl_pct <= -8:
                return {"action": "close",
                        "reason": f"Percentage stop hit ({pnl_pct:.1f}%)"}

        # 5. Time exit
        if days_held > 60:
            if pnl_pct > 5:
                return {"action": "close",
                        "reason": f"Max hold reached (60 days), locking in {pnl_pct:+.1f}% gain"}
            return {"action": "close", "reason": "Max holding period reached (60 days)"}

        # Hold -- update highest_price in the returned dict for next check
        return {
            "action": "hold",
            "reason": f"Trend intact, above 200-day SMA. P&L {pnl_pct:+.1f}%, day {days_held}/60",
            "highest_price": highest_price,
        }
