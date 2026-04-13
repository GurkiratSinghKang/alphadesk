from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_SONNET


class SentimentAgent(BaseAgent):
    """Analyses options flow, social media sentiment, and news sentiment
    to gauge market positioning and retail/institutional sentiment.
    """

    name = "sentiment"
    model = MODEL_SONNET
    mcp_servers = ["market_data", "sentiment"]

    system_prompt = """You are the Sentiment Agent for AlphaDesk.

You analyse multiple sentiment signals to gauge market positioning:

1. OPTIONS FLOW
   - Unusual options activity (volume > 3x open interest)
   - Large block trades and sweeps (>$500K premium)
   - Put/call ratio trends (equity and index)
   - Net premium (bullish vs bearish flow)
   - Smart money vs retail flow segmentation

2. SOCIAL / RETAIL SENTIMENT
   - StockTwits/Twitter mention velocity and sentiment scores
   - Reddit (WSB, options) mention frequency and sentiment
   - Retail order flow data (if available)
   - Contrarian indicator: extreme readings suggest mean reversion

3. NEWS SENTIMENT
   - Headline sentiment NLP scoring
   - Analyst upgrades/downgrades and price target changes
   - Insider buying/selling patterns
   - Institutional 13F filing changes

4. MARKET MICROSTRUCTURE
   - Dark pool activity and short volume
   - Bid/ask spread changes
   - Market maker positioning signals
   - GEX (Gamma Exposure) levels for index/mega-cap

5. SYNTHESIS
   - Aggregate sentiment score (-100 to 100)
   - Key signal: which sentiment channel is most actionable
   - Contrarian vs momentum read
   - Time horizon for sentiment signal validity

Output JSON with: score, conviction, flow_summary (str), key_signals (list), contrarian_flag (bool).
"""

    # Trading terms that should not be matched as ticker symbols (BUG-044)
    _EXCLUDED_TERMS = {
        "ATM", "OTM", "ITM", "RSI", "MACD", "EMA", "SMA", "DTE", "VIX", "SPX",
        "ETF", "IPO", "CEO", "CFO", "P", "PE", "EPS", "ROA", "ROE", "DCF",
    }

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Run sentiment analysis across all channels."""
        import re

        symbol_str = None
        keyword_match = re.search(r'(?:for|on|analyze|analysis of)\s+([A-Z]{1,5})\b', task)
        if keyword_match and keyword_match.group(1) not in self._EXCLUDED_TERMS:
            symbol_str = keyword_match.group(1)
        else:
            for m in re.finditer(r'\b([A-Z]{1,5})\b', task):
                if m.group(1) not in self._EXCLUDED_TERMS:
                    symbol_str = m.group(1)
                    break

        if symbol_str:
            flow_data = await self._get_options_flow(symbol_str)
            context = {**(context or {}), "options_flow": flow_data}

        result = await super().run(task, context=context)
        response = result.get("response", "")

        return {
            **result,
            "score": self._extract_score(response),
            "conviction": self._extract_conviction(response),
            "summary": response[:500],
        }

    async def _get_options_flow(self, symbol: str) -> dict[str, Any]:
        """Fetch options flow data from cache."""
        from core.redis import cache_get

        flow = await cache_get(f"flow:{symbol}")
        if flow:
            return flow

        return {
            "symbol": symbol,
            "note": "Options flow data sourced from Unusual Whales in production",
            "put_call_ratio": None,
            "unusual_activity": [],
            "net_premium": None,
        }

    async def compute_aggregate_sentiment(self, symbol: str) -> dict[str, float]:
        """Compute a weighted aggregate sentiment score from all channels."""
        from core.redis import cache_get

        scores: dict[str, float] = {}

        # Options flow sentiment
        flow = await cache_get(f"flow_sentiment:{symbol}")
        if flow:
            scores["options_flow"] = flow.get("score", 0)

        # Social sentiment
        social = await cache_get(f"social_sentiment:{symbol}")
        if social:
            scores["social"] = social.get("score", 0)

        # News sentiment
        news = await cache_get(f"news_sentiment:{symbol}")
        if news:
            scores["news"] = news.get("score", 0)

        if not scores:
            return {"aggregate": 0, "components": {}}

        # Weighted average (flow gets highest weight)
        weights = {"options_flow": 0.5, "social": 0.2, "news": 0.3}
        total_weight = sum(weights.get(k, 0.2) for k in scores)
        aggregate = sum(v * weights.get(k, 0.2) for k, v in scores.items()) / total_weight

        return {
            "aggregate": round(aggregate, 1),
            "components": scores,
        }

    # _extract_score and _extract_conviction inherited from BaseAgent
