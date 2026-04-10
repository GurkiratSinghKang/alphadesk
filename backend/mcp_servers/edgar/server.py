from __future__ import annotations

from typing import Any

from core.redis import cache_get, cache_set
from mcp_servers.base import BaseMCPServer


class EdgarServer(BaseMCPServer):
    """MCP server for SEC EDGAR data using the edgartools library."""

    name = "edgar"

    @BaseMCPServer.tool("get_company_filings", "List recent SEC filings for a company", {"symbol": {"type": "string"}, "filing_type": {"type": "string", "optional": True}})
    async def get_company_filings(self, symbol: str, filing_type: str = "10-K") -> list[dict[str, Any]]:
        import asyncio
        from functools import partial

        symbol = symbol.upper()
        cache_key = f"edgar:filings:{symbol}:{filing_type}"
        cached = await cache_get(cache_key)
        if cached:
            return cached

        def _fetch() -> list[dict[str, Any]]:
            from edgar import Company
            company = Company(symbol)
            filings = company.get_filings(form=filing_type).latest(5)
            return [
                {
                    "accession_number": f.accession_no,
                    "form_type": f.form,
                    "filed_date": str(f.filing_date),
                    "description": f.primary_doc_description or "",
                }
                for f in filings
            ]

        result = await asyncio.to_thread(_fetch)
        await cache_set(cache_key, result, ttl_seconds=3600)
        return result

    @BaseMCPServer.tool("get_financials", "Fetch financial statements from latest 10-K/10-Q", {"symbol": {"type": "string"}})
    async def get_financials(self, symbol: str) -> dict[str, Any]:
        import asyncio

        symbol = symbol.upper()
        cache_key = f"edgar:financials:{symbol}"
        cached = await cache_get(cache_key)
        if cached:
            return cached

        def _fetch() -> dict[str, Any]:
            from edgar import Company
            company = Company(symbol)
            filings = company.get_filings(form="10-K").latest(1)
            if not filings:
                return {"error": "No 10-K filings found"}

            filing = filings[0]
            # Extract key financial data
            try:
                xbrl = filing.xbrl()
                if xbrl is None:
                    return {"symbol": symbol, "note": "XBRL data not available for this filing"}

                return {
                    "symbol": symbol,
                    "revenue": xbrl.get("Revenues") or xbrl.get("RevenueFromContractWithCustomerExcludingAssessedTax"),
                    "net_income": xbrl.get("NetIncomeLoss"),
                    "total_assets": xbrl.get("Assets"),
                    "total_liabilities": xbrl.get("Liabilities"),
                    "stockholders_equity": xbrl.get("StockholdersEquity"),
                    "operating_cash_flow": xbrl.get("NetCashProvidedByUsedInOperatingActivities"),
                    "eps": xbrl.get("EarningsPerShareDiluted"),
                }
            except Exception as e:
                return {"symbol": symbol, "error": str(e)}

        result = await asyncio.to_thread(_fetch)
        await cache_set(cache_key, result, ttl_seconds=86400)
        return result

    @BaseMCPServer.tool("get_insider_transactions", "Fetch recent insider buying/selling (Form 4)", {"symbol": {"type": "string"}})
    async def get_insider_transactions(self, symbol: str) -> list[dict[str, Any]]:
        import asyncio

        symbol = symbol.upper()
        cache_key = f"edgar:insiders:{symbol}"
        cached = await cache_get(cache_key)
        if cached:
            return cached

        def _fetch() -> list[dict[str, Any]]:
            from edgar import Company
            company = Company(symbol)
            filings = company.get_filings(form="4").latest(10)
            results = []
            for f in filings:
                results.append({
                    "filed_date": str(f.filing_date),
                    "accession_number": f.accession_no,
                    "description": f.primary_doc_description or "Insider transaction",
                })
            return results

        result = await asyncio.to_thread(_fetch)
        await cache_set(cache_key, result, ttl_seconds=3600)
        return result

    @BaseMCPServer.tool("get_institutional_holders", "Fetch institutional ownership from 13F filings", {"symbol": {"type": "string"}})
    async def get_institutional_holders(self, symbol: str) -> dict[str, Any]:
        import asyncio

        symbol = symbol.upper()
        cache_key = f"edgar:institutions:{symbol}"
        cached = await cache_get(cache_key)
        if cached:
            return cached

        def _fetch() -> dict[str, Any]:
            from edgar import Company
            company = Company(symbol)
            filings = company.get_filings(form="13F-HR").latest(1)
            if not filings:
                return {"symbol": symbol, "holders": [], "note": "No 13F data found"}
            return {
                "symbol": symbol,
                "latest_filing_date": str(filings[0].filing_date),
                "note": "Full 13F parsing requires additional processing",
            }

        result = await asyncio.to_thread(_fetch)
        await cache_set(cache_key, result, ttl_seconds=86400)
        return result
