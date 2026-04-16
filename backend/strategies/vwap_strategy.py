"""VWAP Strategy (Berkowitz, Logue & Noser 1988 / Madhavan 2002).

Uses Volume Weighted Average Price as dynamic support/resistance.
Enters on VWAP bounce (pullback to VWAP in trending markets) or
VWAP deviation band breakout. VWAP is the institutional benchmark --
price above VWAP signals buying pressure, below signals selling.

Enhanced features:
- Intraday VWAP from 5-min bars when available (falls back to daily proxy)
- Anchored VWAP from significant events (earnings, breakout days)
- VWAP slope detection: rising = bullish, falling = bearish
- Bullish candlestick confirmation on bounce (hammer / engulfing)
- Multi-timeframe VWAP alignment (daily + weekly)
- Adaptive position sizing on 2nd/3rd successful VWAP test

Academic source: Berkowitz, Logue & Noser "The Total Cost of Transactions
on the NYSE" (1988) -- established VWAP as institutional benchmark.
Madhavan (2002) "VWAP Strategies", Trading. Also backed by
microstructure theory on informed vs. noise trading.
"""
from __future__ import annotations

import math
from typing import Any

from strategies.base import BaseStrategy


def _compute_vwap_bands(
    closes: list[float],
    highs: list[float],
    lows: list[float],
    volumes: list[int],
    band_mult: float = 2.0,
) -> tuple[float, float, float]:
    """Compute VWAP and deviation bands.

    VWAP = sum(typical_price * volume) / sum(volume)
    Bands = VWAP +/- mult * std_dev(typical_price - VWAP, vol-weighted)

    Returns (vwap, upper_band, lower_band).
    """
    if not closes or not volumes:
        return 0, 0, 0

    n = len(closes)
    cum_tpv = 0.0
    cum_vol = 0
    typical_prices = []

    for i in range(n):
        tp = (highs[i] + lows[i] + closes[i]) / 3
        typical_prices.append(tp)
        cum_tpv += tp * volumes[i]
        cum_vol += volumes[i]

    vwap = cum_tpv / cum_vol if cum_vol > 0 else closes[-1]

    # Volume-weighted standard deviation
    cum_sq_dev = 0.0
    for i in range(n):
        cum_sq_dev += volumes[i] * (typical_prices[i] - vwap) ** 2

    std_dev = math.sqrt(cum_sq_dev / cum_vol) if cum_vol > 0 else 0
    upper = vwap + band_mult * std_dev
    lower = vwap - band_mult * std_dev

    return vwap, upper, lower


def _compute_vwap_slope(
    closes: list[float],
    highs: list[float],
    lows: list[float],
    volumes: list[int],
    lookback: int = 5,
) -> float:
    """Compute VWAP slope as the per-bar change over *lookback* bars.

    Positive = rising VWAP (bullish), negative = falling (bearish).
    Returns the slope normalised as a percentage of current VWAP.
    """
    if len(closes) < lookback + 2 or len(volumes) < lookback + 2:
        return 0.0

    def _vwap_at(end_idx: int, window: int = 10) -> float:
        start = max(0, end_idx - window)
        cum_tpv = 0.0
        cum_vol = 0
        for j in range(start, end_idx):
            tp = (highs[j] + lows[j] + closes[j]) / 3
            cum_tpv += tp * volumes[j]
            cum_vol += volumes[j]
        return cum_tpv / cum_vol if cum_vol > 0 else closes[end_idx - 1]

    n = len(closes)
    vwap_now = _vwap_at(n, min(10, n))
    vwap_prev = _vwap_at(n - lookback, min(10, n - lookback))

    if vwap_prev == 0:
        return 0.0
    return ((vwap_now - vwap_prev) / vwap_prev) * 100


def _is_hammer(open_p: float, high: float, low: float, close: float) -> bool:
    """Detect a hammer candlestick pattern.

    Hammer: small real body near the top, long lower shadow (>= 2x body).
    """
    body = abs(close - open_p)
    candle_range = high - low
    if candle_range == 0:
        return False
    lower_shadow = min(open_p, close) - low
    upper_shadow = high - max(open_p, close)
    return (lower_shadow >= 2 * body
            and upper_shadow < body * 0.5
            and body / candle_range < 0.35)


def _is_bullish_engulfing(
    prev_open: float, prev_close: float,
    curr_open: float, curr_close: float,
) -> bool:
    """Detect a bullish engulfing pattern (2-bar).

    Previous bar is bearish (close < open), current bar is bullish
    (close > open) and its body fully engulfs the previous bar's body.
    """
    prev_bearish = prev_close < prev_open
    curr_bullish = curr_close > curr_open
    engulfs = curr_open <= prev_close and curr_close >= prev_open
    return prev_bearish and curr_bullish and engulfs


