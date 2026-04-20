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

from fastapi import APIRouter, Depends, HTTPException, Path
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
        "description": "ML-based regime detection (bull/bear/sideways) combined with strategy rotation. Shifts between momentum, mean-reversion, and defensive allocations.",
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
        "description": "AI-driven opportunistic stock picking powered by Claude. Analyzes top screener picks with a general swing-trade prompt, combining technical and fundamental factors with news sentiment.",
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
    "mean-reversion": {
        "name": "Mean Reversion",
        "description": "Buy oversold quality stocks with strong fundamentals (F-Score >= 5) and sell on reversion to mean. Uses wider stops and targets.",
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
        "description": "Volatility Contraction Pattern breakout — enters when Stage 2 uptrend stocks form tight bases (Minervini SEPA methodology). Tight 3% stops, 10% targets.",
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
        "description": "Systematic dividend harvesting that enters high-yield stocks 2-3 days before ex-dividend date and exits after capture. Screens for dividend yield > 3% with adequate liquidity and momentum support.",
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
        "description": "Rotates capital into the top 3 performing sectors monthly using relative strength ranking across all 11 GICS sectors. Underweights lagging sectors and overweights leaders based on 1-month and 3-month momentum.",
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
    "gap-fill": {
        "name": "Gap Fill",
        "description": "Intraday strategy that fades overnight gaps greater than 1% in liquid large-cap stocks. Enters at market open in the direction of the gap fill and targets 50-80% of the gap with a tight stop at the gap extreme.",
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
        "description": "Trend following based on Moskowitz et al. (2012). Goes long when price is above the 200-day SMA and exits on trend reversal. Uses inverse-volatility position sizing for risk parity. Provides crisis alpha — positive convexity during market crashes.",
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
        "description": "Cross-sectional relative strength combined with absolute momentum filter, based on Jegadeesh & Titman (1993) and Antonacci (2014). Ranks stocks by 12-1 month returns, selects top quintile, and only holds those with positive 12-month absolute return. Monthly rebalance.",
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
        "description": "Intraday breakout strategy based on Crabel (1990) and Fisher's ACD Method. Defines the first 30 minutes' high/low as the opening range, enters on breakout with 1.5x OR width target. Sizes positions using OR width as risk unit. VWAP confirmation filters false breakouts.",
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
        "description": "Institutional VWAP-based strategy (Berkowitz et al. 1988, Madhavan 2002). Three signal modes: VWAP bounce (buy pullback to VWAP in uptrend), upper band breakout (price breaks above 2-std VWAP band with volume), and VWAP reclaim (price crosses back above VWAP). Volume confirmation required.",
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
        "required_lookback_days": 260, "min_universe_size": 1,
        "supports_shorts": False, "supports_options": False,
        "description": (
            "Time-Series Momentum (Moskowitz et al. 2012). Long when price "
            "is above the 200-day SMA, flat otherwise. Crisis-alpha convex."
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
        "required_lookback_days": 400, "min_universe_size": 2,
        "supports_shorts": False, "supports_options": False,
        "description": (
            "Antonacci Dual Momentum (GEM). Relative + absolute momentum "
            "picks between US equities, ex-US equities, and bonds."
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
        "supports_shorts": True, "supports_options": False,
        "description": (
            "Crabel Opening-Range Breakout. 30-minute OR, enter on high/low "
            "break with 1.5x OR target."
        ),
    },
    "vwap": {
        "category": "intraday", "required_bars": ["daily", "5Min"],
        "required_lookback_days": 30, "min_universe_size": 1,
        "supports_shorts": True, "supports_options": False,
        "description": (
            "Institutional VWAP bounce / band breakout. Enters on pullback "
            "to VWAP in uptrend or 2-sigma upper-band breakout with volume."
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
                meta_dict = {
                    "category": meta.category,
                    "description": meta.description,
                    "required_bars": list(meta.required_bars),
                    "required_lookback_days": meta.required_lookback_days,
                    "min_universe_size": meta.min_universe_size,
                    "supports_shorts": meta.supports_shorts,
                    "supports_options": meta.supports_options,
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
    "vwap_strategy": "vwap-strategy",
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
    alpaca_by_strategy: dict[str, list[dict]] = {}
    for pos in alpaca_positions:
        sym = pos.get("symbol", "")
        # Determine strategy from ledger
        strat_id = "manual-discretionary"
        for t in ledger._data.get("trades", []):
            if t["symbol"] == sym and t["status"] == "open":
                strat_name = t.get("strategy", "manual")
                strat_id = _STRATEGY_NAME_TO_ID.get(strat_name, "manual-discretionary")
                break
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
        if gross_deployed > 0:
            curve = _generate_equity_curve(sid, max(gross_deployed, 1), total_return)
            sparkline_data = [p["value"] for p in curve[-20:]] if curve else []

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
            live_disabled=live_disabled,
            paper_only=paper_only,
        ))
    return summaries


@router.get("/leaderboard")
async def strategy_leaderboard() -> dict[str, Any]:
    """Return strategies ranked by total return with Sharpe ratios.

    Computes realised + unrealised P&L from the trade ledger (synced
    with Alpaca) and ranks strategies from best to worst performer.
    """
    import hashlib
    import httpx
    from core.config import settings
    from data.ingestion.trade_ledger import TradeLedger

    # Fetch live Alpaca positions for unrealised P&L
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
        logger.warning("Failed to fetch Alpaca positions for leaderboard", exc_info=True)

    # Read-only: sync_with_alpaca removed from GET per C2.
    ledger = TradeLedger()

    real_perf = _get_real_strategy_performance(ledger)

    # Map Alpaca positions to strategies for unrealised P&L
    unrealized_by_id: dict[str, float] = {}
    for pos in alpaca_positions:
        sym = pos.get("symbol", "")
        strat_id = "manual-discretionary"
        for t in ledger._data.get("trades", []):
            if t["symbol"] == sym and t["status"] == "open":
                strat_id = _STRATEGY_NAME_TO_ID.get(t.get("strategy", "manual"), "manual-discretionary")
                break
        unrealized_by_id[strat_id] = unrealized_by_id.get(strat_id, 0) + float(pos.get("unrealized_pl", 0))

    entries: list[dict[str, Any]] = []
    for sid, sdata in _STRATEGIES.items():
        invested = 0.0
        gross_deployed = 0.0
        pnl_dollars = 0.0
        sharpe = 0.0
        # Per-trade returns AND their holding periods (in days). We can't
        # honestly annualise per-trade returns by sqrt(252) without knowing
        # the average hold period — that inflates Sharpe by sqrt(avg_hold_days).
        # For a PEAD strategy that holds 30-60 days the inflation factor is
        # 5-8×; for a monthly rebalance ~4.6×. We correct by scaling sqrt by
        # (252 / avg_hold_days).
        per_trade_returns: list[float] = []
        hold_days_list: list[float] = []

        for strat_name, strat_id in _STRATEGY_NAME_TO_ID.items():
            if strat_id != sid or strat_name not in real_perf:
                continue
            rp = real_perf[strat_name]
            if rp["trades"] > 0:
                pnl_dollars = rp["pnl"] + unrealized_by_id.get(sid, 0)
                invested = rp.get("invested", 0.0)
                gross_deployed = rp.get("gross_deployed", invested)

                # Build per-trade returns from closed trades for Sharpe,
                # respecting side ("short" flips the sign of (exit-entry)/entry).
                for t in ledger._data.get("trades", []):
                    if t.get("strategy") != strat_name or t.get("status") != "closed":
                        continue
                    entry_p = t.get("entry_price", 0)
                    exit_p = t.get("exit_price", 0)
                    if not (entry_p and exit_p):
                        continue
                    raw_side = str(t.get("side") or "long").lower()
                    if raw_side in {"short", "sell", "s"}:
                        ret = (entry_p - exit_p) / entry_p
                    else:
                        ret = (exit_p - entry_p) / entry_p
                    per_trade_returns.append(ret)
                    # Hold period in days (inclusive of partial days => min 1)
                    entry_time = t.get("entry_time")
                    exit_time = t.get("exit_time")
                    try:
                        if entry_time and exit_time:
                            e_dt = datetime.fromisoformat(entry_time[:19])
                            x_dt = datetime.fromisoformat(exit_time[:19])
                            hold = max((x_dt - e_dt).total_seconds() / 86400.0, 1.0)
                            hold_days_list.append(hold)
                    except (ValueError, TypeError):
                        pass
            break

        # BUG-004: divide by all-time gross deployed (not current cost
        # basis) so the return percentage stays stable after positions exit.
        return_pct = round(pnl_dollars / gross_deployed * 100, 1) if gross_deployed > 0 else 0.0

        # Compute Sharpe using per-trade returns, annualised by
        # sqrt(252 / avg_hold_days) so multi-day holds don't get inflated.
        avg_hold_days = (
            sum(hold_days_list) / len(hold_days_list) if hold_days_list else 1.0
        )
        # Guard: avg_hold_days must be positive finite.
        if not math.isfinite(avg_hold_days) or avg_hold_days <= 0:
            avg_hold_days = 1.0
        ann_factor = math.sqrt(252 / avg_hold_days)
        if len(per_trade_returns) > 1:
            mean_r = statistics.mean(per_trade_returns)
            std_r = statistics.stdev(per_trade_returns)
            sharpe = round(mean_r / std_r * ann_factor, 2) if std_r > 0 else 0.0
        # A Sharpe ratio requires at least two observations to define a
        # standard deviation — a single-trade "Sharpe" is mathematically
        # undefined. The previous branch returned ``return × ann_factor``,
        # which is an annualised return masquerading as a Sharpe and
        # misleadingly poisoned the leaderboard for any strategy with one
        # closed trade. Leave the initial ``sharpe = 0.0`` in place.

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

    return {
        "leaderboard": entries,
        "worst_performer": worst_performer,
        "best_sharpe": best_sharpe_entry["id"] if best_sharpe_entry else None,
    }


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
    alpaca_for_strat: list[dict] = []
    for pos in alpaca_positions:
        sym = pos.get("symbol", "")
        matched_strat_id = "manual-discretionary"
        for t in ledger._data.get("trades", []):
            if t["symbol"] == sym and t["status"] == "open":
                matched_strat_id = _STRATEGY_NAME_TO_ID.get(
                    t.get("strategy", "manual"), "manual-discretionary"
                )
                break
        if matched_strat_id == strategy_id:
            alpaca_for_strat.append(pos)

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
    strategy_id: str = Path(..., description="Strategy identifier"),
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

    canonical = _canonical_id(strategy_id)
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
            logger.error(
                "toggle_strategy: %d WATCH conflicts in a row for %s; giving up",
                max_attempts, strategy_id,
            )
            raise HTTPException(
                status_code=409,
                detail=f"Strategy toggle conflicted with concurrent updates: {last_err}",
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
    enabled: bool = True,
    _admin: str = Depends(require_admin),
) -> RiskMonitorState:
    """Toggle the Master Agent risk monitor on or off.

    Admin-only (security-audit-r3 P0 #1). When disabled, all risk checks
    (P1-P4) are bypassed and trades are auto-approved (only duplicate symbol
    check remains) — toggling this off is a trust-me-bro override that should
    never be exposed to a non-admin principal.
    """
    from data.ingestion.master_agent import MasterAgent

    previous = MasterAgent.RISK_MONITOR_ENABLED
    MasterAgent.RISK_MONITOR_ENABLED = enabled
    logger.warning(
        "Risk monitor toggled: %s -> %s",
        "ON" if previous else "OFF",
        "ON" if enabled else "OFF",
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

    return RiskMonitorState(
        enabled=MasterAgent.RISK_MONITOR_ENABLED,
        message=f"Risk monitor is {'enabled' if MasterAgent.RISK_MONITOR_ENABLED else 'disabled'}.",
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

    all_trades = [
        t for t in ledger._data.get("trades", [])
        if t.get("strategy") == ledger_name
    ]
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

    # Find open trades for this strategy
    ledger_name = _ID_TO_NAME.get(strategy_id, strategy_id)
    open_trades = [
        t for t in ledger._data.get("trades", [])
        if t.get("status") == "open" and t.get("strategy") == ledger_name
    ]

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
            market_value=round(current_price * shares, 2),
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
