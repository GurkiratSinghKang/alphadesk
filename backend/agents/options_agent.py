from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_SONNET


class OptionsAgent(BaseAgent):
    """Implied volatility analysis, options structure optimisation, and
    greeks management specialist.
    """

    name = "options"
    model = MODEL_SONNET
    mcp_servers = ["options_chain", "market_data"]

    system_prompt = """You are the Options Agent for AlphaDesk.

You are an expert in options pricing, volatility analysis, and structure optimisation.

Your capabilities:

1. VOLATILITY ANALYSIS
   - IV rank and percentile computation (1-year lookback)
   - IV term structure analysis (contango vs backwardation)
   - IV skew analysis (put skew, call skew, smile)
   - Realised vs implied volatility spread (VRP estimation)
   - Volatility surface modelling

2. STRUCTURE OPTIMISATION
   Given a directional view and risk parameters, optimise:
   - Strike selection for optimal risk/reward
   - Expiry selection based on theta decay profile and catalysts
   - Spread width optimisation
   - Leg ratios for ratio spreads and butterflies
   - Calendar/diagonal optimisation for volatility plays

3. GREEKS ANALYSIS
   - Position-level and portfolio-level greeks
   - Greeks evolution over time and price scenarios
   - Gamma scalping opportunities
   - Vega exposure management
   - Pin risk assessment near expiration

4. PRICING & EDGE
   - Compare market price vs theoretical (BSM, binomial)
   - Identify mispriced options (vol surface arbitrage)
   - Expected value computation for each structure
   - Probability of profit analysis
   - Expected move vs historical move comparison

5. ADJUSTMENTS
   - When to roll, when to close, when to add
   - Rolling mechanics (up/down/out) and cost analysis
   - Conversion between structures (e.g., vertical to butterfly)
   - Defence against adverse moves

Output JSON with: score, conviction, iv_analysis (dict), recommended_structure (dict),
greeks_summary (dict), edge_assessment (str).
"""

    # Trading terms that should not be matched as ticker symbols (BUG-044)
    _EXCLUDED_TERMS = {
        "ATM", "OTM", "ITM", "RSI", "MACD", "EMA", "SMA", "DTE", "VIX", "SPX",
        "ETF", "IPO", "CEO", "CFO", "P", "PE", "EPS", "ROA", "ROE", "DCF",
    }

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Run options analysis with volatility computations."""
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
            vol_data = await self._analyse_volatility(symbol_str)
            context = {**(context or {}), "volatility": vol_data}

        result = await super().run(task, context=context)
        response = result.get("response", "")

        return {
            **result,
            "score": self._extract_score(response),
            "conviction": self._extract_conviction(response),
            "summary": response[:500],
        }

    async def _analyse_volatility(self, symbol: str) -> dict[str, Any]:
        """Compute volatility metrics for the symbol."""
        import numpy as np
        from core.redis import cache_get

        # Historical IV data
        iv_hist = await cache_get(f"iv_history:{symbol}")
        iv_values = iv_hist.get("values", []) if iv_hist else []

        prices = await cache_get(f"prices:{symbol}")
        close_prices = prices.get("close", []) if prices else []

        result: dict[str, Any] = {"symbol": symbol}

        if iv_values:
            arr = np.array(iv_values, dtype=float)
            current_iv = arr[-1]
            result.update({
                "current_iv": round(float(current_iv), 4),
                "iv_rank": round(float((current_iv - arr.min()) / (arr.max() - arr.min()) * 100), 1) if arr.max() != arr.min() else 50,
                "iv_percentile": round(float(np.sum(arr < current_iv) / len(arr) * 100), 1),
                "iv_mean": round(float(arr.mean()), 4),
                "iv_std": round(float(arr.std()), 4),
            })

        if len(close_prices) >= 30:
            closes = np.array(close_prices, dtype=float)
            log_returns = np.diff(np.log(closes))

            for window, label in [(20, "hv_20"), (50, "hv_50"), (100, "hv_100")]:
                if len(log_returns) >= window:
                    result[label] = round(float(np.std(log_returns[-window:]) * np.sqrt(252)), 4)

            # VRP (Volatility Risk Premium)
            if "current_iv" in result and "hv_20" in result:
                result["vrp"] = round(result["current_iv"] - result["hv_20"], 4)

        return result

    async def optimise_structure(
        self,
        symbol: str,
        direction: str,
        risk_budget: float,
        target_dte: int = 30,
    ) -> dict[str, Any]:
        """Find the optimal options structure given constraints."""
        from core.redis import cache_get

        vol_data = await self._analyse_volatility(symbol)
        iv_rank = vol_data.get("iv_rank", 50)

        # Determine best structure type
        if iv_rank > 60:
            # Sell premium
            if direction == "bullish":
                structure = "bull_put_spread"
            elif direction == "bearish":
                structure = "bear_call_spread"
            else:
                structure = "iron_condor"
        else:
            # Buy premium
            if direction == "bullish":
                structure = "bull_call_spread"
            elif direction == "bearish":
                structure = "bear_put_spread"
            else:
                structure = "long_straddle"

        return {
            "recommended_structure": structure,
            "iv_rank": iv_rank,
            "target_dte": target_dte,
            "risk_budget": risk_budget,
            "volatility": vol_data,
        }

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
