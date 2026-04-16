"""Statistical Arbitrage Pairs Trading Strategy (Gatev, Goetzmann & Rouwenhorst 2006).

Identifies cointegrated stock pairs, computes z-score of the spread,
enters when spread deviates beyond 2 standard deviations, exits on
mean reversion. Market-neutral by construction.

Academic source: "Pairs Trading: Performance of a Relative-Value Arbitrage Rule",
Review of Financial Studies. Extended by Avellaneda & Lee (2010)
"Statistical Arbitrage in the US Equities Market", Quantitative Finance.
"""
from __future__ import annotations

import math
from typing import Any

from strategies.base import BaseStrategy


# Pre-defined sector pairs with strong historical cointegration
SECTOR_PAIRS = [
    ("XOM", "CVX"),     # Energy majors
    ("JPM", "BAC"),     # Megabank
    ("KO", "PEP"),      # Beverages
    ("V", "MA"),        # Payment networks
    ("HD", "LOW"),      # Home improvement
    ("MSFT", "AAPL"),   # Mega-cap tech
    ("UNH", "CI"),      # Health insurance
    ("PG", "CL"),       # Consumer staples
    ("GS", "MS"),       # Investment banks
    ("CAT", "DE"),      # Industrial machinery
    ("DIS", "CMCSA"),   # Media/entertainment
    ("T", "VZ"),        # Telecom
    ("AMZN", "WMT"),    # Retail
    ("LIN", "APD"),     # Industrial gases
    ("MMM", "HON"),     # Diversified industrials
]


def _compute_spread_zscore(
    prices_a: list[float],
    prices_b: list[float],
    window: int = 60,
) -> tuple[float, float, float, float]:
    """Compute spread z-score using OLS hedge ratio.

    Returns (zscore, spread, hedge_ratio, half_life).
    """
    if len(prices_a) < window or len(prices_b) < window:
        return 0.0, 0.0, 1.0, 20.0

    a = prices_a[-window:]
    b = prices_b[-window:]

    # OLS hedge ratio: beta = cov(a,b) / var(b)
    mean_a = sum(a) / len(a)
    mean_b = sum(b) / len(b)
    cov = sum((a[i] - mean_a) * (b[i] - mean_b) for i in range(len(a))) / len(a)
    var_b = sum((b[i] - mean_b) ** 2 for i in range(len(b))) / len(b)
    hedge_ratio = cov / var_b if var_b > 0 else 1.0

    # Spread = A - hedge_ratio * B
    spreads = [a[i] - hedge_ratio * b[i] for i in range(len(a))]

    mean_spread = sum(spreads) / len(spreads)
    std_spread = math.sqrt(
        sum((s - mean_spread) ** 2 for s in spreads) / len(spreads)
    )

    current_spread = spreads[-1]
    zscore = (current_spread - mean_spread) / std_spread if std_spread > 0 else 0

    # Half-life estimation (OU process): regress spread_diff on lagged spread
    if len(spreads) > 2:
        diffs = [spreads[i] - spreads[i - 1] for i in range(1, len(spreads))]
        lagged = spreads[:-1]
        mean_lag = sum(lagged) / len(lagged)
        mean_diff = sum(diffs) / len(diffs)
        cov_ld = sum(
            (lagged[i] - mean_lag) * (diffs[i] - mean_diff)
            for i in range(len(diffs))
        ) / len(diffs)
        var_lag = sum((l - mean_lag) ** 2 for l in lagged) / len(lagged)
        theta = cov_ld / var_lag if var_lag > 0 else -0.05
        half_life = -math.log(2) / theta if theta < 0 else 20.0
        half_life = max(1, min(60, half_life))
    else:
        half_life = 20.0

    return zscore, current_spread, hedge_ratio, half_life


