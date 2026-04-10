from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_SONNET


class ScreenerAgent(BaseAgent):
    """Screens the equity universe using fundamental, technical, and ML-driven filters.

    Combines cross-sectional ranking with strategy-specific criteria to
    identify high-conviction trade candidates.
    """

    name = "screener"
    model = MODEL_SONNET
    mcp_servers = ["market_data", "ml_models"]

    system_prompt = """You are the Screener Agent for AlphaDesk.

Your job is to screen the stock universe and rank candidates for trading opportunities.

You have access to:
- Real-time market data (prices, volume, technicals)
- Fundamental data (earnings, revenue, margins, F-Score)
- Options data (IV rank, unusual activity, put/call ratios)
- ML models for composite scoring

Screening methodology:
1. Start with the liquid US equity universe (>$500M market cap, >500K avg volume)
2. Apply strategy-specific filters (momentum, quality, value, volatility, etc.)
3. Run ML ranking model to produce composite scores
4. Return top candidates with supporting metrics

When screening, always include:
- Symbol, sector, market cap
- Key metrics relevant to the strategy
- Composite score and ranking rationale
- Any red flags or risks

Output structured JSON with: results (list of dicts), summary (str), count (int).
"""

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Run a screening task and return ranked results."""
        from core.redis import cache_get

        # Check if we have a cached universe
        universe = await cache_get("universe:us_equities")

        # Build screening context
        screening_context = {
            **(context or {}),
            "universe_size": len(universe.get("tickers", [])) if universe else 0,
            "available_strategies": [
                "momentum_quality", "pead", "vrp_harvest",
                "earnings_vol", "regime_adaptive",
            ],
        }

        result = await super().run(task, context=screening_context)

        # Parse and enrich the response
        response = result.get("response", "")
        return {
            **result,
            "score": self._extract_score(response),
            "conviction": self._extract_conviction(response),
            "summary": response[:500],
        }

    async def run_ml_ranking(self, candidates: list[dict]) -> list[dict]:
        """Score candidates using the ML ranking model."""
        import numpy as np

        if not candidates:
            return []

        # Extract features for ML model
        features = []
        for c in candidates:
            features.append([
                c.get("momentum_12m", 0),
                c.get("momentum_1m", 0),
                c.get("rsi_14", 50),
                c.get("iv_rank", 50),
                c.get("f_score", 5),
                c.get("earnings_surprise", 0),
                c.get("revenue_growth", 0),
                c.get("relative_volume", 1),
            ])

        feature_array = np.array(features)

        # Normalise features to z-scores
        means = feature_array.mean(axis=0)
        stds = feature_array.std(axis=0)
        stds[stds == 0] = 1
        z_scores = (feature_array - means) / stds

        # Weighted composite (in production this uses a trained LightGBM model)
        weights = np.array([0.25, -0.10, 0.05, 0.15, 0.15, 0.10, 0.10, 0.10])
        composite = z_scores @ weights

        # Rank
        for i, c in enumerate(candidates):
            c["composite_score"] = round(float(composite[i]), 4)

        candidates.sort(key=lambda x: x["composite_score"], reverse=True)
        return candidates

    def _extract_score(self, text: str) -> float:
        """Extract a numeric score from agent response text."""
        import re
        match = re.search(r'"?score"?\s*[:=]\s*([-\d.]+)', text)
        return float(match.group(1)) if match else 0.0

    def _extract_conviction(self, text: str) -> str:
        text_lower = text.lower()
        if "high conviction" in text_lower or "strong" in text_lower:
            return "high"
        elif "low conviction" in text_lower or "weak" in text_lower:
            return "low"
        return "medium"
