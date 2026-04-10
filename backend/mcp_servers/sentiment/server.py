from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from core.config import settings
from core.redis import cache_get, cache_set
from mcp_servers.base import BaseMCPServer


class SentimentServer(BaseMCPServer):
    """MCP server for sentiment data (options flow, news, social)."""

    name = "sentiment"

    @BaseMCPServer.tool("get_unusual_options_activity", "Fetch unusual options activity for a symbol", {"symbol": {"type": "string"}})
    async def get_unusual_options_activity(self, symbol: str) -> list[dict[str, Any]]:
        """Fetch unusual options activity from Unusual Whales or similar provider."""
        symbol = symbol.upper()
        cache_key = f"unusual_activity:{symbol}"
        cached = await cache_get(cache_key)
        if cached:
            return cached

        api_key = settings.UNUSUAL_WHALES_API_KEY.get_secret_value()
        if not api_key:
            return [{"note": "Unusual Whales API key not configured"}]

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.unusualwhales.com/api/stock/{symbol}/options-activity",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if resp.status_code != 200:
                return [{"error": f"API returned {resp.status_code}"}]
            data = resp.json().get("data", [])

        results = [
            {
                "contract": item.get("option_symbol", ""),
                "type": item.get("put_call", ""),
                "strike": item.get("strike_price", 0),
                "expiry": item.get("expiry", ""),
                "volume": item.get("volume", 0),
                "open_interest": item.get("open_interest", 0),
                "vol_oi_ratio": round(item.get("volume", 0) / max(item.get("open_interest", 1), 1), 2),
                "premium": item.get("total_premium", 0),
                "side": item.get("sentiment", "neutral"),
                "timestamp": item.get("timestamp", ""),
            }
            for item in data[:20]
        ]

        await cache_set(cache_key, results, ttl_seconds=300)
        return results

    @BaseMCPServer.tool("get_put_call_ratio", "Get put/call ratio data for a symbol or index", {"symbol": {"type": "string"}})
    async def get_put_call_ratio(self, symbol: str) -> dict[str, Any]:
        symbol = symbol.upper()
        cached = await cache_get(f"pcr:{symbol}")
        if cached:
            return cached

        # Compute from options chain data
        chain = await cache_get(f"chain:{symbol}:all")
        if not chain:
            return {"symbol": symbol, "put_call_ratio": None, "note": "No chain data available"}

        contracts = chain.get("contracts", [])
        put_vol = sum(c.get("volume", 0) for c in contracts if c.get("option_type") == "put")
        call_vol = sum(c.get("volume", 0) for c in contracts if c.get("option_type") == "call")

        pcr = round(put_vol / call_vol, 3) if call_vol > 0 else None

        result = {
            "symbol": symbol,
            "put_call_ratio": pcr,
            "put_volume": put_vol,
            "call_volume": call_vol,
            "total_volume": put_vol + call_vol,
            "interpretation": (
                "bearish" if pcr and pcr > 1.2 else
                "bullish" if pcr and pcr < 0.7 else
                "neutral"
            ) if pcr else "unknown",
        }

        await cache_set(f"pcr:{symbol}", result, ttl_seconds=300)
        return result

    @BaseMCPServer.tool("get_news_sentiment", "Fetch recent news with sentiment scores", {"symbol": {"type": "string"}, "limit": {"type": "integer", "optional": True}})
    async def get_news_sentiment(self, symbol: str, limit: int = 10) -> list[dict[str, Any]]:
        symbol = symbol.upper()
        cached = await cache_get(f"news:{symbol}")
        if cached:
            return cached[:limit]

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.polygon.io/v2/reference/news",
                params={
                    "ticker": symbol,
                    "limit": limit,
                    "order": "desc",
                    "apiKey": settings.POLYGON_API_KEY.get_secret_value(),
                },
            )
            data = resp.json()

        results = [
            {
                "title": article.get("title", ""),
                "author": article.get("author", ""),
                "published": article.get("published_utc", ""),
                "url": article.get("article_url", ""),
                "tickers": article.get("tickers", []),
                "sentiment": (article.get("insights") or [{}])[0].get("sentiment", "neutral"),
                "sentiment_score": (article.get("insights") or [{}])[0].get("sentiment_reasoning", ""),
            }
            for article in data.get("results", [])
        ]

        await cache_set(f"news:{symbol}", results, ttl_seconds=300)
        return results

    @BaseMCPServer.tool("get_social_sentiment", "Get aggregated social media sentiment for a symbol", {"symbol": {"type": "string"}})
    async def get_social_sentiment(self, symbol: str) -> dict[str, Any]:
        """Aggregate social sentiment from cached social data feeds."""
        symbol = symbol.upper()
        cached = await cache_get(f"social:{symbol}")
        if cached:
            return cached

        # In production, this aggregates from StockTwits, Reddit, Twitter APIs.
        return {
            "symbol": symbol,
            "overall_sentiment": "neutral",
            "score": 0,
            "sources": {
                "stocktwits": {"sentiment": "neutral", "message_volume": 0},
                "reddit": {"sentiment": "neutral", "mention_count": 0},
            },
            "note": "Social sentiment feeds will be integrated in production",
        }

    @BaseMCPServer.tool("get_dark_pool_activity", "Fetch dark pool and short volume data", {"symbol": {"type": "string"}})
    async def get_dark_pool_activity(self, symbol: str) -> dict[str, Any]:
        symbol = symbol.upper()
        cached = await cache_get(f"darkpool:{symbol}")
        if cached:
            return cached

        return {
            "symbol": symbol,
            "short_volume": None,
            "short_volume_ratio": None,
            "dark_pool_volume": None,
            "dark_pool_pct": None,
            "note": "Dark pool data requires FINRA/Unusual Whales integration",
        }