class PairsTradingStrategy(BaseStrategy):
    """Cointegration-based pairs trading: market-neutral stat arb."""

    name = "pairs_trading"
    description = (
        "Statistical arbitrage: trades cointegrated stock pairs when spread "
        "z-score exceeds +/-2.0, targeting mean reversion. Market-neutral."
    )
    default_timeframe = "swing"

    # Parameters (Gatev et al. defaults)
    ENTRY_ZSCORE = 2.0
    EXIT_ZSCORE = 0.5
    STOP_ZSCORE = 4.0          # divergence beyond rescue
    ROLLING_WINDOW = 60        # days for z-score computation
    MAX_HOLD_DAYS = 20
    MAX_ACTIVE_PAIRS = 5

    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Return pre-defined sector pairs as candidates."""
        candidates = []
        for sym_a, sym_b in SECTOR_PAIRS:
            candidates.append({
                "symbol": f"{sym_a}/{sym_b}",
                "sym_a": sym_a,
                "sym_b": sym_b,
                "pair": True,
            })
        return candidates

    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Compute z-score of the pair's spread."""
        sym_a = data.get("sym_a", "")
        sym_b = data.get("sym_b", "")
        prices_a = data.get("prices_a", [])
        prices_b = data.get("prices_b", [])

        if not prices_a or not prices_b:
            return {"symbol": symbol, "score": 0, "conviction": "low",
                    "signal": "no_data", "sym_a": sym_a, "sym_b": sym_b}

        zscore, spread, hedge_ratio, half_life = _compute_spread_zscore(
            prices_a, prices_b, self.ROLLING_WINDOW
        )

        # Score: higher absolute z-score = stronger signal
        abs_z = abs(zscore)
        if abs_z >= self.ENTRY_ZSCORE:
            score = min(90, 40 + (abs_z - self.ENTRY_ZSCORE) * 20)
        elif abs_z >= 1.5:
            score = 25  # watching
        else:
            score = 0

        # Direction: negative z = spread below mean → buy A, sell B
        direction = "long_spread" if zscore < -self.ENTRY_ZSCORE else \
                    "short_spread" if zscore > self.ENTRY_ZSCORE else "none"

        conviction = "high" if abs_z >= 2.5 else "medium" if abs_z >= 2.0 else "low"

        return {
            "symbol": symbol,
            "sym_a": sym_a,
            "sym_b": sym_b,
            "score": round(score, 1),
            "conviction": conviction,
            "zscore": round(zscore, 3),
            "spread": round(spread, 4),
            "hedge_ratio": round(hedge_ratio, 4),
            "half_life": round(half_life, 1),
            "direction": direction,
            "price_a": prices_a[-1] if prices_a else 0,
            "price_b": prices_b[-1] if prices_b else 0,
        }

    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        if analysis.get("signal") == "no_data":
            return None
        if analysis.get("direction") == "none":
            return None
        if abs(analysis.get("zscore", 0)) < self.ENTRY_ZSCORE:
            return None
        if analysis.get("score", 0) < 35:
            return None

        return {
            "symbol": analysis["symbol"],
            "direction": analysis["direction"],
            "strength": analysis["score"],
            "conviction": analysis["conviction"],
            "timeframe": "swing",
            "holding_period_days": int(analysis.get("half_life", 10)),
            "analysis": analysis,
        }

    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        analysis = signal.get("analysis", {})
        equity = portfolio.get("equity", 100_000)
        sym_a = analysis.get("sym_a", "")
        sym_b = analysis.get("sym_b", "")
        price_a = analysis.get("price_a", 100)
        price_b = analysis.get("price_b", 100)
        hedge_ratio = analysis.get("hedge_ratio", 1.0)
        direction = signal.get("direction", "long_spread")

        # Dollar-neutral: equal dollar amount long and short
        notional_per_leg = min(equity * 0.03, 5000)  # 3% per leg, max $5k

        shares_a = max(1, int(notional_per_leg / price_a)) if price_a > 0 else 0
        shares_b = max(1, int(notional_per_leg * abs(hedge_ratio) / price_b)) if price_b > 0 else 0

        if direction == "long_spread":
            # Buy A, sell B (spread below mean)
            return {
                "symbol": f"{sym_a}/{sym_b}",
                "strategy": self.name,
                "structure": "pairs_trade",
                "direction": direction,
                "legs": [
                    {"symbol": sym_a, "side": "buy", "shares": shares_a},
                    {"symbol": sym_b, "side": "sell", "shares": shares_b},
                ],
                "hedge_ratio": hedge_ratio,
                "notional": round(notional_per_leg * 2, 2),
                "entry_zscore": analysis.get("zscore", 0),
                "exit_rules": {
                    "exit_zscore": self.EXIT_ZSCORE,
                    "stop_zscore": self.STOP_ZSCORE,
                    "max_hold_days": self.MAX_HOLD_DAYS,
                },
            }
        else:
            # Sell A, buy B (spread above mean)
            return {
                "symbol": f"{sym_a}/{sym_b}",
                "strategy": self.name,
                "structure": "pairs_trade",
                "direction": direction,
                "legs": [
                    {"symbol": sym_a, "side": "sell", "shares": shares_a},
                    {"symbol": sym_b, "side": "buy", "shares": shares_b},
                ],
                "hedge_ratio": hedge_ratio,
                "notional": round(notional_per_leg * 2, 2),
                "entry_zscore": analysis.get("zscore", 0),
                "exit_rules": {
                    "exit_zscore": self.EXIT_ZSCORE,
                    "stop_zscore": self.STOP_ZSCORE,
                    "max_hold_days": self.MAX_HOLD_DAYS,
                },
            }

    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        """Manage open pairs position with adaptive exit thresholds.

        Exit and stop z-score thresholds are adjusted based on the spread's
        half-life: faster mean-reverters get tighter exits (take profit
        sooner), while slower pairs get wider thresholds and longer hold
        periods to allow the spread to revert.
        """
        zscore = market_data.get("zscore", 0)
        days_held = position.get("days_held", 0)
        direction = position.get("direction", "long_spread")
        half_life = market_data.get("half_life", position.get("half_life", 15.0))

        # --- Adaptive thresholds based on half-life ---
        # Fast mean-reverters (HL < 8d): tighter exit, narrower stop
        # Medium (8-20d): standard thresholds
        # Slow (>20d): wider thresholds, longer max hold
        if half_life < 8:
            exit_z = self.EXIT_ZSCORE * 1.5   # exit sooner (z=0.75 instead of 0.5)
            stop_z = self.STOP_ZSCORE * 0.75  # tighter stop (z=3.0 instead of 4.0)
            max_hold = min(self.MAX_HOLD_DAYS, int(half_life * 2.5))
        elif half_life <= 20:
            exit_z = self.EXIT_ZSCORE          # standard z=0.5
            stop_z = self.STOP_ZSCORE           # standard z=4.0
            max_hold = self.MAX_HOLD_DAYS
        else:
            exit_z = self.EXIT_ZSCORE * 0.6    # let it revert more (z=0.3)
            stop_z = self.STOP_ZSCORE * 1.25   # wider stop (z=5.0)
            max_hold = min(40, int(half_life * 2))

        # Exit: spread reverted to within adaptive threshold
        if direction == "long_spread" and zscore > -exit_z:
            return {"action": "close", "reason": f"Spread reverted (z={zscore:.2f}, exit_z={exit_z:.2f}, HL={half_life:.0f}d)"}
        if direction == "short_spread" and zscore < exit_z:
            return {"action": "close", "reason": f"Spread reverted (z={zscore:.2f}, exit_z={exit_z:.2f}, HL={half_life:.0f}d)"}

        # Stop: spread diverged further (adaptive)
        if abs(zscore) > stop_z:
            return {"action": "close", "reason": f"Spread divergence stop (z={zscore:.2f}, stop_z={stop_z:.2f}, HL={half_life:.0f}d)"}

        # Time stop (adaptive based on half-life)
        if days_held >= max_hold:
            return {"action": "close", "reason": f"Max hold period ({max_hold} days, HL={half_life:.0f}d)"}

        return {"action": "hold", "reason": f"Awaiting spread reversion (z={zscore:.2f}, exit_z={exit_z:.2f}, day {days_held}/{max_hold})"}
