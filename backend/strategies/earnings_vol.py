from __future__ import annotations

from typing import Any

from strategies.base import BaseStrategy


class EarningsVolStrategy(BaseStrategy):
    """Earnings volatility premium strategy.

    Exploits the tendency for implied volatility to overprice earnings events.
    Sells premium via iron butterflies or straddles before earnings, then
    captures the IV crush. Requires careful sizing due to gap risk.
    """

    name = "earnings_vol"
    description = "Sell earnings-event IV premium via defined-risk structures"
    default_timeframe = "day"
    min_iv_rank = 50.0

    # Parameters
    ENTRY_DAYS_BEFORE = 3  # enter 1-3 days before earnings
    MIN_IV_CRUSH_ESTIMATE = 0.15  # expect at least 15% IV drop
    MAX_EXPECTED_MOVE_OVERPRICE = 0.20  # options price > historical by 20%+

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Screen for upcoming earnings with overpriced IV."""
        candidates = []
        for t in universe:
            days_to_earnings = t.get("days_to_earnings")
            if days_to_earnings is None or days_to_earnings > self.ENTRY_DAYS_BEFORE or days_to_earnings < 0:
                continue

            # IV must be elevated
            iv_rank = t.get("iv_rank", 0) or 0
            if iv_rank < 50:
                continue

            # Compare expected move to historical
            expected_move_pct = t.get("expected_move_pct", 0) or 0
            avg_historical_move = t.get("avg_historical_earnings_move", 0) or 0
            if avg_historical_move <= 0:
                continue

            overprice_ratio = (expected_move_pct / avg_historical_move) - 1
            if overprice_ratio < self.MAX_EXPECTED_MOVE_OVERPRICE:
                continue

            # Options liquidity
            if (t.get("avg_option_volume", 0) or 0) < 5000:
                continue

            t["overprice_ratio"] = round(overprice_ratio, 4)
            t["composite_score"] = round(overprice_ratio * 50 + iv_rank / 100 * 30, 4)
            candidates.append(t)

        candidates.sort(key=lambda x: x["composite_score"], reverse=True)
        return candidates[:10]

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Analyse the earnings IV premium setup."""
        expected_move = data.get("expected_move_pct", 0)
        historical_avg = data.get("avg_historical_earnings_move", 0)
        iv_rank = data.get("iv_rank", 50)
        overprice = data.get("overprice_ratio", 0)

        # Historical win rate of selling earnings premium
        hist_earnings = data.get("earnings_straddle_history", [])
        if hist_earnings:
            wins = sum(1 for h in hist_earnings if h.get("straddle_profitable", False))
            win_rate = wins / len(hist_earnings) * 100
        else:
            win_rate = 65  # typical base rate

        score = min(80, overprice * 100 + win_rate / 5)
        conviction = "high" if score > 55 and win_rate > 60 else "medium"

        return {
            "symbol": symbol,
            "score": round(score, 1),
            "conviction": conviction,
            "expected_move_pct": expected_move,
            "historical_avg_move": historical_avg,
            "overprice_ratio": overprice,
            "iv_rank": iv_rank,
            "historical_win_rate": round(win_rate, 1),
        }

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        if analysis.get("score", 0) < 30:
            return None

        return {
            "symbol": analysis["symbol"],
            "direction": "neutral",
            "strength": analysis["score"],
            "conviction": analysis["conviction"],
            "timeframe": "day",
            "holding_period_days": 2,  # close day after earnings
            "analysis": analysis,
        }

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        """Map to an iron butterfly or short straddle + wings for earnings."""
        symbol = signal["symbol"]
        equity = portfolio.get("equity", 100_000)
        max_risk = equity * 0.01  # conservative: 1% for earnings plays

        # Iron butterfly: sell ATM straddle, buy wings
        legs = [
            {"action": "sell", "type": "call", "delta_target": 0.50},
            {"action": "sell", "type": "put", "delta_target": -0.50},
            {"action": "buy", "type": "call", "delta_target": 0.20},
            {"action": "buy", "type": "put", "delta_target": -0.20},
        ]

        wing_width = signal.get("analysis", {}).get("expected_move_pct", 5) * 1.2
        max_contracts = max(1, int(max_risk / (wing_width * 100)))

        return {
            "symbol": symbol,
            "strategy": self.name,
            "structure": "iron_butterfly",
            "direction": "neutral",
            "legs": legs,
            "quantity": max_contracts,
            "max_risk": max_risk,
            "target_dte": 3,  # use nearest weekly expiry
            "exit_rules": {
                "exit_timing": "next_market_open",  # close morning after earnings
                "profit_target_pct": 30,  # take 30% of credit quickly
                "stop_loss_multiplier": 1.5,
            },
            "notes": "Close at next open after earnings. Do not hold through second session.",
        }

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        """Manage earnings vol position. Key rule: close morning after earnings."""
        earnings_reported = market_data.get("earnings_reported", False)
        pnl_pct = position.get("pnl_pct", 0)

        if earnings_reported:
            return {"action": "close", "reason": "Earnings reported, closing to capture IV crush"}

        exit_rules = position.get("exit_rules", {})
        if pnl_pct >= exit_rules.get("profit_target_pct", 30):
            return {"action": "close", "reason": "Profit target reached before earnings"}

        max_loss = exit_rules.get("stop_loss_multiplier", 1.5) * 100
        if pnl_pct <= -max_loss:
            return {"action": "close", "reason": "Pre-earnings stop triggered"}

        return {"action": "hold", "reason": "Awaiting earnings release"}
