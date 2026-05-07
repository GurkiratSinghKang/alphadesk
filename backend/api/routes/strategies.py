from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import random
import statistics
from collections import defaultdict
from datetime import datetime, date, timedelta, timezone
from enum import Enum
from pathlib import Path as FilePath
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Request

from core.auth import require_auth
from core.audit import write_audit
from core.logging import REQUEST_ID
from pydantic import BaseModel, Field

from api.routes.auth import require_admin

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# In-process toggle locks (persona-9 #3 — concurrent-toggle race reinforcement)
# ---------------------------------------------------------------------------
# A per-strategy ``asyncio.Lock`` serialises toggles arriving at the SAME
# Python process. The Redis WATCH/MULTI/EXEC CAS below still handles the
# multi-worker case (and is the source of strict serializability across
# workers) — the lock is an optimisation that eliminates the most common
# source of contention persona-9 reproduced: 4 parallel ``fetch`` calls from
# the same browser, all landing on the same uvicorn worker, all retrying
# their CAS in lockstep. With the lock, those 4 requests serialize before
# they touch Redis — no WATCH conflicts, no inconsistent reads.
#
# WeakValueDictionary would be ideal here, but ``asyncio.Lock`` doesn't
# survive being weak-ref'd reliably; the small ``dict`` is fine — there are
# at most ~25 strategies and each lock is cheap. Locks are created lazily.
_TOGGLE_LOCKS: dict[str, asyncio.Lock] = {}


def _get_toggle_lock(canonical_id: str) -> asyncio.Lock:
    lock = _TOGGLE_LOCKS.get(canonical_id)
    if lock is None:
        lock = asyncio.Lock()
        _TOGGLE_LOCKS[canonical_id] = lock
    return lock


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class StrategyStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    BACKTEST = "backtest"
    # Wave 6γ (persona-109 P2): catalogue entries that are advertised but
    # have no backend implementation yet. Prior revisions marked these as
    # ``ACTIVE`` which misrepresented operational state on the UI — a user
    # could click through expecting to pause or allocate into a strategy
    # that wasn't running. ``PLANNED`` signals "coming soon" and is the
    # value the frontend already surfaces via ``implementation_stage()``
    # for ``PLANNED_STRATEGY_ROUTE_IDS`` entries.
    PLANNED = "planned"


class StrategyPerformance(BaseModel):
    name: str
    description: str
    status: StrategyStatus
    invested_amount: float
    current_value: float
    total_return_pct: float
    annualized_return_pct: float
    return_dollars: float
    win_rate: float
    sharpe_ratio: float | None = None
    max_drawdown: float | None = None
    hit_rate: float | None = None
    cagr: float | None = None
    profit_factor: float | None = None
    active_positions_count: int
    equity_curve: list[dict[str, Any]]  # [{date, value}]
    last_trade_date: str
    # Wave 4 — live-trading routing flags. ``live_disabled`` names the
    # strategy as structurally unfit for live capital until the P0 defects
    # from its expert audit land; ``paper_only`` names it as
    # implementation-complete but statistically thin. Both surface a
    # NOT-READY badge on the frontend; backend rejects 422 on live.
    # See audit-reports/00-strategy-experts-consolidation.md §4.
    live_disabled: bool = False
    paper_only: bool = False


class StrategySummary(BaseModel):
    id: str
    name: str
    description: str
    status: StrategyStatus
    invested_amount: float
    # BUG-055 — precise dollar figure (no rounding to $K) for the tooltip
    # shown on hover over the abbreviated "Invested $4.9K" cell.
    invested_amount_precise: float = 0.0
    total_return_pct: float
    sharpe_ratio: float | None = None
    win_rate: float
    active_positions_count: int
    sparkline: list[float] = []
    # Batch B (P0-06) — disclosure flag set when ``sparkline`` was produced by
    # ``_generate_equity_curve`` (an MD5(strategy_id)-seeded random walk that
    # forces the curve to land on the true total_return). The values are not
    # historical equity; consumers must render a synthetic-data indicator and
    # MUST NOT compute Sharpe/drawdown from these points. Will flip back to
    # False once the endpoint reads from a ledger-derived equity curve.
    sparkline_is_synthetic: bool = False
    # Wave 4 — mirror the flags on the list endpoint so the strategies grid
    # can render NOT-READY badges without a per-strategy follow-up fetch.
    live_disabled: bool = False
    paper_only: bool = False


class ToggleResponse(BaseModel):
    id: str
    name: str
    previous_status: StrategyStatus
    new_status: StrategyStatus


class StrategyCatalogEntry(BaseModel):
    """A3#3 — compact catalogue row consumed by the strategies list page.

    The list page needs the ``live_disabled`` / ``paper_only`` flags for every
    strategy so the "NOT READY FOR LIVE" / "PAPER-ONLY" pills render on the
    cards *before* the user drills into a detail page. The full
    ``/performance`` endpoint carries these flags too, but fanning out a
    per-strategy fetch just to read two booleans is wasteful. The catalog
    endpoint answers the whole question in a single round-trip with no DB
    touches — flags are static config.
    """
    id: str
    slug: str
    name: str
    live_disabled: bool
    paper_only: bool


class StreakInfo(BaseModel):
    type: str  # "win" or "loss"
    count: int


class Streaks(BaseModel):
    current: StreakInfo
    best_win: int
    worst_loss: int


class MonthlyReturn(BaseModel):
    year: int
    month: int
    return_pct: float


class ConvictionBucket(BaseModel):
    bucket: str
    wins: int
    losses: int


class HoldTimeStats(BaseModel):
    avg_win_days: float
    avg_loss_days: float
    median_hold_days: float


class StrategyAnalytics(BaseModel):
    strategy_id: str
    sector_exposure: dict[str, dict[str, float]]
    monthly_returns: list[MonthlyReturn]
    streaks: Streaks
    conviction_distribution: list[ConvictionBucket]
    hold_time_stats: HoldTimeStats
    correlations: dict[str, float]
    rolling_beta: list[Any]
    best_trade: dict[str, Any] | None = None
    worst_trade: dict[str, Any] | None = None


class StrategyPosition(BaseModel):
    symbol: str
    shares: int
    entry_price: float
    current_price: float
    market_value: float
    unrealized_pnl: float
    unrealized_pnl_pct: float
    entry_date: str
    days_held: int
    conviction: int | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    rationale: str | None = None


# ---------------------------------------------------------------------------
# Demo strategy definitions
# ---------------------------------------------------------------------------

