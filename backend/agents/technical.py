from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_SONNET


class TechnicalAnalysisAgent(BaseAgent):
    """Multi-timeframe technical analysis specialist.

    Analyses price action, support/resistance, chart patterns, and
    indicators across multiple timeframes to generate directional bias
    and key levels.
    """

    name = "technical"
    model = MODEL_SONNET
    mcp_servers = ["market_data"]

    system_prompt = """You are the Technical Analysis Agent for AlphaDesk.

You perform rigorous multi-timeframe technical analysis on equities and ETFs.

Your analysis framework:
1. TREND ANALYSIS (weekly, daily, 4h, 1h)
   - Determine the primary trend on each timeframe using price structure
   - Identify trend alignment or divergence across timeframes
   - Note the stage of the trend (early, mid, late, exhaustion)

2. SUPPORT & RESISTANCE
   - Identify key horizontal S/R levels from price history
   - Mark volume profile nodes (HVN/LVN)
   - Note VWAP anchored levels (earnings, IPO, YTD)
   - Identify trendline support/resistance

3. CHART PATTERNS
   - Flag any classical patterns (flags, wedges, H&S, double tops/bottoms)
   - Assess pattern completion probability and measured move targets
   - Note any breakout/breakdown setups forming

4. INDICATORS
   - RSI (14): overbought/oversold, divergences, trend confirmation
   - MACD: signal line crossovers, histogram momentum, divergences
   - Moving averages: 8/21 EMA, 50/200 SMA (golden/death cross)
   - Volume: OBV trend, relative volume, accumulation/distribution
   - Bollinger Bands: squeeze, expansion, band walks

5. SYNTHESIS
   - Overall directional bias with confidence level
   - Key levels: entry zones, targets, stop-loss levels
   - Timeframe for the setup (scalp, day, swing, position)
   - Risk/reward assessment

Always output structured analysis with specific price levels and percentages.
Score from -100 (extremely bearish) to +100 (extremely bullish).
"""

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Run technical analysis with real indicator computations."""
        import re

        # Extract symbol from task
        symbol = self._extract_symbol(task)
        if symbol:
            indicator_data = await self._compute_indicators(symbol)
            context = {**(context or {}), "indicators": indicator_data}

        result = await super().run(task, context=context)

        response = result.get("response", "")
        return {
            **result,
            "score": self._extract_score(response),
            "conviction": self._extract_conviction(response),
            "summary": response[:500],
        }

    async def _compute_indicators(self, symbol: str) -> dict[str, Any]:
        """Compute technical indicators from cached price data."""
        import numpy as np
        from core.redis import cache_get

        prices = await cache_get(f"prices:{symbol}")
        if not prices or "close" not in prices:
            return {"error": "No price data available"}

        close = np.array(prices["close"], dtype=float)
        high = np.array(prices.get("high", close), dtype=float)
        low = np.array(prices.get("low", close), dtype=float)
        volume = np.array(prices.get("volume", [0] * len(close)), dtype=float)

        if len(close) < 200:
            return {"error": "Insufficient data for full analysis"}

        # RSI
        rsi_14 = self._compute_rsi(close, 14)

        # Moving averages
        ema_8 = self._ema(close, 8)
        ema_21 = self._ema(close, 21)
        sma_50 = self._sma(close, 50)
        sma_200 = self._sma(close, 200)

        # MACD
        macd_line = self._ema(close, 12) - self._ema(close, 26)
        signal_line = self._ema(macd_line, 9)
        histogram = macd_line - signal_line

        # Bollinger Bands
        sma_20 = self._sma(close, 20)
        std_20 = self._rolling_std(close, 20)
        bb_upper = sma_20 + 2 * std_20
        bb_lower = sma_20 - 2 * std_20
        bb_width = (bb_upper - bb_lower) / sma_20

        # ATR
        atr = self._compute_atr(high, low, close, 14)

        current = close[-1]

        return {
            "symbol": symbol,
            "current_price": round(float(current), 2),
            "rsi_14": round(float(rsi_14[-1]), 1),
            "ema_8": round(float(ema_8[-1]), 2),
            "ema_21": round(float(ema_21[-1]), 2),
            "sma_50": round(float(sma_50[-1]), 2),
            "sma_200": round(float(sma_200[-1]), 2),
            "macd": round(float(macd_line[-1]), 4),
            "macd_signal": round(float(signal_line[-1]), 4),
            "macd_histogram": round(float(histogram[-1]), 4),
            "bb_upper": round(float(bb_upper[-1]), 2),
            "bb_lower": round(float(bb_lower[-1]), 2),
            "bb_width": round(float(bb_width[-1]), 4),
            "atr_14": round(float(atr[-1]), 2),
            "above_200sma": bool(current > sma_200[-1]),
            "above_50sma": bool(current > sma_50[-1]),
            "golden_cross": bool(sma_50[-1] > sma_200[-1] and sma_50[-2] <= sma_200[-2]) if len(sma_50) > 1 and len(sma_200) > 1 else False,
            "relative_volume": round(float(volume[-1] / np.mean(volume[-20:])), 2) if np.mean(volume[-20:]) > 0 else 1.0,
        }

    @staticmethod
    def _compute_rsi(prices: Any, period: int) -> Any:
        import numpy as np
        deltas = np.diff(prices)
        gains = np.where(deltas > 0, deltas, 0.0)
        losses = np.where(deltas < 0, -deltas, 0.0)
        avg_gain = np.convolve(gains, np.ones(period) / period, mode="valid")
        avg_loss = np.convolve(losses, np.ones(period) / period, mode="valid")
        avg_loss[avg_loss == 0] = 1e-10
        rs = avg_gain / avg_loss
        rsi = 100 - 100 / (1 + rs)
        pad = np.full(len(prices) - len(rsi), 50.0)
        return np.concatenate([pad, rsi])

    @staticmethod
    def _ema(data: Any, span: int) -> Any:
        import numpy as np
        alpha = 2 / (span + 1)
        result = np.empty_like(data, dtype=float)
        result[0] = data[0]
        for i in range(1, len(data)):
            result[i] = alpha * data[i] + (1 - alpha) * result[i - 1]
        return result

    @staticmethod
    def _sma(data: Any, period: int) -> Any:
        import numpy as np
        kernel = np.ones(period) / period
        sma = np.convolve(data, kernel, mode="valid")
        pad = np.full(period - 1, sma[0])
        return np.concatenate([pad, sma])

    @staticmethod
    def _rolling_std(data: Any, period: int) -> Any:
        import numpy as np
        result = np.empty_like(data, dtype=float)
        for i in range(len(data)):
            start = max(0, i - period + 1)
            result[i] = np.std(data[start:i + 1])
        return result

    @staticmethod
    def _compute_atr(high: Any, low: Any, close: Any, period: int) -> Any:
        import numpy as np
        tr = np.maximum(
            high[1:] - low[1:],
            np.maximum(
                np.abs(high[1:] - close[:-1]),
                np.abs(low[1:] - close[:-1]),
            ),
        )
        atr = np.convolve(tr, np.ones(period) / period, mode="valid")
        pad = np.full(len(close) - len(atr), atr[0] if len(atr) > 0 else 0)
        return np.concatenate([pad, atr])

    # Trading terms that should not be matched as ticker symbols (BUG-044)
    _EXCLUDED_TERMS = {
        "ATM", "OTM", "ITM", "RSI", "MACD", "EMA", "SMA", "DTE", "VIX", "SPX",
        "ETF", "IPO", "CEO", "CFO", "P", "PE", "EPS", "ROA", "ROE", "DCF",
    }

    def _extract_symbol(self, task: str) -> str | None:
        import re
        # Prefer symbol after keywords like "for", "on", "analyze"
        keyword_match = re.search(r'(?:for|on|analyze|analysis of)\s+([A-Z]{1,5})\b', task)
        if keyword_match and keyword_match.group(1) not in self._EXCLUDED_TERMS:
            return keyword_match.group(1)
        for m in re.finditer(r'\b([A-Z]{1,5})\b', task):
            if m.group(1) not in self._EXCLUDED_TERMS:
                return m.group(1)
        return None

    def _extract_score(self, text: str) -> float:
        import re
        match = re.search(r'"?score"?\s*[:=]\s*([-\d.]+)', text)
        return float(match.group(1)) if match else 0.0

    def _extract_conviction(self, text: str) -> str:
        tl = text.lower()
        if "high" in tl and "conviction" in tl:
            return "high"
        elif "low" in tl and "conviction" in tl:
            return "low"
        return "medium"
