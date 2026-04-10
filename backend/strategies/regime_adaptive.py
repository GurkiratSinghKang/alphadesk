from __future__ import annotations

from typing import Any

import numpy as np

from strategies.base import BaseStrategy


class RegimeAdaptiveStrategy(BaseStrategy):
    """HMM regime-adaptive strategy.

    Uses a Hidden Markov Model to detect the current market regime
    (bull, bear, high-vol) and adapts position sizing, strategy mix,
    and risk parameters accordingly.
    """

    name = "regime_adaptive"
    description = "Regime-aware strategy that adapts to market conditions via HMM"
    default_timeframe = "swing"

    # Regime-specific allocation weights
    REGIME_ALLOCATIONS = {
        "bull": {
            "momentum_quality": 0.40,
            "pead": 0.25,
            "vrp_harvest": 0.25,
            "earnings_vol": 0.10,
        },
        "neutral": {
            "momentum_quality": 0.20,
            "pead": 0.15,
            "vrp_harvest": 0.45,
            "earnings_vol": 0.20,
        },
        "bear": {
            "momentum_quality": 0.05,
            "pead": 0.10,
            "vrp_harvest": 0.15,
            "earnings_vol": 0.10,
        },
    }

    # Regime-specific risk multipliers
    REGIME_RISK_MULTIPLIER = {
        "bull": 1.0,
        "neutral": 0.75,
        "bear": 0.40,
    }

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Screen by first detecting regime, then applying regime-appropriate filters."""
        regime = await self._detect_regime()
        regime_name = regime.get("current_regime", "neutral")
        self.logger.info("Current regime: %s", regime_name)

        allocations = self.REGIME_ALLOCATIONS.get(regime_name, self.REGIME_ALLOCATIONS["neutral"])

        # Import sub-strategies and run their screens with adjusted parameters
        from strategies import get_strategy

        all_candidates = []
        for strategy_name, weight in allocations.items():
            if weight < 0.05:
                continue
            strategy = get_strategy(strategy_name)
            if strategy:
                candidates = await strategy.screen(universe)
                for c in candidates:
                    c["source_strategy"] = strategy_name
                    c["regime_weight"] = weight
                    c["composite_score"] = (c.get("composite_score", 0) or 0) * weight
                all_candidates.extend(candidates)

        all_candidates.sort(key=lambda x: x.get("composite_score", 0), reverse=True)

        # Deduplicate by symbol, keeping highest score
        seen = set()
        deduped = []
        for c in all_candidates:
            sym = c.get("ticker", c.get("symbol", ""))
            if sym not in seen:
                seen.add(sym)
                deduped.append(c)

        return deduped[:30]

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Analyse with regime context."""
        regime = await self._detect_regime()
        regime_name = regime.get("current_regime", "neutral")

        source_strategy = data.get("source_strategy", "momentum_quality")
        from strategies import get_strategy
        strategy = get_strategy(source_strategy)

        if strategy:
            analysis = await strategy.analyze(symbol, data)
        else:
            analysis = {"symbol": symbol, "score": 0, "conviction": "low"}

        # Adjust score by regime confidence
        regime_probs = regime.get("regime_probabilities", {})
        regime_confidence = regime_probs.get(regime_name, 0.5)
        risk_mult = self.REGIME_RISK_MULTIPLIER.get(regime_name, 0.75)

        analysis["regime"] = regime_name
        analysis["regime_confidence"] = regime_confidence
        analysis["risk_multiplier"] = risk_mult
        analysis["adjusted_score"] = round(analysis.get("score", 0) * risk_mult, 1)

        return analysis

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        adjusted_score = analysis.get("adjusted_score", 0)
        if abs(adjusted_score) < 20:
            return None

        return {
            "symbol": analysis.get("symbol", ""),
            "direction": "bullish" if adjusted_score > 0 else "bearish",
            "strength": abs(adjusted_score),
            "conviction": analysis.get("conviction", "medium"),
            "timeframe": "swing",
            "holding_period_days": 30,
            "regime": analysis.get("regime", "neutral"),
            "risk_multiplier": analysis.get("risk_multiplier", 0.75),
            "source_strategy": analysis.get("source_strategy", "momentum_quality"),
            "analysis": analysis,
        }

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        """Map signal to trade with regime-adjusted sizing."""
        source = signal.get("source_strategy", "momentum_quality")
        from strategies import get_strategy
        strategy = get_strategy(source)

        risk_mult = signal.get("risk_multiplier", 0.75)

        # Adjust portfolio equity perception by risk multiplier
        adjusted_portfolio = {
            **portfolio,
            "equity": portfolio.get("equity", 100_000) * risk_mult,
        }

        if strategy:
            trade = await strategy.map_to_trade(signal, adjusted_portfolio)
        else:
            trade = {
                "symbol": signal["symbol"],
                "strategy": self.name,
                "structure": "equity_long",
                "direction": signal["direction"],
                "quantity": 1,
                "max_risk": 1000,
            }

        trade["strategy"] = self.name
        trade["regime"] = signal.get("regime", "neutral")
        trade["risk_multiplier"] = risk_mult

        return trade

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        """Manage with regime-aware exits."""
        regime = await self._detect_regime()
        current_regime = regime.get("current_regime", "neutral")
        entry_regime = position.get("regime", "neutral")

        # If regime has changed adversely, reduce or close
        regime_order = {"bull": 2, "neutral": 1, "bear": 0}
        entry_rank = regime_order.get(entry_regime, 1)
        current_rank = regime_order.get(current_regime, 1)

        if current_rank < entry_rank - 1:
            return {"action": "close", "reason": f"Regime shifted from {entry_regime} to {current_regime}"}

        if current_rank < entry_rank:
            return {"action": "reduce", "reason": f"Regime deteriorated to {current_regime}", "reduce_by_pct": 50}

        # Delegate to source strategy management
        source = position.get("source_strategy")
        if source:
            from strategies import get_strategy
            strategy = get_strategy(source)
            if strategy:
                return await strategy.manage(position, market_data)

        return {"action": "hold", "reason": "Regime stable"}

    async def _detect_regime(self) -> dict[str, Any]:
        """Detect current market regime using cached HMM output or live computation."""
        from core.redis import cache_get

        cached = await cache_get("regime:current")
        if cached:
            return cached

        # Compute from SPY returns if available
        spy_data = await cache_get("prices:SPY")
        if spy_data and "close" in spy_data:
            closes = np.array(spy_data["close"], dtype=float)
            if len(closes) > 100:
                returns = np.diff(np.log(closes)).tolist()
                from mcp_servers.ml_models.server import MLModelsServer
                ml = MLModelsServer()
                return await ml.detect_regime(returns)

        return {"current_regime": "neutral", "regime_probabilities": {"neutral": 0.6, "bull": 0.2, "bear": 0.2}}
