from __future__ import annotations

from datetime import date, datetime
from typing import Any

import httpx
import numpy as np
from scipy.stats import norm

from core.config import settings
from core.redis import cache_get, cache_set
from mcp_servers.base import BaseMCPServer


class OptionsChainServer(BaseMCPServer):
    """MCP server for options data via Theta Data and Polygon fallback."""

    name = "options_chain"

    def _api_key(self) -> str:
        return settings.THETA_DATA_API_KEY.get_secret_value() or settings.POLYGON_API_KEY.get_secret_value()

    @BaseMCPServer.tool(
        "get_options_chain",
        "Fetch the full options chain for an underlying symbol",
        {
            "symbol": {"type": "string"},
            "expiry": {"type": "string", "description": "YYYY-MM-DD", "optional": True},
        },
    )
    async def get_options_chain(self, symbol: str, expiry: str | None = None) -> dict[str, Any]:
        symbol = symbol.upper()
        cache_key = f"chain:{symbol}:{expiry or 'all'}"
        cached = await cache_get(cache_key)
        if cached:
            return cached

        async with httpx.AsyncClient() as client:
            params: dict[str, Any] = {"apiKey": settings.POLYGON_API_KEY.get_secret_value()}
            if expiry:
                params["expiration_date"] = expiry
            resp = await client.get(
                f"https://api.polygon.io/v3/snapshot/options/{symbol}",
                params=params,
            )
            data = resp.json()

        contracts = []
        for item in data.get("results", []):
            details = item.get("details", {})
            greeks = item.get("greeks", {})
            day = item.get("day", {})
            contracts.append({
                "ticker": details.get("ticker", ""),
                "underlying": symbol,
                "expiry": details.get("expiration_date", ""),
                "strike": details.get("strike_price", 0),
                "option_type": details.get("contract_type", ""),
                "last": day.get("close", 0),
                "volume": day.get("volume", 0),
                "open_interest": item.get("open_interest", 0),
                "iv": item.get("implied_volatility", 0),
                "delta": greeks.get("delta", 0),
                "gamma": greeks.get("gamma", 0),
                "theta": greeks.get("theta", 0),
                "vega": greeks.get("vega", 0),
            })

        result = {"underlying": symbol, "contracts": contracts, "count": len(contracts)}
        await cache_set(cache_key, result, ttl_seconds=60)
        return result

    @BaseMCPServer.tool("get_expirations", "List available expiration dates for a symbol", {"symbol": {"type": "string"}})
    async def get_expirations(self, symbol: str) -> list[str]:
        symbol = symbol.upper()
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.polygon.io/v3/reference/options/contracts",
                params={
                    "underlying_ticker": symbol,
                    "limit": 1000,
                    "apiKey": settings.POLYGON_API_KEY.get_secret_value(),
                },
            )
            data = resp.json()

        expirations = sorted({r.get("expiration_date", "") for r in data.get("results", [])})
        return [e for e in expirations if e]

    @BaseMCPServer.tool(
        "compute_greeks",
        "Compute Black-Scholes greeks for a specific contract",
        {
            "spot": {"type": "number"},
            "strike": {"type": "number"},
            "dte": {"type": "integer", "description": "Days to expiration"},
            "iv": {"type": "number", "description": "Implied volatility (e.g. 0.30)"},
            "option_type": {"type": "string", "description": "call or put"},
            "risk_free_rate": {"type": "number", "optional": True},
        },
    )
    async def compute_greeks(
        self,
        spot: float,
        strike: float,
        dte: int,
        iv: float,
        option_type: str = "call",
        risk_free_rate: float = 0.05,
    ) -> dict[str, float]:
        T = max(dte / 365.0, 1 / 365.0)
        sigma = iv

        d1 = (np.log(spot / strike) + (risk_free_rate + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
        d2 = d1 - sigma * np.sqrt(T)

        if option_type == "call":
            delta = float(norm.cdf(d1))
            price = float(spot * norm.cdf(d1) - strike * np.exp(-risk_free_rate * T) * norm.cdf(d2))
            rho = float(strike * T * np.exp(-risk_free_rate * T) * norm.cdf(d2) / 100)
        else:
            delta = float(norm.cdf(d1) - 1)
            price = float(strike * np.exp(-risk_free_rate * T) * norm.cdf(-d2) - spot * norm.cdf(-d1))
            rho = float(-strike * T * np.exp(-risk_free_rate * T) * norm.cdf(-d2) / 100)

        gamma = float(norm.pdf(d1) / (spot * sigma * np.sqrt(T)))
        theta = float(
            -(spot * norm.pdf(d1) * sigma) / (2 * np.sqrt(T))
            - risk_free_rate * strike * np.exp(-risk_free_rate * T) * norm.cdf(d2 if option_type == "call" else -d2)
        ) / 365
        vega = float(spot * norm.pdf(d1) * np.sqrt(T) / 100)

        return {
            "delta": round(delta, 4),
            "gamma": round(gamma, 6),
            "theta": round(theta, 4),
            "vega": round(vega, 4),
            "rho": round(rho, 4),
            "theoretical_price": round(price, 2),
            "iv": iv,
        }

    @BaseMCPServer.tool(
        "get_iv_surface",
        "Get the implied volatility surface (strike x expiry) for a symbol",
        {"symbol": {"type": "string"}},
    )
    async def get_iv_surface(self, symbol: str) -> dict[str, Any]:
        chain = await self.get_options_chain(symbol)
        contracts = chain.get("contracts", [])

        surface: dict[str, dict[str, float]] = {}
        for c in contracts:
            expiry = c.get("expiry", "")
            strike = str(c.get("strike", 0))
            iv = c.get("iv", 0)
            if expiry and iv > 0:
                if expiry not in surface:
                    surface[expiry] = {}
                surface[expiry][strike] = iv

        return {"symbol": symbol.upper(), "surface": surface}
