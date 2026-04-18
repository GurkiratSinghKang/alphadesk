"""Master Agent — central coordinator that approves/rejects trade requests.

Every strategy must request permission from the Master Agent before placing
a trade.  The agent enforces per-strategy allocation limits, portfolio-wide
limits, position-level limits, prevents duplicate holdings, and manages
strategy drawdowns, sector concentration, regime-conditional exposure,
and VaR-based risk budgets.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
from typing import Any

logger = logging.getLogger("alphadesk.master_agent")


class MasterAgent:
    """Central coordinator that approves/rejects trade requests from strategies.

    Responsibilities:
    - Prevent duplicate positions (no two strategies buy the same stock)
    - Enforce per-strategy allocation limits
    - Enforce portfolio-wide limits (regime-adaptive deployment, max 15 positions)
    - Track which strategy owns which position
    - Per-strategy drawdown stop losses (P1)
    - Sector concentration limits (P2)
    - Regime-conditional gross exposure via VIX (P3)
    - VaR-based risk budgets (P4)
    - Smart Claude-powered trade review (P5)
    - Circuit breaker
    """

    # Shared momentum data — module-level snapshot, used when an instance
    # is constructed without explicit data. Each MasterAgent takes a COPY at
    # __init__, so later mutations on one instance don't silently affect
    # decisions another instance has already made (P1 #7).
    _SHARED_MOMENTUM_DATA: dict[str, float] = {}
    _SHARED_ABSOLUTE_MOMENTUM_DATA: dict[str, float] = {}

    @classmethod
    def set_momentum_data(cls, data: dict[str, float]) -> None:
        """Update the shared snapshot (read at the next ``MasterAgent()``).

        Existing instances are NOT affected — they retain the snapshot they
        took at construction time. To push new data into an existing
        instance, use :meth:`update_momentum_data`.
        """
        cls._SHARED_MOMENTUM_DATA = dict(data)

    @classmethod
    def set_absolute_momentum(cls, data: dict[str, float]) -> None:
        """Update the shared 12-month absolute momentum snapshot."""
        cls._SHARED_ABSOLUTE_MOMENTUM_DATA = dict(data)

    def update_momentum_data(self, data: dict[str, float]) -> None:
        """Replace THIS instance's 6-month momentum data."""
        self.MOMENTUM_DATA = dict(data)

    def update_absolute_momentum(self, data: dict[str, float]) -> None:
        """Replace THIS instance's 12-month absolute momentum data."""
        self.ABSOLUTE_MOMENTUM_DATA = dict(data)

    # Per-strategy notional caps as a fraction of equity.
    # Built dynamically from the registry at first use via
    # :meth:`_build_strategy_limits`; strategies requiring a different
    # allocation cap can be added to ``STRATEGY_LIMIT_OVERRIDES`` below.
    # The previous hardcoded 15-entry dict left 3 "ghost" strategies
    # (claude_alpha, mean_reversion, vcp_breakout) reserving notional they
    # never actually used — and silently starved any future registry addition
    # to a 10% fallback that blew the portfolio deployment limit.
    STRATEGY_LIMIT_OVERRIDES: dict[str, float] = {
        # Reserved for strategies that need a different cap than equal-weight.
        # Example: "claude_alpha": 0.15  # larger discretionary allocation.
    }

    _STRATEGY_LIMITS_CACHE: dict[str, float] | None = None

    @classmethod
    def _build_strategy_limits(cls) -> dict[str, float]:
        """Build the per-strategy notional cap dict from the registry.

        Equal-weight across registered strategies (``1/N`` each), with
        per-name overrides applied on top. Cached so the registry is only
        walked once per process.
        """
        if cls._STRATEGY_LIMITS_CACHE is not None:
            return cls._STRATEGY_LIMITS_CACHE
        try:
            from strategies.registry import load_all, list_names
            load_all()  # idempotent — ensures registry is populated
            names = list_names()
        except Exception as exc:
            logger.warning(
                "Could not load strategy registry (%s); STRATEGY_LIMITS "
                "will fall back to the per-call 10%% default.", exc,
            )
            names = []

        limits: dict[str, float] = {}
        if names:
            equal = 1.0 / len(names)
            for n in names:
                limits[n] = equal
        # Apply overrides on top of equal-weight
        limits.update(cls.STRATEGY_LIMIT_OVERRIDES)
        cls._STRATEGY_LIMITS_CACHE = limits
        logger.info(
            "STRATEGY_LIMITS built from registry: %d strategies, equal weight=%.4f",
            len(names), (1.0 / len(names)) if names else 0.0,
        )
        return limits

    # Backwards-compat read-only view. Eager-build so any code that iterates
    # ``STRATEGY_LIMITS.items()`` still works. (Property on a class isn't
    # trivially picklable, so we use a class-level dict updated on first
    # construction and via _build_strategy_limits.)
    STRATEGY_LIMITS: dict[str, float] = {}
    MAX_POSITIONS = 20  # raised for 15 strategies
    MAX_DEPLOYED_PCT = 0.90  # 90% of equity deployable (competition mode)
    MAX_PER_POSITION = 0.08  # max 8% per position
    MIN_CONVICTION = 50
    MIN_REWARD_RISK_RATIO = 1.2  # Minimum 1.2:1 reward-to-risk (accommodates mean reversion)

    # Risk monitor toggle — when False, all P1-P4 checks are bypassed
    RISK_MONITOR_ENABLED: bool = True

    # P1: Per-strategy drawdown limits
    STRATEGY_DRAWDOWN_LIMIT = -0.05  # -5% from peak
    STRATEGY_RESUME_THRESHOLD = -0.03  # resume at -3%

    # P2: Sector concentration limits
    SECTOR_LIMIT = 0.30  # max 30% in any sector
    SECTOR_WARN = 0.25   # require higher conviction above 25%

    # P3: Regime-conditional deployment limits (keyed by VIX regime)
    REGIME_DEPLOYMENT_LIMITS: dict[str, float] = {
        "bull_low_vol": 0.80,    # VIX < 18
        "bull_high_vol": 0.60,   # VIX 18-25
        "bear": 0.30,            # VIX > 25
        "crisis": 0.10,          # VIX > 35
    }

    # P4: VaR-based risk budget
    MAX_PORTFOLIO_VAR = 0.02  # max 2% daily VaR

    # Strategy categories whose trades SHOULD NOT be gated on absolute /
    # trailing momentum. These strategies trade counter to trend
    # (mean-reversion, short-vol, market-neutral, intraday pivots) and a
    # long-only momentum gate rejects their signals by construction.
    #
    # Category values come from StrategyMeta.category on the registry record:
    #   - "options"   -> VRP harvest, earnings_vol (short-vol structures)
    #   - "pairs"     -> pairs_trading (market-neutral)
    #   - "intraday"  -> VWAP, ORB (intraday reversion / breakout on thin lookback)
    # The "smoke" category is a dev-only bucket; we skip it for safety.
    MOMENTUM_GATE_SKIP_CATEGORIES: set[str] = {"options", "pairs", "intraday", "smoke"}
    # Per-name overrides for equity-category strategies that are explicitly
    # mean-reversion (so category="equity" alone isn't enough to tell).
    MOMENTUM_GATE_SKIP_STRATEGIES: set[str] = {
        "rsi2_reversal",     # 2-period RSI bounce -- buys oversold dips
        "mean_reversion",    # legacy adapter still referenced in some logs
    }

    # Typical daily volatilities (shared across VaR + crowding detection)
    VOL_MAP: dict[str, float] = {
        "TSLA": 0.035, "NVDA": 0.030, "AMD": 0.030, "COIN": 0.040,
        "META": 0.025, "NFLX": 0.025, "AAPL": 0.015, "MSFT": 0.014,
        "AMZN": 0.020, "GOOGL": 0.018, "SPY": 0.010, "QQQ": 0.013,
        "JPM": 0.015, "BAC": 0.018, "XOM": 0.016, "DIS": 0.020,
        "WMT": 0.012, "INTC": 0.035, "CSCO": 0.015, "ABBV": 0.016,
        "UNH": 0.028, "PG": 0.010, "MRK": 0.014, "KO": 0.009,
    }

    def __init__(
        self,
        equity: float,
        cash: float,
        existing_positions: dict[str, dict[str, Any]],
        vix_level: float = 16.5,
        momentum_data: dict[str, float] | None = None,
        absolute_momentum_data: dict[str, float] | None = None,
    ) -> None:
        # Ensure the registry-driven STRATEGY_LIMITS is populated. Safe to
        # call repeatedly — ``_build_strategy_limits`` caches on the class.
        MasterAgent.STRATEGY_LIMITS = MasterAgent._build_strategy_limits()

        self.equity = equity
        self.cash = cash
        # {symbol: {strategy, notional, shares, entry_price, ...}}
        self.existing_positions = dict(existing_positions)
        self.pending_orders: list[dict[str, Any]] = []
        self.rejections: list[dict[str, Any]] = []

        # Instance-local copy of the momentum snapshot. If the caller doesn't
        # inject one we snapshot the shared dict at construction time, so
        # later mutations via set_momentum_data() don't retroactively change
        # decisions this instance has already made.
        self.MOMENTUM_DATA: dict[str, float] = (
            dict(momentum_data) if momentum_data is not None
            else dict(self._SHARED_MOMENTUM_DATA)
        )
        self.ABSOLUTE_MOMENTUM_DATA: dict[str, float] = (
            dict(absolute_momentum_data) if absolute_momentum_data is not None
            else dict(self._SHARED_ABSOLUTE_MOMENTUM_DATA)
        )

        # P1: Strategy drawdown tracking
        self.strategy_peaks: dict[str, float] = {}
        self.strategy_current: dict[str, float] = {}
        self.halted_strategies: set[str] = set()

        # P3: Regime detection
        self.vix_level = vix_level
        self.regime = self._detect_regime()
        self.max_deployment = self.REGIME_DEPLOYMENT_LIMITS[self.regime]

    # ------------------------------------------------------------------
    # P1: Strategy drawdown tracking
    # ------------------------------------------------------------------

    def update_strategy_pnl(self, strategy: str, current_value: float) -> dict[str, Any]:
        """Track strategy equity and check drawdown limits."""
        if strategy not in self.strategy_peaks:
            self.strategy_peaks[strategy] = current_value
        if current_value > self.strategy_peaks[strategy]:
            self.strategy_peaks[strategy] = current_value

        self.strategy_current[strategy] = current_value
        peak = self.strategy_peaks[strategy]
        drawdown = (current_value - peak) / peak if peak > 0 else 0

        if drawdown < self.STRATEGY_DRAWDOWN_LIMIT and strategy not in self.halted_strategies:
            self.halted_strategies.add(strategy)
            logger.warning(
                "HALT strategy '%s': drawdown %.1f%% exceeds limit %.1f%%",
                strategy, drawdown * 100, self.STRATEGY_DRAWDOWN_LIMIT * 100,
            )
            return {"action": "halt", "drawdown": drawdown}

        if strategy in self.halted_strategies and drawdown > self.STRATEGY_RESUME_THRESHOLD:
            self.halted_strategies.discard(strategy)
            logger.info(
                "RESUME strategy '%s': drawdown recovered to %.1f%%",
                strategy, drawdown * 100,
            )
            return {"action": "resume", "drawdown": drawdown}

        return {"action": "ok", "drawdown": drawdown}

    # ------------------------------------------------------------------
    # P2: Sector concentration
    # ------------------------------------------------------------------

    def _get_sector_exposure(self) -> dict[str, float]:
        """Calculate current sector allocation as % of total deployed."""
        sector_totals: dict[str, float] = {}
        total = sum(p.get("notional", 0) for p in self.existing_positions.values())
        if total == 0:
            return {}
        for sym, pos in self.existing_positions.items():
            sector = pos.get("sector", "Unknown")
            sector_totals[sector] = sector_totals.get(sector, 0) + pos.get("notional", 0)
        return {s: v / total for s, v in sector_totals.items()}

    # ------------------------------------------------------------------
    # P3: Regime detection
    # ------------------------------------------------------------------

    def _detect_regime(self) -> str:
        """Classify market regime based on VIX level."""
        if self.vix_level > 35:
            return "crisis"
        elif self.vix_level > 25:
            return "bear"
        elif self.vix_level > 18:
            return "bull_high_vol"
        else:
            return "bull_low_vol"

    # ------------------------------------------------------------------
    # P4: VaR estimation
    # ------------------------------------------------------------------

    def _estimate_position_var(self, symbol: str, notional: float) -> float:
        """Estimate daily VaR for a position. Uses typical daily volatilities."""
        daily_vol = self.VOL_MAP.get(symbol, 0.020)  # default 2% daily vol
        return notional * daily_vol * 2.33  # 99% confidence

    def _portfolio_var(self) -> float:
        """Estimate portfolio VaR (sum of position VaRs with 0.7 diversification factor)."""
        individual_vars = []
        for sym, pos in self.existing_positions.items():
            var = self._estimate_position_var(sym, pos.get("notional", 0))
            individual_vars.append(var)
        if not individual_vars:
            return 0
        # Apply diversification benefit (0.7 factor — assumes ~50% average correlation)
        return sum(individual_vars) * 0.7

    # ------------------------------------------------------------------
    # Factor crowding detection
    # ------------------------------------------------------------------

    def detect_factor_crowding(self) -> dict[str, Any]:
        """Detect if portfolio is overcrowded in any factor.

        Returns warnings for each crowded factor.
        """
        warnings: list[dict[str, Any]] = []
        positions = self.existing_positions

        if len(positions) < 3:
            return {"crowded": False, "warnings": [], "position_count": len(positions)}

        total = len(positions)

        # 1. Momentum crowding: If most positions have high RS scores
        rs_scores = [p.get("rs_score", 50) for p in positions.values() if p.get("rs_score")]
        if rs_scores:
            avg_rs = sum(rs_scores) / len(rs_scores)
            if avg_rs > 75:
                warnings.append({
                    "factor": "momentum",
                    "severity": "high",
                    "message": f"Portfolio heavily momentum-tilted (avg RS: {avg_rs:.0f}). Vulnerable to momentum reversal.",
                    "action": "Consider adding mean-reversion positions or reducing momentum allocation."
                })

        # 2. Sector crowding
        sector_exp = self._get_sector_exposure()
        for sector, pct in sector_exp.items():
            if pct > 0.35:
                warnings.append({
                    "factor": f"sector:{sector}",
                    "severity": "high",
                    "message": f"Sector '{sector}' at {pct*100:.0f}% — exceeds 35% threshold.",
                    "action": f"Diversify away from {sector}. Consider other sectors."
                })

        # 3. Volatility crowding: If most positions are high-vol
        vols = [self.VOL_MAP.get(sym, 0.02) for sym in positions.keys()]
        if vols:
            avg_vol = sum(vols) / len(vols)
            if avg_vol > 0.025:  # Average daily vol > 2.5%
                warnings.append({
                    "factor": "high_volatility",
                    "severity": "medium",
                    "message": f"Portfolio avg daily vol: {avg_vol*100:.1f}%. High vol concentration increases tail risk.",
                    "action": "Add low-vol defensive names (utilities, staples) or reduce position sizes."
                })

        # 4. Strategy crowding: If one strategy dominates
        strategy_counts: dict[str, int] = {}
        for p in positions.values():
            s = p.get("strategy", "unknown")
            strategy_counts[s] = strategy_counts.get(s, 0) + 1
        for strat, count in strategy_counts.items():
            if total > 3 and count / total > 0.5:
                warnings.append({
                    "factor": f"strategy:{strat}",
                    "severity": "medium",
                    "message": f"Strategy '{strat}' owns {count}/{total} positions ({count/total*100:.0f}%). Diversify across strategies.",
                    "action": f"Reduce {strat} allocation, increase underweight strategies."
                })

        # 5. Correlation estimate: If too many tech/growth names
        growth_sectors = {"Technology", "Communication Services", "Consumer Discretionary"}
        growth_count = sum(1 for p in positions.values() if p.get("sector") in growth_sectors)
        if total > 3 and growth_count / total > 0.6:
            warnings.append({
                "factor": "growth_tilt",
                "severity": "high",
                "message": f"Growth/tech tilt: {growth_count}/{total} positions in growth sectors. High correlation risk.",
                "action": "Add value/defensive names: energy, healthcare, staples, financials."
            })

        # 6. Low-vol underweight: If no position has vol < 1.5%, warn
        low_vol_count = sum(1 for s in positions if self.VOL_MAP.get(s, 0.02) < 0.015)
        if total > 5 and low_vol_count == 0:
            warnings.append({
                "factor": "no_low_vol",
                "severity": "medium",
                "message": f"No low-volatility positions in portfolio. Missing defensive diversification.",
                "action": "Add consumer staples (PG, KO, WMT) or utilities (XLU) for lower portfolio vol."
            })

        return {
            "crowded": len(warnings) > 0,
            "warnings": warnings,
            "position_count": total,
        }

    # ------------------------------------------------------------------
    # Volatility-targeted position sizing (risk parity at position level)
    # ------------------------------------------------------------------

    def calculate_vol_targeted_size(self, symbol: str, max_notional: float = 5000) -> float:
        """Size position inversely to volatility (risk parity at position level)."""
        vol = self.VOL_MAP.get(symbol, 0.020)

        # Target: 1% daily portfolio risk per position
        target_risk = 0.01 * self.equity  # $1,000 for $100K portfolio
        vol_sized = target_risk / vol  # notional to achieve target risk

        # Cap at max_notional
        return min(vol_sized, max_notional)

    # ------------------------------------------------------------------
    # Strategy-aware momentum gate exemption
    # ------------------------------------------------------------------

    # Per-strategy warning de-duplication for registry lookup failures.
    _MOMENTUM_GATE_WARNED: set[str] = set()

    def _momentum_gate_exempt(self, strategy: str) -> bool:
        """Return True if momentum gates should NOT apply to this strategy.

        Consulted in :meth:`request_trade` before checks 6b/6c.  A strategy is
        exempt if:

        * its name is in :attr:`MOMENTUM_GATE_SKIP_STRATEGIES` (explicit
          per-name whitelist for mean-reversion equities), or
        * its registry :class:`StrategyMeta.category` is in
          :attr:`MOMENTUM_GATE_SKIP_CATEGORIES` (``options``, ``pairs``,
          ``intraday`` trade counter to or orthogonal to trend).

        Behaviour on registry errors:
          * ``KeyError`` (strategy not registered) — the expected miss path
            for fallback adapters and ad-hoc strategy names. Logged once per
            name at WARNING so it's visible but not spammy, then treated as
            "not exempt" so the gate still applies.
          * Any other exception propagates upward — a broken registry is an
            operational problem we want surfaced, not silently swallowed.
        """
        if strategy in self.MOMENTUM_GATE_SKIP_STRATEGIES:
            return True
        try:
            # Import here to avoid a hard dependency at module-import time
            # (the registry may not be populated when this module loads in
            # tests that don't exercise it).
            from strategies.registry import get_meta
            meta = get_meta(strategy)
        except KeyError:
            if strategy not in self._MOMENTUM_GATE_WARNED:
                self._MOMENTUM_GATE_WARNED.add(strategy)
                logger.warning(
                    "_momentum_gate_exempt: strategy %r not in registry; "
                    "defaulting to exempt=False (gate will apply). Every "
                    "pairs/options/intraday signal from this name will be "
                    "rejected until it is registered.", strategy,
                )
            return False
        return meta.category in self.MOMENTUM_GATE_SKIP_CATEGORIES

    # ------------------------------------------------------------------
    # Trade gating
    # ------------------------------------------------------------------

    def request_trade(
        self,
        strategy: str,
        symbol: str,
        side: str,
        notional: float,
        conviction: int,
        rationale: str,
        shares: int = 0,
        entry_price: float = 0.0,
        stop_loss: float | None = None,
        take_profit: float | None = None,
        sector: str = "Unknown",
    ) -> dict[str, Any]:
        """Strategy requests permission to trade.

        Returns ``{"approved": bool, "reason": str}``.
        """
        # -- Risk Monitor bypass: when disabled, approve all buys --
        if not self.RISK_MONITOR_ENABLED:
            # Only enforce duplicate symbol check (safety)
            if side == "buy" and symbol in self.existing_positions:
                holding = self.existing_positions[symbol].get("strategy", "unknown")
                return {"approved": False, "reason": f"{symbol} already held by '{holding}'"}

            order = {
                "strategy": strategy, "symbol": symbol, "side": side,
                "notional": notional, "shares": shares, "conviction": conviction,
                "rationale": rationale, "entry_price": entry_price,
                "stop_loss": stop_loss, "take_profit": take_profit,
            }
            self.pending_orders.append(order)
            if side == "buy":
                self.existing_positions[symbol] = {
                    "strategy": strategy, "notional": notional, "sector": sector,
                }
                self.cash -= notional
            logger.warning("RISK MONITOR OFF — auto-approved: %s %s %s $%.0f", strategy, side, symbol, notional)
            return {"approved": True, "reason": "Approved (risk monitor disabled)"}

        # -- P1: Check if strategy is halted due to drawdown --
        if strategy in self.halted_strategies:
            reason = f"Strategy '{strategy}' is halted (drawdown > {abs(self.STRATEGY_DRAWDOWN_LIMIT)*100}%)"
            remediation = f"Wait for drawdown to recover above {abs(self.STRATEGY_RESUME_THRESHOLD)*100}% or manually resume the strategy."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # -- sells are always allowed (exit existing position) --
        if side == "sell":
            self.pending_orders.append({
                "strategy": strategy,
                "symbol": symbol,
                "side": side,
                "notional": notional,
                "shares": shares,
                "conviction": conviction,
                "rationale": rationale,
                "entry_price": entry_price,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
            })
            return {"approved": True, "reason": "Sell approved"}

        # -- buy checks --

        # Check 0: Risk/reward ratio enforcement
        if side == "buy" and entry_price > 0 and stop_loss and stop_loss > 0 and take_profit and take_profit > 0:
            risk = entry_price - stop_loss
            reward = take_profit - entry_price
            if risk > 0:
                rr_ratio = reward / risk
                if rr_ratio < self.MIN_REWARD_RISK_RATIO:
                    reason = (
                        f"Risk/reward {rr_ratio:.1f}:1 below minimum "
                        f"{self.MIN_REWARD_RISK_RATIO}:1 "
                        f"(risk=${risk:.2f}, reward=${reward:.2f})"
                    )
                    remediation = f"Widen take-profit to >${entry_price + risk * self.MIN_REWARD_RISK_RATIO:.2f} or tighten stop-loss to >${entry_price - reward / self.MIN_REWARD_RISK_RATIO:.2f}."
                    self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
                    return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 1: No duplicate symbols across strategies
        if symbol in self.existing_positions:
            holding_strategy = self.existing_positions[symbol].get('strategy', 'unknown')
            reason = f"{symbol} already held by strategy '{holding_strategy}'"
            remediation = f"Close the existing {symbol} position in '{holding_strategy}' first, or choose a different symbol."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 2: Strategy allocation limit
        strategy_deployed = sum(
            p.get("notional", 0)
            for p in self.existing_positions.values()
            if p.get("strategy") == strategy
        )
        # Also count pending orders for this strategy
        strategy_pending = sum(
            o["notional"]
            for o in self.pending_orders
            if o["strategy"] == strategy and o["side"] == "buy"
        )
        strategy_limit = self.STRATEGY_LIMITS.get(strategy, 0.10) * self.equity
        if strategy_deployed + strategy_pending + notional > strategy_limit:
            available = max(0, strategy_limit - strategy_deployed - strategy_pending)
            reason = (
                f"Strategy '{strategy}' would exceed allocation "
                f"({strategy_deployed + strategy_pending + notional:.0f} > {strategy_limit:.0f})"
            )
            remediation = f"Reduce position size to ${available:.0f} or close existing {strategy} positions to free allocation."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 3: Portfolio-wide deployment limit (P3: regime-adaptive)
        total_deployed = sum(p.get("notional", 0) for p in self.existing_positions.values())
        total_pending = sum(o["notional"] for o in self.pending_orders if o["side"] == "buy")
        if total_deployed + total_pending + notional > self.max_deployment * self.equity:
            available = max(0, self.max_deployment * self.equity - total_deployed - total_pending)
            reason = (
                f"Portfolio deployment would exceed {self.max_deployment * 100:.0f}% "
                f"(regime: {self.regime}, VIX: {self.vix_level})"
            )
            remediation = f"Reduce position to ${available:.0f}, close existing positions, or wait for regime to improve (current VIX: {self.vix_level:.1f})."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 4: Max positions
        current_count = len(self.existing_positions) + len(
            [o for o in self.pending_orders if o["side"] == "buy"]
        )
        if current_count >= self.MAX_POSITIONS:
            reason = f"Max {self.MAX_POSITIONS} positions reached"
            remediation = f"Close one or more existing positions to free a slot. Currently holding {current_count} positions."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 5: Per-position limit
        max_pos_dollar = self.MAX_PER_POSITION * self.equity
        if notional > max_pos_dollar:
            reason = (
                f"Position size ${notional:.0f} exceeds "
                f"{self.MAX_PER_POSITION * 100:.0f}% limit (${max_pos_dollar:.0f})"
            )
            remediation = f"Reduce position size to ${max_pos_dollar:.0f} or below ({self.MAX_PER_POSITION * 100:.0f}% of ${self.equity:.0f} equity)."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 6: Minimum conviction
        if conviction < self.MIN_CONVICTION:
            reason = f"Conviction {conviction} below minimum {self.MIN_CONVICTION}"
            remediation = f"Re-analyze with stricter criteria to increase conviction above {self.MIN_CONVICTION}, or wait for a stronger signal."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 6b / 6c: Momentum gates -- strategy-aware.
        #
        # The absolute-momentum gate (12-month) and trailing-momentum gate
        # (6-month) are long-only trend filters. Strategies whose intent is
        # to trade AGAINST the prevailing trend (mean-reversion, short-vol,
        # pairs, intraday) should not be gated by these checks, otherwise
        # every signal from them is rejected by construction.
        #
        # We consult StrategyMeta.category from the registry; unknown names
        # (not yet registered, or fallback adapters) default to applying the
        # gate -- safer than silently disabling it for a strategy that
        # actually IS trend-following.
        gate_momentum = side == "buy" and not self._momentum_gate_exempt(strategy)

        if gate_momentum:
            # Check 6b: Absolute momentum gate (Antonacci Dual Momentum)
            abs_mom = self.ABSOLUTE_MOMENTUM_DATA.get(symbol)
            if abs_mom is not None and abs_mom < -5:
                reason = f"Absolute momentum gate: {symbol} 12-month return is {abs_mom:.1f}% (below -5% threshold). Not buying downtrends."
                remediation = f"Wait for {symbol} to establish positive 12-month momentum, or choose a symbol with positive absolute momentum."
                self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
                return {"approved": False, "reason": reason, "remediation": remediation}

            # Check 6c: Require non-severely-negative 6-month momentum
            momentum = self.MOMENTUM_DATA.get(symbol)
            if momentum is not None and momentum < -10:
                reason = f"Momentum gate: {symbol} has strongly negative momentum ({momentum:.1f}%, below -10% threshold)."
                remediation = f"Wait for {symbol} 6-month momentum to recover above -10%, or select a symbol with stronger relative strength."
                self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
                return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 7: Sufficient cash
        if notional > self.cash:
            reason = f"Insufficient cash (${self.cash:.0f} < ${notional:.0f})"
            remediation = f"Reduce position size to ${self.cash:.0f} or close existing positions to free cash."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 8 (P2): Sector concentration limit
        # Only enforce when portfolio has enough positions for meaningful diversification
        num_positions = len(self.existing_positions)
        if num_positions >= 3:
            exposure = self._get_sector_exposure()
            current_sector_pct = exposure.get(sector, 0)
            total_pending = sum(o.get("notional", 0) for o in self.pending_orders if o.get("side") == "buy")
            total_base = total_deployed + total_pending
            projected_sector_pct = (current_sector_pct * total_base + notional) / (total_base + notional)

            if projected_sector_pct > self.SECTOR_LIMIT:
                reason = f"Sector '{sector}' would reach {projected_sector_pct*100:.0f}% (limit: {self.SECTOR_LIMIT*100}%)"
                other_sectors = [s for s in ["Technology", "Healthcare", "Financials", "Energy", "Consumer Staples", "Industrials"] if s != sector]
                remediation = f"Choose a symbol from a different sector ({', '.join(other_sectors[:3])}) to diversify."
                self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
                return {"approved": False, "reason": reason, "remediation": remediation}

            if current_sector_pct > self.SECTOR_WARN and conviction < 70:
                reason = f"Sector '{sector}' at {current_sector_pct*100:.0f}% -- conviction {conviction} < 70 required"
                remediation = f"Increase conviction above 70 (re-analyze with stronger signal) or pick a symbol from an underweight sector."
                self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
                return {"approved": False, "reason": reason, "remediation": remediation}

        # Check 9 (P4): VaR budget
        new_var = self._estimate_position_var(symbol, notional)
        portfolio_var_after = self._portfolio_var() + new_var * 0.7
        var_limit = self.MAX_PORTFOLIO_VAR * self.equity
        if portfolio_var_after > var_limit:
            max_notional_for_var = max(0, (var_limit - self._portfolio_var()) / (self.VOL_MAP.get(symbol, 0.02) * 2.33 * 0.7))
            reason = f"Portfolio VaR would reach ${portfolio_var_after:.0f} (limit: ${var_limit:.0f})"
            remediation = f"Reduce position to ${max_notional_for_var:.0f} to stay within VaR budget, or close a high-vol position first."
            self.rejections.append({"strategy": strategy, "symbol": symbol, "reason": reason, "remediation": remediation})
            return {"approved": False, "reason": reason, "remediation": remediation}

        # ---- Low-vol preference: log diversification benefit ----
        avg_portfolio_vol = (
            sum(self.VOL_MAP.get(s, 0.02) for s in self.existing_positions)
            / max(len(self.existing_positions), 1)
        ) if self.existing_positions else 0
        stock_vol = self.VOL_MAP.get(symbol, 0.02)
        if avg_portfolio_vol > 0.025 and stock_vol < 0.015 and side == "buy":
            logger.info(
                "Low-vol diversifier benefit: %s vol %.1f%% helps reduce portfolio vol %.1f%%",
                symbol, stock_vol * 100, avg_portfolio_vol * 100,
            )

        # ---- Approved ----
        order = {
            "strategy": strategy,
            "symbol": symbol,
            "side": side,
            "notional": notional,
            "shares": shares,
            "conviction": conviction,
            "rationale": rationale,
            "entry_price": entry_price,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
        }
        self.pending_orders.append(order)
        # Track the symbol so subsequent strategies can't also buy it
        self.existing_positions[symbol] = {
            "strategy": strategy,
            "notional": notional,
            "sector": sector,
        }
        self.cash -= notional
        logger.info(
            "APPROVED: %s %s %s $%.0f (conviction=%d, sector=%s, regime=%s)",
            strategy, side, symbol, notional, conviction, sector, self.regime,
        )
        return {"approved": True, "reason": "Approved"}

    # ------------------------------------------------------------------
    # P5: Smart Claude-powered review
    # ------------------------------------------------------------------

    async def smart_review(self, symbol: str, side: str, notional: float,
                           conviction: int, rationale: str, sector: str) -> dict[str, Any]:
        """Ask Claude to review the trade in portfolio context."""
        # Build portfolio summary for Claude
        sector_exp = self._get_sector_exposure()
        total_deployed = sum(p.get("notional", 0) for p in self.existing_positions.values())
        deployment_pct = total_deployed / self.equity * 100 if self.equity > 0 else 0
        portfolio_summary = {
            "equity": self.equity,
            "cash": self.cash,
            "positions": len(self.existing_positions),
            "deployment_pct": deployment_pct,
            "regime": self.regime,
            "vix": self.vix_level,
            "top_sectors": dict(sorted(sector_exp.items(), key=lambda x: x[1], reverse=True)[:5]),
            "portfolio_var_pct": self._portfolio_var() / self.equity * 100 if self.equity > 0 else 0,
        }

        prompt = (
            f"You are the Master Risk Agent for a multi-strategy trading fund.\n\n"
            f"Portfolio state:\n"
            f"- Equity: ${self.equity:,.0f}, Cash: ${self.cash:,.0f}\n"
            f"- Deployed: {portfolio_summary['deployment_pct']:.0f}%, Positions: {portfolio_summary['positions']}\n"
            f"- Regime: {self.regime}, VIX: {self.vix_level}\n"
            f"- Sector exposure: {json.dumps(portfolio_summary['top_sectors'])}\n"
            f"- Portfolio VaR: {portfolio_summary['portfolio_var_pct']:.1f}% of equity\n\n"
            f"Trade request:\n"
            f"- {side.upper()} {symbol} (sector: {sector}), notional: ${notional:,.0f}\n"
            f"- Conviction: {conviction}/100\n"
            f"- Rationale: {rationale[:200]}\n\n"
            f"Should this trade be APPROVED or REJECTED? Consider:\n"
            f"1. Does it diversify or concentrate the portfolio?\n"
            f"2. Is it appropriate for the current regime?\n"
            f"3. Is the position sizing reasonable?\n\n"
            f'Respond with JSON: {{"decision": "approve" or "reject", "reason": "one sentence", "suggested_size_adjustment": 1.0}}'
        )

        try:
            claude_cli = shutil.which("claude")
            if not claude_cli:
                return {"claude_decision": "approve", "claude_reason": "Claude CLI not found, rules-based approval", "size_adjustment": 1.0}
            proc = await asyncio.create_subprocess_exec(
                claude_cli, "--print", "--model", "haiku", "--output-format", "json", prompt,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
            raw = stdout.decode(errors="replace").strip()
            data = json.loads(raw)
            result_text = data.get("result", raw) if isinstance(data, dict) else raw

            # Try to find JSON in the response
            json_match = re.search(r'\{[^}]*"decision"[^}]*\}', result_text)
            if json_match:
                decision = json.loads(json_match.group())
                return {
                    "claude_decision": decision.get("decision", "approve"),
                    "claude_reason": decision.get("reason", ""),
                    "size_adjustment": decision.get("suggested_size_adjustment", 1.0),
                }
        except Exception:
            pass

        # Fallback: approve (don't block on Claude failure)
        return {"claude_decision": "approve", "claude_reason": "Claude unavailable, rules-based approval", "size_adjustment": 1.0}

    async def request_trade_smart(
        self,
        strategy: str,
        symbol: str,
        side: str,
        notional: float,
        conviction: int,
        rationale: str,
        shares: int = 0,
        entry_price: float = 0.0,
        stop_loss: float | None = None,
        take_profit: float | None = None,
        sector: str = "Unknown",
    ) -> dict[str, Any]:
        """Trade request with optional Claude review for high-conviction trades."""
        # First run rules-based checks
        result = self.request_trade(
            strategy, symbol, side, notional, conviction, rationale,
            shares=shares, entry_price=entry_price, stop_loss=stop_loss,
            take_profit=take_profit, sector=sector,
        )
        if not result["approved"]:
            return result

        # For trades near limits or low conviction, ask Claude
        total_deployed = sum(p.get("notional", 0) for p in self.existing_positions.values())
        deployment_pct = total_deployed / self.equity if self.equity > 0 else 0

        if deployment_pct > 0.40 or conviction < 70:
            review = await self.smart_review(symbol, side, notional, conviction, rationale, sector)
            if review["claude_decision"] == "reject":
                # Undo the approval
                if symbol in self.existing_positions:
                    del self.existing_positions[symbol]
                self.pending_orders = [o for o in self.pending_orders if o["symbol"] != symbol]
                self.cash += notional
                self.rejections.append({
                    "symbol": symbol, "strategy": strategy,
                    "reason": f"Claude review rejected: {review['claude_reason']}",
                })
                return {"approved": False, "reason": f"Claude review: {review['claude_reason']}"}

            # Apply size adjustment
            if review.get("size_adjustment", 1.0) != 1.0:
                adj = review["size_adjustment"]
                for o in self.pending_orders:
                    if o["symbol"] == symbol:
                        o["notional"] = notional * adj
                        o["shares"] = max(1, int(o.get("shares", 0) * adj))

        return result

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    def get_summary(self) -> dict[str, Any]:
        """Return allocation summary per strategy."""
        by_strategy: dict[str, dict[str, Any]] = {}
        for sym, pos in self.existing_positions.items():
            strat = pos.get("strategy", "unknown")
            if strat not in by_strategy:
                by_strategy[strat] = {"deployed": 0.0, "positions": 0, "symbols": []}
            by_strategy[strat]["deployed"] += pos.get("notional", 0)
            by_strategy[strat]["positions"] += 1
            by_strategy[strat]["symbols"].append(sym)

        total_deployed = sum(s["deployed"] for s in by_strategy.values())
        return {
            "equity": self.equity,
            "cash": self.cash,
            "total_deployed": total_deployed,
            "deployed_pct": round(total_deployed / self.equity * 100, 1) if self.equity else 0,
            "total_positions": len(self.existing_positions),
            "pending_orders": len(self.pending_orders),
            "rejections_count": len(self.rejections),
            "rejections": self.rejections,
            "by_strategy": by_strategy,
            # P1-P4 additions
            "regime": self.regime,
            "vix_level": self.vix_level,
            "max_deployment_pct": round(self.max_deployment * 100, 1),
            "halted_strategies": list(self.halted_strategies),
            "sector_exposure": self._get_sector_exposure(),
            "portfolio_var": round(self._portfolio_var(), 2),
            "portfolio_var_pct": round(self._portfolio_var() / self.equity * 100, 2) if self.equity else 0,
        }