def _compute_anchored_vwap(
    closes: list[float],
    highs: list[float],
    lows: list[float],
    volumes: list[int],
    anchor_idx: int,
) -> float:
    """Compute VWAP anchored from a specific bar index to the end."""
    if anchor_idx < 0 or anchor_idx >= len(closes):
        return 0.0
    cum_tpv = 0.0
    cum_vol = 0
    for i in range(anchor_idx, len(closes)):
        tp = (highs[i] + lows[i] + closes[i]) / 3
        cum_tpv += tp * volumes[i]
        cum_vol += volumes[i]
    return cum_tpv / cum_vol if cum_vol > 0 else closes[-1]


def _find_anchor_index(
    closes: list[float],
    volumes: list[int],
    highs: list[float],
    lows: list[float],
) -> int | None:
    """Find the most recent significant event bar for anchored VWAP.

    Looks for bars with either:
    - Volume spike > 3x the 20-day average (earnings-like event)
    - Range breakout: close above the prior 20-bar high on above-average volume
    Returns the index or None if no significant event found in last 60 bars.
    """
    n = len(closes)
    if n < 25:
        return None

    lookback = min(60, n)
    avg_vol_20 = sum(volumes[max(0, n - 25): n - 5]) / 20 if n > 25 else 1

    for i in range(n - 5, max(n - lookback, 20), -1):
        # Volume spike (earnings-like)
        if avg_vol_20 > 0 and volumes[i] > 3 * avg_vol_20:
            return i
        # Range breakout: close above prior 20-bar high
        prior_high = max(highs[max(0, i - 20): i])
        if closes[i] > prior_high and volumes[i] > 1.5 * avg_vol_20:
            return i

    return None


