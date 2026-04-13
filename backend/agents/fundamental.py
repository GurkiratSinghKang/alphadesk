from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_SONNET


class FundamentalAnalysisAgent(BaseAgent):
    """Fundamental analysis specialist using Piotroski F-Score, quality metrics,
    and relative valuation frameworks.
    """

    name = "fundamental"
    model = MODEL_SONNET
    mcp_servers = ["edgar", "market_data"]

    system_prompt = """You are the Fundamental Analysis Agent for AlphaDesk.

You evaluate companies using rigorous fundamental analysis frameworks.

Your analysis includes:

1. PIOTROSKI F-SCORE (0-9)
   - Profitability: ROA > 0, Operating CF > 0, Delta ROA > 0, CF > Net Income
   - Leverage: Delta Leverage < 0, Delta Current Ratio > 0, No equity dilution
   - Efficiency: Delta Gross Margin > 0, Delta Asset Turnover > 0

2. QUALITY METRICS
   - Earnings quality: accruals ratio, cash conversion
   - Revenue quality: recurring vs one-time, organic growth
   - Balance sheet quality: debt/equity, interest coverage, cash position
   - Management quality: insider ownership, capital allocation history

3. VALUATION
   - Absolute: DCF (multi-scenario), residual income
   - Relative: P/E, EV/EBITDA, P/S, PEG vs sector peers
   - Historical: current multiples vs 5yr range
   - Fair value estimate with confidence range

4. GROWTH ASSESSMENT
   - Revenue growth trajectory (3yr CAGR, acceleration/deceleration)
   - Margin expansion/compression trend
   - TAM penetration and runway
   - Earnings revision momentum

5. RISK FACTORS
   - Concentration risk (customer, geography, product)
   - Competitive moat assessment (narrow/wide/none)
   - Regulatory/macro sensitivity
   - Short interest and institutional ownership changes

Output a JSON object with: score (-100 to 100), conviction (low/medium/high),
f_score (0-9), fair_value_estimate (float), upside_pct (float), summary (str),
key_metrics (dict).
"""

    # Trading terms that should not be matched as ticker symbols (BUG-044)
    _EXCLUDED_TERMS = {
        "ATM", "OTM", "ITM", "RSI", "MACD", "EMA", "SMA", "DTE", "VIX", "SPX",
        "ETF", "IPO", "CEO", "CFO", "P", "PE", "EPS", "ROA", "ROE", "DCF",
    }

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Run fundamental analysis with computed financial metrics."""
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
            financials = await self._fetch_financials(symbol_str)
            f_score = self._compute_f_score(financials)
            context = {
                **(context or {}),
                "financials": financials,
                "f_score": f_score,
            }

        result = await super().run(task, context=context)
        response = result.get("response", "")

        return {
            **result,
            "score": self._extract_score(response),
            "conviction": self._extract_conviction(response),
            "summary": response[:500],
        }

    async def _fetch_financials(self, symbol: str) -> dict[str, Any]:
        """Fetch financial data from cache or API."""
        from core.redis import cache_get

        cached = await cache_get(f"financials:{symbol}")
        if cached:
            return cached

        # Return structure that the agent can work with
        return {
            "symbol": symbol,
            "note": "Financial data will be fetched from EDGAR/OpenBB in production",
        }

    def _compute_f_score(self, data: dict[str, Any]) -> dict[str, Any]:
        """Compute Piotroski F-Score from financial data."""
        score = 0
        details: dict[str, bool] = {}

        # Profitability signals
        roa = data.get("roa", 0)
        details["roa_positive"] = roa > 0
        score += int(roa > 0)

        cfo = data.get("operating_cash_flow", 0)
        details["cfo_positive"] = cfo > 0
        score += int(cfo > 0)

        roa_prev = data.get("roa_prev", 0)
        details["roa_improving"] = roa > roa_prev
        score += int(roa > roa_prev)

        net_income = data.get("net_income", 0)
        details["accruals_quality"] = cfo > net_income
        score += int(cfo > net_income)

        # Leverage signals
        lt_debt = data.get("long_term_debt", 0)
        lt_debt_prev = data.get("long_term_debt_prev", 0)
        details["leverage_decreasing"] = lt_debt <= lt_debt_prev
        score += int(lt_debt <= lt_debt_prev)

        current_ratio = data.get("current_ratio", 1)
        current_ratio_prev = data.get("current_ratio_prev", 1)
        details["liquidity_improving"] = current_ratio > current_ratio_prev
        score += int(current_ratio > current_ratio_prev)

        shares = data.get("shares_outstanding", 1)
        shares_prev = data.get("shares_outstanding_prev", 1)
        details["no_dilution"] = shares <= shares_prev
        score += int(shares <= shares_prev)

        # Efficiency signals
        gross_margin = data.get("gross_margin", 0)
        gross_margin_prev = data.get("gross_margin_prev", 0)
        details["margin_expanding"] = gross_margin > gross_margin_prev
        score += int(gross_margin > gross_margin_prev)

        asset_turnover = data.get("asset_turnover", 0)
        asset_turnover_prev = data.get("asset_turnover_prev", 0)
        details["efficiency_improving"] = asset_turnover > asset_turnover_prev
        score += int(asset_turnover > asset_turnover_prev)

        return {"total": score, "max": 9, "details": details}

    # _extract_score and _extract_conviction inherited from BaseAgent
