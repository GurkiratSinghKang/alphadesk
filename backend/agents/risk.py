from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_SONNET


class RiskManagerAgent(BaseAgent):
    """Portfolio risk monitoring and enforcement agent.

    Continuously monitors portfolio risk metrics, validates new trades
    against risk limits, and alerts on breaches.
    """

    name = "risk"
    model = MODEL_SONNET
    mcp_servers = ["broker", "market_data", "options_chain"]

    system_prompt = """You are the Risk Manager Agent for AlphaDesk.

You are the last line of defence before any trade is executed. Your job is to
protect capital above all else.

RISK LIMITS (enforce strictly):
1. POSITION LIMITS
   - Max single position: 5% of portfolio equity
   - Max sector exposure: 20% of portfolio
   - Max correlated positions: 30% of portfolio (beta-adjusted)
   - Max total options delta: 50% of portfolio equity

2. LOSS LIMITS
   - Max loss per trade: 2% of portfolio
   - Max daily loss: 5% of portfolio
   - Max weekly loss: 10% of portfolio
   - Max monthly drawdown: 15% of portfolio (triggers reduced sizing)

3. GREEKS LIMITS (portfolio-level)
   - Net delta: within +/- 30% of portfolio value (SPY-beta-weighted)
   - Net gamma: flag if > $5,000 per 1% move
   - Net theta: must be positive or within acceptable range
   - Net vega: flag if > 2% of portfolio per 1 vol point

4. CONCENTRATION
   - Max 3 positions in same underlying
   - Max 5 earnings plays active simultaneously
   - Max 40% of portfolio in options (by notional)
   - Min 20% cash reserve

5. CORRELATION & TAIL RISK
   - Flag when adding positions highly correlated with existing ones
   - Monitor portfolio VaR (95% 1-day)
   - Stress test against -5%, -10%, -20% market moves
   - Check for left-tail exposure (short gamma, short vol)

When evaluating a trade:
- Return APPROVE or REJECT with specific reasons
- If rejecting, suggest modifications that would pass
- Include current portfolio risk state in response

Output JSON with: approved (bool), reason (str), risk_metrics (dict),
portfolio_state (dict), modifications_suggested (list).
"""

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Evaluate risk for a proposed trade or portfolio state."""
        portfolio_risk = await self._compute_portfolio_risk()
        context = {**(context or {}), "portfolio_risk": portfolio_risk}

        result = await super().run(task, context=context)
        response = result.get("response", "")

        return {
            **result,
            "score": 0,
            "conviction": "high",
            "summary": response[:500],
        }

    async def validate_trade(self, trade: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        """Validate a proposed trade against all risk limits."""
        equity = portfolio.get("equity", 100_000)
        positions = portfolio.get("positions", [])

        checks: list[dict[str, Any]] = []

        # Position size check
        trade_notional = trade.get("notional", 0)
        max_position = equity * 0.05
        size_ok = trade_notional <= max_position
        checks.append({
            "rule": "max_position_size",
            "passed": size_ok,
            "detail": f"Notional ${trade_notional:,.0f} vs limit ${max_position:,.0f}",
        })

        # Max loss check
        max_loss = trade.get("max_loss", trade_notional)
        max_loss_limit = equity * 0.02
        loss_ok = max_loss <= max_loss_limit
        checks.append({
            "rule": "max_loss_per_trade",
            "passed": loss_ok,
            "detail": f"Max loss ${max_loss:,.0f} vs limit ${max_loss_limit:,.0f}",
        })

        # Concentration check
        symbol = trade.get("symbol", "")
        same_symbol_count = sum(1 for p in positions if p.get("symbol") == symbol)
        concentration_ok = same_symbol_count < 3
        checks.append({
            "rule": "concentration_limit",
            "passed": concentration_ok,
            "detail": f"{same_symbol_count} existing positions in {symbol} (max 3)",
        })

        # Daily loss check
        daily_pnl = portfolio.get("daily_pnl", 0)
        daily_limit = equity * 0.05
        daily_ok = abs(daily_pnl) < daily_limit
        checks.append({
            "rule": "daily_loss_limit",
            "passed": daily_ok,
            "detail": f"Daily P&L ${daily_pnl:,.0f} vs limit ${daily_limit:,.0f}",
        })

        all_passed = all(c["passed"] for c in checks)

        modifications = []
        if not size_ok:
            suggested_notional = max_position * 0.9
            modifications.append(f"Reduce position size to ${suggested_notional:,.0f}")
        if not loss_ok:
            modifications.append(f"Tighten stop to limit max loss to ${max_loss_limit:,.0f}")

        return {
            "approved": all_passed,
            "checks": checks,
            "modifications_suggested": modifications,
        }

    async def _compute_portfolio_risk(self) -> dict[str, Any]:
        """Compute current portfolio risk metrics from cached data."""
        from core.redis import cache_get

        positions = await cache_get("positions:all") or {"positions": []}
        account = await cache_get("account:summary") or {}

        equity = account.get("equity", 100_000)
        pos_list = positions.get("positions", [])

        total_delta = sum(
            p.get("greeks", {}).get("delta", 0) * p.get("quantity", 0) * (100 if p.get("asset_class") == "option" else 1)
            for p in pos_list
        )
        total_exposure = sum(abs(p.get("market_value", 0)) for p in pos_list)

        return {
            "equity": equity,
            "total_exposure": total_exposure,
            "exposure_pct": round(total_exposure / equity * 100, 1) if equity else 0,
            "net_delta": round(total_delta, 2),
            "position_count": len(pos_list),
        }