class VWAPStrategy(BaseStrategy):
    """VWAP bounce and deviation band strategy with enhanced filters."""

    name = "vwap_strategy"
    description = (
        "VWAP-based entries: buys on pullback to VWAP in uptrends (bounce) "
        "or on breakout above upper VWAP deviation band. Enhanced with "
        "intraday VWAP, anchored VWAP, slope detection, candlestick "
        "confirmation, multi-timeframe alignment, and adaptive sizing."
    )
    default_timeframe = "day"

    # Parameters
    BAND_MULT = 2.0             # deviation band multiplier
    BOUNCE_THRESHOLD_PCT = 0.3  # within 0.3% of VWAP = bounce zone
    TREND_SMA = 20              # 20-day SMA for trend filter
    MIN_VOL_RATIO = 1.2         # volume must be 1.2x average
    MAX_HOLD_DAYS = 5           # 5-day max hold
    RISK_PER_TRADE = 0.012      # 1.2% risk per trade
    BOUNCE_SIZE_MULT_2ND = 1.25  # 25% more size on 2nd successful test
    BOUNCE_SIZE_MULT_3RD = 1.50  # 50% more size on 3rd successful test

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Screen for liquid stocks trading near VWAP."""
        candidates = []
        for t in universe:
            if (t.get("avg_volume", 0) or 0) < 1_000_000:
                continue
            if (t.get("market_cap", 0) or 0) < 2_000_000_000:
                continue
            candidates.append(t)
        candidates.sort(key=lambda x: x.get("avg_volume", 0) or 0, reverse=True)
        return candidates[:40]

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Compute VWAP, bands, and detect bounce/breakout signals.

        Enhanced with intraday VWAP, anchored VWAP, slope detection,
        candlestick confirmation, and multi-timeframe alignment.
        """
        price = data.get("price", 0) or data.get("current_price", 0)
        closes = data.get("closes", [])
        highs = data.get("highs", closes[:])
        lows = data.get("lows", closes[:])
        volumes = data.get("volumes", [1] * len(closes))
        opens = data.get("opens", closes[:])

        if len(closes) < 20:
            return {"symbol": symbol, "score": 0, "conviction": "low",
                    "signal": "no_data"}

        # ---- IMPROVEMENT 1: Use intraday bars for VWAP when available ----
        intraday_closes = data.get("intraday_closes", [])
        intraday_highs = data.get("intraday_highs", [])
        intraday_lows = data.get("intraday_lows", [])
        intraday_volumes = data.get("intraday_volumes", [])

        if (len(intraday_closes) >= 10
                and len(intraday_highs) >= 10
                and len(intraday_lows) >= 10
                and len(intraday_volumes) >= 10):
            # True intraday VWAP from 5-min bars
            vwap, upper_band, lower_band = _compute_vwap_bands(
                intraday_closes, intraday_highs, intraday_lows,
                intraday_volumes, self.BAND_MULT,
            )
            vwap_source = "intraday"
        else:
            # Fall back to daily bars as proxy
            vwap, upper_band, lower_band = _compute_vwap_bands(
                closes[-20:], highs[-20:], lows[-20:], volumes[-20:],
                self.BAND_MULT,
            )
            vwap_source = "daily_proxy"

        # ---- IMPROVEMENT 2: Anchored VWAP from significant events ----
        anchor_idx = _find_anchor_index(closes, volumes, highs, lows)
        anchored_vwap = 0.0
        if anchor_idx is not None:
            anchored_vwap = _compute_anchored_vwap(
                closes, highs, lows, volumes, anchor_idx,
            )

        # ---- IMPROVEMENT 3: VWAP slope detection ----
        vwap_slope = _compute_vwap_slope(closes, highs, lows, volumes, lookback=5)
        vwap_rising = vwap_slope > 0.05   # > +0.05% per bar
        vwap_falling = vwap_slope < -0.05

        # ---- IMPROVEMENT 5: Multi-timeframe VWAP (weekly proxy) ----
        # Compute a longer-period VWAP as weekly proxy (last 5 trading days)
        weekly_window = min(len(closes), 5)
        weekly_vwap, _, _ = _compute_vwap_bands(
            closes[-weekly_window:], highs[-weekly_window:],
            lows[-weekly_window:], volumes[-weekly_window:],
            self.BAND_MULT,
        )
        # Price above both daily and weekly VWAP = strong alignment
        daily_weekly_aligned = price > vwap and price > weekly_vwap

        # Trend filter: 20-day SMA
        sma20 = sum(closes[-20:]) / 20
        uptrend = price > sma20
        downtrend = price < sma20

        # Volume confirmation
        avg_vol = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else 1
        vol_ratio = volumes[-1] / avg_vol if avg_vol > 0 else 1.0
        vol_confirm = vol_ratio >= self.MIN_VOL_RATIO

        # Distance from VWAP
        vwap_dist_pct = ((price - vwap) / vwap) * 100 if vwap > 0 else 0

        # ---- IMPROVEMENT 4: Candlestick confirmation on bounce ----
        candle_confirm = False
        if len(opens) >= 2 and len(highs) >= 2 and len(lows) >= 2 and len(closes) >= 2:
            # Check for hammer on the latest bar
            if _is_hammer(opens[-1], highs[-1], lows[-1], closes[-1]):
                candle_confirm = True
            # Check for bullish engulfing (2-bar pattern)
            if _is_bullish_engulfing(opens[-2], closes[-2], opens[-1], closes[-1]):
                candle_confirm = True

        # ---- Count prior successful VWAP bounces (for position sizing) ----
        vwap_bounce_count = data.get("vwap_bounce_count", 0)

        # Signal detection
        score = 0
        signal_type = "none"

        # 1. VWAP Bounce: price pulls back to VWAP in uptrend
        if uptrend and abs(vwap_dist_pct) < self.BOUNCE_THRESHOLD_PCT:
            score = min(80, 45 + (self.BOUNCE_THRESHOLD_PCT - abs(vwap_dist_pct)) * 100)
            if vol_confirm:
                score += 10
            # Candlestick confirmation bonus
            if candle_confirm:
                score += 8
            # VWAP slope bonus (rising VWAP = stronger support)
            if vwap_rising:
                score += 5
            elif vwap_falling:
                score -= 10  # falling VWAP = weaker bounce
            signal_type = "vwap_bounce"

        # 2. VWAP Breakout: price breaks above upper band with volume
        elif price > upper_band and vol_confirm and uptrend:
            breakout_dist = (price - upper_band) / upper_band * 100
            score = min(85, 50 + breakout_dist * 10)
            if vwap_rising:
                score += 5
            signal_type = "upper_band_breakout"

        # 3. VWAP Reclaim: price crosses back above VWAP from below
        elif len(closes) >= 2 and closes[-2] < vwap and closes[-1] > vwap and uptrend:
            score = min(70, 40 + vol_ratio * 5)
            if candle_confirm:
                score += 5
            signal_type = "vwap_reclaim"

        # Multi-timeframe alignment bonus
        if signal_type != "none" and daily_weekly_aligned:
            score += 5

        # Anchored VWAP confirmation: price above anchored VWAP = extra conviction
        if signal_type != "none" and anchored_vwap > 0 and price > anchored_vwap:
            score += 3

        score = max(0, min(100, score))
        conviction = "high" if score > 60 else "medium" if score > 40 else "low"

        return {
            "symbol": symbol,
            "score": round(score, 1),
            "conviction": conviction,
            "price": price,
            "vwap": round(vwap, 2),
            "upper_band": round(upper_band, 2),
            "lower_band": round(lower_band, 2),
            "vwap_dist_pct": round(vwap_dist_pct, 2),
            "sma20": round(sma20, 2),
            "uptrend": uptrend,
            "vol_ratio": round(vol_ratio, 2),
            "vol_confirm": vol_confirm,
            "signal_type": signal_type,
            # New fields
            "vwap_source": vwap_source,
            "anchored_vwap": round(anchored_vwap, 2),
            "vwap_slope": round(vwap_slope, 4),
            "vwap_rising": vwap_rising,
            "candle_confirm": candle_confirm,
            "weekly_vwap": round(weekly_vwap, 2),
            "daily_weekly_aligned": daily_weekly_aligned,
            "vwap_bounce_count": vwap_bounce_count,
        }

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        if analysis.get("signal") == "no_data":
            return None
        if analysis.get("signal_type") == "none":
            return None
        if analysis.get("score", 0) < 40:
            return None
        if not analysis.get("uptrend", False):
            return None

        return {
            "symbol": analysis["symbol"],
            "direction": "bullish",
            "strength": analysis["score"],
            "conviction": analysis["conviction"],
            "timeframe": "day",
            "holding_period_days": 3,
            "analysis": analysis,
        }

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        symbol = signal["symbol"]
        analysis = signal.get("analysis", {})
        equity = portfolio.get("equity", 100_000)
        price = analysis.get("price", 100)
        vwap = analysis.get("vwap", price)
        lower_band = analysis.get("lower_band", price * 0.98)
        signal_type = analysis.get("signal_type", "vwap_bounce")

        # Stop below VWAP (for bounce) or below lower band (for breakout)
        if signal_type == "vwap_bounce":
            stop_loss = round(vwap * 0.995, 2)  # just below VWAP
            take_profit = round(price + (price - stop_loss) * 2, 2)  # 2:1 R/R
        elif signal_type == "upper_band_breakout":
            stop_loss = round(vwap, 2)  # back to VWAP = failed breakout
            take_profit = round(price + (price - stop_loss) * 1.5, 2)
        else:  # vwap_reclaim
            stop_loss = round(lower_band, 2)
            take_profit = round(price + (price - stop_loss) * 2, 2)

        risk_per_share = max(0.01, price - stop_loss)
        risk_dollar = equity * self.RISK_PER_TRADE

        # ---- IMPROVEMENT 6: Adaptive sizing on repeated VWAP tests ----
        vwap_bounce_count = analysis.get("vwap_bounce_count", 0)
        size_mult = 1.0
        if signal_type == "vwap_bounce" and vwap_bounce_count >= 2:
            size_mult = self.BOUNCE_SIZE_MULT_3RD  # 3rd or later test
        elif signal_type == "vwap_bounce" and vwap_bounce_count == 1:
            size_mult = self.BOUNCE_SIZE_MULT_2ND  # 2nd test

        adjusted_risk = risk_dollar * size_mult
        shares = max(1, int(adjusted_risk / risk_per_share))

        notional = shares * price
        max_notional = equity * 0.06
        if notional > max_notional:
            shares = max(1, int(max_notional / price))
            notional = shares * price

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
                "vwap_cross_below": True,
                "lower_band_stop": True,
                "max_hold_days": self.MAX_HOLD_DAYS,
                "signal_type": signal_type,
            },
            # Metadata
            "size_multiplier": round(size_mult, 2),
            "vwap_bounce_count": vwap_bounce_count,
        }

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        price = market_data.get("price", 0)
        vwap = market_data.get("vwap", 0)
        lower_band = market_data.get("lower_band", 0)
        pnl_pct = position.get("pnl_pct", 0)
        days_held = position.get("days_held", 0)

        # Exit if price breaks below VWAP (support lost)
        if vwap > 0 and price < vwap * 0.995:
            return {"action": "close", "reason": "Price lost VWAP support"}

        # Exit if price breaks below lower band
        if lower_band > 0 and price < lower_band:
            return {"action": "close", "reason": "Price broke below VWAP lower band"}

        # Time stop
        if days_held >= self.MAX_HOLD_DAYS:
            return {"action": "close", "reason": f"Max hold period ({self.MAX_HOLD_DAYS} days)"}

        # Hard stop
        if pnl_pct <= -4:
            return {"action": "close", "reason": f"Hard stop ({pnl_pct:.1f}%)"}

        # Profit target
        if pnl_pct >= 6:
            return {"action": "close", "reason": f"Profit target ({pnl_pct:.1f}%)"}

        return {"action": "hold", "reason": "Price holding above VWAP"}
