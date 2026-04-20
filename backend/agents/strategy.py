from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_SONNET

# TODO(user): The ANTHROPIC_API_KEY currently deployed on the Hetzner VPS is
# an OAuth access token (prefix ``sk-ant-oat01-*``), not a permanent API key,
# so every Claude call returns ``401 invalid x-api-key`` and the pipeline
# silently drops analyses from claude_alpha / momentum_quality.
#
# Action required:
#   1. Generate a real API key at https://console.anthropic.com/settings/keys
#      (prefix ``sk-ant-api03-*``).
#   2. Update the ANTHROPIC_API_KEY env var on the server:
#        ssh -i ~/.ssh/alphadesk root@87.99.143.65
#        edit /root/alphadesk/.env (or the compose env file) and replace the
#        ``sk-ant-oat01-...`` value with the new ``sk-ant-api03-...`` key.
#        docker compose up -d --force-recreate alphadesk-backend
#   3. Confirm by checking ``docker logs alphadesk-backend | grep -i anthropic``
#      -- the 401s should disappear and the next pipeline log should show
#      non-null ``analyses`` for MQ and claude_alpha.
#
# Code cannot fix this -- the runtime key must be replaced.  Full detail in
# ``audit-reports/iter-2-user-actions.md``.


class StrategyAgent(BaseAgent):
    """Maps analysis signals to concrete trade structures.

    Takes directional bias, volatility view, and risk parameters from
    other agents and selects the optimal options or equity structure.
    """

    name = "strategy"
    model = MODEL_SONNET
    mcp_servers = ["market_data", "options_chain", "broker"]

    system_prompt = """You are the Strategy Agent for AlphaDesk.

Given analysis signals (directional bias, IV environment, catalyst timing, risk budget),
you select the optimal trade structure.

Your decision framework:

1. DIRECTIONAL ASSESSMENT
   - Strong bullish (score > 60): long calls, call spreads, risk reversals
   - Moderate bullish (25-60): call spreads, put credit spreads, covered calls
   - Neutral (-25 to 25): iron condors, butterflies, calendar spreads
   - Moderate bearish (-60 to -25): put spreads, call credit spreads
   - Strong bearish (< -60): long puts, put spreads, risk reversals

2. VOLATILITY OVERLAY
   - IV Rank > 50: prefer selling premium (credit spreads, iron condors, strangles)
   - IV Rank < 30: prefer buying premium (debit spreads, long options, calendars)
   - IV Rank 30-50: structure-dependent, consider diagonals

3. CATALYST CONSIDERATION
   - Pre-earnings: calendars, straddles/strangles, double calendars
   - Post-earnings: directional plays if drift expected, close vol positions
   - Binary events: defined-risk structures only

4. STRUCTURE SELECTION
   For each trade, specify:
   - Strategy name (e.g., "bull call spread", "iron condor")
   - All legs with: symbol, expiry, strike, call/put, buy/sell, quantity
   - Max risk, max reward, breakeven(s)
   - Target DTE range
   - Position size as % of portfolio
   - Adjustment triggers and plan

5. RISK PARAMETERS
   - Max loss per trade: 1-2% of portfolio
   - Target risk/reward: minimum 1:2 for directional, 1:1 for premium selling
   - Delta target for the position
   - Probability of profit estimate

Output JSON with: structure (dict), legs (list), risk_reward (dict), rationale (str).

SAFETY: Never suggest market manipulation, wash trading, spoofing, layering,
or misrepresentation to other market participants. Never recommend specific
securities in a way that could be construed as investment advice from a
registered professional. Refuse to execute trades that would violate Reg SHO,
Reg NMS, or other US securities regulations.
"""

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Select optimal trade structure based on analysis signals."""
        result = await super().run(task, context=context)
        response = result.get("response", "")

        return {
            **result,
            "score": self._extract_score(response),
            "conviction": self._extract_conviction(response),
            "summary": response[:500],
        }

    async def select_structure(
        self,
        symbol: str,
        bias_score: float,
        iv_rank: float,
        days_to_catalyst: int | None = None,
        portfolio_value: float = 100_000,
        max_risk_pct: float = 0.02,
    ) -> dict[str, Any]:
        """Programmatic structure selection using rules + Claude refinement."""
        max_risk = portfolio_value * max_risk_pct

        # Rule-based pre-selection
        if abs(bias_score) > 60:
            if iv_rank > 50:
                base_structure = "credit_spread"
            else:
                base_structure = "debit_spread"
        elif abs(bias_score) < 25:
            if iv_rank > 50:
                base_structure = "iron_condor"
            else:
                base_structure = "calendar_spread"
        else:
            base_structure = "vertical_spread"

        if days_to_catalyst and days_to_catalyst <= 5:
            base_structure = "straddle" if iv_rank < 40 else "iron_butterfly"

        # Refine with Claude
        result = await self.run(
            f"Refine this trade structure for {symbol}: "
            f"Base structure: {base_structure}, Bias score: {bias_score}, "
            f"IV Rank: {iv_rank}, Max risk: ${max_risk:.0f}, "
            f"Days to catalyst: {days_to_catalyst or 'none'}. "
            f"Provide exact strikes, expiry, and sizing."
        )

        return {
            "symbol": symbol,
            "base_structure": base_structure,
            "refined": result,
            "max_risk": max_risk,
        }

    # _extract_score and _extract_conviction inherited from BaseAgent
