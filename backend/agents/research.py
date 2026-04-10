from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_OPUS


class StrategyResearchAgent(BaseAgent):
    """Autonomous strategy discovery and backtesting agent.

    Uses Claude Opus for deep reasoning about novel trading strategies,
    factor analysis, and systematic alpha research.
    """

    name = "research"
    model = MODEL_OPUS  # needs strong reasoning for strategy design
    mcp_servers = ["market_data", "ml_models", "edgar"]

    system_prompt = """You are the Strategy Research Agent for AlphaDesk.

You conduct autonomous research to discover, test, and refine trading strategies.
You think deeply and systematically about alpha generation.

Your research framework:

1. HYPOTHESIS GENERATION
   - Identify potential alpha sources from academic literature, market anomalies,
     or structural inefficiencies
   - Formulate testable hypotheses with clear predictions
   - Define the economic rationale (why should this edge exist and persist?)

2. FACTOR ANALYSIS
   - Decompose returns into known factors (market, size, value, momentum, quality, vol)
   - Identify residual alpha after factor adjustment
   - Test factor interactions and conditional performance
   - Assess factor crowding and capacity

3. BACKTESTING METHODOLOGY
   - Walk-forward validation with expanding/rolling windows
   - Out-of-sample testing with proper data split
   - Transaction cost modelling (commissions, slippage, market impact)
   - Multiple significance tests (t-stat, Sharpe, bootstrap confidence intervals)
   - Deflated Sharpe ratio to account for selection bias

4. REGIME ANALYSIS
   - Performance across market regimes (bull, bear, high vol, low vol)
   - Drawdown behaviour during stress periods
   - Correlation with existing portfolio strategies
   - Tail risk characteristics

5. STRATEGY SPECIFICATION
   - Entry/exit rules (precise, unambiguous)
   - Position sizing methodology
   - Universe definition and filtering
   - Rebalancing frequency and timing
   - Risk management rules
   - Expected capacity and scalability

6. PRODUCTION READINESS
   - Real-time data requirements
   - Execution complexity assessment
   - Monitoring and alerting requirements
   - Degradation signals and kill switch criteria

Output JSON with: hypothesis (str), methodology (dict), backtest_results (dict),
risk_metrics (dict), recommendation (str), confidence (float 0-1).
"""

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Conduct strategy research."""
        result = await super().run(task, context=context)
        response = result.get("response", "")

        return {
            **result,
            "score": self._extract_score(response),
            "conviction": self._extract_conviction(response),
            "summary": response[:500],
        }

    async def backtest_strategy(
        self,
        strategy_config: dict[str, Any],
        start_date: str,
        end_date: str,
    ) -> dict[str, Any]:
        """Run a backtest for a strategy configuration."""
        import numpy as np

        # In production this executes the full backtest engine.
        # Here we structure the pipeline and use Claude for analysis.
        result = await self.run(
            f"Analyse this strategy configuration and provide expected performance "
            f"characteristics and potential issues:\n"
            f"Config: {strategy_config}\n"
            f"Period: {start_date} to {end_date}"
        )

        return {
            "strategy": strategy_config.get("name", "unnamed"),
            "period": {"start": start_date, "end": end_date},
            "analysis": result,
        }

    async def discover_factors(self, universe: str = "sp500") -> dict[str, Any]:
        """Run factor discovery analysis on a given universe."""
        result = await self.run(
            f"Conduct a factor discovery analysis on the {universe} universe. "
            f"Identify potential alpha factors that are:\n"
            f"1. Economically motivated\n"
            f"2. Not already well-known/crowded\n"
            f"3. Feasible to implement with available data\n"
            f"4. Likely to have reasonable capacity\n"
            f"Provide specific factor definitions and expected Sharpe ratios."
        )
        return result

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
