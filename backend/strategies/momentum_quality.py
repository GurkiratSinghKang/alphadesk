from __future__ import annotations

from typing import Any

import numpy as np

from strategies.base import BaseStrategy


class MomentumQualityStrategy(BaseStrategy):
    """Cross-sectional momentum combined with quality factor.

    Buys stocks exhibiting strong 12-1 month momentum (skip most recent month
    to avoid short-term reversal) combined with high Piotroski F-Score and
    earnings quality. Maps to vertical spreads or risk-defined options.
    """

    name = "momentum_quality"
    description = "Cross-sectional momentum + quality factor screen with options overlay"
    default_timeframe = "swing"
    min_iv_rank = 20.0  # need some premium for spreads

    # Screening thresholds
    MIN_MARKET_CAP = 2_000_000_000  # $2B
    MIN_AVG_VOLUME = 500_000
    MIN_MOMENTUM_12_1 = 0.10  # 10% return over 12m-1m
    MAX_MOMENTUM_1M = 0.15  # cap recent month to avoid chasing
    MIN_F_SCORE = 6

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Screen for high momentum + high quality stocks."""
        candidates = []
        for t in universe:
            # Liquidity filters
            if (t.get("market_cap", 0) or 0) < self.MIN_MARKET_CAP:
                continue
            if (t.get("avg_volume", 0) or 0) < self.MIN_AVG_VOLUME:
                continue

            # Momentum filter: strong 12m but not overextended
            mom_12_1 = t.get("momentum_12m", 0) or 0
            mom_1m = t.get("momentum_1m", 0) or 0
            if mom_12_1 < self.MIN_MOMENTUM_12_1:
                continue
            if abs(mom_1m) > self.MAX_MOMENTUM_1M:
                continue

            # Quality filter
            f_score = t.get("f_score", 0) or 0
            if f_score < self.MIN_F_SCORE:
                continue

            # Compute composite score
            mom_z = (mom_12_1 - 0.15) / 0.20  # normalised around typical values
            qual_z = (f_score - 5) / 2
            t["composite_score"] = round(0.6 * mom_z + 0.4 * qual_z, 4)
            candidates.append(t)

        candidates.sort(key=lambda x: x["composite_score"], reverse=True)
        return candidates[:50]

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Analyse momentum sustainability and quality confirmation."""
        mom_12 = data.get("momentum_12m", 0)
        mom_6 = data.get("momentum_6m", 0)
        mom_3 = data.get("momentum_3m", 0)
        f_score = data.get("f_score", 5)
        rsi = data.get("rsi_14", 50)
        iv_rank = data.get("iv_rank", 50)

        # Momentum acceleration check
        accelerating = mom_3 > mom_6 / 2 if mom_6 else False

        # Overbought filter
        overbought = rsi > 75

        score = data.get("composite_score", 0) * 50  # scale to -100..100
        if accelerating:
            score += 10
        if overbought:
            score -= 15
        if f_score >= 8:
            score += 10

        score = max(-100, min(100, score))

        conviction = "high" if score > 50 and f_score >= 7 else "medium" if score > 20 else "low"

        return {
            "symbol": symbol,
            "score": round(score, 1),
            "conviction": conviction,
            "momentum": {"12m": mom_12, "6m": mom_6, "3m": mom_3, "accelerating": accelerating},
            "quality": {"f_score": f_score},
            "technical": {"rsi": rsi, "overbought": overbought},
            "iv_rank": iv_rank,
        }

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        """Generate a buy signal if score and conviction pass thresholds."""
        score = analysis.get("score", 0)
        conviction = analysis.get("conviction", "low")

        if score < 25 or conviction == "low":
            return None

        return {
            "symbol": analysis["symbol"],
            "direction": "bullish",
            "strength": score,
            "conviction": conviction,
            "timeframe": "swing",
            "holding_period_days": 30,
            "analysis": analysis,
        }

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        """Map bullish signal to a vertical spread or long equity position."""
        symbol = signal["symbol"]
        equity = portfolio.get("equity", 100_000)
        max_risk = equity * 0.015  # 1.5% risk per trade

        iv_rank = signal.get("analysis", {}).get("iv_rank", 50)

        if iv_rank > 40:
            # Sell premium: bull put spread
            structure = "bull_put_spread"
            target_delta_short = 0.30
            spread_width = 5.0  # $5 wide
            max_contracts = int(max_risk / (spread_width * 100))
            max_contracts = max(1, max_contracts)

            return {
                "symbol": symbol,
                "strategy": self.name,
                "structure": structure,
                "direction": "bullish",
                "legs": [
                    {"action": "sell", "type": "put", "delta_target": target_delta_short},
                    {"action": "buy", "type": "put", "delta_target": target_delta_short - 0.15},
                ],
                "quantity": max_contracts,
                "max_risk": max_contracts * spread_width * 100,
                "target_dte": 30,
                "exit_rules": {
                    "profit_target_pct": 50,
                    "stop_loss_pct": 200,
                    "dte_exit": 7,
                },
            }
        else:
            # Buy premium: bull call spread
            structure = "bull_call_spread"
            spread_width = 5.0
            max_contracts = int(max_risk / (spread_width * 100 * 0.4))  # debit ~40% of width
            max_contracts = max(1, max_contracts)

            return {
                "symbol": symbol,
                "strategy": self.name,
                "structure": structure,
                "direction": "bullish",
                "legs": [
                    {"action": "buy", "type": "call", "delta_target": 0.55},
                    {"action": "sell", "type": "call", "delta_target": 0.35},
                ],
                "quantity": max_contracts,
                "max_risk": max_contracts * spread_width * 100 * 0.4,
                "target_dte": 45,
                "exit_rules": {
                    "profit_target_pct": 75,
                    "stop_loss_pct": 50,
                    "dte_exit": 14,
                },
            }

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        """Manage an open momentum quality position."""
        pnl_pct = position.get("pnl_pct", 0)
        dte = position.get("dte", 30)
        exit_rules = position.get("exit_rules", {})

        profit_target = exit_rules.get("profit_target_pct", 50)
        stop_loss = exit_rules.get("stop_loss_pct", 200)
        dte_exit = exit_rules.get("dte_exit", 7)

        if pnl_pct >= profit_target:
            return {"action": "close", "reason": f"Profit target reached ({pnl_pct:.0f}%)"}

        if pnl_pct <= -stop_loss:
            return {"action": "close", "reason": f"Stop loss hit ({pnl_pct:.0f}%)"}

        if dte <= dte_exit:
            return {"action": "close", "reason": f"DTE threshold reached ({dte} days)"}

        # Check if momentum has reversed
        momentum_1m = market_data.get("momentum_1m", 0)
        if momentum_1m < -0.10:
            return {"action": "close", "reason": "Momentum reversal detected"}

        return {"action": "hold", "reason": "Within parameters"}
