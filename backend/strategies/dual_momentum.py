"""Cross-Sectional Dual Momentum Strategy (Jegadeesh & Titman 1993 / Antonacci 2014).

Combines relative momentum (rank stocks by 12-1 month returns, buy top quintile)
with absolute momentum (only hold if 12-month return > 0). Monthly rebalance.

Academic source: Jegadeesh & Titman "Returns to Buying Winners and Selling Losers",
Journal of Finance (7,940+ citations). Practical framework from Antonacci
"Dual Momentum Investing" (NAAIM first-place winner 2012).

Enhancements:
- Volatility-adjusted momentum: weight by inverse vol for risk-adjusted ranking
- Sector diversification: max 3 stocks from the same sector in top quintile
- SPY absolute momentum filter: check market regime before entering
- Kelly Criterion approximation for position sizing
"""
from __future__ import annotations

import math
from typing import Any

from strategies.base import BaseStrategy


class DualMomentumStrategy(BaseStrategy):
    """Top-quintile relative strength + absolute momentum filter."""

    name = "dual_momentum"
    description = (
        "Dual momentum: ranks stocks by vol-adjusted 12-1 month return, buys "
        "top quintile with positive absolute momentum. Sector-diversified, "
        "Kelly-sized. Monthly rebalance."
    )
    default_timeframe = "position"

    # Parameters (Jegadeesh & Titman / Antonacci defaults)
    LOOKBACK_MONTHS = 12
    SKIP_MONTHS = 1             # skip most recent month (reversal)
    TOP_QUINTILE_PCT = 0.20     # top 20%
    ABS_MOMENTUM_THRESHOLD = 0  # 12-month return > 0
    MIN_MARKET_CAP = 2_000_000_000
    MIN_AVG_VOLUME = 500_000
    MAX_PER_SECTOR = 3          # sector diversification cap
    TARGET_VOL = 0.15           # target annualized volatility
    KELLY_FRACTION = 0.25       # quarter-Kelly for conservative sizing

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Rank universe by vol-adjusted 12-1 month momentum, select top quintile.

        Enhancements:
        - Volatility-adjusted momentum for risk-adjusted ranking
        - Sector diversification cap (max MAX_PER_SECTOR per sector)
        - SPY market regime check via spy_closes in universe data
        """
        # --- SPY market regime check ---
        # If SPY data is passed in the universe, check its 12-month return
        spy_data = next((t for t in universe if t.get("symbol") == "SPY"), None)
        if spy_data:
            spy_closes = spy_data.get("closes", [])
            if len(spy_closes) >= 252:
                spy_ret = (spy_closes[-1] / spy_closes[-252] - 1) * 100
                if spy_ret < 0:
                    return []  # bear regime, stay in cash

        eligible = []
        for t in universe:
            if t.get("symbol") == "SPY":
                continue  # don't include SPY itself
            if (t.get("market_cap", 0) or 0) < self.MIN_MARKET_CAP:
                continue
            if (t.get("avg_volume", 0) or 0) < self.MIN_AVG_VOLUME:
                continue
            eligible.append(t)

        # Compute 12-1 month momentum and volatility for ranking
        for t in eligible:
            closes = t.get("closes", [])
            mom_12m = t.get("momentum_12m", 0) or 0
            mom_1m = t.get("momentum_1m", 0) or 0

            if len(closes) >= 252:
                ret_12_1 = (closes[-22] / closes[-252] - 1) * 100 if closes[-252] > 0 else 0
                ret_12 = (closes[-1] / closes[-252] - 1) * 100 if closes[-252] > 0 else 0
            else:
                ret_12_1 = mom_12m - mom_1m
                ret_12 = mom_12m

            # Realized volatility (60-day annualized)
            realized_vol = 0.20
            if len(closes) >= 60:
                daily_rets = [
                    closes[i] / closes[i - 1] - 1
                    for i in range(-59, 0)
                    if closes[i - 1] > 0
                ]
                if daily_rets:
                    mean_r = sum(daily_rets) / len(daily_rets)
                    var = sum((r - mean_r) ** 2 for r in daily_rets) / len(daily_rets)
                    realized_vol = math.sqrt(var * 252)

            # Volatility-adjusted momentum: scale by inverse vol
            inv_vol = (self.TARGET_VOL / realized_vol) if realized_vol > 0 else 1.0
            vol_adj_mom = ret_12_1 * inv_vol

            t["_momentum_12_1"] = ret_12_1
            t["_momentum_12"] = ret_12
            t["_realized_vol"] = realized_vol
            t["_vol_adj_mom"] = vol_adj_mom
            t["_daily_rets"] = daily_rets if len(closes) >= 60 else []

        # Rank by volatility-adjusted momentum (risk-adjusted ranking)
        eligible.sort(key=lambda x: x.get("_vol_adj_mom", 0), reverse=True)

        # Top quintile
        n_select = max(1, int(len(eligible) * self.TOP_QUINTILE_PCT))
        top_quintile = eligible[:n_select]

        # Absolute momentum filter: only keep if 12-month return > 0
        filtered = [
            t for t in top_quintile
            if t.get("_momentum_12", 0) > self.ABS_MOMENTUM_THRESHOLD
        ]

        # --- Sector diversification: cap at MAX_PER_SECTOR per sector ---
        sector_counts: dict[str, int] = {}
        diversified = []
        for t in filtered:
            sector = t.get("sector", "Unknown")
            count = sector_counts.get(sector, 0)
            if count >= self.MAX_PER_SECTOR:
                continue
            sector_counts[sector] = count + 1
            diversified.append(t)

        return diversified[:20]

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Score with vol-adjusted momentum and Kelly Criterion sizing."""
        price = data.get("price", 0) or data.get("current_price", 0)
        mom_12_1 = data.get("_momentum_12_1", 0)
        mom_12 = data.get("_momentum_12", 0)
        vol_adj_mom = data.get("_vol_adj_mom", 0)
        rs_score = data.get("metrics", {}).get("rs_score", 50) if isinstance(data.get("metrics"), dict) else 50

        # Score components: use vol-adjusted momentum as primary signal
        relative_score = min(40, vol_adj_mom * 1.2)  # vol-adjusted momentum
        absolute_score = min(30, mom_12 * 1.0)       # absolute momentum
        rs_bonus = (rs_score - 50) * 0.4             # relative strength

        score = relative_score + absolute_score + rs_bonus
        score = max(-100, min(100, score))

        conviction = "high" if score > 55 else "medium" if score > 30 else "low"

        # Realized vol for position sizing
        closes = data.get("closes", [])
        realized_vol = data.get("_realized_vol", 0.20)
        if realized_vol == 0.20 and len(closes) >= 60:
            daily_rets = [
                closes[i] / closes[i - 1] - 1
                for i in range(-59, 0)
                if closes[i - 1] > 0
            ]
            if daily_rets:
                mean_r = sum(daily_rets) / len(daily_rets)
                var = sum((r - mean_r) ** 2 for r in daily_rets) / len(daily_rets)
                realized_vol = math.sqrt(var * 252)

        # --- Kelly Criterion approximation ---
        daily_rets = data.get("_daily_rets", [])
        if not daily_rets and len(closes) >= 60:
            daily_rets = [
                closes[i] / closes[i - 1] - 1
                for i in range(max(1, len(closes) - 60), len(closes))
                if closes[i - 1] > 0
            ]
        if daily_rets:
            wins = [r for r in daily_rets if r > 0]
            losses = [r for r in daily_rets if r < 0]
            win_rate = len(wins) / len(daily_rets) if daily_rets else 0.5
            avg_win = sum(wins) / len(wins) if wins else 0.01
            avg_loss = abs(sum(losses) / len(losses)) if losses else 0.01
            payoff_ratio = avg_win / avg_loss if avg_loss > 0 else 1.0
            kelly_full = (win_rate * payoff_ratio - (1 - win_rate)) / payoff_ratio
            kelly_pct = max(0.02, min(0.10, kelly_full * self.KELLY_FRACTION))
        else:
            kelly_pct = 0.05  # default 5% position

        return {
            "symbol": symbol,
            "score": round(score, 1),
            "conviction": conviction,
            "price": price,
            "momentum_12_1": round(mom_12_1, 2),
            "momentum_12": round(mom_12, 2),
            "vol_adj_momentum": round(vol_adj_mom, 2),
            "rs_score": rs_score,
            "realized_vol": round(realized_vol, 4),
            "kelly_pct": round(kelly_pct, 4),
        }

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        if analysis.get("score", 0) < 30:
            return None
        if analysis.get("conviction") == "low":
            return None
        # Must have positive absolute momentum
        if analysis.get("momentum_12", 0) <= 0:
            return None

        return {
            "symbol": analysis["symbol"],
            "direction": "bullish",
            "strength": analysis["score"],
            "conviction": analysis["conviction"],
            "timeframe": "position",
            "holding_period_days": 30,  # monthly rebalance
            "analysis": analysis,
        }

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        symbol = signal["symbol"]
        analysis = signal.get("analysis", {})
        equity = portfolio.get("equity", 100_000)
        price = analysis.get("price", 100)
        realized_vol = analysis.get("realized_vol", 0.20)
        kelly_pct = analysis.get("kelly_pct", 0.05)

        # Kelly-sized position with inverse-volatility adjustment
        notional = equity * kelly_pct

        # Inverse-volatility normalization on top of Kelly
        if realized_vol > 0:
            vol_adj = self.TARGET_VOL / realized_vol
            vol_adj = max(0.5, min(2.0, vol_adj))
            notional *= vol_adj

        notional = min(notional, equity * 0.10)  # max 10% per position
        shares = max(1, int(notional / price)) if price > 0 else 0
        actual_notional = shares * price

        stop_loss = round(price * 0.92, 2)   # 8% stop (wider for momentum)
        take_profit = round(price * 1.20, 2)  # 20% target

        return {
            "symbol": symbol,
            "strategy": self.name,
            "structure": "long_equity",
            "direction": "bullish",
            "shares": shares,
            "notional": round(actual_notional, 2),
            "entry_price": price,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
            "exit_rules": {
                "monthly_rebalance": True,
                "absolute_momentum_exit": True,
                "spy_regime_exit": True,
                "max_hold_days": 30,
                "sizing_method": "kelly_quarter",
            },
        }

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        pnl_pct = position.get("pnl_pct", 0)
        days_held = position.get("days_held", 0)
        mom_12 = market_data.get("momentum_12", 0)

        # Monthly rebalance: re-rank at 30 days
        if days_held >= 30:
            return {"action": "close", "reason": "Monthly rebalance — re-rank required"}

        # Absolute momentum filter: exit if 12-month return turns negative
        if mom_12 < 0:
            return {"action": "close", "reason": "Absolute momentum turned negative"}

        # SPY regime check: exit if SPY absolute momentum turns negative
        spy_mom_12 = market_data.get("spy_momentum_12", None)
        if spy_mom_12 is not None and spy_mom_12 < 0:
            return {"action": "close", "reason": "SPY absolute momentum negative — bear regime"}

        # Stop loss
        if pnl_pct <= -8:
            return {"action": "close", "reason": f"Stop loss hit ({pnl_pct:.1f}%)"}

        # Profit target
        if pnl_pct >= 20:
            return {"action": "close", "reason": f"Profit target reached ({pnl_pct:.1f}%)"}

        return {"action": "hold", "reason": "Within momentum holding period"}
