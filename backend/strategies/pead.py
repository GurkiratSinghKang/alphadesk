from __future__ import annotations

from typing import Any

from strategies.base import BaseStrategy


class PEADStrategy(BaseStrategy):
    """Post-Earnings Announcement Drift strategy.

    Exploits the well-documented anomaly where stocks that beat/miss earnings
    estimates tend to drift in the direction of the surprise over the following
    20-60 trading days. Enters directional positions after earnings release
    when the surprise magnitude and volume confirm the drift.
    """

    name = "pead"
    description = "Post-earnings announcement drift with directional options"
    default_timeframe = "swing"

    # Parameters
    MIN_SURPRISE_PCT = 5.0    # minimum earnings surprise to trigger
    MIN_REVENUE_BEAT = True   # require revenue beat alongside EPS
    MIN_VOLUME_RATIO = 1.5    # earnings day volume vs 20d avg
    DRIFT_WINDOW_DAYS = 40    # expected drift duration
    MAX_ENTRY_DELAY = 3       # days after earnings to enter

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Screen for stocks that recently reported earnings with a significant surprise."""
        candidates = []
        for t in universe:
            # Must have recent earnings
            days_since_earnings = t.get("days_since_earnings")
            if days_since_earnings is None or days_since_earnings > self.MAX_ENTRY_DELAY:
                continue

            # Surprise magnitude
            eps_surprise_pct = abs(t.get("eps_surprise_pct", 0) or 0)
            if eps_surprise_pct < self.MIN_SURPRISE_PCT:
                continue

            # Revenue confirmation
            if self.MIN_REVENUE_BEAT and not t.get("revenue_beat", False):
                continue

            # Volume confirmation
            vol_ratio = t.get("earnings_volume_ratio", 1)
            if vol_ratio < self.MIN_VOLUME_RATIO:
                continue

            # Guidance matters
            guidance = t.get("guidance", "maintained")
            guidance_bonus = 0.2 if guidance == "raised" else -0.1 if guidance == "lowered" else 0

            surprise = t.get("eps_surprise_pct", 0) or 0
            t["composite_score"] = round(abs(surprise) / 10 + guidance_bonus + vol_ratio / 5, 4)
            t["drift_direction"] = "bullish" if surprise > 0 else "bearish"
            candidates.append(t)

        candidates.sort(key=lambda x: x["composite_score"], reverse=True)
        return candidates[:20]

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Confirm drift setup with volume and price action analysis."""
        surprise_pct = data.get("eps_surprise_pct", 0)
        direction = "bullish" if surprise_pct > 0 else "bearish"
        vol_ratio = data.get("earnings_volume_ratio", 1)
        gap_pct = data.get("earnings_gap_pct", 0)

        # Historical drift analysis for this stock
        hist_drift = data.get("historical_drift", [])
        avg_drift = sum(hist_drift) / len(hist_drift) if hist_drift else 0

        # Score the setup
        score = min(100, abs(surprise_pct) * 3)
        if vol_ratio > 2:
            score += 10
        if data.get("guidance") == "raised":
            score += 15
        if data.get("analyst_revisions_up", 0) > 2:
            score += 10

        if direction == "bearish":
            score = -score

        return {
            "symbol": symbol,
            "score": round(score, 1),
            "conviction": "high" if abs(score) > 60 else "medium" if abs(score) > 30 else "low",
            "direction": direction,
            "surprise_pct": surprise_pct,
            "volume_ratio": vol_ratio,
            "gap_pct": gap_pct,
            "historical_avg_drift": avg_drift,
            "guidance": data.get("guidance", "unknown"),
        }

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        score = analysis.get("score", 0)
        if abs(score) < 30:
            return None

        return {
            "symbol": analysis["symbol"],
            "direction": analysis["direction"],
            "strength": abs(score),
            "conviction": analysis["conviction"],
            "timeframe": "swing",
            "holding_period_days": self.DRIFT_WINDOW_DAYS,
            "analysis": analysis,
        }

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        """Map PEAD signal to a directional vertical spread.

        Post-earnings IV is typically crushed, so we lean toward debit spreads
        to benefit from directional move + any IV recovery.
        """
        symbol = signal["symbol"]
        equity = portfolio.get("equity", 100_000)
        max_risk = equity * 0.01  # 1% per PEAD trade

        is_bullish = signal["direction"] == "bullish"

        if is_bullish:
            structure = "bull_call_spread"
            legs = [
                {"action": "buy", "type": "call", "delta_target": 0.55},
                {"action": "sell", "type": "call", "delta_target": 0.30},
            ]
        else:
            structure = "bear_put_spread"
            legs = [
                {"action": "buy", "type": "put", "delta_target": -0.55},
                {"action": "sell", "type": "put", "delta_target": -0.30},
            ]

        return {
            "symbol": symbol,
            "strategy": self.name,
            "structure": structure,
            "direction": signal["direction"],
            "legs": legs,
            "quantity": max(1, int(max_risk / 250)),  # rough sizing
            "max_risk": max_risk,
            "target_dte": 45,
            "exit_rules": {
                "profit_target_pct": 75,
                "stop_loss_pct": 100,
                "time_exit_days": self.DRIFT_WINDOW_DAYS,
            },
        }

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        pnl_pct = position.get("pnl_pct", 0)
        days_held = position.get("days_held", 0)
        exit_rules = position.get("exit_rules", {})

        if pnl_pct >= exit_rules.get("profit_target_pct", 75):
            return {"action": "close", "reason": "Profit target reached"}

        if pnl_pct <= -exit_rules.get("stop_loss_pct", 100):
            return {"action": "close", "reason": "Stop loss triggered"}

        if days_held >= exit_rules.get("time_exit_days", self.DRIFT_WINDOW_DAYS):
            return {"action": "close", "reason": "Drift window expired"}

        # If drift is progressing well at halfway point, tighten stop
        if days_held > self.DRIFT_WINDOW_DAYS / 2 and pnl_pct > 30:
            return {"action": "adjust", "reason": "Tighten stop to breakeven", "new_stop_pct": 0}

        return {"action": "hold", "reason": "Within drift window"}