_STRATEGIES: dict[str, dict[str, Any]] = {
    "trading-agents-research": {
        "name": "TradingAgents Research",
        "description": (
            "Multi-agent external research desk for ticker-level thesis generation. "
            "Runs the pinned TradingAgents wrapper and surfaces a read-only report; "
            "never emits orders or executable strategy signals."
        ),
        "status": StrategyStatus.PAUSED,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": None,
        "win_rate": -1,
        "max_drawdown": None,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "momentum-quality": {
        "name": "Momentum + Quality",
        "description": "Combines relative strength momentum with quality factor screens (high ROE, low debt, earnings stability). Rebalances monthly.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "pead": {
        "name": "PEAD",
        "description": "Post-Earnings Announcement Drift -- exploits the market's under-reaction to earnings surprises by entering after strong beats and holding 30-60 days.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "vrp-harvesting": {
        "name": "VRP Harvesting",
        "description": "Volatility Risk Premium harvesting through systematic short options strategies. Sells put spreads on liquid large-caps when IV rank is elevated.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "earnings-vol-premium": {
        "name": "Earnings Vol Premium",
        "description": "Captures the implied vs realized volatility spread around earnings events. Sells straddles/strangles pre-earnings on names with historically overstated IV.",
        "status": StrategyStatus.PAUSED,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "regime-adaptive": {
        "name": "Regime Adaptive",
        # Wave 6γ (persona-109 copy fix): the prior blurb claimed "ML-based
        # regime detection", which oversold the implementation. The backend
        # classifier is a simple rules engine — SPY trend direction combined
        # with a VIX threshold — not a learned model. Updated to match the
        # code in ``backend/strategies/regime_adaptive/``.
        "description": "Rule-based regime classification (SPY trend + VIX threshold) combined with strategy rotation. Shifts between momentum, mean-reversion, and defensive allocations.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "claude-alpha": {
        "name": "Claude Alpha",
        "description": "LLM-driven equity selection (research-mode v0). The replay-cache infrastructure + scoring abstraction + risk filters are in place; the live Claude prompt path is gated until the OOS replay validates. v0 uses a deterministic fallback scorer (momentum × log-liquidity composite) — NOT alpha — so the rest of the pipeline is exercisable without per-trial LLM cost. See backend/strategies/claude_alpha/spec.md for the v1 path.",
        # Plan C.1: backend strategy package landed; kind='research' so the
        # engine excludes from the autonomous run loop. Status reflects the
        # fact that it's registered but won't trade autonomously.
        "status": StrategyStatus.PLANNED,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "mean-reversion": {
        "name": "Mean Reversion",
        "description": "Long-only weekly-cadence reversal on US large-caps trading > 2σ below their 60-day MA, gated on Piotroski F-score ≥ 5 (quality) and a 7-session pre-earnings skip. Distinct from rsi2-reversal (which is 2-3 session Connors RSI(2)); this is the slower, fundamentally aware book documented by De Bondt-Thaler (1985) + Piotroski (2000). 30-day time-stop or MA-cross exit, whichever first.",
        # Plan C.4: backend strategy package landed; status is now ACTIVE.
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "vcp-breakout": {
        "name": "VCP Breakout",
        "description": "Mark Minervini's Volatility Contraction Pattern: Stage-2 uptrend stocks forming progressively tighter consolidation bases on declining volume; entry on breakout above final pivot with volume ≥ 1.5× average. 8% risk-stop + 20% profit-take + 60-session time-stop. Russell-1000 growth universe; weekly screen + (future) realtime intraday breakout detection. Paper-only until live evidence graduates the strategy.",
        # Plan C.6: backend strategy package landed; status is now ACTIVE.
        # paper_only=True on the StrategyMeta gates DailyPipelineRunner from
        # routing this to live mode until the operator explicitly flips it.
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "pairs-trading": {
        "name": "Pairs Trading",
        "description": "Statistical arbitrage identifying cointegrated stock pairs. Goes long the underperformer and short the outperformer when spread deviates beyond 2 standard deviations, targeting mean reversion of the spread.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "dividend-capture": {
        "name": "Dividend Capture",
        "description": "Long-only ex-dividend-day pricing-anomaly book (Elton-Gruber 1970). Enter MOC T-3 sessions before ex-date on liquid large-caps with ≥0.5% per-event yield + no earnings overlap; exit MOC T+1. Driven by the FMP /dividends-calendar feed via FMPDividendsProvider (Plan C.2). Tax caveat: short-term holding period — best in tax-deferred accounts.",
        # Plan C.2: backend strategy package landed; status is now ACTIVE.
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "sector-rotation": {
        "name": "Sector Rotation",
        "description": "Long-only monthly rotation across 11 GICS sector ETFs (XLK/XLV/XLF/XLY/XLP/XLE/XLI/XLB/XLRE/XLU/XLC), ranked by 6m+12m composite total return; SPY-based risk-off triggers a bond fallback (AGG). Stangl-Jacobsen-Visaltanachoti (2009) + Faber (2013) bond-fallback overlay.",
        # Plan C.5: backend strategy package landed; status is now ACTIVE.
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        # Sharpe / win_rate / max_drawdown are now read from the registry meta
        # + the OOS JSON in the post-processing step at the bottom of this map;
        # leave zeros here as placeholders that the post-processing overrides.
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "gap-fill": {
        "name": "Gap Fill",
        "description": "Branch-Ma (2012) overnight-gap mean-reversion fade on liquid US large-caps. Enter MKT at open+5min on names with 1-4% non-catalyst gaps; exit MKT by 11:00 ET. Long-only on down-gaps by default (fade_down_only); 1-min Alpaca bars, paper-only until live intraday paper evidence graduates the strategy.",
        # Plan C.3: backend strategy package landed; status is now ACTIVE.
        # paper_only=True so DailyPipelineRunner still gates live mode.
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "manual-discretionary": {
        "name": "Manual / Discretionary",
        "description": "Your own trades placed directly on Alpaca. Claude reviews each trade with analysis of what went right and wrong.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "ts-momentum": {
        "name": "Time-Series Momentum",
        "description": "Moskowitz et al. (2012) ETF time-series momentum. Uses sign-of-12-month-return across a multi-asset ETF universe, inverse-vol weighting, monthly/bimonthly rebalance, and optional short legs; crisis alpha requires shorts to be enabled.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "rsi2-reversal": {
        "name": "RSI-2 Mean Reversion",
        "description": "Short-term countertrend strategy from Connors & Alvarez (2009). Buys when RSI(2) drops below 10 while price remains above the 200-day SMA (trading with the trend). Exits on RSI(2) > 90 or 5-day SMA cross. 75% historical win rate, 3-7 day holds.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "dual-momentum": {
        "name": "Dual Momentum",
        "description": "Antonacci Global Equities Momentum (GEM). Rotates 100% of the sleeve between US equity, ex-US equity, and an aggregate-bond fallback using monthly absolute and relative momentum; no stock top-quintile basket.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "pairs-stat-arb": {
        "name": "Pairs Trading (Stat Arb)",
        "description": "Statistical arbitrage from Gatev et al. (2006). Identifies cointegrated stock pairs (e.g., KO/PEP, V/MA), computes spread z-score, enters when deviation exceeds 2 std devs, and exits on mean reversion. Market-neutral by construction with dollar-neutral legs.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "kama-breakout": {
        "name": "KAMA + ATR Breakout",
        "description": "Volatility-adaptive trend strategy based on Kaufman (1998). Uses Kaufman Adaptive Moving Average for trend detection combined with Keltner Channel breakout confirmation. ATR-based Turtle-style position sizing normalizes risk across holdings. Adapts sensitivity: responsive in trends, quiet in chop.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "orb": {
        "name": "Opening Range Breakout",
        "description": "Paper-only opening-range breakout using 1-minute intraday bars. Live routing stays disabled until paper evidence graduates it.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
    "vwap-strategy": {
        "name": "VWAP Bounce / Breakout",
        "description": "Paper-only VWAP session pullback using 5-minute intraday bars. Live routing stays disabled until paper evidence graduates it.",
        "status": StrategyStatus.ACTIVE,
        "invested_amount": 0,
        "total_return_pct": 0,
        "sharpe_ratio": 0,
        "win_rate": 0,
        "max_drawdown": 0,
        "active_positions_count": 0,
        "annualized_return_pct": 0,
        "last_trade_date": "",
    },
}


# --------------------------------------------------------------------------- #
# Registry ↔ route-id mapping                                                  #
# --------------------------------------------------------------------------- #
# The frontend talks hyphen-IDs; the registry uses underscore names.  We keep
# both forward and reverse maps so callers can hand us either form.
_REGISTRY_TO_ROUTE: dict[str, str] = {
    "momentum_quality": "momentum-quality",
    "pead": "pead",
    "vrp_harvest": "vrp-harvesting",
    "earnings_vol": "earnings-vol-premium",
    "regime_adaptive": "regime-adaptive",
    "ts_momentum": "ts-momentum",
    "rsi2_reversal": "rsi2-reversal",
    "dual_momentum": "dual-momentum",
    "pairs_trading": "pairs-trading",
    "kama_breakout": "kama-breakout",
    "orb": "orb",
    "vwap": "vwap-strategy",
    "earnings-options-play": "earnings-options-play",
    "trading_agents_research": "trading-agents-research",
}
_ROUTE_TO_REGISTRY: dict[str, str] = {v: k for k, v in _REGISTRY_TO_ROUTE.items()}
# A1#7 — ``pairs-stat-arb`` is a legacy catalogue alias for the same Python
# package (``pairs_trading``). Both hyphen route ids must resolve to the same
# registry name so ``_live_flags_for`` and other helpers return consistent
# flags regardless of which form the caller hands us. The forward map keeps
# ``pairs_trading -> pairs-trading`` as the canonical pair, but the reverse
# map gets an extra entry so ``pairs-stat-arb`` also looks up ``pairs_trading``.
_ROUTE_TO_REGISTRY["pairs-stat-arb"] = "pairs_trading"


def _live_flags_for(route_id: str) -> tuple[bool, bool]:
    """Return ``(live_disabled, paper_only)`` for a hyphen route id.

    Wave 4 — the live-trading allowlist lives in ``core.config`` keyed on
    the canonical underscore registry name. ``_ROUTE_TO_REGISTRY`` maps the
    hyphen-id form. Strategies not listed in either set return
    ``(False, False)`` — the default for a PASS strategy.
    """
    from core.config import STRATEGY_LIVE_DISABLED, STRATEGY_PAPER_ONLY
    canonical = _ROUTE_TO_REGISTRY.get(route_id, route_id)
    return (
        canonical in STRATEGY_LIVE_DISABLED,
        canonical in STRATEGY_PAPER_ONLY,
    )

# Static fallback registry metadata -- used when the registry hasn't been
# imported yet (e.g. during partial test collection).  Mirrors the
# ``StrategyMeta`` fields declared on each Phase 1 package; keep in sync
# with the ``@register_strategy`` decorator in each ``strategy.py``.
_FALLBACK_META: dict[str, dict[str, Any]] = {
    "momentum_quality": {
        "category": "equity", "required_bars": ["daily"],
        "required_lookback_days": 420, "min_universe_size": 10,
        "supports_shorts": False, "supports_options": False,
        "description": (
            "Long-only cross-sectional momentum + quality "
            "(Jegadeesh-Titman 12-1 momentum + Piotroski F-score). Top-N "
            "composite rank, monthly rebalance."
        ),
    },
    "pead": {
        "category": "equity", "required_bars": ["daily"],
        "required_lookback_days": 1100, "min_universe_size": 50,
        "supports_shorts": False, "supports_options": False,
        "description": (
            "Post-Earnings Announcement Drift. Entries on T+1 open after a "
            "positive earnings surprise; hold 30-60 days."
        ),
    },
    "vrp_harvest": {
        "category": "options", "required_bars": ["daily"],
        "required_lookback_days": 252, "min_universe_size": 1,
        "supports_shorts": True, "supports_options": True,
        "description": (
            "Volatility Risk Premium harvest. Short-vega SPY option "
            "structures when implied vs. realized spread is positive."
        ),
    },
    "earnings_vol": {
        "category": "options", "required_bars": ["daily"],
        "required_lookback_days": 800, "min_universe_size": 1,
        "supports_shorts": True, "supports_options": True,
        "description": (
            "Earnings volatility premium: short-vega structures T-1 pre-"
            "earnings on names with historically overstated IV."
        ),
    },
    "regime_adaptive": {
        "category": "macro", "required_bars": ["daily"],
        "required_lookback_days": 400, "min_universe_size": 2,
        "supports_shorts": False, "supports_options": False,
        "description": (
            "Macro regime detection (risk-on / risk-off). Rotates the "
            "allocation between risk assets and cash-equivalents."
        ),
    },
    "ts_momentum": {
        "category": "macro", "required_bars": ["daily"],
        "required_lookback_days": 540, "min_universe_size": 3,
        "supports_shorts": True, "supports_options": False,
        "description": (
            "Time-Series Momentum (Moskowitz et al. 2012). Sign-of-12-month "
            "return on 6-11 ETFs with inverse-vol weights, monthly/bimonthly "
            "rebalance, and optional signed target weights."
        ),
    },
    "rsi2_reversal": {
        "category": "equity", "required_bars": ["daily"],
        "required_lookback_days": 300, "min_universe_size": 20,
        "supports_shorts": False, "supports_options": False,
        "description": (
            "Connors RSI-2 mean reversion. MOC entries when RSI(2) < 10 "
            "while price is above the 200-day SMA."
        ),
    },
    "dual_momentum": {
        "category": "macro", "required_bars": ["daily"],
        "required_lookback_days": 400, "min_universe_size": 3,
        "supports_shorts": False, "supports_options": False,
        "description": (
            "Antonacci Global Equities Momentum (GEM). Relative + absolute "
            "momentum rotates one sleeve among US equity, ex-US equity, and "
            "aggregate bonds."
        ),
    },
    "pairs_trading": {
        "category": "pairs", "required_bars": ["daily"],
        "required_lookback_days": 400, "min_universe_size": 2,
        "supports_shorts": True, "supports_options": False,
        "description": (
            "Cointegrated pairs arbitrage (Gatev et al. 2006). Long/short "
            "on z-score deviations, exits on mean reversion."
        ),
    },
    "kama_breakout": {
        "category": "equity", "required_bars": ["daily"],
        "required_lookback_days": 260, "min_universe_size": 1,
        "supports_shorts": False, "supports_options": False,
        "description": (
            "Kaufman Adaptive Moving Average + Keltner breakout. "
            "ATR-based Turtle sizing, chandelier trailing exit."
        ),
    },
    "orb": {
        "category": "intraday", "required_bars": ["1min"],
        "required_lookback_days": 0, "min_universe_size": 1,
        "supports_shorts": False, "supports_options": False,
        "description": (
            "Opening-Range Breakout. Registered backend consumes 1-minute "
            "intraday bars and is paper-only until live evidence graduates it."
        ),
    },
    "vwap": {
        "category": "intraday", "required_bars": ["5min"],
        "required_lookback_days": 150, "min_universe_size": 1,
        "supports_shorts": False, "supports_options": False,
        "description": (
            "VWAP session-pullback. Registered backend consumes 5-minute "
            "intraday bars and is paper-only until live evidence graduates it."
        ),
    },
    "trading_agents_research": {
        "category": "research", "required_bars": [],
        "required_lookback_days": 0, "min_universe_size": 1,
        "supports_shorts": False, "supports_options": False,
        "description": (
            "Read-only TradingAgents research wrapper. External yfinance-based "
            "artifact generation with no order-routing contract."
        ),
    },
}


def _canonical_id(strategy_id: str) -> str:
    """Map either hyphen or underscore form to the canonical route id."""
    if strategy_id in _REGISTRY_TO_ROUTE:
        return _REGISTRY_TO_ROUTE[strategy_id]
    return strategy_id


# --------------------------------------------------------------------------- #
# OOS metric extraction                                                        #
# --------------------------------------------------------------------------- #
# The OOS metric JSONs live in two places depending on environment:
#   * Container: ``backend/data/oos/`` is inside the image (the Dockerfile's
#     COPY . . ships only the backend/ tree, so the repo-root
#     ``audit-reports/`` directory is not reachable). The bundled copy is the
#     canonical source in production.
#   * Dev: both the bundled copy and ``<repo>/audit-reports/`` exist; either
#     works. We prefer the bundled copy for parity with prod; if it's absent
#     (e.g. a fresh checkout before the sync script has run), we fall back to
#     the repo-root directory so dev workflows keep working.
_BUNDLED_OOS_DIR = FilePath(__file__).resolve().parents[2] / "data" / "oos"
_REPO_OOS_DIR = FilePath(__file__).resolve().parents[3] / "audit-reports"


def _pick_oos_dir() -> FilePath:
    """Return the first directory that actually contains OOS JSONs.

    Just checking ``is_dir()`` is not enough — an empty ``backend/data/oos/``
    would happily win the selection and silently starve every strategy of
    Sharpe/drawdown. We require at least one ``phase1-*-oos.json`` file to
    be present before we consider a directory the active source.
    """
    for candidate in (_BUNDLED_OOS_DIR, _REPO_OOS_DIR):
        if candidate.is_dir() and any(candidate.glob("phase1-*-oos.json")):
            return candidate
    # Fall back to the bundled path so call sites still get a deterministic
    # ``Path`` even when no OOS data ships — ``_load_oos_for`` handles the
    # missing-file case gracefully.
    return _BUNDLED_OOS_DIR


_OOS_DIR = _pick_oos_dir()


def _extract_oos_metrics(payload: Any) -> dict[str, float] | None:
    """Shape-tolerant reader for ``phase1-<name>-oos.json`` payloads.

    Supports several historical shapes:

    * ``{"metrics": {...}}`` — Wave A flat form.
    * ``{"oos_metrics": {...}}`` — older alt label.
    * ``{"summary": {...}}`` — super-thin summaries.
    * ``{"walkforward": {"oos": {...}}}`` — walk-forward reports.
    * ``{"tuned": {"metrics": {...}}}`` — tuner outputs.
    """
    if not isinstance(payload, dict) or not payload:
        return None
    for key in ("metrics", "oos_metrics", "summary"):
        val = payload.get(key)
        if isinstance(val, dict) and val:
            return val
    wf = payload.get("walkforward")
    if isinstance(wf, dict):
        oos = wf.get("oos")
        if isinstance(oos, dict) and oos:
            return oos
    tuned = payload.get("tuned")
    if isinstance(tuned, dict):
        tm = tuned.get("metrics")
        if isinstance(tm, dict) and tm:
            return tm
    return None


def _load_oos_for(registry_name: str) -> dict[str, Any]:
    """Load the phase-1 OOS JSON for a registry strategy, if present.

    Returns a dict with the canonical metric fields we surface through the
    catalogue (``sharpe``, ``max_drawdown``, ``hit_rate``, ``cagr``,
    ``profit_factor``).  Missing fields are ``None``; never zero.
    """
    path = _OOS_DIR / f"phase1-{registry_name}-oos.json"
    if not path.exists():
        return {
            "sharpe": None, "max_drawdown": None, "hit_rate": None,
            "cagr": None, "profit_factor": None,
        }
    try:
        payload = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {
            "sharpe": None, "max_drawdown": None, "hit_rate": None,
            "cagr": None, "profit_factor": None,
        }
    m = _extract_oos_metrics(payload) or {}

    def _f(k: str) -> float | None:
        v = m.get(k)
        try:
            return round(float(v), 4) if v is not None else None
        except (TypeError, ValueError):
            return None

    return {
        "sharpe": _f("sharpe"),
        "max_drawdown": _f("max_drawdown"),
        "hit_rate": _f("hit_rate"),
        "cagr": _f("cagr"),
        "profit_factor": _f("profit_factor"),
    }


def _reload_oos_metrics() -> dict[str, dict[str, Any]]:
    """Refresh ``_STRATEGIES`` entries with live OOS metrics.

    Registry-backed entries get real Sharpe / max-drawdown from
    ``audit-reports/phase1-<name>-oos.json``.  Entries without an OOS JSON
    (``dual-momentum``, ``kama-breakout``, ``claude-alpha``, etc.) are set
    to ``None`` — the frontend distinguishes missing-metric from zero.
    """
    # Pull registry meta if whatever called us has already warmed the
    # registry (via the pipeline, the tuner CLI, or direct ``load_all()``).
    # We do NOT trigger ``load_all()`` or individual-module imports here:
    # the per-strategy test conftests cross-alias ``strategies.*`` ↔
    # ``backend.strategies.*`` around their own test collection, and any
    # import from THIS module that precedes them re-registers the same
    # strategy class under two names, raising ``StrategyRegistrationError``.
    # Falling back to ``_FALLBACK_META`` below keeps the catalogue
    # authoritative even when the registry hasn't been loaded yet.
    try:
        from strategies.registry import get_meta as _get_meta
    except Exception:
        _get_meta = None  # type: ignore[assignment]

    for reg_name, route_id in _REGISTRY_TO_ROUTE.items():
        oos = _load_oos_for(reg_name)
        if route_id not in _STRATEGIES:
            # Registry-only entry; seed the minimum shape.
            _STRATEGIES[route_id] = {
                "name": reg_name.replace("_", " ").title(),
                "description": "",
                "status": StrategyStatus.ACTIVE,
                "invested_amount": 0,
                "total_return_pct": 0,
                "win_rate": 0,
                "active_positions_count": 0,
                "annualized_return_pct": 0,
                "last_trade_date": "",
            }
        entry = _STRATEGIES[route_id]
        entry["registry_name"] = reg_name
        entry["sharpe_ratio"] = oos["sharpe"]
        entry["max_drawdown"] = oos["max_drawdown"]
        entry["hit_rate"] = oos["hit_rate"]
        entry["cagr"] = oos["cagr"]
        entry["profit_factor"] = oos["profit_factor"]
        # Attach registry static-meta (category / description / bars / etc).
        # Prefer the live registry -- falls back to the hard-coded
        # ``_FALLBACK_META`` above when the registry hasn't been loaded yet
        # (this is the usual path during partial test collection).
        meta_dict: dict[str, Any] | None = None
        if _get_meta is not None:
            try:
                meta = _get_meta(reg_name)
                # New StrategyMeta renamed required_lookback_days -> lookback_days
                # and dropped supports_shorts / supports_options. Derive the
                # legacy shape from the category for back-compat with the
                # catalogue renderer.
                cat = meta.category
                meta_dict = {
                    "category": cat,
                    "description": meta.description,
                    "required_bars": list(meta.required_bars),
                    "required_lookback_days": meta.lookback_days,
                    "min_universe_size": meta.min_universe_size,
                    "supports_shorts": cat in ("pairs", "macro"),
                    "supports_options": cat == "options",
                }
            except KeyError:
                meta_dict = None
        if meta_dict is None:
            meta_dict = _FALLBACK_META.get(reg_name)
        if meta_dict is not None:
            entry["category"] = meta_dict["category"]
            entry["description"] = meta_dict["description"] or entry.get("description", "")
            entry["required_bars"] = list(meta_dict["required_bars"])
            entry["required_lookback_days"] = meta_dict["required_lookback_days"]
            entry["min_universe_size"] = meta_dict["min_universe_size"]
            entry["supports_shorts"] = meta_dict["supports_shorts"]
            entry["supports_options"] = meta_dict["supports_options"]

    # Non-registry entries (claude-alpha, manual-discretionary, gap-fill, …)
    # must surface ``None`` for metrics, not zeros.  Leave description intact.
    _REGISTRY_ROUTE_IDS = set(_REGISTRY_TO_ROUTE.values())
    for route_id, entry in _STRATEGIES.items():
        if route_id in _REGISTRY_ROUTE_IDS:
            continue
        entry.setdefault("sharpe_ratio", None)
        entry.setdefault("max_drawdown", None)
        entry.setdefault("hit_rate", None)
        entry.setdefault("cagr", None)
        entry.setdefault("profit_factor", None)
        # Force null metrics even if the old placeholder had 0.
        for k in ("sharpe_ratio", "max_drawdown", "hit_rate", "cagr", "profit_factor"):
            if entry.get(k) == 0:
                entry[k] = None

    return _STRATEGIES


# Apply at import so ``_STRATEGIES`` reflects reality from the first call.
# NOTE: we swallow registry-load failures here so a partial strategy package
# (e.g. mid-refactor) doesn't take the whole API down at import.  The route
# handlers call _reload_oos_metrics() again on demand when the catalogue is
# served, so any recovered state is picked up later.
try:
    _reload_oos_metrics()
except Exception:  # pragma: no cover - defensive import-time guard
    logger.warning("initial _reload_oos_metrics failed", exc_info=True)


def _annualized_return(return_pct: float, first_trade_date: str | None = None) -> float:
    """Calculate proper CAGR-based annualized return.

    Uses the actual first trade date from the ledger.  If no trades exist
    or the holding period is less than 30 days the raw (non-annualized)
    return is returned to avoid misleading extrapolation.

    Annualisation uses **252 trading days** (not 365 calendar days) and
    compounds regardless of period length. The previous implementation
    linearly extrapolated for <365 days and used calendar days, producing
    understated CAGR on short / medium-length track records.
    """
    if return_pct == 0 or not first_trade_date:
        return 0

    try:
        start = date.fromisoformat(first_trade_date[:10])
    except (ValueError, TypeError):
        return 0

    # Approximate trading days between two dates: calendar days * (252/365).
    # For very short windows this is a rough estimate — a proper count would
    # iterate the USMarketCalendar sessions, but CAGR stability doesn't need
    # exact business-day counts once the window is >30 days.
    calendar_days = max((date.today() - start).days, 1)
    trading_days = max(int(calendar_days * 252 / 365), 1)

    # Don't annualize short track records -- just show the raw return
    if trading_days < 21:  # <~ 1 trading month
        return round(return_pct, 2)

    # Always compound — linear extrapolation was wrong for windows <1yr.
    annualized = ((1 + return_pct / 100) ** (252 / trading_days) - 1) * 100
    return round(annualized, 2)


def _generate_equity_curve(
    strategy_id: str, invested: float, return_pct: float, days: int = 90,
) -> list[dict[str, Any]]:
    """Generate a deterministic equity curve for the last N days."""
    seed = int(hashlib.md5(strategy_id.encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)

    end_value = invested * (1 + return_pct / 100.0)
    # Daily drift to reach end_value from invested over `days` trading days
    daily_drift = (end_value / invested) ** (1.0 / days) - 1.0

    curve: list[dict[str, Any]] = []
    value = invested
    base_date = date.today() - timedelta(days=days)

    for i in range(days):
        d = base_date + timedelta(days=i)
        # Skip weekends
        if d.weekday() >= 5:
            continue
        noise = rng.gauss(0, 0.008)
        value *= 1 + daily_drift + noise
        value = max(value, invested * 0.80)  # floor
        curve.append({"date": d.isoformat(), "value": round(value, 2)})

    # Ensure last value matches expected
    if curve:
        curve[-1]["value"] = round(end_value, 2)

    return curve


def _get_real_strategy_performance(ledger_instance: Any | None = None) -> dict[str, dict]:
    """Compute actual performance from trade ledger.

    Accepts an optional pre-loaded ledger instance to avoid re-reading
    the file (useful when the caller has already performed a sync).
    """
    try:
        if ledger_instance is None:
            from data.ingestion.trade_ledger import TradeLedger
            ledger_instance = TradeLedger()

        perf: dict[str, dict] = {}
        for trade in ledger_instance._data.get("trades", []):
            strat = trade.get("strategy", "unknown")
            if strat not in perf:
                perf[strat] = {
                    "trades": 0, "pnl": 0.0, "wins": 0, "losses": 0, "scratches": 0, "open": 0,
                    # BUG-004: ``invested`` = cost basis of OPEN positions only
                    # (Σ shares × entry_price for status=='open'). Previously
                    # summed over ALL trades including closed, which produced
                    # nonsensical "Invested $4.9K · 0 positions" on the PEAD
                    # card. ``gross_deployed`` retains the historical gross
                    # capital deployed in case a caller still wants it.
                    "invested": 0.0, "gross_deployed": 0.0,
                    "last_trade_date": "", "first_trade_date": "",
                    "best_trade": None, "worst_trade": None,
                }
            perf[strat]["trades"] += 1
            entry_price = trade.get("entry_price", 0)
            shares = trade.get("shares", 0)
            perf[strat]["gross_deployed"] += entry_price * shares
            if trade.get("status") == "open":
                perf[strat]["invested"] += entry_price * shares
            entry_t = trade.get("entry_time", "")
            exit_t = trade.get("exit_time", "") or ""
            # BUG-030: last_trade_date must be ≥ most-recent entry AND
            # most-recent exit. The previous implementation only tracked
            # entry timestamps, so a manual/discretionary strategy whose
            # most recent action was opening a position still displayed the
            # older exit date.
            latest_activity = max(entry_t or "", exit_t or "")
            if latest_activity and latest_activity > perf[strat]["last_trade_date"]:
                perf[strat]["last_trade_date"] = latest_activity[:10] if len(latest_activity) >= 10 else latest_activity
            if entry_t and (not perf[strat]["first_trade_date"] or entry_t < perf[strat]["first_trade_date"]):
                perf[strat]["first_trade_date"] = entry_t[:10] if len(entry_t) >= 10 else entry_t
            if trade.get("status") == "open":
                perf[strat]["open"] += 1
            if trade.get("status") == "closed" and entry_price:
                # Prefer stored pnl/pnl_pct; fall back to calculation.
                # Fallback must respect side: short P&L = (entry - exit) * shares.
                pnl = trade.get("pnl")
                raw_side = str(trade.get("side") or "long").lower()
                is_short = raw_side in {"short", "sell", "s"}
                if pnl is None and trade.get("exit_price"):
                    if is_short:
                        pnl = (entry_price - trade["exit_price"]) * shares
                    else:
                        pnl = (trade["exit_price"] - entry_price) * shares
                if pnl is not None:
                    perf[strat]["pnl"] += pnl
                    # Classify: win / loss / scratch (break-even). Break-even
                    # trades are excluded from win_rate denominators downstream.
                    if pnl > 0:
                        perf[strat]["wins"] += 1
                    elif pnl < 0:
                        perf[strat]["losses"] += 1
                    else:
                        perf[strat]["scratches"] += 1
                    # Track best/worst trades
                    pnl_pct = trade.get("pnl_pct")
                    if pnl_pct is None and trade.get("exit_price"):
                        if is_short:
                            pnl_pct = round(((entry_price - trade["exit_price"]) / entry_price) * 100, 2)
                        else:
                            pnl_pct = round(((trade["exit_price"] - entry_price) / entry_price) * 100, 2)
                    trade_summary = {"symbol": trade.get("symbol", ""), "pnl": pnl, "pnl_pct": pnl_pct or 0}
                    if perf[strat]["best_trade"] is None or pnl > perf[strat]["best_trade"]["pnl"]:
                        perf[strat]["best_trade"] = trade_summary
                    if perf[strat]["worst_trade"] is None or pnl < perf[strat]["worst_trade"]["pnl"]:
                        perf[strat]["worst_trade"] = trade_summary

        return perf
    except Exception:
        logger.warning("Failed to compute real strategy performance from trade ledger", exc_info=True)
        return {}


# Strategy name to strategy ID mapping
_STRATEGY_NAME_TO_ID: dict[str, str] = {
    "momentum_quality": "momentum-quality",
    "pead": "pead",
    "vrp_harvest": "vrp-harvesting",
    "earnings_vol": "earnings-vol-premium",
    "regime_adaptive": "regime-adaptive",
    "claude_alpha": "claude-alpha",
    "mean_reversion": "mean-reversion",
    "vcp_breakout": "vcp-breakout",
    "manual": "manual-discretionary",
    "pairs_trading": "pairs-trading",
    "dividend_capture": "dividend-capture",
    "sector_rotation": "sector-rotation",
    "gap_fill": "gap-fill",
    # Technical analysis strategies
    "ts_momentum": "ts-momentum",
    "rsi2_reversal": "rsi2-reversal",
    "dual_momentum": "dual-momentum",
    "kama_breakout": "kama-breakout",
    "orb": "orb",
    "vwap": "vwap-strategy",
    "vwap_strategy": "vwap-strategy",
    "earnings-options-play": "earnings-options-play",
    "earnings_options_play": "earnings-options-play",
    "trading-agents-research": "trading-agents-research",
    "trading_agents_research": "trading-agents-research",
    # Stat arb (pairs_trading already above)
    "pairs_stat_arb": "pairs-stat-arb",
}

# Reverse mapping: strategy route ID -> ledger strategy name
_ID_TO_NAME: dict[str, str] = {v: k for k, v in _STRATEGY_NAME_TO_ID.items()}


async def _get_strategy_status_override(strategy_id: str) -> StrategyStatus | None:
    """Retrieve a persisted strategy status override from Redis."""
    try:
        from core.redis import cache_get
        result = await cache_get(f"strategy_status:{strategy_id}")
        return StrategyStatus(result["status"]) if result else None
    except Exception:
        logger.warning("Failed to read strategy status override from Redis", exc_info=True)
        return None


async def _set_strategy_status_override(strategy_id: str, status: StrategyStatus) -> None:
    """Persist a strategy status override to Redis (no TTL — survives restarts)."""
    try:
        from core.redis import cache_set
        await cache_set(f"strategy_status:{strategy_id}", {"status": status.value}, ttl_seconds=0)
    except Exception:
        logger.warning("Failed to persist strategy status override to Redis", exc_info=True)


async def _get_strategy_data(strategy_id: str) -> dict[str, Any] | None:
    canonical = _canonical_id(strategy_id)
    data = _STRATEGIES.get(canonical)
    if data is None:
        return None
    result = dict(data)
    override = await _get_strategy_status_override(canonical)
    if override is not None:
        result["status"] = override
    return result


def _is_known_strategy_id(strategy_id: str) -> bool:
    """Return True if the given route id is a known strategy.

    persona-9 #7 — used to guarantee that ``/strategies/<bad-id>/...`` paths
    raise a real 404 instead of returning a 200 with placeholder zeros (which
    used to happen on a few branches when ``_get_strategy_data`` was bypassed).
    A strategy is "known" if either:

      * It appears in the catalogue dict ``_STRATEGIES`` (live + planned), OR
      * It is registered in the live strategy registry via
        ``IMPLEMENTED_STRATEGY_ROUTE_IDS`` / ``PLANNED_STRATEGY_ROUTE_IDS``
        (covers route ids added at registration time but not yet seeded into
        the catalogue dict).

    The registry import is lazy + best-effort: we don't want a registry-load
    failure (e.g. a half-imported strategy module during partial test
    collection) to take the catalogue down. ``_STRATEGIES`` alone is the
    canonical truth in that case.
    """
    canonical = _canonical_id(strategy_id)
    if canonical in _STRATEGIES:
        return True
    try:
        from strategies.registry import (
            IMPLEMENTED_STRATEGY_ROUTE_IDS,
            PLANNED_STRATEGY_ROUTE_IDS,
        )
        if (
            canonical in IMPLEMENTED_STRATEGY_ROUTE_IDS
            or canonical in PLANNED_STRATEGY_ROUTE_IDS
        ):
            return True
    except Exception:
        logger.debug("strategies registry unavailable for is-known check", exc_info=True)
    return False


async def _require_strategy(strategy_id: str) -> dict[str, Any]:
    """Resolve ``strategy_id`` or raise a real HTTP 404 (persona-9 #7).

    Centralises the existence check so every id-taking endpoint reports the
    same error shape (`detail: "Strategy '<id>' not found"`). Previously each
    endpoint open-coded this check; if a future refactor accidentally
    bypassed it on one branch the route would return 200 with default zeros
    (silent 404-as-200, the persona-9 finding).
    """
    data = await _get_strategy_data(strategy_id)
    if data is None and not _is_known_strategy_id(strategy_id):
        raise HTTPException(
            status_code=404,
            detail=f"Strategy '{strategy_id}' not found",
        )
    if data is None:
        # Known strategy id (registry says yes) but no catalogue entry yet —
        # this should never happen in production because ``_reload_oos_metrics``
        # seeds every registry id at import time. Synthesize a minimal record
        # so the route doesn't 500 in the rare case where the registry races
        # ahead of the catalogue.
        canonical = _canonical_id(strategy_id)
        return {
            "name": canonical.replace("-", " ").title(),
            "description": "",
            "status": StrategyStatus.ACTIVE,
            "invested_amount": 0,
            "total_return_pct": 0,
            "win_rate": 0,
            "active_positions_count": 0,
            "annualized_return_pct": 0,
            "last_trade_date": "",
        }
    return data


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/catalog", response_model=list[StrategyCatalogEntry])
async def strategy_catalog() -> list[StrategyCatalogEntry]:
    """A3#3 — compact catalogue for the strategies list page.

    Returns ``[{id, slug, name, live_disabled, paper_only}, ...]`` for every
    strategy known to the rail. No DB calls — everything is read from the
    static ``_STRATEGIES`` dict and the live-flag config maps. Auth is
    enforced at the router level (``Depends(require_auth)`` in ``main.py``).

    The list page calls this once on mount and uses the flags to render a
    "NOT READY FOR LIVE" / "PAPER-ONLY" pill on each card, so users see the
    warning without clicking through to the detail page. Declared BEFORE the
    ``/{strategy_id}`` variadic routes so FastAPI matches it as a literal path
    instead of treating "catalog" as a strategy id.

    ``id`` and ``slug`` are the same hyphen-id today (duplicated so future
    renames can diverge without breaking clients); ``name`` is the
    human-readable display name straight from the catalogue entry.
    """
    entries: list[StrategyCatalogEntry] = []
    for sid, data in _STRATEGIES.items():
        live_disabled, paper_only = _live_flags_for(sid)
        entries.append(
            StrategyCatalogEntry(
                id=sid,
                slug=sid,
                name=data["name"],
                live_disabled=live_disabled,
                paper_only=paper_only,
            )
        )
    return entries


# ---------------------------------------------------------------------------
# Strategy reverse-lookup by symbol (T11 — symbols-page strategy band)
# ---------------------------------------------------------------------------
# Frontend usage: /symbols/[ticker] StrategyReverseLookup section. For a given
# symbol, fan out across the strategy catalogue and report whether the user
# already holds the symbol under each strategy. Read-only; no DB writes.
#
# Declared BEFORE ``/{strategy_id}/...`` so FastAPI's order-based matcher
# resolves ``/by-symbol/<sym>`` to this route instead of falling through to a
# variadic-id route. (No real conflict today because the second segment of
# ``/{strategy_id}/positions`` etc. is a literal, but order-first registration
# keeps the route resilient to future literal-segment additions.)
#
# Iter 11 wires real per-strategy ``in_universe`` via the new ``Strategy.is_in_universe``
# hook (default True for back-compat, overridden by ~6 strategies with bounded
# static universes). Iter 16 wires the deferred third chip state: the daily
# strategy runner now bulk-writes per-symbol entry signals to a Redis cache
# (``services.signal_cache``); this endpoint reads from that cache *after*
# the strategy class's no-op defaults run, so a cache hit lights up
# ``has_entry_signal=True`` + ``score`` + ``side`` while a miss preserves the
# iter-11 falsy/None contract. Strategy classes themselves remain pure / sync /
# Redis-unaware -- the layering keeps strategies unit-testable without an
# async Redis stub.


class StrategyMatchPosition(BaseModel):
    qty: int
    entry_price: float
    unrealized_pnl: float


class StrategyMatch(BaseModel):
    strategy_id: str
    name: str
    in_universe: bool
    has_entry_signal: bool
    current_position: StrategyMatchPosition | None = None
    score: float | None = None
    side: str | None = None  # "long" | "short" | null
    last_evaluated: str  # ISO 8601 UTC


class StrategyMatchesResponse(BaseModel):
    symbol: str
    matches: list[StrategyMatch]
    generated_at: str  # ISO 8601 UTC


_OPEN_TRADE_STATUSES: frozenset[str] = frozenset({"open", "partial", "partial_fill"})


def _resolve_strategy_instance(route_id: str):
    """Return a transient instance of the strategy registered under ``route_id``.

    Catalogue route-ids use hyphens (``momentum-quality``) while the
    in-process registry uses underscores (``momentum_quality``); we
    cross-walk via ``_ROUTE_TO_REGISTRY`` and fall back to the route id
    itself for entries (claude-alpha, manual-discretionary, …) that are
    listed in the catalogue but not registered.

    Strategies are stateless from the reverse-lookup perspective —
    instantiating a fresh one per lookup is fine; it's a few-line ``__init__``
    that runs in microseconds. Returns ``None`` when no class is registered
    or instantiation raises (a misconfigured strategy must not 500 the
    whole symbols page).
    """
    try:
        from strategies.registry import get_strategy as _get_strategy, load_all as _load_all
    except Exception:  # pragma: no cover — strategies pkg missing
        return None

    canonical = _ROUTE_TO_REGISTRY.get(route_id, route_id.replace("-", "_"))
    try:
        cls = _get_strategy(canonical)
    except KeyError:
        # First lookup may race the lazy loader; try once more after walk.
        try:
            _load_all()
            cls = _get_strategy(canonical)
        except (KeyError, Exception):
            return None
    except Exception:
        return None

    try:
        return cls()
    except Exception:
        logger.debug(
            "strategies_by_symbol: cannot instantiate %s (%s)",
            canonical,
            route_id,
            exc_info=True,
        )
        return None


@router.get("/by-symbol/{symbol}", response_model=StrategyMatchesResponse)
async def get_strategies_by_symbol(
    symbol: str = Path(..., description="Ticker symbol (e.g. NVDA)"),
) -> StrategyMatchesResponse:
    """Return per-strategy reverse-lookup matches for a symbol.

    Read-only fan-out across the catalogue. For each strategy, reports:

    - ``in_universe`` — read from ``Strategy.is_in_universe`` (iter 11). The
      base ABC defaults to ``True`` for back-compat; ~6 strategies override
      with their static universe (sector ETFs, factor seeds, mega-cap pairs).
    - ``current_position`` — populated from the trade ledger when an open trade
      exists for ``(strategy=ledger_name, symbol=SYM)``. Statuses considered
      "open" are ``open``, ``partial``, ``partial_fill``.
    - ``has_entry_signal`` / ``score`` / ``side`` — first try the strategy
      class's no-op default hooks (``Strategy.has_entry_signal`` / ``signal_score``
      / ``signal_side``), then fall through to the iter-16 signal cache
      (``services.signal_cache``). The daily strategy runner writes per-symbol
      entries on each run; on a cache hit the endpoint surfaces
      ``has_entry_signal=True`` with the cached ``score`` (conviction/100) and
      ``side`` (``long``/``short``). On a miss we preserve the iter-11 falsy
      defaults so the symbols-page chip degrades to "In universe" rather than
      lighting up a stale signal.

    Cached in Redis for 60s keyed on the symbol so the symbols-page card doesn't
    hammer the ledger when a user flips between tabs.
    """
    sym_upper = symbol.upper().strip()
    if not sym_upper:
        raise HTTPException(status_code=400, detail="symbol must be non-empty")

    cache_key = f"strategies_by_symbol:{sym_upper}"
    cache_get_fn = None
    cache_set_fn = None
    try:
        from core.redis import cache_get as _cg, cache_set as _cs
        cache_get_fn = _cg
        cache_set_fn = _cs
    except Exception:
        pass

    if cache_get_fn is not None:
        cached = await cache_get_fn(cache_key)
        if cached is not None:
            try:
                return StrategyMatchesResponse(**cached)
            except Exception:
                # Corrupt cache value — fall through to recompute.
                logger.warning(
                    "strategies_by_symbol: discarding bad cached payload for %s",
                    sym_upper,
                )

    # ------------------------------------------------------------------
    # Build a {ledger_strategy_name -> open_trade_dict} map for this symbol
    # ------------------------------------------------------------------
    # SQL-bounded scan via the ``symbol`` index on trade_ledger; one query
    # answers the whole fan-out instead of N per-strategy queries.
    open_by_ledger_name: dict[str, dict[str, Any]] = {}
    try:
        from data.ingestion.trade_ledger import TradeLedger

        ledger = TradeLedger()
        rows = ledger.list({"symbol": sym_upper})
        for row in rows:
            status = (row.get("status") or "").lower()
            if status not in _OPEN_TRADE_STATUSES:
                continue
            strat = row.get("strategy")
            if not strat:
                continue
            # Multiple open rows under the same strategy aggregate by qty;
            # entry_price stays as the first row's. The symbols-page card just
            # needs "you're holding this" + qty, so exact-cost-basis decomp
            # isn't required.
            existing = open_by_ledger_name.get(strat)
            if existing is None:
                open_by_ledger_name[strat] = dict(row)
            else:
                existing["shares"] = (existing.get("shares") or 0) + (row.get("shares") or 0)
                if row.get("pnl") is not None:
                    existing["pnl"] = (existing.get("pnl") or 0) + (row.get("pnl") or 0)
    except Exception:
        logger.warning(
            "strategies_by_symbol: ledger lookup failed for %s; returning empty positions",
            sym_upper,
            exc_info=True,
        )

    now_iso = datetime.now(timezone.utc).isoformat()

    matches: list[StrategyMatch] = []
    # Iterate the canonical hyphen-id catalogue. The sort guarantees a stable
    # order for the frontend (and tests).
    for route_id in sorted(_STRATEGIES.keys()):
        catalog_entry = _STRATEGIES[route_id]
        ledger_name = _ID_TO_NAME.get(route_id, route_id)
        open_trade = open_by_ledger_name.get(ledger_name)

        position: StrategyMatchPosition | None = None
        if open_trade is not None:
            try:
                qty_raw = open_trade.get("shares") or 0
                entry_raw = open_trade.get("entry_price") or 0
                pnl_raw = open_trade.get("pnl")  # nullable on open rows
                position = StrategyMatchPosition(
                    qty=int(qty_raw),
                    entry_price=float(entry_raw),
                    unrealized_pnl=float(pnl_raw) if pnl_raw is not None else 0.0,
                )
            except (TypeError, ValueError):
                # Malformed row — treat as no position rather than 500.
                position = None

        # T11: pull universe + signal status from the strategy's own hooks.
        # When no strategy class is registered (catalogue-only entries like
        # ``claude-alpha`` and ``manual-discretionary``), default to the
        # legacy iter-10 shape: in-universe / no signal.
        instance = _resolve_strategy_instance(route_id)
        if instance is None:
            in_universe = True
            has_signal = False
            score: float | None = None
            side: str | None = None
        else:
            try:
                in_universe = bool(instance.is_in_universe(sym_upper))
            except Exception:
                in_universe = True
            try:
                has_signal = bool(instance.has_entry_signal(sym_upper))
            except Exception:
                has_signal = False
            try:
                score_raw = instance.signal_score(sym_upper)
                score = float(score_raw) if score_raw is not None else None
            except Exception:
                score = None
            try:
                side_raw = instance.signal_side(sym_upper)
                side = str(side_raw) if side_raw is not None else None
            except Exception:
                side = None

        # Iter 16: cache fallback. Strategy classes default to False/None
        # because the per-strategy signal surface is async (Redis); pushing
        # it into the strategy class would force every strategy to learn
        # about Redis. Instead, after the no-op defaults we look up the
        # cache here and override on hit. The cache is keyed by the snake_case
        # registry name (``momentum_quality``) since that's what the daily
        # ``UnifiedStrategyRunner`` writes under; we cross-walk the route's
        # hyphenated id to that name via ``_ID_TO_NAME`` (already used a few
        # lines up to look up the open ledger row). A miss -- including a
        # Redis outage -- preserves the iter-11 falsy/None contract.
        try:
            from services.signal_cache import get_signal as _get_cached_signal
            cached = await _get_cached_signal(ledger_name, sym_upper)
        except Exception:
            cached = None

        if cached is not None:
            has_signal = True
            if cached["score"] is not None:
                score = cached["score"]
            if cached["side"] is not None:
                side = cached["side"]

        matches.append(
            StrategyMatch(
                strategy_id=route_id,
                name=str(catalog_entry.get("name") or route_id),
                in_universe=in_universe,
                has_entry_signal=has_signal,
                current_position=position,
                score=score,
                side=side,
                last_evaluated=now_iso,
            )
        )

    response = StrategyMatchesResponse(
        symbol=sym_upper,
        matches=matches,
        generated_at=now_iso,
    )

    if cache_set_fn is not None:
        try:
            await cache_set_fn(cache_key, response.model_dump(), ttl_seconds=60)
        except Exception:
            # cache_set already logs at WARNING; nothing else to do.
            pass

    return response


@router.get("/", response_model=list[StrategySummary])
async def list_strategies() -> list[StrategySummary]:
    """List all strategies with real ledger data including unrealized P&L.

    Fetches live Alpaca positions and syncs the ledger first so that
    untracked positions, share mismatches, and stale entries are corrected
    before computing performance numbers.
    """
    import httpx
    from core.config import settings
    from data.ingestion.trade_ledger import TradeLedger

    # ------------------------------------------------------------------
    # 1. Fetch live Alpaca positions
    # ------------------------------------------------------------------
    alpaca_positions: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions",
                headers={
                    "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                    "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                },
            )
            if resp.status_code == 200:
                alpaca_positions = resp.json()
    except Exception:
        logger.warning("Failed to fetch Alpaca positions for strategy sync", exc_info=True)

    # ------------------------------------------------------------------
    # 2. Read-only ledger access — C2 fix.
    #    sync_with_alpaca used to run here on every GET, which mutated state
    #    on a read and repeatedly corrupted open trades whenever Alpaca
    #    returned an empty positions list. Sync now runs exclusively from
    #    the scheduler (backend/data/ingestion/pipeline_runner.py).
    # ------------------------------------------------------------------
    ledger = TradeLedger()

    # ------------------------------------------------------------------
    # 3. Compute real performance from the ledger
    # ------------------------------------------------------------------
    real_perf = _get_real_strategy_performance(ledger)

    # ------------------------------------------------------------------
    # 4. Build Alpaca position map keyed by strategy for accurate counts
    #    and unrealized P&L (Alpaca provides unrealized_pl per position)
    # ------------------------------------------------------------------
    # Round-29 / persona-G P0: pre-fix this loop did
    # ``for t in ledger._data["trades"]: ...`` for EVERY broker
    # position (50M-row full-table scan × N positions = O(N×M)). Now
    # do ONE SQL query bounded by status='open' to seed a per-symbol
    # → strategy lookup, then iterate broker positions in O(positions).
    open_ledger_trades = ledger.list({"status": "open"})
    sym_to_strat_id: dict[str, str] = {}
    for t in open_ledger_trades:
        sym = t.get("symbol")
        if not sym or sym in sym_to_strat_id:
            continue
        strat_name = t.get("strategy", "manual")
        sym_to_strat_id[sym] = _STRATEGY_NAME_TO_ID.get(strat_name, "manual-discretionary")

    alpaca_by_strategy: dict[str, list[dict]] = {}
    for pos in alpaca_positions:
        sym = pos.get("symbol", "")
        strat_id = sym_to_strat_id.get(sym, "manual-discretionary")
        alpaca_by_strategy.setdefault(strat_id, []).append(pos)

    # Unrealized P&L per strategy from Alpaca position data
    unrealized_by_strat_id: dict[str, float] = {}
    for strat_id, positions in alpaca_by_strategy.items():
        unrealized_by_strat_id[strat_id] = sum(
            float(p.get("unrealized_pl", 0)) for p in positions
        )

    # ------------------------------------------------------------------
    # 5. Build summaries
    # ------------------------------------------------------------------
    summaries = []
    for sid, data in _STRATEGIES.items():
        d = await _get_strategy_data(sid)
        if d is None:
            continue

        # Start with sentinel values -- only real ledger data populates these
        win_rate = -1.0  # -1 = no closed trades (frontend shows "N/A")
        total_return = 0.0
        invested = 0.0  # current open-position cost basis
        gross_deployed = 0.0  # cumulative deployed (used as return-% denominator)
        pnl_dollars = 0.0

        # Active count from Alpaca positions (ground truth)
        active_count = len(alpaca_by_strategy.get(sid, []))

        for strat_name, strat_id in _STRATEGY_NAME_TO_ID.items():
            if strat_id == sid and strat_name in real_perf:
                rp = real_perf[strat_name]
                if rp["trades"] > 0:
                    pnl_dollars = rp["pnl"] + unrealized_by_strat_id.get(sid, 0)
                    invested = rp.get("invested", 0.0)
                    gross_deployed = rp.get("gross_deployed", invested)
                    # Decided = wins + losses (scratch trades excluded per
                    # audit: pnl == 0 is neither a win nor a loss).
                    decided = rp.get("wins", 0) + rp.get("losses", 0)
                    if decided > 0:
                        win_rate = round(rp["wins"] / decided * 100, 1)
                    # BUG-004: return % is computed against gross capital
                    # deployed, not currently-invested cost basis (which
                    # collapses to 0 once all positions exit).
                    if gross_deployed > 0:
                        total_return = round(pnl_dollars / gross_deployed * 100, 1)
                break

        # BUG-004: force invested to 0 when there are no live positions. The
        # card displays "N positions · Invested $X" — when N=0 the Invested
        # figure must also be 0 (a closed strategy has no capital deployed).
        if active_count == 0:
            invested = 0.0

        # Build compact sparkline (last 20 equity curve points)
        sparkline_data: list[float] = []
        # Batch B (P0-06) — every code path that populates ``sparkline_data``
        # below routes through ``_generate_equity_curve``, which is a
        # MD5(strategy_id)-seeded random walk forced to terminate at
        # total_return. Until this is replaced with a real ledger-derived
        # curve, mark the field synthetic so the frontend can disclose it.
        sparkline_is_synthetic = False
        if gross_deployed > 0:
            curve = _generate_equity_curve(sid, max(gross_deployed, 1), total_return)
            sparkline_data = [p["value"] for p in curve[-20:]] if curve else []
            if sparkline_data:
                sparkline_is_synthetic = True

        live_disabled, paper_only = _live_flags_for(sid)
        summaries.append(StrategySummary(
            id=sid,
            name=d["name"],
            description=d["description"],
            status=d["status"],
            invested_amount=round(invested, 2),
            invested_amount_precise=round(invested, 2),
            total_return_pct=total_return,
            sharpe_ratio=0,
            win_rate=win_rate,
            active_positions_count=active_count,
            sparkline=sparkline_data,
            sparkline_is_synthetic=sparkline_is_synthetic,
            live_disabled=live_disabled,
            paper_only=paper_only,
        ))
    return summaries


async def _leaderboard_open_positions_by_strategy() -> dict[str, list[str]]:
    """Map ``strategy_name -> [symbols]`` for currently-open ledger rows.

    Used to attribute Alpaca's per-position ``unrealized_pl`` back to a
    strategy without iterating the full ``trade_ledger`` Python-side. The
    result set is bounded by the number of *open* positions (dozens, not
    millions).
    """
    from core.config import settings
    if settings.SKIP_DB_INIT:
        return {}
    try:
        from sqlalchemy import text
        from core.database import _get_session_factory

        factory = _get_session_factory()
        async with factory() as session:
            rows = (
                await session.execute(
                    text(
                        """
                        SELECT symbol, strategy
                          FROM trade_ledger
                         WHERE status = 'open'
                        """
                    )
                )
            ).all()
        out: dict[str, list[str]] = {}
        for sym, strat in rows:
            out.setdefault(strat or "", []).append(sym or "")
        return out
    except Exception:
        logger.warning(
            "leaderboard: open-position strategy lookup failed", exc_info=True,
        )
        return {}


async def _leaderboard_aggregate_closed() -> list[dict[str, Any]]:
    """Run the GROUP BY SQL aggregate and return per-strategy rows.

    Wave 6α Fix 3 (persona-124 P1): this replaces the old
    O(strategies × trades) nested-Python loop. The query computes every
    per-strategy statistic the route needs — total P&L, trade count,
    gross deployed, and the mean / stdev of per-trade returns required
    for the Sharpe calculation — in ONE aggregate scan.

    Sharpe must honour trade ``side``: for shorts, the return is
    ``(entry - exit) / entry`` rather than ``(exit - entry) / entry``.
    We flip the sign with ``CASE WHEN side IN ('short','sell','s') …`` so
    the mean and stddev are computed on the correctly-signed series.

    Average hold-days is computed via
    ``EXTRACT(EPOCH FROM (exit_time - entry_time)) / 86400`` and floored
    at 1 day (a fraction-of-a-day hold shouldn't amplify Sharpe).
    """
    from core.config import settings
    if settings.SKIP_DB_INIT:
        return []
    try:
        from sqlalchemy import text
        from core.database import _get_session_factory

        sql = text(
            """
            WITH closed AS (
                SELECT
                    strategy,
                    pnl,
                    entry_price,
                    exit_price,
                    shares,
                    entry_time,
                    exit_time,
                    CASE WHEN LOWER(COALESCE(side, 'long'))
                              IN ('short', 'sell', 's')
                         THEN 'short' ELSE 'long' END AS normalized_side
                FROM trade_ledger
                WHERE status = 'closed'
                  AND entry_price IS NOT NULL
                  AND exit_price IS NOT NULL
                  AND entry_price <> 0
            ),
            with_returns AS (
                SELECT
                    strategy,
                    pnl,
                    entry_price,
                    exit_price,
                    shares,
                    CASE
                        WHEN normalized_side = 'short'
                            THEN (entry_price - exit_price) / entry_price
                        ELSE (exit_price - entry_price) / entry_price
                    END AS per_trade_return,
                    GREATEST(
                        EXTRACT(
                            EPOCH FROM (exit_time - entry_time)
                        ) / 86400.0,
                        1.0
                    ) AS hold_days
                FROM closed
            )
            SELECT
                strategy,
                COUNT(*)                               AS trades,
                COALESCE(SUM(pnl), 0)                  AS realized_pnl,
                COALESCE(SUM(entry_price * shares), 0) AS gross_deployed,
                AVG(per_trade_return)                  AS mean_return,
                STDDEV_SAMP(per_trade_return)          AS stdev_return,
                AVG(hold_days)                         AS avg_hold_days
              FROM with_returns
             GROUP BY strategy
            """
        )
        factory = _get_session_factory()
        async with factory() as session:
            rows = (await session.execute(sql)).all()
        out: list[dict[str, Any]] = []
        for r in rows:
            m = r._mapping if hasattr(r, "_mapping") else r
            out.append({
                "strategy": m["strategy"],
                "trades": int(m["trades"] or 0),
                "realized_pnl": float(m["realized_pnl"] or 0),
                "gross_deployed": float(m["gross_deployed"] or 0),
                "mean_return": float(m["mean_return"] or 0) if m["mean_return"] is not None else 0.0,
                "stdev_return": float(m["stdev_return"] or 0) if m["stdev_return"] is not None else 0.0,
                "avg_hold_days": float(m["avg_hold_days"] or 0) if m["avg_hold_days"] is not None else 0.0,
            })
        return out
    except Exception:
        logger.warning(
            "leaderboard: GROUP BY aggregate failed", exc_info=True,
        )
        return []


@router.get("/leaderboard")
async def strategy_leaderboard() -> dict[str, Any]:
    """Return strategies ranked by total return with Sharpe ratios.

    Wave 6α Fix 3 (persona-124 P1): previously this handler ran an
    O(strategies × trades) nested-loop in Python (iterating the *full*
    ledger once per strategy). The aggregate now runs as a single
    ``GROUP BY strategy`` SQL query; the result is cached in Redis for
    60 s so the dashboard — which polls this endpoint — does not
    recompute on every tick.

    Computes realised + unrealised P&L and ranks strategies from best
    to worst performer.
    """
    import json
    import httpx
    from datetime import date as _date
    from core.config import settings
    from core.redis import get_redis

    # ----------------------------------------------------------------------
    # Redis cache lookup — the leaderboard payload is completely
    # determined by the (date, current-closed-trades, current-open-
    # positions) tuple. A 60s TTL keyed on today's date means:
    #   * a single full recompute per minute per process
    #   * day rollover invalidates naturally (new key)
    # ----------------------------------------------------------------------
    today_key = _date.today().isoformat()
    cache_key = f"leaderboard:{today_key}"
    try:
        redis = await get_redis()
        cached = await redis.get(cache_key)
        if cached:
            try:
                return json.loads(cached)
            except Exception:
                # Poisoned value — ignore and recompute.
                logger.warning(
                    "leaderboard: cached value at %s was not valid JSON — recomputing",
                    cache_key,
                )
    except Exception:
        logger.debug("leaderboard: redis unavailable, skipping cache read",
                     exc_info=True)
        redis = None

    # ----------------------------------------------------------------------
    # Fetch live Alpaca positions for unrealised P&L.
    # ----------------------------------------------------------------------
    alpaca_positions: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions",
                headers={
                    "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                    "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                },
            )
            if resp.status_code == 200:
                alpaca_positions = resp.json()
    except Exception:
        logger.warning("Failed to fetch Alpaca positions for leaderboard",
                       exc_info=True)

    # ----------------------------------------------------------------------
    # Attribute Alpaca's unrealised P&L to the strategy that owns each
    # symbol (via a single bounded SQL lookup over open positions — not a
    # full-table scan).
    # ----------------------------------------------------------------------
    open_strategy_by_symbol: dict[str, str] = {}
    for strat_name, symbols in (await _leaderboard_open_positions_by_strategy()).items():
        for sym in symbols:
            open_strategy_by_symbol[sym] = strat_name

    unrealized_by_id: dict[str, float] = {}
    for pos in alpaca_positions:
        sym = pos.get("symbol", "")
        strat_name = open_strategy_by_symbol.get(sym, "manual")
        strat_id = _STRATEGY_NAME_TO_ID.get(strat_name, "manual-discretionary")
        unrealized_by_id[strat_id] = (
            unrealized_by_id.get(strat_id, 0) + float(pos.get("unrealized_pl", 0))
        )

    # ----------------------------------------------------------------------
    # Single GROUP BY SQL aggregate — replaces the O(strategies × trades)
    # nested Python loop.
    # ----------------------------------------------------------------------
    agg_rows = await _leaderboard_aggregate_closed()
    agg_by_name: dict[str, dict[str, Any]] = {r["strategy"]: r for r in agg_rows}

    entries: list[dict[str, Any]] = []
    for sid, sdata in _STRATEGIES.items():
        pnl_dollars = 0.0
        gross_deployed = 0.0
        sharpe = 0.0
        # Find the ledger-name for this route-id (the route-id → ledger-name
        # relationship is 1:1 per strategy via _STRATEGY_NAME_TO_ID).
        ledger_name = next(
            (name for name, route_id in _STRATEGY_NAME_TO_ID.items() if route_id == sid),
            None,
        )
        agg = agg_by_name.get(ledger_name) if ledger_name else None
        if agg and agg["trades"] > 0:
            pnl_dollars = agg["realized_pnl"] + unrealized_by_id.get(sid, 0)
            gross_deployed = agg["gross_deployed"]

            # Compute Sharpe identically to the prior Python implementation —
            # mean/stdev of per-trade returns come from the SQL aggregate.
            avg_hold_days = agg["avg_hold_days"] or 1.0
            if not math.isfinite(avg_hold_days) or avg_hold_days <= 0:
                avg_hold_days = 1.0
            ann_factor = math.sqrt(252 / avg_hold_days)
            if agg["trades"] > 1 and agg["stdev_return"] > 0:
                sharpe = round(
                    agg["mean_return"] / agg["stdev_return"] * ann_factor, 2
                )
            # Single-trade "Sharpe" is mathematically undefined; leave at 0.

        # BUG-004 (preserved): divide by gross deployed, not cost basis.
        return_pct = (
            round(pnl_dollars / gross_deployed * 100, 1)
            if gross_deployed > 0 else 0.0
        )

        entries.append({
            "id": sid,
            "name": sdata["name"],
            "return_pct": return_pct,
            "sharpe": sharpe,
        })

    # Rank by return descending
    entries.sort(key=lambda e: e["return_pct"], reverse=True)
    for rank, entry in enumerate(entries, 1):
        entry["rank"] = rank

    worst_performer = entries[-1]["id"] if entries else None
    best_sharpe_entry = max(entries, key=lambda e: e["sharpe"]) if entries else None

    payload = {
        "leaderboard": entries,
        "worst_performer": worst_performer,
        "best_sharpe": best_sharpe_entry["id"] if best_sharpe_entry else None,
    }

    # Write to cache (60s TTL — matches the dashboard poll cadence so we
    # recompute at most once per minute per process).
    if redis is not None:
        try:
            await redis.set(cache_key, json.dumps(payload), ex=60)
        except Exception:
            logger.debug("leaderboard: redis cache write failed", exc_info=True)

    return payload


@router.get("/{strategy_id}/performance", response_model=StrategyPerformance)
async def get_strategy_performance(
    strategy_id: str = Path(..., description="Strategy identifier"),
) -> StrategyPerformance:
    """Get detailed performance data for a single strategy.

    Syncs the ledger with Alpaca positions first, then uses Alpaca
    unrealized P&L directly for accuracy.
    """
    import httpx
    from core.config import settings
    from data.ingestion.trade_ledger import TradeLedger

    # persona-9 #7 — real 404 on bad ids (was 200 with placeholder zeros
    # on some branches before this helper existed).
    data = await _require_strategy(strategy_id)

    # ------------------------------------------------------------------
    # Fetch Alpaca positions and sync ledger
    # ------------------------------------------------------------------
    alpaca_positions: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions",
                headers={
                    "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                    "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                },
            )
            if resp.status_code == 200:
                alpaca_positions = resp.json()
    except Exception:
        logger.warning("Failed to fetch Alpaca positions for strategy performance", exc_info=True)

    # Read-only: sync_with_alpaca removed from GET per C2.
    ledger = TradeLedger()

    # ------------------------------------------------------------------
    # Map Alpaca positions to this strategy
    # ------------------------------------------------------------------
    ledger_name = _ID_TO_NAME.get(strategy_id, strategy_id)
    # Round-29 / persona-G P0: same fix as the strategies-list above —
    # bound the SQL query to status='open' (uses ix_trade_ledger_status)
    # and seed a per-symbol → strategy_id map. Replaces the per-position
    # full-ledger nested scan.
    open_ledger_trades = ledger.list({"status": "open"})
    sym_to_strat_id: dict[str, str] = {}
    for t in open_ledger_trades:
        sym = t.get("symbol")
        if not sym or sym in sym_to_strat_id:
            continue
        sym_to_strat_id[sym] = _STRATEGY_NAME_TO_ID.get(
            t.get("strategy", "manual"), "manual-discretionary"
        )
    alpaca_for_strat: list[dict] = [
        pos for pos in alpaca_positions
        if sym_to_strat_id.get(pos.get("symbol", ""), "manual-discretionary") == strategy_id
    ]

    unrealized = sum(float(p.get("unrealized_pl", 0)) for p in alpaca_for_strat)
    active_count = len(alpaca_for_strat)

    # ------------------------------------------------------------------
    # Compute performance from ledger
    # ------------------------------------------------------------------
    invested = 0.0  # cost basis of CURRENTLY-OPEN positions
    gross_deployed = 0.0  # all-time Σ shares × entry_price (return-% denominator)
    return_pct = 0.0
    win_rate = -1.0
    pnl_dollars = 0.0
    last_trade = ""
    first_trade = ""

    real_perf = _get_real_strategy_performance()

    for strat_name, strat_id in _STRATEGY_NAME_TO_ID.items():
        if strat_id == strategy_id and strat_name in real_perf:
            rp = real_perf[strat_name]
            if rp["trades"] > 0:
                pnl_dollars = rp["pnl"] + unrealized
                invested = rp.get("invested", 0.0)
                gross_deployed = rp.get("gross_deployed", invested)
                last_trade = rp.get("last_trade_date", "")
                first_trade = rp.get("first_trade_date", "")
                # Scratch trades (pnl == 0) excluded from win_rate denominator.
                decided = rp.get("wins", 0) + rp.get("losses", 0)
                if decided > 0:
                    win_rate = round(rp["wins"] / decided * 100, 1)
                # BUG-004: divide by gross deployed, not currently-invested
                # (which is 0 once all positions are closed).
                if gross_deployed > 0:
                    return_pct = round(pnl_dollars / gross_deployed * 100, 1)
            break

    # BUG-004: zero the Invested figure when no positions are live. The
    # detail page shows "0 positions" and "Invested $X" — those two
    # numbers must be consistent. ``gross_deployed`` is preserved as the
    # return-% denominator (see above) and ``return_dollars`` still
    # reflects realised + unrealised P&L.
    if active_count == 0:
        invested = 0.0

    current_value = round(invested + pnl_dollars, 2)
    return_dollars = round(pnl_dollars, 2)

    equity_curve = _generate_equity_curve(strategy_id, max(gross_deployed, 1), return_pct) if gross_deployed > 0 else []

    # Re-read OOS metrics from the canonical _STRATEGIES entry. _reload_oos_metrics()
    # merges real Sharpe / max-drawdown / hit-rate / CAGR / profit-factor from the
    # audit-reports/phase1-*-oos.json files into this dict at import time; the raw
    # `data` returned by _get_strategy_data() already carries them (None when the
    # strategy has no OOS payload on disk).
    canonical = _canonical_id(strategy_id)
    oos_source = _STRATEGIES.get(canonical, data)
    oos_sharpe = oos_source.get("sharpe_ratio")
    oos_max_dd = oos_source.get("max_drawdown")
    oos_hit_rate = oos_source.get("hit_rate")
    oos_cagr = oos_source.get("cagr")
    oos_profit_factor = oos_source.get("profit_factor")

    live_disabled, paper_only = _live_flags_for(_canonical_id(strategy_id))
    return StrategyPerformance(
        name=data["name"],
        description=data["description"],
        status=data["status"],
        invested_amount=round(invested, 2),
        current_value=current_value,
        total_return_pct=return_pct,
        annualized_return_pct=_annualized_return(return_pct, first_trade),
        return_dollars=return_dollars,
        win_rate=win_rate,
        sharpe_ratio=oos_sharpe,
        max_drawdown=oos_max_dd,
        hit_rate=oos_hit_rate,
        cagr=oos_cagr,
        profit_factor=oos_profit_factor,
        active_positions_count=active_count,
        equity_curve=equity_curve,
        last_trade_date=last_trade,
        live_disabled=live_disabled,
        paper_only=paper_only,
    )


@router.post("/{strategy_id}/toggle", response_model=ToggleResponse)
async def toggle_strategy(
    request: Request,
    strategy_id: str = Path(..., description="Strategy identifier"),
    username: str = Depends(require_auth),
) -> ToggleResponse:
    """Toggle a strategy between active and paused.

    Concurrency model (persona-9 #3 — reinforced over Wave 17 baseline):

      1. **In-process serialisation** — a per-strategy ``asyncio.Lock``
         serialises toggles arriving at the same uvicorn worker. Persona-9
         reproduced inconsistent reads from 4 parallel toggles in a single
         browser tab; those all land on one worker, where the lock now
         eliminates the race entirely.
      2. **Cross-worker CAS** — Redis WATCH / MULTI / EXEC ensures that even
         if two workers race past the in-process lock, the second one sees
         a ``WatchError`` and retries with the fresh value. The previous
         implementation had a 5-attempt budget and zero backoff; we now
         bump it to 8 and add bounded jitter (5–25 ms) so retries don't
         lockstep with each other.

    The strategies table is in-code (no Postgres row) so a SELECT...FOR
    UPDATE strategy isn't applicable here; the in-process lock + tightened
    Redis CAS achieves equivalent serialisation for the realistic load
    pattern (single user toggling fast).
    """
    import orjson
    from core.redis import get_redis
    from redis.exceptions import WatchError

    # persona-9 #7 — guarantee a real 404 on bad ids before any Redis I/O.
    data = await _require_strategy(strategy_id)

    # Round-15 / persona-7 P1: reject toggles for non-toggleable
    # statuses. PLANNED entries are catalogue stubs with no backend
    # — flipping them to ACTIVE would misrepresent operational state
    # to every consumer (and the new "pause-all" UX could fan out a
    # mass activation across every PLANNED strategy on a single click).
    # BACKTEST is also untoggleable from this endpoint.
    if data["status"] not in (StrategyStatus.ACTIVE, StrategyStatus.PAUSED):
        raise HTTPException(
            status_code=422,
            detail=(
                f"Strategy {strategy_id!r} has status {data['status'].value!r} "
                "and cannot be toggled (only active↔paused is supported)."
            ),
        )

    canonical = _canonical_id(strategy_id)
    if canonical == "trading-agents-research":
        raise HTTPException(
            status_code=422,
            detail="TradingAgents Research is a read-only research tool and cannot be toggled.",
        )
    redis_key = f"strategy_status:{canonical}"

    redis_client = await get_redis()
    max_attempts = 8  # was 5; persona-9 saw stale reads with 5 under load
    last_err: Exception | None = None
    previous_status: StrategyStatus = data["status"]
    new_status: StrategyStatus = StrategyStatus.PAUSED

    # In-process lock around the entire CAS loop. See module docstring on
    # ``_TOGGLE_LOCKS`` for the rationale.
    async with _get_toggle_lock(canonical):
        for attempt in range(max_attempts):
            try:
                async with redis_client.pipeline(transaction=True) as pipe:
                    await pipe.watch(redis_key)
                    raw = await pipe.get(redis_key)
                    # Resolve current status from Redis (override) or the
                    # canonical _STRATEGIES table when no override is set.
                    current_status: StrategyStatus = data["status"]
                    if raw is not None:
                        try:
                            parsed = orjson.loads(raw)
                            current_status = StrategyStatus(parsed["status"])
                        except Exception:
                            # Corrupt entry — fall through to inversion of
                            # the canonical default rather than refusing.
                            logger.warning(
                                "toggle_strategy: corrupt Redis value for %s: %r",
                                redis_key, raw,
                            )
                    next_status = (
                        StrategyStatus.PAUSED
                        if current_status == StrategyStatus.ACTIVE
                        else StrategyStatus.ACTIVE
                    )
                    pipe.multi()
                    pipe.set(
                        redis_key,
                        orjson.dumps({"status": next_status.value}).decode(),
                    )
                    await pipe.execute()
                    previous_status = current_status
                    new_status = next_status
                    break
            except WatchError as exc:
                last_err = exc
                logger.info(
                    "toggle_strategy: WATCH conflict for %s (attempt %d/%d), retrying with jitter",
                    strategy_id, attempt + 1, max_attempts,
                )
                # Bounded jitter so multiple workers don't lockstep their
                # retries. 5–25 ms is short enough to feel instant in the UI
                # and long enough to spread the contention.
                await asyncio.sleep(random.uniform(0.005, 0.025))
                continue
            except Exception as exc:
                # Redis-level failure — fall back to non-atomic write so
                # the user toggle still lands. (`_set_strategy_status_override`
                # itself swallows secondary Redis failures.)
                last_err = exc
                logger.warning(
                    "toggle_strategy: Redis transaction failed (%s), "
                    "falling back to non-atomic write", exc, exc_info=True,
                )
                previous_status = data["status"]
                new_status = (
                    StrategyStatus.PAUSED
                    if previous_status == StrategyStatus.ACTIVE
                    else StrategyStatus.ACTIVE
                )
                await _set_strategy_status_override(canonical, new_status)
                break
        else:
            # Exhausted retries without breaking out — surface the conflict.
            # Round-15 / persona-7 P2: don't echo the Redis exception repr
            # back to the FE (it can include host:port / connection details).
            # Log details server-side, return a generic 409.
            logger.error(
                "toggle_strategy: %d WATCH conflicts in a row for %s; last_err=%r",
                max_attempts, strategy_id, last_err,
            )
            raise HTTPException(
                status_code=409,
                detail="Strategy toggle conflicted with concurrent updates; please retry.",
            )

    # Round-27 / persona-D P0: audit the toggle. Pre-fix this only
    # logged via ``logger.warning`` to stdout — Loki could lose it,
    # and SOX/SEC 17a-4 expects a durable Postgres trail of every
    # operator-initiated change to active risk-execution state.
    rid = REQUEST_ID.get()
    try:
        await write_audit(
            "strategy_toggle",
            username=username,
            ip=request.client.host if request.client else None,
            request_id=rid if rid and rid != "-" else None,
            details={
                "strategy_id": strategy_id,
                "previous_status": previous_status.value,
                "new_status": new_status.value,
            },
        )
    except Exception:
        logger.error(
            "strategy_toggle: audit persistence failed for %s",
            strategy_id, exc_info=True,
        )

    return ToggleResponse(
        id=strategy_id,
        name=data["name"],
        previous_status=previous_status,
        new_status=new_status,
    )


# ---------------------------------------------------------------------------
# Risk Monitor Toggle
# ---------------------------------------------------------------------------

class RiskMonitorState(BaseModel):
    enabled: bool
    message: str


@router.post("/admin/risk-monitor", response_model=RiskMonitorState)
async def toggle_risk_monitor(
    request: Request,
    enabled: bool = True,
    admin: str = Depends(require_admin),
) -> RiskMonitorState:
    """Toggle the Master Agent risk monitor on or off.

    Admin-only (security-audit-r3 P0 #1). When disabled, all risk checks
    (P1-P4) are bypassed and trades are auto-approved (only duplicate symbol
    check remains) — toggling this off is a trust-me-bro override that should
    never be exposed to a non-admin principal.

    Round-27 / persona-D P0: every flip writes an audit_log row. Disabling
    the risk monitor is the most consequential single change in the
    system — every trade-gate (P1-P4) goes silent. SOX/SEC 17a-4 require
    a durable Postgres trail of operator-initiated risk-control changes.
    """
    from data.ingestion.master_agent import MasterAgent
    from core.risk_monitor_state import read_risk_monitor_enabled, write_risk_monitor_enabled

    previous = await read_risk_monitor_enabled(MasterAgent.RISK_MONITOR_ENABLED)
    try:
        await write_risk_monitor_enabled(enabled)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Risk monitor state store unavailable") from exc
    MasterAgent.RISK_MONITOR_ENABLED = enabled
    logger.warning(
        "Risk monitor toggled: %s -> %s by %s",
        "ON" if previous else "OFF",
        "ON" if enabled else "OFF",
        admin,
    )
    rid = REQUEST_ID.get()
    try:
        await write_audit(
            "risk_monitor_toggle",
            username=admin,
            ip=request.client.host if request.client else None,
            request_id=rid if rid and rid != "-" else None,
            details={
                "previous_enabled": previous,
                "new_enabled": enabled,
            },
        )
    except Exception:
        logger.error(
            "risk_monitor_toggle: audit persistence failed", exc_info=True,
        )
    return RiskMonitorState(
        enabled=enabled,
        message=f"Risk monitor {'enabled' if enabled else 'disabled'}. "
                f"{'All risk checks active.' if enabled else 'P1-P4 checks bypassed — trades auto-approved.'}",
    )


@router.get("/admin/risk-monitor", response_model=RiskMonitorState)
async def get_risk_monitor_state(
    _admin: str = Depends(require_admin),
) -> RiskMonitorState:
    """Get current risk monitor state. Admin-only (security-audit-r3 P0 #1)."""
    from data.ingestion.master_agent import MasterAgent
    from core.risk_monitor_state import read_risk_monitor_enabled

    enabled = await read_risk_monitor_enabled(MasterAgent.RISK_MONITOR_ENABLED)
    MasterAgent.RISK_MONITOR_ENABLED = enabled
    return RiskMonitorState(
        enabled=enabled,
        message=f"Risk monitor is {'enabled' if enabled else 'disabled'}.",
    )


# ---------------------------------------------------------------------------
# Strategy Competition Leaderboard
# ---------------------------------------------------------------------------

class StrategyLeaderboardEntry(BaseModel):
    strategy: str
    total_trades: int
    open_trades: int
    closed_trades: int
    wins: int
    losses: int
    win_rate: float
    total_pnl: float
    return_pct: float
    best_trade_pnl: float
    worst_trade_pnl: float


@router.get("/admin/leaderboard", response_model=list[StrategyLeaderboardEntry])
async def get_strategy_leaderboard(
    _admin: str = Depends(require_admin),
) -> list[StrategyLeaderboardEntry]:
    """Get per-strategy P&L leaderboard for the competition. Admin-only
    (security-audit-r3 P0 #1). Leaks competitive strategy performance data
    that would otherwise be visible to any authenticated user."""
    from data.ingestion.trade_ledger import TradeLedger

    ledger = TradeLedger()
    perf = ledger.get_strategy_performance()

    entries = [
        StrategyLeaderboardEntry(**p)
        for p in sorted(perf.values(), key=lambda x: x["total_pnl"], reverse=True)
    ]
    return entries


def _get_symbol_sector_map() -> dict[str, str]:
    """Build a symbol -> sector lookup from the symbols database."""
    try:
        from api.routes.symbols import _build_demo_symbols
        return {
            s.symbol: s.sector
            for s in _build_demo_symbols()
            if s.sector
        }
    except Exception:
        logger.warning("Failed to build symbol-sector map", exc_info=True)
        return {}


def _parse_iso_dt(s: str | None) -> datetime | None:
    """Parse an ISO 8601 datetime string, returning None on failure."""
    if not s:
        return None
    try:
        # Handle both timezone-aware and naive strings
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


@router.get("/{strategy_id}/analytics", response_model=StrategyAnalytics)
async def get_strategy_analytics(
    strategy_id: str = Path(..., description="Strategy identifier"),
) -> StrategyAnalytics:
    """Return in-depth analytics for a single strategy computed from the trade ledger."""
    # persona-9 #7 — real 404 on unknown ids.
    data = await _require_strategy(strategy_id)

    from data.ingestion.trade_ledger import TradeLedger
    ledger = TradeLedger()

    # Resolve ledger strategy name from route ID
    ledger_name = _ID_TO_NAME.get(strategy_id, strategy_id)

    # Round-29 / persona-G P0: SQL-bounded fetch instead of pulling
    # the FULL trade ledger and filtering in Python. Pre-fix this
    # endpoint did 4 sequential full-ledger scans (sector, monthly,
    # streaks, conviction passes) plus a 5th in
    # ``_get_real_strategy_performance``. With ``ledger.list`` the
    # planner uses ``ix_trade_ledger_strategy`` (declared in
    # ``_ensure_schema``) for a bounded scan. The 4 in-memory passes
    # downstream then operate on only this strategy's rows.
    all_trades = ledger.list({"strategy": ledger_name})
    open_trades = [t for t in all_trades if t.get("status") == "open"]
    closed_trades = [t for t in all_trades if t.get("status") == "closed"]

    # -- Sector exposure (from open positions) --
    sector_map = _get_symbol_sector_map()
    sector_notional: dict[str, float] = defaultdict(float)
    total_notional = 0.0
    for t in open_trades:
        notional = (t.get("entry_price") or 0) * (t.get("shares") or 0)
        sector = sector_map.get(t.get("symbol", ""), "Unknown")
        sector_notional[sector] += notional
        total_notional += notional

    current_sector: dict[str, float] = {}
    if total_notional > 0:
        current_sector = {
            sector: round(val / total_notional, 4)
            for sector, val in sorted(sector_notional.items())
        }

    # -- Monthly returns (group closed trades by exit month, sum P&L %) --
    monthly_pnl: dict[tuple[int, int], float] = defaultdict(float)
    monthly_invested: dict[tuple[int, int], float] = defaultdict(float)
    for t in closed_trades:
        exit_dt = _parse_iso_dt(t.get("exit_time"))
        if exit_dt is None:
            continue
        key = (exit_dt.year, exit_dt.month)
        monthly_pnl[key] += t.get("pnl", 0) or 0
        monthly_invested[key] += (t.get("entry_price") or 0) * (t.get("shares") or 0)

    monthly_returns: list[MonthlyReturn] = []
    for (year, month) in sorted(monthly_pnl.keys()):
        invested = monthly_invested[(year, month)]
        ret_pct = round(monthly_pnl[(year, month)] / invested * 100, 2) if invested > 0 else 0.0
        monthly_returns.append(MonthlyReturn(year=year, month=month, return_pct=ret_pct))

    # -- Streaks (chronological order by exit_time) --
    sorted_closed = sorted(
        closed_trades,
        key=lambda t: t.get("exit_time") or "",
    )
    current_streak_type = "win"
    current_streak_count = 0
    best_win_streak = 0
    worst_loss_streak = 0
    running_win = 0
    running_loss = 0

    for t in sorted_closed:
        pnl = t.get("pnl") or 0
        if pnl > 0:
            running_win += 1
            running_loss = 0
            best_win_streak = max(best_win_streak, running_win)
        elif pnl < 0:
            running_loss += 1
            running_win = 0
            worst_loss_streak = max(worst_loss_streak, running_loss)
        else:
            # breakeven resets both
            running_win = 0
            running_loss = 0

    # Determine current streak from the tail of sorted trades
    if sorted_closed:
        last_pnl = sorted_closed[-1].get("pnl") or 0
        if last_pnl >= 0:
            current_streak_type = "win"
            current_streak_count = running_win
        else:
            current_streak_type = "loss"
            current_streak_count = running_loss
    else:
        current_streak_type = "win"
        current_streak_count = 0

    # -- Conviction distribution --
    buckets = ["0-20", "20-40", "40-60", "60-80", "80-100"]
    conviction_wins: dict[str, int] = {b: 0 for b in buckets}
    conviction_losses: dict[str, int] = {b: 0 for b in buckets}

    for t in closed_trades:
        conv = t.get("conviction") or 0
        pnl = t.get("pnl") or 0
        if conv <= 20:
            bucket = "0-20"
        elif conv <= 40:
            bucket = "20-40"
        elif conv <= 60:
            bucket = "40-60"
        elif conv <= 80:
            bucket = "60-80"
        else:
            bucket = "80-100"

        if pnl > 0:
            conviction_wins[bucket] += 1
        elif pnl < 0:
            conviction_losses[bucket] += 1
        # breakeven trades not counted in either

    conviction_distribution = [
        ConvictionBucket(bucket=b, wins=conviction_wins[b], losses=conviction_losses[b])
        for b in buckets
    ]

    # -- Hold time stats --
    win_hold_days: list[float] = []
    loss_hold_days: list[float] = []
    all_hold_days: list[float] = []

    for t in closed_trades:
        entry_dt = _parse_iso_dt(t.get("entry_time"))
        exit_dt = _parse_iso_dt(t.get("exit_time"))
        if entry_dt is None or exit_dt is None:
            continue
        hold = (exit_dt - entry_dt).total_seconds() / 86400.0
        all_hold_days.append(hold)
        pnl = t.get("pnl") or 0
        if pnl > 0:
            win_hold_days.append(hold)
        elif pnl < 0:
            loss_hold_days.append(hold)

    hold_time_stats = HoldTimeStats(
        avg_win_days=round(sum(win_hold_days) / len(win_hold_days), 1) if win_hold_days else 0.0,
        avg_loss_days=round(sum(loss_hold_days) / len(loss_hold_days), 1) if loss_hold_days else 0.0,
        median_hold_days=round(statistics.median(all_hold_days), 1) if all_hold_days else 0.0,
    )

    # -- Correlations & rolling beta (placeholder -- require market data) --
    correlations = {"SPY": 0.0, "QQQ": 0.0}
    rolling_beta: list[Any] = []

    # -- Best / worst trade --
    real_perf = _get_real_strategy_performance()
    rp = real_perf.get(ledger_name, {})
    best_trade = rp.get("best_trade")
    worst_trade = rp.get("worst_trade")

    return StrategyAnalytics(
        strategy_id=strategy_id,
        sector_exposure={"current": current_sector},
        monthly_returns=monthly_returns,
        streaks=Streaks(
            current=StreakInfo(type=current_streak_type, count=current_streak_count),
            best_win=best_win_streak,
            worst_loss=worst_loss_streak,
        ),
        conviction_distribution=conviction_distribution,
        hold_time_stats=hold_time_stats,
        correlations=correlations,
        rolling_beta=rolling_beta,
        best_trade=best_trade,
        worst_trade=worst_trade,
    )


@router.get("/{strategy_id}/positions", response_model=list[StrategyPosition])
async def get_strategy_positions(
    strategy_id: str = Path(..., description="Strategy identifier"),
) -> list[StrategyPosition]:
    """Return live positions for a single strategy, enriched with Alpaca data."""
    import httpx
    from core.config import settings
    from data.ingestion.trade_ledger import TradeLedger

    # persona-9 #7 — real 404 on unknown ids before any Alpaca I/O.
    data = await _require_strategy(strategy_id)

    # Fetch live Alpaca positions
    alpaca_positions: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.ALPACA_BASE_URL}/v2/positions",
                headers={
                    "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                    "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                },
            )
            if resp.status_code == 200:
                alpaca_positions = resp.json()
    except Exception:
        logger.warning("Failed to fetch Alpaca positions for strategy positions", exc_info=True)

    # Read-only: sync_with_alpaca removed from GET per C2.
    ledger = TradeLedger()

    # Build alpaca price map
    alpaca_by_sym: dict[str, dict] = {}
    for pos in alpaca_positions:
        alpaca_by_sym[pos.get("symbol", "")] = pos

    # Find open trades for this strategy.
    # Round-29 / persona-G P0: SQL-bounded query (uses
    # ix_trade_ledger_strategy) instead of full-table scan. Each handler
    # call goes from O(N_total_trades) to O(N_strategy_trades).
    ledger_name = _ID_TO_NAME.get(strategy_id, strategy_id)
    strategy_trades = ledger.list({"strategy": ledger_name})
    open_trades = [t for t in strategy_trades if t.get("status") == "open"]

    today = date.today()
    results: list[StrategyPosition] = []
    for t in open_trades:
        sym = t.get("symbol", "")
        entry_price = t.get("entry_price", 0)
        shares = t.get("shares", 0)
        alpaca_pos = alpaca_by_sym.get(sym, {})
        current_price = float(alpaca_pos.get("current_price", entry_price))
        unrealized_pnl = float(alpaca_pos.get("unrealized_pl", 0))
        unrealized_pnl_pct = float(alpaca_pos.get("unrealized_plpc", 0)) * 100

        # qa2-team-B: market_value previously always computed as
        # ``current_price * shares`` with a POSITIVE ``shares`` regardless of
        # whether the row was a short. A short position should report a
        # negative market_value (short equity is a liability, not an asset);
        # the old calc flipped the sign on every short and inflated gross
        # exposure numbers that aggregate on market_value. Prefer Alpaca's
        # already-signed ``market_value`` field when available and fall back
        # to side-aware local math.
        row_side = str(t.get("side") or "long").lower()
        try:
            broker_mv_raw = alpaca_pos.get("market_value")
            broker_mv = (
                float(broker_mv_raw) if broker_mv_raw not in (None, "") else None
            )
        except (TypeError, ValueError):
            broker_mv = None
        if broker_mv is not None:
            market_value = broker_mv
        else:
            signed_qty = -abs(shares) if row_side == "short" else shares
            market_value = current_price * signed_qty

        # BUG-018 — emit the full ISO timestamp (with TZ) rather than a
        # truncated YYYY-MM-DD. The frontend now renders the HH:MM + TZ when
        # a ``T`` is present so 7 positions opened seconds apart are visibly
        # distinct.
        entry_ts_raw = t.get("entry_time", "") or ""
        entry_date_str = entry_ts_raw or ""
        date_prefix = entry_ts_raw[:10]
        try:
            entry_d = date.fromisoformat(date_prefix)
            days_held = (today - entry_d).days
        except (ValueError, TypeError):
            days_held = 0

        results.append(StrategyPosition(
            symbol=sym,
            shares=shares,
            entry_price=round(entry_price, 2),
            current_price=round(current_price, 2),
            market_value=round(market_value, 2),
            unrealized_pnl=round(unrealized_pnl, 2),
            unrealized_pnl_pct=round(unrealized_pnl_pct, 2),
            entry_date=entry_date_str,
            days_held=days_held,
            conviction=t.get("conviction"),
            stop_loss=t.get("stop_loss"),
            take_profit=t.get("take_profit"),
            rationale=t.get("rationale"),
        ))

    return results


# ---------------------------------------------------------------------------
# Kill-switch endpoints (Plan B.5)
# ---------------------------------------------------------------------------
# Three endpoints expose the three-layer kill-switch shipped in PR #20:
#   GET  /{strategy_id}/disabled-events  — list disable events for a strategy
#   POST /{strategy_id}/emergency-disable — manually disable (Layer 3)
#   POST /{strategy_id}/re-enable         — resolve a manual (Layer 3) disable
#
# Auth: all three require admin (matches the operational risk profile of the
# `risk-monitor` endpoints above; emergency-disable can halt trading).


class DisabledEventResponse(BaseModel):
    id: int
    strategy: str
    layer: int
    triggered_at: datetime
    reason: str | None = None
    manual_actor: str | None = None
    peak_nav: float | None = None
    current_nav: float | None = None
    realized_pnl: float | None = None
    alloc_capital: float | None = None
    threshold: float | None = None
    resolved_at: datetime | None = None
    resolved_by: str | None = None


class EmergencyDisableRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=500)


class EmergencyDisableResponse(BaseModel):
    success: bool
    event_id: int | None = None
    message: str  # "disabled" / "already_disabled"


class ReEnableResponse(BaseModel):
    success: bool
    resolved_event_id: int | None = None
    message: str  # "re_enabled" / "no_active_disable"


@router.get(
    "/{strategy_id}/disabled-events",
    response_model=list[DisabledEventResponse],
)
async def get_strategy_disabled_events(
    strategy_id: str,
    include_resolved: bool = False,
    _admin: str = Depends(require_admin),
) -> list[DisabledEventResponse]:
    """List kill-switch disable events for a strategy, newest first.

    By default returns only unresolved events (active disables). Pass
    ``?include_resolved=true`` to include the full audit history (capped at 100).
    Admin-only.
    """
    from sqlalchemy import text
    from core.database import _get_session_factory

    factory = _get_session_factory()
    async with factory() as session:
        if include_resolved:
            query = """
                SELECT id, strategy, layer, triggered_at,
                       peak_nav, current_nav, realized_pnl, alloc_capital,
                       threshold, manual_actor, reason, resolved_at, resolved_by
                FROM strategy_disabled_events
                WHERE strategy = :strategy
                ORDER BY triggered_at DESC, id DESC
                LIMIT 100
            """
        else:
            query = """
                SELECT id, strategy, layer, triggered_at,
                       peak_nav, current_nav, realized_pnl, alloc_capital,
                       threshold, manual_actor, reason, resolved_at, resolved_by
                FROM strategy_disabled_events
                WHERE strategy = :strategy
                  AND resolved_at IS NULL
                ORDER BY triggered_at DESC, id DESC
            """
        result = await session.execute(text(query), {"strategy": strategy_id})
        rows = result.fetchall()

    return [
        DisabledEventResponse(
            id=r[0], strategy=r[1], layer=r[2], triggered_at=r[3],
            peak_nav=r[4], current_nav=r[5], realized_pnl=r[6], alloc_capital=r[7],
            threshold=r[8], manual_actor=r[9], reason=r[10],
            resolved_at=r[11], resolved_by=r[12],
        )
        for r in rows
    ]


@router.post(
    "/{strategy_id}/emergency-disable",
    response_model=EmergencyDisableResponse,
)
async def emergency_disable_strategy(
    strategy_id: str,
    payload: EmergencyDisableRequest,
    admin: str = Depends(require_admin),
) -> EmergencyDisableResponse:
    """Manually disable a strategy via Layer 3 of the kill-switch.

    Idempotent: if the strategy already has an unresolved Layer-3 event,
    returns success=False with the existing event_id. Admin-only.
    """
    from sqlalchemy import text
    from core.database import _get_session_factory

    factory = _get_session_factory()
    async with factory() as session:
        # Check for existing unresolved layer-3 event
        existing_result = await session.execute(
            text("""
                SELECT id FROM strategy_disabled_events
                WHERE strategy = :strategy AND layer = 3 AND resolved_at IS NULL
                ORDER BY triggered_at DESC, id DESC LIMIT 1
            """),
            {"strategy": strategy_id},
        )
        existing_row = existing_result.fetchone()
        if existing_row is not None:
            return EmergencyDisableResponse(
                success=False,
                event_id=int(existing_row[0]),
                message="already_disabled",
            )

        # Insert new layer-3 event
        insert_result = await session.execute(
            text("""
                INSERT INTO strategy_disabled_events
                (strategy, layer, triggered_at, manual_actor, reason)
                VALUES (:strategy, 3, NOW(), :actor, :reason)
                RETURNING id
            """),
            {
                "strategy": strategy_id,
                "actor": admin,
                "reason": payload.reason,
            },
        )
        new_id = int(insert_result.fetchone()[0])
        await session.commit()

    write_audit(
        action="strategy.emergency_disable",
        actor=admin,
        resource=strategy_id,
        metadata={"reason": payload.reason, "event_id": new_id},
    )

    return EmergencyDisableResponse(
        success=True,
        event_id=new_id,
        message="disabled",
    )


@router.post(
    "/{strategy_id}/re-enable",
    response_model=ReEnableResponse,
)
async def re_enable_strategy(
    strategy_id: str,
    admin: str = Depends(require_admin),
) -> ReEnableResponse:
    """Resolve the most-recent unresolved Layer-3 (manual) disable for a strategy.

    No-op if no active manual disable exists. Layer-1 (drawdown) auto-disables
    must be cleared via SQL — see KILL_SWITCH.md runbook. Admin-only.
    """
    from sqlalchemy import text
    from core.database import _get_session_factory

    factory = _get_session_factory()
    async with factory() as session:
        existing_result = await session.execute(
            text("""
                SELECT id FROM strategy_disabled_events
                WHERE strategy = :strategy AND layer = 3 AND resolved_at IS NULL
                ORDER BY triggered_at DESC, id DESC LIMIT 1
            """),
            {"strategy": strategy_id},
        )
        existing_row = existing_result.fetchone()
        if existing_row is None:
            return ReEnableResponse(
                success=False,
                resolved_event_id=None,
                message="no_active_disable",
            )

        event_id = int(existing_row[0])
        await session.execute(
            text("""
                UPDATE strategy_disabled_events
                SET resolved_at = NOW(), resolved_by = :actor
                WHERE id = :event_id
            """),
            {"event_id": event_id, "actor": admin},
        )
        await session.commit()

    write_audit(
        action="strategy.re_enable",
        actor=admin,
        resource=strategy_id,
        metadata={"resolved_event_id": event_id},
    )

    return ReEnableResponse(
        success=True,
        resolved_event_id=event_id,
        message="re_enabled",
    )
