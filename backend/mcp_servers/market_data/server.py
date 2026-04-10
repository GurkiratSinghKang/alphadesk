from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import httpx

from core.config import settings
from core.redis import cache_get, cache_set
from mcp_servers.base import BaseMCPServer


class MarketDataServer(BaseMCPServer):
    """MCP server for market data via Polygon.io API."""

    name = "market_data"

    def _api_key(self) -> str:
        return settings.POLYGON_API_KEY.get_secret_value()

    @BaseMCPServer.tool("get_quote", "Fetch the latest quote for a ticker symbol", {"symbol": {"type": "string"}})
    async def get_quote(self, symbol: str) -> dict[str, Any]:
        symbol = symbol.upper()
        cached = await cache_get(f"quote:{symbol}")
        if cached:
            return cached

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.polygon.io/v3/quotes/{symbol}",
                params={"limit": 1, "apiKey": self._api_key()},
            )
            data = resp.json()

        result = data.get("results", [{}])[0]
        quote = {
            "symbol": symbol,
            "bid": result.get("bid_price", 0),
            "ask": result.get("ask_price", 0),
            "bid_size": result.get("bid_size", 0),
            "ask_size": result.get("ask_size", 0),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await cache_set(f"quote:{symbol}", quote, ttl_seconds=5)
        return quote

    @BaseMCPServer.tool(
        "get_bars",
        "Fetch OHLCV bars for a symbol",
        {
            "symbol": {"type": "string"},
            "timeframe": {"type": "string", "description": "1min, 5min, 1h, 1d, 1w"},
            "start_date": {"type": "string", "description": "YYYY-MM-DD"},
            "end_date": {"type": "string", "description": "YYYY-MM-DD", "optional": True},
            "limit": {"type": "integer", "optional": True},
        },
    )
    async def get_bars(
        self,
        symbol: str,
        timeframe: str = "1d",
        start_date: str = "",
        end_date: str = "",
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        symbol = symbol.upper()
        tf_map = {
            "1min": ("minute", 1), "5min": ("minute", 5), "15min": ("minute", 15),
            "1h": ("hour", 1), "4h": ("hour", 4), "1d": ("day", 1), "1w": ("week", 1),
        }
        span, mult = tf_map.get(timeframe, ("day", 1))

        if not start_date:
            from datetime import timedelta
            start_date = (date.today() - timedelta(days=365)).isoformat()
        if not end_date:
            end_date = date.today().isoformat()

        url = f"https://api.polygon.io/v2/aggs/ticker/{symbol}/range/{mult}/{span}/{start_date}/{end_date}"

        async with httpx.AsyncClient() as client:
            resp = await client.get(url, params={
                "adjusted": "true", "sort": "asc", "limit": limit,
                "apiKey": self._api_key(),
            })
            data = resp.json()

        return [
            {
                "timestamp": datetime.fromtimestamp(r["t"] / 1000, tz=timezone.utc).isoformat(),
                "open": r["o"], "high": r["h"], "low": r["l"], "close": r["c"],
                "volume": r["v"], "vwap": r.get("vw"),
            }
            for r in data.get("results", [])
        ]

    @BaseMCPServer.tool("get_snapshot", "Fetch full market snapshot for a ticker", {"symbol": {"type": "string"}})
    async def get_snapshot(self, symbol: str) -> dict[str, Any]:
        symbol = symbol.upper()
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/{symbol}",
                params={"apiKey": self._api_key()},
            )
            data = resp.json().get("ticker", {})

        return {
            "symbol": symbol,
            "day": data.get("day", {}),
            "prev_day": data.get("prevDay", {}),
            "last_trade": data.get("lastTrade", {}),
            "last_quote": data.get("lastQuote", {}),
            "min": data.get("min", {}),
            "change_pct": data.get("todaysChangePerc", 0),
        }

    @BaseMCPServer.tool(
        "get_ticker_details",
        "Fetch fundamental details for a ticker (name, sector, market cap, etc.)",
        {"symbol": {"type": "string"}},
    )
    async def get_ticker_details(self, symbol: str) -> dict[str, Any]:
        symbol = symbol.upper()
        cached = await cache_get(f"details:{symbol}")
        if cached:
            return cached

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.polygon.io/v3/reference/tickers/{symbol}",
                params={"apiKey": self._api_key()},
            )
            data = resp.json().get("results", {})

        details = {
            "symbol": symbol,
            "name": data.get("name", ""),
            "market_cap": data.get("market_cap"),
            "sector": data.get("sic_description", ""),
            "locale": data.get("locale", ""),
            "primary_exchange": data.get("primary_exchange", ""),
            "share_class_shares_outstanding": data.get("share_class_shares_outstanding"),
            "weighted_shares_outstanding": data.get("weighted_shares_outstanding"),
        }
        await cache_set(f"details:{symbol}", details, ttl_seconds=3600)
        return details

    @BaseMCPServer.tool("get_market_status", "Check if markets are currently open or closed")
    async def get_market_status(self) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://api.polygon.io/v1/marketstatus/now",
                params={"apiKey": self._api_key()},
            )
            return resp.json()

    @BaseMCPServer.tool(
        "get_related_companies",
        "Find companies related to a given ticker",
        {"symbol": {"type": "string"}},
    )
    async def get_related_companies(self, symbol: str) -> list[dict[str, Any]]:
        symbol = symbol.upper()
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.polygon.io/v1/related-companies/{symbol}",
                params={"apiKey": self._api_key()},
            )
            data = resp.json()
        return data.get("results", [])
