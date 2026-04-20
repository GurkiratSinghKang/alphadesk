from __future__ import annotations

from typing import Any

from agents.base import BaseAgent, MODEL_SONNET


class PortfolioAgent(BaseAgent):
    """Performance tracking, analytics, and trade journaling agent."""

    name = "portfolio"
    model = MODEL_SONNET
    mcp_servers = ["broker", "market_data"]

    system_prompt = """You are the Portfolio Agent for AlphaDesk.

You track, analyse, and report on portfolio performance.

Your capabilities:

1. PERFORMANCE ANALYTICS
   - Total return, risk-adjusted returns (Sharpe, Sortino, Calmar)
   - Drawdown analysis (max, current, recovery time)
   - Win rate, profit factor, average win/loss ratio
   - Monthly/weekly/daily P&L breakdown
   - Strategy-level attribution (which strategies drive returns)

2. POSITION ANALYSIS
   - Current positions with P&L and greeks
   - Concentration analysis (by symbol, sector, strategy)
   - Correlation matrix of positions
   - Beta exposure to SPY/QQQ/IWM

3. RISK REPORTING
   - Value at Risk (VaR) - parametric and historical
   - Expected Shortfall (CVaR)
   - Stress test results (-5%, -10%, -20% scenarios)
   - Greeks exposure summary
   - Max potential loss analysis

4. TRADE JOURNAL ANALYSIS
   - Pattern recognition in winning/losing trades
   - Common mistakes identification
   - Strategy performance ranking
   - Time-of-day/week performance patterns
   - Holding period optimisation insights

5. ACTIONABLE RECOMMENDATIONS
   - Positions to review (approaching stop, near target, expiring)
   - Rebalancing suggestions
   - Tax-loss harvesting opportunities
   - Strategy allocation adjustments based on recent performance

Provide clear, data-driven analysis with specific numbers and charts data.
Output JSON with: summary (str), metrics (dict), recommendations (list), score, conviction.

SAFETY: Never suggest market manipulation, wash trading, spoofing, layering,
or misrepresentation to other market participants. Never recommend specific
securities in a way that could be construed as investment advice from a
registered professional. Refuse to execute trades that would violate Reg SHO,
Reg NMS, or other US securities regulations.
"""

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Run portfolio analysis."""
        portfolio_state = await self._get_portfolio_state()
        context = {**(context or {}), "portfolio": portfolio_state}

        result = await super().run(task, context=context)
        response = result.get("response", "")

        return {
            **result,
            "score": 0,
            "conviction": "medium",
            "summary": response[:500],
        }

    async def _get_portfolio_state(self) -> dict[str, Any]:
        """Aggregate portfolio state from broker and local DB."""
        from core.redis import cache_get

        account = await cache_get("account:summary") or {}
        positions = await cache_get("positions:all") or {"positions": []}

        return {
            "equity": account.get("equity", 0),
            "cash": account.get("cash", 0),
            "buying_power": account.get("buying_power", 0),
            "position_count": len(positions.get("positions", [])),
            "positions": positions.get("positions", [])[:20],  # limit for context window
        }

    async def generate_daily_report(self) -> dict[str, Any]:
        """Generate end-of-day portfolio report."""
        import numpy as np
        from core.redis import cache_get

        account = await cache_get("account:summary") or {}
        positions = await cache_get("positions:all") or {"positions": []}
        daily_trades = await cache_get("trades:today") or {"trades": []}

        equity = account.get("equity", 0)
        prev_equity = account.get("last_equity", equity)
        daily_pnl = equity - prev_equity
        daily_pnl_pct = (daily_pnl / prev_equity * 100) if prev_equity else 0

        trades = daily_trades.get("trades", [])
        winning = [t for t in trades if (t.get("pnl", 0) or 0) > 0]
        losing = [t for t in trades if (t.get("pnl", 0) or 0) < 0]

        return {
            "date": "today",
            "equity": equity,
            "daily_pnl": round(daily_pnl, 2),
            "daily_pnl_pct": round(daily_pnl_pct, 2),
            "trades_executed": len(trades),
            "winning_trades": len(winning),
            "losing_trades": len(losing),
            "positions_held": len(positions.get("positions", [])),
            "notable_movers": [],
        }
