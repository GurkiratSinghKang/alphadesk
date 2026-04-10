from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_SONNET


class EarningsAgent(BaseAgent):
    """Earnings event specialist that analyses pre- and post-earnings setups.

    Evaluates expected moves, historical earnings reactions, analyst estimates,
    and optimal options structures for earnings plays.
    """

    name = "earnings"
    model = MODEL_SONNET
    mcp_servers = ["market_data", "options_chain", "edgar"]

    system_prompt = """You are the Earnings Agent for AlphaDesk.

You specialise in earnings-related trading opportunities:

1. PRE-EARNINGS ANALYSIS
   - Expected move from ATM straddle pricing
   - Historical earnings move distribution (last 8-12 quarters)
   - Earnings surprise history (beat/miss frequency and magnitude)
   - Analyst estimate revisions in the 30 days pre-report
   - Whisper number vs consensus
   - IV crush magnitude estimate (compare current IV to post-earnings norm)

2. EARNINGS QUALITY ASSESSMENT
   - Revenue vs earnings beat (revenue beats more meaningful)
   - Guidance quality (raised, maintained, lowered, withdrawn)
   - One-time items and adjusted vs GAAP differences
   - Cash flow confirmation of earnings
   - Segment analysis for diversified companies

3. POST-EARNINGS DRIFT (PEAD)
   - Historical drift direction and magnitude after beats/misses
   - Volume confirmation of the move
   - Institutional repositioning signals
   - Analyst revision momentum post-report
   - Mean reversion vs continuation assessment

4. TRADE STRUCTURES FOR EARNINGS
   Pre-earnings (high IV):
   - Calendar spreads (sell front, buy back month)
   - Double calendars for neutral IV plays
   - Pre-earnings run-up momentum plays (equity or OTM calls)

   Post-earnings:
   - Directional plays if PEAD expected
   - Iron condors if reverting to range
   - Broken-wing butterflies for skewed expectations

5. RISK MANAGEMENT
   - Size earnings plays at 50% of normal position size
   - Always use defined risk structures
   - Set post-earnings exit rules before the event

Output JSON with: score, conviction, expected_move (dict), historical (dict),
trade_ideas (list), key_dates (dict).
"""

    # Trading terms that should not be matched as ticker symbols (BUG-044)
    _EXCLUDED_TERMS = {
        "ATM", "OTM", "ITM", "RSI", "MACD", "EMA", "SMA", "DTE", "VIX", "SPX",
        "ETF", "IPO", "CEO", "CFO", "P", "PE", "EPS", "ROA", "ROE", "DCF",
    }

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Analyse an earnings event with historical context."""
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
            earnings_data = await self._get_earnings_data(symbol_str)
            context = {**(context or {}), "earnings": earnings_data}

        result = await super().run(task, context=context)
        response = result.get("response", "")

        return {
            **result,
            "score": self._extract_score(response),
            "conviction": self._extract_conviction(response),
            "summary": response[:500],
        }

    async def _get_earnings_data(self, symbol: str) -> dict[str, Any]:
        """Fetch earnings history and upcoming dates from cache."""
        from core.redis import cache_get

        cached = await cache_get(f"earnings:{symbol}")
        if cached:
            return cached

        return {
            "symbol": symbol,
            "note": "Earnings data sourced from EDGAR and earnings calendars in production",
            "next_report_date": None,
            "history": [],
            "consensus_eps": None,
            "consensus_revenue": None,
        }

    async def compute_expected_move(self, symbol: str) -> dict[str, Any]:
        """Compute the expected earnings move from ATM straddle pricing."""
        from core.redis import cache_get
        import numpy as np

        # Get ATM straddle price
        chain = await cache_get(f"chain:{symbol}")
        if not chain:
            return {"expected_move_pct": None, "error": "No options data"}

        quote = await cache_get(f"quote:{symbol}")
        spot = quote.get("last", 100) if quote else 100

        # Find nearest expiry and ATM strike
        contracts = chain.get("contracts", [])
        if not contracts:
            return {"expected_move_pct": None, "error": "No contracts"}

        # ATM straddle = call ask + put ask at nearest strike
        atm_calls = [c for c in contracts if c.get("option_type") == "call" and abs(c.get("strike", 0) - spot) < spot * 0.02]
        atm_puts = [c for c in contracts if c.get("option_type") == "put" and abs(c.get("strike", 0) - spot) < spot * 0.02]

        if atm_calls and atm_puts:
            straddle_price = atm_calls[0].get("ask", 0) + atm_puts[0].get("ask", 0)
            expected_move_pct = (straddle_price / spot) * 100
        else:
            expected_move_pct = None

        # Historical moves
        history = await cache_get(f"earnings_history:{symbol}")
        hist_moves = []
        if history:
            for q in history.get("quarters", []):
                move = q.get("next_day_return_pct", 0)
                hist_moves.append(move)

        return {
            "expected_move_pct": round(expected_move_pct, 1) if expected_move_pct else None,
            "straddle_price": straddle_price if atm_calls and atm_puts else None,
            "historical_avg_move": round(float(np.mean(np.abs(hist_moves))), 1) if hist_moves else None,
            "historical_moves": hist_moves[-8:],
            "beats_vs_misses": {
                "beats": sum(1 for m in hist_moves if m > 0),
                "misses": sum(1 for m in hist_moves if m < 0),
            } if hist_moves else None,
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
