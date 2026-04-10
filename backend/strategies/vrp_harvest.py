from __future__ import annotations

from typing import Any

from strategies.base import BaseStrategy


class VRPHarvestStrategy(BaseStrategy):
    """Systematic Volatility Risk Premium harvesting.

    Sells options premium on liquid underlyings where implied volatility
    consistently overestimates realised volatility. Uses iron condors,
    strangles, and put spreads with strict risk management.
    """

    name = "vrp_harvest"
    description = "Systematic premium selling via VRP on high IV-rank underlyings"
    default_timeframe = "swing"
    min_iv_rank = 40.0

    # Parameters
    TARGET_DTE = 45
    MIN_IV_RANK = 40
    MIN_VRP = 0.03            # IV must exceed HV by at least 3 vol points
    TARGET_DELTA = 0.16       # ~84% POP for short strikes
    MAX_PORTFOLIO_THETA = 0.003  # max daily theta as % of portfolio

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Screen for underlyings with elevated IV rank and positive VRP."""
        candidates = []
        for t in universe:
            iv_rank = t.get("iv_rank", 0) or 0
            if iv_rank < self.MIN_IV_RANK:
                continue

            # VRP check: IV must meaningfully exceed realised vol
            current_iv = t.get("current_iv", 0) or 0
            hv_20 = t.get("hv_20", 0) or 0
            vrp = current_iv - hv_20
            if vrp < self.MIN_VRP:
                continue

            # Avoid earnings within 2 weeks
            days_to_earnings = t.get("days_to_earnings")
            if days_to_earnings is not None and days_to_earnings < 14:
                continue

            # Liquidity: need tight options spreads
            avg_option_volume = t.get("avg_option_volume", 0) or 0
            if avg_option_volume < 1000:
                continue

            t["vrp"] = round(vrp, 4)
            t["composite_score"] = round(iv_rank / 100 * 0.4 + vrp * 5 * 0.4 + (avg_option_volume / 10000) * 0.2, 4)
            candidates.append(t)

        candidates.sort(key=lambda x: x["composite_score"], reverse=True)
        return candidates[:30]

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Analyse VRP persistence and optimal structure for premium selling."""
        iv_rank = data.get("iv_rank", 50)
        vrp = data.get("vrp", 0)
        iv_percentile = data.get("iv_percentile", 50)
        term_structure = data.get("term_structure", {})

        # Check if term structure is in contango (normal for VRP)
        contango = True
        if term_structure:
            ivs = list(term_structure.values())
            if len(ivs) >= 2 and ivs[0] > ivs[-1]:
                contango = False  # backwardation = caution

        # Score the setup
        score = min(80, iv_rank * 0.5 + vrp * 200)
        if contango:
            score += 10
        if iv_percentile > 70:
            score += 10

        return {
            "symbol": symbol,
            "score": round(score, 1),
            "conviction": "high" if score > 60 else "medium" if score > 35 else "low",
            "iv_rank": iv_rank,
            "iv_percentile": iv_percentile,
            "vrp": vrp,
            "contango": contango,
            "structure_preference": "iron_condor" if iv_rank > 60 else "put_spread",
        }

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        if analysis.get("score", 0) < 35 or analysis.get("conviction") == "low":
            return None

        return {
            "symbol": analysis["symbol"],
            "direction": "neutral",
            "strength": analysis["score"],
            "conviction": analysis["conviction"],
            "timeframe": "swing",
            "holding_period_days": self.TARGET_DTE,
            "structure": analysis.get("structure_preference", "iron_condor"),
            "analysis": analysis,
        }

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        """Map VRP signal to iron condor or put spread."""
        symbol = signal["symbol"]
        equity = portfolio.get("equity", 100_000)
        max_risk = equity * 0.02
        structure = signal.get("structure", "iron_condor")

        if structure == "iron_condor":
            legs = [
                {"action": "sell", "type": "put", "delta_target": -self.TARGET_DELTA},
                {"action": "buy", "type": "put", "delta_target": -self.TARGET_DELTA - 0.05},
                {"action": "sell", "type": "call", "delta_target": self.TARGET_DELTA},
                {"action": "buy", "type": "call", "delta_target": self.TARGET_DELTA + 0.05},
            ]
            spread_width = 5.0
            max_contracts = int(max_risk / (spread_width * 100))
        else:
            # Bull put spread only (neutral-bullish bias)
            legs = [
                {"action": "sell", "type": "put", "delta_target": -0.25},
                {"action": "buy", "type": "put", "delta_target": -0.10},
            ]
            spread_width = 5.0
            max_contracts = int(max_risk / (spread_width * 100))

        max_contracts = max(1, max_contracts)

        return {
            "symbol": symbol,
            "strategy": self.name,
            "structure": structure,
            "direction": "neutral",
            "legs": legs,
            "quantity": max_contracts,
            "max_risk": max_contracts * spread_width * 100,
            "target_dte": self.TARGET_DTE,
            "exit_rules": {
                "profit_target_pct": 50,  # close at 50% of max profit
                "stop_loss_multiplier": 2.0,  # lose 2x credit received
                "dte_exit": 21,  # close with 21 DTE remaining
            },
        }

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        pnl_pct = position.get("pnl_pct", 0)
        dte = position.get("dte", 45)
        exit_rules = position.get("exit_rules", {})

        # Take profit at 50% of max
        if pnl_pct >= exit_rules.get("profit_target_pct", 50):
            return {"action": "close", "reason": f"Profit target reached ({pnl_pct:.0f}%)"}

        # Stop loss at 2x credit
        max_loss_pct = exit_rules.get("stop_loss_multiplier", 2.0) * 100
        if pnl_pct <= -max_loss_pct:
            return {"action": "close", "reason": f"Stop loss triggered ({pnl_pct:.0f}%)"}

        # Time-based exit
        if dte <= exit_rules.get("dte_exit", 21):
            if pnl_pct > 0:
                return {"action": "close", "reason": "DTE exit with profit"}
            else:
                return {"action": "roll", "reason": "Roll to next cycle", "target_dte": self.TARGET_DTE}

        # Approaching short strike -- roll untested side
        short_delta = position.get("short_delta", 0.16)
        if abs(short_delta) > 0.35:
            return {"action": "adjust", "reason": "Short strike breached, rolling tested side"}

        return {"action": "hold", "reason": "Within parameters"}
